import {
  extractJsonLdEvent,
  parseLooseDate,
  type FeedItem,
  type JsonLdEventDetails,
} from "../feed/feed.js";
import { stableHash } from "../stable-hash.js";
import type { RawEvent } from "../types.js";
import { fetchHtml } from "./fetch.js";

const DAY_MS = 86_400_000;
const DETAIL_TTL_MS = 6 * 3_600_000;
const DETAIL_FAILURE_TTL_MS = 15 * 60_000;
const PAGE_CONCURRENCY = 4;

const detailCache = new Map<string, { expiresAt: number; event: JsonLdEventDetails | null }>();

export interface FeedItemsOptions {
  timezone: string;
  enrich?: boolean;
  freeOnly?: boolean;
  durationHours?: number;
}

export interface FeedEventSource {
  id: string;
  defaultLocation?: string;
}

/** Normalise feed items, optionally enrich them from each event page, then free-filter. */
export async function prepareFeedItems(
  items: FeedItem[],
  options: FeedItemsOptions,
): Promise<FeedItem[]> {
  const normalized = items.map((item) => ({ ...item, title: stripDatePrefix(item.title) }));

  let result = normalized;
  if (options.enrich) {
    result = (
      await mapLimit(normalized, PAGE_CONCURRENCY, (item) => enrichItem(item, options))
    ).filter((item): item is FeedItem => item !== null);
  }

  if (options.freeOnly) {
    result = result.filter(
      (item) => item.free === true || (item.free === undefined && looksFree(item)),
    );
  }

  return result;
}

export function feedItemsToRawEvents(
  items: FeedItem[],
  source: FeedEventSource,
  options: { timezone: string; durationHours?: number },
): RawEvent[] {
  const events: RawEvent[] = [];
  let skipped = 0;

  for (const item of items) {
    if (!item.start) {
      skipped += 1;
      continue;
    }

    const durationMs = (options.durationHours ?? 2) * 3_600_000;
    const end =
      item.end ??
      new Date(item.start.getTime() + (item.allDay ? DAY_MS : durationMs));

    const event: RawEvent = {
      uid: `feed-${stableHash(item.id)}`,
      title: item.title,
      start: item.start,
      end,
      allDay: item.allDay,
      status: "CONFIRMED",
      categories: item.categories,
      exdates: [],
      sourceId: source.id,
    };

    if (item.description) event.description = item.description;
    const location = item.location ?? source.defaultLocation;
    if (location) event.location = location;
    if (item.link) event.url = item.link;

    events.push(event);
  }

  if (skipped > 0) {
    console.warn(`[onecal] ${source.id}: skipped ${skipped} feed item(s) without an event date`);
  }

  return events;
}

/** Strip a leading "12/12/26:" date that some event feeds put in titles. */
export function stripDatePrefix(title: string): string {
  return title.replace(/^\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*:\s*/, "").trim();
}

async function enrichItem(
  item: FeedItem,
  options: FeedItemsOptions,
): Promise<FeedItem | null> {
  if (!item.link) return item;

  const details = await fetchEventDetails(item.link);
  if (!details) return item;

  const next: FeedItem = { ...item };

  if (details.name) next.title = details.name;
  if (details.description && details.description.length > (next.description?.length ?? 0)) {
    next.description = details.description;
  }
  if (details.location) next.location = details.location;

  if (details.startDate) {
    const parsed = parseLooseDate(details.startDate, options.timezone);
    if (parsed) {
      next.start = parsed.date;
      next.allDay = parsed.allDay;
      next.end = undefined;
    }
  }
  if (details.endDate) {
    const parsed = parseLooseDate(details.endDate, options.timezone);
    if (parsed) next.end = parsed.date;
  }

  if (details.isFree !== undefined) next.free = details.isFree;
  return next;
}

async function fetchEventDetails(url: string): Promise<JsonLdEventDetails | null> {
  const cached = detailCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.event;

  try {
    const html = await fetchHtml(url, { headers: { referer: new URL(url).origin + "/" } });
    const event = extractJsonLdEvent(html) ?? null;
    detailCache.set(url, { expiresAt: Date.now() + DETAIL_TTL_MS, event });
    return event;
  } catch {
    detailCache.set(url, { expiresAt: Date.now() + DETAIL_FAILURE_TTL_MS, event: null });
    return null;
  }
}

function looksFree(item: FeedItem): boolean {
  const text = `${item.title} ${item.description ?? ""}`.toLowerCase();
  return /\bfree\b/.test(text) || text.includes("no cover") || text.includes("free admission");
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}
