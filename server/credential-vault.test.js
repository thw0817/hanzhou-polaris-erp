import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { EncryptedCredentialVault } from "./credential-vault.js";
import { StoreRegistry } from "./store-registry.js";

test("persists store credentials encrypted at rest", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shein-vault-"));
  const filePath = path.join(directory, "stores.json");

  try {
    const vault = new EncryptedCredentialVault({
      filePath,
      appId: "APP_ID",
      appSecret: "0123456789ABCDEF0123456789ABCDEF",
    });
    const registry = new StoreRegistry({ vault });
    registry.upsertStore({
      openKeyId: "OPEN_KEY_ID_SHOULD_NOT_BE_PLAINTEXT",
      secretKey: "STORE_SECRET_SHOULD_NOT_BE_PLAINTEXT",
      supplierId: 5554076,
      businessMode: "全托管",
      source: "authorization",
    });

    const rawFile = readFileSync(filePath, "utf8");
    assert.equal(rawFile.includes("OPEN_KEY_ID_SHOULD_NOT_BE_PLAINTEXT"), false);
    assert.equal(rawFile.includes("STORE_SECRET_SHOULD_NOT_BE_PLAINTEXT"), false);

    const restored = new StoreRegistry({
      vault: new EncryptedCredentialVault({
        filePath,
        appId: "APP_ID",
        appSecret: "0123456789ABCDEF0123456789ABCDEF",
      }),
    });
    assert.equal(restored.getStore("5554076").openKeyId, "OPEN_KEY_ID_SHOULD_NOT_BE_PLAINTEXT");
    assert.equal(restored.getStore("5554076").secretKey, "STORE_SECRET_SHOULD_NOT_BE_PLAINTEXT");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("removing a store updates the encrypted vault", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shein-vault-remove-"));
  const filePath = path.join(directory, "stores.json");

  try {
    const options = {
      filePath,
      appId: "APP_ID",
      appSecret: "0123456789ABCDEF0123456789ABCDEF",
    };
    const registry = new StoreRegistry({
      vault: new EncryptedCredentialVault(options),
    });
    registry.upsertStore({
      openKeyId: "OPEN_KEY",
      secretKey: "STORE_SECRET",
      supplierId: 1,
    });
    registry.removeStore("1");

    const restored = new StoreRegistry({
      vault: new EncryptedCredentialVault(options),
    });
    assert.deepEqual(restored.listStores(), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("renaming a store persists only local display metadata", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shein-vault-rename-"));
  const filePath = path.join(directory, "stores.json");

  try {
    const options = {
      filePath,
      appId: "APP_ID",
      appSecret: "0123456789ABCDEF0123456789ABCDEF",
    };
    const registry = new StoreRegistry({
      vault: new EncryptedCredentialVault(options),
    });
    registry.upsertStore({
      openKeyId: "OPEN_KEY",
      secretKey: "STORE_SECRET",
      supplierId: 1,
    });
    assert.equal(registry.renameStore("1", "圣锐达1店").label, "圣锐达1店");

    const restored = new StoreRegistry({
      vault: new EncryptedCredentialVault(options),
    });
    assert.equal(restored.listStores()[0].label, "圣锐达1店");
    assert.equal(restored.getStore("1").secretKey, "STORE_SECRET");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("persists reauthorization-required status and clears it after authorization", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shein-vault-status-"));
  const filePath = path.join(directory, "stores.json");

  try {
    const options = {
      filePath,
      appId: "APP_ID",
      appSecret: "0123456789ABCDEF0123456789ABCDEF",
    };
    const registry = new StoreRegistry({
      vault: new EncryptedCredentialVault(options),
    });
    registry.upsertStore({
      openKeyId: "OPEN_KEY",
      secretKey: "STORE_SECRET",
      supplierId: 1,
      label: "圣锐达1店",
    });
    assert.equal(registry.markReauthorizationRequired("1").status, "reauthorization_required");

    const restored = new StoreRegistry({
      vault: new EncryptedCredentialVault(options),
    });
    assert.equal(restored.listStores()[0].status, "reauthorization_required");
    assert.equal(
      restored.upsertStore({
        openKeyId: "OPEN_KEY_NEW",
        secretKey: "STORE_SECRET_NEW",
        supplierId: 1,
        label: "圣锐达1店",
        status: "active",
      }).status,
      "active",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migrates the legacy APP_SECRET-derived vault to a random local key", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shein-vault-migrate-"));
  const filePath = path.join(directory, "stores.json");
  const keyPath = path.join(directory, "stores.key");
  const appId = "APP_ID";
  const appSecret = "0123456789ABCDEF0123456789ABCDEF";
  const credentials = [{
    openKeyId: "OPEN-LEGACY",
    secretKey: "STORE-LEGACY",
    supplierId: 88,
  }];

  try {
    const key = scryptSync(
      appSecret,
      `shein-store-vault:1:${appId}`,
      32,
    );
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(
      Buffer.from("shein-operations-console/store-vault/v1", "utf8"),
    );
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(credentials), "utf8"),
      cipher.final(),
    ]);
    writeFileSync(filePath, JSON.stringify({
      version: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    }));

    const vault = new EncryptedCredentialVault({
      filePath,
      keyPath,
      appId,
      appSecret,
    });
    assert.deepEqual(vault.load(), credentials);

    const migrated = JSON.parse(readFileSync(filePath, "utf8"));
    assert.equal(migrated.version, 2);
    assert.equal(statSync(keyPath).mode & 0o777, 0o600);
    assert.deepEqual(
      new EncryptedCredentialVault({ filePath, keyPath }).load(),
      credentials,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
