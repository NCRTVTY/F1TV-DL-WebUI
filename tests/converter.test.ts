import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/server/config";
import { ConversionWorker } from "../src/server/converter";
import { AppDatabase } from "../src/server/database";
import { inspectMedia, isMobileCompatible } from "../src/server/media";

const directories: string[] = [];
const mediaToolsAvailable = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const ffmpegStub = path.resolve("tests/fixtures/ffmpeg-stub.sh");

function fixture(size: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-converter-"));
  directories.push(root);
  const downloadDir = path.join(root, "downloads");
  const db = new AppDatabase(path.join(root, "data", "test.sqlite"));
  const download = db.createJob({ url: "https://f1tv.formula1.com/detail/1/media", quality: "best", audio: "eng" });
  db.claimNext();
  const jobDirectory = path.join(downloadDir, download.id);
  fs.mkdirSync(jobDirectory, { recursive: true });
  const source = path.join(jobDirectory, "race.mp4");
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", `testsrc=size=${size}:rate=24`,
    "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000",
    "-t", "1", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    source
  ]);
  db.completeJob(download.id, path.relative(downloadDir, source));
  const config = loadConfig({
    dataDir: path.join(root, "data"),
    downloadDir,
    conversionPollMs: 10,
    conversionInactivityTimeoutMs: 10_000
  });
  return { db, download, source, config, worker: new ConversionWorker(db, config) };
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe.skipIf(!mediaToolsAvailable)("conversion worker FFmpeg integration", () => {
  it("reuses an already compatible 720p-or-smaller MP4", async () => {
    const { db, download, source, worker } = fixture("640x360");
    worker.start();
    await vi.waitFor(() => expect(db.getConversionJob(download.id)).toMatchObject({ status: "completed", sourceReused: true }), { timeout: 10_000 });
    expect(db.getConversionJob(download.id)?.outputFile).toBe(path.join(download.id, "race.mp4"));
    expect(fs.existsSync(source)).toBe(true);
    worker.stop();
    db.close();
  });

  it("creates and validates a separate 720p H.264/AAC MP4", async () => {
    const { db, download, config, worker } = fixture("1920x1080");
    worker.start();
    await vi.waitFor(() => expect(db.getConversionJob(download.id)?.status).toBe("completed"), { timeout: 30_000, interval: 50 });

    const conversion = db.getConversionJob(download.id)!;
    expect(conversion.sourceReused).toBe(false);
    const output = path.join(config.downloadDir, conversion.outputFile!);
    expect(fs.existsSync(output)).toBe(true);
    const inspection = await inspectMedia(config.ffprobeBin, output);
    expect(isMobileCompatible(inspection)).toBe(true);
    expect(inspection.displayWidth).toBeLessThanOrEqual(1280);
    expect(inspection.displayHeight).toBeLessThanOrEqual(720);
    worker.stop();
    db.close();
  });

  it("quiesces an active conversion after its download record is hard-deleted", async () => {
    const { db, download, source, config, worker } = fixture("1920x1080");
    config.ffmpegBin = ffmpegStub;
    worker.start();
    await vi.waitFor(() => {
      expect(db.getConversionJob(download.id)).toMatchObject({ status: "running" });
      expect(db.getConversionJob(download.id)?.message).toMatch(/pass 1/);
    }, { timeout: 10_000, interval: 20 });

    expect(db.deleteJob(download.id)).toBe(true);
    await worker.remove(download.id);
    fs.rmSync(path.dirname(source), { recursive: true, force: true });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(db.getJob(download.id)).toBeNull();
    expect(db.getConversionJob(download.id)).toBeNull();
    expect(fs.existsSync(path.dirname(source))).toBe(false);
    worker.stop();
    db.close();
  });
});
