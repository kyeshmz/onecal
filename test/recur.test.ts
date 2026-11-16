import assert from "node:assert/strict";
import test from "node:test";
import { expandEvent, expandSourceEvents, parseRule } from "../src/recur.js";
import type { RawEvent } from "../src/types.js";

const WINDOW = {
  from: new Date("2026-01-01T00:00:00Z"),
  to: new Date("2027-01-01T00:00:00Z"),
  timezone: "America/Los_Angeles",
};

function event(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    uid: "series",
    title: "Weekly meetup",
    start: new Date("2026-11-16T18:00:00Z"),
    end: new Date("2026-11-16T20:00:00Z"),
    allDay: false,
    status: "CONFIRMED",
    categories: [],
    exdates: [],
    sourceId: "test",
    ...overrides,
  };
}

test("expands a daily rule with COUNT", () => {
  const occurrences = expandEvent(event({ rrule: "FREQ=DAILY;COUNT=3" }), WINDOW);
  assert.equal(occurrences.length, 3);
  assert.deepEqual(
    occurrences.map((occurrence) => occurrence.start.toISOString()),
    [
      "2026-11-16T18:00:00.000Z",
      "2026-11-17T18:00:00.000Z",
      "2026-11-18T18:00:00.000Z",
    ],
  );
  assert.notEqual(occurrences[1]?.uid, occurrences[0]?.uid);
  assert.equal(occurrences[0]?.rrule, undefined);
});

test("keeps wall-clock time across a DST change", () => {
  const occurrences = expandEvent(
    event({
      start: new Date("2026-03-01T18:00:00Z"),
      end: new Date("2026-03-01T19:00:00Z"),
      rrule: "FREQ=DAILY;COUNT=10",
    }),
    {
      from: new Date("2026-03-01T00:00:00Z"),
      to: new Date("2026-04-01T00:00:00Z"),
      timezone: "America/Los_Angeles",
    },
  );

  const afterDst = occurrences.find((occurrence) =>
    occurrence.start.toISOString().startsWith("2026-03-09"),
  );
  assert.equal(afterDst?.start.toISOString(), "2026-03-09T17:00:00.000Z");
});

test("expands weekly BYDAY occurrences in order", () => {
  const occurrences = expandEvent(
    event({
      start: new Date("2026-11-02T19:00:00Z"),
      rrule: "FREQ=WEEKLY;COUNT=4;BYDAY=MO,WE",
    }),
    WINDOW,
  );

  assert.deepEqual(
    occurrences.map((occurrence) => occurrence.start.toISOString().slice(0, 10)),
    ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11"],
  );
});

test("skips invalid monthly dates", () => {
  const occurrences = expandEvent(
    event({
      start: new Date("2026-01-31T19:00:00Z"),
      rrule: "FREQ=MONTHLY;COUNT=3",
    }),
    WINDOW,
  );

  assert.deepEqual(
    occurrences.map((occurrence) => occurrence.start.toISOString().slice(0, 10)),
    ["2026-01-31", "2026-03-31", "2026-05-31"],
  );
});

test("respects UNTIL and EXDATE", () => {
  const occurrences = expandEvent(
    event({
      rrule: "FREQ=DAILY;UNTIL=20261118T235959Z",
      exdates: [new Date("2026-11-17T18:00:00Z")],
    }),
    WINDOW,
  );

  assert.deepEqual(
    occurrences.map((occurrence) => occurrence.start.toISOString().slice(0, 10)),
    ["2026-11-16", "2026-11-18"],
  );
});

test("skips occurrences overridden by a RECURRENCE-ID instance", () => {
  const master = event({ rrule: "FREQ=DAILY;COUNT=3" });
  const override = event({
    uid: "series",
    title: "Weekly meetup (moved)",
    start: new Date("2026-11-17T20:00:00Z"),
    end: new Date("2026-11-17T22:00:00Z"),
    recurrenceId: new Date("2026-11-17T18:00:00Z"),
  });

  const expanded = expandSourceEvents([master, override], WINDOW);
  const dates = expanded.map((occurrence) => occurrence.start.toISOString());

  assert.ok(dates.includes("2026-11-17T20:00:00.000Z"));
  assert.ok(!dates.includes("2026-11-17T18:00:00.000Z"));
});

test("jumps to the window instead of stopping at the occurrence limit", () => {
  const occurrences = expandEvent(
    event({
      start: new Date("2020-01-01T18:00:00Z"),
      end: new Date("2020-01-01T19:00:00Z"),
      rrule: "FREQ=DAILY",
    }),
    {
      from: new Date("2026-11-16T00:00:00Z"),
      to: new Date("2026-11-19T00:00:00Z"),
      timezone: "America/Los_Angeles",
      limit: 10,
    },
  );

  assert.deepEqual(
    occurrences.map((occurrence) => occurrence.start.toISOString().slice(0, 10)),
    ["2026-11-16", "2026-11-17", "2026-11-18"],
  );
});

test("ignores unsupported or missing rules", () => {
  assert.equal(parseRule("FREQ=HOURLY;COUNT=3"), null);
  assert.equal(parseRule(""), null);
  assert.equal(expandEvent(event(), WINDOW).length, 1);
});
