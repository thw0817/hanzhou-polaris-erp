import assert from "node:assert/strict";
import test from "node:test";
import {
  moveTailImageAsset,
  tailImageTemplatePaths,
  validateTailImageTemplateDraft,
} from "./tail-image-template-contract.js";

test("builds encoded tail image template and media paths", () => {
  assert.deepEqual(
    tailImageTemplatePaths("store / 1", "template / 1", "asset / 1"),
    {
      templates:
        "/v1/web/stores/store%20%2F%201/publish-templates?type=tail_image",
      template:
        "/v1/web/stores/store%20%2F%201/publish-templates/template%20%2F%201",
      templateMedia:
        "/v1/web/stores/store%20%2F%201/publish-templates/template%20%2F%201/media/asset%20%2F%201/download-ticket",
    },
  );
});

test("tail image drafts preserve order and strip embedded image payloads", () => {
  const result = validateTailImageTemplateDraft({
    name: "  材质说明尾图  ",
    assets: [
      {
        id: "asset-2",
        storeId: "store-1",
        originalName: "care.jpg",
        contentType: "image/jpeg",
        width: 1340,
        height: 1785,
        previewUrl: "blob:care",
        dataUrl: "data:image/jpeg;base64,not-allowed",
        crop: {
          mode: "cropped",
          presetId: "portrait",
          sourceWidth: 1600,
          sourceHeight: 2000,
          outputWidth: 1340,
          outputHeight: 1785,
          cropPixels: { x: 10, y: 20, width: 1500, height: 1900 },
        },
      },
      {
        id: "asset-1",
        storeId: "store-1",
        originalName: "backing.png",
        contentType: "image/png",
        width: 1200,
        height: 1200,
        base64: "not-allowed",
        crop: {
          mode: "original",
          presetId: "square",
          sourceWidth: 1200,
          sourceHeight: 1200,
          outputWidth: 1200,
          outputHeight: 1200,
        },
      },
    ],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.data, {
    name: "材质说明尾图",
    template: {
      placement: "append",
      assetIds: ["asset-2", "asset-1"],
      assets: [
        {
          id: "asset-2",
          storeId: "store-1",
          originalName: "care.jpg",
          contentType: "image/jpeg",
          width: 1340,
          height: 1785,
          crop: {
            mode: "cropped",
            presetId: "portrait",
            sourceWidth: 1600,
            sourceHeight: 2000,
            outputWidth: 1340,
            outputHeight: 1785,
          },
        },
        {
          id: "asset-1",
          storeId: "store-1",
          originalName: "backing.png",
          contentType: "image/png",
          width: 1200,
          height: 1200,
          crop: {
            mode: "original",
            presetId: "square",
            sourceWidth: 1200,
            sourceHeight: 1200,
            outputWidth: 1200,
            outputHeight: 1200,
          },
        },
      ],
    },
  });
});

test("tail image drafts require a name and at least one unique asset", () => {
  const result = validateTailImageTemplateDraft({
    name: "",
    assets: [{ id: "" }],
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.name, "请填写模板名称");
  assert.equal(result.errors.assets, "请至少上传一张尾部主图");
});

test("moves one tail image before the drop target", () => {
  const assets = [{ id: "one" }, { id: "two" }, { id: "three" }];

  assert.deepEqual(
    moveTailImageAsset(assets, "three", "one").map((asset) => asset.id),
    ["three", "one", "two"],
  );
  assert.deepEqual(
    moveTailImageAsset(assets, "one", "next").map((asset) => asset.id),
    ["two", "one", "three"],
  );
});
