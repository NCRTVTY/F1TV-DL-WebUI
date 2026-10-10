import fs from "node:fs";
import path from "node:path";

export function resolveStoredFile(root: string, relativeFile: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativeFile);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("File is outside the download directory");
  }
  return resolved;
}

export function parseRange(rangeHeader: string | undefined, size: number): { start: number; end: number } | null {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) throw new Error("Invalid byte range");

  if (!match[1] && !match[2]) throw new Error("Invalid byte range");
  let start: number;
  let end: number;

  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) throw new Error("Invalid byte range");
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    throw new Error("Unsatisfiable byte range");
  }
  return { start, end: Math.min(end, size - 1) };
}

export async function fileMetadata(filename: string): Promise<{ size: number; name: string }> {
  const stat = await fs.promises.stat(filename);
  if (!stat.isFile()) throw new Error("Download is not a file");
  return { size: stat.size, name: path.basename(filename) };
}
