import assert from "node:assert/strict";
import test from "node:test";
import {
  applyContentFilters,
  buildExcludeKeywords,
  isExcludedByKeyword,
  matchesLocation,
} from "../src/content-filters.js";
import type { CalendarEvent } from "../src/types.js";

function event(title: string, description?: string): CalendarEvent {
  return {
    id: `onecal-${title}@onecal`,
    uid: title,
    title,
    start: new Date("2026-11-17T19:00:00Z"),
    end: new Date("2026-11-17T21:00:00Z"),
    allDay: false,
    status: "CONFIRMED",
    categories: [],
    language: "en",
    eventType: "other",
    sources: [{ id: "a", label: "A", color: "#111111", platform: "ics" }],
    ...(description ? { description } : {}),
  };
}

test("matches members-only titles across punctuation and full-width text", () => {
  const keywords = buildExcludeKeywords();

  assert.equal(isExcludedByKeyword("Weekly Circle - Members Only", keywords), true);
  assert.equal(isExcludedByKeyword("Members-Only Tour", keywords), true);
  assert.equal(isExcludedByKeyword("新年会（会員限定）", keywords), true);
  assert.equal(isExcludedByKeyword("Exclusive to JCCNC Members", keywords), true);
  assert.equal(isExcludedByKeyword("AI Night", keywords), false);
});

test("adds custom exclusion keywords", () => {
  const keywords = buildExcludeKeywords({ excludeKeywords: ["no cameras"] });
  assert.equal(isExcludedByKeyword("Studio tour (NO CAMERAS)", keywords), true);
});

test("removes matching events and counts them", () => {
  const result = applyContentFilters(
    [event("Members-Only Tour"), event("Public Talk")],
    buildExcludeKeywords(),
  );

  assert.equal(result.excluded, 1);
  assert.deepEqual(result.events.map((entry) => entry.title), ["Public Talk"]);
});

test("matches members-only text in the description", () => {
  const result = applyContentFilters(
    [event("JCCNC Seminar", "Exclusive to JCCNC Members.")],
    buildExcludeKeywords(),
  );

  assert.equal(result.excluded, 1);
  assert.equal(result.events.length, 0);
});

test("filters locations while keeping online and unknown venues", () => {
  assert.equal(matchesLocation("San Francisco, CA", ["san francisco"]), true);
  assert.equal(matchesLocation("2 Marina Blvd, San Francisco, CA", ["san francisco"]), true);
  assert.equal(matchesLocation("Mountain View, CA", ["san francisco"]), false);
  assert.equal(matchesLocation("Online", ["san francisco"]), true);
  assert.equal(matchesLocation(undefined, ["san francisco"]), true);
  assert.equal(matchesLocation("Oakland, CA", []), true);
  assert.equal(matchesLocation("Oakland, CA", undefined), true);
});
