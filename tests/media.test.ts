import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MOBILE_MAX_VIDEO_BITRATE,
  MOBILE_TARGET_BYTES,
  ffmpegPassArguments,
  isMobileCompatible,
  mobileOutputRelative,
  mobileVideoBitrate
} from "../src/server/media";

describe("mobile media policy", () => {
  const compatible = {
    size: 2_900_000_000,
    durationSeconds: 7200,
    formatNames: ["mov", "mp4"],
    videoCodec: "h264",
    audioCodec: "aac",
    pixelFormat: "yuv420p",
    displayWidth: 1280,
    displayHeight: 720,
    hasVideo: true,
    hasAudio: true
  };

  it("reuses only bounded Android-compatible 720p MP4 files", () => {
    expect(isMobileCompatible(compatible)).toBe(true);
    expect(isMobileCompatible({ ...compatible, size: 3_000_000_000 })).toBe(false);
    expect(isMobileCompatible({ ...compatible, displayWidth: 1920, displayHeight: 1080 })).toBe(false);
    expect(isMobileCompatible({ ...compatible, videoCodec: "hevc" })).toBe(false);
    expect(isMobileCompatible({ ...compatible, audioCodec: "ac3" })).toBe(false);
    expect(isMobileCompatible({ ...compatible, hasAudio: false })).toBe(false);
  });

  it("caps normal 720p bitrate and calculates a long-session bitrate below the size target", () => {
    expect(mobileVideoBitrate(1800)).toBe(MOBILE_MAX_VIDEO_BITRATE);
    const duration = 4 * 60 * 60;
    const videoBitrate = mobileVideoBitrate(duration);
    expect(videoBitrate).toBeLessThan(MOBILE_MAX_VIDEO_BITRATE);
    const predictedBytes = ((videoBitrate + 160_000) * duration) / 8;
    expect(predictedBytes).toBeLessThanOrEqual(MOBILE_TARGET_BYTES);
  });

  it("uses deterministic mobile names and explicit two-pass Android settings", () => {
    expect(mobileOutputRelative(path.join("job-id", "Race.mp4"))).toBe(path.join("job-id", "Race-720p-mobile.mp4"));
    const first = ffmpegPassArguments("source.mp4", "temporary.mp4", "passlog", 2_000_000, 1);
    const second = ffmpegPassArguments("source.mp4", "temporary.mp4", "passlog", 2_000_000, 2);
    expect(first).toEqual(expect.arrayContaining(["-pass", "1", "-an", "-f", "null"]));
    expect(second).toEqual(expect.arrayContaining(["-pass", "2", "-c:a", "aac", "-ac", "2", "-movflags", "+faststart"]));
    expect(second.join(" ")).toContain("yuv420p");
  });
});
