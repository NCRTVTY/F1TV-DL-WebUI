import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/server/database";
const roots: string[] = [];
function fixture() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-reset-")),
  );
  roots.push(root);
  const db = new AppDatabase(path.join(root, "f1tv-dl-webui.sqlite"));
  db.setSetting("f1tv_credentials", "opaque-test-envelope");
  db.setSetting("catalog:seasons", "old cache");
  return { root, db };
}
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
describe("explicit fresh start", () => {
  it("backs up and clears history while preserving the saved account exactly", () => {
    let { root, db } = fixture();
    const j = db.createJob({
      url: "https://f1tv.formula1.com/detail/1/replay",
    });
    db.cancelJob(j.id);
    db.close();
    const output = execFileSync(
      process.execPath,
      ["scripts/reset-library.cjs", "--confirm-reset-library"],
      { env: { ...process.env, DATA_DIR: root }, encoding: "utf8" },
    );
    expect(output).toContain('"savedAccountPreserved":true');
    db = new AppDatabase(path.join(root, "f1tv-dl-webui.sqlite"));
    expect(db.listJobs()).toEqual([]);
    expect(db.getSetting("catalog:seasons")).toBeNull();
    expect(db.getSetting("f1tv_credentials")).toBe("opaque-test-envelope");
    const backups = fs.readdirSync(path.join(root, "backups"));
    expect(backups).toHaveLength(1);
    expect(
      fs.statSync(path.join(root, "backups", backups[0])).mode & 0o777,
    ).toBe(0o600);
    db.close();
  });
  it("refuses to reset while work is pending", () => {
    const { root, db } = fixture();
    const j = db.createJob({
      url: "https://f1tv.formula1.com/detail/1/replay",
    });
    expect(() =>
      execFileSync(
        process.execPath,
        ["scripts/reset-library.cjs", "--confirm-reset-library"],
        { env: { ...process.env, DATA_DIR: root }, stdio: "pipe" },
      ),
    ).toThrow();
    expect(db.getJob(j.id)?.status).toBe("queued");
    expect(db.getSetting("catalog:seasons")).toBe("old cache");
    db.close();
  });
});
