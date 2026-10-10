import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/server/config";
import type { CredentialVault } from "../src/server/crypto";
import { AppDatabase } from "../src/server/database";
import { credentialsSettingKey, DownloadWorker } from "../src/server/downloader";

const directories: string[] = [];
const stub = path.resolve("tests/fixtures/downloader-stub.sh");
const testInactivityTimeoutMs = 1_000;
const testObservationTimeoutMs = 10_000;

function workerFixture(timeout: number) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-worker-"));
  directories.push(root);
  const downloadDir = path.join(root, "downloads");
  const db = new AppDatabase(path.join(root, "data", "test.sqlite"));
  db.setSetting(credentialsSettingKey, "opaque-test-envelope");
  const vault = {
    decrypt: () => ({ username: "", password: "" })
  } as CredentialVault;
  const worker = new DownloadWorker(db, vault, loadConfig({
    dataDir: path.join(root, "data"),
    downloadDir,
    f1tvBin: "/bin/sh",
    workerPollMs: 10,
    downloadInactivityTimeoutMs: timeout
  }));
  return { db, downloadDir, worker };
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("download worker supervision", () => {
  it("fails a silent process and advances to the next queued job", async () => {
    const { db, worker } = workerFixture(testInactivityTimeoutMs);
    const silent = db.createJob({ url: stub, quality: "silent", audio: "eng" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const next = db.createJob({ url: stub, quality: "success", audio: "eng" });

    worker.start();
    await vi.waitFor(() => {
      expect(db.getJob(silent.id)).toMatchObject({ status: "failed" });
      expect(db.getJob(next.id)).toMatchObject({ status: "completed", progress: 100 });
    }, { timeout: testObservationTimeoutMs, interval: 20 });

    expect(db.getJob(silent.id)?.message).toMatch(/inactivity/);
    worker.stop();
    db.close();
  });

  it("refreshes the inactivity watchdog when output is received", async () => {
    const { db, worker } = workerFixture(testInactivityTimeoutMs);
    const job = db.createJob({ url: stub, quality: "chatty", audio: "eng" });

    worker.start();
    await vi.waitFor(() => {
      expect(db.getJob(job.id)).toMatchObject({ status: "completed", progress: 100 });
    }, { timeout: testObservationTimeoutMs, interval: 20 });

    worker.stop();
    db.close();
  });

  it("cancels a queued job idempotently and removes its partial directory", async () => {
    const { db, downloadDir, worker } = workerFixture(1000);
    const job = db.createJob({ url: stub, quality: "best", audio: "eng" });
    const jobDirectory = path.join(downloadDir, job.id);
    fs.mkdirSync(jobDirectory, { recursive: true });
    fs.writeFileSync(path.join(jobDirectory, "partial.mp4"), "partial fixture media");

    expect(worker.cancel(job.id)).toBe(true);
    expect(worker.cancel(job.id)).toBe(true);
    await vi.waitFor(() => expect(fs.existsSync(jobDirectory)).toBe(false));
    expect(db.getJob(job.id)).toMatchObject({ status: "cancelled" });

    worker.stop();
    db.close();
  });

  it("terminates a running download and removes its partial directory", async () => {
    const { db, downloadDir, worker } = workerFixture(1000);
    const job = db.createJob({ url: stub, quality: "cancel", audio: "eng" });
    const jobDirectory = path.join(downloadDir, job.id);

    worker.start();
    await vi.waitFor(() => {
      expect(db.getJob(job.id)).toMatchObject({ status: "running" });
      expect(fs.existsSync(path.join(jobDirectory, "partial.mp4"))).toBe(true);
    }, { timeout: 3000, interval: 20 });

    expect(worker.cancel(job.id)).toBe(true);
    await vi.waitFor(() => {
      expect(db.getJob(job.id)).toMatchObject({ status: "cancelled" });
      expect(fs.existsSync(jobDirectory)).toBe(false);
    }, { timeout: 3000, interval: 20 });

    worker.stop();
    db.close();
  });

  it("quiesces a running download after its database row is hard-deleted", async () => {
    const { db, downloadDir, worker } = workerFixture(1000);
    const job = db.createJob({ url: stub, quality: "cancel", audio: "eng" });
    const jobDirectory = path.join(downloadDir, job.id);

    worker.start();
    await vi.waitFor(() => {
      expect(db.getJob(job.id)).toMatchObject({ status: "running" });
      expect(fs.existsSync(path.join(jobDirectory, "partial.mp4"))).toBe(true);
    }, { timeout: 3000, interval: 20 });

    expect(db.deleteJob(job.id)).toBe(true);
    await worker.remove(job.id);
    fs.rmSync(jobDirectory, { recursive: true, force: true });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(db.getJob(job.id)).toBeNull();
    expect(fs.existsSync(jobDirectory)).toBe(false);
    worker.stop();
    db.close();
  });

  it("retries cleanup for cancelled jobs when the worker starts", async () => {
    const { db, downloadDir, worker } = workerFixture(1000);
    const job = db.createJob({ url: stub, quality: "best", audio: "eng" });
    db.cancelJob(job.id);
    const jobDirectory = path.join(downloadDir, job.id);
    fs.mkdirSync(jobDirectory, { recursive: true });
    fs.writeFileSync(path.join(jobDirectory, "partial.mp4"), "partial fixture media");

    worker.start();
    await vi.waitFor(() => expect(fs.existsSync(jobDirectory)).toBe(false));

    worker.stop();
    db.close();
  });
});
