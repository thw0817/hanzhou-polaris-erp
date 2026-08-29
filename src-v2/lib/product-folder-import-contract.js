const IMAGE_EXTENSION = /\.(jpe?g|png)$/i;

const SLOT_PATTERNS = [
  ["description", /(^|[\s_\-/])(description|desc|详情)([\s_\-/]|$)/i],
  ["detail", /(^|[\s_\-/])(detail|details|细节)([\s_\-/]|$)/i],
  ["sku", /(^|[\s_\-/])(sku|variant|规格)([\s_\-/]|$)/i],
  ["main", /(^|[\s_\-/])(main|cover|hero|主图|首图)([\s_\-/]|$)/i],
];

const SLOT_DIRECTORY_PATTERN = /^(description|desc|详情|detail|details|细节|sku|variant|规格|main|cover|hero|主图|首图)$/i;

function importPath(file) {
  return String(file?.webkitRelativePath || file?.name || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function stem(value) {
  return String(value || "").replace(/\.[^.]+$/, "").trim();
}

export function isSupportedProductImage(file) {
  const type = String(file?.type || "").toLowerCase();
  return ["image/jpeg", "image/png"].includes(type) || IMAGE_EXTENSION.test(
    String(file?.name || ""),
  );
}

export function suggestProductImageSlot(file) {
  const path = importPath(file).toLowerCase();
  for (const [slot, pattern] of SLOT_PATTERNS) {
    if (pattern.test(path)) return slot;
  }
  // 文件夹导入的默认语义是“商品主图”。用户仍可以在确认步骤改成
  // 通用轮播图或 SKU 图，但不能因为文件名没有关键词而丢失素材。
  return "main";
}

export function productFolderName(file) {
  const path = importPath(file);
  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 3 && !SLOT_DIRECTORY_PATTERN.test(parts[1])) {
    return parts[1];
  }
  if (parts.length >= 2) return parts[0];
  return stem(parts[0] || file?.name) || "未命名商品";
}

export function buildProductFolderImportGroups(files = []) {
  const groups = new Map();
  const ignored = [];
  Array.from(files).forEach((file, index) => {
    if (!isSupportedProductImage(file)) {
      ignored.push(file);
      return;
    }
    const groupName = productFolderName(file);
    const group = groups.get(groupName) || {
      id: `${groupName}-${groups.size + 1}`,
      name: groupName,
      files: [],
    };
    group.files.push({
      id: `${importPath(file) || file.name}-${index}`,
      file,
      path: importPath(file) || String(file.name || ""),
      suggestedSlot: suggestProductImageSlot(file),
    });
    groups.set(groupName, group);
  });
  return {
    groups: Array.from(groups.values()),
    ignoredCount: ignored.length,
  };
}

export function validateProductFolderMappings(
  entries = [],
  { existingDetailCount = 0, existingDescriptionCount = 0 } = {},
) {
  const selected = entries.filter((entry) => entry.slot !== "unassigned");
  const count = (slot) => selected.filter((entry) => entry.slot === slot).length;
  const blockers = [];
  if (existingDetailCount + count("detail") > 10) {
    blockers.push("商品自身细节图合计不能超过10张");
  }
  if (existingDescriptionCount + count("description") > 10) {
    blockers.push("站点详情图合计不能超过10张");
  }
  return {
    selectedCount: selected.length,
    blockers,
    counts: {
      main: count("main"),
      detail: count("detail"),
      description: count("description"),
      sku: count("sku"),
      unassigned: entries.length - selected.length,
    },
  };
}

function savedAsset(asset) {
  return {
    assetId: String(asset?.assetId || asset?.id || ""),
    originalName: String(asset?.originalName || ""),
    contentType: String(asset?.contentType || ""),
    width: asset?.width ?? null,
    height: asset?.height ?? null,
    sizeBytes: Number(asset?.sizeBytes || 0),
  };
}

export function buildProductFolderDraftShell({ name, uploadedImages = [] } = {}) {
  const draftName = String(name || "").trim().slice(0, 160) || "未命名商品草稿";
  const bySlot = (slot) => uploadedImages
    .filter((item) => item?.slot === slot)
    .map((item) => savedAsset(item.asset))
    .filter((asset) => asset.assetId);
  return {
    input: {
      name: draftName,
      categoryId: "",
      productTypeId: "",
      data: {
        title: draftName,
        description: "",
        imageAssets: {
          main: bySlot("main"),
          detail: bySlot("detail"),
          description: bySlot("description"),
          tail: [],
        },
        skuPreviewImages: bySlot("sku"),
        skuRows: [],
      },
      preflight: {},
      status: "blocked",
    },
    externalWrite: false,
  };
}
