import { describe, expect, it } from "vitest";
import { CredentialVault } from "../src/server/crypto";
import { redact } from "../src/server/redaction";

describe("CredentialVault", () => {
  it("encrypts and decrypts without retaining plaintext", () => {
    const vault = new CredentialVault("x".repeat(32));
    const encrypted = vault.encrypt({ username: "fixture-user", password: "fixture-value" });

    expect(encrypted).not.toContain("fixture-user");
    expect(encrypted).not.toContain("fixture-value");
    expect(vault.decrypt(encrypted)).toEqual({ username: "fixture-user", password: "fixture-value" });
  });

  it("refuses to operate without adequate key material", () => {
    const vault = new CredentialVault("short");
    expect(vault.ready).toBe(false);
    expect(() => vault.encrypt({ username: "fixture", password: "fixture" })).toThrow(/APP_ENCRYPTION_KEY/);
  });
});

describe("redact", () => {
  it("removes explicit values, auth fields, and URL tokens", () => {
    const clean = redact("fixture-value password=visible https://x.test/a?token=visible", ["fixture-value"]);
    expect(clean).not.toContain("visible");
    expect(clean).not.toContain("fixture-value");
    expect(clean).toContain("[REDACTED]");
  });
});
