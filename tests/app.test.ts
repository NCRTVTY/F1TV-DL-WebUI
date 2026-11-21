import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app";
import { loadConfig } from "../src/server/config";
import { AppDatabase } from "../src/server/database";
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
          const event =
            block
              .split("\n")
              .find((line) => line.startsWith("event: "))
              ?.slice(7) ?? "message";
          const data =
            block
              .split("\n")
              .find((line) => line.startsWith("data: "))
              ?.slice(6) ?? "null";
          return { event, data: JSON.parse(data) as unknown };
        }

        const chunk = await reader.read();
        if (chunk.done)
          throw new Error("SSE stream ended before an event arrived");
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
  };
}

async function application(setup?: (root: string) => void) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-app-")),
  );
  directories.push(root);
  setup?.(root);
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
      requireNfs: false,
      commit: "test-commit",
    }),
  });
}

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("HTTP API", () => {
  it("keeps a fresh installation's saved account usable across restarts and rejects a changed key", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-app-key-")));
    directories.push(root);
    const config = loadConfig({ dataDir: path.join(root, "data"), downloadDir: path.join(root, "downloads"), clientDir: path.join(root, "no-client"), requireNfs: false, encryptionKey: undefined });
    let app = await buildApp({ config, startWorker: false });
    expect((await app.inject({ method: "PUT", url: "/api/settings/credentials", payload: { username: "fixture-user", password: "fixture-value" } })).statusCode).toBe(200);
    await app.close();
    app = await buildApp({ config, startWorker: false });
    const settings = await app.inject({ method: "GET", url: "/api/settings" });
    expect(settings.json()).toMatchObject({ credentialsConfigured: true, encryptionReady: true });
    expect(settings.body).not.toContain("fixture-user");
    expect(settings.body).not.toContain("fixture-value");
    await app.close();
    await expect(buildApp({ config: { ...config, encryptionKey: "different-fixture-key".repeat(2) }, startWorker: false })).rejects.toThrow("restore the original encryption key");
  });
  it("reports health without exposing configuration values", async () => {
    const app = await application();
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      commit: "test-commit",
      storage: { writable: true },
    });
    expect(response.body).not.toContain("xxxxxxxx");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'self'",
    );
    await app.close();
  });

  it("browses the current F1 season without returning provider URLs", async () => {
    const app = await application();
    const seasons = await app.inject({
      method: "GET",
      url: "/api/catalog/seasons",
    });
    expect(seasons.statusCode).toBe(200);
    expect(seasons.json().data[0]).toMatchObject({ year: 2026, current: true });

    const events = await app.inject({
      method: "GET",
      url: "/api/catalog/seasons/100/events",
    });
    expect(events.json().data[0]).toMatchObject({
      id: "p500",
      country: "Australia",
    });
    expect(events.json().data).toHaveLength(4);
    expect(events.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          country: "Singapore",
          status: "current",
          replayAvailable: false,
        }),
        expect.objectContaining({
          country: "United States",
          status: "future",
          replayAvailable: false,
        }),
      ]),
    );

    const sessions = await app.inject({
      method: "GET",
      url: "/api/catalog/events/p500/sessions",
    });
    expect(sessions.json().data).toHaveLength(1);
    expect(sessions.body).not.toContain("f1tv.formula1.com/detail");
    await app.close();
  });

  it("requires credentials before a catalog session can be queued", async () => {
    const app = await application();
    const response = await app.inject({
      method: "POST",
      url: "/api/catalog/sessions/700/download",
      payload: { eventId: "p500" },
    });
    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it("stores credentials opaquely and queues the F1 LIVE feed by default", async () => {
    const app = await application();
    const saved = await app.inject({
      method: "PUT",
      url: "/api/settings/credentials",
      payload: { username: "fixture-user", password: "fixture-value" },
    });
    expect(saved.statusCode).toBe(200);

    const settings = await app.inject({ method: "GET", url: "/api/settings" });
    expect(settings.json()).toMatchObject({
      credentialsConfigured: true,
      encryptionReady: true,
      policy: { quality: "1280x720", audio: "eng", channel: "F1 LIVE" },
    });
    expect(settings.body).not.toContain("fixture-user");
    expect(settings.body).not.toContain("fixture-value");

    await app.inject({ method: "GET", url: "/api/catalog/seasons/100/events" });

    const created = await app.inject({
      method: "POST",
      url: "/api/catalog/sessions/700/download",
      payload: { eventId: "p500" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().job).toMatchObject({
      contentId: "700",
      quality: "1280x720",
      audio: "eng",
      channel: "F1 LIVE",
    });
    const id = created.json().job.id as string;

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/catalog/sessions/700/download",
      payload: { eventId: "p500" },
    });
    expect(duplicate.statusCode).toBe(409);

    const listed = await app.inject({ method: "GET", url: "/api/jobs" });
    expect(listed.json().jobs).toHaveLength(1);

    const cancelled = await app.inject({
      method: "POST",
      url: `/api/jobs/${id}/cancel`,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().job.status).toBe("cancelled");

    const cancelledAgain = await app.inject({
      method: "POST",
      url: `/api/jobs/${id}/cancel`,
    });
    expect(cancelledAgain.statusCode).toBe(200);
    expect(cancelledAgain.json().job.status).toBe("cancelled");

    const requeued = await app.inject({
      method: "POST",
      url: "/api/catalog/sessions/700/download",
      payload: { eventId: "p500" },
    });
    expect(requeued.statusCode).toBe(201);
    expect(requeued.json().job).toMatchObject({
      contentId: "700",
      status: "queued",
    });
    expect(requeued.json().job.id).not.toBe(id);
    await app.close();
  });

  it("persists queue pause and omits the removed feed preference endpoint", async () => {
    const app = await application();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/queue",
          payload: { paused: true },
        })
      ).json(),
    ).toEqual({ paused: true });
    expect(
      (await app.inject({ method: "GET", url: "/api/settings" })).json().paused,
    ).toBe(true);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/settings/default-feed",
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/queue",
          payload: { paused: "yes" },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });

  it("does not expose the legacy URL submission route", async () => {
    const app = await application();
    const response = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { url: "https://example.com/detail/100" },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("returns one job by ID and reports a missing job", async () => {
    const app = await application();
    await app.inject({
      method: "PUT",
      url: "/api/settings/credentials",
      payload: { username: "fixture-user", password: "fixture-value" },
    });
    await app.inject({ method: "GET", url: "/api/catalog/seasons/100/events" });
    const created = await app.inject({
      method: "POST",
      url: "/api/catalog/sessions/700/download",
      payload: { eventId: "p500" },
    });
    const job = created.json().job;

    const found = await app.inject({
      method: "GET",
      url: `/api/jobs/${job.id}`,
    });
    expect(found.statusCode).toBe(200);
    expect(found.json().job).toMatchObject({ id: job.id, status: "queued" });

    const missing = await app.inject({
      method: "GET",
      url: "/api/jobs/not-present",
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it("removes queued, running, failed, cancelled, and completed jobs with their files", async () => {
    const jobIds: string[] = [];
    let completedId = "";
    let downloadRoot = "";
    const app = await application((root) => {
      downloadRoot = path.join(root, "downloads");
      const db = new AppDatabase(
        path.join(root, "data", "f1tv-dl-webui.sqlite"),
      );

      const running = db.createJob({
        url: "https://f1tv.formula1.com/detail/1/running",
        quality: "best",
        audio: "eng",
      });
      db.claimNext();
      const failed = db.createJob({
        url: "https://f1tv.formula1.com/detail/2/failed",
        quality: "best",
        audio: "eng",
      });
      db.claimNext();
      db.failJob(failed.id, "Fixture failure");
      const cancelled = db.createJob({
        url: "https://f1tv.formula1.com/detail/3/cancelled",
        quality: "best",
        audio: "eng",
      });
      db.cancelJob(cancelled.id);
      const completed = db.createJob({
        url: "https://f1tv.formula1.com/detail/4/completed",
        quality: "best",
        audio: "eng",
      });
      db.claimNext();
      db.completeJob(completed.id, `${completed.id}/race.mp4`);
      const queued = db.createJob({
        url: "https://f1tv.formula1.com/detail/5/queued",
        quality: "best",
        audio: "eng",
      });

      completedId = completed.id;
      jobIds.push(running.id, failed.id, cancelled.id, completed.id, queued.id);
      for (const id of jobIds) {
        const directory = path.join(downloadRoot, id);
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, "fixture.mp4"), "fixture media");
      }
      db.close();
    });

    for (const id of jobIds) {
      const response = await app.inject({
        method: "DELETE",
        url: `/api/jobs/${id}`,
      });
      expect(response.statusCode).toBe(204);
    }

    const listed = await app.inject({ method: "GET", url: "/api/jobs" });
    expect(listed.json().jobs).toEqual([]);
    for (const id of jobIds)
      expect(fs.existsSync(path.join(downloadRoot, id))).toBe(false);
    expect(
      (await app.inject({ method: "DELETE", url: `/api/jobs/${completedId}` }))
        .statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: "DELETE", url: "/api/jobs/not-a-uuid" }))
        .statusCode,
    ).toBe(400);
    await app.close();
  });

  it("broadcasts job removal without a stale update", async () => {
    const app = await application();
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const response = await fetch(`${address}/api/jobs/events`);
    const events = eventReader(response);
    await app.inject({
      method: "PUT",
      url: "/api/settings/credentials",
      payload: { username: "fixture-user", password: "fixture-value" },
    });
    await app.inject({ method: "GET", url: "/api/catalog/seasons/100/events" });
    const created = await app.inject({
      method: "POST",
      url: "/api/catalog/sessions/700/download",
      payload: { eventId: "p500" },
    });
    const jobId = created.json().job.id as string;

    expect(
      (await app.inject({ method: "DELETE", url: `/api/jobs/${jobId}` }))
        .statusCode,
    ).toBe(204);
    expect(await events.next()).toEqual({
      event: "job-removed",
      data: { jobId },
    });
    expect(
      (await app.inject({ method: "GET", url: `/api/jobs/${jobId}` }))
        .statusCode,
    ).toBe(404);

    await events.cancel();
    await app.close();
  });

  it("coalesces a job's changes into a per-job SSE update and preserves its terminal state", async () => {
    const app = await application();
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const response = await fetch(`${address}/api/jobs/events`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe(
      "no-cache, no-transform",
    );
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const events = eventReader(response);

    await app.inject({
      method: "PUT",
      url: "/api/settings/credentials",
      payload: { username: "fixture-user", password: "fixture-value" },
    });
    await app.inject({ method: "GET", url: "/api/catalog/seasons/100/events" });
    const created = await app.inject({
      method: "POST",
      url: "/api/catalog/sessions/700/download",
      payload: { eventId: "p500" },
    });
    const jobId = created.json().job.id as string;
    const cancelled = await app.inject({
      method: "POST",
      url: `/api/jobs/${jobId}/cancel`,
    });
    expect(cancelled.statusCode).toBe(200);

    const update = await events.next();
    expect(update).toEqual({ event: "job-update", data: { jobId } });
    expect(JSON.stringify(update.data)).not.toContain("formula1.com");

    const current = await app.inject({
      method: "GET",
      url: `/api/jobs/${jobId}`,
    });
    expect(current.json().job).toMatchObject({
      id: jobId,
      status: "cancelled",
      message: "Cancelled",
    });

    await events.cancel();
    await app.close();
  });

  it("serves one MP4 with exact size, seek ranges, and a browser attachment", async () => {
    let jobId = "";
    const media = Buffer.from("native fixture media");
    const app = await application((root) => {
      const db = new AppDatabase(
        path.join(root, "data", "f1tv-dl-webui.sqlite"),
      );
      const j = db.createJob({
        url: "https://f1tv.formula1.com/detail/1/replay",
        title: "2026 São Paulo GP",
      });
      jobId = j.id;
      db.claimNext();
      const dir = path.join(root, "downloads", j.id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "replay.mp4"), media);
      db.completeJob(j.id, j.id + "/replay.mp4", media.length);
      db.close();
    });
    const listed = (
      await app.inject({ method: "GET", url: "/api/jobs" })
    ).json();
    expect(listed.jobs[0]).toMatchObject({
      file: { available: true, size: media.length },
    });
    expect(listed.jobs[0].files).toBeUndefined();
    const partial = await app.inject({
      method: "GET",
      url: "/api/downloads/" + jobId + "/file?download=1",
      headers: { range: "bytes=0-5" },
    });
    expect(partial.statusCode).toBe(206);
    expect(partial.body).toBe("native");
    expect(partial.headers["content-range"]).toBe("bytes 0-5/" + media.length);
    expect(partial.headers["content-disposition"]).toContain("attachment");
    expect(
      decodeURIComponent(partial.headers["content-disposition"] as string),
    ).toContain("2026 São Paulo GP - 720p.mp4");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/downloads/" + jobId + "/file",
          headers: { range: "bytes=999-" },
        })
      ).statusCode,
    ).toBe(416);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/downloads/" + jobId + "/lq/retry",
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });
  it("retries failed work and moves queued work without duplicating rows", async () => {
    let jobId = "",
      nextId = "";
    const app = await application((root) => {
      const db = new AppDatabase(
        path.join(root, "data", "f1tv-dl-webui.sqlite"),
      );
      const j = db.createJob({
        url: "https://f1tv.formula1.com/detail/1/replay",
        title: "2026 São Paulo GP",
      });
      jobId = j.id;
      db.claimNext();
      db.failJob(j.id, "Provider unavailable");
      nextId = db.createJob({
        url: "https://f1tv.formula1.com/detail/2/replay",
      }).id;
      db.close();
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/jobs/" + jobId + "/retry",
        })
      ).json().job.status,
    ).toBe("queued");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/jobs/" + jobId + "/retry",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/jobs/" + nextId + "/move-up",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/api/jobs" })).json().jobs,
    ).toHaveLength(2);
    await app.close();
  });
});
