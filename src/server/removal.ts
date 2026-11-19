import fs from "node:fs/promises";
import type { AppDatabase } from "./database";
import { resolveStoredFile } from "./files";
import type { MediaStorage } from "./storage";
export function isJobId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );
}
export interface JobQuiescer {
  remove(id: string): Promise<void>;
}
export class JobRemovalCoordinator {
  private timer?: NodeJS.Timeout;
  private task?: Promise<void>;
  constructor(
    private db: AppDatabase,
    private worker: JobQuiescer,
    private root: string,
    private storage: MediaStorage,
  ) {}
  async start(): Promise<void> {
    await this.retry();
    this.timer = setInterval(() => {
      void this.retry();
    }, 10000);
    this.timer.unref();
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.task;
  }
  async remove(id: string): Promise<void> {
    if (!isJobId(id))
      throw Object.assign(new Error("Invalid download identifier"), {
        statusCode: 400,
      });
    this.db.requestDeletion(id);
    await this.worker.remove(id);
    this.db.deleteJob(id);
    await this.retry();
  }
  private retry(): Promise<void> {
    if (this.task) return this.task;
    this.task = (async () => {
      if (!(await this.storage.check()).ready) return;
      for (const id of this.db.pendingDeletions()) {
        if (!isJobId(id)) continue;
        try {
          await this.worker.remove(id);
          this.db.deleteJob(id);
          await fs.rm(resolveStoredFile(this.root, id), {
            recursive: true,
            force: true,
          });
          this.db.finishDeletion(id);
        } catch {
          /* Persisted requests retry when storage recovers. */
        }
      }
    })().finally(() => {
      this.task = undefined;
    });
    return this.task;
  }
}
