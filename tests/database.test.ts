import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/server/database";

const directories: string[] = [];

function database(): AppDatabase {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-db-"));
  directories.push(directory);
  return new AppDatabase(path.join(directory, "test.sqlite"));
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("durable queue", () => {
  it("defaults to F1 LIVE and migrates existing queued jobs on startup", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-db-"));
    directories.push(directory);
    const filename = path.join(directory, "test.sqlite");
    let db = new AppDatabase(filename);
    expect(db.getDefaultFeed()).toBe("F1 LIVE");

    const running = db.createJob({ url: "https://f1tv.formula1.com/detail/1/running", quality: "best", audio: "eng", channel: "INTERNATIONAL" });
    db.claimNext();
    const queued = db.createJob({ url: "https://f1tv.formula1.com/detail/2/queued", quality: "best", audio: "eng", channel: "INTERNATIONAL" });
    db.close();

    db = new AppDatabase(filename);
    expect(db.getJob(queued.id)?.channel).toBe("F1 LIVE");
    expect(db.getJob(running.id)?.channel).toBe("INTERNATIONAL");
    db.close();
  });

  it("changes the default feed and updates only queued jobs", () => {
    const db = database();
    const completed = db.createJob({ url: "https://f1tv.formula1.com/detail/1/completed", quality: "best", audio: "eng", channel: "F1 LIVE" });
    db.claimNext();
    db.completeJob(completed.id, `${completed.id}/completed.mp4`);
    const running = db.createJob({ url: "https://f1tv.formula1.com/detail/2/running", quality: "best", audio: "eng", channel: "F1 LIVE" });
    db.claimNext();
    const queued = db.createJob({ url: "https://f1tv.formula1.com/detail/3/queued", quality: "best", audio: "eng", channel: "F1 LIVE" });
    const cancelled = db.createJob({ url: "https://f1tv.formula1.com/detail/4/cancelled", quality: "best", audio: "eng", channel: "F1 LIVE" });
    db.cancelJob(cancelled.id);

    expect(db.setDefaultFeed("INTERNATIONAL")).toBe(1);
    expect(db.getDefaultFeed()).toBe("INTERNATIONAL");
    expect(db.getJob(queued.id)?.channel).toBe("INTERNATIONAL");
    expect(db.getJob(completed.id)?.channel).toBe("F1 LIVE");
    expect(db.getJob(running.id)?.channel).toBe("F1 LIVE");
    expect(db.getJob(cancelled.id)?.channel).toBe("F1 LIVE");
    db.close();
  });

  it("claims jobs in creation order and records completion", () => {
    const db = database();
    const first = db.createJob({ url: "https://f1tv.formula1.com/detail/1/first", quality: "best", audio: "eng" });
    db.createJob({ url: "https://f1tv.formula1.com/detail/2/second", quality: "1280x720", audio: "nld" });

    expect(db.claimNext()?.id).toBe(first.id);
    db.updateProgress(first.id, 44, "Downloading · 44%");
    db.completeJob(first.id, `${first.id}/first.mp4`);
    expect(db.getJob(first.id)).toMatchObject({ status: "completed", progress: 100 });
    db.close();
  });

  it("returns interrupted jobs to the queue", () => {
    const db = database();
    const job = db.createJob({ url: "https://f1tv.formula1.com/detail/1/recovery", quality: "best", audio: "eng" });
    db.claimNext();
    expect(db.recoverInterrupted()).toBe(1);
    expect(db.getJob(job.id)).toMatchObject({ status: "queued", message: "Recovered after restart" });
    db.close();
  });

  it("notifies subscribers after each successful job mutation", () => {
    const db = database();
    const changed: string[] = [];
    const unsubscribe = db.onJobChanged((jobId) => changed.push(jobId));
    const job = db.createJob({ url: "https://f1tv.formula1.com/detail/1/events", quality: "best", audio: "eng" });

    db.claimNext();
    db.updateProgress(job.id, 27, "Downloading · 27%");
    db.completeJob(job.id, `${job.id}/race.mp4`);
    db.updateProgress(job.id, 50, "Too late");
    expect(db.cancelJob(job.id)).toBe(false);

    expect(changed).toEqual([job.id, job.id, job.id, job.id]);
    unsubscribe();
    db.close();
  });

  it("hard-deletes a job, cascades its conversion, and notifies removal subscribers", () => {
    const db = database();
    const removed: string[] = [];
    const unsubscribe = db.onJobRemoved((jobId) => removed.push(jobId));
    const job = db.createJob({ url: "https://f1tv.formula1.com/detail/1/remove", quality: "best", audio: "eng" });
    db.claimNext();
    db.completeJob(job.id, `${job.id}/race.mp4`);

    expect(db.getConversionJob(job.id)).not.toBeNull();
    expect(db.deleteJob(job.id)).toBe(true);
    expect(db.deleteJob(job.id)).toBe(false);
    expect(db.getJob(job.id)).toBeNull();
    expect(db.getConversionJob(job.id)).toBeNull();
    expect(removed).toEqual([job.id]);

    unsubscribe();
    db.close();
  });
});

describe("durable conversion queue", () => {
  it("creates and claims a conversion independently when a download completes", () => {
    const db = database();
    const download = db.createJob({ url: "https://f1tv.formula1.com/detail/1/mobile", quality: "best", audio: "eng" });
    db.claimNext();
    db.completeJob(download.id, `${download.id}/race.mp4`);

    expect(db.getConversionJob(download.id)).toMatchObject({ status: "queued", progress: 0 });
    expect(db.claimNextConversion()).toMatchObject({ downloadJobId: download.id, status: "running" });
    expect(db.claimNext()).toBeNull();

    db.updateConversionProgress(download.id, 55, "Creating 720p MP4");
    db.completeConversion(download.id, `${download.id}/race-720p-mobile.mp4`, 2_500_000_000, false);
    expect(db.getConversionJob(download.id)).toMatchObject({
      status: "completed",
      progress: 100,
      outputSize: 2_500_000_000,
      sourceReused: false
    });
    db.close();
  });

  it("recovers interrupted conversions and retries only failed work", () => {
    const db = database();
    const download = db.createJob({ url: "https://f1tv.formula1.com/detail/1/recovery", quality: "best", audio: "eng" });
    db.claimNext();
    db.completeJob(download.id, `${download.id}/race.mp4`);
    db.claimNextConversion();

    expect(db.recoverInterruptedConversions()).toBe(1);
    expect(db.getConversionJob(download.id)).toMatchObject({ status: "queued", message: "Recovered after restart" });
    expect(db.retryConversion(download.id)).toBe(false);

    db.claimNextConversion();
    db.failConversion(download.id, "Fixture conversion failure");
    expect(db.retryConversion(download.id)).toBe(true);
    expect(db.getConversionJob(download.id)).toMatchObject({ status: "queued", message: "Retry queued" });
    db.close();
  });

  it("reconciles conversion jobs for earlier completed downloads", () => {
    const db = database();
    const download = db.createJob({ url: "https://f1tv.formula1.com/detail/1/legacy", quality: "best", audio: "eng" });
    db.claimNext();
    db.completeJob(download.id, `${download.id}/race.mp4`);
    expect(db.ensureConversionJobs()).toEqual([]);
    expect(db.listConversionJobs()).toHaveLength(1);
    db.close();
  });
});
