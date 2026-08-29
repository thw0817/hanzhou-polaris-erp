import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export class CloudCredentialCipher {
  constructor({ base64Key, keyVersion = 1 } = {}) {
    this.key = Buffer.from(base64Key || "", "base64");
    if (this.key.length !== 32) {
      throw new Error(
        "SHEIN_CLOUD_ENCRYPTION_KEY 必须是 32 字节密钥的 base64 值",
      );
    }
    this.keyVersion = keyVersion;
  }

  encrypt(secret, { storeId, openKeyId } = {}) {
    if (!secret) throw new Error("店铺 secretKey 不能为空");
    if (!storeId || !openKeyId) {
      throw new Error("加密店铺凭证时缺少 storeId 或 openKeyId");
    }
    return this.encryptScoped(secret, { scope: `${storeId}:${openKeyId}` });
  }

  encryptScoped(secret, { scope } = {}) {
    if (!secret) throw new Error("加密内容不能为空");
    if (!scope) throw new Error("加密内容缺少作用域");
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(String(scope), "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    return {
      ciphertext,
      iv,
      authTag: cipher.getAuthTag(),
      algorithm: "AES-256-GCM",
      keyVersion: this.keyVersion,
    };
  }

  decrypt(encrypted, { storeId, openKeyId } = {}) {
    if (!storeId || !openKeyId) {
      throw new Error("解密店铺凭证时缺少 storeId 或 openKeyId");
    }
    return this.decryptScoped(encrypted, { scope: `${storeId}:${openKeyId}` });
  }

  decryptScoped(encrypted, { scope } = {}) {
    if (!scope) throw new Error("解密内容缺少作用域");
    try {
      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        this.key,
        encrypted.iv,
      );
      decipher.setAAD(Buffer.from(String(scope), "utf8"));
      decipher.setAuthTag(encrypted.authTag);
      return Buffer.concat([
        decipher.update(encrypted.ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch (cause) {
      const error = new Error("云端加密凭证无法解密，请重新授权或重新配置");
      error.code = "CLOUD_CREDENTIAL_DECRYPT_FAILED";
      error.cause = cause;
      throw error;
    }
  }
}
