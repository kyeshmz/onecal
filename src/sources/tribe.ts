import { extractEvents, parseIcs } from "../ics/parse.js";
import type { RawEvent, TribeSourceConfig } from "../types.js";
import { fetchIcs } from "./fetch.js";

export interface SourceLoadOptions {
  timezone: string;
}

/** The Events Calendar exposes its archive as an iCalendar feed via ?ical=1. */
export function tribeFeedUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("ical", "1");
  return url.toString();
}

export async function loadTribeSource(
  source: TribeSourceConfig,
  options: SourceLoadOptions,
): Promise<RawEvent[]> {
  const text = await fetchIcs(tribeFeedUrl(source.baseUrl));
  return extractEvents(parseIcs(text), source.id, {
    timezone: options.timezone,
    ...(source.defaultLocation ? { defaultLocation: source.defaultLocation } : {}),
  });
}
