export const SHEIN_MAIN_IMAGE_PRESETS = {
  portrait: {
    id: "portrait",
    label: "纵图 1340×1785",
    aspect: 1340 / 1785,
    width: 1340,
    height: 1785,
  },
  square: {
    id: "square",
    label: "方图 1:1",
    aspect: 1,
    width: 1200,
    height: 1200,
  },
};

export function isSheinMainImageReady({ width, height, sizeBytes = 0 } = {}) {
  const exactPortrait = Number(width) === 1340 && Number(height) === 1785;
  const validSquare = Number(width) === Number(height) && Number(width) >= 900 && Number(width) <= 2200;
  return (exactPortrait || validSquare) && Number(sizeBytes) <= 3 * 1024 * 1024;
}

export function outputSizeForPreset(presetId) {
  return SHEIN_MAIN_IMAGE_PRESETS[presetId] || SHEIN_MAIN_IMAGE_PRESETS.portrait;
}

export async function cropImageFile({
  file,
  imageUrl,
  cropPixels,
  presetId,
  quality = 0.9,
} = {}) {
  if (!file || !imageUrl || !cropPixels) {
    throw new Error("缺少裁剪图片或裁剪范围");
  }
  const output = outputSizeForPreset(presetId);
  const image = typeof createImageBitmap === "function"
    ? await createImageBitmap(file)
    : await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("无法读取待裁剪图片"));
        element.src = imageUrl;
      });
  const canUseOffscreen = typeof OffscreenCanvas === "function";
  const canvas = canUseOffscreen
    ? new OffscreenCanvas(output.width, output.height)
    : document.createElement("canvas");
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("浏览器不支持图片裁剪");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  // When the user shrinks the image below the crop frame, fill the remaining
  // area with white instead of letting the opaque canvas default to black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, output.width, output.height);
  context.drawImage(
    image,
    Math.round(cropPixels.x),
    Math.round(cropPixels.y),
    Math.round(cropPixels.width),
    Math.round(cropPixels.height),
    0,
    0,
    output.width,
    output.height,
  );
  image.close?.();
  const encode = async (nextQuality) => {
    if (canUseOffscreen) {
      return canvas.convertToBlob({ type: "image/jpeg", quality: nextQuality });
    }
    return new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", nextQuality));
  };
  let blob = null;
  for (const nextQuality of [quality, 0.84, 0.78, 0.72]) {
    blob = await encode(nextQuality);
    if (!blob) throw new Error("裁剪图片生成失败");
    if (blob.size <= 3 * 1024 * 1024) break;
  }
  if (!blob || blob.size > 3 * 1024 * 1024) {
    throw new Error("裁剪结果仍超过3MB，请选择更小的裁剪区域");
  }
  const stem = String(file.name || "main-image").replace(/\.[^.]+$/, "");
  return new File([blob], `${stem}-${presetId}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}
