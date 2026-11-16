import { extractEvents, parseIcs } from "../ics/parse.js";
import type { LumaSourceConfig, RawEvent } from "../types.js";
import type { SourceLoadOptions } from "./tribe.js";
import { fetchHtml, fetchIcs, normalizeFeedUrl } from "./fetch.js";

const resolvedCalendars = new Map<string, string>();

export function lumaFeedUrlForCalendar(calendarId: string): string {
  const id = calendarId.trim();
  if (!/^cal-[A-Za-z0-9]+$/.test(id)) {
    throw new Error(`invalid Luma calendar id "${calendarId}" (expected cal-XXXXXXXX)`);
  }
  const url = new URL("https://api.lu.ma/ics/get");
  url.searchParams.set("entity", "calendar");
  url.searchParams.set("id", id);
  return url.toString();
}

/**
 * Resolve a Luma source to an ICS URL. Accepts a calendar id, a direct Luma
 * ICS URL (including personal webcal feeds), or a single-calendar page such
 * as https://lu.ma/keizai.
 */
export async function resolveLumaFeedUrl(source: LumaSourceConfig): Promise<string> {
  if (source.calendarId) return lumaFeedUrlForCalendar(source.calendarId);

  if (!source.url) throw new Error(`Luma source "${source.id}" needs calendarId or url`);
  const normalized = normalizeFeedUrl(source.url);

  if (/\/ics\/get/i.test(normalized)) return normalized;

  const cached = resolvedCalendars.get(normalized);
  if (cached) return cached;

  const page = await fetchHtml(normalized);
  const ids = new Set<string>();
  const pattern = /"calendar":\{[^}]*?"api_id":"(cal-[A-Za-z0-9]+)"/g;
  for (const match of page.matchAll(pattern)) {
    if (match[1]) ids.add(match[1]);
  }

  if (ids.size === 1) {
    const feed = lumaFeedUrlForCalendar([...ids][0]!);
    resolvedCalendars.set(normalized, feed);
    return feed;
  }

  if (ids.size === 0) {
    throw new Error(
      `could not find a Luma calendar on ${normalized}; use "calendarId" instead`,
    );
  }

  throw new Error(
    `${normalized} lists ${ids.size} calendars; set "calendarId" to one of: ${[...ids]
      .slice(0, 8)
      .join(", ")}`,
  );
}

export async function loadLumaSource(
  source: LumaSourceConfig,
  options: SourceLoadOptions,
): Promise<RawEvent[]> {
  const feedUrl = await resolveLumaFeedUrl(source);
  const text = await fetchIcs(feedUrl);
  return extractEvents(parseIcs(text), source.id, {
    timezone: options.timezone,
    ...(source.defaultLocation ? { defaultLocation: source.defaultLocation } : {}),
  });
}
