/** Next.js pages embed their server data in a single JSON script tag. */
export function extractNextData(html: string): unknown | undefined {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!match?.[1]) return undefined;

  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}
