import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { AppConfig } from "./config";
import type { AppDatabase, ConversionJob } from "./database";
import { resolveStoredFile } from "./files";
import {
  MOBILE_MAX_BYTES,
  conversionPaths,
  ffmpegPassArguments,
  inspectMedia,
  isMobileCompatible,
  mobileOutputRelative,
  mobileVideoBitrate,
  removeConversionArtifacts
} from "./media";
import { redact } from "./redaction";

type MediaChild = ChildProcessByStdio<null, Readable, Readable>;

function terminateProcessTree(child: MediaChild, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function conciseError(error: unknown): string {
  const message = redact(error instanceof Error ? error.message : String(error));
  return message.replace(/https?:\/\/\S+/gi, "[REDACTED URL]").slice(0, 500);
}

export class ConversionWorker {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private ready = false;
  private stopping = false;
  private active?: MediaChild;
  private unsubscribe?: () => void;

  constructor(private readonly db: AppDatabase, private readonly config: AppConfig) {}

  start(): void {
    this.stopping = false;
    this.ready = false;
    this.db.recoverInterruptedConversions();
    this.db.ensureConversionJobs();
    this.unsubscribe = this.db.onConversionChanged(() => this.wake());
    this.timer = setInterval(() => void this.tick(), this.config.conversionPollMs);
    this.timer.unref();
    void this.reconcile().catch(() => undefined).finally(() => {
      this.ready = true;
      return this.tick();
    });
  }

  stop(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.unsubscribe?.();
    if (this.active) terminateProcessTree(this.active, "SIGTERM");
  }

  wake(): void {
    queueMicrotask(() => void this.tick());
  }

  private async tick(): Promise<void> {
    if (this.stopping || !this.ready || this.busy) return;
    const job = this.db.claimNextConversion();
    if (!job) return;
    this.busy = true;
    try {
      await this.run(job);
    } catch (error) {
      if (!this.stopping) this.db.failConversion(job.downloadJobId, conciseError(error));
    } finally {
      this.active = undefined;
      this.busy = false;
      if (!this.stopping) queueMicrotask(() => void this.tick());
    }
  }

  private async reconcile(): Promise<void> {
    this.db.ensureConversionJobs();
    for (const conversion of this.db.listConversionJobs()) {
      if (this.stopping) return;
      const download = this.db.getJob(conversion.downloadJobId);
      if (!download?.outputFile || download.status !== "completed") continue;
      const source = resolveStoredFile(this.config.downloadDir, download.outputFile);
      const expectedRelative = mobileOutputRelative(download.outputFile);
      const expected = resolveStoredFile(this.config.downloadDir, expectedRelative);
      await removeConversionArtifacts(expected);

      try {
        const recordedRelative = conversion.outputFile;
        if (conversion.status === "completed" && recordedRelative) {
          const recorded = resolveStoredFile(this.config.downloadDir, recordedRelative);
          const inspection = await inspectMedia(this.config.ffprobeBin, recorded);
          if (isMobileCompatible(inspection)) {
            this.db.completeConversion(download.id, recordedRelative, inspection.size, recordedRelative === download.outputFile);
            continue;
          }
          this.db.requeueConversion(download.id, "Mobile MP4 needs to be rebuilt");
        }

        if (await this.adoptIfValid(download.id, expectedRelative, expected, false)) continue;
        const sourceInspection = await inspectMedia(this.config.ffprobeBin, source);
        if (isMobileCompatible(sourceInspection)) {
          this.db.completeConversion(download.id, download.outputFile, sourceInspection.size, true);
        }
      } catch {
        if (conversion.status === "completed") this.db.requeueConversion(download.id, "Mobile MP4 needs to be rebuilt");
      }
    }
  }

  private async adoptIfValid(downloadJobId: string, relative: string, filename: string, sourceReused: boolean): Promise<boolean> {
    try {
      const inspection = await inspectMedia(this.config.ffprobeBin, filename);
      if (!isMobileCompatible(inspection)) return false;
      this.db.completeConversion(downloadJobId, relative, inspection.size, sourceReused);
      return true;
    } catch {
      return false;
    }
  }

  private async run(job: ConversionJob): Promise<void> {
    const download = this.db.getJob(job.downloadJobId);
    if (!download?.outputFile || download.status !== "completed") throw new Error("The completed HQ download is unavailable");
    const source = resolveStoredFile(this.config.downloadDir, download.outputFile);
    const finalRelative = mobileOutputRelative(download.outputFile);
    const finalFilename = resolveStoredFile(this.config.downloadDir, finalRelative);
    const { temporary, passlog } = conversionPaths(finalFilename);
    await removeConversionArtifacts(finalFilename);

    this.db.updateConversionProgress(job.downloadJobId, 1, "Inspecting HQ file");
    const sourceInspection = await inspectMedia(this.config.ffprobeBin, source);
    if (isMobileCompatible(sourceInspection)) {
      this.db.completeConversion(job.downloadJobId, download.outputFile, sourceInspection.size, true);
      return;
    }
    if (await this.adoptIfValid(job.downloadJobId, finalRelative, finalFilename, false)) return;

    const bitrate = mobileVideoBitrate(sourceInspection.durationSeconds);
    await fs.promises.mkdir(path.dirname(finalFilename), { recursive: true });
    try {
      await this.runPass(job.downloadJobId, sourceInspection.durationSeconds, 1, source, temporary, passlog, bitrate);
      await this.runPass(job.downloadJobId, sourceInspection.durationSeconds, 2, source, temporary, passlog, bitrate);
      const converted = await inspectMedia(this.config.ffprobeBin, temporary);
      if (!isMobileCompatible(converted)) {
        if (converted.size >= MOBILE_MAX_BYTES) throw new Error("Converted MP4 exceeded the 3 GB limit");
        throw new Error("Converted MP4 failed Android compatibility validation");
      }
      await fs.promises.rename(temporary, finalFilename);
      this.db.completeConversion(job.downloadJobId, finalRelative, converted.size, false);
    } finally {
      await removeConversionArtifacts(finalFilename);
    }
  }

  private async runPass(downloadJobId: string, durationSeconds: number, pass: 1 | 2, source: string, output: string, passlog: string, bitrate: number): Promise<void> {
    const child = spawn(this.config.ffmpegBin, ffmpegPassArguments(source, output, passlog, bitrate, pass), {
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.active = child;

    let errorText = "";
    let inactivityTimer: NodeJS.Timeout | undefined;
    let escalationTimer: NodeJS.Timeout | undefined;
    let timedOut = false;
    const armTimeout = (): void => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        timedOut = true;
        terminateProcessTree(child, "SIGTERM");
        escalationTimer = setTimeout(() => terminateProcessTree(child, "SIGKILL"), 5000);
        escalationTimer.unref();
      }, this.config.conversionInactivityTimeoutMs);
      inactivityTimer.unref();
    };
    const consumeProgress = (chunk: Buffer): void => {
      armTimeout();
      const outputText = chunk.toString("utf8");
      const matches = [...outputText.matchAll(/out_time_(?:ms|us)=(\d+)/g)];
      const elapsedMicros = Number(matches.at(-1)?.[1]);
      if (!Number.isFinite(elapsedMicros)) return;
      const fraction = Math.min(1, elapsedMicros / 1_000_000 / durationSeconds);
      const progress = pass === 1 ? 2 + fraction * 47 : 50 + fraction * 48;
      this.db.updateConversionProgress(downloadJobId, progress, `Creating 720p MP4 · pass ${pass} of 2`);
    };
    child.stdout.on("data", consumeProgress);
    child.stderr.on("data", (chunk: Buffer) => {
      armTimeout();
      errorText = `${errorText}${chunk.toString("utf8")}`.slice(-2000);
    });
    armTimeout();

    const exitCode = await new Promise<number | null>((resolve) => {
      let settled = false;
      const finish = (code: number | null): void => {
        if (settled) return;
        settled = true;
        resolve(code);
      };
      child.once("error", (error) => {
        errorText = error.message;
        finish(null);
      });
      child.once("close", finish);
    });
    if (inactivityTimer) clearTimeout(inactivityTimer);
    if (escalationTimer) clearTimeout(escalationTimer);
    this.active = undefined;
    if (this.stopping) throw new Error("Conversion stopped during server shutdown");
    if (timedOut) throw new Error("FFmpeg conversion became unresponsive");
    if (exitCode !== 0) throw new Error(`FFmpeg pass ${pass} failed${errorText ? `: ${conciseError(errorText)}` : ""}`);
  }
}
