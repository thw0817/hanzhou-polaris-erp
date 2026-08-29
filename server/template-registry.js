import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const TEMPLATE_FILE_VERSION = 1;
const TEMPLATE_TYPES = new Set(["product", "compliance"]);

function normalizeTemplate(input, existing = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("模板数据格式不正确");
  }
  const name = String(input.name || "").trim();
  const storeId = String(input.storeId || "").trim();
  const type = String(input.templateType || input.type || "").trim();
  if (!name) throw new TypeError("模板名称必填");
  if (!storeId) throw new TypeError("模板必须绑定授权店铺");
  if (!TEMPLATE_TYPES.has(type)) throw new TypeError("模板类型不正确");
  if (type === "product" && (!input.categoryId || !input.productTypeId)) {
    throw new TypeError("商品模板必须绑定SHEIN末级类目和产品类型");
  }

  const now = new Date().toISOString();
  const version = existing ? Number(existing.version || 1) + 1 : 1;
  return {
    ...input,
    id: existing?.id || input.id || randomUUID(),
    name,
    storeId,
    templateType: type,
    version,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    revisions: [
      ...(existing?.revisions || []),
      {
        version,
        savedAt: now,
        selectedAttributeCount: Object.keys(input.attributeValues || {}).length,
      },
    ].slice(-20),
  };
}

export class TemplateRegistry {
  #templates = new Map();

  constructor({ filePath }) {
    if (!filePath) throw new TypeError("Template registry filePath is required");
    this.filePath = filePath;
    this.#load();
  }

  list({ storeId, type } = {}) {
    return Array.from(this.#templates.values())
      .filter((template) => !storeId || template.storeId === String(storeId))
      .filter((template) => !type || template.templateType === type)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  get(id) {
    return this.#templates.get(String(id)) || null;
  }

  save(input) {
    const existing = input.id ? this.get(input.id) : null;
    if (input.id && !existing) {
      const error = new Error("未找到要更新的模板");
      error.status = 404;
      throw error;
    }
    const template = normalizeTemplate(input, existing);
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
    if (envelope.version !== TEMPLATE_FILE_VERSION || !Array.isArray(envelope.templates)) {
      throw new Error("Unsupported SHEIN template registry format");
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
          version: TEMPLATE_FILE_VERSION,
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
