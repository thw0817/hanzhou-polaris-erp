export const MAX_PRODUCT_IMAGE_BYTES = 3 * 1024 * 1024;

export function shouldCompressProductImage(file, maxBytes = MAX_PRODUCT_IMAGE_BYTES) {
  return Number(file?.size || 0) > maxBytes;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("浏览器无法生成压缩后的图片"));
    }, type, quality);
  });
}

/**
 * Keep normal files untouched. Large files are resized/encoded locally before
 * the SHEIN media upload, so the API never receives an avoidable >3 MB file.
 */
export async function compressProductImage(file, options = {}) {
  const maxBytes = Number(options.maxBytes) > 0
    ? Number(options.maxBytes)
    : MAX_PRODUCT_IMAGE_BYTES;
  if (!shouldCompressProductImage(file, maxBytes)) {
    return { file, compressed: false };
  }
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    throw new Error(`${file.name || "图片"} 大于3MB，当前浏览器不支持自动压缩`);
  }

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  let scale = Math.min(1, Math.sqrt(maxBytes / file.size) * 0.96);
  let quality = 0.88;
  let blob = null;
  try {
    for (let attempt = 0; attempt < 7; attempt += 1) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法创建图片压缩画布");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await canvasBlob(canvas, "image/jpeg", quality);
      if (blob.size <= maxBytes || attempt === 6) break;
      scale *= 0.84;
      quality = Math.max(0.58, quality - 0.06);
    }
  } finally {
    bitmap.close?.();
  }
  if (!blob) throw new Error(`${file.name || "图片"} 压缩失败`);
  const baseName = String(file.name || "image").replace(/\.[^.]+$/, "");
  return {
    file: new File([blob], `${baseName}-compressed.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified || Date.now(),
    }),
    compressed: true,
  };
}
