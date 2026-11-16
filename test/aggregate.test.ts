import assert from "node:assert/strict";
import test from "node:test";
import { Aggregator } from "../src/aggregate.js";
import type { Config, RawEvent } from "../src/types.js";

const NOW = new Date("2026-11-16T12:00:00Z");

function config(overrides: Partial<Config> = {}): Config {
  return {
    feedName: "Test",
    timezone: "America/Los_Angeles",
    window: { daysBack: 1, daysAhead: 180 },
    cacheTtlSeconds: 900,
    sources: [
      { id: "a", label: "Source A", type: "ics", url: "https://a.example/feed.ics", color: "#111111" },
      { id: "b", label: "Source B", type: "ics", url: "https://b.example/feed.ics", color: "#222222" },
    ],
    ...overrides,
  };
}

function event(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    uid: "uid-1",
    title: "Manga AI Night",
    start: new Date("2026-11-17T19:00:00Z"),
    end: new Date("2026-11-17T21:00:00Z"),
    allDay: false,
    status: "CONFIRMED",
    categories: [],
    exdates: [],
    sourceId: "a",
    ...overrides,
  };
}

test("merges the same event from two sources", async () => {
  const aggregator = new Aggregator(config(), {
    now: () => NOW,
    loader: async (source) =>
      source.id === "a"
        ? [
            event({
              sourceId: "a",
              description: "short",
              location: "Japantown, San Francisco",
              categories: ["AI"],
            }),
          ]
        : [
            event({
              sourceId: "b",
              uid: "uid-2",
              description: "a much longer description of the same event",
              location: "Japantown, SF",
              url: "https://example.com/event",
              categories: ["Design"],
            }),
          ],
  });

  const snapshot = await aggregator.getSnapshot();

  assert.equal(snapshot.events.length, 1);
  const [merged] = snapshot.events;
  assert.equal(merged?.sources.length, 2);
  assert.equal(merged?.description, "a much longer description of the same event");
  assert.equal(merged?.location, "Japantown, San Francisco");
  assert.equal(merged?.url, "https://example.com/event");
  assert.deepEqual(merged?.categories.sort(), ["AI", "Design"]);
  assert.match(merged?.id ?? "", /^onecal-[0-9a-f]{20}@onecal$/);
  assert.equal(merged?.language, "en");
});

test("keeps separate events with incompatible venues", async () => {
  const aggregator = new Aggregator(config(), {
    now: () => NOW,
    loader: async (source) => [
      event({
        sourceId: source.id,
        uid: `${source.id}-1`,
        ...(source.id === "b" ? { location: "Online" } : { location: "Moscone Center" }),
      }),
    ],
  });

  const snapshot = await aggregator.getSnapshot();
  assert.equal(snapshot.events.length, 2);
});

test("applies the configured language filter", async () => {
  const aggregator = new Aggregator(config({ languages: { exclude: ["ja"] } }), {
    now: () => NOW,
    loader: async (source) =>
      source.id === "a"
        ? [event({ sourceId: "a", title: "新年会のご案内", uid: "ja-1" })]
        : [event({ sourceId: "b", title: "AI Night", uid: "en-1", start: new Date("2026-11-18T19:00:00Z"), end: new Date("2026-11-18T21:00:00Z") })],
  });

  const snapshot = await aggregator.getSnapshot();
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0]?.title, "AI Night");
});

test("honours a source-level language override", async () => {
  const aggregator = new Aggregator(config({ sources: [{ id: "a", label: "A", type: "ics", url: "https://a.example/feed.ics", language: "ja" }] }), {
    now: () => NOW,
    loader: async () => [event({ title: "AI Night" })],
  });

  const snapshot = await aggregator.getSnapshot();
  assert.equal(snapshot.events[0]?.language, "ja");
});

test("caches sources until the TTL expires", async () => {
  let now = NOW;
  const calls: string[] = [];
  const aggregator = new Aggregator(config(), {
    now: () => now,
    loader: async (source) => {
      calls.push(source.id);
      return [event({ sourceId: source.id, uid: `${source.id}-1` })];
    },
  });

  await aggregator.getSnapshot();
  assert.deepEqual(calls, ["a", "b"]);

  await aggregator.getSnapshot();
  assert.deepEqual(calls, ["a", "b"]);

  now = new Date(NOW.getTime() + 901_000);
  await aggregator.getSnapshot();
  assert.deepEqual(calls, ["a", "b", "a", "b"]);
});

test("keeps cached events when a refresh fails", async () => {
  let now = NOW;
  let fail = false;

  const aggregator = new Aggregator(config({ sources: [{ id: "a", label: "A", type: "ics", url: "https://a.example/feed.ics" }] }), {
    now: () => now,
    loader: async () => {
      if (fail) throw new Error("upstream exploded");
      return [event()];
    },
  });

  const first = await aggregator.getSnapshot();
  assert.equal(first.events.length, 1);
  assert.equal(first.sources[0]?.ok, true);

  now = new Date(NOW.getTime() + 901_000);
  fail = true;
  const second = await aggregator.getSnapshot();

  assert.equal(second.events.length, 1);
  assert.equal(second.sources[0]?.ok, false);
  assert.equal(second.sources[0]?.stale, true);
  assert.match(second.sources[0]?.error ?? "", /upstream exploded/);
  assert.equal(second.healthy, true);
});

test("backs off after a failed refresh", async () => {
  let now = NOW;
  let fail = false;
  let calls = 0;

  const aggregator = new Aggregator(config({ sources: [{ id: "a", label: "A", type: "ics", url: "https://a.example/feed.ics" }] }), {
    now: () => now,
    loader: async () => {
      calls += 1;
      if (fail) throw new Error("upstream down");
      return [event()];
    },
  });

  await aggregator.getSnapshot();
  assert.equal(calls, 1);

  now = new Date(NOW.getTime() + 901_000);
  fail = true;
  await aggregator.getSnapshot();
  assert.equal(calls, 2);

  await aggregator.getSnapshot();
  assert.equal(calls, 2, "should not hammer a failing source on every request");
});

test("reports a total outage as unhealthy", async () => {
  const aggregator = new Aggregator(config({ sources: [{ id: "a", label: "A", type: "ics", url: "https://a.example/feed.ics" }] }), {
    now: () => NOW,
    loader: async () => {
      throw new Error("no dice");
    },
  });

  const snapshot = await aggregator.getSnapshot();
  assert.equal(snapshot.events.length, 0);
  assert.equal(snapshot.healthy, false);
  assert.equal(snapshot.sources[0]?.ok, false);
});

test("filters to the configured window and drops cancelled events", async () => {
  const aggregator = new Aggregator(config(), {
    now: () => NOW,
    loader: async (source) =>
      source.id === "a"
        ? [
            event({ start: new Date("2025-01-01T19:00:00Z"), end: new Date("2025-01-01T21:00:00Z"), uid: "past" }),
            event({ status: "CANCELLED", uid: "cancelled" }),
            event({ uid: "future", start: new Date("2027-06-01T19:00:00Z"), end: new Date("2027-06-01T21:00:00Z") }),
          ]
        : [event({ sourceId: "b", uid: "ok" })],
  });

  const snapshot = await aggregator.getSnapshot();
  const uids = snapshot.events.map((entry) => entry.uid).sort();
  assert.deepEqual(uids, ["ok"]);
});
