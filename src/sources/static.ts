import type { RawEvent, StaticSourceConfig } from "../types.js";

const DAY_MS = 86_400_000;

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Turn date-only config events into all-day RawEvents. Dates are UTC midnights,
 * matching how the ICS parser represents VALUE=DATE entries.
 */
export function loadStaticSource(source: StaticSourceConfig): RawEvent[] {
  return source.events.map((event) => {
    const start = parseDateOnly(event.date);
    const end = new Date(parseDateOnly(event.endDate ?? event.date).getTime() + DAY_MS);
    const location = event.location ?? source.defaultLocation;

    return {
      uid: event.uid,
      title: event.title,
      ...(event.description ? { description: event.description } : {}),
      ...(location ? { location } : {}),
      ...(event.url ? { url: event.url } : {}),
      start,
      end,
      allDay: true,
      status: event.status ?? "CONFIRMED",
      ...(event.organizer ? { organizer: event.organizer } : {}),
      categories: event.categories ?? [],
      ...(event.rrule ? { rrule: event.rrule } : {}),
      exdates: [],
      sourceId: source.id,
    };
  });
}
