# ERP-03 CI、预发与发布门禁报告

日期：2026-08-29  
Run：`RUN-20260829-ERP03-CI-STAGING-GATE-01`  
步骤：ERP-03  
结论：**以第 6 节补证为当前状态：GATE_FAILED（Outbox Dispatcher 已实现并纳入审计，但 staging 实际投递闭环与远端 CI runner 证据仍未闭合，仍不得进入 ERP-04）**

## 1. 本次实施范围

本 Run 只建立 ERP-03 的自动化门禁和隔离边界，没有修改业务 API、数据库语义、生产配置或 SHEIN 数据：

- `.nvmrc`、`packageManager`、`engines`、`.npmrc` 固定 Node `24.16.0` 与 npm `11.13.0`，锁文件保持 lockfile v3。
- `.github/workflows/polaris-erp03-gate.yml` 建立固定 revision 的 CI：secret scan、定向测试、全量测试、故障契约、V2 build、V2 release audit、完整 manifest、staging 隔离和 Playwright 核心流程；只有 `gate` 成功后才允许打包候选制品。
- `server/ci/release-manifest.js` 生成 source、UI、Control、Publish Worker、Outbox Dispatcher、其他 Worker、迁移全量 hash、schema range、flags、build time 和 PublishCommand 阻断结论。
- `server/ci/erp03-fault-gates.js` 与测试覆盖提交崩溃、Outbox 重投、重复 jobId、Worker 发送前/后崩溃、SHEIN 超时、SSE 断线、回读重复/乱序、同义回读、Attempt 歧义、投影事务失败、来源失败保留 LKG 以及媒体故障。
- `deploy/docker-compose.staging.yml` 与 `.env.staging.example` 建立独立 staging PostgreSQL、Redis、MinIO bucket、端口、Compose project 和默认关闭的 live-write flags。
- 为本地 staging MinIO 增加显式的 `SHEIN_MEDIA_S3_ALLOW_INSECURE=true` 环境门；该开关仅在 `SHEIN_ENVIRONMENT=staging` 时传递给对象存储，生产默认仍拒绝远程 HTTP Endpoint；补充 S3 安全回归测试。
- `playwright.config.ts` 与 `tests/e2e/v2-core-flow.spec.ts` 建立无 live SHEIN 的登录、切换核心路由、退出、V2 marker、旧壳层排除和窄屏流程；增加显式的本机系统 Chrome 选择开关，CI 默认仍使用 Playwright Chromium。
- `deploy/Dockerfile.cloud-control` 与固定工具链一致，改为 `node:24.16.0-alpine`；这是构建运行时一致性修复，不是生产部署。
- 本次补证新增 PostgreSQL `publish_outbox_events` 迁移、事务内 durable handoff、PostgreSQL Outbox Dispatcher、确定性 BullMQ `jobId` 和 command-scoped Publish Worker；Control 不再直接向发布队列写入。

## 2. 验证证据

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| 固定 Node/npm 与 lockfile | PASS | `npm run ci:toolchain`；Node `24.16.0`、npm `11.13.0`、lockfile `3`、`@playwright/test 1.62.1` |
| tracked-file secret scan | PASS | `npm run ci:secret-scan`；591 个 tracked 文件，无运行时 secret finding；4 个官方文档/密码学测试向量以 reference-only 明示保留 |
| 故障契约门 | PASS | 17/17 `server/ci/erp03-fault-gates.test.js` |
| 完整测试 | PASS | `npm test`：1200 pass、0 fail、0 skipped；另有 046 迁移结构回归 |
| V2 build | PASS | `npm run build:v2` 与 `npm run build:web` 均成功；clean revision `b1fc965d23bfbc72f3ce03f5e18976a83720ab45` 的 source tree：`8c9004b4cbf9fe9403c79cf20f4020cdd037d13c`，asset manifest SHA-256：`fa13c9d28d80ee532fe221af59789b1a883ed65604cdb37c0aea5318bef64682` |
| V2 artifact audit | PASS | `npm run release:audit:v2 -- --json`；`ready=true`、blockers=[]、publishingEnabled=false、authorizesPublishing=false |
| 完整 release manifest | PASS（clean revision） | `node server/ci/release-manifest.js --json`：`passed=true`、`errors=[]`、`sourceDirty=false`、UI source revision 与完整 manifest 相同；PublishCommand 仍因 Outbox 未实现和 live-write false 被阻断 |
| staging 候选制品打包 | PASS（仅候选，不放行生产） | `POLARIS_CI_GATE=passed POLARIS_ARTIFACT_CHANNEL=staging npm run ci:release-package`；候选包 `artifacts/polaris-staging-b1fc965d23bfbc72f3ce03f5e18976a83720ab45.tar.gz`，SHA-256：`b91d2be68b7af497351b2ddbeacb4caddf3d4e2edcc85aba8a43108c730188e0`，权限 `0444` |
| staging 配置隔离 | PASS（静态） | `npm run ci:staging-audit`；独立端口/volume/bucket/project，生产 API 域名排除，6 个 live-write/sync flags 全 false |
| Playwright 配置 | PASS | `npx playwright test --list`：2 个核心测试已被发现 |
| Playwright 实际浏览器 | PASS（本机 CI-equivalent） | 默认 bundled Chromium `151.0.7922.34` 与对应 headless shell 已安装并校验；`npx playwright test tests/e2e/v2-core-flow.spec.ts --project=chromium`，2/2 通过；无 live SHEIN。系统 Chrome `152.0.7977.64` 的历史 fallback 结果仍保留；本机未将该结果冒充远端 GitHub Actions 运行结果 |
| staging 实际运行 | PASS（安全探针） | Docker Desktop `4.88.1`；Compose project `hanzhou-polaris-staging`；PostgreSQL、Redis、MinIO、Control 均 healthy；数据库已应用 `046_publish_outbox_events.sql`；Redis `PONG`；Control `/health`/`/ready` 通过；未启动 Publish Worker 与 Outbox Dispatcher，真实发布写入仍关闭 |
| Outbox Dispatcher 单元/静态门 | PASS | `server/cloud/outbox-dispatcher.test.js`；claim/lease、幂等 jobId、队列失败可重试、事务内事件写入均通过；运行时 capability 和 release audit 已登记 046 |
| staging Dispatcher DB 探针 | PASS（无待处理行） | 独立 staging PostgreSQL 上真实 `dispatchOutboxOnce` 返回 `claimed=0, dispatched=0, failed=0`；无真实 PublishCommand，因此未伪造“已投递”证据 |

## 3. 未闭合项与严格阻断理由

1. staging 实际运行阻断已解除。用户明确授权后，已从 Docker 官方稳定 DMG 地址安装 Docker Desktop `4.88.1`；DMG SHA-256 为 `94102d4fe056bf3a4fde375d693aae96a429157dad0345af9853d7157d6bd5bd`，`hdiutil verify` CRC 通过，Gatekeeper `spctl --assess --type execute` 通过。Compose、迁移、依赖健康、Control health/ready 和 MinIO 对象闭环均已在独立 staging 中完成；未触碰生产。
2. Outbox Dispatcher 已实现，但本次没有在 staging 生成真实 PublishCommand 进行“Outbox row → BullMQ → command-scoped Worker”端到端投递；原因是 `SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED=false`，且不应伪造业务发布数据。当前只证明了真实 DB schema/claim 探针和隔离环境。
3. 远端 GitHub Actions runner 尚未实际执行；本机 CI-equivalent 不能写成远端 CI 通过。
4. `npm audit` 当前报告 5 个 high、0 个 critical，均无自动修复方案（涉及 Vite/Tailwind/Vite React/nanoid/PostCSS 依赖链）。本 Run 没有擅自升级依赖；该项作为安全审查警告保留，需在后续依赖治理中单独处理。

## 4. 外部写入与生产边界

- 未连接生产 PostgreSQL、Redis 或生产对象存储。
- 未执行生产迁移、Nginx reload、current 切换、服务重启或部署。
- 未调用真实 SHEIN 写接口，也未使用生产凭证。
- staging 模板只使用 `shein-api-disabled.invalid`、独立数据服务和 false flags；`product-publish-worker` 明确 fail-closed。

## 5. 放行结论

ERP-03 当前仍保持 `GATE_FAILED`，不能标记 `COMPLETE`，也不能开始 ERP-04。Outbox Dispatcher 的代码、迁移、运行时 capability、release manifest、单元测试和 staging DB 探针已补齐；但 staging 尚未执行真实 PublishCommand 投递闭环，远端 GitHub Actions runner 也尚未执行，且 live-write 仍关闭。因此本次只解除“Dispatcher 缺失”这一具体实现阻断，不把 ERP-09 或可靠发布全链路提前标记完成。

## 6. ERP-03 Outbox 补证（当前事实）

### RUN-20260829-ERP03-OUTBOX-BRIDGE-01

- 启动依据：上一 Run 明确指出 Outbox Dispatcher 缺失并阻断 ERP-03；用户继续要求严格执行下一步。
- 变更范围：新增 `server/cloud/migrations/046_publish_outbox_events.sql`；新增 `server/cloud/outbox-dispatcher.js` 及其测试；将发布 execute 的 durable handoff 写入同一 PostgreSQL 事务；Control 移除 inline publish queue；Worker 支持 contract-versioned command-scoped job；新增 staging profile、配置开关、运行时数据库能力和 release migration 登记。
- 已验证：`npm test` 1200/1200；工具链、secret scan、staging isolation、V2 build、V2 artifact audit、046 migration audit 均通过；默认 bundled Chromium E2E 仍需在本 Run 最终构建后复跑并记录。
- 真实 staging：046 已应用；Dispatcher 使用真实 staging PostgreSQL 执行安全 DB 探针，返回 `0/0/0`；没有写入真实发布命令，没有调用 SHEIN。
- 仍未闭合：真实 staging Outbox→队列→Worker 投递演练、远端 GitHub Actions runner；`SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED` 继续保持 false。
- 当前结论：`GATE_FAILED`；不得启动 ERP-04。下一步只能围绕本 Run 剩余门禁补证，或在完整 ERP 计划明确要求的后续发布执行步骤中继续，不得把本桥接实现冒充 ERP-09 完成。
