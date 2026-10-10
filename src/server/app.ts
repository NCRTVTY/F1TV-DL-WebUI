import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "./config";
import { CredentialVault } from "./crypto";
import { AppDatabase } from "./database";
import { credentialsSettingKey, DownloadWorker } from "./downloader";
import { fileMetadata, parseRange, resolveStoredFile } from "./files";
import { createJobSchema, credentialsSchema } from "./validation";

export interface BuildAppOptions {
  config: AppConfig;
  startWorker?: boolean;
}

export async function buildApp({ config, startWorker = true }: BuildAppOptions): Promise<FastifyInstance> {
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

  if (startWorker) worker.start();

  app.addHook("onClose", async () => {
    worker.stop();
    db.close();
  });

  app.setErrorHandler((error, _request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const message = status >= 500 ? "The server could not complete the request" : error.message;
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
    port: config.port
  }));

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

  app.get("/api/jobs", async () => ({ jobs: db.listJobs() }));

  app.post("/api/jobs", async (request, reply) => {
    const parsed = createJobSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message || "Invalid job" });
    if (!db.getSetting(credentialsSettingKey)) {
      return reply.status(409).send({ error: "Configure F1 TV credentials before adding a download" });
    }
    const job = db.createJob(parsed.data);
    worker.wake();
    return reply.status(201).send({ job });
  });

  app.post<{ Params: { id: string } }>("/api/jobs/:id/cancel", async (request, reply) => {
    const job = db.getJob(request.params.id);
    if (!job) return reply.status(404).send({ error: "Download not found" });
    if (!worker.cancel(job.id)) return reply.status(409).send({ error: "Download can no longer be cancelled" });
    return reply.send({ job: db.getJob(job.id) });
  });

  app.get("/api/downloads", async () => ({
    downloads: db.listJobs().filter((job) => job.status === "completed" && job.outputFile)
  }));

  app.get<{ Params: { id: string }; Querystring: { download?: string } }>("/api/downloads/:id/file", async (request, reply) => {
    const job = db.getJob(request.params.id);
    if (!job?.outputFile || job.status !== "completed") {
      return reply.status(404).send({ error: "Completed download not found" });
    }

    const filename = resolveStoredFile(config.downloadDir, job.outputFile);
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
