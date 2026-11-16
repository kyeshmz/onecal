import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConfigError, validateConfig } from "./config-schema.js";
import type { Config } from "./types.js";

export { ConfigError, validateConfig } from "./config-schema.js";

export const DEFAULT_CONFIG_PATH = "config/calendars.json";

export function resolveConfigPath(explicit?: string): string {
  return resolve(explicit ?? process.env.ONECAL_CONFIG ?? DEFAULT_CONFIG_PATH);
}

export function loadConfig(explicitPath?: string): Config {
  const path = resolveConfigPath(explicitPath);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new ConfigError(`Cannot read config at ${path}: ${(error as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(`Config at ${path} is not valid JSON: ${(error as Error).message}`);
  }

  return validateConfig(parsed, path);
}
