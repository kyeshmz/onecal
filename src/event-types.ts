export interface EventTypeDefinition {
  id: string;
  label: string;
  keywords: string[];
}

/** Order is the tie-breaker when two types score equally. */
export const EVENT_TYPE_DEFINITIONS: EventTypeDefinition[] = [
  {
    id: "hackathon",
    label: "Hackathon",
    keywords: ["hackathon", "hack week", "hackweek", "buildathon", "code jam", "ハッカソン", "アイデアソン"],
  },
  {
    id: "conference",
    label: "Conference",
    keywords: [
      "conference", "symposium", "summit", "congress", "convention", "forum",
      "カンファレンス", "学会", "サミット", "フォーラム",
    ],
  },
  {
    id: "festival",
    label: "Festival / Market",
    keywords: [
      "festival", "matsuri", "parade", "cherry blossom", "night market", "street fair",
      "expo", "祭り", "まつり", "フェス", "マーケット", "展示会",
    ],
  },
  {
    id: "performance",
    label: "Performance / Screening",
    keywords: [
      "concert", "performance", "live music", "theater", "theatre", "comedy show",
      "screening", "film", "movie", "cinema", "open decks", "dj", "コンサート", "公演",
      "上映", "映画", "ライブ",
    ],
  },
  {
    id: "workshop",
    label: "Workshop",
    keywords: ["workshop", "bootcamp", "boot camp", "training", "hands on", "ワークショップ", "講座", "教室"],
  },
  {
    id: "panel",
    label: "Panel",
    keywords: ["panel", "roundtable", "round table", "discussion", "座談会", "パネル", "ディスカッション"],
  },
  {
    id: "seminar",
    label: "Talk / Seminar",
    keywords: [
      "seminar", "lecture", "keynote", "fireside", "talk", "presentation",
      "セミナー", "講演", "講演会", "トーク",
    ],
  },
  {
    id: "networking",
    label: "Networking",
    keywords: [
      "networking", "mixer", "happy hour", "social hour", "speed networking",
      "交流会", "ネットワーキング",
    ],
  },
  {
    id: "social",
    label: "Social / Party",
    keywords: [
      "party", "reception", "dinner", "brunch", "picnic", "celebration", "shinnenkai",
      "bonenkai", "halloween", "holiday", "social", "game night", "game day", "mahjong",
      "pints", "potluck", "新年会", "忘年会", "パーティー", "懇親会", "花見",
    ],
  },
  {
    id: "meetup",
    label: "Meetup",
    keywords: ["meetup", "meet up", "user group", "community night", "monthly", "勉強会", "ミートアップ"],
  },
  {
    id: "pitch",
    label: "Pitch / Demo",
    keywords: ["pitch", "demo day", "demoday", "startup competition", "ピッチ", "デモデイ"],
  },
  {
    id: "class",
    label: "Class",
    keywords: ["class", "course", "lesson", "beginner", "intro to", "101", "入門", "初心者"],
  },
];

export const EVENT_TYPE_LABELS: Record<string, string> = Object.fromEntries([
  ...EVENT_TYPE_DEFINITIONS.map((definition) => [definition.id, definition.label]),
  ["other", "Other"],
]);

export function eventTypeLabel(id: string): string {
  return EVENT_TYPE_LABELS[id] ?? "Other";
}

/** Score title, description and categories; title wins ties. */
export function detectEventType(
  title: string,
  description?: string,
  categories: string[] = [],
): string {
  const titleText = normalize(title);
  const descriptionText = normalize(description ?? "");
  const categoryText = normalize(categories.join(" "));

  let best = "other";
  let bestScore = 0;

  for (const definition of EVENT_TYPE_DEFINITIONS) {
    let score = 0;
    for (const keyword of definition.keywords) {
      if (contains(titleText, keyword)) score += 6;
      if (contains(descriptionText, keyword)) score += 2;
      if (contains(categoryText, keyword)) score += 3;
    }
    if (score > bestScore) {
      best = definition.id;
      bestScore = score;
    }
  }

  return best;
}

export function eventTypeCounts(
  events: Array<{ eventType: string }>,
): Array<{ code: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, label: eventTypeLabel(code), count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function contains(haystack: string, keyword: string): boolean {
  if (!haystack) return false;
  if (/^[\x00-\x7F]+$/.test(keyword)) {
    return new RegExp(`(?:^|\\s)${escapeRegExp(keyword)}(?:$|\\s)`).test(haystack);
  }
  return haystack.includes(keyword);
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2010-\u2015-]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
