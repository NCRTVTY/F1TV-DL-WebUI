import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { AppConfig } from "./config";
import type { Credentials, CredentialVault } from "./crypto";
import type { AppDatabase, Job } from "./database";
import { resolveStoredFile } from "./files";
import { redact } from "./redaction";

const CREDENTIALS_KEY = "f1tv_credentials";

export function buildArguments(job: Job, outputDirectory: string): string[] {
  const args = [
    job.url,
    "--format", "mp4",
    "--video-size", job.quality,
    "--audio-stream", job.audio,
    "--output-directory", outputDirectory,
    "--log-level", "info"
  ];
  if (job.channel) args.push("--channel", job.channel);
  return args;
}

type DownloadChild = ChildProcessByStdio<null, Readable, Readable>;

function terminateProcessTree(child: DownloadChild, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function findCompletedMp4(directory: string): Promise<string | null> {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp4"))
    .map(async (entry) => {
      const filename = path.join(directory, entry.name);
      return { filename, stat: await fs.promises.stat(filename) };
    }));

  return candidates
    .filter(({ stat }) => stat.size > 0)
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0]?.filename ?? null;
}

export class DownloadWorker {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private active?: { jobId: string; child: DownloadChild };
  private readonly pendingCleanup = new Set<string>();
  private cleanupBusy = false;

  constructor(
    private readonly db: AppDatabase,
    private readonly vault: CredentialVault,
    private readonly config: AppConfig
  ) {}

  start(): void {
    this.db.recoverInterrupted();
    for (const job of this.db.listJobs()) {
      if (job.status === "cancelled") this.pendingCleanup.add(job.id);
    }
    this.timer = setInterval(() => void this.tick(), this.config.workerPollMs);
    this.timer.unref();
    void this.retryCleanup();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.active) terminateProcessTree(this.active.child, "SIGTERM");
  }

  cancel(jobId: string): boolean {
    const job = this.db.getJob(jobId);
    if (job?.status === "cancelled") {
      this.scheduleCleanup(jobId);
      return true;
    }
    const cancelled = this.db.cancelJob(jobId);
    if (cancelled && this.active?.jobId === jobId) {
      terminateProcessTree(this.active.child, "SIGTERM");
      const child = this.active.child;
      const escalation = setTimeout(() => terminateProcessTree(child, "SIGKILL"), 5000);
      escalation.unref();
    } else if (cancelled) {
      this.scheduleCleanup(jobId);
    }
    return cancelled;
  }

  wake(): void {
    void this.tick();
  }

  private async tick(): Promise<void> {
    void this.retryCleanup();
    if (this.busy) return;
    const job = this.db.claimNext();
    if (!job) return;

    this.busy = true;
    try {
      await this.run(job);
    } finally {
      this.active = undefined;
      this.busy = false;
      queueMicrotask(() => void this.tick());
    }
  }

  private getCredentials(): Credentials {
    const encrypted = this.db.getSetting(CREDENTIALS_KEY);
    if (!encrypted) throw new Error("Configure F1 TV credentials before starting downloads");
    return this.vault.decrypt(encrypted);
  }

  private scheduleCleanup(jobId: string): void {
    this.pendingCleanup.add(jobId);
    void this.retryCleanup();
  }

  private async cleanupJobDirectory(jobId: string): Promise<void> {
    try {
      const directory = resolveStoredFile(this.config.downloadDir, jobId);
      if (directory === path.resolve(this.config.downloadDir)) {
        this.pendingCleanup.delete(jobId);
        return;
      }
      await fs.promises.rm(directory, { recursive: true, force: true });
      this.pendingCleanup.delete(jobId);
    } catch {
      this.pendingCleanup.add(jobId);
    }
  }

  private async retryCleanup(): Promise<void> {
    if (this.cleanupBusy || this.pendingCleanup.size === 0) return;
    this.cleanupBusy = true;
    try {
      await Promise.all([...this.pendingCleanup].map((jobId) => this.cleanupJobDirectory(jobId)));
    } finally {
      this.cleanupBusy = false;
    }
  }

  private async run(job: Job): Promise<void> {
    if (this.db.getJob(job.id)?.status === "cancelled") {
      this.scheduleCleanup(job.id);
      return;
    }
    let credentials: Credentials;
    try {
      credentials = this.getCredentials();
    } catch (error) {
      this.db.failJob(job.id, error instanceof Error ? error.message : "Credentials are unavailable");
      return;
    }

    const jobDirectory = path.join(this.config.downloadDir, job.id);
    await fs.promises.mkdir(jobDirectory, { recursive: true });
    if (this.db.getJob(job.id)?.status === "cancelled") {
      credentials.password = "";
      credentials.username = "";
      this.scheduleCleanup(job.id);
      return;
    }
    const args = buildArguments(job, jobDirectory);
    let lastMessage = "Download process stopped without producing an MP4 file";
    let timedOut = false;
    let inactivityTimer: NodeJS.Timeout | undefined;
    let escalationTimer: NodeJS.Timeout | undefined;

    const child = spawn(this.config.f1tvBin, args, {
      cwd: process.cwd(),
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        F1TV_USER: credentials.username,
        F1TV_PASS: credentials.password,
        F1TV_OUTDIR: jobDirectory,
        NO_COLOR: "1"
      }
    });
    this.active = { jobId: job.id, child };

    const armInactivityTimeout = (): void => {
      if (timedOut) return;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        timedOut = true;
        lastMessage = `Download process became unresponsive after ${Math.ceil(this.config.downloadInactivityTimeoutMs / 60000)} minute(s) of inactivity`;
        terminateProcessTree(child, "SIGTERM");
        escalationTimer = setTimeout(() => terminateProcessTree(child, "SIGKILL"), 5000);
        escalationTimer.unref();
      }, this.config.downloadInactivityTimeoutMs);
      inactivityTimer.unref();
    };

    const consume = (chunk: Buffer): void => {
      armInactivityTimeout();
      const clean = redact(chunk.toString("utf8"), [credentials.username, credentials.password]);
      if (timedOut) return;
      const progressMatches = [...clean.matchAll(/Percent Complete=\s*(\d{1,3})%/g)];
      const progress = Number(progressMatches.at(-1)?.[1]);
      const lines = clean.split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean);
      const useful = lines.at(-1);
      if (useful) lastMessage = useful.slice(0, 500);
      if (Number.isFinite(progress)) {
        this.db.updateProgress(job.id, progress, `Downloading · ${Math.min(99, progress)}%`);
      } else if (useful && !useful.toLowerCase().includes("executing command")) {
        this.db.updateProgress(job.id, this.db.getJob(job.id)?.progress ?? 0, useful);
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    armInactivityTimeout();

    const exitCode = await new Promise<number | null>((resolve) => {
      let settled = false;
      const finish = (code: number | null): void => {
        if (!settled) {
          settled = true;
          resolve(code);
        }
      };
      child.once("error", (error) => {
        lastMessage = redact(error.message, [credentials.username, credentials.password]);
        finish(null);
      });
      child.once("close", finish);
    });

    if (inactivityTimer) clearTimeout(inactivityTimer);
    if (escalationTimer) clearTimeout(escalationTimer);

    credentials.password = "";
    credentials.username = "";
    if (this.db.getJob(job.id)?.status === "cancelled") {
      await this.cleanupJobDirectory(job.id);
      return;
    }

    const output = await findCompletedMp4(jobDirectory);
    if (!timedOut && exitCode === 0 && output) {
      this.db.completeJob(job.id, path.relative(this.config.downloadDir, output));
    } else {
      this.db.failJob(job.id, lastMessage);
    }
  }
}

export const credentialsSettingKey = CREDENTIALS_KEY;
