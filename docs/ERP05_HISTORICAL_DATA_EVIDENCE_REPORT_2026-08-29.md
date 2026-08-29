# ERP-05 历史数据证据审计报告

版本：2026-08-29-v1  
正式 Run：`RUN-20260829-ERP05-HISTORICAL-EVIDENCE-01`  
步骤：ERP-05  
状态：`BLOCKED`（已发现本地投影证据，但仍缺少完整历史事实链，不允许用猜测补齐）
审计时间：2026-08-29（Asia/Shanghai）

## 1. 审计结论

本次 Run 已完成本地静态证据盘点，并发现可逐条读取的本地业务投影和 V2 本地 Draft/Asset 状态；但没有取得完整 PostgreSQL 历史事实链。因此：

1. 本地投影中已确认：1 个 store-scoped business record，包含 1,179 个商品投影、声明 805 个 SPU 和 6,077 个 SKU；V2 本地状态包含 4 个 Draft 和 13 个 Asset。
2. 这些文件不是 PostgreSQL 的 Draft/Batch/Job/Run/Receipt/Review 历史表，也没有证明 ProductVersion、PublishAttempt、PlatformProductLink、Webhook、队列和 Worker 事实链；对应关系仍必须标记为 `UNKNOWN`。
3. 源码和迁移已经证明若干结构性风险：发布 Job 直接绑定可变 Draft、当前迁移没有 ProductVersion 边界、媒体引用没有 ProductVersion 类型、页面存在多路查询和二次归并、草稿列表使用“是否存在任意 Job”排除并受 `LIMIT 100` 影响。
4. ERP-20 的修复范围目前可精确到“本地投影核验 + 结构性风险清单”，仍不能精确到历史记录 ID、租户、店铺、SKC、版本和 Attempt；因此 ERP-05 完成门未通过，ERP-06 不得开始。

本报告没有连接生产 PostgreSQL、Redis、对象存储或 SHEIN API，没有执行任何队列重试、清理、消费、部署、重启、切换或数据库写入。

## 2. 证据边界

### 2.1 已读取的证据

| 证据 | 用途 |
|---|---|
| 当前仓库提交 `7f2abec` 及工作区文件 | 确认 ERP-04 设计基线和本地代码事实 |
| `server/cloud/migrations/*.sql` | 读取当前表、外键、唯一约束、状态约束和索引 |
| `server/cloud/*.js`、前端页面及测试相关文件 | 读取查询、写入边界、状态归并和媒体处理逻辑 |
| `docs/REVIEW_CENTER_SYNC_MAP_2026-08-28.md` | 读取审核中心页面 fan-out 和前端二次归并记录 |
| ERP-04 状态设计及既有非敏感报告 | 对照目标模型和兼容分类规则 |
| `.data/shein-business-data.v1.json` | 本地业务投影；1,179 个商品，声明 805 个 SPU、6,077 个 SKU；SHA-256：`ee1fe326817808477c266568bf7fd9b72cdb3c07ed71c0d17d7dcab779fa453e` |
| `.data/v2-real-local-state.json` | 本地 V2 状态；4 个 Draft、13 个 Asset；SHA-256：`eb437567b507793fe53723341c85e6f493cf7df67156bab345f9290465bb764a` |
| `.data/shein-schema-cache.v1.json` | 本地 schema cache；不是历史事实表；SHA-256：`ba623b3c1a0ec6daa965a12782ed9ae1a8dc4f3133c2fcf479901bbc5eb2a8ad` |
| 本地容器状态 | 审计时 `docker ps -a` 无运行或已停止容器可供读取 |

### 2.2 未取得的证据

以下项目仍没有完整快照或可安全读取的非生产证据，全部不能从本地投影或历史文档推断：

- `product_drafts`、`publish_batches`、`publish_batch_items`、`publish_jobs`、`publish_execution_runs`、`publish_receipts` 的 PostgreSQL 实际数据行；
- `product_review_states`、Webhook 原始事件、document-state、SPU/SKC/SKU 回读结果；
- Redis 队列、Worker claim/submission 日志和超时现场；
- 对象存储媒体清单、媒体 hash、用途、版本归属和释放记录；
- 规则、模板、schema 快照的历史实例；
- 生产 PostgreSQL、生产 Redis、生产对象存储和 SHEIN API 现场数据。

### 2.3 本地投影的非敏感结构统计

以下统计只来自本地 JSON 的结构和计数，未输出任何商品名称、平台 ID、供应商编码、文件名或请求内容：

| 文件 | 非敏感统计 |
|---|---|
| `shein-business-data.v1.json` | 1 个 store-scoped record；1,179 个商品；商品 ID 唯一数 1,179；SPU 唯一数 805；SKC 唯一数 1,179；`skuCodes` 合计 6,077；状态为在售 252、已下架 927；商品投影没有 `variants` 数组记录 |
| `v2-real-local-state.json` / Draft | 4 个 Draft，覆盖 3 个 store scope；4 个都有 `inputs`、`preflight`、`requirementSnapshot` 和 `skc` 字段；状态全部为 `draft`；其中 2 个有 `templateId` |
| `v2-real-local-state.json` / Asset | 13 个 Asset，覆盖 3 个 store scope；状态全部为 `ready`；用途全部为 `compliance_evidence`；引用计数全部为 0；合计 `sizeBytes` 为 39,882,429 |

这些投影可以作为本地读取层和测试 fixture 的证据，但没有包含 PostgreSQL 发布表中的 Batch/Job/Run/Receipt，也没有形成 ProductVersion、PublishAttempt 或 PlatformProductLink 的可审计链，所以不能据此完成历史关系修复。

## 3. 当前结构关系图（静态证据）

```text
ProductDraft (tenant_id, store_id)
    ├── PublishBatchItem ── PublishBatch
    └── PublishJob ── PublishExecutionRun
                         └── PublishReceipt (append-only)

ProductReviewState (tenant_id, store_id, review_key, version/document/spu/skc)

SPU ── SKC ── SKU

MediaAsset ── MediaAssetReference
  reference_type: product_draft / product_template / publish_job / skc / spu /
                  compliance_record / generation_job
```

上述关系是“现有 schema 与代码关系”，不是对历史数据完整性的证明。当前迁移没有把 `ProductVersion` 作为 `PublishJob` 的强制归属，也没有 `ProductVersion` 媒体引用类型。

## 4. 表和状态事实

| 范围 | 当前静态事实 | 历史记录分类 |
|---|---|---|
| `product_drafts` | 以 tenant/store 作用域保存 `draft_data`，状态约束含 `draft/blocked/ready/published/archived`；另有 V2 本地投影 4 个 Draft、3 个 store scope、全部状态为 `draft` | PostgreSQL 实际行数与每行归属：`UNKNOWN`；本地投影不能替代历史表 |
| `publish_batches` / `publish_batch_items` | 批次项通过 `product_draft_id` 关联 Draft，批次及批次项各自保存状态和尝试次数 | 实际一致性、孤儿项、重复项：`UNKNOWN` |
| `publish_jobs` | 通过 `product_draft_id` 关联 Draft；包含 request key、指纹、执行状态、SHEIN document/version、summary、receipt/readback/trace | 实际 Job 与 Draft 是否错配：`UNKNOWN`；结构上属于 `legacy_unversioned` |
| `publish_execution_runs` | 有执行 Run 表，但当前报告未取得数据行 | Run 与 Job 的完整关系：`UNKNOWN` |
| `publish_receipts` | 按 Job 保存 submitted/received/audited/document_state/readback/compliance 等回执，存在去重约束 | 回执缺失、重复和状态冲突：`UNKNOWN` |
| `product_review_states` | tenant/store/review_key 唯一；保存 version/document/spu/skc 和审核状态投影 | 当前审核投影与历史 Attempt 对应关系：`UNKNOWN` |
| `spus/skcs/skus` | 初始迁移按 tenant/store 建立商品层级表 | 实际平台 ID、内部 ID 和版本关系：`UNKNOWN` |
| `media_assets` / references | 资产有用途、状态、sha256、引用计数；引用类型没有 `product_version`；V2 本地投影有 13 个 `ready` Asset，引用计数均为 0，用途均为 `compliance_evidence` | 历史发布素材所有权：`UNKNOWN`；本地 13 个 Asset 不能证明已发布版本归属 |
| 规则/模板/schema | 当前 Run 未取得历史实例清单 | 每次发布所用快照：`UNKNOWN` |
| Redis/Worker | 当前 Run 未取得现场 | stale claim、重复提交、未确认消息：`UNKNOWN` |

## 5. 已确认的结构性风险

### H01：Job 直接绑定可变 Draft

证据：`server/cloud/publish-execution-repository.js` 创建 Job 时写入 `product_draft_id`，领取 Job 时仍通过该字段 join `product_drafts`；当前结构未强制绑定不可变 `ProductVersion`。

分类：`legacy_unversioned`（结构性）。  
影响：Draft 后续编辑可能改变历史 Job 所看到的内容，无法仅凭 Draft 证明某次提交的不可变商品内容。  
历史数据结论：没有数据快照，具体受影响 Job 为 `UNKNOWN`。  
ERP-20 方向：建立 Version 所有权和 Attempt 绑定后，再逐条迁移或标记旧 Job；禁止用当前 Draft 覆盖历史事实。

### H02：草稿箱以“是否存在任意 Job”排除记录

证据：`server/cloud/product-draft-service.js` 的默认列表会排除存在任意 `publish_job` 且状态不是 `archived` 的 Draft，并按更新时间排序、`LIMIT 100`。

分类：`legacy_unversioned`（结构性）。  
影响：草稿可见性由历史 Job 存在与否间接决定；一个 Draft 多次发布或旧 Job 残留可能改变当前列表。  
历史数据结论：被排除的实际 Draft、分页边界和隐藏记录数量为 `UNKNOWN`。  
ERP-20 方向：迁移到显式 Draft 生命周期和 handed-off 事实，保留审计快照，不用 Job 存在作为草稿状态。

### H03：Review 投影与当前 Attempt 的边界不足

证据：`product_review_states` 以 `review_key` 及平台字段保存投影；审核服务通过 Job/Draft 关系取数。现有读取逻辑存在按更新时间选最近 Job 的路径，不能作为 ERP-04 已批准的精确 Attempt 归属规则。

分类：`legacy_unversioned`；潜在具体记录可能为 `conflict`。  
影响：旧驳回可能覆盖新 Attempt，或多个 Job 在时间相近时出现歧义。  
历史数据结论：必须取得 version/document/SPU/SKC、Attempt、receipt 时间线后才能分类，当前为 `UNKNOWN`。  
ERP-20 方向：以明确 Attempt、单调事件和平台 Link 证据重建；歧义禁止自动合并。

### H04：媒体释放前没有 Version 媒体所有权证明

证据：媒体引用支持 `product_draft`、`publish_job`、`skc`、`spu` 等类型，但没有 `product_version` 类型；Draft 媒体引用会在发布完成路径释放或替换。

分类：`legacy_unversioned`（结构性）。  
影响：发布后的历史版本可能无法独立还原素材 hash、用途、顺序和当时提交内容。  
历史数据结论：哪些已释放、哪些仍可通过 Job 引用恢复为 `UNKNOWN`。  
ERP-20 方向：先建立 VersionMedia/不可变引用并核对 hash，再决定可修复、需平台回读或需人工处理的记录。

### H05：页面 fan-out 和二次归并

证据：`docs/REVIEW_CENTER_SYNC_MAP-2026-08-28.md` 描述草稿、批次、议价、审核、经营看板、批次回读、缩略图分别查询；前端再独立合并、去重、分类和统计。

分类：`legacy_unversioned`（读取路径）。  
影响：同一商品可能在多个页面使用不同当前状态或计数口径；分页和刷新时可能出现短暂不一致。  
历史数据结论：实际页面重复、漏项、跨 tenant/store 污染数量为 `UNKNOWN`。  
ERP-20 方向：建立统一快照读取和单一状态归并；把原始证据与页面投影分离。

### H06：隐藏 revalidate 写入风险

证据：`publish-batch-service.js` 的批次创建/动作路径调用 `revalidateDrafts`。本次 Run 不执行这些路径，也未把它们当作只读审计工具。

分类：`UNKNOWN`（运行时写入效果没有启动验证）。  
影响：所谓“查询/操作”可能触发预检或状态写入，不能用于 ERP-05 只读盘点。  
ERP-20 方向：拆分纯读校验和显式写入 Operation，补充 SQL 写入审计与负向测试。

## 6. 历史记录分类结果

本地投影有可计数记录，但不等于完整历史记录。本节把“可见投影数量”和“ERP-05 历史分类”分开登记。

| 记录集合 | 本地可见数量 | 已完成 ERP 历史分类 | legacy_unversioned / unmatched / conflict | UNKNOWN |
|---|---:|---:|---:|---:|---:|
| V2 本地 Draft 投影 | 4 | 0 | 暂无精确映射 | 4 条的 Version/Attempt/Platform Link 为 `UNKNOWN` |
| V2 本地 Asset 投影 | 13 | 0 | 暂无精确映射 | 13 条历史版本所有权为 `UNKNOWN` |
| business-data 商品投影 | 1,179 | 0 | 暂无精确映射 | 1,179 条对应 DB/Attempt/平台回读为 `UNKNOWN` |
| business-data SPU/SKU 声明 | 805 / 6,077 | 0 | 暂无精确映射 | 平台身份和历史时间线为 `UNKNOWN` |
| Batch / BatchItem 实际行 | 未取得 | 0 | 未取得 | 全部实际行 |
| Job / Run / Receipt 实际行 | 未取得 | 0 | 未取得 | 全部实际行 |
| Review / Webhook / 回读实际行 | 未取得 | 0 | 未取得 | 全部实际行 |
| Redis / Worker / 页面历史现场 | 未取得 | 0 | 未取得 | 全部实际现场 |

这里的“已完成 ERP 历史分类”为零，表示没有足够的 Version/Attempt/平台回执证据完成 `mapped`、`legacy_unversioned`、`unmatched` 或 `conflict` 分类；不是说本地投影没有记录。

## 7. ERP-05 必查项闭合情况

| 检查项 | 结果 | 说明 |
|---|---|---|
| tenant/store/SKC/version 关联 | `PARTIAL STRUCTURAL EVIDENCE + UNKNOWN` | 本地投影有 store scope、SPU/SKC/SKU 字段；Version/Attempt 仍缺失 |
| Draft/Batch/Job/Run/Receipt 关系 | `STRUCTURAL EVIDENCE + UNKNOWN` | 结构关系已读，实例完整性未知 |
| ProductReviewState 与 Attempt 关系 | `UNKNOWN` | 缺历史投影和回读数据 |
| SPU/SKC/SKU 与平台 ID 关系 | `UNKNOWN` | 缺实际平台回读和 Link 清单 |
| 状态类别计数 | `PARTIAL` | 本地 Draft 4 条均为 `draft`，Asset 13 条均为 `ready`；DB 全量仍未知 |
| Draft 是否有执行记录 | `UNKNOWN` | 本地 Draft 投影没有 Batch/Job 事实链 |
| Batch 与 Job 不一致 | `UNKNOWN` | 无批次和 Job 行 |
| 旧驳回覆盖新 Attempt | `UNKNOWN` | 无事件时间线和精确 Attempt |
| 缺 Version/document/SPU/SKC/Receipt | `UNKNOWN` | 当前 schema 有缺口，但实际缺失量未知 |
| stale running/claimed | `UNKNOWN` | 无 execution run/Worker claim 现场 |
| 自动修复、回读、人工、禁止重试分类 | `UNKNOWN` | 需要逐条证据；`result_unknown` 不得盲重发 |
| mutable Draft 复用 | `STRUCTURAL EVIDENCE + UNKNOWN` | 结构允许，实际复用记录未知 |
| Published/archived Draft 直接重发 | `UNKNOWN` | 无实际命令和审计轨迹 |
| 名称/时间/SKC 启发式关系 | `UNKNOWN` | 未执行历史实例匹配 |
| 媒体 released/needs 分类 | `PARTIAL STRUCTURAL EVIDENCE + UNKNOWN` | 13 个本地 Asset 为 `ready` 且引用计数 0；发布版本归属仍未知 |
| 规则/模板/schema 快照归属 | `UNKNOWN` | 无历史快照清单 |
| Webhook/document-state/readback 归并 | `UNKNOWN` | 无原始事件和回读记录 |
| 页面 fan-out/二次归并/LIMIT 100 | `STRUCTURAL EVIDENCE + UNKNOWN` | 读取路径已确认，实际漏项/重复数未知 |
| Version 媒体所有权证明 | `STRUCTURAL GAP + UNKNOWN` | 当前 migration 没有 ProductVersion 引用类型 |

## 8. 对 ERP-20 的当前精确范围

目前本地投影可用于验证读取层和 fixture，但在取得逐条数据库事实前，ERP-20 仍只能登记以下“待证实修复族”，不能生成具体 UPDATE/DELETE 计划：

1. **Version 边界族（P0）**：为历史 Job、Receipt、Review 和媒体建立可审计的 Version/Attempt 证据；无证据的记录保持 `UNKNOWN`。
2. **平台身份族（P0）**：按 tenant/store/SKC/version 证明 document、SPU、SKC、SKU 的唯一映射；`unmatched` 和 `conflict` 不自动合并。
3. **发布状态族（P0）**：清理 Draft 状态对 Job 存在的隐式依赖；`result_unknown` 先回读/人工确认，禁止盲重发。
4. **媒体所有权族（P0）**：先建立不可变版本媒体引用并核对 hash、用途和顺序，再释放 Draft 引用。
5. **审核投影族（P0）**：以精确 Attempt 和单调事件重建审核投影，旧驳回不得覆盖新尝试。
6. **读取一致性族（P1）**：统一页面快照、分页边界、去重和计数来源，消除前端多路二次归并造成的口径漂移。
7. **运行时审计族（P1）**：拆出纯读 revalidation，禁止审计查询隐式改变业务状态。

任何具体数据修复必须等本报告被补充为逐条 `mapped/legacy_unversioned/unmatched/conflict/UNKNOWN` 后，另建 ERP-20 Run，并重新取得对应授权；本 Run 不执行修复。

## 9. 补证要求

要使 ERP-05 重新进入可完成状态，现有本地投影之外，还需要一份脱敏、只读、可校验的历史事实证据包，至少包含：

- 相关表的 schema、行级非敏感 ID、tenant/store、时间、状态、外键和必要的 hash；
- Job/Run/Receipt 的 request key、指纹、平台 document/version、SPU/SKC/SKU 关联及状态时间线；
- Review/Webhook/document-state/readback 的非敏感事件索引；
- Redis/Worker 的队列名、消息 ID hash、claim/submission 状态和时间，不含 payload、Token 或 Cookie；
- MediaAsset/Reference 的 asset ID、sha256、用途、引用类型、创建/释放时间，不含图片字节；
- 规则、模板和 schema 快照 ID/hash；
- 导出时间、来源环境、导出工具版本和完整性 hash。

补证前不得连接生产服务，不得为了“盘点”执行任何会触发 revalidate、队列消费、回读或状态写入的操作。

## 10. 安全与回滚

- 本报告未记录 SecretId、SecretKey、Token、Cookie、签名、完整请求 payload、图片字节或个人敏感信息。
- 本 Run 只有 Markdown 文档变更；回滚仅需恢复本 Run 对应的文档提交，不触碰业务数据。
- 当前状态保持 `BLOCKED`，不是 `COMPLETE`；没有历史数据证据就不能开始 ERP-06。
