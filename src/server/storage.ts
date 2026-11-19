import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config";

export interface StorageState {
  ready: boolean;
  writable: boolean;
  freeBytes: number;
  totalBytes: number;
  enoughSpace: boolean;
  message: string;
  location: string;
}
export class MediaStorage {
  private state: StorageState = {
    ready: false,
    writable: false,
    freeBytes: 0,
    totalBytes: 0,
    enoughSpace: false,
    message: "Checking media storage",
    location: "Synology / Homelab-workspace / f1tv-dl",
  };
  private pending?: Promise<StorageState>;
  private checkedAt = 0;
  constructor(private readonly config: AppConfig) {}
  snapshot(): StorageState {
    return { ...this.state };
  }
  async check(force = false): Promise<StorageState> {
    if (!force && Date.now() - this.checkedAt < 5000) return this.snapshot();
    if (!this.pending) {
      this.pending = this.probe()
        .then((s) => {
          this.state = s;
          this.checkedAt = Date.now();
          return s;
        })
        .finally(() => {
          this.pending = undefined;
        });
    }
    let timeout: NodeJS.Timeout | undefined;
    const result = await Promise.race([
      this.pending,
      new Promise<StorageState>((resolve) => {
        timeout = setTimeout(
          () =>
            resolve({
              ...this.state,
              ready: false,
              writable: false,
              message: "Media storage is not responding",
            }),
          this.config.storageTimeoutMs,
        );
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    this.state = result;
    return { ...result };
  }
  private async probe(): Promise<StorageState> {
    const location = this.config.requireNfs
      ? "Synology / Homelab-workspace / f1tv-dl"
      : "Local development storage";
    let probeFile: string | undefined;
    try {
      if (!this.config.requireNfs)
        await fs.mkdir(this.config.downloadDir, { recursive: true });
      const root = await fs.realpath(this.config.downloadDir);
      if (root !== path.resolve(this.config.downloadDir))
        throw new Error("Unexpected media storage path");
      const stat = await fs.statfs(root);
      if (this.config.requireNfs) {
        if (stat.type !== 0x6969)
          throw new Error("The expected NFS volume is not mounted");
        const marker = await fs.readFile(
          path.join(root, ".f1tv-storage-id"),
          "utf8",
        );
        if (marker.trim() !== this.config.storageId)
          throw new Error("The media storage identity does not match");
      }
      probeFile = path.join(
        root,
        ".f1tv-write-probe-" + process.pid + "-" + randomUUID(),
      );
      const handle = await fs.open(probeFile, "wx", 0o600);
      try {
        await handle.writeFile("storage-check");
      } finally {
        await handle.close();
      }
      await fs.unlink(probeFile);
      probeFile = undefined;
      const freeBytes = stat.bavail * stat.bsize,
        totalBytes = stat.blocks * stat.bsize;
      return {
        ready: true,
        writable: true,
        freeBytes,
        totalBytes,
        enoughSpace: freeBytes >= this.config.storageMinFreeBytes,
        message:
          freeBytes >= this.config.storageMinFreeBytes
            ? "Media storage is ready"
            : "Media storage is low on free space",
        location,
      };
    } catch (error) {
      if (probeFile) void fs.unlink(probeFile).catch(() => {});
      return {
        ready: false,
        writable: false,
        freeBytes: 0,
        totalBytes: 0,
        enoughSpace: false,
        message:
          error instanceof Error && error.message.startsWith("The ")
            ? error.message
            : "Media storage is unavailable",
        location,
      };
    }
  }
  async requireReady(): Promise<void> {
    if (!(await this.check()).ready)
      throw Object.assign(
        new Error(
          "Media storage is unavailable; try again when Synology is connected",
        ),
        { statusCode: 503 },
      );
  }
}
