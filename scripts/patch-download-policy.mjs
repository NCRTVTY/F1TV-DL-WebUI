import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const digest = (s) => createHash("sha256").update(s).digest("hex");
const marker = "// F1TV WebUI fixed 720p English F1 LIVE policy\n";
const hashes = JSON.parse(
  fs.readFileSync(
    new URL("./download-policy-hashes.json", import.meta.url),
    "utf8",
  ),
);
const oldAudio =
  "const audioSelectString = (useDash) ? '0:a' : " +
  String.fromCharCode(96) +
  "0:p:" +
  "$" +
  "{programStream}:a" +
  String.fromCharCode(96) +
  ";";
const changes = {
  index: [
    [
      "    let f1tvUrl;\n    log.debug",
      "    if (channel !== 'F1 LIVE') throw new Error('Only the F1 LIVE feed is supported');\n    let f1tvUrl;\n    log.debug",
    ],
    [
      "        f1tvUrl = await getContentStreamUrl(content.id);",
      "        throw new Error('F1 LIVE feed is unavailable for this replay');",
    ],
    [
      "        let channelId = (stream.playbackUrl",
      "        if (!stream || String(stream.title).trim().toUpperCase() !== 'F1 LIVE') throw new Error('F1 LIVE feed is unavailable for this replay');\n        let channelId = (stream.playbackUrl",
    ],
    [
      "        const plDetails = await getProgramStreamId(f1tvUrl, audioStream, videoSize);",
      "        if (videoSize !== '1280x720' || audioStream !== 'eng' || includeInternationalAudio) throw new Error('Only native 720p with English F1 LIVE commentary is supported');\n        const plDetails = await getProgramStreamId(f1tvUrl, audioStream, videoSize);\n        if (plDetails.width !== 1280 || plDetails.height !== 720 || !Number.isInteger(plDetails.videoId) || !Number.isInteger(plDetails.audioId) || plDetails.audioId < 0) throw new Error('Native 720p English audio is unavailable for this replay');",
    ],
    [
      oldAudio,
      "const audioSelectString = (useDash) ? '0:a:m:id:' + audioStreamId : '0:p:' + programStream + ':a:' + audioStreamId;",
    ],
    [
      "log.error('Error:', e.message);",
      "process.exitCode = 1;\n        log.error('Error:', e.message);",
    ],
    [
      "log.error('ffmpeg error:', e.message);",
      "log.error('Download process failed');\n                    process.exitCode = 1;",
    ],
  ],
  api: [
    [
      "const mpd = XmlReader.parseSync(result.data);",
      "if (!variant.playlist) throw new Error('Native 720p video is unavailable for this replay');\n                const mpd = XmlReader.parseSync(result.data);",
    ],
    [
      "variant.audioId = parseInt(audio.attributes.id);",
      "variant.audioId = audio ? parseInt(audio.attributes.id) : -1;",
    ],
    [
      "for (let i = 0; i < variant.playlist.audio.length; i++) {",
      "if (!variant.playlist) throw new Error('Native 720p video is unavailable for this replay');\n                for (let i = 0; i < variant.playlist.audio.length; i++) {",
    ],
  ],
};
export function patchDownloadSource(source, kind) {
  const edits = changes[kind];
  if (!edits) throw new Error("Unknown download policy module");
  const shebang = kind === "index" ? "#!/usr/bin/env node\n" : "";
  const prefix = shebang + marker;
  let original = source;
  if (source.startsWith(prefix)) {
    original = shebang + source.slice(prefix.length);
    for (const [before, after] of [...edits].reverse())
      original = original.split(after).join(before);
  }
  if (digest(original) !== hashes[kind])
    throw new Error(
      "Cannot patch f1tv-dl: pinned " + kind + " download source changed",
    );
  let patched = original;
  for (const [before, after] of edits) {
    if (!patched.includes(before))
      throw new Error(
        "Cannot patch f1tv-dl: expected policy location is missing",
      );
    patched = patched.split(before).join(after);
  }
  patched = prefix + patched.slice(shebang.length);
  if (source.startsWith(prefix) && source !== patched)
    throw new Error("Cannot patch f1tv-dl: download policy was altered");
  return patched;
}
export function patchDownloads() {
  for (const [kind, relative] of Object.entries({
    index: "index.js",
    api: "lib/f1tv-api.js",
  })) {
    const filename = path.resolve("node_modules/@thedave42/f1tv-dl", relative);
    const source = fs.readFileSync(filename, "utf8"),
      patched = patchDownloadSource(source, kind);
    if (source !== patched) fs.writeFileSync(filename, patched);
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  patchDownloads();
