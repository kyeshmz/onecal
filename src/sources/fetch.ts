const DEFAULT_TIMEOUT_MS = 20_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; onecal/0.1; +https://github.com/kyeshmz/onecal) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

export interface FetchOptions {
  accept?: string;
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const target = normalizeFeedUrl(url);
  const retries = options.retries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(target, {
        redirect: "follow",
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        headers: {
          "user-agent": USER_AGENT,
          accept:
            options.accept ?? "text/calendar, text/plain;q=0.9, text/html;q=0.8, */*;q=0.5",
          "accept-language": "en-US,en;q=0.9,ja;q=0.8",
          ...options.headers,
        },
      });

      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429;
        throw new HttpError(
          response.status,
          `${target} returned HTTP ${response.status} ${response.statusText}`.trim(),
          retryable,
        );
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && !error.retryable) throw error;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }

  throw new Error(`${target}: ${describeError(lastError)}`);
}

export async function fetchIcs(url: string): Promise<string> {
  const text = await fetchText(url, {
    accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
  });
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error(`${url} did not return an iCalendar feed`);
  }
  return text;
}

export function fetchHtml(url: string, options: FetchOptions = {}): Promise<string> {
  return fetchText(url, {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    ...options,
  });
}

export function normalizeFeedUrl(value: string): string {
  const trimmed = value.trim().replace(/^webcal:\/\//i, "https://");
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported URL scheme: ${url.protocol}`);
  }
  return url.toString();
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
