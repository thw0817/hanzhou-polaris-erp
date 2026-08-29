export const DEFAULT_WATERMARK_OPTIONS = Object.freeze({
  text: "",
  fontSize: 28,
  opacity: 0.18,
  color: "#000000",
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeWatermarkOptions(input = {}) {
  const text = String(input.text ?? "").replace(/[^\x20-\x7E]/g, "").slice(0, 40);
  const fontSize = Number(input.fontSize);
  const opacity = Number(input.opacity);
  const color = /^#[0-9a-f]{6}$/i.test(String(input.color || ""))
    ? String(input.color).toLowerCase()
    : DEFAULT_WATERMARK_OPTIONS.color;
  return {
    text,
    fontSize: Number.isFinite(fontSize) ? Math.round(clamp(fontSize, 12, 160)) : DEFAULT_WATERMARK_OPTIONS.fontSize,
    opacity: Number.isFinite(opacity) ? Number(clamp(opacity, 0.05, 0.5).toFixed(2)) : DEFAULT_WATERMARK_OPTIONS.opacity,
    color,
  };
}

export async function applyWatermarkToFile(sourceFile, inputOptions = {}) {
  if (typeof document === "undefined" || typeof Image === "undefined") {
    throw new Error("当前环境不支持图片水印处理");
  }
  const file = sourceFile instanceof File
    ? sourceFile
    : new File([sourceFile], "watermarked-image.jpg", { type: "image/jpeg" });
  const options = normalizeWatermarkOptions(inputOptions);
  if (!options.text.trim()) return file;
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`${file.name}：无法读取图片`));
      element.src = sourceUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    if (!canvas.width || !canvas.height) throw new Error(`${file.name}：图片尺寸无效`);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法创建图片画布");
    context.drawImage(image, 0, 0);
    // Paint one rotated tile and let the browser repeat it. This avoids a
    // canvas-sized nested loop for large product photos.
    const tile = document.createElement("canvas");
    tile.width = Math.ceil(options.fontSize * 8);
    tile.height = Math.ceil(options.fontSize * 4);
    const tileContext = tile.getContext("2d");
    if (!tileContext) throw new Error("当前浏览器无法创建水印画布");
    tileContext.save();
    tileContext.translate(tile.width / 2, tile.height / 2);
    tileContext.rotate(-Math.PI / 6);
    tileContext.font = `600 ${options.fontSize}px Arial, sans-serif`;
    tileContext.fillStyle = options.color;
    tileContext.globalAlpha = options.opacity;
    tileContext.textAlign = "center";
    tileContext.textBaseline = "middle";
    tileContext.fillText(options.text, 0, 0);
    tileContext.restore();
    const pattern = context.createPattern(tile, "repeat");
    if (!pattern) throw new Error("当前浏览器无法创建重复水印");
    context.fillStyle = pattern;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("图片水印生成失败")), "image/jpeg", 0.92);
    });
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + "-watermarked.jpg", {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
