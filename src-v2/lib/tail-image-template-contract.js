function text(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeCrop(input = {}) {
  const mode = input.mode === "cropped" ? "cropped" : "original";
  const presetId = input.presetId === "portrait" ? "portrait" : "square";
  return {
    mode,
    presetId,
    sourceWidth: positiveInteger(input.sourceWidth),
    sourceHeight: positiveInteger(input.sourceHeight),
    outputWidth: positiveInteger(input.outputWidth),
    outputHeight: positiveInteger(input.outputHeight),
  };
}

function normalizeAsset(input = {}) {
  return {
    id: text(input.id, 100),
    storeId: text(input.storeId, 100),
    originalName: text(input.originalName, 200),
    contentType: text(input.contentType, 100),
    width: positiveInteger(input.width),
    height: positiveInteger(input.height),
    crop: normalizeCrop(input.crop),
  };
}

export function tailImageTemplatePaths(
  storeId,
  templateId = "",
  assetId = "",
) {
  const store = encodeURIComponent(String(storeId));
  const templates = `/v1/web/stores/${store}/publish-templates`;
  const template = templateId
    ? `${templates}/${encodeURIComponent(String(templateId))}`
    : templates;
  return {
    templates: `${templates}?type=tail_image`,
    template,
    templateMedia:
      templateId && assetId
        ? `${template}/media/${encodeURIComponent(String(assetId))}/download-ticket`
        : "",
  };
}

export function validateTailImageTemplateDraft(input = {}) {
  const name = text(input.name, 80);
  const seen = new Set();
  const assets = (Array.isArray(input.assets) ? input.assets : [])
    .map(normalizeAsset)
    .filter((asset) => {
      if (!asset.id || seen.has(asset.id)) return false;
      seen.add(asset.id);
      return true;
    });
  const errors = {};

  if (!name) errors.name = "请填写模板名称";
  if (!assets.length) errors.assets = "请至少上传一张尾部主图";

  return {
    valid: !errors.name && !errors.assets,
    errors,
    data: {
      name,
      template: {
        placement: "append",
        assetIds: assets.map((asset) => asset.id),
        assets,
      },
    },
  };
}

export function moveTailImageAsset(assets = [], draggedId, targetId) {
  const rows = Array.isArray(assets) ? [...assets] : [];
  const fromIndex = rows.findIndex((asset) => String(asset.id) === String(draggedId));
  if (fromIndex < 0) return rows;

  if (targetId === "previous" || targetId === "next") {
    const offset = targetId === "previous" ? -1 : 1;
    const toIndex = fromIndex + offset;
    if (toIndex < 0 || toIndex >= rows.length) return rows;
    [rows[fromIndex], rows[toIndex]] = [rows[toIndex], rows[fromIndex]];
    return rows;
  }

  const toIndex = rows.findIndex((asset) => String(asset.id) === String(targetId));
  if (toIndex < 0 || toIndex === fromIndex) return rows;
  const [dragged] = rows.splice(fromIndex, 1);
  rows.splice(rows.findIndex((asset) => String(asset.id) === String(targetId)), 0, dragged);
  return rows;
}
