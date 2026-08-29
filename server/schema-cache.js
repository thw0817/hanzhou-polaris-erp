import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const SCHEMA_CACHE_VERSION = 1;

export class SchemaCache {
  #records = new Map();

  constructor({ filePath }) {
    if (!filePath) throw new TypeError("Schema cache filePath is required");
    this.filePath = filePath;
    this.#load();
  }

  get(storeId, kind, key = "default") {
    return this.#records.get(this.#key(storeId, kind, key)) || null;
  }

  set(storeId, kind, key, value) {
    const record = {
      storeId: String(storeId),
      kind: String(kind),
      key: String(key || "default"),
      value,
      cachedAt: new Date().toISOString(),
    };
    this.#records.set(this.#key(storeId, kind, key), record);
    this.#persist();
    return record;
  }

  #key(storeId, kind, key) {
    return `${String(storeId)}:${String(kind)}:${String(key || "default")}`;
  }

  #load() {
    if (!existsSync(this.filePath)) return;
    const envelope = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (envelope.version !== SCHEMA_CACHE_VERSION || !Array.isArray(envelope.records)) {
      throw new Error("Unsupported SHEIN schema cache format");
    }
    for (const record of envelope.records) {
      this.#records.set(this.#key(record.storeId, record.kind, record.key), record);
    }
  }

  #persist() {
    mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(
      temporaryPath,
      `${JSON.stringify(
        {
          version: SCHEMA_CACHE_VERSION,
          records: Array.from(this.#records.values()),
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    renameSync(temporaryPath, this.filePath);
  }
}

