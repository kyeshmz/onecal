import type { SourceType } from "./types.js";

export const PLATFORM_LABELS: Record<SourceType, string> = {
  luma: "Luma",
  tribe: "Website",
  ics: "ICS",
  rss: "RSS",
};

export function platformLabel(platform: SourceType): string {
  return PLATFORM_LABELS[platform] ?? platform;
}
