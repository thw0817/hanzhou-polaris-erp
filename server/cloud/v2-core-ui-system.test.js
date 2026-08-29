import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageSource = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
const primitivesSource = readFileSync(
  new URL("../../src-v2/components/operations/OperationsPrimitives.tsx", import.meta.url),
  "utf8",
);
const tableSource = readFileSync(
  new URL("../../src-v2/components/operations/OperationsDataTable.tsx", import.meta.url),
  "utf8",
);
const complianceSource = readFileSync(
  new URL("../../src-v2/features/compliance/CompliancePage.tsx", import.meta.url),
  "utf8",
);
const publishingSource = readFileSync(
  new URL("../../src-v2/features/publishing/PublishBatchesPage.tsx", import.meta.url),
  "utf8",
);
const batchCreateSource = readFileSync(
  new URL("../../src-v2/features/publishing/BatchProductCreatePage.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(new URL("../../src-v2/styles/app.css", import.meta.url), "utf8");
const viteSource = readFileSync(new URL("../../vite.config.js", import.meta.url), "utf8");
const queryClientSource = readFileSync(new URL("../../src-v2/app/query-client.ts", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const faviconSource = readFileSync(new URL("../../public/favicon-hz.svg", import.meta.url), "utf8");
const controlServerSource = readFileSync(new URL("./control-server.js", import.meta.url), "utf8");
const overviewSource = readFileSync(new URL("../../src-v2/features/overview/OverviewPage.tsx", import.meta.url), "utf8");
const businessDashboardSource = readFileSync(new URL("../../src-v2/features/operations/use-business-dashboard.ts", import.meta.url), "utf8");
const syncJobsSource = readFileSync(new URL("../../src-v2/features/operations/SyncJobsPage.tsx", import.meta.url), "utf8");
const attributeTemplatesSource = readFileSync(new URL("../../src-v2/features/templates/AttributeTemplatesPage.tsx", import.meta.url), "utf8");
const scopedFeatureSources = [
  readFileSync(new URL("../../src-v2/features/publishing/ProductDraftsPage.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../src-v2/features/publishing/NewProductPage.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../src-v2/features/publishing/BatchProductCreatePage.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../src-v2/features/compliance/ComplianceDetailPage.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../src-v2/features/compliance/ComplianceDraftEditor.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../src-v2/features/templates/TitleRuleTemplatesPage.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../src-v2/features/templates/SizeTemplatesPage.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../src-v2/features/templates/PackagingTemplatesPage.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../src-v2/features/templates/TailImageTemplatesPage.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../src-v2/features/templates/ComplianceTemplatesPage.tsx", import.meta.url), "utf8"),
];

test("browser tab uses the HZ brand favicon", () => {
  assert.match(indexSource, /rel="icon"[^>]+href="\/favicon-hz\.svg"/);
  assert.match(indexSource, /theme-color" content="#111516"/);
  assert.match(faviconSource, /fill="#111516"/);
  assert.match(faviconSource, /fill="#ffffff"/);
  assert.match(faviconSource, />HZ<\/text>/);
});

test("store-scoped feature queries include tenant, user, and store scope", () => {
  for (const source of scopedFeatureSources) {
    assert.match(source, /const queryScope = `\$\{session\.tenant\.id\}:\$\{session\.user\.id\}`|queryScope:\s*string/);
    assert.match(source, /queryKey:\s*\[\s*"store",\s*queryScope,\s*storeId/);
  }
});

test("manual-refresh workspaces never refetch cached queries on route remount", () => {
  const sources = [
    ...scopedFeatureSources,
    readFileSync(new URL("../../src-v2/features/publishing/PublishBatchesPage.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../../src-v2/features/overview/TodayWorkPage.tsx", import.meta.url), "utf8"),
  ];
  for (const source of sources) {
    const queryCount = (source.match(/useQuery\(\{/g) || []).length;
    const manualCount = (source.match(/refetchOnMount:\s*false/g) || []).length;
    assert.ok(manualCount >= queryCount, "every manual-refresh query must opt out of remount refetch");
    assert.doesNotMatch(source, /refetchInterval\s*:/);
  }
});

test("core operations UI is anchored to the selected OSS interaction stack", () => {
  assert.match(packageSource, /"@tanstack\/react-table"/);
  assert.match(packageSource, /"@tanstack\/react-virtual"/);
  assert.match(packageSource, /"@dnd-kit\/core"/);
  assert.match(packageSource, /"@dnd-kit\/sortable"/);
  assert.match(tableSource, /@tanstack\/react-table/);
  assert.match(tableSource, /@tanstack\/react-virtual/);
  assert.match(tableSource, /useTable/);
  assert.match(tableSource, /tableFeatures/);
  assert.match(tableSource, /useVirtualizer/);
  assert.match(primitivesSource, /OpsPageHeader/);
  assert.match(primitivesSource, /OpsMetricStrip/);
  assert.match(batchCreateSource, /DndContext/);
  assert.match(batchCreateSource, /SortableContext/);
});

test("publishing and compliance pages use the compact operations layout contract", () => {
  for (const source of [complianceSource, publishingSource]) {
    assert.match(source, /OperationsPrimitives/);
    assert.match(source, /OpsPageHeader/);
    assert.match(source, /OpsToolbar/);
    assert.match(source, /ops-page/);
    assert.match(source, /const queryScope = `\$\{session\.tenant\.id\}:\$\{session\.user\.id\}`/);
    assert.match(source, /aria-label="手动刷新/);
    assert.doesNotMatch(source, /refetchInterval:\s*(?:8000|15000)/);
  }
  assert.match(stylesSource, /\.ops-page/);
  assert.match(stylesSource, /\.ops-toolbar/);
  assert.match(stylesSource, /@media \(max-width: 900px\)/);
});

test("publishing and compliance lists are wired to the shared OSS table primitive", () => {
  for (const source of [complianceSource, publishingSource]) {
    assert.match(source, /OperationsDataTable/);
    assert.match(source, /virtualized operational list/);
  }
});

test("bounded operational pages keep native table geometry before enabling virtualization", () => {
  assert.match(tableSource, /const shouldVirtualize = rows\.length > 40/);
  assert.match(tableSource, /ops-data-table--virtualized/);
  assert.match(tableSource, /ops-data-table__virtual-body/);
  assert.match(stylesSource, /\.ops-data-table__virtual-body/);
  assert.match(stylesSource, /\.ops-data-table thead \{[\s\S]*box-shadow: 0 1px 0 var\(--line\)/);
  assert.match(stylesSource, /@media \(max-width: 560px\)/);
});

test("global query defaults bound inactive cache and avoid reconnect refresh storms", () => {
  assert.match(queryClientSource, /gcTime: 5 \* 60_000/);
  assert.match(queryClientSource, /refetchOnReconnect: false/);
  assert.match(queryClientSource, /refetchOnWindowFocus: false/);
  assert.match(queryClientSource, /retryDelay: \(attemptIndex\) => Math\.min\(1000 \* \(2 \*\* attemptIndex\), 4000\)/);
});

test("SRF-01 keeps ordinary browser reads manual and SRF-02 scopes polling to active refresh tasks", () => {
  for (const source of [syncJobsSource, complianceSource, attributeTemplatesSource]) {
    assert.match(source, /refetchInterval\s*:/);
    assert.match(source, /refetchIntervalInBackground:\s*false/);
    assert.match(source, /refetchOnMount:\s*false/);
  }
  assert.match(overviewSource, /useBusinessDashboard\(storeId\)/);
  assert.doesNotMatch(overviewSource, /refetchInterval:\s*/);
  assert.match(businessDashboardSource, /business-dashboard-refresh-job/);
  assert.match(businessDashboardSource, /refetchIntervalInBackground:\s*false/);
  assert.match(syncJobsSource, /const queryScope = `\$\{session\.tenant\.id\}:\$\{session\.user\.id\}`/);
  assert.match(controlServerSource, /refreshIfEmpty:\s*false/);
});

test("shell workspace usage cache is scoped and does not refetch on focus", () => {
  const shellSource = readFileSync(new URL("../../src-v2/app/AppShell.tsx", import.meta.url), "utf8");
  assert.match(shellSource, /queryKey: \["store", sessionQuery\.data \? `\$\{sessionQuery\.data\.tenant\.id\}:\$\{sessionQuery\.data\.user\.id\}`/);
  assert.match(shellSource, /gcTime: 10 \* 60_000/);
  assert.match(shellSource, /refetchOnWindowFocus: false/);
  assert.match(shellSource, /refetchOnReconnect: false/);
});

test("compliance identifiers cannot overflow into adjacent columns", () => {
  assert.match(complianceSource, /title=\{item\.skc\}/);
  assert.match(complianceSource, /max-w-full truncate text-sm font-medium/);
  assert.match(complianceSource, /title=\{categoryLabel\(item\)\}/);
  assert.match(stylesSource, /\.ops-data-table td \{[\s\S]*overflow: hidden;/);
});

test("compliance workspace uses shared toolbar and metric primitives in the rendered sections", () => {
  assert.match(complianceSource, /<OpsToolbar>/);
  assert.match(complianceSource, /<OpsMetricStrip(?:\s|>)/);
});

test("commercial UI baseline keeps navigation and operational headers visibly consistent", () => {
  const shellSource = readFileSync(new URL("../../src-v2/app/AppShell.tsx", import.meta.url), "utf8");
  assert.match(shellSource, /commercial-sidebar/);
  assert.match(shellSource, /commercial-sidebar__context/);
  assert.match(shellSource, /commercial-topbar/);
  assert.match(shellSource, /commercial-nav-link--active/);
  assert.match(stylesSource, /--brand: #2563eb/);
  assert.match(stylesSource, /\.ops-page__header::after/);
  assert.match(stylesSource, /\.commercial-nav-link--active/);
  assert.match(stylesSource, /\.commercial-sidebar__context/);
  assert.match(stylesSource, /\.ops-page__description \{[\s\S]*max-width: 72ch/);
  assert.match(stylesSource, /\.status-badge::before/);
  const buttonSource = readFileSync(new URL("../../src-v2/components/ui/button.tsx", import.meta.url), "utf8");
  assert.match(buttonSource, /active:scale-\[\.98\]/);
  const appSource = readFileSync(new URL("../../src-v2/app/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /lazy\(\(\) => import\("\.\.\/features\/compliance\/CompliancePage"\)/);
  assert.match(appSource, /<Suspense fallback={<RouteFallback \/>}>/);
  assert.match(stylesSource, /\.ops-route-loading/);
});

test("today work and compliance expose deliberate loading and manual-refresh states", () => {
  const todayWorkSource = readFileSync(new URL("../../src-v2/features/overview/TodayWorkPage.tsx", import.meta.url), "utf8");
  assert.match(todayWorkSource, /today-work-page/);
  assert.match(todayWorkSource, /数据仅在手动刷新时更新/);
  assert.match(todayWorkSource, /cache-chip/);
  assert.match(todayWorkSource, /当前仍展示上次成功读取的缓存数据/);
  assert.match(complianceSource, /ops-loading-state/);
  assert.match(stylesSource, /@keyframes ops-loading-shimmer/);
  assert.match(stylesSource, /\.today-work-activity/);
  assert.match(stylesSource, /compliance-page > \.ops-table-shell:nth-of-type\(2\)/);
  assert.match(stylesSource, /\.compliance-page \.ops-data-table \{[\s\S]*min-width: 1240px/);
  assert.match(stylesSource, /\.compliance-page \.ops-data-table th:nth-child\(3\)/);
  assert.match(stylesSource, /\.compliance-page > \.ops-table-shell:first-of-type \.grid\.border-b > div/);
  assert.match(stylesSource, /\.compliance-page > \.ops-table-shell:nth-of-type\(2\) \.ops-metric-strip/);
});

test("publishing and batch creation expose non-blocking operational feedback", () => {
  assert.match(publishingSource, /ops-fetching-banner/);
  assert.match(publishingSource, /ops-empty-state/);
  assert.match(batchCreateSource, /保存并前往发布不会绕过商品审核中心/);
  assert.match(stylesSource, /\.ops-fetching-banner/);
  assert.match(stylesSource, /\.ops-empty-state__icon/);
});

test("single-product editing keeps the same visual hierarchy and image affordances", () => {
  const newProductSource = readFileSync(new URL("../../src-v2/features/publishing/NewProductPage.tsx", import.meta.url), "utf8");
  const imageSource = readFileSync(new URL("../../src-v2/features/publishing/ProductImagesSection.tsx", import.meta.url), "utf8");
  assert.match(newProductSource, /single-product-page/);
  assert.match(newProductSource, /single-product-save-bar/);
  assert.match(newProductSource, /product-editor-step-nav/);
  assert.match(imageSource, /product-image-card/);
  assert.match(imageSource, /放大查看/);
  assert.match(imageSource, /删除/);
  assert.match(imageSource, /main-image-watermark/);
  assert.match(imageSource, /sku-preview-dialog/);
  assert.match(stylesSource, /\.single-product-page \{[\s\S]*padding-bottom: 92px/);
  assert.match(batchCreateSource, /batch-create-params-panel/);
  assert.match(batchCreateSource, /batch-create-table-panel/);
  assert.match(publishingSource, /publishing-review-panel/);
  assert.match(publishingSource, /publishing-review-tabs/);
  assert.match(publishingSource, /publishing-refresh-actions/);
  assert.match(publishingSource, /重新编辑/);
  assert.match(publishingSource, /重新发布/);
  assert.match(publishingSource, /归档/);
  assert.match(stylesSource, /\.publishing-review-panel \.ops-data-table/);
  assert.match(stylesSource, /\.publishing-review-panel > \.overflow-x-auto > table/);
  assert.match(publishingSource, /cache-chip/);
  assert.match(publishingSource, /price-discussion-panel/);
  assert.match(publishingSource, /一键拒绝核价/);
  assert.match(stylesSource, /\.product-image-card:hover/);
  assert.match(stylesSource, /#draft-product-images \.main-image-watermark/);
  assert.match(stylesSource, /#draft-product-images \.sku-preview-dialog/);
  assert.match(stylesSource, /button:focus-visible/);
  assert.match(stylesSource, /prefers-reduced-motion/);
  assert.match(stylesSource, /batch-create-page \[role="dialog"\] > section/);
  assert.match(stylesSource, /\.ops-data-table th:last-child/);
  const draftsSource = readFileSync(new URL("../../src-v2/features/publishing/ProductDraftsPage.tsx", import.meta.url), "utf8");
  assert.match(draftsSource, /OpsPageHeader/);
  assert.match(draftsSource, /product-drafts-page/);
  assert.match(stylesSource, /\.product-drafts-page \.operations-table thead/);
  assert.match(stylesSource, /\.batch-create-params-panel \.field-label/);
  assert.match(stylesSource, /\.batch-create-table-panel \.table-scroll/);
  assert.match(stylesSource, /\.product-drafts-page \.operations-table th:nth-child\(3\)/);
  assert.match(stylesSource, /\.compliance-page \.ops-data-table \{[\s\S]*table-layout: fixed/);
  assert.match(stylesSource, /\.compliance-page \.ops-data-table \{[\s\S]*width: 1240px/);
});

test("compliance sync accepts the server terminal states and always reads back the workspace", () => {
  assert.match(complianceSource, /state === "completed"/);
  assert.match(complianceSource, /state === "completed_with_errors"/);
  assert.match(complianceSource, /queryClient\.refetchQueries\(/);
  assert.match(complianceSource, /合规同步部分完成，部分 SKC 查询失败/);
});

test("V2 build keeps stable OSS dependencies in cacheable vendor chunks", () => {
  assert.match(viteSource, /manualChunks/);
  assert.match(viteSource, /react-query/);
  assert.match(viteSource, /lucide-react/);
  assert.match(viteSource, /react-virtual/);
});

test("persisted media previews use a private long-lived cache policy", () => {
  assert.match(controlServerSource, /Asset IDs are immutable/);
  assert.match(controlServerSource, /max-age=86400, stale-while-revalidate=3600/);
});
