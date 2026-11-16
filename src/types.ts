export type SourceType = "ics" | "luma" | "partiful" | "rss" | "tribe";

export interface SourceBase {
  /** Stable id used in URLs, UIDs and the UI. */
  id: string;
  /** Human readable name shown in the UI and inside calendar entries. */
  label: string;
  /** Accent colour for the UI. */
  color?: string;
  enabled?: boolean;
  /** Fallback venue when a feed omits LOCATION. */
  defaultLocation?: string;
  /** Force a language for this source instead of auto-detecting per event. */
  language?: string;
  /** Keep only events whose location contains one of these phrases. Empty keeps all. */
  locationIncludes?: string[];
}

export interface IcsSourceConfig extends SourceBase {
  type: "ics";
  /** Any public iCalendar feed, including Google Calendar, Meetup, Eventbrite and Proton. */
  url: string;
}

export interface LumaSourceConfig extends SourceBase {
  type: "luma";
  /** Luma calendar id, e.g. cal-XXXXXXXXXXXXXXX. */
  calendarId?: string;
  /** A Luma calendar page (lu.ma/<slug>), a Luma ICS URL, or a personal webcal feed. */
  url?: string;
}

export interface TribeSourceConfig extends SourceBase {
  type: "tribe";
  /** The Events Calendar archive URL, e.g. https://www.usajapan.org/events/. */
  baseUrl: string;
}

export interface RssSourceConfig extends SourceBase {
  type: "rss";
  /** RSS 2.0, Atom, or JSON Feed URL. */
  url: string;
  /** Fall back to the item's publication date when no event date is present. */
  usePublishedDate?: boolean;
  /** Duration for items without an explicit end (hours). */
  durationHours?: number;
}

export interface PartifulSourceConfig extends SourceBase {
  type: "partiful";
  /** Partiful explore region: SF, NYC or LA. Defaults to SF. */
  region?: string;
  /** Defaults to https://partiful.com/explore. */
  url?: string;
}

export type SourceConfig =
  | IcsSourceConfig
  | LumaSourceConfig
  | TribeSourceConfig
  | RssSourceConfig
  | PartifulSourceConfig;

export interface WindowConfig {
  daysBack?: number;
  daysAhead?: number;
}

export interface LanguageFilterConfig {
  /** Only keep these languages. Empty means every language. */
  include?: string[];
  /** Drop these languages. */
  exclude?: string[];
}

export interface FiltersConfig {
  /** Extra phrases to drop, on top of the built-in members-only rules. */
  excludeKeywords?: string[];
}

/** An organisation worth following that has no public calendar feed yet. */
export interface WatchEntry {
  label: string;
  url: string;
  contact?: string;
  note: string;
}

export interface Config {
  feedName?: string;
  /** IANA timezone used for floating times and date-only output. */
  timezone?: string;
  window?: WindowConfig;
  cacheTtlSeconds?: number;
  /** Background refresh cadence. 0 disables the timer. */
  refreshIntervalSeconds?: number;
  /** Applied to every feed/API response unless overridden by query params. */
  languages?: LanguageFilterConfig;
  /** Content exclusions such as members-only events. */
  filters?: FiltersConfig;
  /** Organisations with no machine-readable calendar, surfaced in the UI and CLI. */
  watchlist?: WatchEntry[];
  sources: SourceConfig[];
}

export type EventStatus = "CONFIRMED" | "TENTATIVE" | "CANCELLED";

/** An event as read from a single source, before de-duplication. */
export interface RawEvent {
  /** UID from the source feed (or a content hash when the feed omits one). */
  uid: string;
  title: string;
  description?: string;
  location?: string;
  url?: string;
  start: Date;
  end: Date;
  allDay: boolean;
  status: EventStatus;
  organizer?: string;
  categories: string[];
  /** Recurrence rule, expanded by the aggregator within its window. */
  rrule?: string;
  exdates: Date[];
  /** Set on exception instances that override a recurring master. */
  recurrenceId?: Date;
  sourceId: string;
}

export interface SourceRef {
  id: string;
  label: string;
  color: string;
  /** Source platform, e.g. luma, tribe, ics or rss. */
  platform: SourceType;
}

/** A de-duplicated event ready for output. */
export interface CalendarEvent {
  /** Stable iCalendar UID. */
  id: string;
  /** Native UID of the primary source. */
  uid: string;
  title: string;
  description?: string;
  location?: string;
  url?: string;
  start: Date;
  end: Date;
  allDay: boolean;
  status: EventStatus;
  organizer?: string;
  categories: string[];
  /** Detected primary language of the event (BCP-47-ish code). */
  language: string;
  sources: SourceRef[];
}

export interface SourceHealth {
  id: string;
  label: string;
  type: SourceType;
  color: string;
  ok: boolean;
  eventCount: number;
  fetchedAt: string;
  fromCache: boolean;
  stale: boolean;
  error?: string;
}

export interface Snapshot {
  generatedAt: Date;
  events: CalendarEvent[];
  sources: SourceHealth[];
  /** Events removed by content filters (members-only by default). */
  excludedCount: number;
  /** True when at least one source returned events. */
  healthy: boolean;
}
