import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { AppConfig } from "./config";
import type { Credentials, CredentialVault } from "./crypto";
import type { AppDatabase, Job } from "./database";
import { resolveStoredFile } from "./files";
import { redact } from "./redaction";
import { MediaStorage } from "./storage";
import { inspectDownload } from "./media";
import { downloadChannel } from "../shared/download-policy";

const CREDENTIALS_KEY = "f1tv_credentials";

export function buildArguments(job: Job, outputDirectory: string): string[] {
  const args = [
    job.url,
    "--format",
    "mp4",
    "--video-size",
    "1280x720",
    "--audio-stream",
    "eng",
    "--output-directory",
    outputDirectory + path.sep,
    "--log-level",
    "info",
  ];
  args.push("--channel", downloadChannel(job.season));
  return args;
}

type DownloadChild = ChildProcessByStdio<null, Readable, Readable>;

function terminateProcessTree(
  child: DownloadChild,
  signal: NodeJS.Signals,
): void {
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
  const candidates = await Promise.all(
    entries
      .filter(
        (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp4"),
      )
      .map(async (entry) => {
        const filename = path.join(directory, entry.name);
        return { filename, stat: await fs.promises.stat(filename) };
      }),
  );

  return (
    candidates
      .filter(({ stat }) => stat.size > 0)
      .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0]
      ?.filename ?? null
  );
}

export class DownloadWorker {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private stopping = false;
  private task?: Promise<void>;
  private cleanupTask?: Promise<void>;
  private currentJobId?: string;
  private active?: { jobId: string; child: DownloadChild };
  private readonly removalWaiters = new Map<string, Set<() => void>>();
  private readonly removing = new Set<string>();
  private readonly pendingCleanup = new Set<string>();

  constructor(
    private readonly db: AppDatabase,
    private readonly vault: CredentialVault,
    private readonly config: AppConfig,
    private readonly storage = new MediaStorage(config),
    private readonly validateMedia = inspectDownload,
  ) {}

  start(): void {
    this.stopping = false;
    this.db.recoverInterrupted();
    for (const job of this.db.listJobs()) {
      if (job.status === "cancelled") this.pendingCleanup.add(job.id);
    }
    this.timer = setInterval(() => this.wake(), this.config.workerPollMs);
    this.timer.unref();
    void this.retryCleanup();
    this.wake();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    const child = this.active?.child;
    let escalation: NodeJS.Timeout | undefined;
    if (child) {
      terminateProcessTree(child, "SIGTERM");
      escalation = setTimeout(
        () => terminateProcessTree(child, "SIGKILL"),
        5000,
      );
    }
    await this.task;
    await this.cleanupTask;
    if (escalation) clearTimeout(escalation);
  }

  cancel(jobId: string): boolean {
    const job = this.db.getJob(jobId);
    if (job?.status === "cancelled") {
      this.scheduleCleanup(jobId);
      return true;
    }
    const cancelled = this.db.cancelJob(jobId);
    if (cancelled && this.currentJobId === jobId) {
      if (this.active?.jobId === jobId) {
        terminateProcessTree(this.active.child, "SIGTERM");
        const child = this.active.child;
        const escalation = setTimeout(
          () => terminateProcessTree(child, "SIGKILL"),
          5000,
        );
        escalation.unref();
        child.once("close", () => clearTimeout(escalation));
      }
    } else if (cancelled) {
      this.scheduleCleanup(jobId);
    }
    return cancelled;
  }

  async remove(jobId: string): Promise<void> {
    this.pendingCleanup.delete(jobId);
    await this.cleanupTask;
    this.removing.add(jobId);
    if (this.currentJobId !== jobId) {
      this.removing.delete(jobId);
      return;
    }

    const settled = new Promise<void>((resolve) => {
      const waiters = this.removalWaiters.get(jobId) ?? new Set<() => void>();
      waiters.add(resolve);
      this.removalWaiters.set(jobId, waiters);
    });
    const child = this.active?.jobId === jobId ? this.active.child : undefined;
    let escalation: NodeJS.Timeout | undefined;
    if (child) {
      terminateProcessTree(child, "SIGTERM");
      escalation = setTimeout(
        () => terminateProcessTree(child, "SIGKILL"),
        5000,
      );
      escalation.unref();
    }
    await settled;
    if (escalation) clearTimeout(escalation);
  }

  wake(): void {
    if (this.stopping || this.task) return;
    this.task = this.tick()
      .catch(() => {})
      .finally(() => {
        this.task = undefined;
      });
  }

  private async tick(): Promise<void> {
    if (this.stopping || this.busy) return;
    this.busy = true;
    let job: Job | null = null;
    try {
      await this.retryCleanup();
      if (
        this.stopping ||
        this.db.paused ||
        !this.db.getSetting(CREDENTIALS_KEY)
      )
        return;
      const storage = await this.storage.check();
      if (!storage.ready || !storage.enoughSpace || this.stopping) return;
      job = this.db.claimNext();
      if (!job) return;
      this.currentJobId = job.id;
      await this.run(job);
    } catch (error) {
      if (job && !this.stopping) {
        if (!(await this.storage.check()).ready) this.db.waitForStorage(job.id);
        else
          this.db.failJob(
            job.id,
            error instanceof Error
              ? redact(error.message)
                  .replace(/https?:\/\/\S+/g, "[provider URL]")
                  .slice(0, 240)
              : "The download could not complete",
          );
      }
    } finally {
      this.active = undefined;
      this.currentJobId = undefined;
      this.busy = false;
      if (job) {
        this.removing.delete(job.id);
        for (const resolve of this.removalWaiters.get(job.id) ?? []) resolve();
        this.removalWaiters.delete(job.id);
      }
    }
  }

  private getCredentials(): Credentials {
    const encrypted = this.db.getSetting(CREDENTIALS_KEY);
    if (!encrypted)
      throw new Error("Configure F1 TV credentials before starting downloads");
    return this.vault.decrypt(encrypted);
  }

  private scheduleCleanup(jobId: string): void {
    this.pendingCleanup.add(jobId);
    void this.retryCleanup();
  }

  private async cleanupJobDirectory(jobId: string): Promise<void> {
    try {
      if (!(await this.storage.check()).ready) return;
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

  private retryCleanup(): Promise<void> {
    if (this.cleanupTask) return this.cleanupTask;
    this.cleanupTask = (async () => {
      for (const jobId of [...this.pendingCleanup]) {
        const job = this.db.getJob(jobId);
        if (job?.status !== "cancelled") {
          this.pendingCleanup.delete(jobId);
          continue;
        }
        await this.cleanupJobDirectory(jobId);
      }
    })().finally(() => {
      this.cleanupTask = undefined;
    });
    return this.cleanupTask;
  }

  private async run(job: Job): Promise<void> {
    const initial = this.db.getJob(job.id);
    if (!initial || this.removing.has(job.id)) return;
    if (initial.status === "cancelled") {
      this.scheduleCleanup(job.id);
      return;
    }
    let credentials: Credentials;
    try {
      credentials = this.getCredentials();
    } catch (error) {
      this.db.failJob(
        job.id,
        error instanceof Error ? error.message : "Credentials are unavailable",
      );
      return;
    }

    await this.storage.requireReady();
    const jobDirectory = path.join(this.config.downloadDir, job.id);
    await fs.promises.mkdir(jobDirectory, { recursive: true });
    if ((await fs.promises.lstat(jobDirectory)).isSymbolicLink())
      throw new Error("Unsafe download directory");
    const staging = path.join(jobDirectory, ".staging");
    await fs.promises.rm(staging, { recursive: true, force: true });
    await fs.promises.mkdir(staging);
    if (this.stopping) return;
    const beforeSpawn = this.db.getJob(job.id);
    if (!beforeSpawn || this.removing.has(job.id)) {
      credentials.password = "";
      credentials.username = "";
      return;
    }
    if (beforeSpawn.status === "cancelled") {
      credentials.password = "";
      credentials.username = "";
      this.scheduleCleanup(job.id);
      return;
    }
    const args = buildArguments(job, staging);
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
        F1TV_OUTDIR: staging,
        NO_COLOR: "1",
      },
    });
    this.active = { jobId: job.id, child };

    const armInactivityTimeout = (): void => {
      if (timedOut) return;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        timedOut = true;
        lastMessage = `Download process became unresponsive after ${Math.ceil(this.config.downloadInactivityTimeoutMs / 60000)} minute(s) of inactivity`;
        terminateProcessTree(child, "SIGTERM");
        escalationTimer = setTimeout(
          () => terminateProcessTree(child, "SIGKILL"),
          5000,
        );
        escalationTimer.unref();
      }, this.config.downloadInactivityTimeoutMs);
      inactivityTimer.unref();
    };

    // FFmpeg may be quiet while moving the MP4 index. File activity is a
    // heartbeat too; keep only one filesystem probe outstanding on a slow NAS.
    let activityPending = false;
    let lastActivity = "";
    const activityTimer = setInterval(
      () => {
        if (activityPending || timedOut) return;
        activityPending = true;
        void fs.promises
          .readdir(staging)
          .then(async (names) => {
            const stats = await Promise.all(
              names.map((name) =>
                fs.promises.stat(path.join(staging, name)).catch(() => null),
              ),
            );
            const signature = stats
              .map((stat) =>
                stat ? String(stat.size) + ":" + stat.mtimeMs : "",
              )
              .join("|");
            if (signature !== lastActivity) {
              lastActivity = signature;
              armInactivityTimeout();
            }
          })
          .catch(() => {})
          .finally(() => {
            activityPending = false;
          });
      },
      Math.max(
        25,
        Math.min(10000, this.config.downloadInactivityTimeoutMs / 4),
      ),
    );
    activityTimer.unref();

    const consume = (chunk: Buffer): void => {
      armInactivityTimeout();
      const clean = redact(chunk.toString("utf8"), [
        credentials.username,
        credentials.password,
      ]).replace(/https?:\/\/\S+/g, "[provider URL]");
      if (timedOut) return;
      const progressMatches = [
        ...clean.matchAll(/Percent Complete=\s*(\d{1,3})%/g),
      ];
      const progress = Number(progressMatches.at(-1)?.[1]);
      const lines = clean
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter(Boolean);
      const useful = lines.at(-1);
      if (useful) lastMessage = useful.slice(0, 500);
      if (Number.isFinite(progress)) {
        this.db.updateProgress(
          job.id,
          progress,
          `Downloading · ${Math.min(99, progress)}%`,
        );
      } else if (
        useful &&
        !useful.toLowerCase().includes("executing command")
      ) {
        this.db.updateProgress(
          job.id,
          this.db.getJob(job.id)?.progress ?? 0,
          useful,
        );
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
        lastMessage = redact(error.message, [
          credentials.username,
          credentials.password,
        ]);
        finish(null);
      });
      child.once("close", finish);
    });

    clearInterval(activityTimer);
    if (inactivityTimer) clearTimeout(inactivityTimer);
    if (escalationTimer) clearTimeout(escalationTimer);

    credentials.password = "";
    credentials.username = "";
    const finalJob = this.db.getJob(job.id);
    if (!finalJob || this.removing.has(job.id)) return;
    if (finalJob.status === "cancelled") {
      await this.cleanupJobDirectory(job.id);
      return;
    }

    if (this.stopping) return;
    const output = await findCompletedMp4(staging);
    if (!timedOut && exitCode === 0 && output) {
      this.db.updateProgress(job.id, 99, "Checking the completed MP4");
      const inspection = await this.validateMedia(
        this.config.ffprobeBin,
        output,
        job.durationSeconds,
      );
      if (
        this.stopping ||
        this.removing.has(job.id) ||
        this.db.getJob(job.id)?.status !== "running"
      )
        return;
      await this.storage.requireReady();
      const published = path.join(jobDirectory, "replay.mp4");
      await fs.promises.rename(output, published);
      await fs.promises.rm(staging, { recursive: true, force: true });
      this.db.completeJob(
        job.id,
        path.relative(this.config.downloadDir, published),
        inspection.size,
        inspection.durationSeconds,
      );
    } else {
      if (!(await this.storage.check()).ready) this.db.waitForStorage(job.id);
      else this.db.failJob(job.id, lastMessage);
    }
  }
}

export const credentialsSettingKey = CREDENTIALS_KEY;
