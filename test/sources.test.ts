import assert from "node:assert/strict";
import test from "node:test";
import { extractNextData } from "../src/sources/next-data.js";
import { mapLumaEvent } from "../src/sources/luma.js";
import { mapPartifulEvent } from "../src/sources/partiful.js";

test("extracts Next.js page data", () => {
  const html = `<html><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"ok":true}}}</script></html>`;
  assert.deepEqual(extractNextData(html), { props: { pageProps: { ok: true } } });
  assert.equal(extractNextData("<html></html>"), undefined);
  assert.equal(extractNextData('<script id="__NEXT_DATA__">{broken</script>'), undefined);
});

test("maps a Luma discover event", () => {
  const event = mapLumaEvent(
    {
      api_id: "evt-s0H3k6TATteievZ",
      name: "INFER/CON",
      start_at: "2026-11-16T16:00:00.000Z",
      end_at: "2026-11-17T02:00:00.000Z",
      location_type: "offline",
      geo_address_info: { city_state: "San Francisco, CA", sublocality: "Union Square" },
      url: "duckh0l3",
      description: "<p>A show.</p>",
    },
    "luma-sf",
  );

  assert.equal(event?.title, "INFER/CON");
  assert.equal(event?.start.toISOString(), "2026-11-16T16:00:00.000Z");
  assert.equal(event?.end.toISOString(), "2026-11-17T02:00:00.000Z");
  assert.equal(event?.location, "San Francisco, CA");
  assert.equal(event?.url, "https://lu.ma/duckh0l3");
  assert.equal(event?.description, "A show.");
  assert.equal(event?.uid, "evt-s0H3k6TATteievZ");
  assert.equal(event?.sourceId, "luma-sf");
});

test("maps online Luma events and fills a missing end", () => {
  const event = mapLumaEvent(
    { api_id: "evt-online", name: "Online talk", start_at: "2026-12-01T19:00:00Z", location_type: "online" },
    "luma-sf",
  );

  assert.equal(event?.location, "Online");
  assert.equal(event?.end.getTime() - event?.start.getTime(), 2 * 3_600_000);
});

test("maps a Partiful explore event", () => {
  const event = mapPartifulEvent(
    {
      id: "wGyYQkofORJBNyA6scAh",
      title: "Fort Mason Holiday Night Market",
      description: "Shop from Bay Area makers.",
      startDate: "2026-12-19T01:00:00.000Z",
      endDate: null,
      status: "PUBLISHED",
      isPublic: true,
      locationInfo: {
        mapsInfo: {
          name: "Fort Mason Center",
          addressLines: ["2 Marina Blvd Bldg C", "San Francisco, CA 94123"],
        },
      },
    },
    "partiful-sf",
  );

  assert.equal(event?.title, "Fort Mason Holiday Night Market");
  assert.equal(event?.start.toISOString(), "2026-12-19T01:00:00.000Z");
  assert.equal(event?.url, "https://partiful.com/e/wGyYQkofORJBNyA6scAh");
  assert.equal(event?.location, "2 Marina Blvd Bldg C, San Francisco, CA 94123");
  assert.equal(event?.end.getTime() - event?.start.getTime(), 2 * 3_600_000);
});

test("skips private or unpublished Partiful events", () => {
  const base = {
    id: "abc",
    title: "Private",
    startDate: "2026-12-19T01:00:00.000Z",
    status: "PUBLISHED",
    isPublic: true,
  };

  assert.ok(mapPartifulEvent(base, "partiful-sf"));
  assert.equal(mapPartifulEvent({ ...base, isPublic: false }, "partiful-sf"), undefined);
  assert.equal(mapPartifulEvent({ ...base, status: "DRAFT" }, "partiful-sf"), undefined);
  assert.equal(mapPartifulEvent({ ...base, startDate: undefined }, "partiful-sf"), undefined);
});
