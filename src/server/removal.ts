import fs from "node:fs";
import path from "node:path";
import type { AppDatabase } from "./database";
import { resolveStoredFile } from "./files";

const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isJobId(value: string): boolean {
  return jobIdPattern.test(value);
}

export interface JobQuiescer {
  remove(jobId: string): Promise<void>;
}

type RemoveDirectory = (directory: string) => Promise<void>;

export class JobRemovalCoordinator {
  private readonly pendingCleanup = new Set<string>();
  private cleanupBusy = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: AppDatabase,
    private readonly downloadWorker: JobQuiescer,
    private readonly conversionWorker: JobQuiescer,
    private readonly downloadDir: string,
    private readonly onCleanupError: (jobId: string) => void = () => undefined,
    private readonly removeDirectory: RemoveDirectory = async (directory) => {
      await fs.promises.rm(directory, { recursive: true, force: true });
    }
  ) {}

  async start(): Promise<void> {
    await this.discoverOrphans();
    await this.retryCleanup();
    this.timer = setInterval(() => void this.retryCleanup(), 30_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async remove(jobId: string): Promise<void> {
    this.db.deleteJob(jobId);
    await Promise.all([
      this.downloadWorker.remove(jobId),
      this.conversionWorker.remove(jobId)
    ]);
    this.pendingCleanup.add(jobId);
    await this.cleanup(jobId);
  }

  private async discoverOrphans(): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(this.downloadDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && isJobId(entry.name) && !this.db.getJob(entry.name)) {
        this.pendingCleanup.add(entry.name);
      }
    }
  }

  private async cleanup(jobId: string): Promise<void> {
    try {
      const directory = resolveStoredFile(this.downloadDir, jobId);
      if (directory === path.resolve(this.downloadDir)) throw new Error("Refusing to remove the download root");
      await this.removeDirectory(directory);
      this.pendingCleanup.delete(jobId);
    } catch {
      this.pendingCleanup.add(jobId);
      this.onCleanupError(jobId);
    }
  }

  private async retryCleanup(): Promise<void> {
    if (this.cleanupBusy || this.pendingCleanup.size === 0) return;
    this.cleanupBusy = true;
    try {
      await Promise.all([...this.pendingCleanup].map((jobId) => this.cleanup(jobId)));
    } finally {
      this.cleanupBusy = false;
    }
  }
}
