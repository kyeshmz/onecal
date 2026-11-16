import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { createApp, type AppAssets } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import type { Config } from "./types.js";

const WEB_DIR = resolve(import.meta.dirname, "..", "web");
const PORT = Number(process.env.PORT ?? 3000);

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/favicon.svg": { file: "favicon.svg", type: "image/svg+xml" },
};

const assets: AppAssets = {
  async fetch(request) {
    const url = new URL(request.url);
    const asset = STATIC_FILES[url.pathname];
    if (!asset) {
      return new Response("Not found\n", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    try {
      const body = await readFile(resolve(WEB_DIR, asset.file));
      return new Response(body, {
        headers: { "content-type": asset.type, "cache-control": "no-cache" },
      });
    } catch {
      return new Response("Asset not found\n", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  },
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

const app = createApp({ config, assets });

const refreshSeconds = config.refreshIntervalSeconds ?? 300;
if (refreshSeconds > 0) {
  const refresh = (): void => {
    void app.aggregator.getSnapshot({ force: true }).catch((error) => {
      console.error("[onecal] background refresh failed", error);
    });
  };

  void refresh();
  const timer = setInterval(refresh, refreshSeconds * 1000);
  timer.unref();
}

function toRequest(request: IncomingMessage): Request {
  const host = request.headers.host ?? "localhost";
  const url = new URL(request.url ?? "/", `http://${host}`);
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (typeof value === "string") headers.set(key, value);
  }

  return new Request(url, { method: request.method ?? "GET", headers });
}

async function sendResponse(
  response: Response,
  target: ServerResponse,
  headOnly: boolean,
): Promise<void> {
  target.statusCode = response.status;
  response.headers.forEach((value, key) => {
    target.setHeader(key, value);
  });

  if (headOnly || !response.body) {
    target.end();
    return;
  }

  target.end(Buffer.from(await response.arrayBuffer()));
}

const server = createServer(async (request, response) => {
  try {
    const webRequest = toRequest(request);
    const webResponse = await app.fetch(webRequest);
    await sendResponse(webResponse, response, request.method === "HEAD");
  } catch (error) {
    console.error("[onecal] request failed", error);
    if (response.headersSent) {
      response.end();
      return;
    }
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "internal server error" }));
  }
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
  if (refreshSeconds > 0) {
    console.log(`[onecal] auto-refresh every ${refreshSeconds}s`);
  }
});

export { server };
