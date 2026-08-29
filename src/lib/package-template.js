const REQUIRED_PACKAGING_HEADERS = ["宽", "长", "打包长", "打包宽", "打包高"];

function toPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function dimensionKey(width, length) {
  const normalized = [Number(width), Number(length)].sort((left, right) => left - right);
  return normalized.map((value) => String(Number(value.toFixed(4)))).join("x");
}

export function normalizePackagingWorkbook(sheets = []) {
  const materials = {};
  const issues = [];
  let overwrittenCount = 0;

  for (const sheet of sheets) {
    const material = String(sheet?.sheet || "").trim();
    const rows = Array.isArray(sheet?.data) ? sheet.data : [];
    if (!material || rows.length === 0) continue;

    const headers = rows[0].map((cell) => String(cell || "").trim());
    const missingHeaders = REQUIRED_PACKAGING_HEADERS.filter(
      (header) => !headers.includes(header),
    );
    const extraHeaders = headers.filter(
      (header) => header && !REQUIRED_PACKAGING_HEADERS.includes(header),
    );
    const duplicateHeaders = headers.filter(
      (header, index) => header && headers.indexOf(header) !== index,
    );
    if (
      missingHeaders.length ||
      extraHeaders.length ||
      duplicateHeaders.length ||
      headers.filter(Boolean).length !== REQUIRED_PACKAGING_HEADERS.length
    ) {
      const details = [
        missingHeaders.length ? `缺少列：${missingHeaders.join("、")}` : "",
        extraHeaders.length ? `多余列：${extraHeaders.join("、")}` : "",
        duplicateHeaders.length ? `重复列：${[...new Set(duplicateHeaders)].join("、")}` : "",
      ].filter(Boolean);
      issues.push(`${material} 表头必须严格为“${REQUIRED_PACKAGING_HEADERS.join("、")}”${details.length ? `（${details.join("；")}）` : ""}`);
      continue;
    }

    const indexes = Object.fromEntries(
      REQUIRED_PACKAGING_HEADERS.map((header) => [header, headers.indexOf(header)]),
    );
    const normalizedRows = rows
      .slice(1)
      .map((row, index) => ({
        rowNumber: index + 2,
        widthCm: toPositiveNumber(row[indexes["宽"]]),
        lengthCm: toPositiveNumber(row[indexes["长"]]),
        packageLengthCm: toPositiveNumber(row[indexes["打包长"]]),
        packageWidthCm: toPositiveNumber(row[indexes["打包宽"]]),
        packageHeightCm: toPositiveNumber(row[indexes["打包高"]]),
      }))
      .filter((row) => Object.values(row).slice(1).some(Boolean));

    const invalidRows = normalizedRows.filter((row) =>
      [
        row.widthCm,
        row.lengthCm,
        row.packageLengthCm,
        row.packageWidthCm,
        row.packageHeightCm,
      ].some((value) => value === null),
    );
    if (invalidRows.length) {
      issues.push(
        `${material} 第 ${invalidRows
          .slice(0, 5)
          .map((row) => row.rowNumber)
          .join("、")} 行存在空值或非正数`,
      );
    }

    const validRows = normalizedRows
      .filter((row) => !invalidRows.includes(row))
      .map((row) => ({
        ...row,
        key: dimensionKey(row.widthCm, row.lengthCm),
      }));
    const rowsByDimension = new Map();
    for (const row of validRows) {
      if (rowsByDimension.has(row.key)) overwrittenCount += 1;
      rowsByDimension.set(row.key, row);
    }
    materials[material] = [...rowsByDimension.values()];
  }

  const sizeKeys = new Set(
    Object.values(materials).flatMap((rows) => rows.map((row) => row.key)),
  );
  return {
    materials,
    issues,
    materialCount: Object.keys(materials).length,
    sizeCount: sizeKeys.size,
    rowCount: Object.values(materials).reduce((total, rows) => total + rows.length, 0),
    overwrittenCount,
  };
}

export function getFinishedDimensions(size = {}) {
  if (size.shape === "round") {
    const diameter = toPositiveNumber(size.diameterCm);
    return diameter ? { widthCm: diameter, lengthCm: diameter } : null;
  }
  const widthCm = toPositiveNumber(size.widthCm);
  const lengthCm = toPositiveNumber(size.lengthCm);
  return widthCm && lengthCm ? { widthCm, lengthCm } : null;
}

export function calculateAreaSquareMeters(size = {}) {
  const dimensions = getFinishedDimensions(size);
  if (!dimensions) return null;
  return Number(
    ((dimensions.widthCm * dimensions.lengthCm) / 10_000).toFixed(4),
  );
}

export function calculateWeightGrams(size = {}, gramsPerSquareMeter) {
  const area = calculateAreaSquareMeters(size);
  const gsm = toPositiveNumber(gramsPerSquareMeter);
  if (area === null || gsm === null) return null;
  return Math.round(area * gsm);
}

export function matchPackagingRow(size = {}, rows = []) {
  const dimensions = getFinishedDimensions(size);
  if (!dimensions) return null;
  const key = dimensionKey(dimensions.widthCm, dimensions.lengthCm);
  return rows.find((row) => row.key === key) || null;
}

export function enrichSizeRows(
  sizes = [],
  { materialRows = [], gramsPerSquareMeter = null } = {},
) {
  return sizes.map((size) => {
    const match = matchPackagingRow(size, materialRows);
    return {
      ...size,
      areaSquareMeters: calculateAreaSquareMeters(size),
      weightGrams:
        calculateWeightGrams(size, gramsPerSquareMeter) ??
        size.weightGrams ??
        null,
      packageLengthCm: match?.packageLengthCm ?? "",
      packageWidthCm: match?.packageWidthCm ?? "",
      packageHeightCm: match?.packageHeightCm ?? "",
      packageMatch: match ? "matched" : "missing",
    };
  });
}

export function createSizeRow() {
  return {
    id: globalThis.crypto?.randomUUID?.() || `size-${Date.now()}-${Math.random()}`,
    name: "",
    shape: "rectangle",
    widthCm: "",
    lengthCm: "",
    diameterCm: "",
    sheinValueId: "",
    sheinAttributeId: "",
    sheinAttributeValueId: "",
    sheinValueLabel: "",
    sizeAttributeValues: {},
    areaSquareMeters: null,
    weightGrams: null,
    packageLengthCm: "",
    packageWidthCm: "",
    packageHeightCm: "",
    packageMatch: "pending",
  };
}
