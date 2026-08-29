function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeSizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[×xX＊*]/g, "x")
    .replace(/\s+/g, "");
}

export function filterSheinSizeOptions(options = [], query = "", limit = 80) {
  const normalizedQuery = normalizeSizeSearch(query);
  const matches = options.filter((option) => {
    if (!normalizedQuery) return true;
    return normalizeSizeSearch(
      `${option.label || ""} ${option.fieldName || ""}`,
    ).includes(normalizedQuery);
  });
  return matches.slice(0, limit);
}

export function parseSheinSizeLabel(label, shape = "rectangle") {
  const normalized = String(label || "")
    .replace(/,/g, ".")
    .replace(/[×xX＊*]/g, "x");
  const numbers = normalized
    .match(/\d+(?:\.\d+)?/g)
    ?.map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!numbers?.length) return null;
  if (shape === "round") {
    return {
      diameterCm: numbers[0],
      widthCm: numbers[0],
      lengthCm: numbers[0],
    };
  }
  if (numbers.length < 2) return null;
  return {
    widthCm: numbers[0],
    lengthCm: numbers[1],
    diameterCm: null,
  };
}

export function buildInitialSizeAttributeValues(
  sizeAttributeFields = [],
  dimensions = null,
) {
  if (!dimensions) return {};
  return Object.fromEntries(
    sizeAttributeFields.map((field) => {
      const name = `${field.name || ""} ${field.nameEn || ""}`;
      let value = "";
      if (/直径|diameter/i.test(name)) value = dimensions.diameterCm || "";
      else if (/宽度|width/i.test(name)) value = dimensions.widthCm || "";
      else if (/长度|length/i.test(name)) value = dimensions.lengthCm || "";
      return [String(field.id), value === "" ? "" : String(value)];
    }),
  );
}

export function applySheinSizeOption(
  row,
  option,
  { shape = "rectangle", sizeAttributeFields = [] } = {},
) {
  const dimensions = parseSheinSizeLabel(option?.label, shape);
  return {
    ...row,
    name: option?.label || row.name || "",
    shape,
    sheinValueId: `${option.fieldId}:${option.id}`,
    sheinAttributeId: option.fieldId,
    sheinAttributeValueId: option.id,
    sheinValueLabel: option.label || "",
    widthCm: dimensions?.widthCm || "",
    lengthCm: dimensions?.lengthCm || "",
    diameterCm: dimensions?.diameterCm || "",
    sizeAttributeValues: buildInitialSizeAttributeValues(
      sizeAttributeFields,
      dimensions,
    ),
    areaSquareMeters: null,
    weightGrams: null,
    packageLengthCm: "",
    packageWidthCm: "",
    packageHeightCm: "",
    packageMatch: "pending",
  };
}

export function buildSizeAttributeList(rows = [], sizeAttributeFields = []) {
  const result = [];
  for (const row of rows) {
    if (!row.sheinAttributeId) continue;
    for (const field of sizeAttributeFields) {
      const rawValue = row.sizeAttributeValues?.[String(field.id)];
      const value = positiveNumber(rawValue);
      if (value === null) continue;
      result.push({
        attribute_id: Number(field.id),
        attribute_extra_value: String(rawValue),
        relate_sale_attribute_id: Number(row.sheinAttributeId),
        relate_sale_attribute_value_id: Number(row.sheinAttributeValueId),
      });
    }
  }
  return result;
}

export function validateSizeTemplate({
  name,
  rows = [],
  sizeAttributeFields = [],
}) {
  const issues = [];
  if (!String(name || "").trim()) issues.push("请填写尺寸模板名称");
  if (!rows.length) issues.push("请至少添加一个SKU尺寸");

  rows.forEach((row, index) => {
    if (!row.sheinAttributeId || !row.sheinAttributeValueId) {
      issues.push(`第${index + 1}行尚未选择SHEIN尺寸值`);
    }
    for (const field of sizeAttributeFields.filter((item) => item.required)) {
      if (positiveNumber(row.sizeAttributeValues?.[String(field.id)]) === null) {
        issues.push(`第${index + 1}行缺少必填尺码表字段“${field.name}”`);
      }
    }
  });

  return { valid: issues.length === 0, issues };
}
