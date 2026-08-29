import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const FILE_VERSION = 1;

function normalize(input, existing = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("主图模板数据格式不正确");
  }
  const name = String(input.name || "").trim();
  const storeId = String(input.storeId || "").trim();
  const images = Array.isArray(input.images) ? input.images : [];
  if (!name) throw new TypeError("主图模板名称必填");
  if (!storeId) throw new TypeError("主图模板必须绑定授权店铺");
  if (!images.length) throw new TypeError("主图模板至少需要一张图片");

  const now = new Date().toISOString();
  return {
    ...input,
    id: existing?.id || input.id || randomUUID(),
    name,
    storeId,
    images,
    placement: "append",
    imageType: 1,
    version: existing ? Number(existing.version || 1) + 1 : 1,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

export class MainImageTemplateRegistry {
  #templates = new Map();

  constructor({ filePath }) {
    if (!filePath) {
      throw new TypeError("Main image template registry filePath is required");
    }
    this.filePath = filePath;
    this.#load();
  }

  list({ storeId } = {}) {
    return Array.from(this.#templates.values())
      .filter((item) => !storeId || item.storeId === String(storeId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  get(id) {
    return this.#templates.get(String(id)) || null;
  }

  save(input) {
    const existing = input.id ? this.get(input.id) : null;
    if (input.id && !existing) {
      const error = new Error("未找到要更新的主图模板");
      error.status = 404;
      throw error;
    }
    const template = normalize(input, existing);
    this.#templates.set(template.id, template);
    this.#persist();
    return template;
  }

  remove(id) {
    const removed = this.#templates.delete(String(id));
    if (removed) this.#persist();
    return removed;
  }

  #load() {
    if (!existsSync(this.filePath)) return;
    const envelope = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (envelope.version !== FILE_VERSION || !Array.isArray(envelope.templates)) {
      throw new Error("Unsupported main image template registry format");
    }
    for (const template of envelope.templates) {
      if (template?.id) this.#templates.set(String(template.id), template);
    }
  }

  #persist() {
    mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(
      temporaryPath,
      `${JSON.stringify(
        {
          version: FILE_VERSION,
          templates: Array.from(this.#templates.values()),
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    renameSync(temporaryPath, this.filePath);
  }
}
