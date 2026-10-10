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

function workerFixture(timeout: number) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-worker-"));
  directories.push(root);
  const db = new AppDatabase(path.join(root, "data", "test.sqlite"));
  db.setSetting(credentialsSettingKey, "opaque-test-envelope");
  const vault = {
    decrypt: () => ({ username: "", password: "" })
  } as CredentialVault;
  const worker = new DownloadWorker(db, vault, loadConfig({
    dataDir: path.join(root, "data"),
    downloadDir: path.join(root, "downloads"),
    f1tvBin: "/bin/sh",
    workerPollMs: 10,
    downloadInactivityTimeoutMs: timeout
  }));
  return { db, worker };
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("download worker supervision", () => {
  it("fails a silent process and advances to the next queued job", async () => {
    const { db, worker } = workerFixture(60);
    const silent = db.createJob({ url: stub, quality: "silent", audio: "eng" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const next = db.createJob({ url: stub, quality: "success", audio: "eng" });

    worker.start();
    await vi.waitFor(() => {
      expect(db.getJob(silent.id)).toMatchObject({ status: "failed" });
      expect(db.getJob(next.id)).toMatchObject({ status: "completed", progress: 100 });
    }, { timeout: 3000, interval: 20 });

    expect(db.getJob(silent.id)?.message).toMatch(/inactivity/);
    worker.stop();
    db.close();
  });

  it("refreshes the inactivity watchdog when output is received", async () => {
    const { db, worker } = workerFixture(60);
    const job = db.createJob({ url: stub, quality: "chatty", audio: "eng" });

    worker.start();
    await vi.waitFor(() => {
      expect(db.getJob(job.id)).toMatchObject({ status: "completed", progress: 100 });
    }, { timeout: 3000, interval: 20 });

    worker.stop();
    db.close();
  });
});
