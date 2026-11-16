import type { LanguageFilterConfig } from "./types.js";

/**
 * Lightweight script/stop-word language detection. It is intentionally
 * dependency-free and tuned for event listings, not for long documents.
 */

export const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  ja: "Japanese",
  zh: "Chinese",
  ko: "Korean",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  other: "Other",
  unknown: "Unknown",
};

const KANA = /[\u3040-\u30ff]/g;
const HANGUL = /[\uac00-\ud7af\u1100-\u11ff]/g;
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/g;
const LATIN = /[A-Za-z\u00c0-\u024f]/g;

const STOPWORDS: Record<string, Set<string>> = {
  en: new Set([
    "the", "and", "with", "for", "you", "your", "join", "event", "events", "this", "from",
    "our", "will", "are", "about", "into", "how", "what", "when", "where", "who", "not",
    "have", "has", "can", "all", "new", "more", "than", "their", "they", "its", "of", "in",
    "on", "at", "to", "is", "it", "as", "by", "or", "an", "be", "we", "us",
  ]),
  es: new Set(["el", "la", "los", "las", "de", "que", "y", "en", "para", "con", "una", "un", "por", "del", "es", "sobre", "son"]),
  fr: new Set(["le", "la", "les", "des", "et", "pour", "avec", "une", "un", "du", "dans", "sur", "est", "au", "aux"]),
  de: new Set(["der", "die", "das", "und", "mit", "für", "fur", "ein", "eine", "von", "im", "zu", "auf", "ist", "den"]),
  pt: new Set(["os", "as", "de", "que", "em", "para", "com", "uma", "um", "do", "da"]),
};

const CJK_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "ja", pattern: KANA },
  { code: "ko", pattern: HANGUL },
];

export function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] ?? code.toUpperCase();
}

export function detectLanguage(text: string): string {
  const sample = text.normalize("NFC");
  if (!sample.trim()) return "unknown";

  for (const { code, pattern } of CJK_PATTERNS) {
    if (count(pattern, sample) > 0) return code;
  }

  const han = count(HAN, sample);
  const latin = count(LATIN, sample);

  // Han-only text is most often Chinese; Japanese titles almost always contain kana.
  if (han > 0 && han >= latin * 0.5) return "zh";
  if (latin === 0) return "unknown";

  return scoreLatin(sample);
}

export function detectEventLanguage(title: string, description?: string, override?: string): string {
  if (override) return override;
  const fromTitle = detectLanguage(title);
  if (fromTitle !== "unknown") return fromTitle;
  return description ? detectLanguage(description) : "unknown";
}

export function applyLanguageFilter<T extends { language: string }>(
  events: T[],
  filter: LanguageFilterConfig,
): T[] {
  const include = normalizeCodes(filter.include);
  const exclude = new Set(normalizeCodes(filter.exclude));

  return events.filter((event) => {
    if (include.length > 0 && !include.includes(event.language)) return false;
    if (exclude.has(event.language)) return false;
    return true;
  });
}

export function languageCounts(events: Array<{ language: string }>): Array<{ code: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.language, (counts.get(event.language) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, label: languageLabel(code), count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
}

export function normalizeCodes(codes: string[] | undefined): string[] {
  if (!codes) return [];
  return [...new Set(codes.map((code) => code.trim().toLowerCase()).filter(Boolean))];
}

function scoreLatin(text: string): string {
  const words = text.toLowerCase().match(/[a-z\u00c0-\u024f']+/g) ?? [];
  if (words.length === 0) return "unknown";

  const scores = new Map<string, number>();
  for (const [code, stopwords] of Object.entries(STOPWORDS)) {
    let score = 0;
    for (const word of words) {
      if (word.length < 2) continue;
      if (stopwords.has(word)) score += 1;
    }
    if (score > 0) scores.set(code, score);
  }

  // English is the default: only switch when another language has real evidence.
  const english = scores.get("en") ?? 0;
  let best = "en";
  let bestScore = english;
  for (const [code, score] of scores) {
    if (code === "en") continue;
    if (score >= 2 && score > bestScore) {
      best = code;
      bestScore = score;
    }
  }
  return best;
}

function count(pattern: RegExp, text: string): number {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}
