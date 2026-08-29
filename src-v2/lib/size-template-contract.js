function text(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function canonicalSizeText(value, smallCm, largeCm) {
  const source = text(value, 120);
  if (!/\d+(?:\.\d+)?\s*(?:cm)?\s*[×xX＊*]\s*\d+(?:\.\d+)?/i.test(source)) {
    return source;
  }
  const count = source.match(/^\s*(\d+)\s*(?:pc\b|件|个)/i)?.[1];
  return `${count ? `${count}pc ` : ""}${smallCm} × ${largeCm} cm`;
}

export function sizeTemplatePaths(storeId, templateId = "") {
  const store = encodeURIComponent(String(storeId));
  const templates = `/v1/web/stores/${store}/publish-templates`;
  return {
    templates: `${templates}?type=size`,
    template: templateId
      ? `${templates}/${encodeURIComponent(String(templateId))}`
      : templates,
  };
}

export function validateSizeTemplateDraft(input = {}) {
  const name = text(input.name, 80);
  const colorText = text(input.colorText, 80);
  const sourceRows = Array.isArray(input.rows) ? input.rows : [];
  const errors = { rows: [] };

  if (!name) errors.name = "请填写模板名称";
  if (!colorText) errors.colorText = "请填写共享颜色";
  if (!sourceRows.length) errors.rowsMessage = "至少添加一行尺寸";

  const rows = sourceRows.map((row) => {
    const sizeText = text(row.sizeText, 120);
    const lengthCm = positiveNumber(row.lengthCm);
    const widthCm = positiveNumber(row.widthCm);
    const rowErrors = {};
    if (!sizeText) rowErrors.sizeText = "请填写尺寸显示名";
    if (lengthCm === null) rowErrors.lengthCm = "长必须是大于 0 的数字";
    if (widthCm === null) rowErrors.widthCm = "宽必须是大于 0 的数字";
    errors.rows.push(rowErrors);
    const dimensions = [lengthCm, widthCm]
      .filter((value) => value !== null)
      .sort((left, right) => left - right);
    const smallCm = dimensions[0] ?? lengthCm;
    const largeCm = dimensions[1] ?? widthCm;
    return {
      sizeText: smallCm !== null && largeCm !== null
        ? canonicalSizeText(sizeText, smallCm, largeCm)
        : sizeText,
      lengthCm: smallCm,
      widthCm: largeCm,
    };
  });

  return {
    valid: !errors.name &&
      !errors.colorText &&
      !errors.rowsMessage &&
      errors.rows.every((row) => Object.keys(row).length === 0),
    errors,
    data: { name, colorText, rows },
  };
}
