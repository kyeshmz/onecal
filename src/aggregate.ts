import { createHash } from "node:crypto";
import { applyContentFilters, buildExcludeKeywords } from "./content-filters.js";
import { applyLanguageFilter, detectEventLanguage } from "./languages.js";
import { expandSourceEvents } from "./recur.js";
import { describeError } from "./sources/fetch.js";
import { loadSourceEvents, type SourceLoadOptions } from "./sources/index.js";
import { withinWindow } from "./time.js";
import type {
  CalendarEvent,
  Config,
  RawEvent,
  Snapshot,
  SourceConfig,
  SourceHealth,
  SourceRef,
} from "./types.js";

const DEFAULT_COLOR = "#5b6cff";
const MS_PER_DAY = 86_400_000;

export type SourceLoader = (source: SourceConfig, options: SourceLoadOptions) => Promise<RawEvent[]>;

export interface AggregatorOptions {
  now?: () => Date;
  /** Injection point for tests. */
  loader?: SourceLoader;
}

export interface SnapshotOptions {
  /** Skip the TTL and refetch every source (used by the background refresher). */
  force?: boolean;
}

interface CacheEntry {
  events: RawEvent[];
  /** Last successful fetch. */
  fetchedAt: number;
  /** Last attempt, successful or not, used for TTL back-off. */
  lastAttemptAt: number;
  ok: boolean;
  error?: string;
}

type LanguageEvent = RawEvent & { language: string };

export class Aggregator {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly now: () => Date;
  private readonly loader: SourceLoader;
  private refreshing: Promise<Snapshot> | null = null;

  constructor(
    private readonly config: Config,
    options: AggregatorOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.loader = options.loader ?? loadSourceEvents;
  }

  get timezone(): string {
    return this.config.timezone ?? "UTC";
  }

  async getSnapshot(options: SnapshotOptions = {}): Promise<Snapshot> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.build(options.force ?? false).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async build(force: boolean): Promise<Snapshot> {
    const now = this.now();
    const enabled = this.config.sources.filter((source) => source.enabled !== false);
    const ttlMs = (this.config.cacheTtlSeconds ?? 900) * 1000;
    const refreshed = new Set<string>();

    await Promise.all(
      enabled.map(async (source) => {
        const cached = this.cache.get(source.id);
        if (!force && cached && now.getTime() - cached.lastAttemptAt < ttlMs) return;

        refreshed.add(source.id);
        try {
          const events = await this.loader(source, { timezone: this.timezone });
          this.cache.set(source.id, {
            events,
            fetchedAt: now.getTime(),
            lastAttemptAt: now.getTime(),
            ok: true,
          });
        } catch (error) {
          const message = describeError(error);
          console.error(`[onecal] ${source.id}: ${message}`);
          this.cache.set(source.id, {
            events: cached?.events ?? [],
            fetchedAt: cached?.fetchedAt ?? now.getTime(),
            lastAttemptAt: now.getTime(),
            ok: false,
            error: message,
          });
        }
      }),
    );

    const daysBack = this.config.window?.daysBack ?? 1;
    const daysAhead = this.config.window?.daysAhead ?? 180;
    const from = new Date(now.getTime() - daysBack * MS_PER_DAY);
    const to = new Date(now.getTime() + daysAhead * MS_PER_DAY);

    const sourceMap = new Map(enabled.map((source) => [source.id, source]));
    const raw: LanguageEvent[] = [];

    for (const source of enabled) {
      const entry = this.cache.get(source.id);
      if (!entry) continue;

      const expanded = expandSourceEvents(entry.events, {
        from,
        to,
        timezone: this.timezone,
      });

      for (const event of expanded) {
        if (event.status === "CANCELLED") continue;
        if (!withinWindow(event.start, event.end, from, to)) continue;
        raw.push({
          ...event,
          language: detectEventLanguage(event.title, event.description, source.language),
        });
      }
    }

    const merged = mergeEvents(raw, sourceMap);
    const content = applyContentFilters(merged, buildExcludeKeywords(this.config.filters));
    const events = applyLanguageFilter(content.events, this.config.languages ?? {});
    events.sort((left, right) => left.start.getTime() - right.start.getTime() || left.title.localeCompare(right.title));

    const sources: SourceHealth[] = enabled.map((source) => {
      const entry = this.cache.get(source.id);
      return {
        id: source.id,
        label: source.label,
        type: source.type,
        color: source.color ?? DEFAULT_COLOR,
        ok: entry?.ok ?? false,
        eventCount: entry?.events.length ?? 0,
        fetchedAt: new Date(entry?.fetchedAt ?? now).toISOString(),
        fromCache: Boolean(entry) && !refreshed.has(source.id),
        stale: Boolean(entry && !entry.ok && entry.events.length > 0),
        ...(entry?.error ? { error: entry.error } : {}),
      };
    });

    return {
      generatedAt: now,
      events,
      sources,
      excludedCount: content.excluded,
      healthy: sources.some((source) => source.ok) || events.length > 0,
    };
  }
}

export function mergeEvents(
  events: LanguageEvent[],
  sourceMap: Map<string, SourceConfig>,
): CalendarEvent[] {
  const groups: LanguageEvent[][] = [];
  const byKey = new Map<string, number[]>();

  for (const event of events) {
    const key = mergeKey(event);
    const candidates = byKey.get(key);
    const match = candidates?.find((index) => compatibleLocation(groups[index]![0]!, event));

    if (match !== undefined) {
      groups[match]!.push(event);
      continue;
    }

    const index = groups.push([event]) - 1;
    if (candidates) candidates.push(index);
    else byKey.set(key, [index]);
  }

  return groups.map((group) => mergeGroup(group, sourceMap));
}

function mergeGroup(group: LanguageEvent[], sourceMap: Map<string, SourceConfig>): CalendarEvent {
  const [base] = group;
  if (!base) throw new Error("cannot merge an empty group");

  const sources: SourceRef[] = [];
  const seenSources = new Set<string>();
  for (const event of group) {
    if (seenSources.has(event.sourceId)) continue;
    seenSources.add(event.sourceId);
    const config = sourceMap.get(event.sourceId);
    sources.push({
      id: event.sourceId,
      label: config?.label ?? event.sourceId,
      color: config?.color ?? DEFAULT_COLOR,
      platform: config?.type ?? "ics",
    });
  }

  const description = longest(group.map((event) => event.description).filter(isPresent));
  const location = group.find((event) => event.location)?.location;
  const url = group.find((event) => event.url)?.url;
  const organizer = group.find((event) => event.organizer)?.organizer;
  const title = group.reduce((best, event) => (event.title.length > best.length ? event.title : best), base.title);
  const end = group.reduce(
    (latest, event) => (event.end.getTime() > latest.getTime() ? event.end : latest),
    base.end,
  );
  const categories = [...new Set(group.flatMap((event) => event.categories))];
  const status = group.some((event) => event.status === "CONFIRMED") ? "CONFIRMED" : base.status;

  return {
    id: `onecal-${hash(`${base.sourceId}|${base.uid}`)}@onecal`,
    uid: base.uid,
    title,
    start: base.start,
    end,
    allDay: base.allDay,
    status,
    categories,
    language: base.language,
    sources,
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    ...(url ? { url } : {}),
    ...(organizer ? { organizer } : {}),
  };
}

function mergeKey(event: LanguageEvent): string {
  return [
    normalizeTitle(event.title),
    Math.floor(event.start.getTime() / 60_000),
    event.allDay ? "d" : "t",
  ].join("|");
}

function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeLocation(location: string): string {
  return location.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Same title + same minute is not enough if both feeds name incompatible venues. */
function compatibleLocation(left: LanguageEvent, right: LanguageEvent): boolean {
  if (!left.location || !right.location) return true;
  const a = normalizeLocation(left.location);
  const b = normalizeLocation(right.location);
  if (!a || !b) return true;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  const tokens = new Set(a.split(" ").filter((token) => token.length > 2));
  return b.split(" ").some((token) => token.length > 2 && tokens.has(token));
}

function longest(values: string[]): string | undefined {
  return values.reduce<string | undefined>(
    (best, value) => (best === undefined || value.length > best.length ? value : best),
    undefined,
  );
}

function isPresent(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 20);
}
