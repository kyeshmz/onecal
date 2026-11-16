import { Aggregator, type SourceLoader } from "./aggregate.js";
import { eventTypeCounts } from "./event-types.js";
import { applyQueryFilters, readQueryFilters } from "./filters.js";
import { eventsToIcs } from "./ics/serialize.js";
import { languageCounts } from "./languages.js";
import type { CalendarEvent, Config } from "./types.js";

const CACHE_SECONDS = 900;

/** Static files: a Workers ASSETS binding in production, a folder on Node. */
export interface AppAssets {
  fetch(request: Request): Promise<Response>;
}

export interface AppOptions {
  config: Config;
  assets: AppAssets;
  now?: () => Date;
  loader?: SourceLoader;
}

export interface App {
  fetch(request: Request): Promise<Response>;
  aggregator: Aggregator;
}

/** Web-standard request handler shared by the Node server and the Worker. */
export function createApp(options: AppOptions): App {
  const { config, assets } = options;
  const aggregator = new Aggregator(config, {
    ...(options.now ? { now: options.now } : {}),
    ...(options.loader ? { loader: options.loader } : {}),
  });

  async function handle(request: Request): Promise<Response> {
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return json({ error: "method not allowed" }, 405, method);
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/healthz") {
        return json({ ok: true }, 200, method);
      }

      if (url.pathname === "/api/events") {
        const snapshot = await aggregator.getSnapshot();
        const filters = readQueryFilters(url, config);
        const events = applyQueryFilters(snapshot.events, filters);
        return json(
          {
            generatedAt: snapshot.generatedAt.toISOString(),
            count: events.length,
            excludedCount: snapshot.excludedCount,
            languages: languageCounts(events),
            types: eventTypeCounts(events),
            sources: snapshot.sources,
            watchlist: config.watchlist ?? [],
            events: events.map(serializeEvent),
          },
          200,
          method,
        );
      }

      if (url.pathname === "/api/sources") {
        const snapshot = await aggregator.getSnapshot();
        return json(
          {
            generatedAt: snapshot.generatedAt.toISOString(),
            sources: snapshot.sources,
            excludedCount: snapshot.excludedCount,
            watchlist: config.watchlist ?? [],
            languages: languageCounts(snapshot.events),
            types: eventTypeCounts(snapshot.events),
          },
          200,
          method,
        );
      }

      if (url.pathname === "/feed.ics" || url.pathname === "/calendar.ics") {
        const snapshot = await aggregator.getSnapshot();
        if (!snapshot.healthy && snapshot.events.length === 0) {
          return new Response(
            "No calendar sources are currently reachable. Try again shortly.\n",
            {
              status: 503,
              headers: {
                "content-type": "text/plain; charset=utf-8",
                "retry-after": "300",
                "cache-control": "no-store",
              },
            },
          );
        }

        const filters = readQueryFilters(url, config);
        const events = applyQueryFilters(snapshot.events, filters);
        const body = eventsToIcs(events, {
          calendarName: config.feedName ?? "OneCal",
          sourceCount: snapshot.sources.length,
        });

        return new Response(method === "HEAD" ? null : body, {
          headers: {
            "content-type": "text/calendar; charset=utf-8",
            "content-disposition": 'inline; filename="onecal.ics"',
            "cache-control": `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=3600`,
            "access-control-allow-origin": "*",
          },
        });
      }

      return assets.fetch(request);
    } catch (error) {
      console.error("[onecal] request failed", error);
      return json({ error: "internal server error" }, 500, method);
    }
  }

  return { fetch: handle, aggregator };
}

function json(payload: unknown, status: number, method: string): Response {
  const body = JSON.stringify(payload, null, 2);
  return new Response(method === "HEAD" ? null : body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function serializeEvent(event: CalendarEvent): Record<string, unknown> {
  return {
    id: event.id,
    title: event.title,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    allDay: event.allDay,
    status: event.status,
    language: event.language,
    eventType: event.eventType,
    sources: event.sources,
    ...(event.description ? { description: event.description } : {}),
    ...(event.location ? { location: event.location } : {}),
    ...(event.url ? { url: event.url } : {}),
    ...(event.organizer ? { organizer: event.organizer } : {}),
    ...(event.categories.length > 0 ? { categories: event.categories } : {}),
  };
}
