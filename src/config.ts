import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isValidTimeZone } from "./time.js";
import type {
  Config,
  FiltersConfig,
  LanguageFilterConfig,
  SourceConfig,
  SourceType,
  WatchEntry,
} from "./types.js";

export const DEFAULT_CONFIG_PATH = "config/calendars.json";
const SOURCE_TYPES: SourceType[] = ["ics", "luma", "partiful", "rss", "tribe"];

export class ConfigError extends Error {}

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

export function validateConfig(input: unknown, source = "config"): Config {
  if (!isRecord(input)) throw new ConfigError(`${source}: expected a JSON object`);
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    throw new ConfigError(`${source}: "sources" must be a non-empty array`);
  }

  const timezone = optionalString(input.timezone, `${source}: timezone`);
  if (timezone && !isValidTimeZone(timezone)) {
    throw new ConfigError(`${source}: unknown timezone "${timezone}"`);
  }

  const window = isRecord(input.window) ? input.window : {};
  const config: Config = {
    sources: input.sources.map((entry, index) => validateSource(entry, `${source}: sources[${index}]`)),
  };

  const feedName = optionalString(input.feedName, `${source}: feedName`);
  if (feedName) config.feedName = feedName;
  if (timezone) config.timezone = timezone;
  config.window = {
    daysBack: nonNegativeNumber(window.daysBack, `${source}: window.daysBack`, 1),
    daysAhead: nonNegativeNumber(window.daysAhead, `${source}: window.daysAhead`, 180),
  };
  config.cacheTtlSeconds = nonNegativeNumber(input.cacheTtlSeconds, `${source}: cacheTtlSeconds`, 900);
  config.refreshIntervalSeconds = nonNegativeNumber(
    input.refreshIntervalSeconds,
    `${source}: refreshIntervalSeconds`,
    300,
  );

  if (input.languages !== undefined) {
    config.languages = validateLanguages(input.languages, `${source}: languages`);
  }
  if (input.filters !== undefined) {
    config.filters = validateFilters(input.filters, `${source}: filters`);
  }
  if (input.watchlist !== undefined) {
    config.watchlist = validateWatchlist(input.watchlist, `${source}: watchlist`);
  }

  const ids = new Set<string>();
  for (const entry of config.sources) {
    if (ids.has(entry.id)) throw new ConfigError(`${source}: duplicate source id "${entry.id}"`);
    ids.add(entry.id);
  }

  return config;
}

function validateSource(input: unknown, where: string): SourceConfig {
  if (!isRecord(input)) throw new ConfigError(`${where}: expected an object`);

  const id = requiredString(input.id, `${where}: id`);
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
    throw new ConfigError(`${where}: id must be alphanumeric with dashes`);
  }
  const label = requiredString(input.label, `${where}: label`);
  const type = requiredString(input.type, `${where}: type`) as SourceType;
  if (!SOURCE_TYPES.includes(type)) {
    throw new ConfigError(`${where}: type must be one of ${SOURCE_TYPES.join(", ")}`);
  }

  const defaultLocation = optionalString(input.defaultLocation, `${where}: defaultLocation`);
  const language = optionalString(input.language, `${where}: language`)?.toLowerCase();
  const locationIncludes = stringList(input.locationIncludes, `${where}: locationIncludes`);

  const base = {
    id,
    label,
    type,
    color: optionalString(input.color, `${where}: color`) ?? "#5b6cff",
    enabled: validateEnabled(input.enabled, `${where}: enabled`),
    ...(locationIncludes.length > 0 ? { locationIncludes } : {}),
  };

  if (type === "ics") {
    return {
      ...base,
      type,
      url: requiredString(input.url, `${where}: url`),
      ...(defaultLocation ? { defaultLocation } : {}),
      ...(language ? { language } : {}),
    };
  }

  if (type === "luma") {
    const calendarId = optionalString(input.calendarId, `${where}: calendarId`);
    const url = optionalString(input.url, `${where}: url`);
    if (!calendarId && !url) {
      throw new ConfigError(`${where}: luma sources need "calendarId" or "url"`);
    }
    return {
      ...base,
      type,
      ...(calendarId ? { calendarId } : {}),
      ...(url ? { url } : {}),
      ...(defaultLocation ? { defaultLocation } : {}),
      ...(language ? { language } : {}),
    };
  }

  if (type === "rss") {
    return {
      ...base,
      type,
      url: requiredString(input.url, `${where}: url`),
      usePublishedDate: optionalBoolean(
        input.usePublishedDate,
        `${where}: usePublishedDate`,
        false,
      ),
      durationHours: positiveNumber(input.durationHours, `${where}: durationHours`, 2),
      ...(defaultLocation ? { defaultLocation } : {}),
      ...(language ? { language } : {}),
    };
  }

  if (type === "partiful") {
    return {
      ...base,
      type,
      region: optionalString(input.region, `${where}: region`) ?? "SF",
      url: optionalString(input.url, `${where}: url`) ?? "https://partiful.com/explore",
      ...(defaultLocation ? { defaultLocation } : {}),
      ...(language ? { language } : {}),
    };
  }

  return {
    ...base,
    type: "tribe",
    baseUrl: requiredString(input.baseUrl, `${where}: baseUrl`),
    ...(defaultLocation ? { defaultLocation } : {}),
    ...(language ? { language } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateEnabled(value: unknown, where: string): boolean {
  if (value === undefined) return true;
  if (typeof value !== "boolean") throw new ConfigError(`${where} must be true or false`);
  return value;
}

function validateLanguages(input: unknown, where: string): LanguageFilterConfig {
  if (!isRecord(input)) throw new ConfigError(`${where}: expected an object`);
  const result: LanguageFilterConfig = {};
  const include = stringList(input.include, `${where}.include`);
  const exclude = stringList(input.exclude, `${where}.exclude`);
  if (include.length > 0) result.include = include;
  if (exclude.length > 0) result.exclude = exclude;
  return result;
}

function validateFilters(input: unknown, where: string): FiltersConfig {
  if (!isRecord(input)) throw new ConfigError(`${where}: expected an object`);
  const excludeKeywords = stringList(input.excludeKeywords, `${where}.excludeKeywords`);
  return excludeKeywords.length > 0 ? { excludeKeywords } : {};
}

function validateWatchlist(input: unknown, where: string): WatchEntry[] {
  if (!Array.isArray(input)) throw new ConfigError(`${where}: expected an array`);

  return input.map((entry, index) => {
    if (!isRecord(entry)) throw new ConfigError(`${where}[${index}]: expected an object`);
    const url = requiredString(entry.url, `${where}[${index}].url`);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ConfigError(`${where}[${index}].url is not a valid URL`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ConfigError(`${where}[${index}].url must be http(s)`);
    }

    const contact = optionalString(entry.contact, `${where}[${index}].contact`);
    return {
      label: requiredString(entry.label, `${where}[${index}].label`),
      url: parsed.toString(),
      note: requiredString(entry.note, `${where}[${index}].note`),
      ...(contact ? { contact } : {}),
    };
  });
}

function stringList(value: unknown, where: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ConfigError(`${where} must be an array of strings`);
  return [
    ...new Set(
      value.map((entry, index) => requiredString(entry, `${where}[${index}]`).toLowerCase()),
    ),
  ];
}

function optionalString(value: unknown, where: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ConfigError(`${where} must be a string`);
  return value.trim();
}

function requiredString(value: unknown, where: string): string {
  const result = optionalString(value, where);
  if (!result) throw new ConfigError(`${where} is required`);
  return result;
}

function nonNegativeNumber(value: unknown, where: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ConfigError(`${where} must be a non-negative number`);
  }
  return value;
}

function positiveNumber(value: unknown, where: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${where} must be a positive number`);
  }
  return value;
}

function optionalBoolean(value: unknown, where: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new ConfigError(`${where} must be true or false`);
  return value;
}
