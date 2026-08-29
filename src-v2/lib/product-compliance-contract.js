function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return String(value ?? "").trim();
}

function mediaAssetId(value) {
  const match = /^media:([^\s]+)$/i.exec(text(value));
  return match?.[1] || "";
}

function validDate(value) {
  const timestamp = Date.parse(text(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function buildProductComplianceStage({
  template = null,
  reportTemplate = null,
  categoryId = "",
  report = null,
  photoSourceMode = "template",
  manualPhotos = [],
  now = new Date(),
} = {}) {
  const blockers = [];
  const advisories = [];
  const postPublishTasks = [];
  const expectedReport = null;
  const manualPhotoMode = photoSourceMode === "manual";
  if (!template && !manualPhotoMode) {
    return {
      valid: true,
      blockers,
      advisories: [{
        code: "COMPLIANCE_TEMPLATE_NOT_SELECTED",
        message: "未引用店铺合规素材方案；不阻断建品，SKC 生成后再按 SHEIN 要求处理",
      }],
      postPublishTasks,
      expectedReport,
      reportMaterial: null,
      reportDate: null,
      photos: { body: null, bodyList: [], package: null, packageList: [] },
      manualQueue: ["gcc", "product_identifier"],
      assetIds: [],
      requiresSkcRevalidation: true,
    };
  }

  const data = object(template?.data);
  const defaults = object(data.defaults);
  if (!manualPhotoMode && (!data.storeScoped || !data.revalidateOnUse)) {
    advisories.push({
      code: "COMPLIANCE_TEMPLATE_POLICY_INVALID",
      message: "当前合规模板缺少店铺隔离或引用时重新校验标记",
    });
  }
  postPublishTasks.push({
    code: "WAITING_FOR_SHEIN_REPORT_REQUIREMENT",
    message: "SKC生成后读取SHEIN官方1630/1631要求，再补充对应报告与日期",
  });
  const reportMaterial = null;
  const reportDate = null;

  const photos = manualPhotoMode
    ? (Array.isArray(manualPhotos) ? manualPhotos : [])
    : (Array.isArray(defaults.photos) ? defaults.photos : []);
  const bodyPhotoCandidates = photos.filter(
    (item) => text(item?.labelGroup) === "1",
  );
  const packagePhotoCandidates = photos.filter(
    (item) => text(item?.labelGroup) === "2",
  );
  const readyPhotos = (candidates) => candidates
    .filter((item) => mediaAssetId(item?.localAssetRef))
    .filter((item, index, items) => items.findIndex((candidate) =>
      mediaAssetId(candidate?.localAssetRef) === mediaAssetId(item?.localAssetRef)
    ) === index)
    .slice(0, 15);
  const bodyPhotos = readyPhotos(bodyPhotoCandidates);
  const packagePhotos = readyPhotos(packagePhotoCandidates);
  const bodyPhoto = bodyPhotos[0] || null;
  const packagePhoto = packagePhotos[0] || null;
  if (!packagePhoto) {
    advisories.push({
      code: "PACKAGE_PHOTO_MISSING",
      message: manualPhotoMode
        ? "尚未手动上传商品包装实拍图"
        : "实拍图模板缺少商品包装实拍图",
    });
  }

  const assetIds = [
    ...(Array.isArray(reportMaterial?.files) ? reportMaterial.files : [])
      .map((file) => mediaAssetId(file?.localAssetRef)),
    ...bodyPhotos.map((photo) => mediaAssetId(photo?.localAssetRef)),
    ...packagePhotos.map((photo) => mediaAssetId(photo?.localAssetRef)),
  ].filter(Boolean);

  return {
    valid: true,
    blockers,
    advisories,
    postPublishTasks,
    expectedReport,
    reportMaterial,
    reportDate,
    photos: {
      body: bodyPhoto,
      bodyList: bodyPhotos,
      package: packagePhoto,
      packageList: packagePhotos,
    },
    manualQueue: ["gcc", "product_identifier"],
    assetIds: Array.from(new Set(assetIds)),
    requiresSkcRevalidation: true,
  };
}
