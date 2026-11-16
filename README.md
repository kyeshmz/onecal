# onecal

One subscribable calendar built from many event sources: Luma calendars, The
Events Calendar sites (like `usajapan.org`), and any public iCalendar feed.

It fetches each source, normalises events, merges duplicates that appear in more
than one feed, filters by language, and serves a single `.ics` feed you can add
to Apple Calendar, Google Calendar, Outlook, or anything else that speaks
iCalendar. A small web UI is included for browsing and searching.

Built for tracking Bay Area Japan / tech events across:

- **Japan Society of Northern California** — `usajapan.org/events` (live)
- **Keizai Silicon Valley** — `lu.ma/keizai` (live)
- **Frontier Tower SF** — Luma (live, included as a second Luma example)

JCCNC, the Consulate General of Japan in SF, JCCCNC, Japantown Cultural
District / JAYACon, and JETRO SF publish no machine-readable calendar, so they
are tracked in the config's `watchlist` and shown in the UI instead of being
silently dropped. See [Watchlist](#watchlist).

## How it works

```
Luma ICS ─┐
Tribe ICS ─┼─> fetch ─> parse ─> expand recurrences ─> dedupe/merge ─> language filter ─> feed.ics
Any ICS ──┘                                                    │
                                                               └─> /api/events ─> web UI
```

Each source is fetched at most once per `cacheTtlSeconds`. If a refresh fails,
the last successful snapshot is served and flagged as stale, so a flaky upstream
never blanks out your calendar.

## Quickstart

Requires Node 20.11+.

```bash
npm install
npm run dev
```

- UI: <http://localhost:3000>
- Feed: <http://localhost:3000/feed.ics>
- Source health: <http://localhost:3000/api/sources>

Check that every configured source is reachable:

```bash
npm run check
```

Print the next events in the terminal:

```bash
npm run list -- --limit 15
npm run list -- --lang en
```

## Configuration

Everything lives in [`config/calendars.json`](config/calendars.json). Point
`ONECAL_CONFIG` at another file if you prefer to keep private feed URLs out of
git.

```json
{
  "feedName": "Bay Area Japan + Tech",
  "timezone": "America/Los_Angeles",
  "window": { "daysBack": 1, "daysAhead": 180 },
  "cacheTtlSeconds": 900,
  "languages": { "exclude": [] },
  "sources": [],
  "watchlist": []
}
```

| Field              | Default                | Meaning                                                |
| ------------------ | ---------------------- | ------------------------------------------------------ |
| `feedName`         | `OneCal`               | Calendar name shown by calendar apps.                  |
| `timezone`         | `UTC`                  | IANA zone for floating times and recurrence arithmetic.|
| `window.daysBack`  | `1`                    | Keep events that ended this many days ago.             |
| `window.daysAhead` | `180`                  | How far forward to fetch/expand.                       |
| `cacheTtlSeconds`  | `900`                  | Per-source fetch cache.                                |
| `languages`        | none                   | Default include/exclude language filter.               |
| `sources`          | required               | One or more source definitions (below).                |
| `watchlist`        | `[]`                   | Organisations without a feed, shown in the UI.         |

### Source types

**`luma`** — a Luma calendar. Prefer `calendarId`; a slug also works for
single-calendar pages such as `https://lu.ma/keizai`.

```json
{
  "id": "keizai",
  "label": "Keizai Silicon Valley",
  "type": "luma",
  "calendarId": "cal-DzmjnQ7XXUSP6Gi",
  "color": "#1f6f5c"
}
```

City pages (`lu.ma/sf`) contain many calendars, so slug resolution fails there
with a list of candidate ids. A personal Luma feed
(`https://api2.lu.ma/ics/get?entity=user&id=icssk-...`) also works with `url`;
treat that URL like a password.

**`tribe`** — a WordPress site running The Events Calendar. onecal appends
`?ical=1` itself.

```json
{
  "id": "usajapan",
  "label": "Japan Society of Northern California",
  "type": "tribe",
  "baseUrl": "https://www.usajapan.org/events/"
}
```

**`ics`** — any public iCalendar URL: Google Calendar's "secret address in
iCal format", Meetup, Proton, Eventbrite event exports, another onecal instance.

```json
{
  "id": "google-holidays",
  "label": "US Holidays",
  "type": "ics",
  "url": "https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics",
  "enabled": false
}
```

Common source fields: `id` (stable, used in URLs and UIDs), `label`, `color`,
`enabled` (default `true`), `defaultLocation`, and `language` to force the
language for that source instead of detecting per event.

### Watchlist

Some organisations only publish events as Wix pages, Eventbrite listings, or
news posts. Instead of writing brittle scrapers that break silently, onecal
records them under `watchlist` with a link, note, and contact. The UI shows a
"Not connected yet" section, and `npm run check` prints them. When a real feed
appears, promote the entry to a normal source.

## Language filter

Every event gets a language tag, detected from its title (falling back to the
description): kana → Japanese, Hangul → Korean, Han-only → Chinese, Latin
script → stop-word scoring across English, Spanish, French, German, and
Portuguese.

Filter by language in the UI, on the API, or on the feed:

```text
/feed.ics?lang=en                  # English only
/feed.ics?lang=en,ja               # English or Japanese
/feed.ics?excludeLang=ja           # everything except Japanese
/api/events?lang=en&q=design       # English events mentioning design
```

Persist a default in the config:

```json
"languages": { "exclude": ["ja"] }
```

Set `"language": "ja"` on a source to override detection for all of its events
(useful for feeds with kanji-only titles).

Notes: title language wins over description, so an English-titled event with a
Japanese write-up counts as English. Han-only text is assumed Chinese; override
it per source if that is wrong.

## Endpoints

| Path                | Returns                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `/`                 | Web UI.                                                            |
| `/feed.ics`         | Merged iCalendar feed. Supports `source`, `lang`, `excludeLang`, `q`. |
| `/calendar.ics`     | Alias of `/feed.ics`.                                              |
| `/api/events`       | JSON events, language counts, source health, watchlist.            |
| `/api/sources`      | Source health, watchlist, language counts.                         |
| `/healthz`          | Liveness probe.                                                    |

The ICS response is sent with `Cache-Control: public, max-age=900` and open
CORS. If every source is down and there is no cached snapshot, `/feed.ics`
returns `503` rather than wiping the subscriber's calendar with an empty feed.

## Subscribing

**Apple Calendar** — open `webcal://your-host/feed.ics`, or use the Subscribe
button in the UI. Set the refresh interval in Calendar → Settings → Accounts.

**Google Calendar** — Settings → Add calendar → From URL → paste
`https://your-host/feed.ics`. Google refreshes external feeds roughly every
12–24 hours.

**Outlook** — Add calendar → Subscribe from web.

For a calendar app to reach the feed, the host must be publicly reachable over
HTTPS. `localhost` works for `webcal` on the same machine but not for Google.

## Deploying

```bash
docker build -t onecal .
docker run -p 3000:3000 -e PORT=3000 onecal
```

Mount a custom config to change sources:

```bash
docker run -p 3000:3000 \
  -v "$PWD/config/calendars.json:/app/config/calendars.json:ro" \
  onecal
```

Environment variables: `PORT`, `HOST`, `ONECAL_CONFIG`, `ONECAL_FEED_NAME`,
`ONECAL_TIMEZONE`.

Any Node host works: `npm run build && npm run serve`.

## Development

```bash
npm install
npm test          # node:test + tsx
npm run typecheck
npm run dev       # tsx watch
npm run build     # tsc -> dist/
```

Layout:

```
src/
  server.ts        HTTP server, feed/API/static routes
  aggregate.ts     caching, windowing, dedupe/merge, source health
  filters.ts       query-param and language filtering
  languages.ts     script/stop-word detection + filters
  recur.ts         RRULE expansion in wall-clock time
  config.ts        config loading and validation
  ics/parse.ts     iCalendar parser (folding, escaping, TZID, RRULE metadata)
  ics/serialize.ts iCalendar writer (folding, escaping, stable UIDs)
  sources/         ics, luma, tribe adapters + fetch policy
web/               dependency-free UI
test/              unit tests
```

## Limitations

- Dedupe is heuristic: same normalised title, same minute, and compatible
  venues. Recurring instances and genuinely simultaneous same-name events can
  still be merged or missed; adjust `mergeKey` in `src/aggregate.ts` if needed.
- Recurrence expansion supports `DAILY`, `WEEKLY` (with `BYDAY`), `MONTHLY`,
  `YEARLY`, `INTERVAL`, `COUNT`, `UNTIL`, and `EXDATE`. Other rules are kept as
  a single master occurrence.
- Luma's ICS endpoint (`api.lu.ma/ics/get`) is undocumented and can change.
- Feed content is untrusted. The UI inserts it with `textContent`, never HTML.
- Instances are stateless; a restart refetches every source.
