import { addDays, isValidTimeZone, zonedTimeToUtc } from "../time.js";
import { stableHash } from "../stable-hash.js";
import type { EventStatus, RawEvent } from "../types.js";

export interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

export interface IcsComponent {
  type: string;
  properties: IcsProperty[];
  components: IcsComponent[];
}

export interface ExtractOptions {
  /** Fallback timezone for floating date-times. */
  timezone: string;
  defaultLocation?: string;
}

/** Parse an iCalendar document into a component tree. Never throws on odd input. */
export function parseIcs(text: string): IcsComponent {
  const root: IcsComponent = { type: "ROOT", properties: [], components: [] };
  const stack: IcsComponent[] = [root];

  for (const line of unfoldLines(text)) {
    if (!line.trim()) continue;
    const property = parseProperty(line);
    if (!property) continue;

    if (property.name === "BEGIN") {
      const component: IcsComponent = {
        type: property.value.trim().toUpperCase(),
        properties: [],
        components: [],
      };
      stack[stack.length - 1]?.components.push(component);
      stack.push(component);
    } else if (property.name === "END") {
      if (stack.length > 1) stack.pop();
    } else {
      stack[stack.length - 1]?.properties.push(property);
    }
  }

  return root;
}

export function findComponents(component: IcsComponent, type: string): IcsComponent[] {
  const wanted = type.toUpperCase();
  const found: IcsComponent[] = [];
  for (const child of component.components) {
    if (child.type === wanted) found.push(child);
    found.push(...findComponents(child, wanted));
  }
  return found;
}

export function getProperty(component: IcsComponent, name: string): IcsProperty | undefined {
  const wanted = name.toUpperCase();
  return component.properties.find((property) => property.name === wanted);
}

export function getPropertyValue(component: IcsComponent, name: string): string | undefined {
  return getProperty(component, name)?.value;
}

/** Convert a VCALENDAR tree into source events, including recurrence metadata. */
export function extractEvents(
  calendar: IcsComponent,
  sourceId: string,
  options: ExtractOptions,
): RawEvent[] {
  const events: RawEvent[] = [];

  for (const component of findComponents(calendar, "VEVENT")) {
    const startProperty = getProperty(component, "DTSTART");
    if (!startProperty) continue;
    const start = parseIcsDate(startProperty, options.timezone);
    if (!start) continue;

    const endProperty = getProperty(component, "DTEND");
    const end = endProperty ? parseIcsDate(endProperty, options.timezone) : undefined;

    let endDate: Date;
    if (end && end.date.getTime() > start.date.getTime()) {
      endDate = end.date;
    } else {
      const duration = parseDuration(getPropertyValue(component, "DURATION") ?? "");
      if (duration !== undefined) {
        endDate = new Date(start.date.getTime() + duration);
      } else {
        endDate = start.allDay ? addDays(start.date, 1) : new Date(start.date.getTime() + 3_600_000);
      }
    }

    const title = cleanText(decodeText(getPropertyValue(component, "SUMMARY") ?? "")) || "Untitled event";
    const description = cleanText(decodeText(getPropertyValue(component, "DESCRIPTION") ?? ""));
    const location =
      cleanText(decodeText(getPropertyValue(component, "LOCATION") ?? "")) || options.defaultLocation;

    const uid =
      getPropertyValue(component, "UID")?.trim() ||
      `generated-${stableHash(`${title}|${start.date.toISOString()}|${location ?? ""}`)}`;

    const status = normalizeStatus(getPropertyValue(component, "STATUS"));
    const organizerProperty = getProperty(component, "ORGANIZER");
    const organizer = organizerProperty
      ? cleanText(
          decodeText(organizerProperty.params.CN ?? organizerProperty.value.replace(/^mailto:/i, "")),
        )
      : undefined;

    const categories = (getPropertyValue(component, "CATEGORIES") ?? "")
      .split(/(?<!\\),/)
      .map((category) => cleanText(decodeText(category)))
      .filter(Boolean);

    const rrule = getPropertyValue(component, "RRULE")?.trim() || undefined;
    const exdates = parseDateList(getProperty(component, "EXDATE"), options.timezone);
    const recurrenceProperty = getProperty(component, "RECURRENCE-ID");
    const recurrenceId = recurrenceProperty ? parseIcsDate(recurrenceProperty, options.timezone) : undefined;

    const event: RawEvent = {
      uid,
      title,
      start: start.date,
      end: endDate,
      allDay: start.allDay,
      status,
      categories,
      exdates,
      sourceId,
    };

    if (description) event.description = description;
    if (location) event.location = location;
    if (organizer) event.organizer = organizer;
    const url =
      firstHttpUrl(getPropertyValue(component, "URL") ?? "") ?? firstHttpUrl(description);
    if (url) event.url = url;
    if (rrule) event.rrule = rrule;
    if (recurrenceId) event.recurrenceId = recurrenceId.date;

    events.push(event);
  }

  return events;
}

export function parseIcsDate(
  property: IcsProperty,
  fallbackTimezone: string,
): { date: Date; allDay: boolean } | null {
  const value = property.value.trim();
  const valueType = property.params.VALUE?.toUpperCase();

  if (valueType === "DATE" || /^\d{8}$/.test(value)) {
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (!match) return null;
    return {
      date: new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))),
      allDay: true,
    };
  }

  const match = /^(\d{4})(\d{2})(\d{2})[T ](\d{2})(\d{2})(\d{2})?(Z)?$/i.exec(value);
  if (!match) return null;

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: match[6] ? Number(match[6]) : 0,
  };

  if (match[7]) {
    return { date: new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)), allDay: false };
  }

  let timezone = property.params.TZID ?? fallbackTimezone;
  timezone = timezone.replace(/^\/+/, "");
  if (/^(utc|gmt|z)$/i.test(timezone)) {
    return { date: new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)), allDay: false };
  }
  if (!isValidTimeZone(timezone)) timezone = fallbackTimezone;

  return { date: zonedTimeToUtc(parts, timezone), allDay: false };
}

export function decodeText(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      output += char;
      continue;
    }
    const next = value[index + 1];
    if (next === undefined) {
      output += "\\";
      continue;
    }
    if (next === "n" || next === "N") {
      output += "\n";
      index += 1;
      continue;
    }
    if (next === ";" || next === "," || next === "\\") {
      output += next;
      index += 1;
      continue;
    }
    output += char;
  }
  return output;
}

/** Normalise feed descriptions: strip HTML, decode entities, trim blank runs. */
export function cleanText(value: string): string {
  if (!value) return "";
  let text = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  text = decodeEntities(text);
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const named: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
      ndash: "–",
      mdash: "—",
      rsquo: "’",
      lsquo: "‘",
      ldquo: "“",
      rdquo: "”",
      hellip: "…",
    };
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? safeCodePoint(code) : match;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? safeCodePoint(code) : match;
    }
    return named[lower] ?? match;
  });
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function unfoldLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

function parseProperty(line: string): IcsProperty | null {
  let inQuotes = false;
  let colon = -1;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ":" && !inQuotes) {
      colon = index;
      break;
    }
  }
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segments = splitOutsideQuotes(head, ";");
  const name = segments[0]?.trim().toUpperCase() ?? "";
  if (!name) return null;

  const params: Record<string, string> = {};
  for (const segment of segments.slice(1)) {
    const equals = segment.indexOf("=");
    if (equals === -1) continue;
    const key = segment.slice(0, equals).trim().toUpperCase();
    let raw = segment.slice(equals + 1).trim();
    if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
    params[key] = raw;
  }

  return { name, params, value };
}

function splitOutsideQuotes(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of value) {
    if (char === '"') inQuotes = !inQuotes;
    if (char === separator && !inQuotes) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function parseDateList(property: IcsProperty | undefined, timezone: string): Date[] {
  if (!property) return [];
  return property.value
    .split(",")
    .map((part) => {
      const parsed = parseIcsDate({ ...property, value: part }, timezone);
      return parsed?.date;
    })
    .filter((date): date is Date => date instanceof Date);
}

function parseDuration(value: string): number | undefined {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim().toUpperCase(),
  );
  if (!match) return undefined;
  const [, sign, weeks, days, hours, minutes, seconds] = match;
  if (!weeks && !days && !hours && !minutes && !seconds) return undefined;
  const total =
    (Number(weeks ?? 0) * 7 + Number(days ?? 0)) * 86_400_000 +
    Number(hours ?? 0) * 3_600_000 +
    Number(minutes ?? 0) * 60_000 +
    Number(seconds ?? 0) * 1_000;
  return sign === "-" ? -total : total;
}

/** Many feeds (including Luma) put the event page in the description, not URL. */
function firstHttpUrl(text: string): string | undefined {
  const match = /https?:\/\/[^\s<>"'\])]+/i.exec(text);
  return match ? match[0].replace(/[.,;:]+$/, "") : undefined;
}

function normalizeStatus(value: string | undefined): EventStatus {
  switch (value?.trim().toUpperCase()) {
    case "CANCELLED":
      return "CANCELLED";
    case "TENTATIVE":
      return "TENTATIVE";
    default:
      return "CONFIRMED";
  }
}
