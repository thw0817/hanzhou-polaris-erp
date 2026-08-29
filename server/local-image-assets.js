import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const MIME_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
]);

export class LocalImageAssetStore {
  constructor({ directory }) {
    if (!directory) throw new TypeError("Image asset directory is required");
    this.directory = directory;
  }

  save({ bytes, mimeType, originalName }) {
    if (!MIME_EXTENSIONS.has(mimeType)) {
      const error = new Error("主图模板仅支持 JPG、JPEG、PNG");
      error.status = 400;
      throw error;
    }
    const fileName = `${randomUUID()}${MIME_EXTENSIONS.get(mimeType)}`;
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(this.directory, fileName), bytes, { mode: 0o600 });
    return {
      id: fileName.replace(/\.[^.]+$/, ""),
      fileName,
      originalName: String(originalName || fileName),
      mimeType,
      size: bytes.length,
      url: `/api/local-assets/main-images/${fileName}`,
    };
  }

  get(fileName) {
    if (!/^[0-9a-f-]+\.(?:jpg|png)$/i.test(fileName)) return null;
    const filePath = path.join(this.directory, fileName);
    if (!existsSync(filePath)) return null;
    return {
      bytes: readFileSync(filePath),
      mimeType: fileName.endsWith(".png") ? "image/png" : "image/jpeg",
    };
  }
}
