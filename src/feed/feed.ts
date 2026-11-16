import { createHash } from "node:crypto";
import { cleanText } from "../ics/parse.js";
import { isValidTimeZone, zonedTimeToUtc } from "../time.js";
import { findChild, findChildren, findDescendants, parseXml, textOf, type XmlNode } from "./xml.js";

export interface FeedItem {
  id: string;
  title: string;
  link?: string;
  description?: string;
  published?: Date;
  start?: Date;
  end?: Date;
  allDay: boolean;
  location?: string;
  categories: string[];
}

export interface ParseFeedOptions {
  timezone: string;
  baseUrl?: string;
  /** Use the item publication date when the feed gives no event date. */
  usePublishedDate?: boolean;
  /** Duration for items without an explicit end. */
  durationHours?: number;
}

const DAY_MS = 86_400_000;

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export function parseFeed(raw: string, options: ParseFeedOptions): FeedItem[] {
  const trimmed = raw.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{")) return parseJsonFeed(trimmed, options);

  const root = parseXml(trimmed);
  const rssItems = findDescendants(root, "item");
  if (rssItems.length > 0) return rssItems.map((item) => parseRssItem(item, options));

  const atomEntries = findDescendants(root, "entry");
  if (atomEntries.length > 0) return atomEntries.map((entry) => parseAtomEntry(entry, options));

  return [];
}

function parseRssItem(item: XmlNode, options: ParseFeedOptions): FeedItem {
  const title = cleanText(textOf(findChild(item, "title"))) || "Untitled";
  const linkNode = findChild(item, "link");
  const link = resolveLink(textOf(linkNode) || linkNode?.attributes.href, options.baseUrl);
  const rawDescription = textOf(findChild(item, "encoded", "description", "summary", "content"));
  const published = parseAbsoluteDate(textOf(findChild(item, "pubdate", "published", "updated", "date")));

  const dates = resolveDates({
    title,
    rawDescription,
    startValue: textOf(findChild(item, "startdate", "start_date", "dtstart", "eventstart")),
    endValue: textOf(findChild(item, "enddate", "end_date", "dtend", "eventend")),
    published,
    location: cleanText(textOf(findChild(item, "location", "venue", "where"))),
    options,
  });

  const id =
    textOf(findChild(item, "guid", "id")) ||
    link ||
    hash(`${title}|${published?.toISOString() ?? ""}`);

  const result: FeedItem = { id, title, allDay: dates.allDay, categories: readCategories(item) };
  const description = cleanFeedHtml(rawDescription);
  if (description) result.description = description;
  if (link) result.link = link;
  if (published) result.published = published;
  if (dates.start) result.start = dates.start;
  if (dates.end) result.end = dates.end;
  if (dates.location) result.location = dates.location;
  return result;
}

function parseAtomEntry(entry: XmlNode, options: ParseFeedOptions): FeedItem {
  const title = cleanText(textOf(findChild(entry, "title"))) || "Untitled";

  const links = findChildren(entry, "link");
  const alternate =
    links.find((link) => !link.attributes.rel || link.attributes.rel === "alternate") ?? links[0];
  const link = resolveLink(
    alternate?.attributes.href ?? textOf(alternate) ?? links[0]?.attributes.href,
    options.baseUrl,
  );

  const rawDescription = textOf(findChild(entry, "content", "summary"));
  const published = parseAbsoluteDate(textOf(findChild(entry, "published", "updated")));

  const dates = resolveDates({
    title,
    rawDescription,
    startValue: textOf(findChild(entry, "startdate", "start_date", "dtstart", "eventstart")),
    endValue: textOf(findChild(entry, "enddate", "end_date", "dtend", "eventend")),
    published,
    location: cleanText(textOf(findChild(entry, "location", "venue", "where"))),
    options,
  });

  const id = textOf(findChild(entry, "id")) || link || hash(`${title}|${published?.toISOString() ?? ""}`);

  const result: FeedItem = { id, title, allDay: dates.allDay, categories: readCategories(entry) };
  const description = cleanFeedHtml(rawDescription);
  if (description) result.description = description;
  if (link) result.link = link;
  if (published) result.published = published;
  if (dates.start) result.start = dates.start;
  if (dates.end) result.end = dates.end;
  if (dates.location) result.location = dates.location;
  return result;
}

function parseJsonFeed(raw: string, options: ParseFeedOptions): FeedItem[] {
  const parsed = parseJsonLoose(raw);
  if (!parsed || typeof parsed !== "object") return [];

  const items = (parsed as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];

  const results: FeedItem[] = [];
  items.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const item = entry as Record<string, unknown>;
    const title = cleanText(stringValue(item.title) ?? "Untitled");
    const link = resolveLink(stringValue(item.url) ?? stringValue(item.external_url), options.baseUrl);
    const rawDescription =
      stringValue(item.content_html) ??
      stringValue(item.content_text) ??
      stringValue(item.summary) ??
      "";
    const published = parseAbsoluteDate(
      stringValue(item.date_published) ?? stringValue(item.date_modified) ?? "",
    );

    const dates = resolveDates({
      title,
      rawDescription,
      startValue: "",
      endValue: "",
      published,
      location: "",
      options,
    });

    const id = stringValue(item.id) ?? link ?? hash(`${title}|${index}`);
    const result: FeedItem = { id, title, allDay: dates.allDay, categories: readCategoriesFromJson(item) };
    const description = cleanFeedHtml(rawDescription);
    if (description) result.description = description;
    if (link) result.link = link;
    if (published) result.published = published;
    if (dates.start) result.start = dates.start;
    if (dates.end) result.end = dates.end;
    if (dates.location) result.location = dates.location;
    results.push(result);
  });

  return results;
}

interface DateInputs {
  title: string;
  rawDescription: string;
  startValue: string;
  endValue: string;
  published?: Date | undefined;
  location: string;
  options: ParseFeedOptions;
}

interface ResolvedDates {
  start?: Date;
  end?: Date;
  allDay: boolean;
  location?: string;
}

function resolveDates(input: DateInputs): ResolvedDates {
  const timezone = input.options.timezone;
  let start: Date | undefined;
  let end: Date | undefined;
  let allDay = false;
  let location = input.location || undefined;

  if (input.startValue) {
    const parsed = parseLooseDate(input.startValue, timezone);
    if (parsed) {
      start = parsed.date;
      allDay = parsed.allDay;
    }
  }

  if (!start) {
    const jsonld = extractJsonLdEvent(input.rawDescription);
    if (jsonld) {
      const parsedStart = jsonld.startDate ? parseLooseDate(jsonld.startDate, timezone) : undefined;
      if (parsedStart) {
        start = parsedStart.date;
        allDay = parsedStart.allDay;
      }
      if (jsonld.endDate) end = parseLooseDate(jsonld.endDate, timezone)?.date;
      if (!location && jsonld.location) location = jsonld.location;
    }
  }

  if (!start) {
    const timeTag = /<time[^>]+datetime=["']([^"']+)["']/i.exec(input.rawDescription);
    const parsed = timeTag?.[1] ? parseLooseDate(timeTag[1], timezone) : undefined;
    if (parsed) {
      start = parsed.date;
      allDay = parsed.allDay;
    }
  }

  if (!start) {
    const parsed = parseLooseDate(input.title, timezone) ?? parseLooseDate(input.rawDescription, timezone);
    if (parsed) {
      start = parsed.date;
      allDay = parsed.allDay;
    }
  }

  if (!start && input.options.usePublishedDate && input.published) {
    start = input.published;
    allDay = false;
  }

  if (input.endValue) {
    const parsed = parseLooseDate(input.endValue, timezone);
    if (parsed) end = parsed.date;
  }

  if (start && end && end.getTime() <= start.getTime()) end = undefined;
  if (start && !end) {
    end = new Date(
      start.getTime() +
        (allDay ? DAY_MS : (input.options.durationHours ?? 2) * 3_600_000),
    );
  }

  const result: ResolvedDates = { allDay };
  if (start) result.start = start;
  if (end) result.end = end;
  if (location) result.location = location;
  return result;
}

export interface ParsedDate {
  date: Date;
  allDay: boolean;
}

/** Parse ISO, Japanese, English and US-style dates. Bare dates are all-day. */
export function parseLooseDate(value: string, timezone: string): ParsedDate | undefined {
  const text = value.trim();
  if (!text) return undefined;

  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?)?/.exec(text);
  if (iso) {
    const [, year, month, day, hour, minute, second, zone] = iso;
    const time = hour
      ? { hour: Number(hour), minute: Number(minute ?? 0), second: Number(second ?? 0) }
      : undefined;
    if (time && zone) {
      const absolute = new Date(iso[0].replace(" ", "T"));
      if (!Number.isNaN(absolute.getTime())) return { date: absolute, allDay: false };
    }
    const parsed = buildDate(Number(year), Number(month), Number(day), time, timezone);
    if (parsed) return parsed;
  }

  const japanese = /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/.exec(text);
  if (japanese) {
    const timeMatch = /(\d{1,2}):(\d{2})/.exec(text);
    const time = timeMatch
      ? { hour: Number(timeMatch[1]), minute: Number(timeMatch[2]), second: 0 }
      : undefined;
    const parsed = buildDate(
      Number(japanese[1]),
      Number(japanese[2]),
      Number(japanese[3]),
      time,
      timezone,
    );
    if (parsed) return parsed;
  }

  const english =
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:[^\d]{0,10}(\d{1,2})(?::(\d{2}))?\s*(am|pm))?/i.exec(
      text,
    );
  if (english) {
    const month = MONTHS[(english[1] ?? "").slice(0, 3).toLowerCase()];
    const hour = english[4] ? Number(english[4]) : undefined;
    const minute = english[5] ? Number(english[5]) : 0;
    const meridiem = english[6]?.toLowerCase();
    const adjustedHour =
      hour === undefined
        ? undefined
        : meridiem === "pm" && hour < 12
          ? hour + 12
          : meridiem === "am" && hour === 12
            ? 0
            : hour;
    const parsed = month
      ? buildDate(
          Number(english[3]),
          month,
          Number(english[2]),
          adjustedHour === undefined ? undefined : { hour: adjustedHour, minute, second: 0 },
          timezone,
        )
      : undefined;
    if (parsed) return parsed;
  }

  const numeric =
    /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b(?:[^\d]{0,10}(\d{1,2}):(\d{2})\s*(am|pm)?)?/i.exec(text);
  if (numeric) {
    const hour = numeric[4] ? Number(numeric[4]) : undefined;
    const meridiem = numeric[6]?.toLowerCase();
    const adjustedHour =
      hour === undefined
        ? undefined
        : meridiem === "pm" && hour < 12
          ? hour + 12
          : meridiem === "am" && hour === 12
            ? 0
            : hour;
    const parsed = buildDate(
      Number(numeric[3]),
      Number(numeric[1]),
      Number(numeric[2]),
      adjustedHour === undefined ? undefined : { hour: adjustedHour, minute: Number(numeric[5] ?? 0), second: 0 },
      timezone,
    );
    if (parsed) return parsed;
  }

  return undefined;
}

function buildDate(
  year: number,
  month: number,
  day: number,
  time: { hour: number; minute: number; second: number } | undefined,
  timezone: string,
): ParsedDate | undefined {
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return undefined;
  }

  if (!time) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
    return { date, allDay: true };
  }

  if (time.hour < 0 || time.hour > 23 || time.minute < 0 || time.minute > 59) return undefined;
  const zone = isValidTimeZone(timezone) ? timezone : "UTC";
  return {
    date: zonedTimeToUtc({ year, month, day, hour: time.hour, minute: time.minute, second: time.second }, zone),
    allDay: false,
  };
}

function parseAbsoluteDate(value: string): Date | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

interface JsonLdEvent {
  startDate?: string;
  endDate?: string;
  location?: string;
}

function extractJsonLdEvent(raw: string): JsonLdEvent | undefined {
  const scripts = raw.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const script of scripts) {
    const event = findEventObject(parseJsonLoose(script[1] ?? ""));
    if (event) return toJsonLdEvent(event);
  }

  const direct = findEventObject(parseJsonLoose(raw));
  return direct ? toJsonLdEvent(direct) : undefined;
}

function findEventObject(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findEventObject(entry);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (type === "Event" || (Array.isArray(type) && type.includes("Event"))) return record;

  for (const key of ["@graph", "itemListElement", "item", "mainEntity", "subEvent"]) {
    const found = findEventObject(record[key]);
    if (found) return found;
  }
  return undefined;
}

function toJsonLdEvent(record: Record<string, unknown>): JsonLdEvent {
  const event: JsonLdEvent = {};
  const startDate = stringValue(record.startDate);
  const endDate = stringValue(record.endDate);
  const location = locationName(record.location);
  if (startDate) event.startDate = startDate;
  if (endDate) event.endDate = endDate;
  if (location) event.location = location;
  return event;
}

function locationName(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return locationName(value[0]);
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  if (typeof record.name === "string") return record.name;
  if (typeof record.address === "string") return record.address;
  if (record.address && typeof record.address === "object") {
    const address = record.address as Record<string, unknown>;
    const parts = [address.streetAddress, address.addressLocality, address.addressRegion].filter(
      (part): part is string => typeof part === "string",
    );
    if (parts.length > 0) return parts.join(", ");
  }
  return undefined;
}

function parseJsonLoose(value: string): unknown {
  const cleaned = value.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "").trim();
  if (!cleaned) return undefined;

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function readCategories(node: XmlNode): string[] {
  return findChildren(node, "category")
    .map((category) => cleanText(textOf(category) || category.attributes.term || ""))
    .filter(Boolean);
}

function readCategoriesFromJson(item: Record<string, unknown>): string[] {
  const categories = item.categories;
  if (!Array.isArray(categories)) return [];
  return categories
    .map((category) => (typeof category === "string" ? category : undefined))
    .filter((category): category is string => Boolean(category));
}

function resolveLink(value: string | undefined, baseUrl: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim(), baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function cleanFeedHtml(raw: string): string {
  return cleanText(raw.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " "));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}
