import { stableHash } from "../stable-hash.js";
import { parseFeed } from "../feed/feed.js";
import type { RawEvent, RssSourceConfig } from "../types.js";
import { fetchText } from "./fetch.js";
import type { SourceLoadOptions } from "./tribe.js";

const DAY_MS = 86_400_000;

export async function loadRssSource(
  source: RssSourceConfig,
  options: SourceLoadOptions,
): Promise<RawEvent[]> {
  const text = await fetchText(source.url, {
    accept:
      "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5",
  });

  const items = parseFeed(text, {
    timezone: options.timezone,
    baseUrl: source.url,
    usePublishedDate: source.usePublishedDate ?? false,
    durationHours: source.durationHours ?? 2,
  });

  const events: RawEvent[] = [];
  let skipped = 0;

  for (const item of items) {
    if (!item.start) {
      skipped += 1;
      continue;
    }

    const durationMs = (source.durationHours ?? 2) * 3_600_000;
    const end =
      item.end ??
      new Date(item.start.getTime() + (item.allDay ? DAY_MS : durationMs));

    const event: RawEvent = {
      uid: `rss-${stableHash(item.id)}`,
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
    console.warn(`[onecal] ${source.id}: skipped ${skipped} RSS item(s) without an event date`);
  }

  return events;
}
