export type Screen =
  | "browse"
  | "weekend"
  | "queue"
  | "downloads"
  | "watch"
  | "settings";
export interface Season {
  id: string;
  year: number;
  title: string;
  current: boolean;
}
export interface Event {
  id: string;
  seasonId: string;
  season: number;
  round: number | null;
  title: string;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
  status: "completed" | "current" | "future";
  replayAvailable: boolean;
  thumbnailUrl: string | null;
}
export interface Session {
  id: string;
  eventId: string;
  title: string;
  type: string;
  startDate: string | null;
  durationSeconds: number | null;
  durationLabel: string | null;
  thumbnailUrl: string | null;
  available: boolean;
}
export interface Catalog<T> {
  data: T;
  refreshedAt: string;
  stale: boolean;
  warning?: string;
}
export interface Job {
  id: string;
  title: string | null;
  contentId: string | null;
  eventId: string | null;
  season: number | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string | null;
  createdAt: string;
  position: number;
  file?: { available: boolean; size: number | null; url: string };
}
export interface Storage {
  ready: boolean;
  writable: boolean;
  freeBytes: number;
  totalBytes: number;
  enoughSpace: boolean;
  message: string;
  location: string;
}
export interface Settings {
  credentialsConfigured: boolean;
  encryptionReady: boolean;
  storage: Storage;
  paused: boolean;
}
