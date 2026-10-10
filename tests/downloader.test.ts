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
  createdAt: "2026-10-10T00:00:00.000Z",
  startedAt: null,
  finishedAt: null
};

describe("f1tv-dl command construction", () => {
  it("passes fixed arguments without credentials", () => {
    const args = buildArguments(job, "/downloads/fixture-job");
    expect(args).toEqual([
      job.url,
      "--format", "mp4",
      "--video-size", "1920x1080",
      "--audio-stream", "nld",
      "--output-directory", "/downloads/fixture-job",
      "--log-level", "info",
      "--channel", "INTERNATIONAL"
    ]);
    expect(args.join(" ")).not.toMatch(/username|password/i);
  });
});
