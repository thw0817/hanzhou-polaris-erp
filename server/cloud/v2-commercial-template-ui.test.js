import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../../src-v2/app/App.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../../src-v2/app/AppShell.tsx", import.meta.url), "utf8");
const editorSource = readFileSync(new URL("../../src-v2/features/publishing/NewProductPage.tsx", import.meta.url), "utf8");
const draftsSource = readFileSync(new URL("../../src-v2/features/publishing/ProductDraftsPage.tsx", import.meta.url), "utf8");

test("V2 removes the standalone pricing and weight template center", () => {
  assert.doesNotMatch(appSource, /CommercialTemplatesPage/);
  assert.doesNotMatch(appSource, /templates\/:storeId\/commercial/);
  assert.doesNotMatch(shellSource, /计价与克重/);
  assert.doesNotMatch(shellSource, /\/commercial/);
  assert.doesNotMatch(draftsSource, /commercialTemplates/);
  assert.doesNotMatch(draftsSource, /<label className="field-label">计价与克重/);
});

test("new product keeps direct pricing and weight inputs", () => {
  assert.match(editorSource, /直接填写计价与克重/);
  assert.match(editorSource, /一键填充全部 SKU 供货价/);
  assert.match(editorSource, /一键填充全部 SKU 重量/);
  assert.match(editorSource, /SKU供货总价/);
});
