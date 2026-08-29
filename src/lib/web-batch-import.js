const IMAGE_SLOTS = [
  "main",
  "detail",
  "square",
  "swatch",
  "description",
  "sku",
];

function normalizeSupplierCode(value, fallback) {
  return (
    String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || fallback
  );
}

export function buildUniqueBatchSupplierCodes(products = []) {
  const used = new Set();
  return products.map((product, index) => {
    const fallback = `PRODUCT-${String(index + 1).padStart(3, "0")}`;
    const base = normalizeSupplierCode(product?.name, fallback);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      const marker = `-${suffix}`;
      candidate = `${base.slice(0, 32 - marker.length)}${marker}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

function publicImageAsset(image, asset) {
  return {
    assetId: asset.id,
    originalName: asset.originalName || image.file.name,
    contentType: asset.contentType || image.file.type,
    width: asset.width ?? image.width ?? null,
    height: asset.height ?? image.height ?? null,
    slot: image.type,
  };
}

export function attachBatchImageAssets({
  product,
  uploaded = [],
  sizeRows = [],
} = {}) {
  const assetByImageId = new Map(
    uploaded.map(({ imageId, asset }) => [imageId, asset]),
  );
  const imageAssets = Object.fromEntries(
    IMAGE_SLOTS.map((slot) => [
      slot,
      (product?.[slot] || [])
        .map((image) => {
          const asset = assetByImageId.get(image.id);
          return asset ? publicImageAsset(image, asset) : null;
        })
        .filter(Boolean),
    ]),
  );
  const mainAssetId = imageAssets.main[0]?.assetId || "";
  const skuAssetIds = imageAssets.sku.map((image) => image.assetId);
  const blockers = [];
  let mappedRows = sizeRows.map((row) => ({ ...row }));

  if (!skuAssetIds.length) {
    mappedRows = mappedRows.map((row) => ({
      ...row,
      imageAssetId: mainAssetId,
      imageAssetSource: mainAssetId ? "main" : "",
    }));
  } else if (skuAssetIds.length === 1) {
    mappedRows = mappedRows.map((row) => ({
      ...row,
      imageAssetId: skuAssetIds[0],
      imageAssetSource: "shared_sku",
    }));
  } else if (skuAssetIds.length === mappedRows.length) {
    mappedRows = mappedRows.map((row, index) => ({
      ...row,
      imageAssetId: skuAssetIds[index],
      imageAssetSource: "per_sku",
    }));
  } else {
    blockers.push(
      `SKU图有${skuAssetIds.length}张，但模板有${mappedRows.length}个SKU；请保留1张通用SKU图，或每个SKU各1张`,
    );
    mappedRows = mappedRows.map((row) => ({
      ...row,
      imageAssetId: "",
      imageAssetSource: "",
    }));
  }

  return {
    blockers,
    imageAssets,
    mainAssetId,
    sizeRows: mappedRows,
  };
}

export function isDraftReadyForBatch(draft) {
  return draft?.status === "ready" && draft?.preflight?.passed === true;
}
