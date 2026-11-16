import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Aggregator } from "./aggregate.js";
import { ConfigError, loadConfig } from "./config.js";
import { applyQueryFilters, readQueryFilters } from "./filters.js";
import { eventsToIcs } from "./ics/serialize.js";
import { languageCounts } from "./languages.js";
import type { CalendarEvent, Config } from "./types.js";

const WEB_DIR = resolve(import.meta.dirname, "..", "web");
const PORT = Number(process.env.PORT ?? 3000);
const TTL_SECONDS = 900;

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/favicon.svg": { file: "favicon.svg", type: "image/svg+xml" },
};

function loadRuntimeConfig(): Config {
  const config = loadConfig();
  if (process.env.ONECAL_TIMEZONE) config.timezone = process.env.ONECAL_TIMEZONE;
  if (process.env.ONECAL_FEED_NAME) config.feedName = process.env.ONECAL_FEED_NAME;
  return config;
}

let config: Config;
try {
  config = loadRuntimeConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`[onecal] ${error.message}`);
    process.exit(1);
  }
  throw error;
}

const aggregator = new Aggregator(config);

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const method = request.method ?? "GET";

  if (method !== "GET" && method !== "HEAD") {
    sendJson(response, 405, { error: "method not allowed" }, method);
    return;
  }

  if (url.pathname === "/healthz") {
    sendJson(response, 200, { ok: true }, method);
    return;
  }

  if (url.pathname === "/api/events") {
    const snapshot = await aggregator.getSnapshot();
    const filters = readQueryFilters(url, config);
    const events = applyQueryFilters(snapshot.events, filters);
    sendJson(
      response,
      200,
      {
        generatedAt: snapshot.generatedAt.toISOString(),
        count: events.length,
        languages: languageCounts(events),
        sources: snapshot.sources,
        watchlist: config.watchlist ?? [],
        events: events.map(serializeEvent),
      },
      method,
    );
    return;
  }

  if (url.pathname === "/api/sources") {
    const snapshot = await aggregator.getSnapshot();
    sendJson(
      response,
      200,
      {
        generatedAt: snapshot.generatedAt.toISOString(),
        sources: snapshot.sources,
        watchlist: config.watchlist ?? [],
        languages: languageCounts(snapshot.events),
      },
      method,
    );
    return;
  }

  if (url.pathname === "/feed.ics" || url.pathname === "/calendar.ics") {
    const snapshot = await aggregator.getSnapshot();
    if (!snapshot.healthy && snapshot.events.length === 0) {
      response.writeHead(503, {
        "content-type": "text/plain; charset=utf-8",
        "retry-after": "300",
        "cache-control": "no-store",
      });
      response.end("No calendar sources are currently reachable. Try again shortly.\n");
      return;
    }

    const filters = readQueryFilters(url, config);
    const events = applyQueryFilters(snapshot.events, filters);
    const body = eventsToIcs(events, {
      calendarName: config.feedName ?? "OneCal",
      sourceCount: snapshot.sources.length,
    });

    response.writeHead(200, {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="onecal.ics"',
      "cache-control": `public, max-age=${TTL_SECONDS}, stale-while-revalidate=3600`,
      "access-control-allow-origin": "*",
    });
    response.end(method === "HEAD" ? undefined : body);
    return;
  }

  const asset = STATIC_FILES[url.pathname];
  if (asset) {
    try {
      const body = await readFile(resolve(WEB_DIR, asset.file));
      response.writeHead(200, {
        "content-type": asset.type,
        "cache-control": "no-cache",
      });
      response.end(method === "HEAD" ? undefined : body);
    } catch {
      sendJson(response, 404, { error: "asset not found" }, method);
    }
    return;
  }

  sendJson(response, 404, { error: "not found" }, method);
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
  method: string,
): void {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  response.end(method === "HEAD" ? undefined : body);
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
    sources: event.sources,
    ...(event.description ? { description: event.description } : {}),
    ...(event.location ? { location: event.location } : {}),
    ...(event.url ? { url: event.url } : {}),
    ...(event.organizer ? { organizer: event.organizer } : {}),
    ...(event.categories.length > 0 ? { categories: event.categories } : {}),
  };
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error("[onecal] request failed", error);
    if (response.headersSent) {
      response.end();
      return;
    }
    sendJson(response, 500, { error: "internal server error" }, request.method ?? "GET");
  });
});

server.listen(PORT, () => {
  const host = process.env.HOST ?? "localhost";
  const feedUrl = `http://${host}:${PORT}/feed.ics`;
  console.log(`[onecal] ${config.feedName ?? "OneCal"} listening on http://${host}:${PORT}`);
  console.log(`[onecal] feed: ${feedUrl}`);
  console.log(
    `[onecal] sources: ${config.sources
      .filter((source) => source.enabled !== false)
      .map((source) => source.label)
      .join(", ")}`,
  );
});

export { server };
