import { describe, expect, it } from "vitest";
import { buildArguments } from "../src/server/downloader";
import type { Job } from "../src/server/database";

const job: Job = {
  id: "fixture-job",
  url: "https://f1tv.formula1.com/detail/100/example-session",
  quality: "1920x1080",
  audio: "nld",
  channel: "INTERNATIONAL",
  contentId: "100",
  title: "Example session",
  status: "running",
  progress: 0,
  message: null,
  outputFile: null,
  outputSize: null,
  createdAt: "2026-10-10T00:00:00.000Z",
  startedAt: null,
  thumbnailUrl: null,
  eventId: null,
  season: null,
  durationSeconds: null,
  position: 1,
  finishedAt: null,
};

describe("f1tv-dl command construction", () => {
  it("passes fixed arguments without credentials", () => {
    const args = buildArguments(job, "/downloads/fixture-job");
    expect(args).toEqual([
      job.url,
      "--format",
      "mp4",
      "--video-size",
      "1280x720",
      "--audio-stream",
      "eng",
      "--output-directory",
      "/downloads/fixture-job/",
      "--log-level",
      "info",
      "--channel",
      "F1 LIVE",
    ]);
    expect(args.join(" ")).not.toMatch(/username|password/i);
  });
});
