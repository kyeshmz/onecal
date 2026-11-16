import type { CalendarEvent, FiltersConfig } from "./types.js";

/**
 * Applied to every event unless a config adds more. Matching is case-insensitive,
 * hyphen-insensitive and NFKC-normalised, so "Members-Only" == "members only".
 */
export const DEFAULT_EXCLUDED_KEYWORDS = [
  "members only",
  "member only",
  "for members only",
  "exclusive to members",
  "exclusive to jccnc members",
  "jccnc members only",
  "会員限定",
  "会員のみ",
  "会員専用",
  "メンバー限定",
];

export interface ContentFilterResult {
  events: CalendarEvent[];
  /** Number of events removed by these filters. */
  excluded: number;
}

export function buildExcludeKeywords(filters?: FiltersConfig): string[] {
  const keywords = [...DEFAULT_EXCLUDED_KEYWORDS, ...(filters?.excludeKeywords ?? [])]
    .map(normalize)
    .filter(Boolean);
  return [...new Set(keywords)];
}

export function applyContentFilters(
  events: CalendarEvent[],
  keywords: string[],
): ContentFilterResult {
  if (keywords.length === 0) return { events, excluded: 0 };

  const kept: CalendarEvent[] = [];
  let excluded = 0;

  for (const event of events) {
    const haystack = normalize(
      [event.title, event.description ?? "", ...event.categories].join("\n"),
    );
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      excluded += 1;
      continue;
    }
    kept.push(event);
  }

  return { events: kept, excluded };
}

export function isExcludedByKeyword(text: string, keywords: string[]): boolean {
  const haystack = normalize(text);
  return keywords.some((keyword) => haystack.includes(keyword));
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2010-\u2015-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
