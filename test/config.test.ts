import assert from "node:assert/strict";
import test from "node:test";
import { ConfigError, validateConfig } from "../src/config.js";

const MINIMAL = {
  sources: [{ id: "usajapan", label: "USA Japan", type: "tribe", baseUrl: "https://www.usajapan.org/events/" }],
};

test("accepts a minimal config", () => {
  const config = validateConfig(MINIMAL);
  assert.equal(config.sources.length, 1);
  assert.equal(config.sources[0]?.enabled, true);
  assert.equal(config.window?.daysAhead, 180);
  assert.equal(config.cacheTtlSeconds, 900);
  assert.equal(config.refreshIntervalSeconds, 300);
});

test("normalises language filters and per-source overrides", () => {
  const config = validateConfig({
    languages: { include: ["EN"], exclude: ["ja", "ja"] },
    sources: [
      {
        id: "luma",
        label: "Luma",
        type: "luma",
        calendarId: "cal-abc123",
        language: "JA",
      },
    ],
  });

  assert.deepEqual(config.languages, { include: ["en"], exclude: ["ja"] });
  assert.equal(config.sources[0]?.language, "ja");
});

test("validates the watchlist", () => {
  const config = validateConfig({
    ...MINIMAL,
    watchlist: [
      {
        label: "JCCNC",
        url: "https://www.jccnc.org/past-events",
        contact: "mail@jccnc.org",
        note: "No public feed",
      },
    ],
  });

  assert.equal(config.watchlist?.[0]?.label, "JCCNC");
  assert.throws(
    () =>
      validateConfig({
        ...MINIMAL,
        watchlist: [{ label: "Bad", url: "not a url", note: "nope" }],
      }),
    ConfigError,
  );
});

test("rejects duplicate source ids", () => {
  assert.throws(
    () =>
      validateConfig({
        sources: [
          { id: "same", label: "One", type: "ics", url: "https://example.com/a.ics" },
          { id: "same", label: "Two", type: "ics", url: "https://example.com/b.ics" },
        ],
      }),
    /duplicate source id/,
  );
});

test("requires a Luma calendar id or url", () => {
  assert.throws(
    () => validateConfig({ sources: [{ id: "x", label: "X", type: "luma" }] }),
    /needs? "calendarId" or "url"/,
  );
});

test("rejects unknown timezones and empty source lists", () => {
  assert.throws(() => validateConfig({ sources: [] }), /non-empty array/);
  assert.throws(
    () => validateConfig({ ...MINIMAL, timezone: "Mars/Olympus_Mons" }),
    /unknown timezone/,
  );
});

test("rejects a non-boolean enabled flag", () => {
  assert.throws(
    () =>
      validateConfig({
        sources: [
          { id: "x", label: "X", type: "ics", url: "https://example.com/f.ics", enabled: "no" },
        ],
      }),
    /must be true or false/,
  );
});

test("validates RSS sources, filters and refresh settings", () => {
  const config = validateConfig({
    refreshIntervalSeconds: 0,
    filters: { excludeKeywords: ["No Cameras"] },
    sources: [
      {
        id: "rss",
        label: "RSS",
        type: "rss",
        url: "https://example.com/feed.xml",
        usePublishedDate: true,
        durationHours: 1.5,
      },
    ],
  });

  assert.equal(config.refreshIntervalSeconds, 0);
  assert.deepEqual(config.filters, { excludeKeywords: ["no cameras"] });

  const source = config.sources[0];
  assert.equal(source?.type, "rss");
  if (source?.type === "rss") {
    assert.equal(source.usePublishedDate, true);
    assert.equal(source.durationHours, 1.5);
  }

  assert.throws(
    () =>
      validateConfig({
        sources: [
          { id: "rss", label: "RSS", type: "rss", url: "https://example.com/feed.xml", durationHours: 0 },
        ],
      }),
    /positive number/,
  );
});
