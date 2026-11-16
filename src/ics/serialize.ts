import { addDays, formatDateOnly, formatUtcTimestamp } from "../time.js";
import { eventTypeLabel } from "../event-types.js";
import { platformLabel } from "../platforms.js";
import type { CalendarEvent } from "../types.js";

export interface SerializeOptions {
  calendarName: string;
  /** Number of configured sources, for the calendar description. */
  sourceCount?: number;
  /** Override for deterministic tests. */
  now?: Date;
}

export function eventsToIcs(events: CalendarEvent[], options: SerializeOptions): string {
  const now = options.now ?? new Date();
  const sourceCount = options.sourceCount ?? countSources(events);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//onecal//Aggregated calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(options.calendarName)}`,
    `X-WR-CALDESC:${escapeText(`Aggregated by onecal from ${sourceCount} calendar sources`)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ];

  for (const event of events) {
    lines.push(...serializeEvent(event, now));
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function serializeEvent(event: CalendarEvent, now: Date): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.id}`,
    `DTSTAMP:${formatUtcTimestamp(now)}`,
    `SEQUENCE:0`,
  ];

  if (event.allDay) {
    const end = event.end.getTime() > event.start.getTime() ? event.end : addDays(event.start, 1);
    lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(event.start)}`);
    lines.push(`DTEND;VALUE=DATE:${formatDateOnly(end)}`);
  } else {
    lines.push(`DTSTART:${formatUtcTimestamp(event.start)}`);
    lines.push(`DTEND:${formatUtcTimestamp(event.end)}`);
  }

  lines.push(`SUMMARY:${escapeText(event.title)}`);

  const description = buildDescription(event);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.url) lines.push(`URL:${event.url}`);

  lines.push(`STATUS:${event.status}`);
  lines.push("TRANSP:OPAQUE");

  const categories = [
    ...new Set([...event.categories, eventTypeLabel(event.eventType), ...event.sources.map((source) => source.label)]),
  ];
  if (categories.length > 0) lines.push(`CATEGORIES:${categories.map(escapeText).join(",")}`);

  lines.push(`X-ONECAL-SOURCES:${event.sources.map((source) => escapeText(source.label)).join(",")}`);
  lines.push(
    `X-ONECAL-PLATFORMS:${[...new Set(event.sources.map((source) => source.platform))].join(",")}`,
  );
  lines.push(`X-ONECAL-TYPE:${event.eventType}`);
  lines.push(`X-ONECAL-LANGUAGE:${event.language}`);

  lines.push("END:VEVENT");
  return lines;
}

function buildDescription(event: CalendarEvent): string {
  const parts: string[] = [];
  if (event.description) parts.push(event.description);

  const attribution: string[] = [
    `Source: ${event.sources
      .map((source) => `${platformLabel(source.platform)} — ${source.label}`)
      .join(", ")}`,
  ];
  if (event.url) attribution.push(event.url);
  parts.push(attribution.join("\n"));

  return parts.join("\n\n").trim();
}

function countSources(events: CalendarEvent[]): number {
  const ids = new Set<string>();
  for (const event of events) {
    for (const source of event.sources) ids.add(source.id);
  }
  return ids.size;
}

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** RFC 5545 line folding at 75 octets, never splitting a UTF-8 sequence. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const chunks: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    if (bytes + charBytes > limit) {
      chunks.push(current);
      current = "";
      bytes = 0;
      // Continuation lines start with a space, which counts toward the 75 octets.
      limit = 74;
    }
    current += char;
    bytes += charBytes;
  }
  if (current) chunks.push(current);
  return chunks.join("\r\n ");
}
