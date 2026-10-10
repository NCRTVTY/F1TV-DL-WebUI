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
});
