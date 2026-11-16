# onecal

One subscribable calendar built from many event sources: Luma calendars, The
Events Calendar sites (like `usajapan.org`), and any public iCalendar feed.

It fetches each source, normalises events, merges duplicates that appear in more
than one feed, filters by language, classifies the event type, and serves a
single `.ics` feed you can add to Apple Calendar, Google Calendar, Outlook, or
anything else that speaks iCalendar. A web UI with agenda and month views is
included for browsing, searching, and filtering.

Live at **<https://events.kyeshimizu.com>** · code at
**<https://github.com/kyeshmz/onecal>**.

Built for tracking Bay Area Japan / tech events across:

- **Japan Society of Northern California** — `usajapan.org/events` (live)
- **Keizai Silicon Valley** — `lu.ma/keizai` (live)
- **Luma — San Francisco** — `lu.ma/sf` (live)
- **Partiful — San Francisco** — `partiful.com/explore`, SF region (live)
- **Frontier Tower SF** — Luma calendar (live)

JCCNC, the Consulate General of Japan in SF, JCCCNC, Japantown Cultural
District / JAYACon, and JETRO SF publish no machine-readable calendar, so they
are tracked in the config's `watchlist` and shown in the UI instead of being
silently dropped. See [Watchlist](#watchlist).

## How it works

```
Luma ──────┐
Partiful ──┤
Tribe ─────┤
RSS/Atom ──┼─> fetch ─> parse ─> expand recurrences ─> dedupe/merge
Any ICS ───┘                                                   │
                                                               ├─> members-only filter
                                                               ├─> language filter
                                                               ├─> /feed.ics
                                                               └─> /api/events ─> web UI
```

Sources are cached for `cacheTtlSeconds`, and the background refresher forces a
refetch every `refreshIntervalSeconds`. If a refresh fails, the last successful
snapshot is served and flagged as stale, so a flaky upstream never blanks out
your calendar.

`/feed.ics` is an output, not a requirement: source sites can be Luma, The
Events Calendar, RSS/Atom/JSON Feed, or plain ICS.

## Does it update automatically?

Yes. There is no manual export or sync step:

- A background refresher refetches every source on `refreshIntervalSeconds` (default 300 seconds; `0` disables it).
- Requests also refresh a source once its `cacheTtlSeconds` has elapsed, and failures fall back to the last good snapshot.
- The UI polls `/api/events` every 5 minutes while it is open.
- Calendar apps control their own refresh: Apple every 15 minutes to a few hours, Google roughly every 12–24 hours, Outlook 3–12 hours. The feed advertises `REFRESH-INTERVAL:PT15M`, but apps may ignore it.

The background timer needs a long-running process; on a host that sleeps when
idle, the first request after wake-up performs the refresh instead.

Sources do not need to publish ICS. Luma and The Events Calendar are read through their native feeds, and RSS/Atom/JSON Feed is supported directly. `/feed.ics` is only an output format for calendar apps — if you only use the web UI, no ICS file is involved at all.

Every event records its platform (Luma, Partiful, Website, RSS, or ICS), shown on the card and exposed as `sources[].platform` in the API.

## Quickstart

Requires Node 20.11+ and pnpm 11 (`corepack enable` will provide it).

```bash
pnpm install
pnpm dev
```

- UI: <http://localhost:3000>
- Feed: <http://localhost:3000/feed.ics>
- Source health: <http://localhost:3000/api/sources>

Check that every configured source is reachable:

```bash
pnpm check
```

Print the next events in the terminal:

```bash
pnpm run list -- --limit 15
pnpm run list -- --lang en
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
  "refreshIntervalSeconds": 300,
  "filters": { "excludeKeywords": [] },
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
| `refreshIntervalSeconds` | `300`            | Background refresh cadence; `0` disables.              |
| `filters`          | none                   | Extra exclusion phrases (members-only rules are built in). |
| `languages`        | none                   | Default include/exclude language filter.               |
| `sources`          | required               | One or more source definitions (below).                |
| `watchlist`        | `[]`                   | Organisations without a feed, shown in the UI.         |

### Source types

**`luma`** — a Luma calendar, a city discover feed, or a calendar page. Prefer
`calendarId` for a calendar or `discoverId` for a city (both use Luma's public
ICS endpoint). A page URL (`lu.ma/keizai` or `lu.ma/sf`) also works: onecal reads
the public page payload behind Luma's own app, with ICS as the fallback. A
personal feed (`https://api2.lu.ma/ics/get?entity=user&id=icssk-...`) works with
`url`; treat that URL like a password.

```json
{
  "id": "luma-sf",
  "label": "Luma — San Francisco",
  "type": "luma",
  "discoverId": "discplace-BDj7GNbGlsF7Cka",
  "locationIncludes": ["San Francisco"],
  "color": "#5b6cff"
}
```

**`partiful`** — Partiful's public explore feed for a region (`SF`, `NYC` or
`LA`). Partiful has no official public API, so onecal reads the same regional
payload its web app renders. That feed is curated (currently five events per
region), not a full index.

```json
{
  "id": "partiful-sf",
  "label": "Partiful — San Francisco",
  "type": "partiful",
  "region": "SF",
  "locationIncludes": ["San Francisco"],
  "color": "#e11d48"
}
```

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

**`rss`** — RSS 2.0, Atom, or JSON Feed. Dates are read from explicit
`<startdate>`-style tags, schema.org `Event` JSON-LD, `<time datetime="...">`,
then the title or description (`Nov 12, 2026 6:30 PM`, `2026年11月12日`, ISO).
Items without any date are skipped; set `usePublishedDate` to fall back to the
publication time. `durationHours` (default 2) is used when no end is given.

```json
{
  "id": "some-org",
  "label": "Some organisation",
  "type": "rss",
  "url": "https://example.com/events/feed.xml",
  "usePublishedDate": false,
  "durationHours": 2
}
```

Common source fields: `id` (stable, used in URLs and UIDs), `label`, `color`,
`enabled` (default `true`), `defaultLocation`, `language` to force the language
for that source, and `locationIncludes` to keep only events whose venue contains
one of those phrases (online and unknown venues are kept).

### Watchlist

Some organisations only publish events as Wix pages, Eventbrite listings, or
news posts. Instead of writing brittle scrapers that break silently, onecal
records them under `watchlist` with a link, note, and contact. The UI shows a
"Not connected yet" section, and `pnpm check` prints them. When a real feed
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

## Event types

Every event is classified into a coarse kind — Hackathon, Conference, Festival /
Market, Performance / Screening, Workshop, Panel, Talk / Seminar, Networking,
Social / Party, Meetup, Pitch / Demo, Class, or Other — from its title,
description, and categories. Titles are weighted above descriptions.

- The UI shows a type badge on each event and a **Type** filter
- `?type=performance` (or repeated/comma-separated values) filters the API and feed
- ICS adds the type to `CATEGORIES` and `X-ONECAL-TYPE`
- Rules live in [`src/event-types.ts`](src/event-types.ts); classification is
  heuristic, not semantic, so unusual titles can land in Other

## Views

The UI has two views:

- **Agenda** — chronological days with full event cards
- **Month** — a 7-column month grid with event markers; selecting a day shows its
  events below. On phones the grid switches to colored dots and tapping a day
  scrolls to that day's list.

`?view=month` opens the month view directly. The layout is responsive down to
390px.

## Members-only and other exclusions

Events whose title, description, or categories contain members-only language are
dropped by default. This covers English and Japanese, including variants like
"Members Only", "Members-Only", "Exclusive to JCCNC Members", "会員限定",
"会員のみ", and "メンバー限定". The UI and `/api/events` report how many were
hidden.

Add your own phrases on top of the built-in rules:

```json
"filters": { "excludeKeywords": ["no cameras", "invite only"] }
```

Matching is case-insensitive, hyphen-insensitive, and NFKC-normalised, so
`Members-Only` and `ＭＥＭＢＥＲＳ－ＯＮＬＹ` match the same rule.

## Endpoints

| Path                | Returns                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `/`                 | Web UI.                                                            |
| `/feed.ics`         | Merged iCalendar feed. Supports `source`, `lang`, `excludeLang`, `q`. |
| `/calendar.ics`     | Alias of `/feed.ics`.                                              |
| `/api/events`       | JSON events, language/type counts, `excludedCount`, source health, watchlist. |
| `/api/sources`      | Source health, watchlist, language/type counts.                    |
| `/healthz`          | Liveness probe.                                                    |

The ICS response is sent with `Cache-Control: public, max-age=900` and open
CORS. If every source is down and there is no cached snapshot, `/feed.ics`
returns `503` rather than wiping the subscriber's calendar with an empty feed.

Filters work on both outputs: `?source=keizai&lang=en&type=meetup,conference&q=ai`.

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

### Cloudflare Workers

The live site runs as a Worker with static assets:

```bash
pnpm deploy        # generate embedded config, then wrangler deploy
pnpm worker:dev    # local workerd
pnpm deploy:dry    # bundle check without uploading
```

`wrangler.jsonc` binds `events.kyeshimizu.com` as a custom domain and serves
`web/` as assets. `config/calendars.json` is embedded at deploy time by
`scripts/generate-config.mjs`. If you fork this, remove or change the
`account_id` and `routes` entries for your own domain.

The Worker has no background timer; each isolate refreshes on demand and keeps
its own in-memory cache. That is fine for this traffic. The Node server below
also supports `refreshIntervalSeconds` for always-warm data.

### Docker / Node

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

Any Node host works: `pnpm build && pnpm serve`.

## Development

```bash
pnpm install
pnpm test          # node:test + tsx
pnpm typecheck
pnpm dev           # tsx watch
pnpm build         # tsc -> dist/
pnpm generate:config
```

Layout:

```
src/
  server.ts        Node HTTP server + background refresh
  worker.ts        Cloudflare Worker entry
  app.ts           shared Web-standard request handler
  aggregate.ts     caching, windowing, dedupe/merge, source health
  filters.ts       query-param, language and type filtering
  event-types.ts   conference/hackathon/meetup classification
  content-filters.ts members-only and keyword exclusions
  languages.ts     script/stop-word detection + filters
  platforms.ts     Luma / Partiful / Website / RSS / ICS labels
  recur.ts         RRULE expansion in wall-clock time
  config.ts        Node config loading
  config-schema.ts config validation (Node + Worker)
  feed/            RSS, Atom and JSON Feed parsing
  ics/parse.ts     iCalendar parser (folding, escaping, TZID, RRULE metadata)
  ics/serialize.ts iCalendar writer (folding, escaping, stable UIDs)
  sources/         ics, luma, partiful, rss, tribe adapters + fetch policy
scripts/           embedded-config generation for Workers
web/               dependency-free UI (agenda + month views)
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
- Luma and Partiful have no official public API. Their adapters read the public
  page payloads their web apps use, so a site redesign can break them.
- Partiful's explore feed is curated (five events per region), not a full index.
- RSS/Atom items only become events when a real date can be found. Feeds that
  publish undated news are skipped rather than turned into fake events.
- Feed content is untrusted. The UI inserts it with `textContent`, never HTML.
- The members-only filter is keyword-based. An event that merely mentions
  membership without being restricted could be removed; tune
  `filters.excludeKeywords` or the built-in list in `src/content-filters.ts`.
- Event types are keyword heuristics; an unusual title may land in Other.
- Instances are stateless; a restart refetches every source.
