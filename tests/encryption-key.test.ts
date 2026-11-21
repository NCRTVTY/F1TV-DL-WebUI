import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CredentialVault, resolveEncryptionKey } from "../src/server/crypto";

const roots: string[] = [];
function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f1tv-key-"));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("persistent installation key", () => {
  it("creates a private key once and decrypts the same account after restart", () => {
    const dir = root();
    const first = resolveEncryptionKey(dir);
    const envelope = new CredentialVault(first).encrypt({ username: "fixture", password: "fixture" });
    expect(first).toHaveLength(64);
    expect(fs.statSync(path.join(dir, "credential-encryption.key")).mode & 0o777).toBe(0o600);
    const restarted = resolveEncryptionKey(dir, undefined, true);
    expect(restarted).toBe(first);
    expect(new CredentialVault(restarted).decrypt(envelope)).toEqual({ username: "fixture", password: "fixture" });
  });

  it("preserves the externally managed home key without writing a replacement", () => {
    const dir = root();
    const explicit = "x".repeat(32);
    expect(resolveEncryptionKey(dir, explicit, true)).toBe(explicit);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("refuses to invent a new key for an existing account", () => {
    const dir = root();
    expect(() => resolveEncryptionKey(dir, undefined, true)).toThrow("original APP_ENCRYPTION_KEY");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("does not replace a damaged persistent key or follow a symlink", () => {
    const dir = root();
    const keyfile = path.join(dir, "credential-encryption.key");
    fs.writeFileSync(keyfile, "damaged");
    expect(() => resolveEncryptionKey(dir)).toThrow("restore its backup");
    expect(fs.readFileSync(keyfile, "utf8")).toBe("damaged");
    fs.unlinkSync(keyfile);
    fs.writeFileSync(path.join(dir, "other"), "x".repeat(32));
    fs.symlinkSync(path.join(dir, "other"), keyfile);
    expect(() => resolveEncryptionKey(dir)).toThrow("regular file");
  });
});
