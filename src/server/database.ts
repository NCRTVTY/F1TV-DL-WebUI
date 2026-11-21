import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { downloadPolicy, downloadChannel } from "../shared/download-policy";
export { downloadPolicy } from "../shared/download-policy";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export interface CreateJobInput {
  url: string;
  quality?: string;
  audio?: string;
  channel?: string;
  contentId?: string;
  title?: string;
  thumbnailUrl?: string | null;
  eventId?: string;
  season?: number;
  durationSeconds?: number | null;
}
export interface Job {
  id: string;
  url: string;
  quality: string;
  audio: string;
  channel: string;
  contentId: string | null;
  title: string | null;
  thumbnailUrl: string | null;
  eventId: string | null;
  season: number | null;
  durationSeconds: number | null;
  status: JobStatus;
  progress: number;
  message: string | null;
  outputFile: string | null;
  outputSize: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  position: number;
}
type Row = Record<string, unknown>;
function jobFromRow(r: Row): Job {
  return {
    id: r.id as string,
    url: r.url as string,
    quality: r.quality as string,
    audio: r.audio as string,
    channel: r.channel as string,
    contentId: r.content_id as string | null,
    title: r.title as string | null,
    thumbnailUrl: r.thumbnail_url as string | null,
    eventId: r.event_id as string | null,
    season: r.season as number | null,
    durationSeconds: r.duration_seconds as number | null,
    status: r.status as JobStatus,
    progress: r.progress as number,
    message: r.message as string | null,
    outputFile: r.output_file as string | null,
    outputSize: r.output_size as number | null,
    createdAt: r.created_at as string,
    startedAt: r.started_at as string | null,
    finishedAt: r.finished_at as string | null,
    position: r.position as number,
  };
}
export class AppDatabase {
  private readonly db: Database.Database;
  private readonly changes = new Set<(id: string) => void>();
  private readonly removals = new Set<(id: string) => void>();
  constructor(filename: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new Database(filename);
    fs.chmodSync(filename, 0o600);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,url TEXT NOT NULL,quality TEXT NOT NULL,audio TEXT NOT NULL,channel TEXT,content_id TEXT,title TEXT,status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')),progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),message TEXT,output_file TEXT,created_at TEXT NOT NULL,started_at TEXT,finished_at TEXT); CREATE TABLE IF NOT EXISTS pending_deletions (job_id TEXT PRIMARY KEY);",
    );
    const columns = new Set(
      (
        this.db.prepare("PRAGMA table_info(jobs)").all() as Array<{
          name: string;
        }>
      ).map((c) => c.name),
    );
    for (const [name, type] of [
      ["content_id", "TEXT"],
      ["title", "TEXT"],
      ["thumbnail_url", "TEXT"],
      ["event_id", "TEXT"],
      ["season", "INTEGER"],
      ["duration_seconds", "REAL"],
      ["position", "INTEGER NOT NULL DEFAULT 0"],
      ["output_size", "INTEGER"],
    ]) {
      if (!columns.has(name))
        this.db.exec("ALTER TABLE jobs ADD COLUMN " + name + " " + type);
    }
    this.db.exec(
      "DROP TABLE IF EXISTS conversion_jobs; CREATE INDEX IF NOT EXISTS jobs_status_position_idx ON jobs(status,position,created_at); CREATE INDEX IF NOT EXISTS jobs_content_status_idx ON jobs(content_id,status);",
    );
    this.db
      .prepare("DELETE FROM settings WHERE key = ?")
      .run("default_download_feed");
    this.db
      .prepare(
        "UPDATE jobs SET quality=?,audio=?,channel=CASE WHEN season >= 1950 AND season < 2022 THEN 'ORIGINAL' ELSE ? END WHERE status='queued'",
      )
      .run(
        downloadPolicy.quality,
        downloadPolicy.audio,
        downloadPolicy.channel,
      );
  }
  close(): void {
    this.changes.clear();
    this.removals.clear();
    this.db.close();
  }
  onJobChanged(fn: (id: string) => void): () => void {
    this.changes.add(fn);
    return () => this.changes.delete(fn);
  }
  onJobRemoved(fn: (id: string) => void): () => void {
    this.removals.add(fn);
    return () => this.removals.delete(fn);
  }
  private changed(id: string): void {
    for (const fn of this.changes) fn(id);
  }
  getSetting(key: string): string | null {
    return (
      (
        this.db.prepare("SELECT value FROM settings WHERE key=?").get(key) as
          | { value: string }
          | undefined
      )?.value ?? null
    );
  }
  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      )
      .run(key, value, new Date().toISOString());
  }
  deleteSetting(key: string): void {
    this.db.prepare("DELETE FROM settings WHERE key=?").run(key);
  }
  get paused(): boolean {
    return this.getSetting("queue_paused") === "true";
  }
  setPaused(value: boolean): void {
    this.setSetting("queue_paused", String(value));
  }
  createJob(input: CreateJobInput): Job {
    const id = randomUUID(),
      now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO jobs(id,url,quality,audio,channel,content_id,title,thumbnail_url,event_id,season,duration_seconds,status,progress,message,created_at,position) VALUES(?,?,?,?,?,?,?,?,?,?,?,'queued',0,'Waiting to download',?,(SELECT COALESCE(MAX(position),0)+1 FROM jobs))",
      )
      .run(
        id,
        input.url,
        downloadPolicy.quality,
        downloadPolicy.audio,
        downloadChannel(input.season),
        input.contentId ?? null,
        input.title?.slice(0, 240) ?? null,
        input.thumbnailUrl ?? null,
        input.eventId ?? null,
        input.season ?? null,
        input.durationSeconds ?? null,
        now,
      );
    this.changed(id);
    return this.getJob(id)!;
  }
  listJobs(): Job[] {
    return (
      this.db
        .prepare("SELECT * FROM jobs ORDER BY created_at DESC,id")
        .all() as Row[]
    ).map(jobFromRow);
  }
  getJob(id: string): Job | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as
      | Row
      | undefined;
    return row ? jobFromRow(row) : null;
  }
  findActiveOrCompletedByContentId(id: string): Job | null {
    const row = this.db
      .prepare(
        "SELECT * FROM jobs WHERE content_id=? AND status IN ('queued','running','completed') LIMIT 1",
      )
      .get(id) as Row | undefined;
    return row ? jobFromRow(row) : null;
  }
  claimNext(): Job | null {
    if (this.paused) return null;
    const id = this.db.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT id FROM jobs WHERE status='queued' AND id NOT IN (SELECT job_id FROM pending_deletions) ORDER BY position,created_at,id LIMIT 1",
        )
        .get() as { id: string } | undefined;
      if (!row) return null;
      this.db
        .prepare(
          "UPDATE jobs SET status='running',progress=0,message='Starting download',started_at=?,finished_at=NULL WHERE id=?",
        )
        .run(new Date().toISOString(), row.id);
      return row.id;
    })();
    if (id) this.changed(id);
    return id ? this.getJob(id) : null;
  }
  updateProgress(id: string, progress: number, message: string): void {
    if (
      this.db
        .prepare(
          "UPDATE jobs SET progress=?,message=? WHERE id=? AND status='running'",
        )
        .run(
          Math.max(0, Math.min(99, Math.floor(progress))),
          message.slice(0, 500),
          id,
        ).changes
    )
      this.changed(id);
  }
  completeJob(
    id: string,
    file: string,
    size: number | null = null,
    duration: number | null = null,
  ): void {
    if (
      this.db
        .prepare(
          "UPDATE jobs SET status='completed',progress=100,message='Download complete',output_file=?,output_size=?,duration_seconds=COALESCE(?,duration_seconds),finished_at=? WHERE id=? AND status='running'",
        )
        .run(file, size, duration, new Date().toISOString(), id).changes
    )
      this.changed(id);
  }
  failJob(id: string, message: string): void {
    if (
      this.db
        .prepare(
          "UPDATE jobs SET status='failed',message=?,finished_at=? WHERE id=? AND status='running'",
        )
        .run(message.slice(0, 500), new Date().toISOString(), id).changes
    )
      this.changed(id);
  }
  recoverInterrupted(): number {
    const rows = this.db
      .prepare("SELECT id FROM jobs WHERE status='running'")
      .all() as { id: string }[];
    this.db
      .prepare(
        "UPDATE jobs SET status='queued',progress=0,message='Recovered after restart',started_at=NULL,finished_at=NULL WHERE status='running'",
      )
      .run();
    rows.forEach((r) => this.changed(r.id));
    return rows.length;
  }
  waitForStorage(id: string): void {
    if (
      this.db
        .prepare(
          "UPDATE jobs SET status='queued',progress=0,message='Waiting for media storage',started_at=NULL WHERE id=? AND status='running'",
        )
        .run(id).changes
    )
      this.changed(id);
  }
  cancelJob(id: string): boolean {
    const result = this.db
      .prepare(
        "UPDATE jobs SET status='cancelled',message='Cancelled',finished_at=? WHERE id=? AND status IN ('queued','running')",
      )
      .run(new Date().toISOString(), id);
    if (result.changes) this.changed(id);
    return !!result.changes;
  }
  retryJob(id: string): boolean {
    const result = this.db
      .prepare(
        "UPDATE jobs SET status='queued',progress=0,message='Waiting to retry',output_file=NULL,output_size=NULL,started_at=NULL,finished_at=NULL WHERE id=? AND status IN ('failed','cancelled')",
      )
      .run(id);
    if (result.changes) this.changed(id);
    return !!result.changes;
  }
  moveUp(id: string): boolean {
    const changed = this.db.transaction(() => {
      const row = this.getJob(id);
      if (row?.status !== "queued") return false;
      const rows = this.db
        .prepare(
          "SELECT id FROM jobs WHERE status='queued' ORDER BY position,created_at,id",
        )
        .all() as { id: string }[];
      const i = rows.findIndex((r) => r.id === id);
      if (i <= 0) return false;
      [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
      const update = this.db.prepare("UPDATE jobs SET position=? WHERE id=?");
      rows.forEach((r, index) => update.run(index + 1, r.id));
      return true;
    })();
    if (changed)
      for (const job of this.listJobs().filter((j) => j.status === "queued"))
        this.changed(job.id);
    return changed;
  }
  requestDeletion(id: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO pending_deletions(job_id) VALUES(?)")
      .run(id);
  }
  pendingDeletions(): string[] {
    return (
      this.db.prepare("SELECT job_id FROM pending_deletions").all() as {
        job_id: string;
      }[]
    ).map((r) => r.job_id);
  }
  finishDeletion(id: string): void {
    this.db.prepare("DELETE FROM pending_deletions WHERE job_id=?").run(id);
  }
  deleteJob(id: string): boolean {
    const result = this.db.prepare("DELETE FROM jobs WHERE id=?").run(id);
    if (result.changes) for (const fn of this.removals) fn(id);
    return !!result.changes;
  }
  counts(): Record<JobStatus, number> {
    const result: Record<JobStatus, number> = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const row of this.db
      .prepare("SELECT status,COUNT(*) AS count FROM jobs GROUP BY status")
      .all() as { status: JobStatus; count: number }[])
      result[row.status] = row.count;
    return result;
  }
}
