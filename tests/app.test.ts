import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app";
import { loadConfig } from "../src/server/config";

const directories: string[] = [];

async function application() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-app-"));
  directories.push(root);
  return buildApp({
    startWorker: false,
    config: loadConfig({
      dataDir: path.join(root, "data"),
      downloadDir: path.join(root, "downloads"),
      clientDir: path.join(root, "missing-client"),
      encryptionKey: "x".repeat(32),
      commit: "test-commit"
    })
  });
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("HTTP API", () => {
  it("reports health without exposing configuration values", async () => {
    const app = await application();
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, commit: "test-commit", storage: { writable: true } });
    expect(response.body).not.toContain("xxxxxxxx");
    await app.close();
  });

  it("requires credentials before a job can be queued", async () => {
    const app = await application();
    const response = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { url: "https://f1tv.formula1.com/detail/100/example-session" }
    });
    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it("stores credentials opaquely, queues, lists, and cancels a job", async () => {
    const app = await application();
    const saved = await app.inject({
      method: "PUT",
      url: "/api/settings/credentials",
      payload: { username: "fixture-user", password: "fixture-value" }
    });
    expect(saved.statusCode).toBe(200);

    const settings = await app.inject({ method: "GET", url: "/api/settings" });
    expect(settings.json()).toEqual({ credentialsConfigured: true, encryptionReady: true, port: 43729 });
    expect(settings.body).not.toContain("fixture-user");
    expect(settings.body).not.toContain("fixture-value");

    const created = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { url: "https://f1tv.formula1.com/detail/100/example-session", quality: "best", audio: "eng" }
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().job.id as string;

    const listed = await app.inject({ method: "GET", url: "/api/jobs" });
    expect(listed.json().jobs).toHaveLength(1);

    const cancelled = await app.inject({ method: "POST", url: `/api/jobs/${id}/cancel` });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().job.status).toBe("cancelled");
    await app.close();
  });

  it("rejects a non-F1 URL", async () => {
    const app = await application();
    await app.inject({
      method: "PUT",
      url: "/api/settings/credentials",
      payload: { username: "fixture-user", password: "fixture-value" }
    });
    const response = await app.inject({ method: "POST", url: "/api/jobs", payload: { url: "https://example.com/detail/100" } });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
