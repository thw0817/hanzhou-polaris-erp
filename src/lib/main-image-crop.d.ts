export interface SheinMainImagePreset {
  id: "portrait" | "square";
  label: string;
  aspect: number;
  width: number;
  height: number;
}

export const SHEIN_MAIN_IMAGE_PRESETS: Record<
  "portrait" | "square",
  SheinMainImagePreset
>;

export function isSheinMainImageReady(input?: {
  width?: number | null;
  height?: number | null;
  sizeBytes?: number;
}): boolean;

export function outputSizeForPreset(
  presetId: string,
): SheinMainImagePreset;

export function cropImageFile(input: {
  file: File;
  imageUrl: string;
  cropPixels: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  presetId: "portrait" | "square";
  quality?: number;
}): Promise<File>;
