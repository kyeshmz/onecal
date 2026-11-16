import { extractEvents, parseIcs } from "../ics/parse.js";
import type { IcsSourceConfig, RawEvent, SourceConfig } from "../types.js";
import { fetchIcs } from "./fetch.js";
import { loadLumaSource } from "./luma.js";
import { loadPartifulSource } from "./partiful.js";
import { loadRssSource } from "./rss.js";
import { loadStaticSource } from "./static.js";
import { loadTribeSource, type SourceLoadOptions } from "./tribe.js";
import { loadWordpressSource } from "./wordpress.js";

export type { SourceLoadOptions };

export async function loadSourceEvents(
  source: SourceConfig,
  options: SourceLoadOptions,
): Promise<RawEvent[]> {
  switch (source.type) {
    case "ics":
      return loadIcsSource(source, options);
    case "luma":
      return loadLumaSource(source, options);
    case "partiful":
      return loadPartifulSource(source, options);
    case "rss":
      return loadRssSource(source, options);
    case "tribe":
      return loadTribeSource(source, options);
    case "static":
      return loadStaticSource(source);
    case "wordpress":
      return loadWordpressSource(source, options);
  }
}

async function loadIcsSource(
  source: IcsSourceConfig,
  options: SourceLoadOptions,
): Promise<RawEvent[]> {
  const text = await fetchIcs(source.url);
  return extractEvents(parseIcs(text), source.id, {
    timezone: options.timezone,
    ...(source.defaultLocation ? { defaultLocation: source.defaultLocation } : {}),
  });
}
