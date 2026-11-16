import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLanguageFilter,
  detectLanguage,
  detectEventLanguage,
  languageCounts,
} from "../src/languages.js";

test("detects Japanese from kana", () => {
  assert.equal(detectLanguage("シリコンバレースタートアップが挑むAIビジネス"), "ja");
  assert.equal(detectLanguage("JCCNC 新春ネットワーキングのご案内"), "ja");
});

test("detects Korean and Chinese scripts", () => {
  assert.equal(detectLanguage("서울 인공지능 컨퍼런스"), "ko");
  assert.equal(detectLanguage("北京人工智能大会"), "zh");
});

test("detects Latin languages with stop-word scoring", () => {
  assert.equal(detectLanguage("Join us for the AI and design meetup"), "en");
  assert.equal(
    detectLanguage("Conferencia sobre inteligencia artificial para la comunidad"),
    "es",
  );
  assert.equal(
    detectLanguage("Conférence sur le design et l'intelligence artificielle pour tous"),
    "fr",
  );
});

test("defaults to English for short Latin titles", () => {
  assert.equal(detectLanguage("Keizai Hiking Day"), "en");
  assert.equal(detectLanguage("AI Night"), "en");
  assert.equal(
    detectLanguage(
      "Kites, Clouds & A Curator: A Members-Only Tour of Jacob Hashimoto Works at SFMOMA and Berggruen Gallery",
    ),
    "en",
  );
  assert.equal(detectLanguage(""), "unknown");
});

test("honours a source-level language override", () => {
  assert.equal(detectEventLanguage("AI Night", undefined, "ja"), "ja");
  assert.equal(detectEventLanguage("AI Night"), "en");
});

test("filters by include and exclude lists", () => {
  const events = [{ language: "en" }, { language: "ja" }, { language: "zh" }];

  assert.deepEqual(
    applyLanguageFilter(events, { include: ["en", "ja"] }).map((event) => event.language),
    ["en", "ja"],
  );
  assert.deepEqual(
    applyLanguageFilter(events, { exclude: ["ja"] }).map((event) => event.language),
    ["en", "zh"],
  );
  assert.equal(applyLanguageFilter(events, {}).length, 3);
});

test("counts and labels languages", () => {
  const counts = languageCounts([{ language: "ja" }, { language: "ja" }, { language: "en" }]);
  assert.deepEqual(counts, [
    { code: "ja", label: "Japanese", count: 2 },
    { code: "en", label: "English", count: 1 },
  ]);
});
