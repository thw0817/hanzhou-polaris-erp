# ERP-06 additive model foundation draft

状态：`DRAFT / ISOLATED ONLY`

本目录是 ERP-06 的第一份数据库草案，不是已执行迁移。`047_erp06_model_foundation.sql` 特意不放进 `server/cloud/migrations/`，因此不会被生产迁移器自动发现，也不会进入本 Run 的云端部署包。

## 本草案覆盖

- `CatalogProduct` / `CatalogSku`：稳定的租户/店铺内本地身份。
- `DraftRevision`：可变 `product_drafts` 的不可变快照。
- `ProductVersion` / `ProductVersionSku` / `ProductVersionMedia`：handoff 后可独立还原的不可变版本事实。
- `PublishAttempt` / `PublishCommand` / `PublishReceipt`：版本级尝试、幂等键、平台事实和 `result_unknown` 禁止重发保护。
- `PlatformProductLink`：必须带官方证据，不能凭本地成功字段建立。
- `ProductEvent`：租户/店铺范围的追加式事件账本。
- `OfficialEventInbox` / `ProductPublishOutbox`：官方事实入口和发布投递意图，投递成功不等于平台成功。
- `media_assets`：只补 COS 核验元数据；不复制文件字节，不回填历史 187 条缺失对象。

## 严格边界

1. 只在名字包含 `test`、`rehearsal` 或 `scratch` 的本机 PostgreSQL 数据库演练。
2. 不连接生产 PostgreSQL、COS、Redis、队列或 SHEIN；不执行上传、删除、发布、重发或历史回填。
3. 不修改 `server/cloud/migrations/` 中任何已执行文件；重复编号 `014` 保持原样。
4. 失败回归必须失败：未验证 COS 资产不能建立 `ProductVersionMedia`；跨租户/跨店铺外键失败；旧版本/修订/媒体/事件不能 UPDATE/DELETE；`result_unknown` Attempt 不能创建可投递 Command，也不能回到 `dispatched`。
5. 回滚脚本只允许空的新事实表，并且只允许隔离数据库；生产清理不在本 Run 授权范围内。

## 文件角色

| 文件 | 用途 |
| --- | --- |
| `047_erp06_model_foundation.sql` | additive DDL、约束、触发器和索引；仅供隔离 rehearsal 复制执行 |
| `preflight.sql` | 检查旧迁移账本、扩展、旧表和目标表缺失 |
| `verify.sql` | 检查表、约束、媒体核验字段和历史未回填 |
| `rollback_empty.sql` | 只在空隔离库中演练可逆清理 |
| `README.md` | 人工审查边界与执行说明 |

## 未在本 Run 做的事

- 没有向生产 PostgreSQL 添加字段或表。
- 没有把历史 `product_drafts`、`publish_jobs`、`publish_receipts` 或媒体引用转换为新事实。
- 没有打开新模型写开关，没有接入新发布 worker，没有发送 SHEIN 写请求。
- 没有把本草案登记为正式 `047` 生产迁移；通过本地失败回归后仍需单独评审、实现代码和生产批准。
