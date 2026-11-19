import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
const execute = promisify(execFile);
export interface MediaInspection {
  size: number;
  durationSeconds: number;
  videoCodec: string;
  audioCodec: string;
  width: number;
  height: number;
  frameRate: string;
}
export async function inspectDownload(
  ffprobe: string,
  file: string,
  expectedDuration?: number | null,
): Promise<MediaInspection> {
  const result = await execute(
    ffprobe,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      file,
    ],
    { timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
  );
  const data = JSON.parse(result.stdout) as {
    format?: { duration?: string; format_name?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      tags?: { language?: string };
    }>;
  };
  const videos = (data.streams ?? []).filter((s) => s.codec_type === "video"),
    audios = (data.streams ?? []).filter((s) => s.codec_type === "audio");
  const duration = Number(data.format?.duration);
  const size = (await fs.stat(file)).size;
  if (
    videos.length !== 1 ||
    videos[0].width !== 1280 ||
    videos[0].height !== 720 ||
    !["h264", "hevc"].includes(videos[0].codec_name ?? "")
  )
    throw new Error(
      "The provider did not produce the requested native 720p video",
    );
  if (
    audios.length !== 1 ||
    audios[0].codec_name !== "aac" ||
    audios[0].tags?.language !== "eng"
  )
    throw new Error(
      "The replay must contain exactly one English AAC audio track",
    );
  if (
    !size ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !data.format?.format_name?.split(",").includes("mp4")
  )
    throw new Error("The downloaded MP4 failed validation");
  if (
    expectedDuration &&
    duration < expectedDuration - Math.max(60, expectedDuration * 0.02)
  )
    throw new Error("The downloaded replay is incomplete");
  return {
    size,
    durationSeconds: duration,
    videoCodec: videos[0].codec_name!,
    audioCodec: audios[0].codec_name!,
    width: 1280,
    height: 720,
    frameRate: videos[0].r_frame_rate ?? "",
  };
}
