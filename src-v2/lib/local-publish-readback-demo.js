const DEMO_SPU = "DEMO-SPU-20260807";
const DEMO_VERSION = "DEMO-VERSION-20260807";

export const localPublishReadbackDemo = {
  mode: "local-field-demo",
  label: "本地字段演示",
  spuName: DEMO_SPU,
  version: DEMO_VERSION,
  warning:
    "本地字段演示，不是 SHEIN 平台回执；不会写入服务端、不会调用 SHEIN，也不会改变发布批次完成状态。",
};

function localCapability(capabilityKey) {
  return {
    capabilityKey,
    required: true,
    status: "unknown",
    editable: false,
    writeStatus: "unsupported_by_official_api",
    certificateTypeId: null,
    certificateTypeCode: capabilityKey === "gcc" ? "GCC" : "PRODUCT_IDENTIFIER",
    certificateTypeName: capabilityKey === "gcc" ? "GCC 信息" : "产品标识符",
  };
}

function localCompliance(skus) {
  const skcs = [
    {
      skcName: "DEMO-SKC-001",
      skuCodes: skus.slice(0, 2),
      report: {
        reportType: "1631",
        longestEdgeCm: 180,
        areaM2: 2.16,
      },
    },
    {
      skcName: "DEMO-SKC-002",
      skuCodes: skus.slice(2),
      report: {
        reportType: "1630",
        longestEdgeCm: 200,
        areaM2: 2.4,
      },
    },
  ].map((skc) => ({
    ...skc,
    capabilities: {
      gcc: localCapability("gcc"),
      product_identifier: localCapability("product_identifier"),
    },
    status: "blocked",
    blockers: [
      {
        code: "LOCAL_FIELD_DEMO_ONLY",
        message: "本地演示只验证字段链路，未提供真实 GCC 或产品标识符状态",
      },
    ],
  }));

  return {
    projectionVersion: "compliance-revalidation-v1",
    status: "blocked",
    completionEligible: false,
    spuName: DEMO_SPU,
    skcs,
    blockers: skcs.map((skc) => ({
      code: "LOCAL_FIELD_DEMO_ONLY",
      skcName: skc.skcName,
      message: "本地演示结果不能作为 SHEIN 合规完成依据",
    })),
    persistence: {
      receiptId: null,
      deduplicated: false,
    },
  };
}

export function runLocalPublishReadbackDemo({ spuName, version } = {}) {
  if (
    String(spuName || "").trim() !== DEMO_SPU ||
    String(version || "").trim() !== DEMO_VERSION
  ) {
    throw new Error("本地字段演示只接受页面提供的 DEMO-SPU 和 DEMO-VERSION");
  }

  const skuCodes = ["DEMO-SKU-001", "DEMO-SKU-002", "DEMO-SKU-003"];
  return {
    documentState: {
      projectionVersion: "product-document-state-v1",
      mode: "local-field-demo",
      externalWrite: false,
      projection: {
        eventFamily: "query-document-state",
        records: [
          {
            spuName: DEMO_SPU,
            skcName: "DEMO-SKC-001",
            skuCodes,
            documentSn: "DEMO-DOCUMENT-001",
            version: DEMO_VERSION,
            auditTime: "2026-08-07T00:00:00.000Z",
            auditState: 2,
            auditStateLabel: "passed",
            status: "passed",
            failedReasons: [],
          },
        ],
        persistence: null,
      },
      summary: {
        disposition: "read-only-document-state-projection",
        recordCount: 1,
        states: ["passed"],
        passedRecordCount: 1,
        failedRecordCount: 0,
      },
      diagnostics: {
        traceId: "local-field-demo-document-state",
        durationMs: 0,
      },
    },
    readback: {
      projectionVersion: "spu-readback-v1",
      mode: "local-field-demo",
      externalWrite: false,
      projection: {
        eventFamily: "goods/spu-info",
        spuName: DEMO_SPU,
        categoryId: "DEMO-CATEGORY",
        productTypeId: "DEMO-PRODUCT-TYPE",
        supplierCode: "DEMO-SUPPLIER-CODE",
        skcs: [
          {
            skcName: "DEMO-SKC-001",
            supplierCode: "DEMO-SUPPLIER-CODE-001",
            skuList: [
              { skuCode: "DEMO-SKU-001", supplierSku: "DEMO-SUPPLIER-SKU-001" },
              { skuCode: "DEMO-SKU-002", supplierSku: "DEMO-SUPPLIER-SKU-002" },
            ],
          },
          {
            skcName: "DEMO-SKC-002",
            supplierCode: "DEMO-SUPPLIER-CODE-002",
            skuList: [
              { skuCode: "DEMO-SKU-003", supplierSku: "DEMO-SUPPLIER-SKU-003" },
            ],
          },
        ],
        persistence: null,
      },
      summary: {
        disposition: "read-only-spu-relationship-readback",
        spuName: DEMO_SPU,
        skcCount: 2,
        skuCount: 3,
      },
      diagnostics: {
        traceId: "local-field-demo-spu-info",
        durationMs: 0,
      },
    },
    compliance: localCompliance(skuCodes),
  };
}
