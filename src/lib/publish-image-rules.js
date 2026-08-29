export const publishImageTypes = {
  main: { label: "主图", apiType: 1 },
  detail: { label: "细节图", apiType: 2 },
  square: { label: "方形图", apiType: 5 },
  swatch: { label: "色块图", apiType: 6 },
  description: { label: "详情图", apiType: 7 },
  sku: { label: "SKU预览图", apiType: "引用" },
};

export function classifyPublishImage(fileName) {
  const normalized = fileName.toLowerCase();
  if (/description|desc|详情/.test(normalized)) return "description";
  if (/detail|details|细节/.test(normalized)) return "detail";
  if (/square|方形|方块/.test(normalized)) return "square";
  if (/swatch|color|colour|色块/.test(normalized)) return "swatch";
  if (/sku|variant|规格/.test(normalized)) return "sku";
  return "main";
}

export function formatImageSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function isNearRatio(width, height, target, tolerance = 0.015) {
  return Math.abs(width / height - target) <= tolerance;
}

export function validatePublishImage(file, type, width, height) {
  const issues = [];
  if (file.size > 3 * 1024 * 1024) issues.push("文件超过 3MB");
  if (!width || !height) {
    issues.push("无法读取图片尺寸");
    return issues;
  }

  if (type === "main" || type === "detail" || type === "sku") {
    const exactPortrait = width === 1340 && height === 1785;
    const validSquare = width === height && width >= 900 && width <= 2200;
    if (!exactPortrait && !validSquare) {
      issues.push("需为 1340×1785，或 900–2200px 的 1:1 图片");
    }
  }

  if (type === "square") {
    if (width !== height || width < 900 || width > 2200) {
      issues.push("需为 900–2200px 的 1:1 图片");
    }
  }

  if (type === "swatch" && (width !== 80 || height !== 80)) {
    issues.push("色块图必须为 80×80px");
  }

  if (
    type === "description" &&
    (!isNearRatio(width, height, 3 / 4) || width < 900)
  ) {
    issues.push("详情图需为 3:4，且宽度不小于 900px");
  }

  return issues;
}

export function buildPublishProduct(group, index = 0) {
  const files = [...group.files].sort((left, right) => {
    const leftPath = left.file.webkitRelativePath || left.file.name;
    const rightPath = right.file.webkitRelativePath || right.file.name;
    return leftPath.localeCompare(rightPath, "zh-CN", {
      numeric: true,
      sensitivity: "base",
    });
  });
  const product = {
    name: group.name,
    files,
    main: files.filter((image) => image.type === "main"),
    detail: files.filter((image) => image.type === "detail"),
    square: files.filter((image) => image.type === "square"),
    swatch: files.filter((image) => image.type === "swatch"),
    description: files.filter((image) => image.type === "description"),
    sku: files.filter((image) => image.type === "sku"),
  };
  const previewImage = product.main[0] || product.files[0];
  const blockers = product.files.flatMap((image) =>
    image.issues.map((issue) => `${image.file.name}：${issue}`),
  );
  if (!product.main.length) blockers.unshift("缺少主图，请将至少一张图片映射为主图");
  return {
    ...product,
    id: group.id || `${group.name}-${index}`,
    previewUrl: previewImage?.previewUrl || "",
    blockers,
    skuImageSource: product.sku.length
      ? `${product.sku.length} 张独立 SKU 图`
      : "引用主图 1",
  };
}
