import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { buildPublishSchemaCoverage } from "../publish-schema-coverage.js";

const defaultSnapshotFile =
  process.env.SHEIN_DEMO_SCHEMA_CACHE_FILE ||
  process.env.SHEIN_SCHEMA_CACHE_FILE ||
  path.resolve(process.cwd(), ".data/shein-schema-cache.v1.json");

let cachedFilePath = "";
let cachedMtimeMs = -1;
let cachedRecords = [];

function clone(value) {
  return structuredClone(value);
}

function schemaError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function newest(records) {
  return [...records].sort(
    (left, right) =>
      String(right.cachedAt || "").localeCompare(String(left.cachedAt || "")),
  )[0] || null;
}

function findCategory(nodes, categoryId) {
  for (const node of nodes || []) {
    if (String(node.category_id) === String(categoryId)) return node;
    const child = findCategory(node.children, categoryId);
    if (child) return child;
  }
  return null;
}

export function loadDemoSheinSchemaRecords(filePath = defaultSnapshotFile) {
  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    throw schemaError(
      "DEMO_SCHEMA_SNAPSHOT_MISSING",
      `未找到 SHEIN 官方 schema 缓存：${filePath}`,
      503,
    );
  }
  if (
    cachedFilePath === filePath &&
    cachedMtimeMs === stats.mtimeMs &&
    cachedRecords.length
  ) {
    return cachedRecords;
  }

  const envelope = JSON.parse(readFileSync(filePath, "utf8"));
  if (envelope.version !== 1 || !Array.isArray(envelope.records)) {
    throw schemaError(
      "DEMO_SCHEMA_SNAPSHOT_INVALID",
      "SHEIN 官方 schema 缓存格式不正确",
      503,
    );
  }
  cachedFilePath = filePath;
  cachedMtimeMs = stats.mtimeMs;
  cachedRecords = envelope.records;
  return cachedRecords;
}

export function readDemoPublishCategories({
  records = loadDemoSheinSchemaRecords(),
} = {}) {
  const record = newest(records.filter((item) => item.kind === "categories"));
  if (!record?.value?.info?.data) {
    throw schemaError(
      "DEMO_CATEGORY_SNAPSHOT_MISSING",
      "SHEIN 官方缓存中没有类目树",
      503,
    );
  }
  return {
    info: clone(record.value.info),
    snapshot: {
      cachedAt: record.cachedAt || null,
      source: "shein-api-cache",
    },
  };
}

export function readDemoPublishSchema({
  categoryId,
  productTypeId,
  records = loadDemoSheinSchemaRecords(),
} = {}) {
  if (!categoryId || !productTypeId) {
    throw schemaError(
      "INVALID_DEMO_SCHEMA_REQUEST",
      "categoryId和productTypeId不能为空",
    );
  }

  const categoryRecords = records.filter((item) => item.kind === "categories");
  const categoryMatch = categoryRecords
    .map((record) => ({
      record,
      category: findCategory(record.value?.info?.data, categoryId),
    }))
    .filter((item) => item.category)
    .sort(
      (left, right) =>
        String(right.record.cachedAt || "").localeCompare(
          String(left.record.cachedAt || ""),
        ),
    )[0];
  if (!categoryMatch) {
    throw schemaError(
      "DEMO_CATEGORY_NOT_FOUND",
      "官方类目快照中不存在所选类目",
      404,
    );
  }
  if (
    !categoryMatch.category.last_category ||
    String(categoryMatch.category.product_type_id) !== String(productTypeId)
  ) {
    throw schemaError(
      "DEMO_CATEGORY_PRODUCT_TYPE_MISMATCH",
      "类目与产品类型不匹配，请重新选择末级类目",
    );
  }

  const sameStoreRecords = records.filter(
    (item) => String(item.storeId) === String(categoryMatch.record.storeId),
  );
  const attributeRecord = newest(sameStoreRecords.filter(
    (item) =>
      item.kind === "attributes" &&
      String(item.key) === String(productTypeId),
  ));
  if (!attributeRecord?.value?.data) {
    throw schemaError(
      "DEMO_ATTRIBUTE_SNAPSHOT_MISSING",
      "所选类目还没有官方属性缓存，请先同步 SHEIN 属性模板",
      404,
    );
  }
  const standardRecord = newest(sameStoreRecords.filter(
    (item) =>
      item.kind === "publish-standard" &&
      String(item.key) === String(categoryId),
  ));

  return {
    attributes: clone(attributeRecord.value),
    publishStandard: clone(standardRecord?.value || {}),
    snapshot: {
      cachedAt: attributeRecord.cachedAt || null,
      source: "shein-api-cache",
    },
  };
}

export function readDemoPublishSchemaCoverage({
  records = loadDemoSheinSchemaRecords(),
} = {}) {
  const categoryRecord = newest(records.filter((item) => item.kind === "categories"));
  if (!categoryRecord?.value?.info) {
    throw schemaError(
      "DEMO_CATEGORY_SNAPSHOT_MISSING",
      "SHEIN 官方缓存中没有类目树",
      503,
    );
  }
  const storeRecords = records.filter(
    (item) => String(item.storeId) === String(categoryRecord.storeId),
  );
  const coverage = buildPublishSchemaCoverage({
    categoryInfo: categoryRecord.value.info,
    attributeSnapshots: storeRecords
      .filter((item) => item.kind === "attributes")
      .map((item) => ({
        productTypeId: item.key,
        fetchedAt: item.cachedAt || null,
      })),
    publishStandardSnapshots: storeRecords
      .filter((item) => item.kind === "publish-standard")
      .map((item) => ({
        categoryId: item.key,
        fetchedAt: item.cachedAt || null,
      })),
  });
  return {
    ...coverage,
    snapshot: {
      cachedAt: categoryRecord.cachedAt || null,
      source: "shein-api-cache",
    },
  };
}
