import { buildPublishImagePlan } from "../../src/lib/shein-publish-draft.js";
import { resolveProductDetailPictureRule } from "./product-content-contract.js";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizeAsset(asset) {
  const source = asObject(asset);
  const id = String(source.assetId || source.id || "").trim();
  return {
    ...source,
    id,
    originalName: String(source.originalName || source.name || ""),
  };
}

export function orderedTailTemplateImages(template) {
  const data = asObject(template?.data);
  const assets = (Array.isArray(data.assets) ? data.assets : [])
    .map(normalizeAsset)
    .filter((asset) => asset.id);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const orderedIds = Array.isArray(data.assetIds)
    ? data.assetIds.map(String).filter(Boolean)
    : [];
  return orderedIds.length
    ? orderedIds.map((id) => byId.get(id)).filter(Boolean)
    : assets;
}

function blockerCode(message) {
  if (message.includes("缺少商品主图")) return "PRODUCT_MAIN_IMAGE_REQUIRED";
  if (message.includes("不允许提交细节图")) {
    return "PRODUCT_DETAIL_IMAGES_NOT_ALLOWED";
  }
  if (message.includes("要求至少一张细节图")) {
    return "PRODUCT_DETAIL_IMAGE_REQUIRED";
  }
  if (message.includes("细节图最多10张")) return "PRODUCT_DETAIL_IMAGE_LIMIT";
  return "PRODUCT_IMAGE_PLAN_INVALID";
}

export function buildProductImageStage({
  mainImages = [],
  detailImages = [],
  squareImages = [],
  swatchImages = [],
  descriptionImages = [],
  tailTemplate = null,
  pictureConfig = [],
  fillInStandard = [],
} = {}) {
  const main = mainImages.map(normalizeAsset);
  const detail = detailImages.map(normalizeAsset);
  const square = squareImages.map(normalizeAsset).slice(0, 1);
  const description = descriptionImages.map(normalizeAsset);
  const tail = orderedTailTemplateImages(tailTemplate);
  const config = Array.isArray(pictureConfig) ? pictureConfig : [];
  const detailPictureRule = resolveProductDetailPictureRule(fillInStandard);
  const plan = buildPublishImagePlan({
    product: { main, detail, square, swatch: swatchImages.map(normalizeAsset), description },
    tailTemplate: tailTemplate
      ? { id: tailTemplate.id, name: tailTemplate.name, images: tail }
      : null,
    pictureConfig: config,
  });
  const galleryLevel = plan.isSpuPic ? "spu" : "skc";
  const detailShow = config.find(
    (item) => item?.field_key === `${galleryLevel}_image_detail_show`,
  );
  const detailRequired = config.find(
    (item) => item?.field_key === `${galleryLevel}_image_detail_required`,
  );
  const blockers = plan.blockers.map((message) => ({
    code: blockerCode(message),
    message,
  }));

  if ([...main, ...detail, ...square, ...swatchImages.map(normalizeAsset), ...tail].some((asset) => !asset.id)) {
    blockers.push({
      code: "PRODUCT_IMAGE_ASSET_INVALID",
      message: "商品图片包含无效的对象存储素材ID",
    });
  }
  if (tailTemplate && asObject(tailTemplate.data).placement !== "append") {
    blockers.push({
      code: "TAIL_IMAGE_TEMPLATE_INVALID",
      message: "尾部主图模板不是追加模式，不能用于当前商品",
    });
  }
  if (!detailPictureRule.show && description.length) {
    blockers.push({
      code: "SITE_DETAIL_IMAGES_NOT_ALLOWED",
      message: "当前类目的SHEIN发布规范不允许提交站点详情图",
    });
  }
  if (detailPictureRule.required && !description.length) {
    blockers.push({
      code: "SITE_DETAIL_IMAGE_REQUIRED",
      message: "当前类目至少需要1张站点详情图",
    });
  }
  if (description.length > 10) {
    blockers.push({
      code: "SITE_DETAIL_IMAGE_LIMIT",
      message: `站点详情图最多10张，当前${description.length}张`,
    });
  }
  if (description.some((asset) => !asset.id)) {
    blockers.push({
      code: "SITE_DETAIL_IMAGE_ASSET_INVALID",
      message: "站点详情图包含无效的对象存储素材ID",
    });
  }

  return {
    valid: blockers.length === 0,
    scheme: plan.scheme,
    isSpuPic: plan.isSpuPic,
    rules: {
      detailAllowed: detailShow?.is_true !== false,
      detailRequired: detailRequired?.is_true === true,
      siteDetailRuleReturned: detailPictureRule.returned,
      siteDetailAllowed: detailPictureRule.show,
      siteDetailRequired: detailPictureRule.required,
      siteDetailFieldKey: detailPictureRule.fieldKey,
    },
    uploads: plan.uploads,
    blockers,
    counts: {
      main: main.length,
      productDetail: detail.length,
      square: square.length,
      swatch: swatchImages.length,
      tail: tail.length,
      detailTotal: detail.length + tail.length,
      siteDetail: description.length,
    },
  };
}
