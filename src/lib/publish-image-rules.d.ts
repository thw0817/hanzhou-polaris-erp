export type PublishImageType =
  | "main"
  | "detail"
  | "square"
  | "swatch"
  | "description"
  | "sku";

export function validatePublishImage(
  file: { name?: string; size: number },
  type: PublishImageType,
  width: number,
  height: number,
): string[];
