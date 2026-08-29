function firstText(items, valueKey) {
  if (!Array.isArray(items)) return "";
  const preferred =
    items.find((item) => item?.language === "zh-cn") ||
    items.find((item) => item?.language === "en") ||
    items[0];
  return preferred?.[valueKey] || "";
}

function sumInventory(skuList) {
  return (skuList || []).reduce(
    (total, sku) =>
      total +
      (sku.inventoryList || []).reduce(
        (skuTotal, inventory) => skuTotal + Number(inventory.inventoryNum || 0),
        0,
      ),
    0,
  );
}

function salesAttributeText(items) {
  if (!Array.isArray(items)) return "";
  return items
    .map((item) => firstText(item?.attributeValueMultiList || [item], "attributeValueName"))
    .filter(Boolean)
    .join(" / ");
}

function skuCost(sku) {
  const row = Array.isArray(sku?.costList)
    ? sku.costList.find((item) => item?.currency && Number.isFinite(Number(item?.cost)))
    : null;
  return row ? { amount: Number(row.cost), currency: String(row.currency) } : null;
}

function categoryPathParts(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item || "").split(/[>/\\|]/u))
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstCategoryPath(spu) {
  return [
    spu?.categoryPath,
    spu?.categoryNamePath,
    spu?.categoryNames,
    spu?.categoryNameList,
    spu?.category?.path,
    spu?.category?.names,
    spu?.categoryInfo?.path,
    spu?.categoryInfo?.names,
  ].map(categoryPathParts).find((path) => path.length > 0) || [];
}

function firstImageUrl(skc) {
  const values = [
    skc?.imageUrl,
    skc?.mainImageUrl,
    skc?.main_image_url,
    skc?.mainPicUrl,
    skc?.mainPic,
    skc?.skcMainPicUrl,
    skc?.productImageUrl,
    skc?.imageList?.[0],
    skc?.images?.main?.[0],
  ];
  for (const value of values) {
    const candidate = typeof value === "object"
      ? value?.url || value?.imageUrl || value?.previewUrl
      : value;
    const text = String(candidate || "").trim();
    if (/^https?:\/\//iu.test(text)) return text;
  }
  return "";
}

export function normalizeProductSearch(info, exactSkc = "") {
  const products = [];
  for (const spu of info?.data || []) {
    for (const skc of spu.skcList || []) {
      if (exactSkc && skc.skcName !== exactSkc) continue;
      const skuList = skc.skuList || [];
      const title = firstText(skc.skcTitle, "title");
      const categoryPath = firstCategoryPath(spu);
      const categoryName = categoryPath.at(-1) || String(spu.categoryName || "").trim();
      const imageUrl = firstImageUrl(skc);
      const skuItems = skuList.map((sku) => ({
        skuCode: String(sku?.skuCode || ""),
        supplierSku: String(sku?.supplierSku || ""),
        size: salesAttributeText(sku?.skuSalesAttributeList) || String(sku?.supplierSku || ""),
        cost: skuCost(sku),
      }));
      products.push({
        id: skc.skcName,
        type: "product",
        skc: skc.skcName,
        spu: spu.spuName || "",
        name: title || skc.supplierCode || skc.skcName,
        image: imageUrl,
        imageUrl,
        categoryId: String(spu.categoryId || ""),
        category: categoryName || (spu.categoryId ? `类目 ${spu.categoryId}` : "类目未返回"),
        categoryName,
        categoryPath,
        variants: `${skuList.length} 个 SKU`,
        skuCount: skuList.length,
        supplierCode: skc.supplierCode || "",
        supplierSkus: skuList
          .map((sku) => sku.supplierSku)
          .filter(Boolean),
        skuCodes: skuList.map((sku) => sku.skuCode).filter(Boolean),
        skuItems,
        inventory: sumInventory(skuList),
        ...(skc?.sampleInfo && typeof skc.sampleInfo === "object"
          ? { sampleInfo: {
              reserveSampleFlag: skc.sampleInfo.reserveSampleFlag ?? null,
              spotFlag: skc.sampleInfo.spotFlag ?? null,
              sampleJudgeType: skc.sampleInfo.sampleJudgeType ?? null,
              sampleCode: String(skc.sampleInfo.sampleCode || "").trim(),
            } }
          : {}),
        // The product search response is not the authoritative source for the
        // user-facing shelf label. The exact SKC status is filled by
        // /goods-compliance/skc-label-list during the store refresh.
        state: "待同步",
        statusCode: null,
        statusSource: "unavailable",
        compliance: "待同步",
        template: "未建立",
        sales7: "—",
      });
    }
  }
  return products;
}

export function summarizeProductDetail(info, exactSkc = "") {
  const skcInfoList = Array.isArray(info?.skcInfoList) ? info.skcInfoList : [];
  const selectedSkc =
    skcInfoList.find((item) => item?.skcName === exactSkc) || skcInfoList[0] || null;
  return {
    categoryId: info?.categoryId ?? null,
    productTypeId: info?.productTypeId ?? null,
    brandCode: info?.brandCode || "",
    productName: firstText(info?.productMultiNameList, "productName"),
    productAttributeCount: Array.isArray(info?.productAttributeInfoList)
      ? info.productAttributeInfoList.length
      : 0,
    dimensionAttributeCount: Array.isArray(info?.dimensionAttributeInfoList)
      ? info.dimensionAttributeInfoList.length
      : 0,
    skcCount: skcInfoList.length,
    skuCount: Array.isArray(selectedSkc?.skuInfoList)
      ? selectedSkc.skuInfoList.length
      : 0,
  };
}
