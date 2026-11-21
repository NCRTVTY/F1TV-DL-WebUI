import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaStorage } from "../src/server/storage";
import { loadConfig } from "../src/server/config";
const roots: string[] = [];
function root() {
  const r = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-storage-")),
  );
  roots.push(r);
  return r;
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const r of roots.splice(0))
    fs.rmSync(r, { recursive: true, force: true });
});
describe("storage readiness", () => {
  it("allows local production storage while preserving explicit home NFS enforcement", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REQUIRE_NFS", "false");
    const dir = root();
    const config = loadConfig({ downloadDir: dir, storageLabel: "Archive disk" });
    expect(config.requireNfs).toBe(false);
    expect(await new MediaStorage(config).check()).toMatchObject({ ready: true, location: "Archive disk" });
    vi.stubEnv("REQUIRE_NFS", "true");
    expect(await new MediaStorage(loadConfig({ downloadDir: dir })).check()).toMatchObject({ ready: false });
  });
  it("never creates a local fallback when the NFS path is absent", async () => {
    const dir = path.join(root(), "missing");
    const s = new MediaStorage(
      loadConfig({ downloadDir: dir, requireNfs: true }),
    );
    expect(await s.check()).toMatchObject({ ready: false, writable: false });
    expect(fs.existsSync(dir)).toBe(false);
    await expect(s.requireReady()).rejects.toMatchObject({ statusCode: 503 });
  });
  it("rejects a local directory even if it contains the correct marker", async () => {
    const dir = root();
    fs.writeFileSync(path.join(dir, ".f1tv-storage-id"), "f1tv-dl-media-v1");
    const s = new MediaStorage(
      loadConfig({ downloadDir: dir, requireNfs: true }),
    );
    expect(await s.check()).toMatchObject({
      ready: false,
      message: "The expected NFS volume is not mounted",
    });
    expect(fs.readdirSync(dir)).toEqual([".f1tv-storage-id"]);
  });
  it("reports local development space and leaves no write probes", async () => {
    const dir = root();
    const s = new MediaStorage(
      loadConfig({
        downloadDir: dir,
        requireNfs: false,
        storageMinFreeBytes: Number.MAX_SAFE_INTEGER,
      }),
    );
    expect(await s.check()).toMatchObject({
      ready: true,
      writable: true,
      enoughSpace: false,
    });
    expect(fs.readdirSync(dir)).toEqual([]);
  });
  it("rejects an unexpected symlink root", async () => {
    const dir = root();
    const alias = path.join(dir, "alias");
    fs.symlinkSync(dir, alias);
    const s = new MediaStorage(
      loadConfig({ downloadDir: alias, requireNfs: false }),
    );
    expect((await s.check()).ready).toBe(false);
  });
});
