import { normalizePackagingWorkbook } from "../../src/lib/package-template.js";

function text(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export { normalizePackagingWorkbook };

export function packagingTemplatePaths(storeId, templateId = "") {
  const store = encodeURIComponent(String(storeId));
  const templates = `/v1/web/stores/${store}/publish-templates`;
  return {
    templates: `${templates}?type=packaging`,
    template: templateId
      ? `${templates}/${encodeURIComponent(String(templateId))}`
      : templates,
  };
}

export function validatePackagingTemplateDraft(input = {}) {
  const name = text(input.name, 80);
  const workbook = input.workbook &&
    typeof input.workbook === "object" &&
    !Array.isArray(input.workbook)
    ? input.workbook
    : null;
  const issues = Array.isArray(workbook?.issues) ? workbook.issues : [];
  const sourceMaterials = workbook?.materials &&
    typeof workbook.materials === "object" &&
    !Array.isArray(workbook.materials)
    ? workbook.materials
    : {};
  const materials = Object.fromEntries(
    Object.entries(sourceMaterials).map(([material, rows]) => [
      text(material, 120),
      (Array.isArray(rows) ? rows : []).map((row) => ({
        widthCm: Number(row.widthCm),
        lengthCm: Number(row.lengthCm),
        packageLengthCm: Number(row.packageLengthCm),
        packageWidthCm: Number(row.packageWidthCm),
        packageHeightCm: Number(row.packageHeightCm),
      })),
    ]),
  );
  const errors = {};

  if (!name) errors.name = "请填写模板名称";
  if (!workbook) {
    errors.workbook = "请上传标准打包体积工作簿";
  } else if (issues.length) {
    errors.workbook = "请修正工作簿错误后重新上传";
  } else if (
    !Object.keys(materials).length ||
    Object.values(materials).some((rows) => !rows.length)
  ) {
    errors.workbook = "工作簿没有可用材质和尺寸记录";
  }

  return {
    valid: !errors.name && !errors.workbook,
    errors,
    data: {
      name,
      workbook: workbook
        ? {
            fileName: text(workbook.fileName, 255),
            importedAt: text(workbook.importedAt, 80),
            materials,
            overwrittenCount: Number(workbook.overwrittenCount || 0),
          }
        : null,
    },
  };
}
