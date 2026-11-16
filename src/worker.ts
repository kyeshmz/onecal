import { createApp, type App } from "./app.js";
import { validateConfig } from "./config-schema.js";
import { embeddedConfig } from "./generated/config.js";

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

const config = validateConfig(embeddedConfig, "embedded config");
let app: App | undefined;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!app) {
      app = createApp({
        config,
        assets: {
          fetch: (assetRequest) => env.ASSETS.fetch(assetRequest),
        },
      });
    }
    return app.fetch(request);
  },
};
