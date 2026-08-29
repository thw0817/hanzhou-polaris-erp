# ERP-06 additive model foundation draft

状态：`DRAFT / ISOLATED ONLY`

本目录是 ERP-06 的第一份数据库草案，不是已执行迁移。`047_erp06_model_foundation.sql` 特意不放进 `server/cloud/migrations/`，因此不会被生产迁移器自动发现，也不会进入本 Run 的云端部署包。

## 本草案覆盖

- `CatalogProduct` / `CatalogSku`：稳定的租户/店铺内本地身份。
- `DraftRevision`：可变 `product_drafts` 的不可变快照。
- `ProductVersion` / `ProductVersionSku` / `ProductVersionMedia`：handoff 后可独立还原的不可变版本事实。
- `PublishBatch` / `PublishBatchItem`：批次 UI 聚合与每个 ProductVersion 的显式绑定；旧批次行保持 legacy，不回填。
- `PublishAttempt` / `PublishCommand` / `PublishReceipt`：版本级尝试、幂等键、平台事实和 `result_unknown` 禁止重发保护。
- `CatalogProduct.current_version_id/current_attempt_id`：同一事务内维护的当前版本/尝试读投影，不替代不可变事实。
- `PlatformProductLink`：必须带官方证据，不能凭本地成功字段建立。
- `ProductEvent`：租户/店铺范围的追加式事件账本。
- `OfficialEventInbox` / `ProductPublishOutbox`：官方事实入口和发布投递意图，投递成功不等于平台成功；Outbox 必须按租户/店铺 claim，使用租约和确定性 `jobId`，不可投递 `result_unknown` Attempt。
- `media_assets`：只补 COS 核验元数据；不复制文件字节，不回填历史 187 条缺失对象。

## 严格边界

1. 只在名字包含 `test`、`rehearsal` 或 `scratch` 的本机 PostgreSQL 数据库演练。
2. 不连接生产 PostgreSQL、COS、Redis、队列或 SHEIN；不执行上传、删除、发布、重发或历史回填。
3. 不修改 `server/cloud/migrations/` 中任何已执行文件；重复编号 `014` 保持原样。
4. 失败回归必须失败：未验证 COS 资产不能建立 `ProductVersionMedia`；跨租户/跨店铺外键失败；旧版本/修订/媒体/事件不能 UPDATE/DELETE；`result_unknown` Attempt 不能创建可投递 Command，也不能回到 `dispatched`。
5. 新交接必须携带并校验 `PublishBatch`、`PublishBatchItem`、`ProductVersion` 三者的租户/店铺和来源草稿关系；批次项成功交接后才绑定 `PublishAttempt`。
6. 旧 `publish_jobs`/`publish_receipts` 只能经 legacy read-only adapter 读取；不生成 ProductVersion/Attempt，不写回旧表，不把 `result_unknown` 自动重发。
7. 回滚脚本只允许空的新事实表，并且只允许隔离数据库；生产清理不在本 Run 授权范围内。

## 文件角色

| 文件 | 用途 |
| --- | --- |
| `047_erp06_model_foundation.sql` | additive DDL、约束、触发器和索引；仅供隔离 rehearsal 复制执行 |
| `preflight.sql` | 检查旧迁移账本、扩展、旧表和目标表缺失 |
| `verify.sql` | 检查表、约束、媒体核验字段和历史未回填 |
| `rollback_empty.sql` | 只在空隔离库中演练可逆清理 |
| `README.md` | 人工审查边界与执行说明 |

## 本 Run 新增实现

- `server/cloud/erp06-publish-batch-service.js`：创建带选择指纹的 PublishBatch/BatchItem；同一租户/店铺内幂等，选择冲突或关联不完整时 fail closed。
- `server/cloud/erp06-legacy-readonly-adapter.js`：只读投影旧 publish_jobs/publish_receipts；输出明确的 `legacy_readonly`/`legacy_unknown`，不泄露旧 JSON 中的凭证字段。
- `server/cloud/erp06-outbox-dispatcher-service.js`：隔离的 Outbox Dispatcher/Worker claim、租约、确定性 job contract 和 dry-run release；不导入 SHEIN/远端执行器。
- `server/cloud/erp06-outbox-dispatcher-service.test.js`：验证作用域、租约、队列失败、确定性最小 payload、Worker 无远端调用和 `result_unknown` 禁止领取。
- `server/cloud/erp06-shein-publish-adapter-contract.js`：隔离的真实 SHEIN `publishOrEdit` adapter boundary；只接受已校验的 ERP-06 Command 与冻结版本 source，发送前要求 `send_started` 持久化，默认关闭远端写。
- `server/cloud/erp06-shein-publish-adapter-contract.test.js`：验证 endpoint/身份/指纹/敏感字段、显式授权、发送前持久化、成功/明确失败/`result_unknown` 分类，以及官方单据状态回读占位不联网。
- `server/cloud/erp06-publish-result-repository.js`：隔离的 `send_started`/平台结果持久化服务；在同一事务内写入不可变事件、回执和 Attempt/Command 状态，拒绝 scope/claim/敏感字段漂移。
- `server/cloud/erp06-publish-result-repository.test.js`：验证 048 additive 草案、发送前事件、幂等回调、成功/失败/`result_unknown` 结果、版本漂移、敏感字段和事务回滚。
- `server/cloud/erp06-publish-worker-service.js`：隔离的 ERP-06 Worker 编排；claim 后验证 Command/Attempt/Version 指纹，串联 adapter、`send_started` 和结果 repository，`not_sent` 仅支持显式 dry-run 释放。
- `server/cloud/erp06-publish-worker-service.test.js`：验证 Worker 契约、claim 作用域、未 claim no-op、版本漂移、`result_unknown`/superseded 阻断、发送顺序和结果持久化失败不重试。
- `server/cloud/erp06-shein-remote-boundary.js`：隔离的 Worker → sender → 官方回读边界；发布与回读均做精确 endpoint/body、scope、版本指纹和授权校验，默认禁网，回读只返回安全投影，不在边界层持久化。
- `server/cloud/erp06-shein-remote-boundary.test.js`：验证默认禁网、凭证延迟解析、显式 publishing/readback authorization、上游错误透传、官方单据状态/SPU 请求体、空/部分/版本漂移回读和 `result_unknown` 不解除保护。
- `server/cloud/erp06-official-readback-repository.js`：隔离官方回读事实落账；在同一事务内写入 OfficialEventInbox、readback Receipt 和 ProductEvent，使用 projection fingerprint 幂等，完整证据才允许解除 `result_unknown`。
- `server/cloud/erp06-official-readback-repository.test.js`：验证三类事实原子落账、重复回读幂等、空/部分回读保持 unknown、submitted 不伪造成 completed、scope/版本/敏感字段 fail closed 和事务回滚边界。
- `server/cloud/erp06-official-readback-orchestrator.js`：隔离的单阶段官方回读编排；一次只选择 `document_state` 或 `spu_info`，关闭态不落账，成功回读只向既有 repository 传递一次安全 projection，不自动重试或切换阶段。
- `server/cloud/erp06-official-readback-orchestrator.test.js`：验证关闭态零网络/零落账、两个阶段单路径、scope/版本指纹、授权/危险结果/空回读和 repository 失败不重试。
- `048_erp06_publish_result_persistence.sql`、`preflight-048.sql`、`verify-048.sql`、`rollback-048_empty.sql`：只用于一次性隔离数据库的 Command 时间字段与安全校验，未登记为正式 migration。
- 以上服务及 handoff 的失败回归只使用 fake pool 和本地一次性数据库；没有接入生产路由、生产 Dispatcher、真实 Worker 或 SHEIN 写接口。

## 未在本 Run 做的事

- 没有向生产 PostgreSQL 添加字段或表。
- 没有把历史 `product_drafts`、`publish_jobs`、`publish_receipts` 或媒体引用转换为新事实。
- 没有打开新模型写开关，没有接入新发布 worker，没有发送 SHEIN 写请求。
- 没有把发布 Outbox 接入生产 dispatcher；本 Run 只在隔离内验证 claim/lease、确定性队列 handoff 和 Worker dry-run release，不代表远端发布成功。
- 没有把 adapter contract 接入生产 Worker，没有配置真实 sender、凭证读取或官方回读请求；测试中的 sender 仅为内存 fake。
- 没有把 `047`/`048` 草案登记为正式生产迁移，没有把结果 repository 接入生产 Worker，也没有配置真实 sender、凭证读取或官方回读请求；测试中的 sender/pool 仅为内存 fake。
- 没有把真实 sender/readback boundary 接入生产 Worker，没有开启 `executionEnabled`/`readbackEnabled`，没有配置真实凭证、生产队列或回读持久化；测试中的 request/credential resolver 仅为内存 fake。
- 已完成隔离回读持久化草案，但没有把 repository 接入生产 Worker，没有配置真实凭证、生产队列或 Webhook，也没有新增正式 migration；测试中的 request/credential resolver/pool 仅为内存 fake。
- 已完成隔离单阶段官方回读编排草案，但没有把编排服务接入生产 Worker、路由、生产队列或真实回读；测试中的 remote/repository 仅为内存 fake。
- 下一执行单元：另行评审真实 Worker → sender → 官方回读接入及生产/预发授权；在完成门与单独授权前，不执行生产迁移、生产部署或任何外部写入。
