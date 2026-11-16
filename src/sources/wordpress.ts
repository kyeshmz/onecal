import { cleanText } from "../ics/parse.js";
import type { FeedItem } from "../feed/feed.js";
import type { RawEvent, WordpressSourceConfig } from "../types.js";
import { feedItemsToRawEvents, prepareFeedItems } from "./feed-items.js";
import { fetchText } from "./fetch.js";
import type { SourceLoadOptions } from "./tribe.js";

interface WordPressPost {
  id?: unknown;
  link?: unknown;
  date?: unknown;
  title?: { rendered?: unknown };
  excerpt?: { rendered?: unknown };
}

/**
 * Discover posts from a WordPress REST API, then read each post's schema.org
 * Event data. This is how Funcheap exposes far more events than its 10-item RSS.
 */
export async function loadWordpressSource(
  source: WordpressSourceConfig,
  options: SourceLoadOptions,
): Promise<RawEvent[]> {
  const base = source.baseUrl.replace(/\/+$/, "");
  const perPage = source.perPage ?? 30;
  const url = `${base}/wp-json/wp/v2/posts?per_page=${perPage}&_fields=id,link,date,title,excerpt`;

  const body = await fetchText(url, { accept: "application/json" });
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`${url} did not return JSON`);
  }
  if (!Array.isArray(payload)) throw new Error(`${url} did not return a post list`);

  const items: FeedItem[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const post = entry as WordPressPost;

    const link = textValue(post.link);
    const title = cleanText(textValue(post.title?.rendered) ?? "");
    if (!link || !title) continue;

    const item: FeedItem = {
      id: textValue(post.id) ?? link,
      title,
      link,
      allDay: false,
      categories: [],
    };

    const excerpt = cleanText(textValue(post.excerpt?.rendered) ?? "");
    if (excerpt) item.description = excerpt;

    const published = parseDate(textValue(post.date));
    if (published) item.published = published;

    items.push(item);
  }

  const prepared = await prepareFeedItems(items, {
    timezone: options.timezone,
    enrich: source.enrich ?? false,
    freeOnly: source.freeOnly ?? false,
    durationHours: source.durationHours ?? 2,
  });

  return feedItemsToRawEvents(prepared, source, {
    timezone: options.timezone,
    durationHours: source.durationHours ?? 2,
  });
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
