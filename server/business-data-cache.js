import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { sanitizePhotoRequirement } from "./shein-compliance.js";

const BUSINESS_DATA_VERSION = 1;

function compactLegacyComplianceRows(value) {
  const rows = value?.compliance?.rows;
  if (!Array.isArray(rows)) return false;
  let changed = false;
  for (const row of rows) {
    for (const key of ["requirements", "photoRequirements"]) {
      if (Object.hasOwn(row, key)) {
        delete row[key];
        changed = true;
      }
    }
    for (const key of ["bodyPhotoRequirements", "packagePhotoRequirements"]) {
      if (!Array.isArray(row[key])) continue;
      const sanitized = row[key].map(sanitizePhotoRequirement);
      if (sanitized.some((item, index) => item !== row[key][index])) {
        row[key] = sanitized;
        changed = true;
      }
    }
  }
  return changed;
}

export class BusinessDataCache {
  #records = new Map();

  constructor({ filePath }) {
    if (!filePath) throw new TypeError("Business data cache filePath is required");
    this.filePath = filePath;
    this.#load();
  }

  get(storeId) {
    return this.#records.get(String(storeId)) || null;
  }

  set(storeId, value, { syncedAt, persist = true } = {}) {
    const record = {
      storeId: String(storeId),
      syncedAt: syncedAt || new Date().toISOString(),
      value,
    };
    this.#records.set(String(storeId), record);
    if (persist) this.#persist();
    return record;
  }

  remove(storeId) {
    const removed = this.#records.delete(String(storeId));
    if (removed) this.#persist();
    return removed;
  }

  #load() {
    if (!existsSync(this.filePath)) return;
    const envelope = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (
      envelope.version !== BUSINESS_DATA_VERSION ||
      !Array.isArray(envelope.records)
    ) {
      throw new Error("Unsupported SHEIN business data cache format");
    }
    let migrated = false;
    for (const record of envelope.records) {
      migrated = compactLegacyComplianceRows(record.value) || migrated;
      this.#records.set(String(record.storeId), record);
    }
    if (migrated) this.#persist();
  }

  #persist() {
    mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(
      temporaryPath,
      `${JSON.stringify(
        {
          version: BUSINESS_DATA_VERSION,
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
