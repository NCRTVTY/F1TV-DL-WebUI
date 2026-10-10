import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app";
import { loadConfig } from "../src/server/config";
import { fixtureCalendarFetch, fixtureFetch } from "./catalog-fixtures";

const directories: string[] = [];

function eventReader(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return {
    cancel: () => reader.cancel(),
    async next(): Promise<{ event: string; data: unknown }> {
      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (!block || block.startsWith(":")) continue;
          const event = block.split("\n").find((line) => line.startsWith("event: "))?.slice(7) ?? "message";
          const data = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6) ?? "null";
          return { event, data: JSON.parse(data) as unknown };
        }

        const chunk = await reader.read();
        if (chunk.done) throw new Error("SSE stream ended before an event arrived");
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    }
  };
}

async function application() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-app-"));
  directories.push(root);
  return buildApp({
    startWorker: false,
    catalogFetch: fixtureFetch,
    calendarFetch: fixtureCalendarFetch,
    now: () => new Date("2026-10-10T12:00:00Z"),
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
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    await app.close();
  });

  it("browses the current F1 season without returning provider URLs", async () => {
    const app = await application();
    const seasons = await app.inject({ method: "GET", url: "/api/catalog/seasons" });
    expect(seasons.statusCode).toBe(200);
    expect(seasons.json().data[0]).toMatchObject({ year: 2026, current: true });

    const events = await app.inject({ method: "GET", url: "/api/catalog/seasons/100/events" });
    expect(events.json().data[0]).toMatchObject({ id: "p500", country: "Australia" });
    expect(events.json().data).toHaveLength(4);
    expect(events.json().data).toEqual(expect.arrayContaining([
      expect.objectContaining({ country: "Singapore", status: "current", replayAvailable: false }),
      expect.objectContaining({ country: "United States", status: "future", replayAvailable: false })
    ]));

    const sessions = await app.inject({ method: "GET", url: "/api/catalog/events/p500/sessions" });
    expect(sessions.json().data).toHaveLength(1);
    expect(sessions.body).not.toContain("f1tv.formula1.com/detail");
    await app.close();
  });

  it("requires credentials before a catalog session can be queued", async () => {
    const app = await application();
    const response = await app.inject({ method: "POST", url: "/api/catalog/sessions/700/download", payload: { eventId: "p500" } });
    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it("stores credentials opaquely and queues INTERNATIONAL feed once", async () => {
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

    await app.inject({ method: "GET", url: "/api/catalog/seasons/100/events" });

    const created = await app.inject({
      method: "POST",
      url: "/api/catalog/sessions/700/download",
      payload: { eventId: "p500" }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().job).toMatchObject({ contentId: "700", quality: "best", audio: "eng", channel: "INTERNATIONAL" });
    const id = created.json().job.id as string;

    const duplicate = await app.inject({ method: "POST", url: "/api/catalog/sessions/700/download", payload: { eventId: "p500" } });
    expect(duplicate.statusCode).toBe(409);

    const listed = await app.inject({ method: "GET", url: "/api/jobs" });
    expect(listed.json().jobs).toHaveLength(1);

    const cancelled = await app.inject({ method: "POST", url: `/api/jobs/${id}/cancel` });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().job.status).toBe("cancelled");
    await app.close();
  });

  it("does not expose the legacy URL submission route", async () => {
    const app = await application();
    const response = await app.inject({ method: "POST", url: "/api/jobs", payload: { url: "https://example.com/detail/100" } });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("returns one job by ID and reports a missing job", async () => {
    const app = await application();
    await app.inject({
      method: "PUT",
      url: "/api/settings/credentials",
      payload: { username: "fixture-user", password: "fixture-value" }
    });
    await app.inject({ method: "GET", url: "/api/catalog/seasons/100/events" });
    const created = await app.inject({
      method: "POST",
      url: "/api/catalog/sessions/700/download",
      payload: { eventId: "p500" }
    });
    const job = created.json().job;

    const found = await app.inject({ method: "GET", url: `/api/jobs/${job.id}` });
    expect(found.statusCode).toBe(200);
    expect(found.json().job).toMatchObject({ id: job.id, status: "queued" });

    const missing = await app.inject({ method: "GET", url: "/api/jobs/not-present" });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it("coalesces a job's changes into a per-job SSE update and preserves its terminal state", async () => {
    const app = await application();
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const response = await fetch(`${address}/api/jobs/events`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const events = eventReader(response);

    await app.inject({
      method: "PUT",
      url: "/api/settings/credentials",
      payload: { username: "fixture-user", password: "fixture-value" }
    });
    await app.inject({ method: "GET", url: "/api/catalog/seasons/100/events" });
    const created = await app.inject({
      method: "POST",
      url: "/api/catalog/sessions/700/download",
      payload: { eventId: "p500" }
    });
    const jobId = created.json().job.id as string;
    const cancelled = await app.inject({ method: "POST", url: `/api/jobs/${jobId}/cancel` });
    expect(cancelled.statusCode).toBe(200);

    const update = await events.next();
    expect(update).toEqual({ event: "job-update", data: { jobId } });
    expect(JSON.stringify(update.data)).not.toContain("formula1.com");

    const current = await app.inject({ method: "GET", url: `/api/jobs/${jobId}` });
    expect(current.json().job).toMatchObject({ id: jobId, status: "cancelled", message: "Cancelled" });

    await events.cancel();
    await app.close();
  });
});
