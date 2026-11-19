import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../src/server/database";
import { JobRemovalCoordinator } from "../src/server/removal";
import { MediaStorage } from "../src/server/storage";
import { loadConfig } from "../src/server/config";
const roots: string[] = [];
function fixture() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-removal-")),
  );
  roots.push(root);
  const downloadDir = path.join(root, "downloads");
  fs.mkdirSync(downloadDir);
  const db = new AppDatabase(path.join(root, "state.sqlite"));
  const worker = { remove: vi.fn(async () => {}) };
  const storage = new MediaStorage(
    loadConfig({ downloadDir, requireNfs: false }),
  );
  return { db, worker, downloadDir, storage };
}
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
describe("durable media removal", () => {
  it("quiesces the worker before deleting its files and never scans unrelated directories", async () => {
    const { db, worker, downloadDir, storage } = fixture();
    const j = db.createJob({
      url: "https://f1tv.formula1.com/detail/1/replay",
    });
    const dir = path.join(downloadDir, j.id),
      unrelated = path.join(downloadDir, randomUUID());
    fs.mkdirSync(dir);
    fs.mkdirSync(unrelated);
    fs.writeFileSync(path.join(dir, "replay.mp4"), "fixture");
    const coordinator = new JobRemovalCoordinator(
      db,
      worker,
      downloadDir,
      storage,
    );
    await coordinator.start();
    expect(fs.existsSync(unrelated)).toBe(true);
    await coordinator.remove(j.id);
    expect(db.getJob(j.id)).toBeNull();
    expect(worker.remove).toHaveBeenCalledWith(j.id);
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(unrelated)).toBe(true);
    await coordinator.stop();
    db.close();
  });
  it("retains an explicit cleanup request through unavailable storage and a coordinator restart", async () => {
    const { db, worker, downloadDir, storage } = fixture();
    const j = db.createJob({
      url: "https://f1tv.formula1.com/detail/1/replay",
    });
    const dir = path.join(downloadDir, j.id);
    fs.mkdirSync(dir);
    const check = vi.spyOn(storage, "check");
    check.mockResolvedValue({ ...storage.snapshot(), ready: false });
    let coordinator = new JobRemovalCoordinator(
      db,
      worker,
      downloadDir,
      storage,
    );
    await coordinator.remove(j.id);
    expect(db.getJob(j.id)).toBeNull();
    expect(db.pendingDeletions()).toEqual([j.id]);
    expect(fs.existsSync(dir)).toBe(true);
    await coordinator.stop();
    check.mockRestore();
    coordinator = new JobRemovalCoordinator(db, worker, downloadDir, storage);
    await coordinator.start();
    expect(fs.existsSync(dir)).toBe(false);
    expect(db.pendingDeletions()).toEqual([]);
    await coordinator.stop();
    db.close();
  });
});
