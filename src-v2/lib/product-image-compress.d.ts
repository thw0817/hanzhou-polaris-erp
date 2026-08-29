export const MAX_PRODUCT_IMAGE_BYTES: number;

export function shouldCompressProductImage(
  file: { size?: number } | null | undefined,
  maxBytes?: number,
): boolean;

export function compressProductImage(
  file: File,
  options?: { maxBytes?: number },
): Promise<{ file: File; compressed: boolean }>;
