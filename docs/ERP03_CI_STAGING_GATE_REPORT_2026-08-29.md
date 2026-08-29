# ERP-03 CI、预发与发布门禁报告

日期：2026-08-29  
Run：`RUN-20260829-ERP03-CI-STAGING-GATE-01`  
步骤：ERP-03  
结论：**GATE_FAILED（基础设施已落地，运行环境证据未闭合，不得进入 ERP-04）**

## 1. 本次实施范围

本 Run 只建立 ERP-03 的自动化门禁和隔离边界，没有修改业务 API、数据库语义、生产配置或 SHEIN 数据：

- `.nvmrc`、`packageManager`、`engines`、`.npmrc` 固定 Node `24.16.0` 与 npm `11.13.0`，锁文件保持 lockfile v3。
- `.github/workflows/polaris-erp03-gate.yml` 建立固定 revision 的 CI：secret scan、定向测试、全量测试、故障契约、V2 build、V2 release audit、完整 manifest、staging 隔离和 Playwright 核心流程；只有 `gate` 成功后才允许打包候选制品。
- `server/ci/release-manifest.js` 生成 source、UI、Control、Publish Worker、Outbox Dispatcher、其他 Worker、迁移全量 hash、schema range、flags、build time 和 PublishCommand 阻断结论。
- `server/ci/erp03-fault-gates.js` 与测试覆盖提交崩溃、Outbox 重投、重复 jobId、Worker 发送前/后崩溃、SHEIN 超时、SSE 断线、回读重复/乱序、同义回读、Attempt 歧义、投影事务失败、来源失败保留 LKG 以及媒体故障。
- `deploy/docker-compose.staging.yml` 与 `.env.staging.example` 建立独立 staging PostgreSQL、Redis、MinIO bucket、端口、Compose project 和默认关闭的 live-write flags。
- `playwright.config.ts` 与 `tests/e2e/v2-core-flow.spec.ts` 建立无 live SHEIN 的登录、切换核心路由、退出、V2 marker、旧壳层排除和窄屏流程；增加显式的本机系统 Chrome 选择开关，CI 默认仍使用 Playwright Chromium。
- `deploy/Dockerfile.cloud-control` 与固定工具链一致，改为 `node:24.16.0-alpine`；这是构建运行时一致性修复，不是生产部署。

## 2. 验证证据

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| 固定 Node/npm 与 lockfile | PASS | `npm run ci:toolchain`；Node `24.16.0`、npm `11.13.0`、lockfile `3`、`@playwright/test 1.62.1` |
| tracked-file secret scan | PASS | `npm run ci:secret-scan`；591 个 tracked 文件，无运行时 secret finding；4 个官方文档/密码学测试向量以 reference-only 明示保留 |
| 故障契约门 | PASS | 17/17 `server/ci/erp03-fault-gates.test.js` |
| 完整测试 | PASS | `npm test`：1193 pass、0 fail、0 skipped |
| V2 build | PASS | `npm run build:v2` 与 `npm run build:web` 均成功；clean revision `d67e7815a7f8e2dd71a2b83fb99160b30d773a78` 的 V2 tree hash：`61922cfca2ca733d20f40756f0e68e83123d55174ba2e93d0dd3c3f8d480959b` |
| V2 artifact audit | PASS | `npm run release:audit:v2 -- --json`；`ready=true`、blockers=[]、publishingEnabled=false、authorizesPublishing=false |
| 完整 release manifest | PASS（clean revision） | `node server/ci/release-manifest.js --json`：`passed=true`、`errors=[]`、`sourceDirty=false`、UI source revision 与完整 manifest 相同；PublishCommand 仍因 Outbox 未实现和 live-write false 被阻断 |
| staging 候选制品打包 | PASS（仅候选，不放行生产） | `POLARIS_CI_GATE=passed POLARIS_ARTIFACT_CHANNEL=staging npm run ci:release-package`；候选包 SHA-256：`8ef36894b88d1472aacbab9dfc0ac48cde12eef86388e35b87ccc9968f70b564`，权限 `0444` |
| staging 配置隔离 | PASS（静态） | `npm run ci:staging-audit`；独立端口/volume/bucket/project，生产 API 域名排除，6 个 live-write/sync flags 全 false |
| Playwright 配置 | PASS | `npx playwright test --list`：2 个核心测试已被发现 |
| Playwright 实际浏览器 | PASS | `POLARIS_USE_SYSTEM_CHROME=1 npx playwright test tests/e2e/v2-core-flow.spec.ts --project=chromium`；系统 Chrome `152.0.7977.64`，2/2 通过；无 live SHEIN |
| staging 实际运行 | UNKNOWN | 本机未安装 Docker，未启动 Compose，未触碰生产 DB/Redis/对象存储 |

## 3. 未闭合项与严格阻断理由

1. 本机 Docker 不存在，因此不能证明 PostgreSQL、Redis、MinIO 和 Control 在真实 staging 网络中成功启动、迁移和互相隔离。
2. 当前代码仍没有 `server/cloud/outbox-dispatcher.js`。完整 release manifest 会声明它为 `not_implemented`，并固定输出 `outboxDispatcher_not_implemented`；同时默认 `product_publish_live_write_disabled`。因此新 PublishCommand 不能被授权，不能提前声称可靠发布管线完成。
3. `npm audit` 当前报告 5 个 high、0 个 critical，均无自动修复方案（涉及 Vite/Tailwind/Vite React/nanoid/PostCSS 依赖链）。本 Run 没有擅自升级依赖；该项作为安全审查警告保留，需在后续依赖治理中单独处理。

## 4. 外部写入与生产边界

- 未连接生产 PostgreSQL、Redis 或生产对象存储。
- 未执行生产迁移、Nginx reload、current 切换、服务重启或部署。
- 未调用真实 SHEIN 写接口，也未使用生产凭证。
- staging 模板只使用 `shein-api-disabled.invalid`、独立数据服务和 false flags；`product-publish-worker` 明确 fail-closed。

## 5. 放行结论

ERP-03 当前只能保持 `GATE_FAILED`，不能标记 `COMPLETE`，也不能开始 ERP-04。Playwright 实际流程已在系统 Chrome 下通过；待具备 Docker staging 隔离验收环境后，必须从同一 clean revision 重跑完整 gate。只有 staging 实际运行和完整 manifest 的必要组件均通过，才可关闭本 Run。Outbox Dispatcher 仍须在 ERP-09/相关步骤实现并经过独立验证后，才可能解除发布命令阻断。
