import fs from "node:fs";
import { patchDownloads } from "./patch-download-policy.mjs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const defaultTokenModule = path.resolve(
  "node_modules/@thedave42/f1tv-dl/lib/f1tv-token.js",
);
const replacement = fs.readFileSync(
  new URL("./f1tv-token.cjs", import.meta.url),
  "utf8",
);
// Exact sources from pinned 0.25.18-alpha.0: upstream and our deployed v2 patch.
const supportedSources = new Set([
  "fe5f364a50237d6367d5fb24228398445940ad8efaa641415d0e1d810e691504",
  "b8fe3dd5729b2cf1ccf4be2df6847bb21f13cf7b4a443ed97ecdac265d07f337",
]);

export function patchSource(source) {
  if (source === replacement) return source;
  if (
    !supportedSources.has(createHash("sha256").update(source).digest("hex"))
  ) {
    throw new Error(
      "Cannot patch f1tv-dl: pinned authentication source changed",
    );
  }
  return replacement;
}

export function patchFile(filename = defaultTokenModule) {
  if (!fs.existsSync(filename))
    throw new Error("Cannot patch f1tv-dl: token module is missing");
  const source = fs.readFileSync(filename, "utf8");
  const patched = patchSource(source);
  if (patched !== source) fs.writeFileSync(filename, patched);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  patchFile();
  patchDownloads();
}
