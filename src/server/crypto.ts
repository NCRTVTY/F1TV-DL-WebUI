import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface Credentials {
  username: string;
  password: string;
}

interface Envelope {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export class CredentialVault {
  private readonly key?: Buffer;

  constructor(secret?: string) {
    this.key = secret && secret.length >= 24
      ? createHash("sha256").update(secret, "utf8").digest()
      : undefined;
  }

  get ready(): boolean {
    return Boolean(this.key);
  }

  encrypt(credentials: Credentials): string {
    if (!this.key) {
      throw new Error("APP_ENCRYPTION_KEY must contain at least 24 characters");
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(credentials), "utf8"),
      cipher.final()
    ]);

    const envelope: Envelope = {
      version: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };

    return JSON.stringify(envelope);
  }

  decrypt(serialized: string): Credentials {
    if (!this.key) {
      throw new Error("APP_ENCRYPTION_KEY must contain at least 24 characters");
    }

    const envelope = JSON.parse(serialized) as Envelope;
    if (envelope.version !== 1) {
      throw new Error("Unsupported credential envelope");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(envelope.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext) as Credentials;

    if (!parsed.username || !parsed.password) {
      throw new Error("Stored credentials are invalid");
    }
    return parsed;
  }
}
