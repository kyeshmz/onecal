import { stableHash } from "../stable-hash.js";
import { cleanText, extractEvents, parseIcs } from "../ics/parse.js";
import type { LumaSourceConfig, RawEvent } from "../types.js";
import { fetchHtml, fetchIcs, normalizeFeedUrl } from "./fetch.js";
import { extractNextData } from "./next-data.js";
import type { SourceLoadOptions } from "./tribe.js";

const resolvedCalendars = new Map<string, string>();
const TWO_HOURS = 2 * 3_600_000;

interface LumaInitialData {
  kind?: string;
  data?: {
    calendar?: { api_id?: unknown };
    place?: { api_id?: unknown };
    upcoming?: { entries?: Array<Record<string, unknown>> };
    events?: Array<Record<string, unknown>>;
  };
}

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

export function lumaDiscoverFeedUrl(discoverId: string): string {
  const id = discoverId.trim();
  if (!/^discplace-[A-Za-z0-9]+$/.test(id)) {
    throw new Error(`invalid Luma discover id "${discoverId}" (expected discplace-XXXXXXXX)`);
  }
  const url = new URL("https://api.lu.ma/ics/get");
  url.searchParams.set("entity", "discover");
  url.searchParams.set("id", id);
  return url.toString();
}

/**
 * Resolve a Luma source to an ICS URL. Accepts a calendar id, a direct Luma
 * ICS URL (including personal webcal feeds), or a single-calendar page.
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
    throw new Error(`could not find a Luma calendar on ${normalized}; use "calendarId" instead`);
  }

  throw new Error(
    `${normalized} lists ${ids.size} calendars; set "calendarId" to one of: ${[...ids]
      .slice(0, 8)
      .join(", ")}`,
  );
}

/**
 * Load a Luma source. Calendar pages and discover/city pages are read from
 * Luma's own page payload (the data behind its API); calendars with no
 * upcoming entries fall back to the public ICS export.
 */
export async function loadLumaSource(
  source: LumaSourceConfig,
  options: SourceLoadOptions,
): Promise<RawEvent[]> {
  if (source.calendarId) {
    return loadIcsFeed(lumaFeedUrlForCalendar(source.calendarId), source, options);
  }

  if (source.discoverId) {
    return loadIcsFeed(lumaDiscoverFeedUrl(source.discoverId), source, options);
  }

  if (!source.url) throw new Error(`Luma source "${source.id}" needs calendarId or url`);

  const normalized = normalizeFeedUrl(source.url);
  if (/\/ics\/get/i.test(normalized)) return loadIcsFeed(normalized, source, options);

  const html = await fetchHtml(normalized);
  const initial = readInitialData(html);

  if (initial?.kind === "discover-place") {
    const placeId = text(initial.data?.place?.api_id);
    if (placeId) {
      try {
        return await loadIcsFeed(lumaDiscoverFeedUrl(placeId), source, options);
      } catch (error) {
        console.warn(`[onecal] ${source.id}: discover ICS failed, using page data`, error);
      }
    }

    const entries = initial.data?.events ?? [];
    const events = mapEntries(entries, source.id);
    if (events.length === 0) {
      throw new Error(`Luma discover page ${normalized} returned no events`);
    }
    return events;
  }

  if (initial?.kind === "calendar") {
    const entries = initial.data?.upcoming?.entries ?? [];
    const events = mapEntries(entries, source.id);
    if (events.length > 0) return events;

    const calendarId = text(initial.data?.calendar?.api_id);
    if (calendarId) {
      return loadIcsFeed(lumaFeedUrlForCalendar(calendarId), source, options);
    }
  }

  const feedUrl = await resolveLumaFeedUrl({ ...source, url: normalized });
  return loadIcsFeed(feedUrl, source, options);
}

/** Map one Luma event object (from a calendar or discover payload) to an event. */
export function mapLumaEvent(
  event: Record<string, unknown>,
  sourceId: string,
  fallback: { start?: unknown; end?: unknown } = {},
): RawEvent | undefined {
  const start = parseDate(text(event.start_at) ?? text(fallback.start));
  if (!start) return undefined;

  const end = parseDate(text(event.end_at) ?? text(fallback.end)) ?? new Date(start.getTime() + TWO_HOURS);
  const title = cleanText(text(event.name) ?? text(event.title) ?? "") || "Untitled event";
  const apiId = text(event.api_id) ?? text(event.id);
  const uid = apiId ?? `luma-${stableHash(`${title}|${start.toISOString()}`)}`;

  const result: RawEvent = {
    uid,
    title,
    start,
    end: end.getTime() > start.getTime() ? end : new Date(start.getTime() + TWO_HOURS),
    allDay: false,
    status: "CONFIRMED",
    categories: [],
    exdates: [],
    sourceId,
  };

  const description = cleanText(text(event.description) ?? text(event.description_mirror) ?? "");
  if (description) result.description = description;

  const location = lumaLocation(event);
  if (location) result.location = location;

  const url = lumaUrl(event);
  if (url) result.url = url;

  return result;
}

function mapEntries(entries: Array<Record<string, unknown>>, sourceId: string): RawEvent[] {
  const events: RawEvent[] = [];
  for (const entry of entries) {
    const candidate = isRecord(entry.event) ? entry.event : entry;
    const mapped = mapLumaEvent(candidate, sourceId, {
      start: entry.start_at,
      end: entry.end_at,
    });
    if (mapped) events.push(mapped);
  }
  return events;
}

function readInitialData(html: string): LumaInitialData | undefined {
  const data = extractNextData(html) as
    | { props?: { pageProps?: { initialData?: LumaInitialData } } }
    | undefined;
  return data?.props?.pageProps?.initialData;
}

async function loadIcsFeed(
  feedUrl: string,
  source: LumaSourceConfig,
  options: SourceLoadOptions,
): Promise<RawEvent[]> {
  const text = await fetchIcs(feedUrl);
  return extractEvents(parseIcs(text), source.id, {
    timezone: options.timezone,
    ...(source.defaultLocation ? { defaultLocation: source.defaultLocation } : {}),
  });
}

function lumaLocation(event: Record<string, unknown>): string | undefined {
  const locationType = text(event.location_type);
  if (locationType === "online" || locationType === "virtual") return "Online";

  const geo = event.geo_address_info;
  if (isRecord(geo)) {
    const full = text(geo.full_address) ?? text(geo.address);
    if (full) return cleanText(full);
    const cityState = text(geo.city_state) ?? text(geo.city);
    if (cityState) return cleanText(cityState);
  }

  const virtual = event.virtual_info;
  if (isRecord(virtual)) return text(virtual.url);
  return undefined;
}

function lumaUrl(event: Record<string, unknown>): string | undefined {
  const value = text(event.url);
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://lu.ma/${value.replace(/^\/+/, "")}`;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
