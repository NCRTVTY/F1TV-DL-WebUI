import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const MOBILE_MAX_BYTES = 3_000_000_000;
export const MOBILE_TARGET_BYTES = 2_850_000_000;
export const MOBILE_AUDIO_BITRATE = 160_000;
export const MOBILE_MAX_VIDEO_BITRATE = 3_500_000;
export const MOBILE_MIN_VIDEO_BITRATE = 250_000;

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
}

interface ProbeDocument {
  format?: { format_name?: string; duration?: string };
  streams?: ProbeStream[];
}

export interface MediaInspection {
  size: number;
  durationSeconds: number;
  formatNames: string[];
  videoCodec: string | null;
  audioCodec: string | null;
  pixelFormat: string | null;
  displayWidth: number;
  displayHeight: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

function finitePositive(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function rotationOf(stream: ProbeStream): number {
  const sideDataRotation = stream.side_data_list?.find((entry) => Number.isFinite(entry.rotation))?.rotation;
  if (typeof sideDataRotation === "number") return sideDataRotation;
  return Number.parseFloat(stream.tags?.rotate ?? "0") || 0;
}

export async function inspectMedia(ffprobeBin: string, filename: string): Promise<MediaInspection> {
  const [stat, result] = await Promise.all([
    fs.promises.stat(filename),
    execFileAsync(ffprobeBin, [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filename
    ], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" })
  ]);
  if (!stat.isFile()) throw new Error("Media path is not a file");

  let document: ProbeDocument;
  try {
    document = JSON.parse(result.stdout) as ProbeDocument;
  } catch {
    throw new Error("FFprobe returned invalid media metadata");
  }

  const streams = document.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const duration = finitePositive(document.format?.duration) ?? finitePositive(video?.duration) ?? finitePositive(audio?.duration);
  if (!duration) throw new Error("Media duration is unavailable");

  const width = finitePositive(video?.width) ?? 0;
  const height = finitePositive(video?.height) ?? 0;
  const rotated = Math.abs(rotationOf(video ?? {})) % 180 === 90;

  return {
    size: stat.size,
    durationSeconds: duration,
    formatNames: (document.format?.format_name ?? "").split(",").map((name) => name.trim()).filter(Boolean),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    pixelFormat: video?.pix_fmt ?? null,
    displayWidth: rotated ? height : width,
    displayHeight: rotated ? width : height,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio)
  };
}

export function isMobileCompatible(media: MediaInspection): boolean {
  return media.size > 0
    && media.size < MOBILE_MAX_BYTES
    && media.formatNames.includes("mp4")
    && media.hasVideo
    && media.hasAudio
    && media.videoCodec === "h264"
    && media.audioCodec === "aac"
    && (media.pixelFormat === "yuv420p" || media.pixelFormat === "yuvj420p")
    && media.displayWidth > 0
    && media.displayHeight > 0
    && media.displayWidth <= 1280
    && media.displayHeight <= 720;
}

export function mobileVideoBitrate(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("A valid duration is required");
  const totalBitsPerSecond = Math.floor((MOBILE_TARGET_BYTES * 8) / durationSeconds);
  const available = totalBitsPerSecond - MOBILE_AUDIO_BITRATE;
  if (available < MOBILE_MIN_VIDEO_BITRATE) {
    throw new Error("The session is too long to fit a usable 720p MP4 below 3 GB");
  }
  return Math.min(MOBILE_MAX_VIDEO_BITRATE, available);
}

export function mobileOutputRelative(sourceRelative: string): string {
  const directory = path.dirname(sourceRelative);
  const extension = path.extname(sourceRelative);
  const base = path.basename(sourceRelative, extension);
  return path.join(directory, `${base}-720p-mobile.mp4`);
}

export function conversionPaths(finalFilename: string): { temporary: string; passlog: string } {
  const extension = path.extname(finalFilename);
  const stem = finalFilename.slice(0, -extension.length);
  return { temporary: `${stem}.temporary${extension}`, passlog: `${stem}.ffmpeg-pass` };
}

export function ffmpegPassArguments(source: string, output: string, passlog: string, bitrate: number, pass: 1 | 2): string[] {
  const common = [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-stats_period", "1", "-progress", "pipe:1",
    "-y", "-i", source,
    "-map", "0:v:0", "-map", "0:a:0",
    "-vf", "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p",
    "-b:v", String(bitrate), "-maxrate", String(bitrate * 2), "-bufsize", String(bitrate * 4),
    "-pass", String(pass), "-passlogfile", passlog
  ];
  if (pass === 1) return [...common, "-an", "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"];
  return [
    ...common,
    "-c:a", "aac", "-b:a", String(MOBILE_AUDIO_BITRATE), "-ac", "2",
    "-movflags", "+faststart", "-f", "mp4", output
  ];
}

export async function removeConversionArtifacts(finalFilename: string): Promise<void> {
  const { temporary, passlog } = conversionPaths(finalFilename);
  await Promise.all([
    temporary,
    passlog,
    `${passlog}-0.log`,
    `${passlog}-0.log.mbtree`
  ].map((filename) => fs.promises.rm(filename, { force: true }).catch(() => undefined)));
}
