export interface WatermarkOptions {
  text: string;
  fontSize: number;
  opacity: number;
  color: string;
}

export const DEFAULT_WATERMARK_OPTIONS: Readonly<WatermarkOptions>;
export function normalizeWatermarkOptions(input?: Partial<WatermarkOptions>): WatermarkOptions;
export function applyWatermarkToFile(sourceFile: File | Blob, inputOptions?: Partial<WatermarkOptions>): Promise<File>;
