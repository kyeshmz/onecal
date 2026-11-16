import { Aggregator } from "./aggregate.js";
import { loadConfig } from "./config.js";
import { languageLabel } from "./languages.js";

const command = process.argv[2] ?? "check";
const config = loadConfig();
const aggregator = new Aggregator(config);

if (command === "check") {
  const snapshot = await aggregator.getSnapshot();
  const rows = snapshot.sources.map((source) => ({
    id: source.id,
    type: source.type,
    status: source.ok ? "ok" : source.stale ? "stale" : "failed",
    events: String(source.eventCount),
    fetched: new Date(source.fetchedAt).toLocaleTimeString(),
    error: source.error ?? "",
  }));

  console.log(
    `${"SOURCE".padEnd(22)}${"TYPE".padEnd(9)}${"STATUS".padEnd(9)}${"EVENTS".padEnd(8)}FETCHED`,
  );
  for (const row of rows) {
    console.log(
      `${row.id.padEnd(22)}${row.type.padEnd(9)}${row.status.padEnd(9)}${row.events.padEnd(8)}${row.fetched}`,
    );
    if (row.error) console.log(`${" ".repeat(22)}! ${row.error}`);
  }

  const watchlist = config.watchlist ?? [];
  if (watchlist.length > 0) {
    console.log("\nWATCHLIST (no public feed)");
    for (const entry of watchlist) {
      console.log(`- ${entry.label}: ${entry.note}`);
      console.log(`  ${entry.url}${entry.contact ? ` · ${entry.contact}` : ""}`);
    }
  }

  console.log(
    `\n${snapshot.events.length} event(s) in window · ${snapshot.excludedCount} hidden by filters`,
  );

  const failed = snapshot.sources.filter((source) => !source.ok);
  process.exitCode = failed.length > 0 ? 1 : 0;
} else if (command === "list") {
  const limitIndex = process.argv.indexOf("--limit");
  const limit = limitIndex === -1 ? 20 : Number(process.argv[limitIndex + 1] ?? 20);
  const langIndex = process.argv.indexOf("--lang");
  const language = langIndex === -1 ? undefined : process.argv[langIndex + 1];

  const snapshot = await aggregator.getSnapshot();
  const events = (language
    ? snapshot.events.filter((event) => event.language === language)
    : snapshot.events
  ).slice(0, Number.isFinite(limit) ? limit : 20);

  const timezone = aggregator.timezone;
  const dateFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });

  for (const event of events) {
    const date = dateFormat.format(event.start);
    const time = event.allDay ? "all-day" : timeFormat.format(event.start);
    const languageTag = event.language === "en" ? "" : ` [${languageLabel(event.language)}]`;
    const sources = event.sources.map((source) => `${source.platform}:${source.id}`).join("+");
    console.log(`${date.padEnd(12)}${time.padEnd(10)}${event.title}${languageTag}  (${sources})`);
  }

  console.log(
    `\n${events.length} event(s) · ${snapshot.sources.filter((source) => source.ok).length} live source(s)` +
      ` · ${snapshot.excludedCount} hidden by filters`,
  );
  const failed = snapshot.sources.filter((source) => !source.ok);
  if (failed.length > 0) {
    console.log(`Unavailable: ${failed.map((source) => `${source.label} (${source.error})`).join("; ")}`);
    process.exitCode = 1;
  }
} else {
  console.log("Usage: onecal <check|list> [--limit N] [--lang en]");
  process.exitCode = 1;
}
