import { parseFeed } from "../feed/feed.js";
import type { RawEvent, RssSourceConfig } from "../types.js";
import { feedItemsToRawEvents, prepareFeedItems, stripDatePrefix } from "./feed-items.js";
import { fetchText } from "./fetch.js";
import type { SourceLoadOptions } from "./tribe.js";

export { stripDatePrefix };

export async function loadRssSource(
  source: RssSourceConfig,
  options: SourceLoadOptions,
): Promise<RawEvent[]> {
  const text = await fetchText(source.url, {
    accept:
      "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5",
  });

  const parsed = parseFeed(text, {
    timezone: options.timezone,
    baseUrl: source.url,
    usePublishedDate: source.usePublishedDate ?? false,
    durationHours: source.durationHours ?? 2,
  });

  const items = await prepareFeedItems(parsed, {
    timezone: options.timezone,
    enrich: source.enrich ?? false,
    freeOnly: source.freeOnly ?? false,
    durationHours: source.durationHours ?? 2,
  });

  return feedItemsToRawEvents(items, source, {
    timezone: options.timezone,
    durationHours: source.durationHours ?? 2,
  });
}
