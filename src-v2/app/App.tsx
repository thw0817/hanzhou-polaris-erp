import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AppShell, AppStart } from "./AppShell";

const LoginPage = lazy(() => import("../features/auth/LoginPage").then((module) => ({ default: module.LoginPage })));
const InvitePage = lazy(() => import("../features/auth/InvitePage").then((module) => ({ default: module.InvitePage })));
const RegisterPage = lazy(() => import("../features/auth/RegisterPage").then((module) => ({ default: module.RegisterPage })));
const ForgotPasswordPage = lazy(() => import("../features/auth/ForgotPasswordPage").then((module) => ({ default: module.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("../features/auth/ResetPasswordPage").then((module) => ({ default: module.ResetPasswordPage })));
const ProductsPage = lazy(() => import("../features/operations/ProductsPage").then((module) => ({ default: module.ProductsPage })));
const ProductDetailPage = lazy(() => import("../features/operations/ProductDetailPage").then((module) => ({ default: module.ProductDetailPage })));
const SalesInventoryPage = lazy(() => import("../features/operations/SalesInventoryPage").then((module) => ({ default: module.SalesInventoryPage })));
const AlertsPage = lazy(() => import("../features/operations/AlertsPage").then((module) => ({ default: module.AlertsPage })));
const SyncJobsPage = lazy(() => import("../features/operations/SyncJobsPage").then((module) => ({ default: module.SyncJobsPage })));
const CompliancePage = lazy(() => import("../features/compliance/CompliancePage").then((module) => ({ default: module.CompliancePage })));
const ComplianceDetailPage = lazy(() => import("../features/compliance/ComplianceDetailPage").then((module) => ({ default: module.ComplianceDetailPage })));
const StoresPage = lazy(() => import("../features/settings/StoresPage").then((module) => ({ default: module.StoresPage })));
const MembersPage = lazy(() => import("../features/settings/MembersPage").then((module) => ({ default: module.MembersPage })));
const AttributeTemplatesPage = lazy(() => import("../features/templates/AttributeTemplatesPage").then((module) => ({ default: module.AttributeTemplatesPage })));
const PackagingTemplatesPage = lazy(() => import("../features/templates/PackagingTemplatesPage").then((module) => ({ default: module.PackagingTemplatesPage })));
const SizeTemplatesPage = lazy(() => import("../features/templates/SizeTemplatesPage").then((module) => ({ default: module.SizeTemplatesPage })));
const TailImageTemplatesPage = lazy(() => import("../features/templates/TailImageTemplatesPage").then((module) => ({ default: module.TailImageTemplatesPage })));
const TitleRuleTemplatesPage = lazy(() => import("../features/templates/TitleRuleTemplatesPage").then((module) => ({ default: module.TitleRuleTemplatesPage })));
const ComplianceTemplatesPage = lazy(() => import("../features/templates/ComplianceTemplatesPage").then((module) => ({ default: module.ComplianceTemplatesPage })));
const NewProductPage = lazy(() => import("../features/publishing/NewProductPage").then((module) => ({ default: module.NewProductPage })));
const ProductDraftsPage = lazy(() => import("../features/publishing/ProductDraftsPage").then((module) => ({ default: module.ProductDraftsPage })));
const BatchProductCreatePage = lazy(() => import("../features/publishing/BatchProductCreatePage").then((module) => ({ default: module.BatchProductCreatePage })));
const PublishBatchesPage = lazy(() => import("../features/publishing/PublishBatchesPage").then((module) => ({ default: module.PublishBatchesPage })));
const OverviewPage = lazy(() => import("../features/overview/OverviewPage").then((module) => ({ default: module.OverviewPage })));
const TodayWorkPage = lazy(() => import("../features/overview/TodayWorkPage").then((module) => ({ default: module.TodayWorkPage })));

function RouteFallback() {
  return (
    <div className="ops-route-loading" role="status" aria-live="polite">
      <span className="ops-route-loading__dot" />
      正在打开工作区
    </div>
  );
}

function ProtectedLayout() {
  return <AppShell />;
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
      <Route path="/" element={<Navigate replace to="/app" />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/app" element={<ProtectedLayout />}>
        <Route index element={<AppStart />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="today-work" element={<TodayWorkPage />} />
        <Route path="operations/:storeId/products" element={<ProductsPage />} />
        <Route
          path="operations/:storeId/products/new"
          element={<NewProductPage />}
        />
        <Route
          path="operations/:storeId/products/batch-new"
          element={<BatchProductCreatePage />}
        />
        <Route
          path="operations/:storeId/products/drafts"
          element={<ProductDraftsPage />}
        />
        <Route
          path="operations/:storeId/products/:skc"
          element={<ProductDetailPage />}
        />
        <Route
          path="operations/:storeId/publishing"
          element={<PublishBatchesPage />}
        />
        <Route
          path="operations/:storeId/sales-inventory"
          element={<SalesInventoryPage />}
        />
        <Route path="operations/:storeId/alerts" element={<AlertsPage />} />
        <Route path="operations/:storeId/jobs" element={<SyncJobsPage />} />
        <Route path="operations/:storeId/compliance" element={<CompliancePage />} />
        <Route
          path="operations/:storeId/compliance/:skc"
          element={<ComplianceDetailPage />}
        />
        <Route
          path="templates/:storeId/title-rules"
          element={<TitleRuleTemplatesPage />}
        />
        <Route
          path="templates/:storeId/attributes"
          element={<AttributeTemplatesPage />}
        />
        <Route
          path="templates/:storeId/sizes"
          element={<SizeTemplatesPage />}
        />
        <Route
          path="templates/:storeId/packaging"
          element={<PackagingTemplatesPage />}
        />
        <Route
          path="templates/:storeId/tail-images"
          element={<TailImageTemplatesPage />}
        />
        <Route
          path="templates/:storeId/compliance"
          element={<ComplianceTemplatesPage />}
        />
        <Route path="settings/stores" element={<StoresPage />} />
        <Route path="settings/members" element={<MembersPage />} />
      </Route>
      <Route path="*" element={<Navigate replace to="/app" />} />
      </Routes>
    </Suspense>
  );
}
