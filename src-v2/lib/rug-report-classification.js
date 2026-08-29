const EDGE_FACTORS_TO_CM = {
  mm: 0.1,
  cm: 1,
  m: 100,
};

const AREA_FACTORS_TO_M2 = {
  cm2: 0.0001,
  m2: 1,
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function blocker(code, message, attributeId = "") {
  return { code, message, attributeId: String(attributeId || "") };
}

function parseSinglePositiveNumber(value) {
  const text = String(value ?? "").trim();
  const matches = text.match(/\d+(?:\.\d+)?/g) || [];
  if (matches.length !== 1) return null;
  const number = Number(matches[0]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function readAssignmentValue(field, assignment) {
  const valueIds = asArray(assignment?.valueIds).map(String).filter(Boolean);
  const customValue = String(assignment?.customValue || "").trim();
  if ((valueIds.length && customValue) || valueIds.length > 1) {
    return {
      error: blocker(
        "ATTRIBUTE_VALUE_CONFLICT",
        `商品属性“${field.name}”存在多个尺寸值，无法判定 1630/1631`,
        field.id,
      ),
    };
  }
  if (customValue) return { rawValue: customValue, valueId: "" };
  if (!valueIds.length) {
    return {
      error: blocker(
        "ATTRIBUTE_VALUE_MISSING",
        `商品属性“${field.name}”未填写，无法判定 1630/1631`,
        field.id,
      ),
    };
  }
  const valueId = valueIds[0];
  const option = asArray(field.values).find(
    (item) => String(item.id) === valueId,
  );
  if (!option) {
    return {
      error: blocker(
        "ATTRIBUTE_VALUE_NOT_IN_SCHEMA",
        `商品属性“${field.name}”的选项不在当前 SHEIN Schema 中`,
        field.id,
      ),
    };
  }
  return { rawValue: String(option.label || ""), valueId };
}

export function deriveRugReportThresholdSources(fields = []) {
  const normalizedName = (value) => String(value || "")
    .replace(/\s+/g, "")
    .toLowerCase();
  const findSource = (expectedNames) => {
    const acceptedNames = new Set(expectedNames);
    const matches = asArray(fields).filter(
      (field) => acceptedNames.has(normalizedName(field?.name)),
    );
    if (matches.length !== 1) return null;
    const field = matches[0];
    if (
      ![3, 4].includes(Number(field.typeCode)) ||
      Number(field.dataDimension) !== 1
    ) return null;
    const exceeded = asArray(field.values).filter(
      (value) => String(value?.label || "").trim() === "是",
    );
    const within = asArray(field.values).filter(
      (value) => String(value?.label || "").trim() === "否",
    );
    if (exceeded.length !== 1 || within.length !== 1) return null;
    return {
      attributeId: String(field.id || ""),
      exceededValueId: String(exceeded[0].id || ""),
      withinValueId: String(within[0].id || ""),
    };
  };
  const longestEdge = findSource(["是否最长边大于1.8m"]);
  const area = findSource([
    "是否面积大于2.16m²",
    "是否面积大于2.16㎡",
    "是否面积大于2.16m2",
  ]);
  return longestEdge && area ? { longestEdge, area } : null;
}

function resolveSource({ fieldMap, assignments, source, kind }) {
  const attributeId = String(source?.attributeId || "");
  const field = fieldMap.get(attributeId);
  if (!field) {
    return {
      error: blocker(
        "ATTRIBUTE_NOT_IN_SCHEMA",
        `尺寸来源属性 ${attributeId || "--"} 不在当前 SHEIN Schema 中`,
        attributeId,
      ),
    };
  }
  if (
    ![3, 4].includes(Number(field.typeCode)) ||
    Number(field.dataDimension) !== 1
  ) {
    return {
      error: blocker(
        "ATTRIBUTE_NOT_SKC_PRODUCT",
        `属性“${field.name}”不是 SKC 维度商品属性，不能用于判定 1630/1631`,
        attributeId,
      ),
    };
  }

  const factors = kind === "edge" ? EDGE_FACTORS_TO_CM : AREA_FACTORS_TO_M2;
  const unit = String(source?.unit || "");
  const factor = factors[unit];
  if (!factor) {
    return {
      error: blocker(
        "ATTRIBUTE_UNIT_UNSUPPORTED",
        `商品属性“${field.name}”缺少可识别的标准单位`,
        attributeId,
      ),
    };
  }

  const assignmentValue = readAssignmentValue(
    field,
    assignments?.[attributeId],
  );
  if (assignmentValue.error) return assignmentValue;
  const numericValue = parseSinglePositiveNumber(assignmentValue.rawValue);
  if (numericValue === null) {
    return {
      error: blocker(
        "ATTRIBUTE_VALUE_INVALID",
        `商品属性“${field.name}”不是单一正数，无法判定 1630/1631`,
        attributeId,
      ),
    };
  }

  return {
    evidence: {
      attributeId,
      attributeName: String(field.name || attributeId),
      rawValue: assignmentValue.rawValue,
      valueId: assignmentValue.valueId,
      unit,
      normalizedUnit: kind === "edge" ? "cm" : "m2",
      normalizedValue: numericValue * factor,
    },
  };
}

function resolveThresholdSource({ fieldMap, assignments, source }) {
  const attributeId = String(source?.attributeId || "");
  const field = fieldMap.get(attributeId);
  if (!field) {
    return {
      error: blocker(
        "ATTRIBUTE_NOT_IN_SCHEMA",
        `阈值来源属性 ${attributeId || "--"} 不在当前 SHEIN Schema 中`,
        attributeId,
      ),
    };
  }
  if (
    ![3, 4].includes(Number(field.typeCode)) ||
    Number(field.dataDimension) !== 1
  ) {
    return {
      error: blocker(
        "ATTRIBUTE_NOT_SKC_PRODUCT",
        `属性“${field.name}”不是 SKC 维度商品属性，不能用于判定 1630/1631`,
        attributeId,
      ),
    };
  }

  const exceededValueId = String(source?.exceededValueId || "");
  const withinValueId = String(source?.withinValueId || "");
  const schemaValueIds = new Set(asArray(field.values).map((item) => String(item.id)));
  if (
    !exceededValueId ||
    !withinValueId ||
    exceededValueId === withinValueId ||
    !schemaValueIds.has(exceededValueId) ||
    !schemaValueIds.has(withinValueId)
  ) {
    return {
      error: blocker(
        "ATTRIBUTE_THRESHOLD_CONFIG_STALE",
        `商品属性“${field.name}”的阈值选项不在当前 SHEIN Schema 中`,
        attributeId,
      ),
    };
  }

  const assignmentValue = readAssignmentValue(field, assignments?.[attributeId]);
  if (assignmentValue.error) return assignmentValue;
  if (![exceededValueId, withinValueId].includes(assignmentValue.valueId)) {
    return {
      error: blocker(
        "ATTRIBUTE_THRESHOLD_VALUE_UNKNOWN",
        `商品属性“${field.name}”不是已配置的“是/否”阈值选项，无法判定 1630/1631`,
        attributeId,
      ),
    };
  }

  const exceeded = assignmentValue.valueId === exceededValueId;
  return {
    exceeded,
    evidence: {
      attributeId,
      attributeName: String(field.name || attributeId),
      rawValue: assignmentValue.rawValue,
      valueId: assignmentValue.valueId,
      unit: "threshold",
      normalizedUnit: "",
      normalizedValue: exceeded ? "是" : "否",
    },
  };
}

export function classifyRugReportFromProductAttributes({
  fields = [],
  assignments = {},
  sources = {},
} = {}) {
  const fieldMap = new Map(
    asArray(fields).map((field) => [String(field.id || ""), field]),
  );
  const blockers = [];
  const evidence = [];
  const dimensions = asArray(sources.dimensions);
  const explicitThresholds = sources?.thresholds &&
      typeof sources.thresholds === "object" &&
      Object.keys(sources.thresholds).length
    ? sources.thresholds
    : null;
  const hasNumericSources = dimensions.length ||
    asArray(sources.longestEdge).length ||
    asArray(sources.area).length;
  const thresholds = explicitThresholds || (
    hasNumericSources ? null : deriveRugReportThresholdSources(fields)
  );
  if (thresholds) {
    if (explicitThresholds && hasNumericSources) {
      blockers.push(blocker(
        "ATTRIBUTE_SOURCE_CONFLICT",
        "1630/1631 判定不能同时配置数值尺寸和是/否阈值属性",
      ));
    }
    const results = [
      resolveThresholdSource({
        fieldMap,
        assignments,
        source: thresholds.longestEdge,
      }),
      resolveThresholdSource({
        fieldMap,
        assignments,
        source: thresholds.area,
      }),
    ];
    for (const result of results) {
      if (result.error) blockers.push(result.error);
      if (result.evidence) evidence.push(result.evidence);
    }
    if (blockers.length) {
      return {
        reportType: null,
        longestEdgeCm: null,
        areaM2: null,
        evidence,
        blockers,
      };
    }
    return {
      reportType: results.some((result) => result.exceeded) ? "1630" : "1631",
      longestEdgeCm: null,
      areaM2: null,
      evidence,
      blockers: [],
    };
  }
  if (dimensions.length) {
    if (dimensions.length !== 2) {
      blockers.push(blocker(
        "ATTRIBUTE_DIMENSIONS_INCOMPLETE",
        "1630/1631 判定必须配置两个成品边长商品属性",
      ));
    } else {
      for (const source of dimensions) {
        const resolved = resolveSource({
          fieldMap,
          assignments,
          source,
          kind: "edge",
        });
        if (resolved.error) blockers.push(resolved.error);
        if (resolved.evidence) evidence.push(resolved.evidence);
      }
    }
    if (blockers.length) {
      return {
        reportType: null,
        longestEdgeCm: null,
        areaM2: null,
        evidence,
        blockers,
      };
    }
    const edgeValues = evidence.map((item) => item.normalizedValue);
    const longestEdgeCm = Math.max(...edgeValues);
    const areaM2 = (edgeValues[0] * edgeValues[1]) / 10000;
    return {
      reportType:
        longestEdgeCm <= 180 && areaM2 <= 2.16 ? "1631" : "1630",
      longestEdgeCm,
      areaM2,
      evidence,
      blockers: [],
    };
  }

  const groups = [
    ["edge", asArray(sources.longestEdge)],
    ["area", asArray(sources.area)],
  ];

  for (const [kind, configuredSources] of groups) {
    if (!configuredSources.length) {
      blockers.push(blocker(
        "ATTRIBUTE_SOURCE_MISSING",
        kind === "edge"
          ? "当前类目未配置最长边商品属性，无法判定 1630/1631"
          : "当前类目未配置面积商品属性，无法判定 1630/1631",
      ));
      continue;
    }
    for (const source of configuredSources) {
      const resolved = resolveSource({
        fieldMap,
        assignments,
        source,
        kind,
      });
      if (resolved.error) blockers.push(resolved.error);
      if (resolved.evidence) evidence.push(resolved.evidence);
    }
  }

  if (blockers.length) {
    return {
      reportType: null,
      longestEdgeCm: null,
      areaM2: null,
      evidence,
      blockers,
    };
  }

  const edgeValues = evidence
    .filter((item) => item.normalizedUnit === "cm")
    .map((item) => item.normalizedValue);
  const areaValues = evidence
    .filter((item) => item.normalizedUnit === "m2")
    .map((item) => item.normalizedValue);
  const longestEdgeCm = Math.max(...edgeValues);
  const areaM2 = Math.max(...areaValues);

  return {
    reportType:
      longestEdgeCm <= 180 && areaM2 <= 2.16 ? "1631" : "1630",
    longestEdgeCm,
    areaM2,
    evidence,
    blockers: [],
  };
}
