import { formatUtcTimestamp, partsInTimeZone, zonedTimeToUtc } from "./time.js";
import type { RawEvent } from "./types.js";

export interface ExpandOptions {
  /** Window start: occurrences before this are skipped (but still counted by COUNT). */
  from: Date;
  /** Stop expanding past this instant. */
  to: Date;
  /** IANA timezone used for wall-clock arithmetic across DST. */
  timezone: string;
  /** Max occurrences emitted per master event. */
  limit?: number;
}

interface RecurrenceRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: Date;
  byday?: number[];
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const BYDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const MAX_ITERATIONS = 20_000;

/** Expand RRULE masters within a window and drop overridden/excluded occurrences. */
export function expandSourceEvents(events: RawEvent[], options: ExpandOptions): RawEvent[] {
  const overrides = new Set<string>();
  for (const event of events) {
    if (event.recurrenceId) overrides.add(`${event.uid}|${event.recurrenceId.getTime()}`);
  }

  const expanded: RawEvent[] = [];
  for (const event of events) {
    if (event.recurrenceId) {
      expanded.push(event);
      continue;
    }
    for (const occurrence of expandEvent(event, options)) {
      if (overrides.has(`${event.uid}|${occurrence.start.getTime()}`)) continue;
      expanded.push(occurrence);
    }
  }
  return expanded;
}

export function expandEvent(event: RawEvent, options: ExpandOptions): RawEvent[] {
  if (!event.rrule) return [event];

  const rule = parseRule(event.rrule);
  if (!rule) return [event];

  const duration = Math.max(0, event.end.getTime() - event.start.getTime());
  const excluded = new Set(event.exdates.map((date) => date.getTime()));
  const limit = options.limit ?? 500;
  const baseParts = partsInTimeZone(event.start, options.timezone);

  const { rrule: _rrule, exdates: _exdates, recurrenceId: _recurrenceId, ...base } = event;
  const occurrences: RawEvent[] = [];
  let index = 0;

  for (const start of candidates(rule, baseParts, event.start, options.timezone)) {
    index += 1;
    if (rule.count !== undefined && index > rule.count) break;
    if (rule.until && start.getTime() > rule.until.getTime()) break;
    if (start.getTime() > options.to.getTime()) break;
    if (start.getTime() < options.from.getTime()) continue;
    if (excluded.has(start.getTime())) continue;

    occurrences.push({
      ...base,
      exdates: [],
      uid: index === 1 ? event.uid : `${event.uid}-r${formatUtcTimestamp(start)}`,
      start,
      end: new Date(start.getTime() + duration),
    });

    if (occurrences.length >= limit) break;
  }

  return occurrences;
}

export function parseRule(value: string): RecurrenceRule | null {
  const raw = value.replace(/^RRULE:/i, "").trim();
  if (!raw) return null;

  const parts = new Map<string, string>();
  for (const segment of raw.split(";")) {
    const equals = segment.indexOf("=");
    if (equals === -1) continue;
    parts.set(segment.slice(0, equals).toUpperCase(), segment.slice(equals + 1).toUpperCase());
  }

  const freq = parts.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;

  const interval = Math.max(1, Number(parts.get("INTERVAL") ?? "1") || 1);
  const rule: RecurrenceRule = { freq, interval };

  const count = Number(parts.get("COUNT"));
  if (Number.isFinite(count) && count > 0) rule.count = Math.floor(count);

  const until = parseUntil(parts.get("UNTIL"));
  if (until) rule.until = until;

  const byday = (parts.get("BYDAY") ?? "")
    .split(",")
    .map((day) => BYDAY[day.trim()])
    .filter((day): day is number => day !== undefined);
  if (byday.length > 0) rule.byday = byday;

  return rule;
}

function* candidates(
  rule: RecurrenceRule,
  base: WallClock,
  baseStart: Date,
  timezone: string,
): Generator<Date> {
  if (rule.freq === "WEEKLY" && rule.byday) {
    yield* weeklyCandidates(rule, base, baseStart, timezone);
    return;
  }

  for (let step = 0; step < MAX_ITERATIONS; step += 1) {
    const wall = addWall(base, rule, step);
    if (!wall) continue;
    const instant = zonedTimeToUtc(wall, timezone);
    if (instant.getTime() < baseStart.getTime()) continue;
    yield instant;
  }
}

function* weeklyCandidates(
  rule: RecurrenceRule,
  base: WallClock,
  baseStart: Date,
  timezone: string,
): Generator<Date> {
  const dayOffsets = [...new Set(rule.byday ?? [])].sort((left, right) => mondayOffset(left) - mondayOffset(right));
  const baseWeekday = new Date(Date.UTC(base.year, base.month - 1, base.day)).getUTCDay();
  const weekStart = addDaysWall(base, -mondayOffset(baseWeekday));

  for (let week = 0; week * rule.interval < MAX_ITERATIONS; week += 1) {
    const startOfWeek = addDaysWall(weekStart, week * rule.interval * 7);
    for (const weekday of dayOffsets) {
      const wall = addDaysWall(startOfWeek, mondayOffset(weekday));
      const instant = zonedTimeToUtc(wall, timezone);
      if (instant.getTime() < baseStart.getTime()) continue;
      yield instant;
    }
  }
}

function addWall(base: WallClock, rule: RecurrenceRule, step: number): WallClock | null {
  const amount = step * rule.interval;

  if (rule.freq === "DAILY") {
    return addDaysWall(base, amount);
  }

  if (rule.freq === "WEEKLY") {
    return addDaysWall(base, amount * 7);
  }

  if (rule.freq === "MONTHLY") {
    const marker = new Date(Date.UTC(base.year, base.month - 1 + amount, 1));
    const daysInMonth = new Date(
      Date.UTC(marker.getUTCFullYear(), marker.getUTCMonth() + 1, 0),
    ).getUTCDate();
    if (base.day > daysInMonth) return null;
    return {
      ...base,
      year: marker.getUTCFullYear(),
      month: marker.getUTCMonth() + 1,
    };
  }

  const year = base.year + amount;
  if (base.month === 2 && base.day === 29 && !isLeapYear(year)) return null;
  return { ...base, year };
}

function addDaysWall(base: WallClock, days: number): WallClock {
  const shifted = new Date(
    Date.UTC(base.year, base.month - 1, base.day + days, base.hour, base.minute, base.second),
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

function mondayOffset(weekday: number): number {
  return (weekday + 6) % 7;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function parseUntil(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value.trim());
  if (!match) return undefined;
  return new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      match[4] ? Number(match[4]) : 23,
      match[5] ? Number(match[5]) : 59,
      match[6] ? Number(match[6]) : 59,
    ),
  );
}
