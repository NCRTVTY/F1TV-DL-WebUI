import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { patchDownloadSource } from "../scripts/patch-download-policy.mjs";
const require = createRequire(import.meta.url);
const fixture = (kind: string) =>
  JSON.parse(
    fs.readFileSync(
      new URL("./fixtures/download-policy-" + kind + ".json", import.meta.url),
      "utf8",
    ),
  );
describe("pinned native download policy", () => {
  it.each(["index", "api"])(
    "patches %s idempotently and rejects source or policy drift",
    (kind) => {
      const source = fixture(kind),
        patched = patchDownloadSource(source, kind);
      expect(patchDownloadSource(patched, kind)).toBe(patched);
      expect(() => patchDownloadSource(source + "\n", kind)).toThrow(
        "source changed",
      );
      expect(() =>
        patchDownloadSource(
          patched.replace("Native 720p", "Modified 720p"),
          kind,
        ),
      ).toThrow();
    },
  );
  it("preserves the CLI shebang and executable syntax", () => {
    const help = execFileSync("node_modules/.bin/f1tv-dl", ["--help"], {
      encoding: "utf8",
    });
    expect(help).toContain("video-size");
  });
  it("never substitutes International or the default stream for a missing F1 LIVE feed", async () => {
    const source = patchDownloadSource(fixture("index"), "index");
    const section = source.slice(
      source.indexOf("const getTokenizedUrl ="),
      source.indexOf("\n(async () =>"),
    );
    const getContentStreamUrl = vi.fn(async () => "selected stream");
    const select = vm.runInNewContext(section + "\ngetTokenizedUrl", {
      log: { debug: () => {} },
      isRace: () => true,
      getContentStreamUrl,
      getAdditionalStreamsInfo: (
        streams: Array<{ title: string }>,
        name: string,
      ) => streams.find((s) => s.title === name),
    });
    for (const streams of [null, [], [{ title: "INTERNATIONAL" }]])
      await expect(
        select(
          "",
          { id: 1, metadata: { additionalStreams: streams } },
          "F1 LIVE",
        ),
      ).rejects.toThrow("F1 LIVE feed is unavailable");
    expect(getContentStreamUrl).not.toHaveBeenCalled();
    await expect(
      select(
        "",
        {
          id: 1,
          metadata: {
            additionalStreams: [
              { title: "F1 LIVE", channelId: 7, playbackUrl: "?channelId=7" },
            ],
          },
        },
        "F1 LIVE",
      ),
    ).resolves.toBe("selected stream");
    expect(getContentStreamUrl).toHaveBeenCalledWith(1, 7);
  });
  it("selects the exact English DASH representation and rejects absent 720p", async () => {
    const source = patchDownloadSource(fixture("api"), "api");
    const section = source.slice(
      source.indexOf("const getProgramStreamId ="),
      source.indexOf("const saveF1tvToken ="),
    );
    let language = "eng";
    let width = 1280;
    const select = vm.runInNewContext(section + "\ngetProgramStreamId", {
      axios: {
        get: async () => ({
          data:
            '<MPD><Period><AdaptationSet mimeType="audio/mp4" lang="spa"><Representation id="1"/></AdaptationSet><AdaptationSet mimeType="audio/mp4" lang="' +
            language +
            '"><Representation id="4"/></AdaptationSet></Period></MPD>',
        }),
      },
      DASH: {
        parse: () => ({
          playlists: [
            {
              attributes: {
                NAME: "8",
                BANDWIDTH: 2916352,
                RESOLUTION: { width, height: 720 },
              },
            },
          ],
        }),
      },
      HLS: {},
      XmlReader: require("xml-reader"),
      XmlQuery: require("xml-query"),
    });
    await expect(
      select("manifest.mpd", "eng", "1280x720"),
    ).resolves.toMatchObject({
      videoId: 8,
      audioId: 4,
      width: 1280,
      height: 720,
    });
    language = "spa";
    expect((await select("manifest.mpd", "eng", "1280x720")).audioId).toBe(-1);
    width = 1920;
    await expect(select("manifest.mpd", "eng", "1280x720")).rejects.toThrow(
      "Native 720p video is unavailable",
    );
  });
});
