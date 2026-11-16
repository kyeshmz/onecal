const state = {
  events: [],
  sources: [],
  watchlist: [],
  languages: [],
  activeSources: new Set(),
  q: "",
  lang: "",
  generatedAt: null,
  excludedCount: 0,
  initialized: false,
};

const els = {
  tagline: document.getElementById("tagline"),
  refresh: document.getElementById("refresh"),
  subscribe: document.getElementById("subscribe"),
  search: document.getElementById("search"),
  language: document.getElementById("language"),
  sources: document.getElementById("sources"),
  banner: document.getElementById("banner"),
  status: document.getElementById("status"),
  agenda: document.getElementById("agenda"),
  watchlist: document.getElementById("watchlist"),
  watchlistItems: document.getElementById("watchlist-items"),
  feedUrl: document.getElementById("feed-url"),
  copy: document.getElementById("copy"),
  dialog: document.getElementById("subscribe-dialog"),
  feedInput: document.getElementById("feed-input"),
  webcalLink: document.getElementById("webcal-link"),
  copyFeed: document.getElementById("copy-feed"),
  closeDialog: document.getElementById("close-dialog"),
};

const FEED_URL = new URL("/feed.ics", window.location.href).toString();
let currentFeedUrl = FEED_URL;

const LANGUAGE_LABELS = {
  en: "English",
  ja: "Japanese",
  zh: "Chinese",
  ko: "Korean",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  other: "Other",
  unknown: "Unknown",
};

const PLATFORM_LABELS = {
  luma: "Luma",
  partiful: "Partiful",
  tribe: "Website",
  ics: "ICS",
  rss: "RSS",
};

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const longDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const shortDateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function localDayKey(iso) {
  return dayKeyFormatter.format(new Date(iso));
}

function eventDayKey(event) {
  const startKey = event.allDay ? event.start.slice(0, 10) : localDayKey(event.start);
  const today = localDayKey(new Date().toISOString());

  // Show ongoing multi-day events under today instead of pushing the agenda into the past.
  if (startKey < today) {
    const endKey = event.allDay ? event.end.slice(0, 10) : localDayKey(event.end);
    if (endKey >= today) return today;
  }

  return startKey;
}

async function load() {
  setLoading(true);
  try {
    const response = await fetch("/api/events", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`The server returned ${response.status}`);

    const data = await response.json();
    const previous = new Set(state.activeSources);
    const sourceIds = (data.sources ?? []).map((source) => source.id);

    state.events = Array.isArray(data.events) ? data.events : [];
    state.sources = Array.isArray(data.sources) ? data.sources : [];
    state.watchlist = Array.isArray(data.watchlist) ? data.watchlist : [];
    state.languages = Array.isArray(data.languages) ? data.languages : [];
    state.generatedAt = data.generatedAt ?? null;
    state.excludedCount = Number(data.excludedCount) || 0;
    state.activeSources = new Set(
      state.initialized ? sourceIds.filter((id) => previous.has(id)) : sourceIds,
    );
    state.initialized = true;

    if (state.lang && !state.languages.some((language) => language.code === state.lang)) {
      state.lang = "";
    }

    renderSources();
    renderLanguages();
    renderWatchlist();
    renderBanner();
    render();
    setLoading(false);
  } catch (error) {
    setLoading(false);
    els.status.textContent = "Offline";
    renderError(error);
  }
}

function renderError(error) {
  const text = error instanceof Error ? error.message : String(error);
  const unreachable =
    error instanceof TypeError || /(?:^|\D)(?:502|503|504)(?:\D|$)/.test(text);

  els.agenda.replaceChildren();
  const box = document.createElement("div");
  box.className = "empty";
  const title = document.createElement("strong");
  title.textContent = unreachable
    ? "The calendar server is unreachable"
    : "Could not load the calendar";
  const message = document.createElement("p");
  message.textContent = unreachable
    ? `Nothing is answering at ${window.location.origin}. Start it with "pnpm dev" and check that the port matches.`
    : text;
  const detail = document.createElement("p");
  detail.className = "muted";
  detail.textContent = text;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "btn";
  retry.textContent = "Try again";
  retry.addEventListener("click", load);
  box.append(title, message, detail, retry);
  els.agenda.append(box);
}

function setLoading(loading) {
  els.refresh.disabled = loading;
  els.refresh.textContent = loading ? "Refreshing…" : "Refresh";
}

function renderSources() {
  els.sources.replaceChildren();
  if (state.sources.length === 0) return;

  for (const source of state.sources) {
    const count = state.events.filter((event) =>
      event.sources.some((eventSource) => eventSource.id === source.id),
    ).length;

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.setAttribute("aria-pressed", String(state.activeSources.has(source.id)));
    const platform = PLATFORM_LABELS[source.type] ?? source.type;
    chip.title = source.ok
      ? `${platform} source · ${source.label}: ${count} events`
      : `${platform} source · ${source.label}: ${source.error ?? "unavailable"}${source.stale ? " (cached)" : ""}`;

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.setProperty("--dot", source.color || "#6d7078");

    const label = document.createElement("span");
    label.textContent = source.label;

    const total = document.createElement("span");
    total.className = "chip-count";
    total.textContent = String(count);

    chip.append(dot, label, total);
    if (!source.ok) {
      const warn = document.createElement("span");
      warn.className = "tag lang";
      warn.textContent = "!";
      warn.title = source.error ?? "unavailable";
      chip.append(warn);
    }

    chip.addEventListener("click", () => {
      if (state.activeSources.has(source.id)) state.activeSources.delete(source.id);
      else state.activeSources.add(source.id);
      chip.setAttribute("aria-pressed", String(state.activeSources.has(source.id)));
      render();
    });

    els.sources.append(chip);
  }
}

function renderLanguages() {
  const current = state.lang;
  els.language.replaceChildren();
  els.language.append(new Option("All languages", ""));

  for (const language of state.languages) {
    els.language.append(
      new Option(`${language.label} (${language.count})`, language.code),
    );
  }

  els.language.value = state.languages.some((language) => language.code === current)
    ? current
    : "";
  state.lang = els.language.value;
}

function renderWatchlist() {
  if (state.watchlist.length === 0) {
    els.watchlist.hidden = true;
    return;
  }

  els.watchlist.hidden = false;
  els.watchlistItems.replaceChildren();

  for (const entry of state.watchlist) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.textContent = entry.label;
    if (isHttpUrl(entry.url)) {
      link.href = entry.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    item.append(link);

    const note = document.createElement("p");
    note.textContent = entry.note;
    item.append(note);

    if (entry.contact) {
      const contact = document.createElement("span");
      contact.className = "contact";
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(entry.contact)) {
        const mail = document.createElement("a");
        mail.href = `mailto:${entry.contact}`;
        mail.textContent = entry.contact;
        contact.append(mail);
      } else {
        contact.textContent = entry.contact;
      }
      item.append(contact);
    }

    els.watchlistItems.append(item);
  }
}

function renderBanner() {
  const failed = state.sources.filter((source) => !source.ok);
  if (failed.length === 0) {
    els.banner.hidden = true;
    els.banner.textContent = "";
    return;
  }

  els.banner.hidden = false;
  if (failed.length === state.sources.length) {
    els.banner.textContent =
      "Every source is unavailable right now. Showing the last successful snapshot.";
    return;
  }

  const names = failed.map((source) => source.label).join(", ");
  els.banner.textContent = `${failed.length} source${failed.length === 1 ? "" : "s"} unavailable: ${names}.`;
}

function render() {
  const filtered = filterEvents();
  const groups = groupByDay(filtered);

  els.agenda.replaceChildren();

  if (filtered.length === 0) {
    const box = document.createElement("div");
    box.className = "empty";
    const title = document.createElement("strong");
    title.textContent =
      state.events.length === 0 ? "No upcoming events" : "Nothing matches those filters";
    const message = document.createElement("p");
    message.textContent =
      state.events.length === 0
        ? "The sources are connected but have not published events in this window."
        : "Try clearing the search or turning a source back on.";
    box.append(title, message);

    if (state.events.length > 0) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "btn";
      clear.textContent = "Clear filters";
      clear.addEventListener("click", () => {
        state.q = "";
        state.lang = "";
        els.search.value = "";
        els.language.value = "";
        state.activeSources = new Set(state.sources.map((source) => source.id));
        renderSources();
        render();
      });
      box.append(clear);
    }

    els.agenda.append(box);
  } else {
    for (const group of groups) els.agenda.append(renderDay(group));
  }

  els.status.textContent = summarize(filtered.length);
  syncFeedLink();
}

/** Keep the subscribe link in step with the language filter. */
function syncFeedLink() {
  const url = new URL("/feed.ics", window.location.href);
  if (state.lang) url.searchParams.set("lang", state.lang);

  currentFeedUrl = url.toString();
  els.feedUrl.textContent = currentFeedUrl;
  els.feedInput.value = currentFeedUrl;
  els.webcalLink.href = currentFeedUrl.replace(/^https?:/, "webcal:");
}

function summarize(visible) {
  const total = state.events.length;
  const live = state.sources.filter((source) => source.ok).length;
  const updated = state.generatedAt
    ? ` · updated ${new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(state.generatedAt))}`
    : "";
  const hidden =
    state.excludedCount > 0 ? ` · ${state.excludedCount} hidden (members-only)` : "";
  const count = visible === total ? `${total}` : `${visible} of ${total}`;
  return `${count} event${total === 1 ? "" : "s"} · ${live}/${state.sources.length} sources live${hidden}${updated}`;
}

function filterEvents() {
  const query = state.q.toLowerCase();

  return state.events.filter((event) => {
    if (!event.sources.some((source) => state.activeSources.has(source.id))) return false;
    if (state.lang && event.language !== state.lang) return false;
    if (!query) return true;

    const haystack = [
      event.title,
      event.description,
      event.location,
      event.organizer,
      ...(event.categories ?? []),
      ...event.sources.map((source) => source.label),
    ]
      .filter((value) => typeof value === "string")
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

function groupByDay(events) {
  const groups = new Map();

  for (const event of events) {
    const key = eventDayKey(event);
    const bucket = groups.get(key);
    if (bucket) bucket.push(event);
    else groups.set(key, [event]);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, list]) => ({ key, events: list.sort(compareEvents) }));
}

function compareEvents(left, right) {
  if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
  const delta = new Date(left.start).getTime() - new Date(right.start).getTime();
  return delta || left.title.localeCompare(right.title);
}

function renderDay({ key, events }) {
  const section = document.createElement("section");
  section.className = "day";

  const heading = document.createElement("h2");
  heading.className = "date-title";
  const date = document.createElement("span");
  date.textContent = longDateFormatter.format(new Date(`${key}T12:00:00`));
  heading.append(date);

  const relative = relativeDayLabel(key);
  if (relative) {
    const badge = document.createElement("span");
    badge.className = "date-sub";
    badge.textContent = relative;
    heading.append(badge);
  }
  section.append(heading);

  const list = document.createElement("div");
  list.className = "day-events";
  for (const event of events) list.append(renderEvent(event));
  section.append(list);

  return section;
}

function renderEvent(event) {
  const article = document.createElement("article");
  article.className = "event";

  const time = document.createElement("div");
  time.className = "event-time";
  if (event.allDay) {
    const allDay = document.createElement("span");
    allDay.textContent = "All day";
    time.append(allDay);
  } else {
    const start = new Date(event.start);
    const end = new Date(event.end);

    const startLabel = document.createElement("span");
    startLabel.textContent = timeFormatter.format(start);
    time.append(startLabel);

    if (!Number.isNaN(end.getTime()) && end.getTime() > start.getTime()) {
      const endLabel = document.createElement("span");
      endLabel.className = "end";
      endLabel.textContent =
        localDayKey(event.end) === localDayKey(event.start)
          ? timeFormatter.format(end)
          : `${timeFormatter.format(end)} ${shortDateFormatter.format(end)}`;
      time.append(endLabel);
    }
  }
  article.append(time);

  const body = document.createElement("div");
  body.className = "event-body";

  const title = document.createElement("h3");
  title.className = "event-title";
  if (isHttpUrl(event.url)) {
    const link = document.createElement("a");
    link.href = event.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = event.title;
    title.append(link);
  } else {
    title.textContent = event.title;
  }
  body.append(title);

  const meta = [event.location, event.organizer].filter(Boolean);
  if (meta.length > 0) {
    const line = document.createElement("p");
    line.className = "event-meta";
    line.textContent = meta.join(" · ");
    body.append(line);
  }

  const tags = document.createElement("div");
  tags.className = "event-tags";

  if (event.language && event.language !== "en") {
    const tag = document.createElement("span");
    tag.className = "tag lang";
    tag.textContent = event.language.toUpperCase();
    tag.title = LANGUAGE_LABELS[event.language] ?? event.language;
    tags.append(tag);
  }

  for (const source of event.sources ?? []) {
    const tag = document.createElement("span");
    tag.className = "tag";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.setProperty("--dot", source.color || "#6d7078");
    const label = document.createElement("span");
    label.textContent = source.label;

    const platform = document.createElement("span");
    platform.className = "tag-platform";
    platform.textContent = PLATFORM_LABELS[source.platform] ?? source.platform ?? "";

    tag.append(dot, label, platform);
    tags.append(tag);
  }

  if (tags.childElementCount > 0) body.append(tags);

  if (event.description) {
    const details = document.createElement("details");
    details.className = "event-details";
    const summary = document.createElement("summary");
    summary.textContent = "Details";
    const text = document.createElement("p");
    text.textContent = event.description;
    details.append(summary, text);
    body.append(details);
  }

  article.append(body);
  return article;
}

function relativeDayLabel(key) {
  const today = localDayKey(new Date().toISOString());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (key === today) return "Today";
  if (key === localDayKey(tomorrow.toISOString())) return "Tomorrow";
  return "";
}

function isHttpUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function copy(text, button) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  window.setTimeout(() => {
    button.textContent = original;
  }, 1600);
}

els.search.addEventListener("input", (event) => {
  state.q = event.target.value.trim();
  render();
});

els.language.addEventListener("change", (event) => {
  state.lang = event.target.value;
  render();
});

els.refresh.addEventListener("click", load);
els.copy.addEventListener("click", () => copy(currentFeedUrl, els.copy));
els.copyFeed.addEventListener("click", () => copy(currentFeedUrl, els.copyFeed));

els.feedUrl.textContent = FEED_URL;
els.feedInput.value = FEED_URL;
els.webcalLink.href = FEED_URL.replace(/^https?:/, "webcal:");

els.subscribe.addEventListener("click", () => {
  if (typeof els.dialog.showModal === "function") els.dialog.showModal();
  else window.location.href = currentFeedUrl;
});
els.closeDialog.addEventListener("click", () => els.dialog.close());

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const typing =
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

  if (event.key === "/" && !typing) {
    event.preventDefault();
    els.search.focus();
  }
});

window.setInterval(load, 5 * 60 * 1000);
load();
