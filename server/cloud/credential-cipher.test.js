import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { CloudCredentialCipher } from "./credential-cipher.js";

test("encrypts each cloud store secret with authenticated context", () => {
  const cipher = new CloudCredentialCipher({
    base64Key: crypto.randomBytes(32).toString("base64"),
  });
  const context = { storeId: "store-1", openKeyId: "open-key-1" };
  const encrypted = cipher.encrypt("store-secret", context);

  assert.notEqual(encrypted.ciphertext.toString("utf8"), "store-secret");
  assert.equal(cipher.decrypt(encrypted, context), "store-secret");
  assert.throws(
    () =>
      cipher.decrypt(encrypted, {
        storeId: "store-2",
        openKeyId: "open-key-1",
      }),
    (error) => error.code === "CLOUD_CREDENTIAL_DECRYPT_FAILED",
  );
});

test("rejects an invalid cloud master key", () => {
  assert.throws(
    () => new CloudCredentialCipher({ base64Key: "too-short" }),
    /32 字节/,
  );
});
