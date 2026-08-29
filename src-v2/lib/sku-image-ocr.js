function normalizeText(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/[×＊]/g, "x")
    .replace(/厘米|公分/g, "cm")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}x.*-]/gu, "");
}

export function skuImageOcrSearchText(value) {
  return normalizeText(value);
}

export function extractSkuImageDimensionTokens(value) {
  const source = normalizeText(value);
  const tokens = new Set();
  const pattern = /(\d+(?:\.\d+)?)\s*(?:cm)?[x*](\d+(?:\.\d+)?)/g;
  for (const match of source.matchAll(pattern)) {
    const left = Number(match[1]);
    const right = Number(match[2]);
    if (!(left > 0 && right > 0)) continue;
    const a = String(Number(left.toFixed(2)));
    const b = String(Number(right.toFixed(2)));
    tokens.add(`${a}x${b}`);
    tokens.add(`${b}x${a}`);
  }
  return tokens;
}

export function autoMapSkuPreviewImagesByOcr(rows, images) {
  let mappedRows = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  const unmatchedAssetIds = [];
  const ambiguousAssetIds = [];
  for (const image of Array.isArray(images) ? images : []) {
    const assetId = String(image?.id || image?.assetId || "").trim();
    const imageText = skuImageOcrSearchText(image?.recognizedText);
    if (!assetId || !imageText) {
      if (assetId) unmatchedAssetIds.push(assetId);
      continue;
    }
    const imageDimensions = extractSkuImageDimensionTokens(imageText);
    const matches = mappedRows.filter((row) => {
      const supplierSku = skuImageOcrSearchText(row.supplierSku);
      if (supplierSku.length >= 3 && imageText.includes(supplierSku)) return true;
      const rowDimensions = new Set([
        ...extractSkuImageDimensionTokens(row.sizeText),
        ...extractSkuImageDimensionTokens(row.sizeMapping?.valueLabel),
        ...extractSkuImageDimensionTokens(`${row.lengthCm}x${row.widthCm}`),
      ]);
      return [...imageDimensions].some((token) => rowDimensions.has(token));
    });
    if (matches.length !== 1 || matches[0].imageAssetId) {
      (matches.length ? ambiguousAssetIds : unmatchedAssetIds).push(assetId);
      continue;
    }
    const rowId = String(matches[0].id);
    mappedRows = mappedRows.map((row) => String(row.id) === rowId
      ? { ...row, imageAssetId: assetId, imageAssetSource: "per_sku_ocr" }
      : row);
  }
  return { rows: mappedRows, unmatchedAssetIds, ambiguousAssetIds };
}

export async function recognizeSkuImageText(file) {
  const Detector = globalThis.TextDetector;
  if (typeof Detector !== "function") {
    const error = new Error("当前浏览器未提供图片文字识别能力");
    error.code = "OCR_UNSUPPORTED";
    throw error;
  }
  const bitmap = await createImageBitmap(file);
  try {
    const blocks = await new Detector().detect(bitmap);
    return blocks.map((block) => String(block.rawValue || block.text || "")).filter(Boolean).join(" ");
  } finally {
    bitmap.close();
  }
}
