import assert from "node:assert/strict";
import test from "node:test";
import { applyQueryFilters, readQueryFilters } from "../src/filters.js";
import type { CalendarEvent, Config } from "../src/types.js";

const CONFIG: Config = {
  sources: [],
  languages: { exclude: ["ko"] },
};

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "onecal-1@onecal",
    uid: "1",
    title: "Manga AI Night",
    start: new Date("2026-11-17T19:00:00Z"),
    end: new Date("2026-11-17T21:00:00Z"),
    allDay: false,
    status: "CONFIRMED",
    categories: ["AI"],
    language: "en",
    sources: [{ id: "usajapan", label: "Japan Society", color: "#c2413b", platform: "tribe" }],
    ...overrides,
  };
}

test("reads source, language and query params", () => {
  const filters = readQueryFilters(
    new URL("http://localhost/api/events?source=usajapan,keizai&lang=JA&excludeLang=zh&q=AI"),
    CONFIG,
  );

  assert.deepEqual(filters.sources, ["usajapan", "keizai"]);
  assert.deepEqual(filters.languages.include, ["ja"]);
  assert.deepEqual(filters.languages.exclude, ["ko", "zh"]);
  assert.equal(filters.q, "ai");
});

test("falls back to config language includes", () => {
  const filters = readQueryFilters(new URL("http://localhost/feed.ics"), CONFIG);
  assert.deepEqual(filters.languages.include, []);
  assert.deepEqual(filters.languages.exclude, ["ko"]);
});

test("filters by source, language and free text", () => {
  const events = [
    event(),
    event({
      id: "onecal-2@onecal",
      title: "新年会のご案内",
      language: "ja",
      sources: [{ id: "keizai", label: "Keizai", color: "#1f6f5c", platform: "luma" }],
    }),
  ];

  const bySource = applyQueryFilters(events, {
    sources: ["keizai"],
    q: "",
    languages: {},
  });
  assert.equal(bySource.length, 1);
  assert.equal(bySource[0]?.sources[0]?.id, "keizai");

  const byLanguage = applyQueryFilters(events, {
    sources: [],
    q: "",
    languages: { include: ["ja"] },
  });
  assert.equal(byLanguage.length, 1);
  assert.equal(byLanguage[0]?.language, "ja");

  const byQuery = applyQueryFilters(events, { sources: [], q: "manga", languages: {} });
  assert.equal(byQuery.length, 1);
  assert.equal(byQuery[0]?.title, "Manga AI Night");
});
