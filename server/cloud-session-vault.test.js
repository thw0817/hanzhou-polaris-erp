import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalCloudSessionVault } from "./cloud-session-vault.js";

test("local cloud session vault encrypts the access token at rest", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shein-cloud-vault-"));
  const filePath = path.join(directory, "session.json");
  const vault = new LocalCloudSessionVault({ filePath });

  const installation = vault.getOrCreateInstallation();
  vault.saveSession({
    accessToken: "scs_super_secret",
    tokenType: "Bearer",
    tenant: { id: "tenant-1", name: "测试租户" },
    device: { id: "device-1", name: "测试电脑" },
    expiresAt: "2026-08-30T00:00:00.000Z",
  });

  const encryptedFile = readFileSync(filePath, "utf8");
  assert.equal(encryptedFile.includes("scs_super_secret"), false);
  assert.equal(encryptedFile.includes("测试租户"), false);
  assert.equal(statSync(filePath).mode & 0o777, 0o600);
  assert.equal(statSync(`${filePath}.key`).mode & 0o777, 0o600);

  const reopened = new LocalCloudSessionVault({ filePath }).load();
  assert.equal(reopened.installationId, installation.installationId);
  assert.equal(reopened.session.accessToken, "scs_super_secret");
});

test("clearing a cloud session preserves the installation identity", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shein-cloud-vault-"));
  const filePath = path.join(directory, "session.json");
  const vault = new LocalCloudSessionVault({ filePath });
  const installationId = vault.getOrCreateInstallation().installationId;

  vault.saveSession({ accessToken: "scs_secret" });
  vault.clearSession();

  const value = vault.load();
  assert.equal(value.installationId, installationId);
  assert.equal(value.session, null);
});
