import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(
  new URL("../../src-v2/app/App.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../../src-v2/app/AppShell.tsx", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../../src-v2/lib/api.ts", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../../src-v2/features/templates/TailImageTemplatesPage.tsx", import.meta.url),
  "utf8",
);
const cropSource = readFileSync(
  new URL("../../src/lib/main-image-crop.js", import.meta.url),
  "utf8",
);

test("V2 exposes the tail image template route, navigation and API", () => {
  assert.match(appSource, /TailImageTemplatesPage/);
  assert.match(appSource, /path="templates\/:storeId\/tail-images"/);
  assert.match(shellSource, /通用商品图片/);
  assert.match(
    shellSource,
    /\/app\/templates\/\$\{encodeURIComponent\(storeId\)\}\/tail-images/,
  );
  for (const method of [
    "tailImageTemplates",
    "saveTailImageTemplate",
    "deleteTailImageTemplate",
    "uploadTailImage",
    "tailImagePreviewTicket",
    "tailImagePreviewUrl",
  ]) {
    assert.match(apiSource, new RegExp(`\\b${method}(?=\\s*[:,])`));
  }
});

test("tail image templates upload multiple JPG or PNG files and crop when needed", () => {
  assert.match(pageSource, /react-easy-crop/);
  assert.match(pageSource, /cropImageFile/);
  assert.match(pageSource, /isSheinMainImageReady/);
  assert.match(pageSource, /1340×1785/);
  assert.match(pageSource, /1:1/);
  assert.match(pageSource, /multiple/);
  assert.match(pageSource, /accept="\.jpg,\.jpeg,\.png,image\/jpeg,image\/png"/);
  assert.match(pageSource, /保存裁剪/);
  assert.match(pageSource, /minZoom=\{0\.5\}/);
  assert.match(pageSource, /objectFit="contain"/);
  assert.match(pageSource, /缩放（可缩小）/);
  assert.match(cropSource, /fillStyle = "#ffffff"/);
});

test("tail image templates show previews, removal and ordered controls", () => {
  assert.match(pageSource, /previewUrl/);
  assert.match(pageSource, /draggable/);
  assert.match(pageSource, /onDragStart/);
  assert.match(pageSource, /onDrop/);
  assert.match(pageSource, /moveTailImageAsset/);
  assert.match(pageSource, /ChevronLeft/);
  assert.match(pageSource, /ChevronRight/);
  assert.match(pageSource, /移除/);
});

test("tail image templates are append-only and use one fixed save action", () => {
  assert.match(pageSource, /只追加到商品自身主图最后/);
  assert.match(pageSource, /placement: "append"/);
  assert.match(pageSource, /fixed inset-x-0 bottom-0/);
  assert.match(pageSource, /统一保存通用商品图片/);
  assert.match(pageSource, /aria-live="polite"/);
  assert.match(pageSource, /正在保存通用商品图片模板/);
});

test("tail image template list remains searchable without touching image assets", () => {
  assert.match(pageSource, /templateSearch/);
  assert.match(pageSource, /filteredTemplates/);
  assert.match(pageSource, /搜索通用商品图片模板/);
  assert.match(pageSource, /没有匹配的通用商品图片模板/);
  assert.match(pageSource, /template\.scopeLabel/);
});

test("tail image template JSON never contains embedded image bytes", () => {
  assert.doesNotMatch(pageSource, /FileReader/);
  assert.doesNotMatch(pageSource, /readAsDataURL/);
  assert.doesNotMatch(pageSource, /base64/);
});
