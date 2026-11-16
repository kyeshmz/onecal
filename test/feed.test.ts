import assert from "node:assert/strict";
import test from "node:test";
import { parseFeed, parseLooseDate } from "../src/feed/feed.js";

const TZ = "America/Los_Angeles";

test("parses RSS items and finds dates in the title", () => {
  const rss = `<?xml version="1.0"?>
  <rss version="2.0">
    <channel>
      <title>Events</title>
      <item>
        <title>JCCNC Seminar: Nov 12, 2026 6:30 PM</title>
        <link>https://example.com/seminar</link>
        <guid>evt-1</guid>
        <description><![CDATA[<p>Join us in San Francisco.</p>]]></description>
        <category>Seminar</category>
      </item>
      <item>
        <title>News without a date</title>
        <description>No date here.</description>
      </item>
    </channel>
  </rss>`;

  const items = parseFeed(rss, { timezone: TZ });
  assert.equal(items.length, 2);
  assert.equal(items[0]?.start?.toISOString(), "2026-11-13T02:30:00.000Z");
  assert.equal(items[0]?.allDay, false);
  assert.equal(items[0]?.link, "https://example.com/seminar");
  assert.equal(items[0]?.description, "Join us in San Francisco.");
  assert.deepEqual(items[0]?.categories, ["Seminar"]);
  assert.equal(items[1]?.start, undefined);
});

test("parses Atom entries and optionally uses the publication date", () => {
  const atom = `<?xml version="1.0"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <id>urn:1</id>
      <title>Manga &amp; AI</title>
      <link rel="alternate" href="https://example.com/manga"/>
      <published>2026-11-20T19:00:00Z</published>
      <summary>Talk and demo.</summary>
    </entry>
  </feed>`;

  const without = parseFeed(atom, { timezone: TZ });
  assert.equal(without[0]?.title, "Manga & AI");
  assert.equal(without[0]?.start, undefined);

  const withPublished = parseFeed(atom, { timezone: TZ, usePublishedDate: true });
  assert.equal(withPublished[0]?.start?.toISOString(), "2026-11-20T19:00:00.000Z");
  assert.equal(withPublished[0]?.link, "https://example.com/manga");
});

test("reads schema.org Event JSON-LD embedded in a description", () => {
  const rss = `<rss><channel><item>
    <title>Opening reception</title>
    <link>https://example.com/reception</link>
    <description><![CDATA[
      <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Event","startDate":"2026-12-01T18:00:00-08:00","endDate":"2026-12-01T20:00:00-08:00","location":{"@type":"Place","name":"Japantown Peace Plaza"}}
      </script>
      <p>Join us.</p>
    ]]></description>
  </item></channel></rss>`;

  const [item] = parseFeed(rss, { timezone: TZ });
  assert.equal(item?.start?.toISOString(), "2026-12-02T02:00:00.000Z");
  assert.equal(item?.end?.toISOString(), "2026-12-02T04:00:00.000Z");
  assert.equal(item?.location, "Japantown Peace Plaza");
  assert.equal(item?.description, "Join us.");
});

test("parses JSON Feed items", () => {
  const feed = JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    items: [
      {
        id: "1",
        title: "AI Night",
        url: "https://example.com/ai",
        content_text: "Talks and demos.",
        date_published: "2026-11-20T19:00:00Z",
      },
    ],
  });

  const items = parseFeed(feed, { timezone: TZ, usePublishedDate: true });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, "AI Night");
  assert.equal(items[0]?.link, "https://example.com/ai");
  assert.equal(items[0]?.start?.toISOString(), "2026-11-20T19:00:00.000Z");
});

test("parses ISO, Japanese and bare dates", () => {
  assert.equal(parseLooseDate("2026-11-12", TZ)?.allDay, true);
  assert.equal(parseLooseDate("2026-11-12", TZ)?.date.toISOString(), "2026-11-12T00:00:00.000Z");
  assert.equal(
    parseLooseDate("2026年11月12日 18:30", TZ)?.date.toISOString(),
    "2026-11-13T02:30:00.000Z",
  );
  assert.equal(parseLooseDate("nothing here", TZ), undefined);
  assert.equal(parseLooseDate("Feb 30, 2026", TZ), undefined);
});
