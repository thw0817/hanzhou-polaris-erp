import assert from "node:assert/strict";
import test from "node:test";
import { defaultSupplierCode, normalizeSupplierCode } from "./product-code.js";

test("generates category-month-day-sequence supplier codes", () => {
  assert.equal(
    defaultSupplierCode(["家居", "地毯"], 1, new Date(2026, 7, 22)),
    "家居-地毯-0822001",
  );
  assert.equal(
    defaultSupplierCode(["家居", "地毯"], 12, new Date(2026, 7, 22)),
    "家居-地毯-0822012",
  );
});

test("normalizes supplier codes without Chinese enumeration punctuation", () => {
  assert.equal(normalizeSupplierCode("家居、地毯、0822001"), "家居-地毯-0822001");
  assert.equal(
    defaultSupplierCode(["家居、生活", "地毯"], 1, new Date(2026, 7, 22)),
    "家居-生活-地毯-0822001",
  );
});
