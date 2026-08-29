# ERP-02 单一 V2 前端产物恢复报告

Run：`RUN-20260829-ERP02-V2-ARTIFACT-01`  
执行时间：2026-08-29 12:06～12:10 +0800  
状态：`IN_PROGRESS`（待最终提交后的无 dirty manifest 复验）

## 1. 本步骤合同

目标是消除 legacy、V2、`dist`、`dist-web`、`dist-v2` 之间的构建/部署漂移，指定 V2 为唯一发布源。本步骤只调整构建入口、静态目录映射、release marker、asset manifest 和取证文档；没有修改业务页面、导航、品牌文案、状态逻辑或生产 release。

## 2. 初始生产事实

- 生产 current：`/opt/shein-console/releases/shein-cloud-deploy-20260829-frontend-restore-v1`。
- Nginx 实际 root：`/opt/shein-console/current/dist-web`。
- 生产 `dist-web` 与 `dist-v2` 递归文件树 SHA-256 均为 `5483d057ab907704cf7e72b6baa37db645d665b063ed9df362a700ef598bb21c`。
- 两套线上目录均显示 `SHEIN超级运营中心`；`全托管运营助手`、`网页协作版`、`SHEIN涵舟工作室` 均未发现。
- 线上 `dist-web-legacy-not-served` 仍存在但不由 Nginx 服务；本步骤未删除它。

结论：线上当前表现已是 V2，但 Nginx 仍依赖名为 `dist-web` 的过渡目录，历史上存在误部署 legacy 构建的风险，因此必须从构建源和候选模板消除歧义。

## 3. 已实施的收敛

- `vite.config.js`：任何 `command === "build"` 强制使用 V2 entry 和 `dist-v2`；只有非 build 的 `dev:web` 保留 legacy 开发入口。
- `package.json`：`build` 和 `build:web` 都转调 `build:v2`；`preview` 与 `preview:v2` 都读取 `dist-v2`。
- `index.html`：增加不影响视觉的 `polaris-ui=v2` marker。
- 新增 `server/v2-release-manifest.js`：构建后生成逐文件 asset manifest、release manifest 和 build/source identity。
- `server/cloud/audit-v2-release-readiness.js`：静态门禁验证 manifest 完整性、文件 hash、字节数和未列出文件；篡改测试已加入。
- Nginx 配置模板：`deploy/nginx/shein-web-app.conf.example` 和 `deploy/nginx/shein-image-web-app-cloudflared.conf.example` 统一指向 `dist-v2`。
- 业务引用图：[ERP02_V2_REFERENCE_GRAPH_2026-08-29.md](./ERP02_V2_REFERENCE_GRAPH_2026-08-29.md)。

legacy 源码没有删除；没有复制/覆盖生产 `dist-web`，也没有把生产配置改成新 root。

## 4. 验证证据

- 全量测试：1172 pass，0 fail，0 skipped。
- `npm run build`：通过，实际转调 `build:v2`。
- `npm run build:web`：通过，实际转调 `build:v2`，没有生成独立 legacy release 目录。
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2" --json` 的静态结果：`ready=true`、`blockers=[]`、`assetCount=46`、`publishingEnabled=false`、`authorizesPublishing=false`。
- 浏览器验收（本地 V2 preview）：登录页 title 为 `SHEIN超级运营中心`，`polaris-ui=v2`，buildId/source revision marker 均存在；`/login`、overview、单品、批量、草稿、发布、合规 7 个关键深层路由均保持原 URL、不循环；旧壳层标识为 0。
- Git 差异 probe：临时修改能被 `status`/`diff` 捕获，撤销后 clone 干净。

## 5. 外部边界与未执行项

- 未进行生产部署、Nginx reload、release 切换、数据库迁移、队列操作或 SHEIN 调用。
- 生产 Nginx 仍读取 `dist-web`，因为 ERP-02 的部署切换必须单独批准；当前目录与 `dist-v2` 已通过递归 hash 证明同一静态事实。
- 本机工作区在最终提交前会出现 `sourceDirty=true` 的开发状态；提交后必须重新构建并验证 manifest 的 `sourceDirty=false`，再关闭本 Run。

## 6. 完成标准

只有最终提交后的 clean build、manifest 审计、浏览器复验和台账更新全部通过后，才将本 Run 标记 `COMPLETE`；未完成前不得开始 ERP-03。
