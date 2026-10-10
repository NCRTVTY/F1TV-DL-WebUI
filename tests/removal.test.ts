import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../src/server/database";
import { JobRemovalCoordinator, type JobQuiescer } from "../src/server/removal";

const directories: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-removal-"));
  directories.push(root);
  const downloadDir = path.join(root, "downloads");
  fs.mkdirSync(downloadDir, { recursive: true });
  const db = new AppDatabase(path.join(root, "data", "test.sqlite"));
  const downloadWorker = { remove: vi.fn(async () => undefined) } satisfies JobQuiescer;
  const conversionWorker = { remove: vi.fn(async () => undefined) } satisfies JobQuiescer;
  return { db, downloadDir, downloadWorker, conversionWorker };
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("job removal coordination", () => {
  it("deletes database records, quiesces both workers, and removes every job file", async () => {
    const { db, downloadDir, downloadWorker, conversionWorker } = fixture();
    const job = db.createJob({ url: "https://f1tv.formula1.com/detail/1/remove", quality: "best", audio: "eng" });
    db.claimNext();
    const jobDirectory = path.join(downloadDir, job.id);
    fs.mkdirSync(jobDirectory, { recursive: true });
    fs.writeFileSync(path.join(jobDirectory, "race.mp4"), "hq");
    fs.writeFileSync(path.join(jobDirectory, "race-720p-mobile.mp4"), "lq");
    db.completeJob(job.id, `${job.id}/race.mp4`);

    const coordinator = new JobRemovalCoordinator(db, downloadWorker, conversionWorker, downloadDir);
    await coordinator.remove(job.id);

    expect(db.getJob(job.id)).toBeNull();
    expect(db.getConversionJob(job.id)).toBeNull();
    expect(downloadWorker.remove).toHaveBeenCalledWith(job.id);
    expect(conversionWorker.remove).toHaveBeenCalledWith(job.id);
    expect(fs.existsSync(jobDirectory)).toBe(false);
    db.close();
  });

  it("keeps the database deletion successful when filesystem cleanup fails", async () => {
    const { db, downloadDir, downloadWorker, conversionWorker } = fixture();
    const job = db.createJob({ url: "https://f1tv.formula1.com/detail/1/failure", quality: "best", audio: "eng" });
    const jobDirectory = path.join(downloadDir, job.id);
    fs.mkdirSync(jobDirectory, { recursive: true });
    const cleanupError = vi.fn();
    const coordinator = new JobRemovalCoordinator(
      db,
      downloadWorker,
      conversionWorker,
      downloadDir,
      cleanupError,
      async () => { throw new Error("fixture cleanup failure"); }
    );

    await expect(coordinator.remove(job.id)).resolves.toBeUndefined();
    expect(db.getJob(job.id)).toBeNull();
    expect(fs.existsSync(jobDirectory)).toBe(true);
    expect(cleanupError).toHaveBeenCalledWith(job.id);
    db.close();
  });

  it("cleans only orphaned UUID directories during startup", async () => {
    const { db, downloadDir, downloadWorker, conversionWorker } = fixture();
    const retained = db.createJob({ url: "https://f1tv.formula1.com/detail/1/retained", quality: "best", audio: "eng" });
    const orphanId = randomUUID();
    const retainedDirectory = path.join(downloadDir, retained.id);
    const orphanDirectory = path.join(downloadDir, orphanId);
    const unrelatedDirectory = path.join(downloadDir, "manual-archive");
    for (const directory of [retainedDirectory, orphanDirectory, unrelatedDirectory]) {
      fs.mkdirSync(directory, { recursive: true });
    }

    const coordinator = new JobRemovalCoordinator(db, downloadWorker, conversionWorker, downloadDir);
    await coordinator.start();

    expect(fs.existsSync(retainedDirectory)).toBe(true);
    expect(fs.existsSync(orphanDirectory)).toBe(false);
    expect(fs.existsSync(unrelatedDirectory)).toBe(true);
    coordinator.stop();
    db.close();
  });
});
