# ERP-02 V2 前端构建与运行时引用图

Run：`RUN-20260829-ERP02-V2-ARTIFACT-01`  
原则：只收敛构建/静态产物入口，不改变业务页面、导航、文案或状态语义。

## 1. 唯一生产前端入口

```text
index.html
  └─ Vite build command
       └─ src-v2/main.tsx
            └─ src-v2/app/App.tsx
                 ├─ /login, /register, /forgot-password, /reset-password
                 ├─ /app/overview, /app/today-work
                 ├─ /app/operations/:storeId/products
                 ├─ /app/operations/:storeId/products/new
                 ├─ /app/operations/:storeId/products/batch-new
                 ├─ /app/operations/:storeId/products/drafts
                 ├─ /app/operations/:storeId/publishing
                 ├─ /app/operations/:storeId/compliance
                 └─ settings/templates and store/member routes
                      └─ dist-v2/index.html + dist-v2/assets/*
                           └─ candidate Nginx root: /opt/shein-console/current/dist-v2
```

所有生产构建命令现在进入同一事实：

| 命令 | 实际入口 | 输出 | 生产资格 |
| --- | --- | --- | --- |
| `npm run build` | `npm run build:v2` | `dist-v2/` | 唯一发布构建 |
| `npm run build:v2` | `src-v2/main.tsx` | `dist-v2/` | 唯一发布构建 |
| `npm run build:web` | 兼容别名，转调 `build:v2` | `dist-v2/` | 不再生成 legacy 页面 |
| `npm run preview` | V2 静态预览 | `dist-v2/` | 仅本地预览 |
| `npm run preview:v2` | V2 静态预览 | `dist-v2/` | 仅本地预览 |

`src/main.jsx`、`src/web-main.jsx` 和 `src/App.jsx` 仍保留为历史/开发资产，没有被删除；`dev:web` 仅用于开发兼容，不是生产 release 入口。Vite 在 `command === "build"` 时强制使用 V2，因此直接执行 `vite build --mode web` 也不能生成另一套 legacy 发布产物。

## 2. 四条业务引用链

### 单品编辑

```text
/app/operations/:storeId/products/new
  → src-v2/features/publishing/NewProductPage.tsx
  → ProductImagesSection.tsx
  → product-content / product-sku / product-image contracts
  → src-v2/lib/api.ts
  → /v1 store-scoped read/write endpoints
```

### 批量建品

```text
/app/operations/:storeId/products/batch-new
  → src-v2/features/publishing/BatchProductCreatePage.tsx
  → product-sku / product-image contracts
  → src-v2/lib/api.ts
  → /v1 store-scoped draft/media endpoints
```

### 草稿批处理

```text
/app/operations/:storeId/products/drafts
  → src-v2/features/publishing/ProductDraftsPage.tsx
  → product-draft-issue / bulk-template / publish-handoff contracts
  → src-v2/lib/api.ts
  → draft revalidation, template reuse and handoff endpoints
```

### 文件夹导入

```text
BatchProductCreatePage.tsx
  → ProductFolderImport.tsx
  → folder/file classification and ambiguity blockers
  → uploadProductImage / uploadSkuImage
  → saveProductDraft
  → current store-scoped API
```

四条链都从 `src-v2/app/App.tsx` 的 V2 路由懒加载进入，构建后由同一个 `dist-v2` artifact 提供。ERP-02 不重写上述业务语义，也不把任一链路移回 legacy `src/`。

## 3. 运行时与静态目录事实

- 生产当前 Nginx 仍读取 `/opt/shein-console/current/dist-web`；本次未修改线上配置、未切换 release。
- 当前生产 `dist-web` 和 `dist-v2` 的递归文件树 SHA-256 均为 `5483d057ab907704cf7e72b6baa37db645d665b063ed9df362a700ef598bb21c`。
- 当前生产两套目录均显示 `SHEIN超级运营中心`，三类旧壳层标识均未发现。
- 交付模板已将 Nginx root 改为 `/opt/shein-console/current/dist-v2`；生产切换必须在后续单独批准后执行，并保留旧 release 回滚点。

## 4. 产物追踪

V2 构建写入：

- `dist-v2/index.html`：`polaris-ui=v2`、buildId、source revision meta marker。
- `dist-v2/asset-manifest.json`：每个静态文件的相对路径、字节数和 SHA-256。
- `dist-v2/release-manifest.json`：artifact kind、buildId、sourceRevision、buildTime、UI entry、输出目录和 asset manifest SHA-256。

`server/cloud/audit-v2-release-readiness.js` 在静态门禁中逐个校验上述 manifest、产物路径、字节数和 hash；manifest 缺失、篡改或存在未列出的构建文件时返回 blocker。
