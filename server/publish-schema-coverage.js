function walkCategoryTree(nodes, path = [], result = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const categoryId = String(node?.category_id || "").trim();
    const productTypeId = String(node?.product_type_id || "").trim();
    if (!categoryId) continue;
    const nextPath = [
      ...path,
      String(node?.category_name || categoryId).trim(),
    ];
    if (node?.last_category && productTypeId) {
      result.push({
        categoryId,
        productTypeId,
        name: nextPath.at(-1) || categoryId,
        path: nextPath,
      });
      continue;
    }
    walkCategoryTree(node?.children, nextPath, result);
  }
  return result;
}

export function flattenPublishCategoryLeaves(info = {}) {
  return walkCategoryTree(info.data);
}

export function buildPublishSchemaCoverage({
  categoryInfo = {},
  attributeSnapshots = [],
  publishStandardSnapshots = [],
} = {}) {
  const attributesByProductType = new Map(
    attributeSnapshots.map((snapshot) => [
      String(snapshot.productTypeId || snapshot.product_type_id || ""),
      snapshot,
    ]),
  );
  const standardsByCategory = new Map(
    publishStandardSnapshots.map((snapshot) => [
      String(snapshot.categoryId || snapshot.category_id || ""),
      snapshot,
    ]),
  );
  const categories = flattenPublishCategoryLeaves(categoryInfo).map((leaf) => {
    const attribute = attributesByProductType.get(leaf.productTypeId);
    const standard = standardsByCategory.get(leaf.categoryId);
    const attributeReady = Boolean(attribute?.fresh !== false && attribute);
    const publishStandardReady = Boolean(standard?.fresh !== false && standard);
    return {
      ...leaf,
      attributeReady,
      publishStandardReady,
      ready: attributeReady && publishStandardReady,
      attributeFetchedAt: attribute?.fetchedAt || null,
      publishStandardFetchedAt: standard?.fetchedAt || null,
    };
  });
  const ready = categories.filter((category) => category.ready).length;
  return {
    categories,
    summary: {
      total: categories.length,
      ready,
      pending: categories.length - ready,
      attributeReady: categories.filter((category) => category.attributeReady).length,
      publishStandardReady: categories.filter((category) => category.publishStandardReady).length,
    },
  };
}
