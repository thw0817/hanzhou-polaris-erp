import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(
  new URL("../../src-v2/app/App.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../../src-v2/app/AppShell.tsx", import.meta.url),
  "utf8",
);
const productsSource = readFileSync(
  new URL("../../src-v2/features/operations/ProductsPage.tsx", import.meta.url),
  "utf8",
);
const editorSource = readFileSync(
  new URL("../../src-v2/features/publishing/NewProductPage.tsx", import.meta.url),
  "utf8",
);
const draftsSource = readFileSync(
  new URL("../../src-v2/features/publishing/ProductDraftsPage.tsx", import.meta.url),
  "utf8",
);
const imagesSource = readFileSync(
  new URL("../../src-v2/features/publishing/ProductImagesSection.tsx", import.meta.url),
  "utf8",
);
const watermarkSource = readFileSync(
  new URL("../../src-v2/lib/product-image-watermark.js", import.meta.url),
  "utf8",
);
const skuOcrSource = readFileSync(
  new URL("../../src-v2/lib/sku-image-ocr.js", import.meta.url),
  "utf8",
);
const folderImportSource = readFileSync(
  new URL("../../src-v2/features/publishing/ProductFolderImport.tsx", import.meta.url),
  "utf8",
);
const batchCreateSource = readFileSync(
  new URL("../../src-v2/features/publishing/BatchProductCreatePage.tsx", import.meta.url),
  "utf8",
);
const publishBatchesSource = readFileSync(
  new URL("../../src-v2/features/publishing/PublishBatchesPage.tsx", import.meta.url),
  "utf8",
);
const batchContractSource = readFileSync(
  new URL("../../src-v2/lib/batch-product-create-contract.js", import.meta.url),
  "utf8",
);
const complianceSource = readFileSync(
  new URL("../../src-v2/features/publishing/ProductComplianceSection.tsx", import.meta.url),
  "utf8",
);
const sizeTemplatesSource = readFileSync(
  new URL("../../src-v2/features/templates/SizeTemplatesPage.tsx", import.meta.url),
  "utf8",
);
const sizeTemplateContractSource = readFileSync(
  new URL("../../src-v2/lib/size-template-contract.js", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../../src-v2/lib/api.ts", import.meta.url),
  "utf8",
);
const operationsSharedSource = readFileSync(
  new URL("../../src-v2/features/operations/OperationsShared.tsx", import.meta.url),
  "utf8",
);

test("V2 exposes a single-product draft route and entry action", () => {
  assert.match(appSource, /NewProductPage/);
  assert.match(appSource, /path="operations\/:storeId\/products\/new"/);
  assert.match(shellSource, /path: "products\/new"/);
  assert.match(shellSource, /label: "新建商品"/);
});

test("V2 exposes a searchable draft list with a continue-editing route", () => {
  assert.match(appSource, /ProductDraftsPage/);
  assert.match(appSource, /path="operations\/:storeId\/products\/drafts"/);
  assert.match(shellSource, /path: "products\/drafts"/);
  assert.match(shellSource, /label: "商品草稿"/);
  assert.match(draftsSource, /api\.productDrafts/);
  assert.match(draftsSource, /搜索商品草稿/);
  assert.match(draftsSource, /继续编辑/);
  assert.match(draftsSource, /products\/new\?draft=/);
  assert.match(draftsSource, /待发布商品/);
  assert.doesNotMatch(draftsSource, /<option value="published">已发布<\/option>/);
  assert.doesNotMatch(draftsSource, /<option value="archived">已归档<\/option>/);
});

test("draft bulk workbench exposes explicit replacement mode", () => {
  assert.match(draftsSource, /重新引用（替换）/);
  assert.match(draftsSource, /replaceExistingTemplates/);
  assert.match(draftsSource, /确认重新引用/);
});

test("draft list refreshes stale blocked preflight snapshots in the background", () => {
  assert.match(draftsSource, /revalidateProductDrafts/);
  assert.match(draftsSource, /revalidatedStoreRef/);
});

test("primary navigation keeps review and operations ahead of product creation", () => {
  const navBlock = shellSource.match(/const navItems = \[([\s\S]*?)\n\];/)?.[1] || "";
  const labels = [...navBlock.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(labels, [
    "总览",
    "今日工作",
    "商品经营",
    "商品审核中心",
    "销量与库存",
    "经营预警",
    "合规工作台",
    "商品草稿",
    "批量建品",
    "新建商品",
  ]);
});

test("draft list exposes stable per-image thumbnails, full category labels, and delete actions", () => {
  assert.match(draftsSource, /mediaContentUrl/);
  assert.doesNotMatch(draftsSource, /mediaDownloadTicket/);
  assert.doesNotMatch(draftsSource, /useQueries/);
  assert.doesNotMatch(draftsSource, /"product-draft-thumbnails", mainAssetIds/);
  assert.match(draftsSource, /imageAssets/);
  assert.match(draftsSource, /categoryPath/);
  assert.match(draftsSource, /类目：/);
  assert.match(draftsSource, /批量删除/);
  assert.match(draftsSource, /archiveProductDrafts/);
  assert.match(draftsSource, /主图/);
  assert.match(draftsSource, /确认删除“\$\{draft\.name\}”吗/);
  assert.doesNotMatch(draftsSource, /释放空间/);
});

test("product creation surfaces the current store monthly publish quota", () => {
  assert.match(operationsSharedSource, /PublishQuotaNotice/);
  assert.match(operationsSharedSource, /本月剩余发品额度/);
  assert.match(draftsSource, /PublishQuotaNotice/);
  assert.match(editorSource, /PublishQuotaNotice/);
  assert.match(batchCreateSource, /PublishQuotaNotice/);
  assert.match(publishBatchesSource, /PublishQuotaNotice/);
  assert.match(apiSource, /platformAvailableLimit/);
  assert.match(apiSource, /localConsumedThisMonth/);
  assert.match(apiSource, /publishQuota/);
  assert.doesNotMatch(apiSource, /shelfQuota/);
  assert.doesNotMatch(publishBatchesSource, /query-shelf-quota|shelfQuota|上架额度/);
  assert.match(publishBatchesSource, /商家可用发品额度/);
});

test("store switching remounts scoped workspaces and keeps publish caches isolated", () => {
  assert.match(shellSource, /<Outlet[\s\S]{0,220}key=\{storeId \|\| "workspace-without-store"\}/);
  assert.match(shellSource, /搜索店铺名称或 ID/);
  assert.match(draftsSource, /queryKey: \["store", queryScope, storeId, "product-drafts", "draft-box"\]/);
  assert.match(editorSource, /queryKey: \["store", queryScope, storeId, "product-drafts"\]/);
  assert.match(publishBatchesSource, /const queryScope = `\$\{session\.tenant\.id\}:\$\{session\.user\.id\}`/);
  assert.match(publishBatchesSource, /queryKey: \["store", queryScope, storeId, "product-drafts"\]/);
  assert.match(publishBatchesSource, /queryKey: \["store", queryScope, storeId, "publish-batches"\]/);
  assert.match(publishBatchesSource, /\["store", queryScope, storeId, "publish-batches"\]/);
  assert.doesNotMatch(publishBatchesSource, /\["publish-batches", storeId\]/);
});

test("new product page hydrates a saved draft without auto-saving or publishing", () => {
  assert.match(editorSource, /useSearchParams/);
  assert.match(editorSource, /draftQueryId/);
  assert.match(editorSource, /hydrateProductDraft/);
  assert.match(editorSource, /mediaContentUrl/);
  assert.doesNotMatch(editorSource, /mediaDownloadTicket/);
  assert.match(editorSource, /已载入商品草稿/);
  assert.doesNotMatch(editorSource, /hydrateProductDraft[\s\S]{0,600}saveDraft\.mutate/);
  assert.match(editorSource, /api\.productDrafts\(storeId, \{ includePublishHistory: true \}\)/);
});

test("a draft opened from a failed batch can return to that scoped batch", () => {
  assert.match(editorSource, /returnBatchId/);
  assert.match(editorSource, /searchParams\.get\("returnBatch"\)/);
  assert.match(editorSource, /返回原发布批次/);
  assert.match(editorSource, /publishing\?batch=/);
  assert.doesNotMatch(editorSource, /returnBatchId[\s\S]{0,300}runAction\("retry"\)/);
});

test("new product page uses live category and attribute APIs", () => {
  assert.match(editorSource, /publishCategories/);
  assert.match(editorSource, /publishSchema/);
  assert.match(editorSource, /attributeTemplates/);
  assert.match(editorSource, /sizeTemplates/);
  assert.match(editorSource, /packagingTemplates/);
  assert.match(editorSource, /tailImageTemplates/);
  assert.match(editorSource, /normalizeCategoryTree/);
  assert.match(editorSource, /categoryColumns\.map/);
  assert.match(editorSource, /categorySearch/);
  assert.match(editorSource, /visibleLeafCategories/);
  assert.match(editorSource, /搜索商品末级类目/);
  assert.match(editorSource, /没有匹配的末级类目/);
  assert.match(editorSource, /Category ID 或 Product Type ID/);
  assert.match(editorSource, /categoryId: category\?\.categoryId/);
  assert.match(editorSource, /productTypeId: category\?\.productTypeId/);
  assert.match(editorSource, /required: field\.required/);
  assert.match(editorSource, /modeCode: field\.modeCode/);
  assert.match(editorSource, /maxSelections: field\.maxSelections/);
  assert.match(editorSource, /ruleInfoList: field\.ruleInfoList/);
  assert.match(editorSource, /associatedRulesCheckedAt/);
});

test("new product page composes product images from live picture rules and append-only tail templates", () => {
  assert.match(editorSource, /buildProductImageStage/);
  assert.match(editorSource, /picture_config_list/);
  assert.match(editorSource, /pictureConfig/);
  assert.match(editorSource, /tailImageTemplateId/);
  assert.match(editorSource, /imageAssets/);
  assert.match(editorSource, /orderedTailTemplateImages/);
  assert.match(imagesSource, /商品图片/);
  assert.match(imagesSource, /上传商品主图/);
  assert.match(imagesSource, /商品通用轮播图/);
  assert.match(imagesSource, /SKC 方块图（image_type=5）/);
  assert.match(imagesSource, /方块图裁剪/);
  assert.match(imagesSource, /SKC 色块图（image_type=6）/);
  assert.match(imagesSource, /从主图取色块/);
  assert.match(imagesSource, /onSwatchImagesChange/);
  assert.match(imagesSource, /可多张/);
  assert.match(imagesSource, /moveMain/);
  assert.match(imagesSource, /uploadProductImage/);
  assert.match(imagesSource, /absolute right-1 top-1/);
  assert.match(imagesSource, /删除\$\{label\}/);
  assert.match(imagesSource, /siteDetailAllowed/);
  assert.doesNotMatch(imagesSource, /uploadFiles\(event, "description"\)/);
  assert.doesNotMatch(imagesSource, /上传站点详情图/);
  assert.match(imagesSource, /Promise\.allSettled/);
  assert.match(imagesSource, /failures\.length/);
  assert.match(apiSource, /uploadProductImage/);
  assert.match(batchCreateSource, /imageAssets: \{ main, detail: carousel, square, description: \[\], tail \}/);
  assert.doesNotMatch(batchCreateSource, /carousel\.push\(\.\.\.selectedTailAssets/);
  assert.match(batchCreateSource, /const removeEntry/);
  assert.match(batchCreateSource, /删除\$\{entry\.file\.name\}/);
  assert.match(batchCreateSource, /flex max-h-\[92vh\]/);
  assert.match(batchCreateSource, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(batchCreateSource, /flex shrink-0 flex-wrap[\s\S]*border-t/);
});

test("single-product editor keeps folder import out of the duplicate image stage", () => {
  assert.doesNotMatch(editorSource, /ProductFolderImport/);
  assert.doesNotMatch(editorSource, /applyFolderImport/);
  assert.match(folderImportSource, /导入素材文件夹/);
  assert.match(folderImportSource, /webkitdirectory/);
  assert.match(folderImportSource, /未分配（不导入）/);
  assert.match(folderImportSource, /未标记用途的图片默认作为商品主图/);
  assert.match(folderImportSource, /保存为商品草稿素材/);
  assert.match(folderImportSource, /api\.uploadProductImage/);
  assert.match(folderImportSource, /api\.uploadSkuImage/);
  assert.doesNotMatch(folderImportSource, /publishProduct|executePublish/);
});

test("single-product attributes use a compact required-first layout", () => {
  assert.match(editorSource, /sortAttributeFields/);
  assert.match(editorSource, /orderedAttributeFields/);
  assert.match(editorSource, /orderedAttributeFields\.map/);
  assert.match(editorSource, /制作工艺\|织造方式/);
  assert.match(editorSource, /px-3 py-2\.5/);
  assert.match(editorSource, /lg:grid-cols-\[170px_minmax\(0,1fr\)\]/);
});

test("size labels normalize legacy 件 units and the swatch picker follows the pointer", () => {
  assert.match(sizeTemplateContractSource, /(?:pc\\b|件|个)/);
  assert.match(imagesSource, /imagePointFromPointer/);
  assert.match(imagesSource, /onMouseMove/);
  assert.match(imagesSource, /确认取色并上传/);
  assert.match(imagesSource, /onPointerMove/);
  assert.match(imagesSource, /主图读取失败/);
  assert.match(imagesSource, /重试读取主图/);
  assert.match(editorSource, /setSwatchImages\(attachStablePreview/);
});

test("multi-product material roots create confirmed local draft shells only", () => {
  assert.match(folderImportSource, /buildProductFolderDraftShell/);
  assert.match(folderImportSource, /批量草稿队列/);
  assert.match(folderImportSource, /summarizeBatchGroup\(group, \{[\s\S]{0,220}existingDetailCount/);
  assert.match(folderImportSource, /我确认只创建商品草稿，不发布 SHEIN/);
  assert.match(folderImportSource, /api\.saveProductDraft/);
  assert.match(folderImportSource, /前往商品草稿/);
  assert.match(folderImportSource, /逐个商品继续补充类目、属性和 SKU/);
  assert.doesNotMatch(folderImportSource, /complianceTemplateId/);
});

test("batch product creation exposes a per-SKC overview and second-level editor handoff", () => {
  assert.match(appSource, /BatchProductCreatePage/);
  assert.match(appSource, /path="operations\/:storeId\/products\/batch-new"/);
  assert.match(shellSource, /path: "products\/batch-new"/);
  assert.match(batchCreateSource, /webkitdirectory/);
  assert.match(batchCreateSource, /批量商品总表/);
  assert.match(batchCreateSource, /SKU尺寸与预览图/);
  assert.match(batchCreateSource, /每平方米供货价/);
  assert.match(batchCreateSource, /每平方米克重/);
  assert.match(batchCreateSource, /通用轮播图/);
  assert.match(batchCreateSource, /主图满屏水印/);
  assert.match(batchCreateSource, /二级编辑/);
  assert.match(batchCreateSource, /删除已选/);
  assert.match(batchCreateSource, /titleRuleTemplates/);
  assert.match(batchCreateSource, /tailImageTemplates/);
  assert.match(batchCreateSource, /api\.publishSchema\(storeId/);
  assert.match(batchCreateSource, /default_language_title_max_length/);
  assert.match(batchCreateSource, /buildBatchDraftName\(productTitle/);
  assert.match(batchCreateSource, /SHEIN标题/);
  assert.doesNotMatch(batchCreateSource, /products\/new\?draft=/);
  assert.doesNotMatch(batchCreateSource, /批量建品工作台/);
  assert.doesNotMatch(batchCreateSource, /每个商品文件夹对应一个 SKC；批量表只展示/);
  assert.doesNotMatch(batchCreateSource, /模板只用于当前商品草稿/);
  assert.doesNotMatch(batchCreateSource, /批量方块图/);
  assert.doesNotMatch(batchCreateSource, /大于 3MB 的图片自动压缩/);
  assert.doesNotMatch(batchCreateSource, /属性和合规详情/);
  assert.doesNotMatch(batchCreateSource, /complianceTemplates|complianceTemplateId|合规模板/);
  assert.match(batchCreateSource, /商品模板/);
  assert.match(batchCreateSource, /SKU参数/);
  assert.match(batchCreateSource, /variant="danger"/);
  assert.match(batchCreateSource, /批量引用 · \{selectedCount\} 个商品/);
  assert.match(batchCreateSource, /watermarkExpanded/);
  assert.match(batchCreateSource, /aria-expanded=\{watermarkExpanded\}/);
  assert.match(batchCreateSource, /水印文案/);
  assert.match(batchCreateSource, /仅应用到已选商品/);
  assert.match(batchContractSource, /buildBatchSkuRows/);
  assert.match(batchContractSource, /mapBatchSkuPreviews/);
  assert.match(batchContractSource, /applyBatchAttributeTemplate/);
  assert.match(batchContractSource, /reorderBatchImages/);
  assert.match(batchCreateSource, /商品属性/);
  assert.match(batchCreateSource, /SKU与包装/);
  assert.match(batchCreateSource, /打包体积（长×宽×高 cm）/);
  assert.match(batchCreateSource, /选择预览图/);
  assert.match(batchCreateSource, /SKU预览图放大/);
  assert.match(batchCreateSource, /tailImagePreviewUrl/);
  assert.match(batchCreateSource, /draggable/);
  assert.match(batchCreateSource, /data-batch-image-panel/);
});

test("batch creation saves once and hands ready drafts to the review center", () => {
  assert.match(batchCreateSource, /保存并前往发布/);
  assert.match(batchCreateSource, /group\.savedDraftId && !group\.dirty/);
  assert.match(batchCreateSource, /api\.revalidateProductDrafts\(\s*storeId,[\s\S]*?\{ force: true \}/);
  assert.match(batchCreateSource, /refreshedById/);
  assert.match(batchCreateSource, /dirty: false/);
  assert.match(batchCreateSource, /tone: "danger"/);
  assert.match(batchCreateSource, /source: "product-drafts"/);
  assert.match(publishBatchesSource, /consumePublishBatchHandoff/);
  assert.match(publishBatchesSource, /setSelectedIds\(handoff\.readyDraftIds\)/);
});

test("new product page uses the live default language for title without a description field", () => {
  assert.match(editorSource, /buildProductContentStage/);
  assert.match(editorSource, /default_language/);
  assert.match(editorSource, /default_language_title_max_length/);
  assert.match(editorSource, /multiLanguageNameList/);
  assert.doesNotMatch(editorSource, /商品描述（选填）/);
  assert.match(editorSource, /fill_in_standard_list/);
});

test("new product page builds SKU rows only from templates and the live sale schema", () => {
  assert.match(editorSource, /buildSaleAttributeSchema/);
  assert.match(editorSource, /buildSkuStageFromSizeTemplate/);
  assert.match(editorSource, /salesSchemaSnapshot/);
  assert.match(editorSource, /mainAttributeStatus: saleSchema\.mainAttributeStatus/);
  assert.match(editorSource, /fields: saleSchema\.fields/);
  assert.match(editorSource, /publishStandardSnapshot/);
  assert.match(editorSource, /currency/);
});

test("shared color supports official matching and permitted SHEIN custom values", () => {
  assert.match(editorSource, /resolveMainSaleAttributeValue/);
  assert.match(editorSource, /输入或选择当前类目的颜色/);
  assert.match(editorSource, /list="shein-main-color-values"/);
  assert.match(editorSource, /按 SHEIN 自定义销售属性值提交/);
  assert.match(editorSource, /当前类目不允许自定义该销售属性值/);
  assert.doesNotMatch(editorSource, /请选择当前类目的官方值/);
});

test("new product page batch-applies price, weight and inventory but keeps row editing", () => {
  assert.match(editorSource, /applyPricePerSquareMeter/);
  assert.match(editorSource, /applyGramsPerSquareMeter/);
  assert.match(editorSource, /applyInventoryToAll/);
  assert.match(editorSource, /直接填写计价与克重/);
  assert.match(editorSource, /一键填充全部 SKU 供货价/);
  assert.match(editorSource, /一键填充全部 SKU 重量/);
  assert.doesNotMatch(editorSource, /管理计价模板/);
  assert.doesNotMatch(editorSource, /零售价/);
  assert.match(editorSource, /一键应用库存/);
  assert.match(editorSource, /weightSource: "manual"/);
});

test("new product page maps multiple validated SKU preview images without upload-order guessing", () => {
  assert.match(editorSource, /applySupplierSkuPrefix/);
  assert.doesNotMatch(editorSource, /一键生成SKU货号/);
  assert.match(editorSource, /applySharedSkuImage/);
  assert.match(editorSource, /autoMapSkuPreviewImages/);
  assert.match(editorSource, /assignSkuPreviewImage/);
  assert.match(editorSource, /uploadSkuImage/);
  assert.match(editorSource, /validatePublishImage/);
  assert.match(editorSource, /上传预览图/);
  assert.match(editorSource, /智能匹配SKU预览图/);
  assert.match(editorSource, /const sourceImages = mainImages/);
  assert.match(editorSource, /从商品主图识别并匹配/);
  assert.doesNotMatch(editorSource, /上传后优先识别图片中的尺寸文字进行匹配/);
  assert.match(editorSource, /按图片文字匹配尺寸/);
  assert.match(editorSource, /Promise\.allSettled/);
  assert.match(editorSource, /failures\.length/);
  assert.match(editorSource, /ensureSupplierSkuRows/);
  assert.match(editorSource, /图片文字/);
  assert.match(editorSource, /autoMapSkuPreviewImagesByOcr/);
  assert.match(editorSource, /recognizeSkuImageText/);
  assert.match(editorSource, /skuPickerRowId/);
  assert.match(editorSource, /SkuPreviewImageDialog/);
  assert.match(editorSource, /sku-preview-dialog/);
  assert.match(editorSource, /sku-preview-dialog-canvas/);
  assert.match(editorSource, /sku-preview-dialog-option-thumb/);
  assert.match(editorSource, /SKU预览图放大/);
  assert.doesNotMatch(editorSource, /sku-preview-options/);
  assert.match(editorSource, /mainAssetIds\.indexOf/);
  assert.match(editorSource, /文件名\/尺寸回退/);
  assert.doesNotMatch(editorSource, /引用第一张主图到全部 SKU/);
  assert.doesNotMatch(editorSource, /引用第一张主图/);
  assert.match(skuOcrSource, /TextDetector/);
  assert.match(skuOcrSource, /per_sku_ocr/);
  assert.match(editorSource, /sku-contract-table/);
  assert.doesNotMatch(editorSource, /成品长宽/);
  assert.doesNotMatch(editorSource, /打包长宽高/);
  assert.doesNotMatch(editorSource, /匹配状态/);
  assert.match(editorSource, /SKU与包装有/);
  assert.doesNotMatch(editorSource, /1630\/1631 预判/);
  const skuTableSource = editorSource.slice(editorSource.indexOf("sku-contract-table"));
  assert.doesNotMatch(skuTableSource, />商家SKU</);
  assert.match(editorSource, /压缩并上传SKU预览图/);
  assert.match(editorSource, /超过3MB/);
  assert.doesNotMatch(editorSource, /SHEIN SKU字段片段/);
  assert.match(apiSource, /uploadSkuImage/);
});

test("new product page uses compact generated SKC codes and removes the redundant draft status card", () => {
  assert.match(editorSource, /defaultSupplierCode/);
  assert.match(editorSource, /家居-地毯-0822001/);
  assert.doesNotMatch(editorSource, /草稿阶段状态/);
});

test("size template editor uses the small-edge-first dimension convention", () => {
  assert.match(sizeTemplatesSource, /小边×大边保存/);
  assert.match(sizeTemplatesSource, /小边（cm）/);
  assert.match(sizeTemplatesSource, /大边（cm）/);
});

test("main product images support configurable full-screen watermark replacement", () => {
  assert.match(imagesSource, /主图满屏水印/);
  assert.match(imagesSource, /水印英文内容/);
  assert.match(imagesSource, /水印大小/);
  assert.match(imagesSource, /水印深浅/);
  assert.match(imagesSource, /一键应用并替换主图/);
  assert.match(imagesSource, /恢复原图/);
  assert.match(imagesSource, /主图后追加/);
  assert.match(imagesSource, /applyWatermarkToFile/);
  assert.match(imagesSource, /localStorage/);
  assert.match(imagesSource, /shein-product-watermark-options-v1/);
  assert.match(watermarkSource, /tileContext\.rotate/);
  assert.match(watermarkSource, /createPattern/);
  assert.match(watermarkSource, /toBlob/);
});

test("new product page supports template or multi-image manual compliance photos without inventing SKC-only fields", () => {
  assert.match(editorSource, /complianceTemplates/);
  assert.match(editorSource, /buildProductComplianceStage/);
  assert.match(editorSource, /complianceTemplateSnapshot/);
  assert.match(editorSource, /requiresSkcRevalidation: true/);
  assert.doesNotMatch(editorSource, /\(Boolean\(category\) && !complianceStage\.valid\)/);
  assert.match(complianceSource, /实拍图模板（可选）/);
  assert.match(complianceSource, /暂不引用（不阻断发布）/);
  assert.match(complianceSource, /商品实拍图/);
  assert.match(complianceSource, /管理实拍图模板/);
  assert.match(complianceSource, /GCC/);
  assert.match(complianceSource, /产品标识符/);
  assert.match(complianceSource, /SKC生成后读取官方必填状态/);
  assert.match(complianceSource, /引用模板/);
  assert.match(complianceSource, /手动上传/);
  assert.match(complianceSource, /商品本体实拍图/);
  assert.match(complianceSource, /商品包装实拍图/);
  assert.match(complianceSource, /最多15张/);
  assert.match(complianceSource, /multiple/);
  assert.match(editorSource, /uploadComplianceEvidence/);
  assert.match(editorSource, /compliancePhotoAssignments/);
  assert.doesNotMatch(complianceSource, /商品本体实拍图（建品时不引用）/);
  assert.doesNotMatch(complianceSource, /建品阶段只引用包装实拍图/);
  assert.match(complianceSource, /等待 SKC 生成后由 SHEIN 返回/);
  assert.doesNotMatch(complianceSource, /完成商品属性后自动判定/);
});

test("new product page uses fixed full-managed publish defaults without a settings section", () => {
  assert.match(editorSource, /buildProductPublishSettingsStage/);
  assert.match(editorSource, /publishSettingsStage/);
  assert.match(editorSource, /businessModeSnapshot/);
  assert.match(editorSource, /DEFAULT_PRODUCT_PUBLISH_SETTINGS/);
  assert.match(editorSource, /!publishSettingsStage\.valid/);
  assert.doesNotMatch(editorSource, /ProductPublishSettingsSection/);
  assert.doesNotMatch(editorSource, /draft-product-publish-settings/);
});

test("large multi-select product attributes remain searchable without dropping schema values", () => {
  assert.match(editorSource, /field\.values\.length >= 20/);
  assert.match(editorSource, /搜索属性值/);
  assert.match(editorSource, /visibleOptions = normalizedQuery/);
  assert.match(editorSource, /当前显示 \{visibleOptions\.length\} \/ \{field\.values\.length\} 个官方值/);
  assert.match(editorSource, /已选 \{selected\.size\}/);
  assert.match(editorSource, /field\.maxSelections > 0 && selected\.size >= field\.maxSelections/);
  assert.match(editorSource, /optionPickerOpen/);
  assert.match(editorSource, /输入搜索并下拉选择/);
  assert.match(editorSource, /不要输入 %/);
});

test("new product page waits for SHEIN instead of classifying 1630 or 1631", () => {
  assert.doesNotMatch(editorSource, /classifyRugReportFromProductAttributes/);
  assert.match(editorSource, /rugReportSources/);
  assert.match(editorSource, /attributeValues/);
  assert.match(complianceSource, /等待 SKC 生成后由 SHEIN 返回/);
  assert.doesNotMatch(editorSource, /1630\/1631 预判/);
  assert.doesNotMatch(editorSource, /sizeRows/);
});

test("new product page refreshes schema coverage after the selected live schema loads", () => {
  assert.match(editorSource, /schema\.dataUpdatedAt/);
  assert.match(editorSource, /void schemaCoverage\.refetch\(\)/);
});

test("new product page saves an explicit blocked or draft state with feedback", () => {
  assert.match(apiSource, /productDrafts:/);
  assert.match(apiSource, /saveProductDraft:/);
  assert.match(editorSource, /统一保存当前草稿/);
  assert.match(editorSource, /正在保存草稿/);
  assert.match(editorSource, /aria-live="polite"/);
  assert.match(editorSource, /保存前检查未通过/);
  assert.match(editorSource, /定位：\{field\.name\}/);
  assert.match(editorSource, /aria-invalid=\{invalid\}/);
  assert.match(editorSource, /focusAttribute/);
  assert.match(editorSource, /const saveBlockers = \[\.\.\.formBlockers\]/);
  assert.match(editorSource, /\(Boolean\(category\) && !skuValidation\.valid\)/);
  assert.match(editorSource, /\(Boolean\(category\) && !imageStage\.valid\)/);
  assert.match(editorSource, /status: draftBlocked \? "blocked" as const : "draft" as const/);
  assert.match(editorSource, /draft\.preflight\.attributes/);
  assert.match(editorSource, /draft\.preflight\.publishCandidate/);
  assert.match(editorSource, /可审计发布候选快照/);
  assert.match(editorSource, /发布候选快照/);
  assert.match(editorSource, /window\.history\.replaceState/);
  assert.match(editorSource, /nextParams\.set\("draft", draft\.id\)/);
  assert.match(editorSource, /nextParams\.set\("returnBatch", returnBatchId\)/);
});

test("new product page keeps the editor open while template managers open separately", () => {
  assert.match(editorSource, /const openTemplateManager/);
  assert.match(editorSource, /window\.open\(path, "_blank", "noopener,noreferrer"\)/);
  assert.doesNotMatch(editorSource, /管理发布设置模板（新标签页）/);
  assert.match(editorSource, /onOpenTemplates=\{\(\) => openTemplateManager/);
});

test("V2 product draft list previews and confirms safe local batch template reuse", () => {
  assert.match(draftsSource, /planBulkDraftTemplateApplication/);
  assert.match(draftsSource, /批量套模板/);
  assert.match(draftsSource, /预览批量套用/);
  assert.match(draftsSource, /我确认只修改商品草稿，不发布 SHEIN/);
  assert.match(draftsSource, /api\.saveProductDraft/);
  assert.match(draftsSource, /titleRuleTemplates/);
  assert.doesNotMatch(draftsSource, /commercialTemplates/);
  assert.doesNotMatch(draftsSource, /publishSettingsTemplates/);
  assert.match(draftsSource, /packagingTemplates/);
  assert.match(draftsSource, /tailImageTemplates/);
  assert.match(draftsSource, /attributeTemplates/);
  assert.match(draftsSource, /sizeTemplates/);
  assert.match(draftsSource, /api\.publishSchema/);
  assert.match(draftsSource, /商品属性和颜色尺寸只填充对应空草稿/);
  assert.match(draftsSource, /为空草稿生成商家 SKC\/SKU 货号/);
  assert.match(draftsSource, /统一库存（只填空值）/);
  assert.match(draftsSource, /按完整货号或唯一尺寸匹配候选图/);
  assert.doesNotMatch(draftsSource, /complianceTemplates/);
});

test("selected draft handoff performs a forced server revalidation before entering the review center", () => {
  assert.match(draftsSource, /buildPublishBatchHandoff/);
  assert.match(draftsSource, /进入商品审核中心/);
  assert.match(draftsSource, /api\.revalidateProductDrafts\(storeId, ids, \{ force: true \}\)/);
  assert.match(draftsSource, /const refreshedHandoff = buildPublishBatchHandoff/);
  assert.match(draftsSource, /state: refreshedHandoff\.state/);
  assert.match(draftsSource, /需先修正或完成保存/);
  assert.doesNotMatch(draftsSource, /createPublishBatch/);
});

test("product drafts prioritize server blockers and deep-link to the owning editor section", () => {
  assert.match(draftsSource, /sortProductDraftsByActionPriority/);
  assert.match(draftsSource, /collectProductDraftIssues/);
  assert.match(draftsSource, /待处理分组/);
  assert.match(draftsSource, /处理首个问题/);
  assert.match(draftsSource, /section=/);
  assert.match(editorSource, /requestedDraftSection/);
  assert.match(editorSource, /productDraftSectionAnchor/);
  assert.match(editorSource, /schema\.isFetching \|\| schemaCoverage\.isFetching/);
  assert.match(editorSource, /scrollIntoView/);
});
