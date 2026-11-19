import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaStorage } from "../src/server/storage";
import { loadConfig } from "../src/server/config";
import type { CredentialVault } from "../src/server/crypto";
import { AppDatabase } from "../src/server/database";
import {
  credentialsSettingKey,
  DownloadWorker,
} from "../src/server/downloader";

const directories: string[] = [];
const stub = path.resolve("tests/fixtures/downloader-stub.sh");
const testInactivityTimeoutMs = 1_000;
const testObservationTimeoutMs = 10_000;

function workerFixture(timeout: number) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-worker-")),
  );
  directories.push(root);
  const downloadDir = path.join(root, "downloads");
  const db = new AppDatabase(path.join(root, "data", "test.sqlite"));
  db.setSetting(credentialsSettingKey, "opaque-test-envelope");
  const vault = {
    decrypt: () => ({ username: "", password: "" }),
  } as CredentialVault;
  const config = loadConfig({
    dataDir: path.join(root, "data"),
    downloadDir,
    f1tvBin: stub,
    requireNfs: false,
    workerPollMs: 10,
    downloadInactivityTimeoutMs: timeout,
  });
  const storage = new MediaStorage(config);
  const worker = new DownloadWorker(db, vault, config, storage, async () => ({
    size: 13,
    durationSeconds: 1,
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1280,
    height: 720,
    frameRate: "50/1",
  }));
  return { db, downloadDir, worker, storage };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("download worker supervision", () => {
  it("fails a silent process and advances to the next queued job", async () => {
    const { db, worker } = workerFixture(testInactivityTimeoutMs);
    const silent = db.createJob({
      url: "https://f1tv.formula1.com/detail/1/silent",
      audio: "eng",
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const next = db.createJob({
      url: "https://f1tv.formula1.com/detail/1/success",
      audio: "eng",
    });

    worker.start();
    await vi.waitFor(
      () => {
        expect(db.getJob(silent.id)).toMatchObject({ status: "failed" });
        expect(db.getJob(next.id)).toMatchObject({
          status: "completed",
          progress: 100,
        });
      },
      { timeout: testObservationTimeoutMs, interval: 20 },
    );

    expect(db.getJob(silent.id)?.message).toMatch(/inactivity/);
    await worker.stop();
    db.close();
  });

  it("refreshes the inactivity watchdog when output is received", async () => {
    const { db, worker } = workerFixture(testInactivityTimeoutMs);
    const job = db.createJob({
      url: "https://f1tv.formula1.com/detail/1/chatty",
      audio: "eng",
    });

    worker.start();
    await vi.waitFor(
      () => {
        expect(db.getJob(job.id)).toMatchObject({
          status: "completed",
          progress: 100,
        });
      },
      { timeout: testObservationTimeoutMs, interval: 20 },
    );

    await worker.stop();
    db.close();
  });

  it("cancels a queued job idempotently and removes its partial directory", async () => {
    const { db, downloadDir, worker } = workerFixture(1000);
    const job = db.createJob({
      url: "https://f1tv.formula1.com/detail/1/best",
      audio: "eng",
    });
    const jobDirectory = path.join(downloadDir, job.id);
    fs.mkdirSync(path.join(jobDirectory, ".staging"), { recursive: true });
    fs.writeFileSync(
      path.join(jobDirectory, ".staging", "partial.mp4"),
      "partial fixture media",
    );

    expect(worker.cancel(job.id)).toBe(true);
    expect(worker.cancel(job.id)).toBe(true);
    await vi.waitFor(() => expect(fs.existsSync(jobDirectory)).toBe(false));
    expect(db.getJob(job.id)).toMatchObject({ status: "cancelled" });

    await worker.stop();
    db.close();
  });

  it("terminates a running download and removes its partial directory", async () => {
    const { db, downloadDir, worker } = workerFixture(1000);
    const job = db.createJob({
      url: "https://f1tv.formula1.com/detail/1/cancel",
      audio: "eng",
    });
    const jobDirectory = path.join(downloadDir, job.id);

    worker.start();
    await vi.waitFor(
      () => {
        expect(db.getJob(job.id)).toMatchObject({ status: "running" });
        expect(
          fs.existsSync(path.join(jobDirectory, ".staging", "partial.mp4")),
        ).toBe(true);
      },
      { timeout: 3000, interval: 20 },
    );

    expect(worker.cancel(job.id)).toBe(true);
    await vi.waitFor(
      () => {
        expect(db.getJob(job.id)).toMatchObject({ status: "cancelled" });
        expect(fs.existsSync(jobDirectory)).toBe(false);
      },
      { timeout: 3000, interval: 20 },
    );

    await worker.stop();
    db.close();
  });

  it("quiesces a running download after its database row is hard-deleted", async () => {
    const { db, downloadDir, worker } = workerFixture(1000);
    const job = db.createJob({
      url: "https://f1tv.formula1.com/detail/1/cancel",
      audio: "eng",
    });
    const jobDirectory = path.join(downloadDir, job.id);

    worker.start();
    await vi.waitFor(
      () => {
        expect(db.getJob(job.id)).toMatchObject({ status: "running" });
        expect(
          fs.existsSync(path.join(jobDirectory, ".staging", "partial.mp4")),
        ).toBe(true);
      },
      { timeout: 3000, interval: 20 },
    );

    expect(db.deleteJob(job.id)).toBe(true);
    await worker.remove(job.id);
    fs.rmSync(jobDirectory, { recursive: true, force: true });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(db.getJob(job.id)).toBeNull();
    expect(fs.existsSync(jobDirectory)).toBe(false);
    await worker.stop();
    db.close();
  });

  it("retries cleanup for cancelled jobs when the worker starts", async () => {
    const { db, downloadDir, worker } = workerFixture(1000);
    const job = db.createJob({
      url: "https://f1tv.formula1.com/detail/1/best",
      audio: "eng",
    });
    db.cancelJob(job.id);
    const jobDirectory = path.join(downloadDir, job.id);
    fs.mkdirSync(path.join(jobDirectory, ".staging"), { recursive: true });
    fs.writeFileSync(
      path.join(jobDirectory, ".staging", "partial.mp4"),
      "partial fixture media",
    );

    worker.start();
    await vi.waitFor(() => expect(fs.existsSync(jobDirectory)).toBe(false));

    await worker.stop();
    db.close();
  });
});

describe("queue safety gates", () => {
  it("leaves work queued while paused or storage is unavailable, then resumes", async () => {
    const { db, worker, storage } = workerFixture(1000);
    const j = db.createJob({
      url: "https://f1tv.formula1.com/detail/1/success",
    });
    db.setPaused(true);
    worker.start();
    await new Promise((r) => setTimeout(r, 50));
    expect(db.getJob(j.id)?.status).toBe("queued");
    const check = vi
      .spyOn(storage, "check")
      .mockResolvedValue({
        ...storage.snapshot(),
        ready: false,
        writable: false,
        enoughSpace: false,
      });
    db.setPaused(false);
    worker.wake();
    await vi.waitFor(() => expect(check).toHaveBeenCalled());
    expect(db.getJob(j.id)?.status).toBe("queued");
    check.mockRestore();
    worker.wake();
    await vi.waitFor(() => expect(db.getJob(j.id)?.status).toBe("completed"));
    await worker.stop();
    db.close();
  });
  it("awaits shutdown without marking interrupted work complete", async () => {
    const { db, worker, downloadDir } = workerFixture(1000);
    const j = db.createJob({
      url: "https://f1tv.formula1.com/detail/1/cancel",
    });
    worker.start();
    await vi.waitFor(() =>
      expect(
        fs.existsSync(path.join(downloadDir, j.id, ".staging", "partial.mp4")),
      ).toBe(true),
    );
    await worker.stop();
    expect(db.getJob(j.id)?.status).toBe("running");
    expect(db.recoverInterrupted()).toBe(1);
    expect(db.getJob(j.id)?.status).toBe("queued");
    db.close();
  });
});
