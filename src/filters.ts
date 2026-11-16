import { applyLanguageFilter, normalizeCodes } from "./languages.js";
import type { CalendarEvent, Config, LanguageFilterConfig } from "./types.js";

export interface QueryFilters {
  sources: string[];
  q: string;
  languages: LanguageFilterConfig;
  types: string[];
}

/** Read ?source=, ?lang=, ?excludeLang= and ?q= from a request, merged with config defaults. */
export function readQueryFilters(url: URL, config: Config): QueryFilters {
  const requestedSources = listParam(url, "source", false);
  const requestedInclude = listParam(url, "lang");
  const requestedExclude = listParam(url, "excludeLang");

  const include =
    requestedInclude.length > 0 ? requestedInclude : normalizeCodes(config.languages?.include);
  const exclude = [
    ...new Set([...normalizeCodes(config.languages?.exclude), ...requestedExclude]),
  ];

  return {
    sources: requestedSources,
    q: (url.searchParams.get("q") ?? "").trim().toLowerCase(),
    languages: { include, exclude },
    types: listParam(url, "type"),
  };
}

export function applyQueryFilters(events: CalendarEvent[], filters: QueryFilters): CalendarEvent[] {
  const languageFiltered = applyLanguageFilter(events, filters.languages);
  const sourceFilter = new Set(filters.sources);

  return languageFiltered.filter((event) => {
    if (sourceFilter.size > 0 && !event.sources.some((source) => sourceFilter.has(source.id))) {
      return false;
    }
    if ((filters.types ?? []).length > 0 && !filters.types.includes(event.eventType)) {
      return false;
    }
    if (filters.q && !matchesQuery(event, filters.q)) return false;
    return true;
  });
}

function matchesQuery(event: CalendarEvent, query: string): boolean {
  const haystack = [
    event.title,
    event.description,
    event.location,
    event.organizer,
    ...event.categories,
    ...event.sources.map((source) => source.label),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function listParam(url: URL, name: string, lowercase = true): string[] {
  return [
    ...new Set(
      url.searchParams
        .getAll(name)
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => (lowercase ? value.toLowerCase() : value)),
    ),
  ];
}
