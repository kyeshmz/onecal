export type SourceType = "ics" | "luma" | "tribe";

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

export type SourceConfig = IcsSourceConfig | LumaSourceConfig | TribeSourceConfig;

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
  /** Applied to every feed/API response unless overridden by query params. */
  languages?: LanguageFilterConfig;
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
  /** True when at least one source returned events. */
  healthy: boolean;
}
