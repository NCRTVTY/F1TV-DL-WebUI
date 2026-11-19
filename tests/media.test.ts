import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectDownload } from "../src/server/media";
let root: string, valid: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-media-"));
  valid = path.join(root, "native.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=1280x720:r=25:d=1",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-t",
    "1",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    "-metadata:s:a:0",
    "language=eng",
    valid,
  ]);
}, 30000);
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
describe("completed media validation", () => {
  it("accepts a single native 720p English MP4", async () => {
    expect(await inspectDownload("ffprobe", valid)).toMatchObject({
      width: 1280,
      height: 720,
      videoCodec: "h264",
      audioCodec: "aac",
    });
  });
  it("rejects truncated replay durations", async () => {
    await expect(inspectDownload("ffprobe", valid, 7200)).rejects.toThrow(
      "incomplete",
    );
  });
  it("rejects extra or non-English audio", async () => {
    const multi = path.join(root, "multi.mp4"),
      foreign = path.join(root, "foreign.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      valid,
      "-map",
      "0:v",
      "-map",
      "0:a",
      "-map",
      "0:a",
      "-c",
      "copy",
      multi,
    ]);
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      valid,
      "-map",
      "0",
      "-c",
      "copy",
      "-metadata:s:a:0",
      "language=spa",
      foreign,
    ]);
    await expect(inspectDownload("ffprobe", multi)).rejects.toThrow(
      "exactly one English",
    );
    await expect(inspectDownload("ffprobe", foreign)).rejects.toThrow(
      "exactly one English",
    );
  });
  it("rejects a different resolution", async () => {
    const wrong = path.join(root, "wrong.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      valid,
      "-vf",
      "scale=640:360",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "copy",
      wrong,
    ]);
    await expect(inspectDownload("ffprobe", wrong)).rejects.toThrow(
      "native 720p",
    );
  });
});
