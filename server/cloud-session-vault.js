import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const AAD = Buffer.from(
  "shein-operations-console/cloud-session/v1",
  "utf8",
);

export class LocalCloudSessionVault {
  constructor({ filePath, keyPath = `${filePath}.key` } = {}) {
    if (!filePath) throw new TypeError("Cloud session filePath is required");
    this.filePath = filePath;
    this.keyPath = keyPath;
  }

  load() {
    if (!existsSync(this.filePath)) {
      return {
        installationId: randomUUID(),
        session: null,
      };
    }
    const envelope = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (envelope.version !== VERSION || envelope.algorithm !== ALGORITHM) {
      throw new Error("Unsupported cloud session vault format");
    }
    const key = this.#loadOrCreateKey({ allowCreate: false });
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    const value = JSON.parse(plaintext.toString("utf8"));
    if (!value.installationId) {
      throw new Error("Invalid cloud session vault payload");
    }
    return value;
  }

  save(value) {
    if (!value?.installationId) {
      throw new TypeError("Cloud session requires installationId");
    }
    const key = this.#loadOrCreateKey({ allowCreate: true });
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    const envelope = {
      version: VERSION,
      algorithm: ALGORITHM,
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(envelope, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, this.filePath);
  }

  getOrCreateInstallation() {
    const value = this.load();
    if (!existsSync(this.filePath)) this.save(value);
    return value;
  }

  saveSession(session) {
    const value = this.getOrCreateInstallation();
    this.save({
      ...value,
      session,
    });
  }

  clearSession() {
    const value = this.getOrCreateInstallation();
    this.save({
      installationId: value.installationId,
      session: null,
    });
  }

  #loadOrCreateKey({ allowCreate }) {
    if (existsSync(this.keyPath)) {
      const key = Buffer.from(readFileSync(this.keyPath, "utf8").trim(), "base64");
      if (key.length !== 32) {
        throw new Error("Invalid local cloud session key");
      }
      return key;
    }
    if (!allowCreate) {
      throw new Error("Local cloud session key is missing");
    }
    const key = randomBytes(32);
    mkdirSync(path.dirname(this.keyPath), { recursive: true, mode: 0o700 });
    writeFileSync(this.keyPath, `${key.toString("base64")}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return key;
  }
}
