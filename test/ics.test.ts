import assert from "node:assert/strict";
import test from "node:test";
import { extractEvents, parseIcs } from "../src/ics/parse.js";
import { eventsToIcs, foldLine } from "../src/ics/serialize.js";
import type { CalendarEvent } from "../src/types.js";

const OPTIONS = { timezone: "America/Los_Angeles" };

function extract(lines: string[]) {
  return extractEvents(parseIcs(lines.join("\r\n")), "test", OPTIONS);
}

test("parses folded lines and escaped text", () => {
  const events = extract([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:evt-1@example.com",
    "DTSTART:20260115T183000Z",
    "DTEND:20260115T203000Z",
    "SUMMARY:Designing with AI\\, robots\\; and humans\\nA talk about",
    "  the future",
    "DESCRIPTION:Line one\\nLine two\\, with a comma",
    "LOCATION:Tokyo\\, Japan",
    "CATEGORIES:AI,Design",
    "END:VEVENT",
    "END:VCALENDAR",
  ]);

  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event?.title, "Designing with AI, robots; and humans\nA talk about the future");
  assert.equal(event?.description, "Line one\nLine two, with a comma");
  assert.equal(event?.location, "Tokyo, Japan");
  assert.deepEqual(event?.categories, ["AI", "Design"]);
  assert.equal(event?.uid, "evt-1@example.com");
});

test("converts TZID date-times to the right UTC instant across DST", () => {
  const winter = extract([
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:winter",
    "DTSTART;TZID=America/Los_Angeles:20260115T183000",
    "DTEND;TZID=America/Los_Angeles:20260115T203000",
    "SUMMARY:Winter",
    "END:VEVENT",
    "END:VCALENDAR",
  ]);
  assert.equal(winter[0]?.start.toISOString(), "2026-01-16T02:30:00.000Z");
  assert.equal(winter[0]?.end.toISOString(), "2026-01-16T04:30:00.000Z");

  const summer = extract([
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:summer",
    "DTSTART;TZID=America/Los_Angeles:20260715T183000",
    "DTEND;TZID=America/Los_Angeles:20260715T203000",
    "SUMMARY:Summer",
    "END:VEVENT",
    "END:VCALENDAR",
  ]);
  assert.equal(summer[0]?.start.toISOString(), "2026-07-16T01:30:00.000Z");
});

test("keeps all-day events as date-only values", () => {
  const events = extract([
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:all-day",
    "DTSTART;VALUE=DATE:20260411",
    "DTEND;VALUE=DATE:20260413",
    "SUMMARY:Cherry Blossom Festival",
    "END:VEVENT",
    "END:VCALENDAR",
  ]);

  assert.equal(events[0]?.allDay, true);
  assert.equal(events[0]?.start.toISOString(), "2026-04-11T00:00:00.000Z");
  assert.equal(events[0]?.end.toISOString(), "2026-04-13T00:00:00.000Z");
});

test("captures recurrence, exdates and exception instances", () => {
  const events = extract([
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:weekly",
    "DTSTART:20260105T190000Z",
    "DTEND:20260105T210000Z",
    "RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO",
    "EXDATE:20260119T190000Z",
    "SUMMARY:Weekly meetup",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:weekly",
    "RECURRENCE-ID:20260112T190000Z",
    "DTSTART:20260112T200000Z",
    "DTEND:20260112T220000Z",
    "SUMMARY:Weekly meetup (moved)",
    "END:VEVENT",
    "END:VCALENDAR",
  ]);

  assert.equal(events.length, 2);
  assert.equal(events[0]?.rrule, "FREQ=WEEKLY;COUNT=4;BYDAY=MO");
  assert.equal(events[0]?.exdates[0]?.toISOString(), "2026-01-19T19:00:00.000Z");
  assert.equal(events[1]?.recurrenceId?.toISOString(), "2026-01-12T19:00:00.000Z");
});

test("serializes a feed that round-trips through the parser", () => {
  const start = new Date("2026-11-17T19:30:00Z");
  const event: CalendarEvent = {
    id: "onecal-abc@onecal",
    uid: "abc",
    title: "Manga × AI: デザインと生成AIの未来 — a very long title that must be folded across lines",
    description: "Line one\nLine two, with a comma; and a semicolon.",
    location: "Japantown, San Francisco",
    url: "https://example.com/event",
    start,
    end: new Date("2026-11-17T22:00:00Z"),
    allDay: false,
    status: "CONFIRMED",
    organizer: "Japan Society",
    categories: ["AI", "Design"],
    language: "en",
    eventType: "conference",
    sources: [{ id: "usajapan", label: "Japan Society", color: "#c2413b", platform: "tribe" }],
  };

  const ics = eventsToIcs([event], {
    calendarName: "Test Calendar",
    now: new Date("2026-11-16T00:00:00Z"),
  });

  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(ics.includes("X-WR-CALNAME:Test Calendar"));

  const parsed = extractEvents(parseIcs(ics), "test", OPTIONS);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.title, event.title);
  assert.ok(
    parsed[0]?.description?.startsWith("Line one\nLine two, with a comma; and a semicolon."),
  );
  assert.ok(parsed[0]?.description?.includes("Japan Society"));
  assert.equal(parsed[0]?.location, event.location);
  assert.equal(parsed[0]?.start.toISOString(), start.toISOString());
  assert.equal(parsed[0]?.uid, event.id);
});

test("folds long lines at 75 UTF-8 octets", () => {
  const line = `SUMMARY:${"デザインとAIの未来".repeat(12)}`;
  const folded = foldLine(line);
  const encoder = new TextEncoder();

  for (const part of folded.split("\r\n")) {
    assert.ok(encoder.encode(part).length <= 75, `line too long: ${part}`);
  }
  assert.equal(folded.replace(/\r\n /g, ""), line);
});
