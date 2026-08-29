export interface TailImageCropMetadata {
  mode: "original" | "cropped";
  presetId: "portrait" | "square";
  sourceWidth: number | null;
  sourceHeight: number | null;
  outputWidth: number | null;
  outputHeight: number | null;
}

export interface TailImageAssetDraft {
  id: string;
  storeId?: string | null;
  originalName?: string;
  contentType?: string;
  width?: number | null;
  height?: number | null;
  crop?: Partial<TailImageCropMetadata>;
  previewUrl?: string;
  templateId?: string;
}

export function tailImageTemplatePaths(
  storeId: string,
  templateId?: string,
  assetId?: string,
): {
  templates: string;
  template: string;
  templateMedia: string;
};

export function validateTailImageTemplateDraft(input?: {
  name?: string;
  assets?: TailImageAssetDraft[];
}): {
  valid: boolean;
  errors: {
    name?: string;
    assets?: string;
  };
  data: {
    name: string;
    template: {
      placement: "append";
      assetIds: string[];
      assets: Array<{
        id: string;
        storeId: string;
        originalName: string;
        contentType: string;
        width: number | null;
        height: number | null;
        crop: TailImageCropMetadata;
      }>;
    };
  };
};

export function moveTailImageAsset<T extends { id: string }>(
  assets: T[],
  draggedId: string,
  targetId: string,
): T[];
