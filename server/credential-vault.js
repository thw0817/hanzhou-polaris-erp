import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const LEGACY_VAULT_VERSION = 1;
const VAULT_VERSION = 2;
const ALGORITHM = "aes-256-gcm";
const LEGACY_AAD = Buffer.from(
  "shein-operations-console/store-vault/v1",
  "utf8",
);
const AAD = Buffer.from("shein-operations-console/store-vault/v2", "utf8");

function deriveVaultKey(appId, appSecret) {
  if (!appId || !appSecret) {
    throw new TypeError("appId and appSecret are required for credential storage");
  }
  return scryptSync(
    appSecret,
    `shein-store-vault:${LEGACY_VAULT_VERSION}:${appId}`,
    32,
  );
}

export class EncryptedCredentialVault {
  constructor({
    filePath,
    keyPath = `${filePath}.key`,
    appId = "",
    appSecret = "",
  }) {
    if (!filePath) throw new TypeError("Credential vault filePath is required");
    this.filePath = filePath;
    this.keyPath = keyPath;
    this.appId = appId;
    this.appSecret = appSecret;
  }

  load() {
    if (!existsSync(this.filePath)) return [];

    const envelope = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (envelope.version === LEGACY_VAULT_VERSION) {
      const credentials = this.#decryptEnvelope(
        envelope,
        deriveVaultKey(this.appId, this.appSecret),
        LEGACY_AAD,
      );
      this.save(credentials);
      return credentials;
    }
    if (envelope.version !== VAULT_VERSION || envelope.algorithm !== ALGORITHM) {
      throw new Error("Unsupported SHEIN credential vault format");
    }
    return this.#decryptEnvelope(
      envelope,
      this.#loadOrCreateKey({ allowCreate: false }),
      AAD,
    );
  }

  #decryptEnvelope(envelope, key, aad) {
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    const credentials = JSON.parse(plaintext.toString("utf8"));
    if (!Array.isArray(credentials)) {
      throw new Error("Invalid SHEIN credential vault payload");
    }
    return credentials;
  }

  save(credentials) {
    if (!Array.isArray(credentials)) {
      throw new TypeError("Credential vault payload must be an array");
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv(
      ALGORITHM,
      this.#loadOrCreateKey({ allowCreate: true }),
      iv,
    );
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(credentials), "utf8"),
      cipher.final(),
    ]);
    const envelope = {
      version: VAULT_VERSION,
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

  #loadOrCreateKey({ allowCreate }) {
    if (existsSync(this.keyPath)) {
      const key = Buffer.from(
        readFileSync(this.keyPath, "utf8").trim(),
        "base64",
      );
      if (key.length !== 32) {
        throw new Error("Invalid local SHEIN credential vault key");
      }
      return key;
    }
    if (!allowCreate) {
      throw new Error("Local SHEIN credential vault key is missing");
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
