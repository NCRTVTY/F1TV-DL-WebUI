import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase, downloadPolicy } from "../src/server/database";
const roots: string[] = [];
function fixture() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-db-")),
  );
  roots.push(root);
  const file = path.join(root, "state.sqlite");
  return { file, db: new AppDatabase(file) };
}
const input = { url: "https://f1tv.formula1.com/detail/1/replay" };
afterEach(() => {
  for (const r of roots.splice(0))
    fs.rmSync(r, { recursive: true, force: true });
});
describe("durable download queue", () => {
  it("retains the archive feed choice across a database restart without changing modern jobs", () => {
    let { file, db } = fixture();
    const archive = db.createJob({ ...input, season: 2012 });
    const modern = db.createJob({ ...input, season: 2022 });
    db.close();
    db = new AppDatabase(file);
    expect(db.getJob(archive.id)).toMatchObject({ channel: "ORIGINAL", season: 2012, status: "queued" });
    expect(db.getJob(modern.id)).toMatchObject({ channel: "F1 LIVE", season: 2022, status: "queued" });
    db.close();
  });
  it("enforces the fixed policy even when callers supply conflicting preferences", () => {
    const { db } = fixture();
    expect(
      db.createJob({
        ...input,
        quality: "best",
        audio: "spa",
        channel: "INTERNATIONAL",
      }),
    ).toMatchObject(downloadPolicy);
    db.close();
  });
  it("preserves pause, settings and ordering across restarts; recovers interrupted work", () => {
    let { file, db } = fixture();
    const first = db.createJob(input),
      second = db.createJob(input);
    expect(db.moveUp(second.id)).toBe(true);
    expect(db.claimNext()?.id).toBe(second.id);
    db.updateProgress(second.id, 42, "Downloading");
    db.setPaused(true);
    db.setSetting("catalog-test", "retained");
    db.close();
    db = new AppDatabase(file);
    expect(db.recoverInterrupted()).toBe(1);
    expect(db.paused).toBe(true);
    expect(db.claimNext()).toBeNull();
    expect(db.getSetting("catalog-test")).toBe("retained");
    db.setPaused(false);
    expect(db.claimNext()?.id).toBe(second.id);
    db.completeJob(second.id, second.id + "/replay.mp4");
    expect(db.claimNext()?.id).toBe(first.id);
    db.close();
  });
  it("retries failures and cancellation while protecting completed and deleted jobs", () => {
    const { db } = fixture();
    const j = db.createJob(input);
    db.claimNext();
    db.failJob(j.id, "Unavailable");
    expect(db.retryJob(j.id)).toBe(true);
    db.claimNext();
    db.completeJob(j.id, j.id + "/replay.mp4");
    expect(db.retryJob(j.id)).toBe(false);
    db.updateProgress(j.id, 20, "Too late");
    expect(db.getJob(j.id)?.progress).toBe(100);
    expect(db.cancelJob(j.id)).toBe(false);
    const other = db.createJob(input);
    db.cancelJob(other.id);
    expect(db.retryJob(other.id)).toBe(true);
    db.deleteJob(other.id);
    expect(db.retryJob(other.id)).toBe(false);
    db.close();
  });
  it("holds durable deletion requests out of the worker and publishes removal events", () => {
    const { db } = fixture();
    const j = db.createJob(input);
    const removed: string[] = [];
    db.onJobRemoved((id) => removed.push(id));
    db.requestDeletion(j.id);
    expect(db.claimNext()).toBeNull();
    expect(db.pendingDeletions()).toEqual([j.id]);
    db.deleteJob(j.id);
    expect(removed).toEqual([j.id]);
    db.finishDeletion(j.id);
    expect(db.pendingDeletions()).toEqual([]);
    db.close();
  });
});
