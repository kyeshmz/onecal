import { cleanText } from "../ics/parse.js";
import type { PartifulSourceConfig, RawEvent } from "../types.js";
import { fetchHtml } from "./fetch.js";
import { extractNextData } from "./next-data.js";
import type { SourceLoadOptions } from "./tribe.js";

const DEFAULT_URL = "https://partiful.com/explore";
const DEFAULT_REGION = "SF";
const TWO_HOURS = 2 * 3_600_000;

/**
 * Partiful has no official public API. Its /explore page ships the curated
 * regional feed in __NEXT_DATA__, which is what the web app renders.
 */
export async function loadPartifulSource(
  source: PartifulSourceConfig,
  _options: SourceLoadOptions,
): Promise<RawEvent[]> {
  const html = await fetchHtml(source.url ?? DEFAULT_URL);
  const sections = readSections(html);
  if (!sections) throw new Error("Partiful explore payload was not found");

  const region = source.region ?? DEFAULT_REGION;
  const section = findSection(sections, region);
  if (!section) {
    throw new Error(
      `Partiful region "${region}" not found (available: ${Object.keys(sections).join(", ")})`,
    );
  }

  const items = Array.isArray(section.items) ? section.items : [];
  const events: RawEvent[] = [];
  for (const item of items) {
    if (!isRecord(item) || !isRecord(item.event)) continue;
    const mapped = mapPartifulEvent(item.event, source.id);
    if (mapped) events.push(mapped);
  }

  if (events.length === 0) {
    console.warn(`[onecal] ${source.id}: no public events in Partiful region ${region}`);
  }

  return events;
}

/** Map a Partiful explore event object to an event. */
export function mapPartifulEvent(
  event: Record<string, unknown> | undefined,
  sourceId: string,
): RawEvent | undefined {
  if (!event) return undefined;
  if (event.isPublic === false) return undefined;

  const status = text(event.status);
  if (status && status !== "PUBLISHED") return undefined;

  const id = text(event.id);
  const start = parseDate(text(event.startDate));
  if (!id || !start) return undefined;

  const end = parseDate(text(event.endDate)) ?? new Date(start.getTime() + TWO_HOURS);
  const title = cleanText(text(event.title) ?? "") || "Untitled event";

  const result: RawEvent = {
    uid: `partiful-${id}`,
    title,
    start,
    end: end.getTime() > start.getTime() ? end : new Date(start.getTime() + TWO_HOURS),
    allDay: false,
    status: "CONFIRMED",
    categories: [],
    exdates: [],
    sourceId,
    url: `https://partiful.com/e/${id}`,
  };

  const description = cleanText(text(event.description) ?? "");
  if (description) result.description = description;

  const location = partifulLocation(event.locationInfo);
  if (location) result.location = location;

  return result;
}

function readSections(html: string): Record<string, Record<string, unknown>> | undefined {
  const data = extractNextData(html) as
    | { props?: { pageProps?: { trendingSections?: unknown } } }
    | undefined;
  const sections = data?.props?.pageProps?.trendingSections;
  if (!isRecord(sections)) return undefined;

  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(sections)) {
    if (isRecord(value)) result[key] = value;
  }
  return result;
}

function findSection(
  sections: Record<string, Record<string, unknown>>,
  region: string,
): Record<string, unknown> | undefined {
  const wanted = region.trim().toLowerCase();
  for (const [key, section] of Object.entries(sections)) {
    const sectionRegion = text(section.region);
    if (key.toLowerCase() === wanted || sectionRegion?.toLowerCase() === wanted) {
      return section;
    }
  }
  return undefined;
}

function partifulLocation(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;

  const maps = isRecord(value.mapsInfo) ? value.mapsInfo : undefined;
  const addressLines = stringArray(maps?.addressLines);
  if (addressLines.length > 0) return addressLines.join(", ");

  const displayLines = stringArray(value.displayAddressLines);
  if (displayLines.length > 0) return displayLines.join(", ");

  return (
    text(maps?.name) ??
    text(maps?.approximateLocation) ??
    text(value.name) ??
    text(value.approximateLocation)
  );
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
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
