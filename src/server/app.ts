import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "./config";
import { CatalogService, type CalendarFetch, type CatalogFetch } from "./catalog";
import { CredentialVault } from "./crypto";
import { AppDatabase, type Job } from "./database";
import { credentialsSettingKey, DownloadWorker } from "./downloader";
import { ConversionWorker } from "./converter";
import { fileMetadata, parseRange, resolveStoredFile } from "./files";
import { isJobId, JobRemovalCoordinator } from "./removal";
import { catalogDownloadSchema, catalogRefreshSchema, credentialsSchema, defaultFeedSchema } from "./validation";

export interface BuildAppOptions {
  config: AppConfig;
  startWorker?: boolean;
  catalogFetch?: CatalogFetch;
  calendarFetch?: CalendarFetch;
  now?: () => Date;
}

export async function buildApp({ config, startWorker = true, catalogFetch, calendarFetch, now }: BuildAppOptions): Promise<FastifyInstance> {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.downloadDir, { recursive: true });

  const app = Fastify({
    logger: process.env.NODE_ENV !== "test" ? {
      level: process.env.LOG_LEVEL || "info",
      redact: ["req.headers.authorization", "req.headers.cookie"]
    } : false,
    bodyLimit: 32 * 1024
  });
  const db = new AppDatabase(path.join(config.dataDir, "f1tv-dl-webui.sqlite"));
  const vault = new CredentialVault(config.encryptionKey);
  const worker = new DownloadWorker(db, vault, config);
  const conversionWorker = new ConversionWorker(db, config);
  const removalCoordinator = new JobRemovalCoordinator(
    db,
    worker,
    conversionWorker,
    config.downloadDir,
    (jobId) => app.log.warn({ jobId }, "Download directory cleanup will be retried")
  );
  const catalog = new CatalogService(db, catalogFetch, now, calendarFetch);
  const eventStreams = new Set<PassThrough>();

  await removalCoordinator.start();
  if (startWorker) {
    worker.start();
    conversionWorker.start();
  }

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    reply.header("Content-Security-Policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: https://f1tv.formula1.com; connect-src 'self'; script-src 'self'; style-src 'self'");
    if (request.url === "/api/jobs/events") reply.header("Cache-Control", "no-cache, no-transform");
    else if (request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    return payload;
  });

  app.addHook("preClose", async () => {
    for (const stream of eventStreams) stream.end();
    eventStreams.clear();
  });

  app.addHook("onClose", async () => {
    removalCoordinator.stop();
    worker.stop();
    conversionWorker.stop();
    db.close();
  });

  const presentJob = async (job: Job) => {
    if (job.status !== "completed" || !job.outputFile) return job;
    const conversion = db.getConversionJob(job.id);
    let hqSize: number | null = null;
    let lqSize: number | null = null;
    try {
      hqSize = (await fileMetadata(resolveStoredFile(config.downloadDir, job.outputFile))).size;
    } catch {
      // A missing file remains represented so the UI can report it through the file endpoint.
    }
    if (conversion?.status === "completed" && conversion.outputFile) {
      try {
        lqSize = (await fileMetadata(resolveStoredFile(config.downloadDir, conversion.outputFile))).size;
      } catch {
        // Startup reconciliation will rebuild or re-adopt a missing mobile file.
      }
    }
    return {
      ...job,
      files: {
        hq: {
          available: hqSize !== null,
          size: hqSize,
          url: `/api/downloads/${encodeURIComponent(job.id)}/file?variant=hq`
        },
        lq: {
          status: conversion?.status ?? "queued",
          progress: conversion?.progress ?? 0,
          message: conversion?.message ?? "Waiting to create mobile MP4",
          available: conversion?.status === "completed" && lqSize !== null,
          size: lqSize,
          sourceReused: conversion?.sourceReused ?? false,
          url: conversion?.status === "completed" ? `/api/downloads/${encodeURIComponent(job.id)}/file?variant=lq` : null
        }
      }
    };
  };

  app.setErrorHandler((error, _request, reply) => {
    const candidate = error as { statusCode?: number; message?: string };
    const status = candidate.statusCode && candidate.statusCode >= 400 ? candidate.statusCode : 500;
    const message = status >= 500 ? "The server could not complete the request" : candidate.message || "Request failed";
    reply.status(status).send({ error: message });
  });

  app.get("/api/health", async () => {
    await Promise.all([
      fs.promises.access(config.dataDir, fs.constants.W_OK),
      fs.promises.access(config.downloadDir, fs.constants.W_OK)
    ]);
    return {
      ok: true,
      commit: config.commit,
      storage: { writable: true },
      credentialsConfigured: Boolean(db.getSetting(credentialsSettingKey)),
      queue: db.counts()
    };
  });

  app.get("/api/settings", async () => ({
    credentialsConfigured: Boolean(db.getSetting(credentialsSettingKey)),
    encryptionReady: vault.ready,
    port: config.port,
    defaultFeed: db.getDefaultFeed()
  }));

  app.put("/api/settings/default-feed", async (request, reply) => {
    const parsed = defaultFeedSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Choose a supported default feed" });
    const updatedJobs = db.setDefaultFeed(parsed.data.defaultFeed);
    return reply.send({ defaultFeed: parsed.data.defaultFeed, updatedJobs });
  });

  app.put("/api/settings/credentials", async (request, reply) => {
    if (!vault.ready) return reply.status(503).send({ error: "Credential encryption is not configured" });
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Enter both an F1 TV username and password" });
    db.setSetting(credentialsSettingKey, vault.encrypt(parsed.data));
    return reply.send({ credentialsConfigured: true });
  });

  app.delete("/api/settings/credentials", async (_request, reply) => {
    db.deleteSetting(credentialsSettingKey);
    return reply.status(204).send();
  });

  app.get("/api/jobs", async () => ({ jobs: await Promise.all(db.listJobs().map(presentJob)) }));

  app.get("/api/jobs/events", async (_request, reply) => {
    const stream = new PassThrough();
    const pendingJobIds = new Set<string>();
    const pendingRemovedJobIds = new Set<string>();
    const unsubscribe = db.onJobChanged((jobId) => {
      if (!pendingRemovedJobIds.has(jobId)) pendingJobIds.add(jobId);
    });
    const unsubscribeConversions = db.onConversionChanged((jobId) => {
      if (!pendingRemovedJobIds.has(jobId)) pendingJobIds.add(jobId);
    });
    const unsubscribeRemovals = db.onJobRemoved((jobId) => {
      pendingJobIds.delete(jobId);
      pendingRemovedJobIds.add(jobId);
    });
    const flush = setInterval(() => {
      for (const jobId of pendingRemovedJobIds) {
        stream.write(`event: job-removed\ndata: ${JSON.stringify({ jobId })}\n\n`);
      }
      for (const jobId of pendingJobIds) {
        stream.write(`event: job-update\ndata: ${JSON.stringify({ jobId })}\n\n`);
      }
      pendingRemovedJobIds.clear();
      pendingJobIds.clear();
    }, 500);
    flush.unref();

    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(flush);
      unsubscribe();
      unsubscribeConversions();
      unsubscribeRemovals();
      eventStreams.delete(stream);
    };
    reply.raw.once("close", close);
    stream.once("close", close);
    eventStreams.add(stream);

    stream.write(": connected\n\n");
    reply.type("text/event-stream; charset=utf-8");
    reply.header("Connection", "keep-alive");
    reply.header("X-Accel-Buffering", "no");
    return reply.send(stream);
  });

  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (request, reply) => {
    const job = db.getJob(request.params.id);
    if (!job) return reply.status(404).send({ error: "Download not found" });
    return reply.send({ job: await presentJob(job) });
  });

  const catalogError = (reply: FastifyReply, error: unknown) => {
    const message = error instanceof Error ? error.message : "F1TV catalog request failed";
    return reply.status(502).send({ error: message.slice(0, 240) });
  };

  app.get("/api/catalog/seasons", async (_request, reply) => {
    try {
      return reply.send(await catalog.seasons());
    } catch (error) {
      return catalogError(reply, error);
    }
  });

  app.get<{ Params: { seasonId: string } }>("/api/catalog/seasons/:seasonId/events", async (request, reply) => {
    if (!/^\d+$/.test(request.params.seasonId)) return reply.status(400).send({ error: "Invalid season identifier" });
    try {
      return reply.send(await catalog.events(request.params.seasonId));
    } catch (error) {
      return catalogError(reply, error);
    }
  });

  app.get<{ Params: { eventId: string } }>("/api/catalog/events/:eventId/sessions", async (request, reply) => {
    if (!/^(?:p\d+|s\d+-m\d+)$/.test(request.params.eventId)) return reply.status(400).send({ error: "Invalid event identifier" });
    try {
      const result = await catalog.sessions(request.params.eventId);
      return reply.send({ ...result, data: result.data.map(({ url: _url, ...session }) => session) });
    } catch (error) {
      return catalogError(reply, error);
    }
  });

  app.post("/api/catalog/refresh", async (request, reply) => {
    const parsed = catalogRefreshSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid catalog refresh request" });
    try {
      if (parsed.data.scope === "seasons") return reply.send(await catalog.seasons(true));
      if (parsed.data.scope === "events") return reply.send(await catalog.events(parsed.data.id, true));
      const result = await catalog.sessions(parsed.data.id, true);
      return reply.send({ ...result, data: result.data.map(({ url: _url, ...session }) => session) });
    } catch (error) {
      return catalogError(reply, error);
    }
  });

  app.post<{ Params: { contentId: string } }>("/api/catalog/sessions/:contentId/download", async (request, reply) => {
    if (!/^\d+$/.test(request.params.contentId)) return reply.status(400).send({ error: "Invalid session identifier" });
    const parsed = catalogDownloadSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid event identifier" });
    if (!db.getSetting(credentialsSettingKey)) {
      return reply.status(409).send({ error: "Configure F1 TV credentials before adding a download" });
    }
    let sessions;
    try {
      sessions = (await catalog.sessions(parsed.data.eventId)).data;
    } catch (error) {
      return catalogError(reply, error);
    }
    const session = sessions.find((candidate) => candidate.id === request.params.contentId);
    if (!session) return reply.status(404).send({ error: "Session is not present in this F1TV event" });
    if (!session.available) return reply.status(409).send({ error: "This session is not yet available as a replay" });
    const existing = db.findActiveOrCompletedByContentId(session.id);
    if (existing) return reply.status(409).send({ error: `This session is already ${existing.status}`, job: existing });
    const job = db.createJob({
      url: session.url,
      quality: "best",
      audio: "eng",
      channel: db.getDefaultFeed(),
      contentId: session.id,
      title: session.title
    });
    if (startWorker) worker.wake();
    return reply.status(201).send({ job });
  });

  app.post<{ Params: { id: string } }>("/api/jobs/:id/cancel", async (request, reply) => {
    const job = db.getJob(request.params.id);
    if (!job) return reply.status(404).send({ error: "Download not found" });
    if (!worker.cancel(job.id)) return reply.status(409).send({ error: "Download can no longer be cancelled" });
    return reply.send({ job: db.getJob(job.id) });
  });

  app.delete<{ Params: { id: string } }>("/api/jobs/:id", async (request, reply) => {
    if (!isJobId(request.params.id)) return reply.status(400).send({ error: "Invalid download identifier" });
    await removalCoordinator.remove(request.params.id);
    return reply.status(204).send();
  });

  app.get("/api/downloads", async () => ({
    downloads: await Promise.all(db.listJobs().filter((job) => job.status === "completed" && job.outputFile).map(presentJob))
  }));

  app.post<{ Params: { id: string } }>("/api/downloads/:id/lq/retry", async (request, reply) => {
    const job = db.getJob(request.params.id);
    if (!job?.outputFile || job.status !== "completed") return reply.status(404).send({ error: "Completed download not found" });
    if (!db.retryConversion(job.id)) return reply.status(409).send({ error: "Mobile conversion is not failed" });
    if (startWorker) conversionWorker.wake();
    return reply.send({ job: await presentJob(job) });
  });

  app.get<{ Params: { id: string }; Querystring: { download?: string; variant?: string } }>("/api/downloads/:id/file", async (request, reply) => {
    const job = db.getJob(request.params.id);
    if (!job?.outputFile || job.status !== "completed") {
      return reply.status(404).send({ error: "Completed download not found" });
    }

    const variant = request.query.variant ?? "hq";
    if (variant !== "hq" && variant !== "lq") return reply.status(400).send({ error: "Choose either the HQ or LQ download" });
    let relativeFile = job.outputFile;
    if (variant === "lq") {
      const conversion = db.getConversionJob(job.id);
      if (conversion?.status !== "completed" || !conversion.outputFile) {
        return reply.status(404).send({ error: "Mobile download is not ready" });
      }
      relativeFile = conversion.outputFile;
    }

    const filename = resolveStoredFile(config.downloadDir, relativeFile);
    let metadata: Awaited<ReturnType<typeof fileMetadata>>;
    try {
      metadata = await fileMetadata(filename);
    } catch {
      return reply.status(404).send({ error: "Downloaded file is missing" });
    }

    reply.header("Accept-Ranges", "bytes");
    reply.header("Content-Type", "video/mp4");
    const disposition = request.query.download === "1" ? "attachment" : "inline";
    reply.header("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(metadata.name)}`);

    try {
      const range = parseRange(request.headers.range, metadata.size);
      if (range) {
        reply.status(206);
        reply.header("Content-Range", `bytes ${range.start}-${range.end}/${metadata.size}`);
        reply.header("Content-Length", range.end - range.start + 1);
        return reply.send(fs.createReadStream(filename, range));
      }
    } catch {
      reply.header("Content-Range", `bytes */${metadata.size}`);
      return reply.status(416).send();
    }

    reply.header("Content-Length", metadata.size);
    return reply.send(fs.createReadStream(filename));
  });

  if (fs.existsSync(path.join(config.clientDir, "index.html"))) {
    await app.register(fastifyStatic, { root: config.clientDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.status(404).send({ error: "API route not found" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
