export const downloadPolicy = {
  quality: "1280x720",
  audio: "eng",
  channel: "F1 LIVE",
} as const;

export function downloadChannel(season?: number | null): "ORIGINAL" | "F1 LIVE" {
  return Number.isInteger(season) && season! >= 1950 && season! < 2022
    ? "ORIGINAL"
    : "F1 LIVE";
}

export function downloadFeedLabel(season?: number | null): string {
  return downloadChannel(season) === "ORIGINAL" ? "Original broadcast" : "F1 LIVE";
}
