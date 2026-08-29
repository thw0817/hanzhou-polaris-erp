# ERP-06 数据模型与事件账本设计

版本：2026-08-30-v11
状态：`IN_PROGRESS`（非生产设计、版本冻结、原子交接、Outbox claim/lease、Worker dry-run、SHEIN adapter boundary、结果持久化、官方回读落账与单阶段编排隔离验证）
适用边界：COS-first；历史数据冻结只读；不执行生产迁移、不修改历史记录、不调用 SHEIN 写接口

## 0. 本文用途

本文是 ERP-06 第一阶段的可审查设计契约，承接 17 个业务板块方案中关于商品版本、媒体资产、发布尝试、平台映射和事件闭环的 P0 地基。本文不等于已经执行的数据库迁移，也不授权生产环境写入。

当前正式决策：

> 批准采用 COS-first：历史数据冻结只读，新系统以 COS 为文件主存储，数据库保留元数据与业务引用，允许 ERP-05 历史映射豁免后进入 ERP-06。

## 1. 范围、非目标与现状证据

### 1.1 本 Run 交付范围

1. 明确文件本体、数据库元数据、业务引用、版本所有权、发布尝试和平台身份之间的边界。
2. 设计新链路的不可变事实模型与 append-only 事件账本。
3. 设计旧表只读兼容 adapter，避免把历史脏关系伪造成新版本事实。
4. 设计 additive migration 的 preflight、隔离 rehearsal、verify 和 rollback 契约。
5. 形成最小失败回归矩阵，供后续代码实现和非生产测试使用。

### 1.2 明确不在本 Run 内

- 不执行生产 PostgreSQL migration，不向现有生产表写入新字段或新行。
- 不删除、恢复、复制、改名或重新上传历史 COS 对象。
- 不删除、恢复、重试或批量改写 187 条无远端对象的历史媒体记录。
- 不给历史记录强行补建 `ProductVersion`、`PublishAttempt` 或 `PlatformProductLink`。
- 不启用 SHEIN 发布、不发送 SHEIN 写请求、不重放 `result_unknown`。
- 不把前端显示、数据库孤立行或本地回执字段当作平台成功证据。

### 1.3 已知现状

- 现有 `media_assets` 已把对象存储作为文件本体，PostgreSQL 保存对象元数据；现有引用类型仍主要面向 Draft、PublishJob、SPU/SKC 等旧模型。
- 现有 `product_drafts` 是可变协作草稿，不能直接作为不可变发布事实。
- 现有 `publish_jobs` 以 `product_draft_id` 为主要关联，不能替代独立的版本和尝试实体。
- 现有 `publish_receipts`、`publish_outbox_events` 已有回执和投递保护，但仍围绕旧 `publish_job` 结构；后续必须 additive 扩展或建立新关联，不能静默改变旧迁移语义。
- ERP-05 只读对账已确认 633 个 COS 对象与数据库媒体记录匹配；187 条历史媒体记录无远端对象且当前无业务引用。这是事实边界，不是待自动修复的队列。

## 2. COS-first 正式契约

### 2.1 权威性分工

| 内容 | 权威来源 | 数据库职责 |
|---|---|---|
| 文件字节、对象存在性 | COS | 不存文件字节；保存 provider、bucket、object key 和核验结果 |
| 文件 hash、大小、类型、尺寸 | 服务端完整性核验结果 | 保存可审计元数据与核验时间 |
| 商品/版本/媒体用途和顺序 | PostgreSQL | 保存业务引用、版本所有权和变更事件 |
| 平台商品 ID、平台版本、平台回执 | SHEIN 官方回读/回执/Webhook | 保存来源、trace、dedupe key 和原始脱敏载荷 |
| 历史无法证明的关系 | 历史 legacy 分类 | 只读展示，不冒充新事实 |

### 2.2 新文件流程

```text
UploadSession
  -> COS 直传
  -> 服务端 HEAD/完整性核验（存在、大小、hash、content-type、租户范围）
  -> 注册或幂等复用 MediaAsset 元数据
  -> 建立 Draft/Revision/Version 的业务引用
  -> 发布前再次核对 VersionMedia 所有权
```

硬规则：

1. COS 对象核验失败时，不得登记为可发布媒体，也不得仅凭数据库行判定上传成功。
2. 业务引用只能指向已经通过完整性核验的资产；`pending`、`failed`、`missing`、`unknown` 均 fail closed。
3. 同一 `(provider, bucket, object_key)` 必须幂等；同 key 内容 hash 冲突时拒绝复用并产生安全事件。
4. 运行日志只记录脱敏的 asset ID、hash 摘要和对象 key 摘要，不输出 SecretId、SecretKey、签名或完整私密配置。
5. 对象删除必须经过独立保留期、引用归零、审计和单独批准；本 Run 不执行删除。

## 3. 目标事实模型（只设计，不落生产）

### 3.1 商品与版本

| 实体 | 事实含义 | 可变性 | 关键边界 |
|---|---|---|---|
| `CatalogProduct` | 租户/店铺范围内稳定的本地商品身份 | 身份不可替换；展示字段可变 | 不等于 SHEIN 平台商品 ID |
| `ProductDraft` | 用户正在编辑的工作态 | 可变 | 只能作为编辑入口，不能直接成为发布事实 |
| `DraftRevision` | 某次保存/预检的完整快照 | 不可变 | 保存 schemaVersion、revisionNo、输入指纹和创建者 |
| `ProductVersion` | 准备被平台处理的完整商品版本 | 不可变 | 只引用一个 DraftRevision；版本指纹稳定 |
| `ProductVersionMedia` | 版本拥有的媒体、用途、槽位和顺序 | 不可变 | 不能依赖 Draft 当前引用才能还原发布素材 |

`ProductVersion` 至少需要能独立还原：租户、店铺、CatalogProduct、来源 DraftRevision、schema/template/preflight 指纹、商品字段快照、SKU/SKC 版本快照、媒体引用快照和创建者。任何“当前 Draft 改了什么”都不能反向改变已创建版本。

### 3.2 发布与平台映射

| 实体 | 事实含义 | 关键规则 |
|---|---|---|
| `PublishBatch` | 一次用户选择/批准的发布候选集合与策略快照 | `(tenant_id, store_id, idempotency_key)` 幂等；选择指纹冲突拒绝复用；批次只是 UI/审计聚合，不等于一次 SHEIN 请求 |
| `PublishBatchItem` | 批次中一个 ProductVersion 的显式关联项 | 必须同时绑定 tenant/store、CatalogProduct、来源 Draft 和 ProductVersion；handoff 前 `pending`，成功后绑定唯一 Attempt |
| `PublishAttempt` | 对一个 ProductVersion 的一次提交尝试 | 每次首次提交、用户批准的修正重发、合规阻断后的新尝试都生成新 ID |
| `PublishCommand` | 某个 Attempt 的冻结发送意图 | 包含不可变请求摘要/指纹、能力和幂等键；不保存原始密钥或不必要的完整请求体 |
| `PlatformProductLink` | 本地版本与 SHEIN 平台身份的可审计映射 | 只有官方回执/回读/Webhook 等证据才能建立或更新 |
| `PublishReceipt` | 平台或受信入口返回的事实记录 | append-only；必须标明来源、dedupe key、发生时间和证据等级 |

以下关系必须成立：

```text
PublishBatch -> PublishBatchItem -> ProductVersion -> PublishAttempt -> PublishCommand
ProductDraft -> DraftRevision -> ProductVersion
                                                   -> PlatformProductLink（仅官方证据）
                                                   -> PublishReceipt/Event
```

旧 `publish_batches` / `publish_batch_items` 表通过 nullable additive 字段接入新链路；历史行不补填新身份。旧 `publish_jobs` / `publish_receipts` 只通过 `legacy_readonly` adapter 展示，永远不反向生成 ProductVersion、PublishAttempt 或新批次项。

`PublishAttempt` 的 `result_unknown` 是终态保护状态而不是普通失败：在得到官方回读或人工确认前，系统不得自动创建重发 Command。若用户确实要修正并重发，必须先创建新的 Draft、DraftRevision、ProductVersion 和 PublishAttempt，并记录 `supersedes_attempt_id` / `reason`，不能复用旧 Attempt。

### 3.3 媒体与对象引用

现有 `media_assets` 继续作为对象元数据基础表；目标模型通过 additive 方式补足以下语义：

- `integrity_state`：`pending_verification`、`verified`、`failed`、`missing`、`unknown`。
- `verified_at`、`verified_size_bytes`、`verified_sha256` 和 `verification_source`。
- `legacy_disposition`：`none`、`legacy_unversioned`、`frozen_missing`。
- 独立的 `ProductVersionMedia` 记录：`product_version_id`、`asset_id`、用途/槽位、排序、变体角色、来源指纹和创建事件。
- 业务引用计数必须由可重算的引用事实得到，不能只信手工计数器。

旧 `media_asset_references` 记录不自动升级成 `ProductVersionMedia`。缺少安全版本身份的旧引用保持 legacy；新版本只能建立新的、带版本所有权的引用。

### 3.4 事件账本与 Inbox/Outbox

目标是建立租户/店铺隔离的 append-only `ProductEvent`，建议事件类别包括：

- `draft_revision_created`
- `product_version_created`
- `media_verified` / `media_verification_failed`
- `version_media_attached`
- `publish_attempt_created`
- `publish_command_requested`
- `publish_command_dispatched`
- `platform_receipt_recorded`
- `official_readback_recorded`
- `platform_link_established`
- `attempt_result_unknown`
- `attempt_superseded`

官方 Webhook/回读进入受控 `OfficialEventInbox`：先按来源、事件 ID、签名/结构和租户店铺范围验收，再以幂等键落账；禁止直接覆盖当前状态。投递意图进入 `PublishOutbox`，队列成功只代表投递事实，不代表 SHEIN 成功。

ERP-06 Outbox Dispatcher/Worker 的隔离契约：Dispatcher 只在同一 `tenant_id/store_id` 内领取 `pending`、可重试 `failed` 或已过期 `dispatching` 行，使用 `FOR UPDATE SKIP LOCKED`、递增 `attempt_count` 和 lease；只有关联 Command=`queued` 且 Attempt 不为 `result_unknown`/`superseded_by_new_attempt` 时才可领取。队列 job 的 `jobId` 固定为 `publish_command_id`，payload 只包含 scope、Batch/BatchItem/Attempt/Version/Revision 身份、contract version 和不可变版本指纹，不包含凭证、raw body 或图片地址。队列加入成功后必须用相同 lease 标记 Outbox=`dispatched`；lease 失效或队列失败则 fail closed 并记录受控错误。

Worker 只领取 Outbox=`dispatched` 且同 scope、Attempt 仍可执行的 Command；领取时写入 worker claim/lease，隔离 dry-run 随后释放回 Command=`queued`，不执行 SHEIN adapter、远端 HTTP、COS 或真实队列消费者。Attempt=`result_unknown` 的 Command 不可再次领取，必须先走官方回读/人工决策边界。

每条事件至少包含：事件 ID、租户/店铺、aggregate type/ID、event type、schema version、发生时间、写入时间、producer、dedupe key、前序事件/版本指针、脱敏 payload、payload hash 和审计主体。状态投影只能从合法事件归并，不能由 UI 直接写成功状态。

## 4. 身份、唯一键与隔离

1. 所有新表必须带 `tenant_id`；店铺范围事实必须带 `store_id`，跨店操作必须显式列出授权范围。
2. `ProductVersion` 的唯一性至少由 `(tenant_id, store_id, catalog_product_id, version_no)` 和不可变 `version_fingerprint` 共同保护。
3. `PublishBatch` 的幂等键必须限定在 `(tenant_id, store_id, idempotency_key)` 内；同 key 的 selection fingerprint 不一致必须拒绝。
4. `PublishBatchItem` 必须在同一 scope 内绑定 Batch、Draft、CatalogProduct、ProductVersion；handoff 后只能绑定一个 Attempt。
5. `PublishAttempt` 的幂等键必须限定在 `(tenant_id, store_id, product_version_id, attempt_no/request_key)` 内；重发不能覆盖旧尝试。
6. `ProductVersionMedia` 在同一版本内对 `(asset_id, role, slot, sort_order)` 做明确约束；删除引用采用事件，不物理删除发布事实。
7. `PlatformProductLink` 不能只凭 SKU/SPU 文本相等建立；必须绑定店铺、平台 identity、平台 version（如果平台提供）和证据来源。
8. 所有查询、事件消费、缓存键和 outbox lease 都必须验证租户/店铺边界；跨租户 ID 碰撞必须 fail closed。

## 5. 状态语义与禁止转换

### 5.1 媒体状态

```text
pending_verification -> verified
pending_verification -> failed | missing | unknown
verified -> referenced -> pending_delete -> deleted
```

`verified` 不是平台已接受；`referenced` 不是商品已发布；`deleted` 不能被旧引用重新激活，需新对象/新资产事实。

### 5.2 发布尝试状态

```text
created -> preflight_passed -> authorized -> dispatched
dispatched -> submitted -> readback_pending -> completed
dispatched -> result_unknown
created/preflight_passed -> failed_terminal
result_unknown -> resolved_by_official_readback | superseded_by_new_attempt
```

禁止：

- `result_unknown -> dispatched` 的自动回环；
- 把失败 Attempt 改写为成功 Attempt；
- 用新版本的回执更新旧版本；
- 没有官方 evidence 的本地 `completed`；
- 用一个“重试次数”覆盖多次独立 Attempt。

## 6. 历史兼容策略

### 6.1 冻结范围

- 633 个已完成 COS 对账的对象可以作为新系统候选资产，但使用前仍需按新流程做存在性/完整性核验。
- 187 条无远端对象且无业务引用的历史媒体记录标记为冻结 legacy，只读展示和审计；不删除、不恢复、不补对象、不重试。
- 无法建立安全 ProductVersion/PublishAttempt/PlatformProductLink 的旧商品、发布和回执关系统一归入 `legacy_unversioned` 或 `UNKNOWN`。

### 6.2 Adapter 规则

1. Legacy adapter 只读旧表，把旧 Draft/Job/Receipt 映射成展示 DTO，不反向写旧表，不制造新版本事实。
2. 旧的 `product_draft_id` 只能作为 `legacy_source_id`，不能直接填入新 `product_version_id`。
3. 只有经过人工/官方双重证据核验的历史关系，未来才可单独建立“已证明的迁移事实”；当前不做回填。
4. 新系统查询必须能区分 `current_v2` 与 `legacy_readonly`，不允许把两者合并为一个“已发布”状态。
5. 历史读模型出现未知时，显示 `UNKNOWN`/`legacy_unversioned`，不以猜测补全。

## 7. Additive migration 与切换契约

### 7.1 迁移原则

- 只新增表、索引、约束和可回填的非破坏字段；不修改已执行旧 migration 文件。
- 旧表 checksum 不得变化；当前迁移运行器的版本排序和重复编号风险先记录，不能在本 Run 通过重排旧文件解决。
- 新代码先双读只读验证，再打开新模型写入；切换开关默认关闭，生产写入仍需独立批准。
- 不把历史 187 条记录作为新模型回填成功率指标。

### 7.2 Preflight / rehearsal / verify

1. **Preflight**：校验数据库版本、旧 migration checksum、扩展/权限、目标表不存在或结构兼容、备份可恢复性和租户/店铺计数基线。
2. **隔离 rehearsal**：复制脱敏结构与最小样本，在本地/隔离 PostgreSQL 执行 additive migrations；验证唯一键、外键、RLS/查询边界、并发幂等和旧读路径。
3. **Verify**：逐表记录 schema fingerprint、行数、索引/约束存在性、事件顺序、COS 核验结果和旧读回归结果；禁止输出密钥和完整对象私密配置。
4. **Rollback**：优先关闭新模型读取/写入开关并保留新增事实；若需数据库回滚，只在隔离环境演练可逆脚本，生产是否清理新增对象必须另行批准，不能使用宽范围删除。
5. **Cutover**：新上传、新 DraftRevision、新 ProductVersion、新 Attempt 只能走新链路；历史 legacy 永远走只读 adapter。

## 8. 最小失败回归矩阵

| 场景 | 预期结果 |
|---|---|
| COS 直传后对象不存在 | 不登记为 `verified`；不能建立可发布引用 |
| COS 对象存在但 hash/大小不符 | 阻断版本创建或发布；产生核验失败事件 |
| 同 key 同 hash 重复上传 | 幂等复用同一资产事实，不重复创建业务引用 |
| 同 key hash 冲突 | 拒绝复用，产生冲突审计事件 |
| Draft 修改后读取旧 ProductVersion | 旧版本字段和媒体仍完全可还原 |
| 同一版本重复点击发布 | 只产生一个幂等 Command/Attempt，重复请求可审计 |
| 同一批次 idempotencyKey 但选择指纹不同 | 拒绝复用，不新增 BatchItem |
| Handoff 指定的 BatchItem 不属于 Batch/Version/Draft | fail closed，不写 Attempt/Command/Outbox |
| `result_unknown` 后队列再次投递 | 必须拒绝，不得自动生成重发 |
| 用户确认修正并重发 | 必须新建 Draft、Revision、ProductVersion、Attempt，并记录 supersedes/reason |
| 无官方证据的本地“成功”回执 | 只能是本地 receipt，不能建立 PlatformProductLink 或 completed |
| 旧 legacy 记录被新写路径读取 | 只读展示，不自动回填、不改变旧状态 |
| 跨租户/跨店铺引用 | fail closed，不返回或写入越界数据 |
| 新模型开关关闭 | 旧读路径仍可用；无生产写入 |

## 9. ERP-06 第一阶段完成门

本 Run 只有同时满足以下条件才能从 `IN_PROGRESS` 变为 `COMPLETE`：

1. 本文与 17 板块架构、主计划、执行台账和交接文档中的 COS-first 边界一致。
2. ProductDraft、DraftRevision、ProductVersion、ProductVersionMedia、PublishAttempt、PublishCommand、PlatformProductLink、ProductEvent、OfficialEventInbox 和 PublishOutbox 的字段职责、唯一键、状态转换与租户边界经过审查。
3. Legacy adapter 明确只读，187 条历史缺失记录没有被迁移、恢复、删除或改写。
4. Additive migration 的 preflight、隔离 rehearsal、verify、rollback 和 cutover 契约可以转化为测试用例。
5. 最小失败回归矩阵在本地/隔离环境通过；没有生产数据库、COS、Redis、队列或 SHEIN 写入。
6. 完成报告列出实际文件、测试命令、差异摘要和仍需单独批准的生产事项。

在完成门通过前，ERP-07～ERP-23 不进入实施；ERP-06 后续代码实现也必须保持本文件边界。

## 10. 当前状态与下一 Run

- 当前 Run：`RUN-20260830-ERP06-OFFICIAL-READBACK-ORCHESTRATION-15`
- 当前状态：`COMPLETE`（本 Run 隔离官方回读单阶段编排与全量门禁已完成；ERP-06 整体仍为 `IN_PROGRESS`）
- 已完成：COS-first 决策登记、ERP-05 历史映射冻结豁免登记、目标模型 additive migration 草案、preflight/verify/rollback、真实本机 PostgreSQL 隔离 rehearsal、DraftRevision/ProductVersion 版本冻结、ProductVersion → PublishAttempt → PublishCommand → ProductPublishOutbox 原子交接、PublishBatch/BatchItem 显式关联和 legacy read-only adapter 最小实现。
- 本 Run 实现边界：PublishBatch 服务按租户/店铺和 selection fingerprint 幂等创建 BatchItem；handoff 在同一事务内锁定 Batch/BatchItem，验证 Draft/Version 来源关系，建立 Attempt=`created`、Command=`queued`、Outbox=`pending`、current pointers、Draft=`handed_off`/lockVersion+1、BatchItem=`handed_off` 和 4 类 ProductEvent；不修改旧历史行，不调用远端。
- 失败保护：同一批次 idempotencyKey 选择指纹冲突拒绝；BatchItem 越界/错版本/已交接拒绝；同一 ProductVersion 已存在任意 Attempt 时阻断新 requestKey；已有 requestKey 只有在 BatchItem、Command、Outbox、current projection 和 Draft 状态完整时才幂等返回；`result_unknown` 仅允许原请求幂等回读，不自动重发。
- Legacy 边界：adapter 只读 `publish_jobs`/`publish_receipts`，输出 `legacy_readonly` 与 `legacy_unknown` 等明确分类，ProductVersion/PublishAttempt 恒为 null，禁止读取 raw JSON 凭证和任何旧表写入。
- 已验证：批次/adapter/handoff/foundation 定向测试 `23/23`；全量测试 `1231/1231`；`npm run ci:secret-scan` 通过且 `findings=[]`；`npm run build:v2` 通过；`git diff --check` 通过；独立本机 PostgreSQL `postgres:16-alpine` 的 handoff 批次演练和 foundation rollback 重跑均通过，临时容器已移除，staging 容器未触碰。
- 已完成本 Run：隔离 Outbox Dispatcher/Worker 服务、确定性最小 job contract、Command/Outbox worker lease 字段、队列失败回归、`result_unknown` 禁止领取回归，以及真实一次性 PostgreSQL claim/dispatch/dry-run/rejection rehearsal。
- 已验证：ERP-06 相关定向回归 `29/29`（含前序 handoff/foundation/Batch/adapter 与本 Run 6 项）；本 Run 的临时 PostgreSQL rehearsal 通过，容器已移除，现有 staging 未触碰；本 Run 没有生产数据库、COS、Redis、真实队列或 SHEIN 写入。
- 已完成当前 Run 的隔离实现：真实 `publishOrEdit` adapter boundary、同 scope/版本指纹校验、敏感 source 拒绝、显式授权与发送前 `send_started` hook、成功/明确失败/`result_unknown` 分类，以及官方 `query-document-state` 无网络回读占位。
- 已完成本 Run 的隔离实现：`PostgresErp06PublishResultRepository` 复用既有 `PublishAttempt`/`PublishCommand`/`ProductEvent`/`ProductPublishReceipt` 事实边界；`send_started` 与 Command 时间戳在同一事务内提交；平台结果回执、事件和 Attempt/Command 状态在同一事务内提交。
- 结果映射固定为：官方接受 → `accepted/submitted`；明确失败 → `failed/known_failed` 或 `failed_terminal`；网络/响应不完整 → `unknown/result_unknown`，不可重试；重复同一结果按 dedupe 幂等返回；不会创建或修改 `PlatformProductLink`。
- 本 Run 新增隔离草案与回归：[erp06-publish-result-repository.js](../server/cloud/erp06-publish-result-repository.js)、[erp06-publish-result-repository.test.js](../server/cloud/erp06-publish-result-repository.test.js)、`048_erp06_publish_result_persistence.sql`、`preflight-048.sql`、`verify-048.sql`、`rollback-048_empty.sql`；048 只在 `erp06-draft/`，未登记 `server/cloud/migrations/`。
- 失败保护：scope/版本/claim 漂移、未先 `send_started`、`result_unknown` 覆盖、敏感字段和事务中途失败均 fail closed；失败回归使用内存 fake pool，未向任何生产或现有 staging 数据库写入。
- 当前 Run 定向回归：新结果持久化回归 `12/12`、ERP-06 相关定向回归 `72/72`；全量测试 `1259/1259`、服务端测试 `125/125`；秘密扫描 `findings=[]`；V2 构建与 release audit 通过；`node --check`/`git diff --check` 通过；只读 staging 核对显示 Redis/PostgreSQL/MinIO 均 healthy，未触碰。
- 本 Run 新增隔离 Worker 编排：只消费 `erp06-publish-command-v1`，按租户/店铺、Command、Attempt、ProductVersion、版本指纹和 Worker claim 做 fail-closed 校验；claim 成功后通过 adapter 触发 `send_started`，再将 accepted/failed/unknown 结果交给结果 repository；`not_sent` 仅允许显式 dry-run 释放回 queued。
- 本 Run 失败保护：未 claim 不构造 adapter；Command identity/scope/指纹漂移不执行；`result_unknown`/`superseded_by_new_attempt` 不执行；结果持久化失败不释放、不重试；非 `not_sent` 结果必须同时证明 `remoteCallMade=true` 与 `sendStarted=true`。
- 本 Run 实际文件：[erp06-publish-worker-service.js](../server/cloud/erp06-publish-worker-service.js)、[erp06-publish-worker-service.test.js](../server/cloud/erp06-publish-worker-service.test.js)；Worker 只依赖隔离 command/result repository 与 adapter factory，没有接入生产队列、生产 Worker、真实 sender、凭证或 SHEIN HTTP。
- 本 Run 已验证：Worker 回归 `7/7`；ERP-06 相关定向回归 `79/79`；全量测试 `1266/1266`、服务端测试 `125/125`；秘密扫描 `findings=[]`；V2 构建、release audit、`node --check`、`git diff --check` 均通过；staging 仅只读核对，未触碰。
- 本 Run 新增隔离真实远端边界：`erp06-publish-command-v1` 经严格身份、租户/店铺、ProductVersion 和版本指纹校验后，才能进入显式授权的 SHEIN sender；官方单据状态与 SPU 信息回读分别固定为 `/open-api/goods/query-document-state` 与 `/open-api/goods/spu-info`，只复用已确认的官方请求体和既有安全投影器，不在边界层持久化回读结果。
- 本 Run 的远端安全开关默认关闭：`executionEnabled=false`、`readbackEnabled=false`；未显式授权时不解析凭证、不构造网络请求、不连接 SHEIN。发布授权还要求 Attempt=`claimed`；回读只允许 Attempt=`submitted`/`result_unknown`，空回读、版本不一致或 SPU 不完整均不得解除 `result_unknown`。
- 本 Run 实际文件：[erp06-shein-remote-boundary.js](../server/cloud/erp06-shein-remote-boundary.js)、[erp06-shein-remote-boundary.test.js](../server/cloud/erp06-shein-remote-boundary.test.js)；新隔离回归 `9/9`，包含默认禁网、显式授权、精确 endpoint/body、上游错误透传、空/不完整回读和 SPU 关系投影。
- 本 Run 已验证：边界定向组合 `40/40`；全量测试 `1275/1275`；服务端测试 `125/125`；秘密扫描 `scannedFiles=627, findings=[]`；V2 构建、release audit、`node --check`、`git diff --check` 均通过；现有 staging Redis/PostgreSQL/MinIO 仅只读核对且未触碰。
- 本 Run 状态：`COMPLETE`。本边界仍未接入生产 Worker、真实凭证解析、生产队列或任何真实 SHEIN HTTP；ERP-06 整体仍为 `IN_PROGRESS`。
- 本 Run 新增隔离官方回读事实落账：复用 047 草案已有 `official_event_inbox`、`product_publish_receipts`、`product_events`，在同一事务内保存安全 projection、dedupe/fingerprint、trace 和官方证据来源；不保存 raw response、图片地址或凭证，不建立 `PlatformProductLink`。
- 回读落账状态固定为：完整且可对应的官方证据 → Inbox=`accepted`、Receipt=`readback/accepted`；空、部分或不可解除未知的官方响应 → Inbox=`unknown`、Receipt=`readback/unknown`；`result_unknown` 只有 `resolvesResultUnknown=true` 时转为 `resolved_by_official_readback`，`submitted` 不被改成 `completed`。
- 本 Run 实际文件：[erp06-official-readback-repository.js](../server/cloud/erp06-official-readback-repository.js)、[erp06-official-readback-repository.test.js](../server/cloud/erp06-official-readback-repository.test.js)；新回归 `8/8`，覆盖原子三事实、幂等、空回读、SPU 回读、scope/版本漂移、敏感字段和无破坏性 SQL。
- 本 Run 已验证：组合定向回归 `60/60`；全量测试 `1283/1283`；服务端测试 `125/125`；秘密扫描 `scannedFiles=629, findings=[]`；V2 构建、release audit、`node --check`、`git diff --check` 均通过；现有 staging Redis/PostgreSQL/MinIO 仅只读核对且未触碰。
- 本 Run 状态：`COMPLETE`。回读 repository 仍未接入生产 Worker、真实凭证、生产队列或真实 SHEIN HTTP；ERP-06 整体仍为 `IN_PROGRESS`。
- 本 Run 新增隔离官方回读编排：一次操作必须明确选择 `document_state` 或 `spu_info`，只调用对应的远端边界方法；关闭态直接返回 disabled 且不落账，成功回读只向 repository 传递一次安全 projection。
- 编排契约固定校验队列任务、租户/店铺/Command/Attempt/ProductVersion、版本指纹、官方 stage/endpoint、`read` 状态和 dry-run projection；禁止隐式切换另一个回读阶段、自动重试、重发或把 `submitted` 伪造成 `completed`。
- 本 Run 实际文件：[erp06-official-readback-orchestrator.js](../server/cloud/erp06-official-readback-orchestrator.js)、[erp06-official-readback-orchestrator.test.js](../server/cloud/erp06-official-readback-orchestrator.test.js)；未接入生产 Worker、路由、队列或正式 migration。
- 本 Run 已验证：新编排回归 `8/8`；组合定向回归 `68/68`；全量测试 `1291/1291`；服务端测试 `125/125`；秘密扫描 `scannedFiles=631, findings=[]`；V2 构建、release audit、`node --check`、`git diff --check` 均通过；现有 staging Redis/PostgreSQL/MinIO 仅只读核对且未触碰。
- 本 Run 状态：`COMPLETE`。单阶段官方回读编排仍只存在于隔离模块，未配置真实凭证、生产队列、生产持久化或真实 SHEIN HTTP；ERP-06 整体仍为 `IN_PROGRESS`。
- 尚未完成：真实 SHEIN sender/签名凭证、生产 Worker/队列、官方 Webhook、回读生产持久化接入、生产切换评估、正式生产迁移、历史数据迁移和 SHEIN 写入均未执行；旧历史继续只读，不因本 Run 自动映射。
- 下一执行单元：单独评审预发/生产的真实凭证来源、网络出口、Worker/队列接入、回读持久化接线、监控和回滚证据；在 ERP-06 完成门通过且另行批准前，不接入生产、不执行生产迁移、不进入 ERP-07。
