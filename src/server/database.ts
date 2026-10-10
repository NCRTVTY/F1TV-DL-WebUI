import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export const downloadFeeds = ["F1 LIVE", "INTERNATIONAL"] as const;
export type DownloadFeed = typeof downloadFeeds[number];
export const initialDefaultFeed: DownloadFeed = "F1 LIVE";

const DEFAULT_FEED_SETTING_KEY = "default_download_feed";

function isDownloadFeed(value: string | null): value is DownloadFeed {
  return downloadFeeds.some((feed) => feed === value);
}

export interface CreateJobInput {
  url: string;
  quality: string;
  audio: string;
  channel?: string;
  contentId?: string;
  title?: string;
}

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type ConversionStatus = "queued" | "running" | "completed" | "failed";

export interface Job {
  id: string;
  url: string;
  quality: string;
  audio: string;
  channel: string | null;
  contentId: string | null;
  title: string | null;
  status: JobStatus;
  progress: number;
  message: string | null;
  outputFile: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface JobRow {
  id: string;
  url: string;
  quality: string;
  audio: string;
  channel: string | null;
  content_id: string | null;
  title: string | null;
  status: JobStatus;
  progress: number;
  message: string | null;
  output_file: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface ConversionJob {
  downloadJobId: string;
  status: ConversionStatus;
  progress: number;
  message: string | null;
  outputFile: string | null;
  outputSize: number | null;
  sourceReused: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface ConversionJobRow {
  download_job_id: string;
  status: ConversionStatus;
  progress: number;
  message: string | null;
  output_file: string | null;
  output_size: number | null;
  source_reused: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const toConversionJob = (row: ConversionJobRow): ConversionJob => ({
  downloadJobId: row.download_job_id,
  status: row.status,
  progress: row.progress,
  message: row.message,
  outputFile: row.output_file,
  outputSize: row.output_size,
  sourceReused: row.source_reused === 1,
  createdAt: row.created_at,
  startedAt: row.started_at,
  finishedAt: row.finished_at
});

const toJob = (row: JobRow): Job => ({
  id: row.id,
  url: row.url,
  quality: row.quality,
  audio: row.audio,
  channel: row.channel,
  contentId: row.content_id,
  title: row.title,
  status: row.status,
  progress: row.progress,
  message: row.message,
  outputFile: row.output_file,
  createdAt: row.created_at,
  startedAt: row.started_at,
  finishedAt: row.finished_at
});

export class AppDatabase {
  private readonly db: Database.Database;
  private readonly jobChangeListeners = new Set<(jobId: string) => void>();
  private readonly conversionChangeListeners = new Set<(jobId: string) => void>();

  constructor(filename: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        quality TEXT NOT NULL,
        audio TEXT NOT NULL,
        channel TEXT,
        content_id TEXT,
        title TEXT,
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
        message TEXT,
        output_file TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE INDEX IF NOT EXISTS jobs_status_created_idx ON jobs(status, created_at);

      CREATE TABLE IF NOT EXISTS conversion_jobs (
        download_job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed')),
        progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
        message TEXT,
        output_file TEXT,
        output_size INTEGER,
        source_reused INTEGER NOT NULL DEFAULT 0 CHECK(source_reused IN (0, 1)),
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE INDEX IF NOT EXISTS conversion_jobs_status_created_idx ON conversion_jobs(status, created_at);
    `);
    const columns = new Set((this.db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>).map((column) => column.name));
    if (!columns.has("content_id")) this.db.exec("ALTER TABLE jobs ADD COLUMN content_id TEXT");
    if (!columns.has("title")) this.db.exec("ALTER TABLE jobs ADD COLUMN title TEXT");
    this.db.exec("CREATE INDEX IF NOT EXISTS jobs_content_status_idx ON jobs(content_id, status)");

    const alignQueuedJobs = this.db.transaction(() => {
      const stored = this.getSetting(DEFAULT_FEED_SETTING_KEY);
      const defaultFeed = isDownloadFeed(stored) ? stored : initialDefaultFeed;
      if (stored !== defaultFeed) {
        this.db.prepare(`
          INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(DEFAULT_FEED_SETTING_KEY, defaultFeed, new Date().toISOString());
      }
      this.db.prepare(`
        UPDATE jobs SET channel = ?
        WHERE status = 'queued' AND (channel IS NULL OR channel <> ?)
      `).run(defaultFeed, defaultFeed);
    });
    alignQueuedJobs();
  }

  close(): void {
    this.jobChangeListeners.clear();
    this.conversionChangeListeners.clear();
    this.db.close();
  }

  onJobChanged(listener: (jobId: string) => void): () => void {
    this.jobChangeListeners.add(listener);
    return () => this.jobChangeListeners.delete(listener);
  }

  private notifyJobChanged(jobId: string): void {
    for (const listener of this.jobChangeListeners) listener(jobId);
  }

  onConversionChanged(listener: (jobId: string) => void): () => void {
    this.conversionChangeListeners.add(listener);
    return () => this.conversionChangeListeners.delete(listener);
  }

  private notifyConversionChanged(jobId: string): void {
    for (const listener of this.conversionChangeListeners) listener(jobId);
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, new Date().toISOString());
  }

  deleteSetting(key: string): void {
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }

  getDefaultFeed(): DownloadFeed {
    const stored = this.getSetting(DEFAULT_FEED_SETTING_KEY);
    return isDownloadFeed(stored) ? stored : initialDefaultFeed;
  }

  setDefaultFeed(defaultFeed: DownloadFeed): number {
    const update = this.db.transaction(() => {
      const jobs = this.db.prepare(`
        SELECT id FROM jobs
        WHERE status = 'queued' AND (channel IS NULL OR channel <> ?)
      `).all(defaultFeed) as Array<{ id: string }>;
      this.db.prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(DEFAULT_FEED_SETTING_KEY, defaultFeed, new Date().toISOString());
      this.db.prepare(`
        UPDATE jobs SET channel = ?
        WHERE status = 'queued' AND (channel IS NULL OR channel <> ?)
      `).run(defaultFeed, defaultFeed);
      return jobs;
    });
    return update().length;
  }

  createJob(input: CreateJobInput): Job {
    const job: Job = {
      id: randomUUID(),
      url: input.url,
      quality: input.quality,
      audio: input.audio,
      channel: input.channel ?? null,
      contentId: input.contentId ?? null,
      title: input.title?.slice(0, 240) ?? null,
      status: "queued",
      progress: 0,
      message: "Waiting to download",
      outputFile: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null
    };

    this.db.prepare(`
      INSERT INTO jobs (id, url, quality, audio, channel, content_id, title, status, progress, message, output_file, created_at, started_at, finished_at)
      VALUES (@id, @url, @quality, @audio, @channel, @contentId, @title, @status, @progress, @message, @outputFile, @createdAt, @startedAt, @finishedAt)
    `).run(job);
    this.notifyJobChanged(job.id);
    return job;
  }

  findActiveOrCompletedByContentId(contentId: string): Job | null {
    const row = this.db.prepare(`
      SELECT * FROM jobs
      WHERE content_id = ? AND status IN ('queued', 'running', 'completed')
      ORDER BY created_at DESC LIMIT 1
    `).get(contentId) as JobRow | undefined;
    return row ? toJob(row) : null;
  }

  listJobs(): Job[] {
    const rows = this.db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all() as JobRow[];
    return rows.map(toJob);
  }

  getJob(id: string): Job | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    return row ? toJob(row) : null;
  }

  recoverInterrupted(): number {
    const interrupted = this.db.prepare("SELECT id FROM jobs WHERE status = 'running'").all() as Array<{ id: string }>;
    const result = this.db.prepare(`
      UPDATE jobs
      SET status = 'queued', progress = 0, message = 'Recovered after restart', started_at = NULL, finished_at = NULL
      WHERE status = 'running'
    `).run();
    for (const job of interrupted) this.notifyJobChanged(job.id);
    return result.changes;
  }

  claimNext(): Job | null {
    const claim = this.db.transaction(() => {
      const row = this.db.prepare("SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
      if (!row) return null;
      const now = new Date().toISOString();
      const result = this.db.prepare(`
        UPDATE jobs SET status = 'running', progress = 0, message = 'Starting download', started_at = ?, finished_at = NULL
        WHERE id = ? AND status = 'queued'
      `).run(now, row.id);
      return result.changes === 1 ? this.getJob(row.id) : null;
    });
    const job = claim();
    if (job) this.notifyJobChanged(job.id);
    return job;
  }

  updateProgress(id: string, progress: number, message: string): void {
    const result = this.db.prepare(`
      UPDATE jobs SET progress = ?, message = ? WHERE id = ? AND status = 'running'
    `).run(Math.max(0, Math.min(99, Math.floor(progress))), message.slice(0, 500), id);
    if (result.changes === 1) this.notifyJobChanged(id);
  }

  completeJob(id: string, outputFile: string): void {
    const complete = this.db.transaction(() => {
      const now = new Date().toISOString();
      const result = this.db.prepare(`
        UPDATE jobs SET status = 'completed', progress = 100, message = 'Download complete', output_file = ?, finished_at = ?
        WHERE id = ? AND status = 'running'
      `).run(outputFile, now, id);
      if (result.changes !== 1) return false;
      this.db.prepare(`
        INSERT OR IGNORE INTO conversion_jobs
          (download_job_id, status, progress, message, output_file, output_size, source_reused, created_at, started_at, finished_at)
        VALUES (?, 'queued', 0, 'Waiting to create mobile MP4', NULL, NULL, 0, ?, NULL, NULL)
      `).run(id, now);
      return true;
    });
    if (complete()) {
      this.notifyJobChanged(id);
      this.notifyConversionChanged(id);
    }
  }

  failJob(id: string, message: string): void {
    const result = this.db.prepare(`
      UPDATE jobs SET status = 'failed', message = ?, finished_at = ?
      WHERE id = ? AND status = 'running'
    `).run(message.slice(0, 500), new Date().toISOString(), id);
    if (result.changes === 1) this.notifyJobChanged(id);
  }

  cancelJob(id: string): boolean {
    const result = this.db.prepare(`
      UPDATE jobs SET status = 'cancelled', message = 'Cancelled', finished_at = ?
      WHERE id = ? AND status IN ('queued', 'running')
    `).run(new Date().toISOString(), id);
    if (result.changes === 1) this.notifyJobChanged(id);
    return result.changes === 1;
  }

  counts(): Record<JobStatus, number> {
    const counts: Record<JobStatus, number> = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    const rows = this.db.prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status").all() as Array<{ status: JobStatus; count: number }>;
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  ensureConversionJobs(): string[] {
    const missing = this.db.prepare(`
      SELECT jobs.id FROM jobs
      LEFT JOIN conversion_jobs ON conversion_jobs.download_job_id = jobs.id
      WHERE jobs.status = 'completed' AND jobs.output_file IS NOT NULL AND conversion_jobs.download_job_id IS NULL
      ORDER BY jobs.finished_at ASC
    `).all() as Array<{ id: string }>;
    if (missing.length === 0) return [];
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO conversion_jobs
        (download_job_id, status, progress, message, output_file, output_size, source_reused, created_at, started_at, finished_at)
      VALUES (?, 'queued', 0, 'Waiting to create mobile MP4', NULL, NULL, 0, ?, NULL, NULL)
    `);
    const add = this.db.transaction(() => {
      const now = new Date().toISOString();
      for (const job of missing) insert.run(job.id, now);
    });
    add();
    for (const job of missing) this.notifyConversionChanged(job.id);
    return missing.map((job) => job.id);
  }

  listConversionJobs(): ConversionJob[] {
    const rows = this.db.prepare("SELECT * FROM conversion_jobs ORDER BY created_at ASC").all() as ConversionJobRow[];
    return rows.map(toConversionJob);
  }

  getConversionJob(downloadJobId: string): ConversionJob | null {
    const row = this.db.prepare("SELECT * FROM conversion_jobs WHERE download_job_id = ?").get(downloadJobId) as ConversionJobRow | undefined;
    return row ? toConversionJob(row) : null;
  }

  recoverInterruptedConversions(): number {
    const interrupted = this.db.prepare("SELECT download_job_id FROM conversion_jobs WHERE status = 'running'").all() as Array<{ download_job_id: string }>;
    const result = this.db.prepare(`
      UPDATE conversion_jobs
      SET status = 'queued', progress = 0, message = 'Recovered after restart', started_at = NULL, finished_at = NULL
      WHERE status = 'running'
    `).run();
    for (const job of interrupted) this.notifyConversionChanged(job.download_job_id);
    return result.changes;
  }

  claimNextConversion(): ConversionJob | null {
    const claim = this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT conversion_jobs.download_job_id
        FROM conversion_jobs
        JOIN jobs ON jobs.id = conversion_jobs.download_job_id
        WHERE conversion_jobs.status = 'queued' AND jobs.status = 'completed' AND jobs.output_file IS NOT NULL
        ORDER BY conversion_jobs.created_at ASC LIMIT 1
      `).get() as { download_job_id: string } | undefined;
      if (!row) return null;
      const result = this.db.prepare(`
        UPDATE conversion_jobs
        SET status = 'running', progress = 0, message = 'Inspecting HQ file', started_at = ?, finished_at = NULL
        WHERE download_job_id = ? AND status = 'queued'
      `).run(new Date().toISOString(), row.download_job_id);
      return result.changes === 1 ? this.getConversionJob(row.download_job_id) : null;
    });
    const job = claim();
    if (job) this.notifyConversionChanged(job.downloadJobId);
    return job;
  }

  updateConversionProgress(downloadJobId: string, progress: number, message: string): void {
    const result = this.db.prepare(`
      UPDATE conversion_jobs SET progress = ?, message = ?
      WHERE download_job_id = ? AND status = 'running'
    `).run(Math.max(0, Math.min(99, Math.floor(progress))), message.slice(0, 500), downloadJobId);
    if (result.changes === 1) this.notifyConversionChanged(downloadJobId);
  }

  completeConversion(downloadJobId: string, outputFile: string, outputSize: number, sourceReused: boolean): void {
    const result = this.db.prepare(`
      UPDATE conversion_jobs
      SET status = 'completed', progress = 100, message = ?, output_file = ?, output_size = ?, source_reused = ?, finished_at = ?
      WHERE download_job_id = ?
    `).run(sourceReused ? "HQ file is already mobile-ready" : "Mobile MP4 ready", outputFile, outputSize, sourceReused ? 1 : 0, new Date().toISOString(), downloadJobId);
    if (result.changes === 1) this.notifyConversionChanged(downloadJobId);
  }

  failConversion(downloadJobId: string, message: string): void {
    const result = this.db.prepare(`
      UPDATE conversion_jobs SET status = 'failed', message = ?, finished_at = ?
      WHERE download_job_id = ? AND status = 'running'
    `).run(message.slice(0, 500), new Date().toISOString(), downloadJobId);
    if (result.changes === 1) this.notifyConversionChanged(downloadJobId);
  }

  requeueConversion(downloadJobId: string, message = "Waiting to create mobile MP4"): boolean {
    const result = this.db.prepare(`
      UPDATE conversion_jobs
      SET status = 'queued', progress = 0, message = ?, output_file = NULL, output_size = NULL,
          source_reused = 0, started_at = NULL, finished_at = NULL
      WHERE download_job_id = ? AND status IN ('failed', 'completed')
    `).run(message.slice(0, 500), downloadJobId);
    if (result.changes === 1) this.notifyConversionChanged(downloadJobId);
    return result.changes === 1;
  }

  retryConversion(downloadJobId: string): boolean {
    const result = this.db.prepare(`
      UPDATE conversion_jobs
      SET status = 'queued', progress = 0, message = 'Retry queued', output_file = NULL, output_size = NULL,
          source_reused = 0, started_at = NULL, finished_at = NULL
      WHERE download_job_id = ? AND status = 'failed'
    `).run(downloadJobId);
    if (result.changes === 1) this.notifyConversionChanged(downloadJobId);
    return result.changes === 1;
  }
}
