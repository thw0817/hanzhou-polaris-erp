import {
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

const RANDOM_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SHEIN_IV_SEED = "space-station-default-iv";

export function createRandomKey(length = 5) {
  if (!Number.isInteger(length) || length <= 0) {
    throw new TypeError("Random key length must be a positive integer");
  }

  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => RANDOM_ALPHABET[byte % RANDOM_ALPHABET.length]).join("");
}

export function generateSheinSignature({
  openKeyId,
  secretKey,
  path,
  timestamp = Date.now().toString(),
  randomKey = createRandomKey(),
}) {
  if (!openKeyId || !secretKey || !path) {
    throw new TypeError("openKeyId, secretKey and path are required");
  }
  if (randomKey.length !== 5) {
    throw new TypeError("SHEIN randomKey must contain exactly 5 characters");
  }

  const value = `${openKeyId}&${timestamp}&${path}`;
  const key = `${secretKey}${randomKey}`;
  const hexadecimal = createHmac("sha256", key).update(value, "utf8").digest("hex");
  const encoded = Buffer.from(hexadecimal, "utf8").toString("base64");

  return `${randomKey}${encoded}`;
}

function deriveAesKey(appSecretKey) {
  if (!appSecretKey) {
    throw new TypeError("appSecretKey is required");
  }

  const result = Buffer.alloc(16);
  Buffer.from(appSecretKey, "utf8").copy(result, 0, 0, 16);
  return result;
}

export function decryptStoreSecretKey(encryptedSecretKey, appSecretKey) {
  if (!encryptedSecretKey) {
    throw new TypeError("encryptedSecretKey is required");
  }

  return decryptSheinAesPayload(encryptedSecretKey, appSecretKey);
}

export function decryptSheinAesPayload(encryptedPayload, appSecretKey) {
  if (!encryptedPayload) {
    throw new TypeError("encryptedPayload is required");
  }

  const iv = Buffer.from(SHEIN_IV_SEED, "utf8").subarray(0, 16);
  const decipher = createDecipheriv("aes-128-cbc", deriveAesKey(appSecretKey), iv);
  let decrypted = decipher.update(encryptedPayload, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function maskCredential(value) {
  if (!value) return "";
  if (value.length <= 8) return `${value.slice(0, 2)}***${value.slice(-2)}`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
