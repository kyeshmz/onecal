import assert from "node:assert/strict";
import test from "node:test";
import { ConfigError, validateConfig } from "../src/config.js";
import { loadStaticSource } from "../src/sources/static.js";
import type { StaticSourceConfig } from "../src/types.js";

test("loads date-only events as all-day events with exclusive ends", () => {
  const source: StaticSourceConfig = {
    id: "japantown",
    label: "Japantown",
    type: "static",
    defaultLocation: "San Francisco, CA",
    events: [
      { uid: "one-day", title: "One day", date: "2027-04-10" },
      {
        uid: "two-days",
        title: "Two days",
        date: "2027-08-07",
        endDate: "2027-08-08",
        status: "TENTATIVE",
      },
    ],
  };

  const [oneDay, twoDays] = loadStaticSource(source);
  assert.equal(oneDay?.allDay, true);
  assert.equal(oneDay?.start.toISOString(), "2027-04-10T00:00:00.000Z");
  assert.equal(oneDay?.end.toISOString(), "2027-04-11T00:00:00.000Z");
  assert.equal(oneDay?.location, "San Francisco, CA");
  assert.equal(twoDays?.end.toISOString(), "2027-08-09T00:00:00.000Z");
  assert.equal(twoDays?.status, "TENTATIVE");
});

test("validates static source events", () => {
  assert.throws(
    () =>
      validateConfig({
        sources: [{ id: "x", label: "X", type: "static", events: [] }],
      }),
    ConfigError,
  );

  assert.throws(
    () =>
      validateConfig({
        sources: [
          {
            id: "x",
            label: "X",
            type: "static",
            events: [{ uid: "a", title: "A", date: "2027-02-30" }],
          },
        ],
      }),
    /real date/,
  );

  assert.throws(
    () =>
      validateConfig({
        sources: [
          {
            id: "x",
            label: "X",
            type: "static",
            events: [
              { uid: "a", title: "A", date: "2027-04-10" },
              { uid: "a", title: "B", date: "2027-04-11" },
            ],
          },
        ],
      }),
    /duplicate static event uid/,
  );
});
