import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRange, resolveStoredFile } from "../src/server/files";

describe("download file boundaries", () => {
  it("resolves files below the download root", () => {
    expect(resolveStoredFile("/tmp/downloads", "job/session.mp4")).toBe(path.resolve("/tmp/downloads/job/session.mp4"));
  });

  it("rejects traversal outside the download root", () => {
    expect(() => resolveStoredFile("/tmp/downloads", "../private.mp4")).toThrow(/outside/);
  });

  it.each([
    ["bytes=0-99", 1000, { start: 0, end: 99 }],
    ["bytes=900-", 1000, { start: 900, end: 999 }],
    ["bytes=-100", 1000, { start: 900, end: 999 }]
  ])("parses %s", (header, size, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });

  it("rejects unsatisfiable ranges", () => {
    expect(() => parseRange("bytes=1000-1200", 1000)).toThrow(/Unsatisfiable/);
  });
});
