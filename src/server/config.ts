import path from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  downloadDir: string;
  clientDir: string;
  encryptionKey?: string;
  commit: string;
  f1tvBin: string;
  workerPollMs: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const root = process.cwd();
  return {
    host: process.env.HOST || "0.0.0.0",
    port: positiveInteger(process.env.PORT, 43729),
    dataDir: path.resolve(process.env.DATA_DIR || path.join(root, "data")),
    downloadDir: path.resolve(process.env.DOWNLOAD_DIR || path.join(root, "downloads")),
    clientDir: path.resolve(path.join(root, "dist", "client")),
    encryptionKey: process.env.APP_ENCRYPTION_KEY || undefined,
    commit: process.env.DRONE_COMMIT || "development",
    f1tvBin: path.resolve(process.env.F1TV_DL_BIN || path.join(root, "node_modules", ".bin", "f1tv-dl")),
    workerPollMs: positiveInteger(process.env.WORKER_POLL_MS, 1000),
    ...overrides
  };
}
