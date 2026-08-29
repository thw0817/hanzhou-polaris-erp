import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptStoreSecretKey,
  generateSheinSignature,
} from "./shein-crypto.js";

test("generates the exact signature published in the SHEIN documentation", () => {
  const signature = generateSheinSignature({
    openKeyId: "B96C15416C9240DF96BAA0BC9B367C6D",
    secretKey: "6BEC9C4B668B4B14B17EEF106BB98AE5",
    path: "/open-api/order/purchase-order-info",
    timestamp: "1740709414000",
    randomKey: "test1",
  });

  assert.equal(
    signature,
    "test1ZDZjYTJjNzg5ZjUzMDdkZTU2N2Y3NzcxN2ZjZjA5OGIxMTRhZWI0MTU1MzQxNjZlNjFkMGQxOTJiYTk1YWNjYQ==",
  );
});

test("decrypts the store secret using the official AES-128-CBC example", () => {
  const decrypted = decryptStoreSecretKey(
    "Um6W8uVjabRyt5zJI3hw/38ke8dvUq1o6Vkk1f/Gzjt+sWGeUpYBIFTk7/xVHhJy",
    "698E4F20DFBA4B85B2291C2BCB7381C5",
  );

  assert.equal(decrypted, "E547DCB619824189AD3A532546AE37F9");
});
