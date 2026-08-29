import { applyCommercialTemplate } from "./commercial-template-contract.js";
import {
  applyInventoryToAll,
  applySharedSkuImage,
  applySupplierSkuPrefix,
  autoMapSkuPreviewImages,
  buildSaleAttributeSchema,
  buildSkuStageFromSizeTemplate,
  reconcileSkuSizeMappings,
  applyPackagingTemplate,
} from "./product-sku-contract.js";
import {
  buildAttributeFields,
  validateAttributeAssignments,
} from "./attribute-template-contract.js";
import {
  applyTitleRule,
  normalizeTitleRule,
  stripTitleRuleFragments,
} from "./title-rule-template-contract.js";
import { applyPublishSettingsTemplate } from "./publish-settings-template-contract.js";

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function configRequired(value) {
  const required = object(value).is_required;
  if (typeof required === "boolean") return required;
  return ["1", "true", "yes", "required", "是"].includes(
    String(required ?? "").trim().toLowerCase(),
  );
}

function hasFinishedDimensions(row) {
  return row?.shape === "round"
    ? positive(row?.diameterCm)
    : positive(row?.widthCm) && positive(row?.lengthCm);
}

function tailAsset(asset) {
  return {
    assetId: String(asset?.id || asset?.assetId || ""),
    originalName: String(asset?.originalName || ""),
    contentType: String(asset?.contentType || ""),
    width: Number(asset?.width) || null,
    height: Number(asset?.height) || null,
    sizeBytes: Number(asset?.sizeBytes) || 0,
  };
}

function selectedTemplateIds(options) {
  return Object.fromEntries([
    ["attributeTemplateId", options.attributeTemplate?.id],
    ["sizeTemplateId", options.sizeTemplate?.id],
    ["titleRuleTemplateId", options.titleRuleTemplate?.id],
    ["commercialTemplateId", options.commercialTemplate?.id],
    ["publishSettingsTemplateId", options.publishSettingsTemplate?.id],
    ["packagingTemplateId", options.packagingTemplate?.id],
    ["tailImageTemplateId", options.tailImageTemplate?.id],
  ].filter(([, value]) => String(value || "").trim()));
}

function schemaKey(categoryId, productTypeId) {
  return `${String(categoryId || "")}:${String(productTypeId || "")}`;
}

function hasValue(value) {
  return String(value ?? "").trim() !== "";
}

function generatedSupplierCodes(drafts, options) {
  if (options.generateSupplierCodes !== true) return new Map();
  const prefix = String(options.supplierCodePrefix || "").trim();
  if (!prefix || prefix.length > 190) return new Map();
  const used = new Set(
    (Array.isArray(options.reservedSupplierCodes)
      ? options.reservedSupplierCodes
      : []).map(String).filter(Boolean),
  );
  const result = new Map();
  let serial = 1;
  for (const draft of drafts) {
    let candidate = "";
    do {
      candidate = `${prefix}-${String(serial).padStart(3, "0")}`;
      serial += 1;
    } while (used.has(candidate));
    used.add(candidate);
    result.set(String(draft?.id || ""), candidate);
  }
  return result;
}

function buildSchemaSnapshots(schema, categoryId, productTypeId) {
  const checkedAt = String(schema?.checkedAt || "").trim();
  const attributes = object(schema?.attributes);
  const publishStandard = object(schema?.publishStandard);
  const fields = buildAttributeFields(attributes, productTypeId);
  const saleSchema = buildSaleAttributeSchema(
    attributes,
    productTypeId,
    schema?.customAttributePermissions,
  );
  const pictureConfig = Array.isArray(publishStandard.picture_config_list)
    ? publishStandard.picture_config_list
    : [];
  const fillInStandard = Array.isArray(publishStandard.fill_in_standard_list)
    ? publishStandard.fill_in_standard_list
    : [];
  return {
    checkedAt,
    fields,
    saleSchema,
    attributeSchemaSnapshot: {
      fetchedAt: checkedAt,
      categoryId,
      productTypeId,
      fields: fields.map((field) => ({
        id: field.id,
        name: field.name,
        required: field.required,
        typeCode: field.typeCode,
        dataDimension: field.dataDimension,
        modeCode: field.modeCode,
        maxSelections: field.maxSelections,
        values: field.values,
        ruleInfoList: field.ruleInfoList,
      })),
    },
    salesSchemaSnapshot: {
      fetchedAt: checkedAt,
      mainAttributeStatus: saleSchema.mainAttributeStatus,
      fields: saleSchema.fields,
      sizeFields: saleSchema.sizeFields,
    },
    publishStandardSnapshot: {
      fetchedAt: checkedAt,
      currency: String(publishStandard.currency || "").trim(),
      weightRequired: configRequired(publishStandard.weight_config),
      weightConfig: publishStandard.weight_config || null,
      dimensionConfig: publishStandard.length_width_height_config || null,
      pictureConfig,
      fillInStandard,
      defaultLanguage: String(publishStandard.default_language || "").trim(),
      titleMaxLength: Number(publishStandard.default_language_title_max_length) || null,
    },
  };
}

function attributeTemplateAssignments(template, fields) {
  const assignments = Array.isArray(template?.data?.assignments)
    ? template.data.assignments
    : [];
  const known = new Map(fields.map((field) => [String(field.id), field]));
  const values = {};
  for (const assignment of assignments) {
    const attributeId = String(assignment?.attributeId || "");
    const field = known.get(attributeId);
    if (!field) return null;
    const valueIds = Array.from(new Set(
      (Array.isArray(assignment?.valueIds) ? assignment.valueIds : [])
        .map(String)
        .filter(Boolean),
    ));
    const customValue = String(assignment?.customValue || "").trim();
    const allowed = new Set(field.values.map((value) => String(value.id)));
    if (
      valueIds.some((valueId) => !allowed.has(valueId)) ||
      (valueIds.length && ![1, 3, 4].includes(Number(field.modeCode))) ||
      (customValue && ![0, 4].includes(Number(field.modeCode))) ||
      (Number(field.maxSelections) > 0 && valueIds.length > Number(field.maxSelections))
    ) return null;
    values[attributeId] = { valueIds, customValue };
  }
  const validation = validateAttributeAssignments(fields, values);
  return validation.missingFieldIds.length ? null : values;
}

function rugReportSourcesMatchSchema(sources, fields) {
  const source = object(sources);
  if (!Object.keys(source).length) return true;
  const known = new Map(fields.map((field) => [String(field.id), field]));
  const dimensions = Array.isArray(source.dimensions) ? source.dimensions : [];
  if (dimensions.some((item) => !known.has(String(item?.attributeId || "")))) {
    return false;
  }
  const thresholds = object(source.thresholds);
  for (const item of [thresholds.longestEdge, thresholds.area].filter(Boolean)) {
    const field = known.get(String(item?.attributeId || ""));
    const allowed = new Set((field?.values || []).map((value) => String(value.id)));
    if (
      !field ||
      !allowed.has(String(item?.exceededValueId || "")) ||
      !allowed.has(String(item?.withinValueId || ""))
    ) return false;
  }
  return true;
}

function planOne(draft, options, generatedSupplierCode = "") {
  const blockers = [];
  const changes = [];
  const source = object(draft?.data);
  const data = {
    ...source,
    imageAssets: { ...object(source.imageAssets) },
    skuRows: (Array.isArray(source.skuRows) ? source.skuRows : [])
      .map((row) => ({ ...object(row) })),
  };
  let rows = data.skuRows;
  let categoryId = String(draft?.categoryId || "");
  let productTypeId = String(draft?.productTypeId || "");

  if (draft?.status === "published") blockers.push("草稿已发布，不能批量改写");
  if (draft?.status === "archived") blockers.push("草稿已归档，不能批量改写");

  const attributeTemplate = options.attributeTemplate;
  if (attributeTemplate) {
    const hasExistingAttributeWork = Boolean(
      categoryId ||
      productTypeId ||
      String(source.attributeTemplateId || "").trim() ||
      Object.keys(object(source.attributeValues)).length,
    );
    const replaceExisting = options.replaceExistingTemplates === true;
    const categoryWouldChange = Boolean(
      categoryId && productTypeId && (
        categoryId !== String(attributeTemplate.categoryId || "") ||
        productTypeId !== String(attributeTemplate.productTypeId || "")
      ),
    );
    if (hasExistingAttributeWork && !replaceExisting) {
      blockers.push("草稿已有类目或商品属性，不能批量覆盖");
    } else if (replaceExisting && categoryWouldChange && rows.length) {
      blockers.push("重新引用商品属性模板会改变类目，已有 SKU 请先在单品编辑中处理");
    } else {
      const nextCategoryId = String(attributeTemplate.categoryId || "");
      const nextProductTypeId = String(attributeTemplate.productTypeId || "");
      const schema = object(options.schemaByCategory)[
        schemaKey(nextCategoryId, nextProductTypeId)
      ];
      const snapshots = buildSchemaSnapshots(
        schema,
        nextCategoryId,
        nextProductTypeId,
      );
      const assignments = snapshots.checkedAt && snapshots.fields.length
        ? attributeTemplateAssignments(attributeTemplate, snapshots.fields)
        : null;
      if (
        !nextCategoryId ||
        !nextProductTypeId ||
        !assignments ||
        !rugReportSourcesMatchSchema(
          attributeTemplate.data?.rugReportSources,
          snapshots.fields,
        )
      ) {
        blockers.push("商品属性模板与当前 SHEIN Schema 不一致，请重新保存模板");
      } else {
        categoryId = nextCategoryId;
        productTypeId = nextProductTypeId;
        data.categoryName = String(attributeTemplate.data?.categoryName || "");
        data.categoryPath = Array.isArray(attributeTemplate.data?.categoryPath)
          ? attributeTemplate.data.categoryPath.map(String)
          : [];
        data.attributeTemplateId = String(attributeTemplate.id || "");
        data.attributeValues = assignments;
        data.rugReportSources = attributeTemplate.data?.rugReportSources || null;
        data.attributeSchemaSnapshot = snapshots.attributeSchemaSnapshot;
        data.associatedRulesSnapshot = { checkedAt: "", rules: [] };
        data.salesSchemaSnapshot = snapshots.salesSchemaSnapshot;
        data.publishStandardSnapshot = snapshots.publishStandardSnapshot;
        data.currency = snapshots.publishStandardSnapshot.currency;
        changes.push("商品属性");
      }
    }
  }

  const sizeTemplate = options.sizeTemplate;
  if (sizeTemplate) {
    const existingTemplateId = String(source.sizeTemplateId || "").trim();
    const selectedTemplateId = String(sizeTemplate.id || "").trim();
    const existingColor = object(source.colorSaleValue);
    const repairSameTemplate = Boolean(
      rows.length &&
      existingTemplateId &&
      existingTemplateId === selectedTemplateId &&
      !Object.keys(existingColor).length,
    );
    const hasExistingSkuWork = Boolean(rows.length || existingTemplateId || Object.keys(existingColor).length);
    if (hasExistingSkuWork && !repairSameTemplate && options.replaceExistingTemplates !== true) {
      blockers.push("草稿已有 SKU 或颜色尺寸设置，不能批量覆盖");
    } else if (!categoryId || !productTypeId) {
      blockers.push("颜色与尺寸模板需要草稿先有明确的 SHEIN 类目");
    } else {
      const schema = object(options.schemaByCategory)[schemaKey(categoryId, productTypeId)];
      const snapshots = buildSchemaSnapshots(schema, categoryId, productTypeId);
      const next = snapshots.checkedAt
        ? buildSkuStageFromSizeTemplate(sizeTemplate, snapshots.saleSchema)
        : { colorMapping: null, rows: [] };
      const requiresSaleSizeMapping = snapshots.saleSchema.fields.some(
        (field) => field.id !== next.colorMapping?.attributeId,
      );
      const repairedRows = repairSameTemplate
        ? reconcileSkuSizeMappings(rows, snapshots.saleSchema, next.colorMapping)
        : next.rows;
      const unmapped = !next.colorMapping ||
        (requiresSaleSizeMapping && repairedRows.find((row) => !row.sizeMapping));
      if (unmapped || !repairedRows.length) {
        blockers.push("颜色与尺寸模板无法在当前 SHEIN Schema 中精确匹配");
      } else {
        rows = repairedRows;
        data.sizeTemplateId = String(sizeTemplate.id || "");
        data.colorSaleValue = next.colorMapping;
        data.skuRows = rows;
        data.salesSchemaSnapshot = snapshots.salesSchemaSnapshot;
        data.publishStandardSnapshot = snapshots.publishStandardSnapshot;
        data.currency = snapshots.publishStandardSnapshot.currency;
        changes.push(repairSameTemplate ? "修复颜色与尺寸映射" : "颜色与尺寸");
      }
    }
  }

  if (options.generateSupplierCodes === true) {
    const sourceRows = Array.isArray(source.skuRows) ? source.skuRows : [];
    if (!rows.length) {
      blockers.push("没有 SKU，无法生成商家 SKC/SKU 货号");
    } else if (
      String(source.supplierCode || "").trim() ||
      sourceRows.some((row) => String(row?.supplierSku || "").trim())
    ) {
      blockers.push("草稿已有商家货号，不能批量覆盖");
    } else if (!generatedSupplierCode) {
      blockers.push("货号前缀不能为空且不能超过190个字符");
    } else {
      data.supplierCode = generatedSupplierCode;
      rows = applySupplierSkuPrefix(rows, generatedSupplierCode);
      data.skuRows = rows;
      changes.push("商家货号");
    }
  }

  if (hasValue(options.inventoryValue)) {
    const inventory = Number(options.inventoryValue);
    const sourceRows = Array.isArray(source.skuRows) ? source.skuRows : [];
    if (!Number.isInteger(inventory) || inventory < 0 || inventory > 99999) {
      blockers.push("统一库存必须是0到99999的整数");
    } else if (!rows.length) {
      blockers.push("没有 SKU，无法填写统一库存");
    } else if (sourceRows.some((row) => hasValue(row?.inventoryNum))) {
      blockers.push("草稿已有库存，不能批量覆盖");
    } else {
      rows = applyInventoryToAll(rows, inventory);
      data.bulkInventory = String(inventory);
      data.skuRows = rows;
      changes.push("统一库存");
    }
  }

  if (options.autoMapSkuImages === true) {
    const sourceRows = Array.isArray(source.skuRows) ? source.skuRows : [];
    const images = Array.isArray(source.skuPreviewImages)
      ? source.skuPreviewImages
      : [];
    if (sourceRows.some((row) => String(row?.imageAssetId || "").trim())) {
      blockers.push("草稿已有 SKU 图片映射，不能批量覆盖");
    } else if (images.length && !rows.length) {
      blockers.push("没有 SKU，无法匹配候选图");
    } else if (images.length === 1) {
      const assetId = String(images[0]?.assetId || images[0]?.id || "").trim();
      if (assetId) {
        rows = applySharedSkuImage(rows, assetId);
        data.skuRows = rows;
        changes.push("SKU预览图");
      }
    } else if (images.length > 1) {
      const mapped = autoMapSkuPreviewImages(rows, images);
      if (
        mapped.unmatchedAssetIds.length ||
        mapped.ambiguousAssetIds.length ||
        mapped.rows.some((row) => !String(row?.imageAssetId || "").trim())
      ) {
        blockers.push("SKU候选图无法按完整货号或唯一尺寸全部精确匹配");
      } else {
        rows = mapped.rows;
        data.skuRows = rows;
        changes.push("SKU预览图");
      }
    }
  }

  const titleTemplate = options.titleRuleTemplate;
  if (titleTemplate) {
    const rule = normalizeTitleRule(titleTemplate.data);
    const previousRule = (Array.isArray(options.titleRuleTemplates)
      ? options.titleRuleTemplates
      : []).find((template) =>
        String(template?.id || "") === String(source.titleRuleTemplateId || "")
      )?.data;
    const baseTitle = String(source.titleRuleBaseTitle || "").trim() ||
      stripTitleRuleFragments(
        String(source.title || draft?.name || ""),
        previousRule || (
          String(source.titleRuleTemplateId || "") === String(titleTemplate.id || "")
            ? rule
            : {}
        ),
      );
    const nextTitle = applyTitleRule(baseTitle, rule);
    if (nextTitle && (
      nextTitle !== String(source.title || "") ||
      String(source.titleRuleTemplateId || "") !== String(titleTemplate.id || "")
    )) {
      data.title = nextTitle;
      data.titleRuleBaseTitle = baseTitle;
      data.titleRuleTemplateId = String(titleTemplate.id || "");
      changes.push("标题规则");
    }
  }

  const commercialTemplate = options.commercialTemplate;
  if (commercialTemplate) {
    if (!rows.length) {
      blockers.push("没有 SKU，无法换算供货总价和克重");
    } else {
      const invalid = rows.filter((row) => !hasFinishedDimensions(row));
      if (invalid.length) {
        blockers.push(`SKU ${String(invalid[0].sizeText || invalid[0].id || "未命名")} 缺少有效成品尺寸`);
      } else {
        rows = applyCommercialTemplate(rows, commercialTemplate.data);
        data.commercialTemplateId = String(commercialTemplate.id || "");
        data.pricePerSquareMeter = Number(commercialTemplate.data?.pricePerSquareMeter) || "";
        data.gramsPerSquareMeter = Number(commercialTemplate.data?.gramsPerSquareMeter) || "";
        data.skuRows = rows;
        changes.push("计价与克重");
      }
    }
  }

  const packagingTemplate = options.packagingTemplate;
  if (packagingTemplate) {
    const material = String(options.packagingMaterial || "").trim();
    const materialRows = object(packagingTemplate.data?.materials)[material];
    if (!material) {
      blockers.push("已选择打包体积模板，但未选择包装材质");
    } else if (!Array.isArray(materialRows) || !materialRows.length) {
      blockers.push(`打包体积模板没有“${material}”材质数据`);
    } else if (!rows.length) {
      blockers.push("没有 SKU，无法匹配打包体积");
    } else {
      const packaged = applyPackagingTemplate(rows, packagingTemplate, material, { overwrite: true });
      const unmatched = packaged.find((row) => row.packageMatch !== "matched");
      if (unmatched) {
        blockers.push(`SKU ${String(unmatched.sizeText || unmatched.id || "未命名")} 没有精确匹配的打包体积`);
      } else {
        rows = packaged;
        data.skuRows = rows;
        data.packagingTemplateId = String(packagingTemplate.id || "");
        data.packagingMaterial = material;
        changes.push("打包体积");
      }
    }
  }

  const publishSettingsTemplate = options.publishSettingsTemplate;
  if (publishSettingsTemplate) {
    const existingSettings = object(source.publishSettings);
    if (Object.values(existingSettings).some(hasValue)) {
      blockers.push("草稿已有发布设置，不能批量覆盖");
    } else if (!categoryId || !productTypeId) {
      blockers.push("发布设置模板需要草稿先有明确的 SHEIN 类目");
    } else {
      const schema = object(options.schemaByCategory)[schemaKey(categoryId, productTypeId)];
      const checkedAt = String(schema?.checkedAt || "").trim();
      const publishStandard = object(schema?.publishStandard);
      const fillInStandard = Array.isArray(publishStandard.fill_in_standard_list)
        ? publishStandard.fill_in_standard_list
        : [];
      const applied = checkedAt
        ? applyPublishSettingsTemplate({
            template: publishSettingsTemplate.data,
            businessMode: options.businessMode,
            fillInStandard,
          })
        : { valid: false, blockers: [{ message: "当前 SHEIN 发布规则读取失败" }] };
      if (!applied.valid) {
        blockers.push(applied.blockers[0]?.message || "发布设置模板与当前 SHEIN 规则不一致");
      } else {
        data.publishSettingsTemplateId = String(publishSettingsTemplate.id || "");
        data.publishSettings = applied.settings;
        changes.push("发布设置");
      }
    }
  }

  const imageTemplate = options.tailImageTemplate;
  if (imageTemplate) {
    const assets = (Array.isArray(imageTemplate.data?.assets)
      ? imageTemplate.data.assets
      : []).map(tailAsset).filter((asset) => asset.assetId);
    if (!assets.length) {
      blockers.push("通用商品图片模板没有可引用的受保护图片");
    } else if (
      String(imageTemplate.storeId || "") &&
      String(draft?.storeId || "") &&
      String(imageTemplate.storeId) !== String(draft.storeId)
    ) {
      blockers.push("通用商品图片模板不属于当前草稿店铺");
    } else {
      data.tailImageTemplateId = String(imageTemplate.id || "");
      data.tailImagePlacement = "append";
      data.imageAssets = { ...data.imageAssets, tail: assets };
      changes.push("通用商品图片");
    }
  }

  if (blockers.length || !changes.length) {
    return {
      draftId: String(draft?.id || ""),
      name: String(draft?.name || "未命名草稿"),
      sourceUpdatedAt: String(draft?.updatedAt || ""),
      state: blockers.length ? "blocked" : "skipped",
      blockers,
      changes,
      input: null,
    };
  }

  return {
    draftId: String(draft.id || ""),
    name: String(draft.name || "未命名草稿"),
    sourceUpdatedAt: String(draft.updatedAt || ""),
    state: "ready",
    blockers: [],
    changes,
    input: {
      id: String(draft.id || ""),
      name: String(data.title || draft.name || "未命名商品草稿").slice(0, 160),
      categoryId,
      productTypeId,
      data,
      preflight: {
        bulkTemplateApplication: {
          externalWrite: false,
          templateIds: selectedTemplateIds(options),
        },
      },
      status: "draft",
    },
  };
}

export function planBulkDraftTemplateApplication(options = {}) {
  const drafts = Array.isArray(options.drafts) ? options.drafts : [];
  const supplierCodes = generatedSupplierCodes(drafts, options);
  const items = drafts.map((draft) => planOne(
    draft,
    options,
    supplierCodes.get(String(draft?.id || "")) || "",
  ));
  return {
    items,
    readyCount: items.filter((item) => item.state === "ready").length,
    blockedCount: items.filter((item) => item.state === "blocked").length,
    skippedCount: items.filter((item) => item.state === "skipped").length,
    replaceExistingTemplates: options.replaceExistingTemplates === true,
    externalWrite: false,
  };
}
