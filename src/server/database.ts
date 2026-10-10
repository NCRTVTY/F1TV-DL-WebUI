import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { CreateJobInput } from "./validation";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface Job {
  id: string;
  url: string;
  quality: string;
  audio: string;
  channel: string | null;
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
  status: JobStatus;
  progress: number;
  message: string | null;
  output_file: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const toJob = (row: JobRow): Job => ({
  id: row.id,
  url: row.url,
  quality: row.quality,
  audio: row.audio,
  channel: row.channel,
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
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
        message TEXT,
        output_file TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE INDEX IF NOT EXISTS jobs_status_created_idx ON jobs(status, created_at);
    `);
  }

  close(): void {
    this.db.close();
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

  createJob(input: CreateJobInput): Job {
    const job: Job = {
      id: randomUUID(),
      url: input.url,
      quality: input.quality,
      audio: input.audio,
      channel: input.channel ?? null,
      status: "queued",
      progress: 0,
      message: "Waiting to download",
      outputFile: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null
    };

    this.db.prepare(`
      INSERT INTO jobs (id, url, quality, audio, channel, status, progress, message, output_file, created_at, started_at, finished_at)
      VALUES (@id, @url, @quality, @audio, @channel, @status, @progress, @message, @outputFile, @createdAt, @startedAt, @finishedAt)
    `).run(job);
    return job;
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
    const result = this.db.prepare(`
      UPDATE jobs
      SET status = 'queued', progress = 0, message = 'Recovered after restart', started_at = NULL, finished_at = NULL
      WHERE status = 'running'
    `).run();
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
    return claim();
  }

  updateProgress(id: string, progress: number, message: string): void {
    this.db.prepare(`
      UPDATE jobs SET progress = ?, message = ? WHERE id = ? AND status = 'running'
    `).run(Math.max(0, Math.min(99, Math.floor(progress))), message.slice(0, 500), id);
  }

  completeJob(id: string, outputFile: string): void {
    this.db.prepare(`
      UPDATE jobs SET status = 'completed', progress = 100, message = 'Download complete', output_file = ?, finished_at = ?
      WHERE id = ? AND status = 'running'
    `).run(outputFile, new Date().toISOString(), id);
  }

  failJob(id: string, message: string): void {
    this.db.prepare(`
      UPDATE jobs SET status = 'failed', message = ?, finished_at = ?
      WHERE id = ? AND status = 'running'
    `).run(message.slice(0, 500), new Date().toISOString(), id);
  }

  cancelJob(id: string): boolean {
    const result = this.db.prepare(`
      UPDATE jobs SET status = 'cancelled', message = 'Cancelled', finished_at = ?
      WHERE id = ? AND status IN ('queued', 'running')
    `).run(new Date().toISOString(), id);
    return result.changes === 1;
  }

  counts(): Record<JobStatus, number> {
    const counts: Record<JobStatus, number> = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    const rows = this.db.prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status").all() as Array<{ status: JobStatus; count: number }>;
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }
}
