# ERP-05 历史数据证据审计报告

版本：2026-08-29-v14
正式 Run：`RUN-20260829-ERP05-OBJECT-INVENTORY-RECHECK-11`
步骤：ERP-05  
状态：`BLOCKED`（Run 11 已执行；对象列表请求仍被 HTTP 403 拒绝）
审计时间：2026-08-29 21:21:04（Asia/Shanghai）

## 1. 审计结论

原始 Run 已完成本地静态证据盘点，并发现可逐条读取的本地业务投影和 V2 本地 Draft/Asset 状态，但没有取得完整 PostgreSQL 历史事实链而阻断。补证 Run 按用户于 2026-08-29 明确授权取得了生产 PostgreSQL、Redis、容器、Worker 日志数量和应用健康元数据；随后 Run 取得了关系型集合/关系的单向指纹、媒体 HEAD 结果和 SHEIN 官方只读回读结果，但完整对象存储清单和新模型逐条分类仍未取得，因此当前完成门仍未通过：

1. 本地投影中已确认：1 个 store-scoped business record，包含 1,179 个商品投影、声明 805 个 SPU 和 6,077 个 SKU；V2 本地状态包含 4 个 Draft 和 13 个 Asset。
2. 这些文件不是 PostgreSQL 的 Draft/Batch/Job/Run/Receipt/Review 历史表，也没有证明 ProductVersion、PublishAttempt、PlatformProductLink、Webhook、队列和 Worker 事实链；对应关系仍必须标记为 `UNKNOWN`。
3. 源码和迁移已经证明若干结构性风险：发布 Job 直接绑定可变 Draft、当前迁移没有 ProductVersion 边界、媒体引用没有 ProductVersion 类型、页面存在多路查询和二次归并、草稿列表使用“是否存在任意 Job”排除并受 `LIMIT 100` 影响。
4. ERP-20 的修复范围目前可精确到“本地投影核验 + 结构性风险清单”，仍不能精确到历史记录 ID、租户、店铺、SKC、版本和 Attempt；因此 ERP-05 完成门未通过，ERP-06 不得开始。
5. 当前逐条补证取得了关系表的不可逆集合指纹和关系指纹，但这只能证明某一时点的行集合/关联集合，不能把旧 Job 映射为新 ProductVersion、PublishAttempt 或 SHEIN 平台身份。
6. 当前生产没有 ProductVersion 或 PublishAttempt 专用表；`shein_authorization_attempts` 的 21 条记录属于授权流程 Attempt，不能冒充商品发布 Attempt。发布 Job 的 `attempt_count`、`shein_version` 和 `readback` 字段也不能单独证明不可变版本或官方回读。
7. 媒体只读 `HEAD` 结果为 585 条成功、173 条 404、62 条超时；成功项大小/类型与数据库记录均无不匹配，但对象清单仍不完整，404/超时记录不得自动删除、重试或改状态。
8. 当前 Run 的分层复核结果为 579 条成功、169 条 404、72 条超时；404 集中在 `deleted` 状态（167/185），`referenced` 与 `ready` 均无 404，但仍有 54 条超时，完整对象证据仍未闭合。
9. 当前 `publish_receipts` 没有独立 `readback` 类型，只有 `audited/document_state/received/submitted`；Job 的 219 条 `readback` JSON 只是本地字段。官方只读 Run 已对 82 个去重目标取得回读：73 条 version+SPU 完全匹配，9 条仅 SPU 匹配（返回 version 与请求 version 不一致）；官方来源已证明，但 9 条不能安全建立版本身份映射，完成门继续阻断。
10. Run 07 关系基线的目标业务表精确行数为 Draft 93、Batch 33、BatchItem 266、Run 28、Job 219、Receipt 173、Review 156、SPU 518、SKC 547、MediaAsset 820、Reference 542、Webhook 2,985、SyncJob 578、SyncItem 339；Run 08 快照中的 SyncJob 为 580、SyncItem 339，Run 08 内目标表行数稳定；后台并发使 PostgreSQL 更新统计变化，不能声称跨 Run 统计完全不变。
11. 当前数据库系统目录确认目标关系上有 50 个声明外键；BatchItem→Batch/Draft、Job→Run/Batch/BatchItem/Draft、Receipt→Job/Webhook、SKC→SPU、SyncItem→SyncJob 的实际孤儿计数均为 0。外键完整只证明结构关系，不等于新 ProductVersion/PublishAttempt 映射完成。
12. `public.skus` 是普通表且经数据库所有者只读核验为 0 行，但应用角色 `shein_runtime` 没有 SELECT 权限；因此本 Run 将 SKU 行级事实标为 `UNKNOWN`，不能用权限不可见替代业务数据结论。
13. Run 08 对对象存储发起只读 `ListObjectsV2` 得到 HTTP 403；此前 820 条 HEAD 结果仍只能代表逐对象部分证据，无法证明 provider-level 清单完整性。对象清单、媒体所有权连续性和完整 hash 证据继续标为 `UNKNOWN`，不执行任何清理或状态修复。
14. Run 09 已在用户完成最小 `cos:GetBucket` 授权后执行，但第 0 页仍返回 HTTP 403；这不能证明策略已绑定到服务器实际使用的密钥主体或资源匹配，对象证据继续为 `UNKNOWN`，不再自动重试。
15. Run 10 在用户确认修正子用户后使用服务器当前运行时身份重新执行，`ListObjectsV2` 第 0 页仍返回 HTTP 403；这表明当前运行时密钥仍未获得匹配的 COS List 权限，或策略的主体/资源/action 仍不匹配。数据库行数和 MediaAsset 指标稳定，但 PostgreSQL 统计在后台并发下增加 inserts 10、updates 7，因此只记录为受并发影响，不能声称本 Run 零统计变化。
16. Run 11 在用户确认 `wow-rug-cos-service` 为目标子用户并完成策略调整后再次执行，`ListObjectsV2` 第 0 页仍返回 HTTP 403；服务器运行时身份与 CAM 策略的有效关联尚未被证明，对象清单继续为 `UNKNOWN`，停止继续重试。

此前补证 Run 只执行了非交互 SSH、容器健康与版本元数据、PostgreSQL 聚合 `SELECT`/系统目录、Redis 数量/元信息、Worker 日志数量摘要和媒体元数据摘要；本正式 Run 另行执行了官方只读查询，未执行生产写入、队列副作用、部署、重启、切换或任何密钥输出。

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

### 2.2 原始 Run 未取得的证据

以下项目在原始本地 Run 中没有完整快照；原始结论不能从本地投影或历史文档推断。当前生产补证已取得其中的关系型聚合，但没有改变原始 Run 的历史结论：

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

### 2.4 当前 Run 的生产只读补证

审计时间：`2026-08-29T10:35:40Z`（服务器 UTC）。本节只记录非敏感聚合和运行元数据，不记录 SecretId、SecretKey、Token、Cookie、签名、完整 payload、图片字节或个人信息。

| 证据面 | 只读结果 |
|---|---|
| SSH/运行边界 | 目标主机 `VM-0-5-ubuntu`；用户 `ubuntu`；使用非交互密钥登录；直接 Docker socket 拒绝，`sudo -n` 只读 Docker 查询可用 |
| 应用版本/健康 | `/opt/shein-console/current` 指向 `shein-cloud-deploy-20260829-frontend-restore-v1`；Control `/ready` 返回 HTTP 200 |
| 容器 | Control、发布/规则/经营/合规/Webhook/媒体 Worker、Webhook、PostgreSQL、Redis、Cloudflared 均为 running；Control/Webhook/PostgreSQL/Redis 报告 healthy |
| PostgreSQL | `shein_console`；schema migration 记录 46 条；关键历史表均可只读查询 |
| Redis | `PONG`；DB0 `1,623` keys，`5` keys 有过期时间；未读取 key 名称和 payload |
| Worker 日志摘要 | 最近 24 小时仅输出行数：发布 7、规则 1,576、经营 8、合规 0、Webhook 372、媒体清理 1,439；未输出日志原文 |

生产补证因此足以确认真实数据规模和结构性风险，但不足以证明平台回读、对象存储对象归属或新模型 Version/Attempt 的逐条映射。

### 2.5 上一 Run 的逐条脱敏证据补证

本节对应已结束的 `RUN-20260829-ERP05-ROW-LEVEL-EVIDENCE-03`。数据库指纹采集时间为 `2026-08-29T11:02:24Z`；异常/版本字段采集时间为 `2026-08-29T11:03:38Z`；状态分布采集时间为 `2026-08-29T11:05:17Z`。所有查询均为生产 PostgreSQL 只读 `SELECT`/系统目录查询；哈希为单向摘要，不输出原始 ID、业务键、密钥、Token、Cookie、payload 或图片字节。

#### 关系表集合指纹

| 集合 | 行数 | ID 集合 MD5 |
|---|---:|---|
| `media_asset_references` | 542 | `604fe5063ef53a9c4953cd94dd155648` |
| `media_assets` | 820 | `9c6f75aba2b774072fc894e539239ae3` |
| `product_drafts` | 93 | `4882e8a8c7b9b8443161c57bb471775d` |
| `product_review_states` | 156 | `6339ab44212f315607a60baae91df179` |
| `publish_batch_items` | 250 | `a0d6c09a002b86604f0e23143d18cae8` |
| `publish_batches` | 32 | `c555473db18f97c0642fb2cf0a984207` |
| `publish_execution_runs` | 28 | `b82a2c4f27e10fc5bd868e9b6389d568` |
| `publish_jobs` | 219 | `01070d2c39e443c40ea27efc05f37832` |
| `publish_receipts` | 157 | `d1858438eb53b1f8e8c75e6741593970` |
| `skcs` | 547 | `83ccfcac960c5b9fe237f0a8027f7e94` |
| `skus` | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `spus` | 518 | `8f6b448856a0895f6439f6df05e4a6b0` |
| `sync_job_items` | 339 | `7ce442ca74a31e9515c5cb61c3f60537` |
| `sync_jobs` | 571 | `058e82874af3153e7acb123baf044a76` |
| `webhook_events` | 2,978 | `02f25da85d568c4fc30da76b1fc24328` |

#### 关系集合指纹

| 关联集合 | 行数 | 关联集合 MD5 |
|---|---:|---|
| BatchItem → Draft | 250 | `5890eb216d88b27bfef25ff4e7c29c4d` |
| Job → Batch | 219 | `ac706f2eb5f9265708b3b262620a828d` |
| Job → Draft | 219 | `aefad52e1dfb82f46cca26b7f77f0832` |
| Receipt → Job | 157 | `50943b196986036dbbfc4530d31b7942` |
| SKC → SPU | 547 | `18177714b462ed1c8b7ab26cd7a4fdcc` |
| SyncItem → SyncJob | 339 | `ac29ece4b53c76a2c504a828044ce35c` |

这些指纹只用于后续同一快照的完整性比对，不代表平台映射成功；孤儿关系仍以前述聚合检查为准，不能由哈希推导不存在的 Version/Attempt。

#### 版本、Attempt 与本地回读字段边界

| 检查项 | 只读结果 | 结论 |
|---|---:|---|
| ProductVersion 专用表 | 0 个命中 | 新模型版本事实不存在于当前生产 schema |
| PublishAttempt 专用表 | 0 个命中 | 发布 Attempt 不是独立事实表 |
| `shein_authorization_attempts` | 21 条 | 这是授权流程 Attempt，不能替代商品发布 Attempt |
| Job 含 `shein_version` | 82 条 | 仅为字段存在，不证明 Version 实体或平台回读 |
| Job 含 `shein_document_sn` | 59 条 | 仅为部分字段填充，仍无逐条官方关联证明 |
| Job 含 `readback` JSON | 219 条 | 仅证明本地 JSON 字段存在，不证明 SHEIN 官方回读来源 |
| Job 含 `remote_candidate_fingerprint` | 219 条 | 仅为候选指纹，不证明官方身份映射 |

#### 媒体对象只读 HEAD

同一对象存储 provider、bucket 作用域和媒体 Worker 内的 `S3ObjectStorage.statObject()` 执行 `HEAD`；没有调用 `getObject()`，没有下载、上传、删除或复制对象。

| 结果 | 数量 | 分类 |
|---|---:|---|
| 总媒体行 | 820 | `media_assets` 当前集合 |
| HEAD 成功 | 585 | 成功项大小不匹配 0、类型不匹配 0 |
| HEAD 返回 404 | 173 | `missing_object` 候选；因未做 provider 额外写入/恢复，不能自动处置 |
| HEAD 超时 | 62 | `UNKNOWN`；不能当作缺失或成功 |
| 数据库状态 | referenced 608、deleted 185、failed 3、ready 24 | 与对象存在性分开记录，不互相推导 |

媒体引用账本在同一轮只读检查中仍有 280 条 `reference_count` 不一致、24 个 `ready` 且实际无引用、0 个 deleted 且仍有引用。对象 HEAD 结果没有授权任何清理或状态修复动作。

#### 同时点异常摘要

在 `2026-08-29T11:03:38Z`/`11:05:17Z` 的只读快照中：61 个 Draft 被多个 Job 复用（单 Draft 最多 6 个）；12 个 running Run 全部超过 1 小时；2 个 claimed Job 的 claim 全部过期；82 个 submitted Job 全部缺 `completed_at`；13 个 queued Webhook 全部已有 `processed_at`；同步表当前为 571 条（succeeded 400、failed 166、queued 4、running 1）。外键孤儿仍为 0。

以上异常只能进入受控修复范围，当前 Run 不执行清理、重试、消费、回读或数据修改。

### 2.6 当前 Run 的 provider-level 媒体与回读结构补证

本节对应当前正式 Run `RUN-20260829-ERP05-OBJECT-READBACK-EVIDENCE-04`，所有操作仍为生产只读。媒体检查使用已确认的 `S3ObjectStorage.statObject()`，只发送 `HEAD`；发布回执检查只读取 PostgreSQL 列定义、非空计数、状态分布和 JSON 结构指纹，不读取 JSON 内容。

#### 媒体 provider-level 分层结果

本 Run 使用媒体 Worker `deploy-media-cleanup-1` 的 `s3` provider 与同一运行时配置，对 820 条媒体行按数据库状态分层执行 `HEAD`。本次结果如下：

| 数据库状态 | 总数 | HEAD 成功 | 404 | 超时 | 其他错误 | 大小/类型不匹配 |
|---|---:|---:|---:|---:|---:|---:|
| `referenced` | 608 | 556 | 0 | 52 | 0 | 0 / 0 |
| `deleted` | 185 | 0 | 167 | 18 | 0 | 0 / 0 |
| `failed` | 3 | 1 | 2 | 0 | 0 | 0 / 0 |
| `ready` | 24 | 22 | 0 | 2 | 0 | 0 / 0 |
| **合计** | **820** | **579** | **169** | **72** | **0** | **0 / 0** |

解释边界：167 个 `deleted` 资产返回 404 与数据库状态方向一致；2 个 `failed` 资产返回 404，只登记为 `missing_object` 候选；`referenced` 和 `ready` 没有 404，但 54 条超时，不能由超时推断存在或缺失。与上一轮 585/173/62 的差异说明网络/对象存储响应存在时变性，因此未响应对象必须保持 `UNKNOWN`，不得自动删除、补引用、改状态或重试。

#### 本地回执/回读结构索引

`publish_receipts` 当前只存在以下 receipt type：

| receipt type | 行数 | 有 Webhook ID | 有 document_sn | 有 version | 有 occurred_at |
|---|---:|---:|---:|---:|---:|
| `audited` | 16 | 16 | 16 | 16 | 0 |
| `document_state` | 57 | 0 | 57 | 57 | 0 |
| `received` | 2 | 2 | 2 | 2 | 0 |
| `submitted` | 82 | 0 | 0 | 82 | 82 |

补充结构事实：全部 157 条 Receipt 有 object 类型 `payload`；Job 的 `receipt` JSON、`readback` JSON、`remote_candidate_fingerprint` 各为 219 条；Job 的 `trace_id` 为 215 条、`shein_document_sn` 为 59 条、`shein_version` 为 82 条；`platform_code` 为 0 条。生产没有 `receipt_type='readback'` 行。

上述字段能证明本地回执/投影结构已经写入，但不能证明来源一定是 SHEIN 官方回读：`document_state` 没有关联 Webhook ID，`submitted` 没有 document_sn，Job 的 `readback` 又是本地 JSON 字段。按照当前 Run 禁止调用 SHEIN API 的边界，本次不主动回读、不消费 Webhook、不改写 Receipt，官方来源继续标记为 `UNKNOWN`。

#### Run 结论

本 Run 已完成允许范围内的 provider-level 分层与回执结构索引，但没有取得完整对象存储证据，也没有取得可验证的 SHEIN 官方回读/平台映射。ERP-05 完成门仍为 `BLOCKED`；ERP-06、ERP-20 修复和任何生产清理/重试均不得开始。

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
| Batch / BatchItem 实际行 | 32 / 250 | 0 | 32 / 250 条 `legacy_unversioned`（外键孤儿均为 0） | ProductVersion/Attempt 关系为 `UNKNOWN` |
| Job / Run / Receipt 实际行 | 219 / 28 / 157 | 0 | 219 / 28 / 157 条均不能映射到新 Version/Attempt；按 `legacy_unversioned` 结构证据登记 | 61 个 Draft 被多个 Job 复用；12 个 Run stale；2 个 claim 已过期；82 个 submitted 缺 completed_at；Job `readback` 219 条仅为本地字段 |
| Review / Webhook / 回读实际行 | 156 / 2,978 / 外部回读未取得 | 0 | DB 投影/事件均保留为旧模型证据 | 39 条审核投影缺 audit/document/version；13 个 Webhook queued；外部官方回读 `UNKNOWN` |
| SPU / SKC / SKU 实际行 | 518 / 547 / 0 | 0 | SPU/SKC 为平台投影型旧表，SKU 无行 | PlatformProductLink 和 SKU 回读映射 `UNKNOWN` |
| MediaAsset / Reference 实际行 | 820 / 542 | 0 | 820 / 542 条均无 ProductVersion 类型引用，按旧模型证据登记 | 280 个引用计数不一致；24 个 ready Asset 实际引用数为 0；HEAD 585 成功、173 个 404 候选、62 个超时；完整对象归属 `UNKNOWN` |
| Redis / Worker / 页面历史现场 | 1,623 keys / 6 个 Worker 日志摘要 / 页面现场未取 | 0 | 运行元数据已取得，业务消息不读取 | claim/submission payload、队列消息和页面逐条历史 `UNKNOWN` |

这里的“已完成 ERP 历史分类”为零，表示还没有把生产行级记录建立到新 `ProductVersion/PublishAttempt/PlatformProductLink` 的可审计映射；“legacy_unversioned”是结构性旧模型分类，不等同于已完成新模型映射。生产聚合已证明实际风险数量，但不能把聚合数量冒充逐条 `mapped/unmatched/conflict` 完成结果。

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
| ProductVersion / PublishAttempt 专用事实 | `BLOCKED` | 当前 schema 未发现 ProductVersion 或 PublishAttempt 表；21 条 `shein_authorization_attempts` 属于授权流程，不能替代发布 Attempt |
| 逐条对象存储存在性 | `PARTIAL` | 585 条 HEAD 成功且大小/类型一致；173 条 404 候选、62 条超时；不得据此自动删除或改状态 |

### 7.1 当前生产只读补证结果

本小节的聚合/状态结果以 `2026-08-29T11:05:17Z` 为主（Asia/Shanghai 19:05:17）；前一轮 `2026-08-29T10:35:40Z` 的生产聚合仍作为历史快照保留。生产数据会继续变化，不能跨时间点拼接成一份静态事实。

| 检查项 | 生产只读结果 | 当前解释 |
|---|---:|---|
| 作用域 | 11 个 Store（9 active、2 disabled）；Draft 5 个 store scope；Job 4 个；Asset 7 个；SKC 7 个 | 作用域已可计数，跨域逐条映射仍未建立 |
| 外键孤儿 | BatchItem→Draft、Job→Draft/Batch/BatchItem/Run、Receipt→Job/Webhook、SKC→SPU、SyncItem→SyncJob 均为 0 | 结构外键完整不代表业务版本关系完整 |
| Draft 状态 | archived 44、blocked 1、ready 48；没有规范 `editing/handed_off` 投影 | 旧状态与 ERP-04 六维状态不能直接等价 |
| Batch/BatchItem 状态 | Batch failed 12、ready 20；Item failed 68、ready 182 | 批次状态与新 Command/Attempt 仍未分离 |
| Job 状态 | claimed 2、failed_terminal 135、submitted 82 | 2 个 claimed 均 claim 已过期；82 个 submitted 均无 completed_at |
| ExecutionRun | failed 16、running 12；12 个 running 均超过 1 小时；execution_enabled 2、authorizes_publishing 2 | 必须按 stale running 进入 ERP-20 受控修复计划，禁止现场重试/清理 |
| Receipt 状态 | accepted 84、failed 50、passed 2、pending 21 | 139 条无 webhook_event_id；82 条无 document_sn；75 条无 trace_id |
| Draft 复用/重复键 | 61 个 Draft 被多个 Job 复用，单 Draft 最多 6 个 Job；重复 request_key 0；重复 receipt dedupe_key 0 | 直接确认 mutable Draft 复用风险，不能自动重发或批量拆分 |
| 审核投影 | 156 条 workflow_stage 全为空；audit_state 为空 39；document/version 为空各 39 | 审核投影无法直接作为六维官方审核状态 |
| SPU/SKC/SKU | SPU 518、SKC 547、SKU 0；SKC→SPU 孤儿 0 | SKU 层历史证据缺失，不能把 SKC 数量推导为 SKU 完整事实 |
| 媒体 | Asset 820；Reference 542；280 条 `reference_count` 不一致；deleted 且仍有引用 0；ready 且零引用 24 | 引用账本与资产状态不一致；引用类型没有 ProductVersion |
| Webhook | processed 2,965、queued 13；queued 且 processed_at 已设置 13；attempt_count>1 为 99 | 事件队列仍有待处理项；禁止本 Run 消费/重试 |
| 同步 | 当前 SyncJob succeeded 400、failed 166、queued 4、running 1，共 571；SyncItem 339 且此前非 succeeded 为 0 | 失败/排队同步必须保留原证据，不能用网页刷新代替重跑结论；计数较前一快照变化，证明生产仍在运行 |
| 版本与 Attempt | ProductVersion/PublishAttempt 专用表均未发现；`shein_authorization_attempts` 21 条；Job `shein_version` 82 条、`readback` JSON 219 条 | 授权 Attempt、字段填充和本地 JSON 均不能替代不可变商品 Version、发布 Attempt 或官方回读 |
| 媒体对象 HEAD | 820 条中 HEAD 成功 585、404 173、超时 62；成功项大小/类型不匹配均为 0 | 只读存在性为部分证据；404/超时不执行自动清理、重试或状态修改 |
| 集合/关系指纹 | 15 个核心表集合指纹、6 个关系集合指纹已取得 | 仅用于同一快照完整性比对，不输出原始 ID，也不代表平台映射成功 |
| 运行时 | Redis 1,623 keys；6 个 Worker 最近 24h 日志行数已摘要；Control `/ready` 200 | 只能证明运行态可观测，不能证明 SHEIN 已回读或提交成功 |

以上结果已写入当前 Run 的 ERP-20 修复范围，但没有执行任何修复动作。

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

原始 Run 的本地证据缺口已由前两次 Run 和本 Run 补充了生产关系型聚合、不可逆集合/关系指纹、部分媒体 HEAD 元数据和运行元数据，但当前 ERP-05 仍未完成。要进入可完成状态，还需要：

- 相关表的逐条非敏感 ID 指纹、tenant/store、时间、状态、外键和必要的 hash；
- Job/Run/Receipt 的逐条 request key 指纹、候选指纹、平台 document/version、SPU/SKC/SKU 关联及状态时间线；
- Review/Webhook/document-state/readback 的逐条非敏感事件索引，尤其是平台官方回读与本地 Receipt 的对应关系；
- Redis/Worker 的队列名、消息 ID hash、claim/submission 状态和时间，不含 payload、Token 或 Cookie；当前仅取得数量和日志行数摘要；
- MediaAsset/Reference 的逐条 asset ID 指纹、sha256、用途、引用类型、创建/释放时间及对象存储存在性，不含图片字节；
- 对 173 个 HEAD 404 候选和 62 个 HEAD 超时项取得可验证的 provider-level 只读证据，或明确保留 `UNKNOWN` 并进入人工处置清单；不能用超时推断缺失；
- 规则、模板和 schema 快照 ID/hash；
- 导出时间、来源环境、导出工具版本和完整性 hash。

本 Run 已在明确边界内执行 SHEIN 官方只读回读，但仍不得消费队列、revalidate 或把结果直接写回生产；9 条 version 标识不匹配和未建立的新模型版本/Attempt/平台链接仍必须保持 `UNKNOWN`，后续如需人工核对必须另建明确 Run。

## 10. 安全与回滚

- 本报告未记录 SecretId、SecretKey、Token、Cookie、签名、完整请求 payload、图片字节或个人敏感信息。
- 本 Run 只有 Markdown 文档变更；生产检查全部是只读查询和元数据摘要；回滚仅需恢复本 Run 对应的文档提交，不触碰业务数据。
- 原始 Run、生产聚合 Run、逐条对象 Run 和当前官方回读 Run 结论均为 `BLOCKED`，不是 `COMPLETE`。官方只读已覆盖 82 个目标，72 条失败、7 条待审核、3 条通过；3 条通过目标的 `spu-info` 均规范化成功，共 3 个 SKC、18 个 SKU；9 条仅 SPU 匹配但 version 不一致，不能强行归并。ProductVersion/PublishAttempt/PlatformProductLink 逐条映射和完整对象存储清单仍缺失，ERP-06 不得开始。

## 11. 已结束 Run：官方只读回读证据补证

### RUN-20260829-ERP05-OFFICIAL-READBACK-EVIDENCE-05

- 类型：ERP-05 官方回读证据补证；只读验证 SHEIN 官方商品查询接口与本地已存储发布目标的可映射性。
- 启动依据：用户继续明确要求“下一步”；ERP-05 前一 Run 已证明本地 Receipt/Job `readback` 字段不能证明官方来源，本 Run 专门补齐该缺口。
- 目标：从生产 PostgreSQL 只读取得已存在的发布目标样本，在一次性内存进程中使用既有 `requestShein` 签名实现，调用官方只读路径 `/open-api/goods/query-document-state` 与 `/open-api/goods/spu-info`；统计 HTTP 状态、SHEIN 业务码、trace 是否存在、响应结构和目标映射覆盖，不落库。
- 允许范围：非交互 SSH；生产 PostgreSQL `SELECT`/系统目录只读；使用生产已配置的加密凭据在进程内解密；仅调用上述官方读接口；输出脱敏聚合计数、错误类别、结构摘要和单向哈希；执行前后核对关键表行数/写入计数证据。
- 禁止范围：调用 `web-business-service` 的 `queryDocumentState`/`querySpuInfo`（这些方法会写 Receipt/Review）；任何 SHEIN 写接口；数据库 `INSERT/UPDATE/DELETE`、迁移、Receipt/Review 写入；Redis payload、队列消费/重试/claim；对象上传/下载/删除/复制；部署、重启、切换；输出 SecretId、SecretKey、Token、Cookie、签名、原始 ID、SPU 名、完整 JSON 或图片字节。
- 失败关闭：生产配置、凭据作用域、目标版本/SPU、官方读路径或只读边界无法证明；需要交互认证；API 返回鉴权/参数/限流/网络不确定错误；发现任何写入迹象时立即停止，相关证据保持 `UNKNOWN`，不猜测、不重试业务命令。
- 完成标准：每个实际请求均能归属到生产目标样本并记录脱敏结果；报告官方返回成功/失败/未知、业务码和结构覆盖；前后数据库关键表行数与审计证据无变化；若官方回读或映射仍不完整，ERP-05 仍为 `BLOCKED`，不得开始 ERP-06。
- 回滚点：本 Run 不修改业务数据；仅新增本报告/台账记录，回滚为恢复本 Run 文档提交。
- 当前状态：`BLOCKED`；前一 Run 已完成 82 个官方 `query-document-state` 目标及 3 个通过目标的 `spu-info` 回读；数据库关键表行数与 PostgreSQL 写入统计前后无变化，但 9 条返回 version 与请求 version 不一致，ProductVersion/PublishAttempt/PlatformProductLink 逐条映射和完整对象清单仍缺失。

## 12. 已结束 Run：官方回读不匹配交叉关联

### RUN-20260829-ERP05-OFFICIAL-MISMATCH-CORRELATION-06

- 类型：ERP-05 官方回读证据补证；仅核对前一 Run 的 9 条“仅 SPU 匹配”记录能否与同店铺、同 SPU 的其他本地 version 唯一对应。
- 启动依据：前一 Run 已完成 82 个目标的官方回读，发现 73 条 version+SPU 完全匹配、9 条仅 SPU 匹配；用户继续要求“下一步”。
- 目标：重新调用官方只读 `/open-api/goods/query-document-state`，在进程内将返回 version 与生产 PostgreSQL 只读取得的 82 个目标按 `store_id + spu` 做精确、唯一、歧义或无匹配分类；不修改本地目标、不生成重发命令。
- 允许范围：非交互 SSH；生产 PostgreSQL `SELECT`；进程内解密生产已配置凭据；仅调用官方 `/open-api/goods/query-document-state`；输出数量、状态、唯一/歧义/无匹配分类和单向摘要。
- 禁止范围：调用会写 Receipt/Review 的 Control 回读方法；SHEIN 写接口；任何数据库/Redis/队列/对象存储写入；重发、删除、修复或重命名目标；输出 SecretId、SecretKey、Token、签名、原始 ID、SPU 名或完整 payload。
- 失败关闭：出现鉴权、限流、网络不确定、凭据解密失败、返回结构无法规范化或匹配关系非唯一时，保留 `UNKNOWN`，不猜测、不自动归并。
- 完成标准：9 条 version 不匹配逐条进入 `unique_cross_match`、`no_cross_match`、`ambiguous_cross_match` 或 `UNKNOWN`；查询前后关键表行数和写入统计无变化；无唯一交叉证据则 ERP-05 仍为 `BLOCKED`。
- 回滚点：本 Run 不修改业务数据；仅新增本报告/台账记录。
- 当前状态：`BLOCKED`；82/82 官方状态请求成功并规范化；9 条 version 不匹配均无同店铺/同 SPU 的交叉版本，数据库关键表行数与 PostgreSQL 写入统计前后无变化。

### RUN-20260829-ERP05-OFFICIAL-MISMATCH-CORRELATION-06 结果

- 官方只读覆盖：82/82 个去重目标完成 `query-document-state` 请求，HTTP/业务传输成功、规范化成功；状态仍为 failed 72、pending 7、passed 3；无 API 鉴权、限流、网络或规范化错误。
- 交叉关联：73 条 version+SPU 完全匹配；9 条 SPU 匹配但官方 version 与请求 version 不同；这 9 条在同店铺/同 SPU 的本地目标集合中均无对应官方 version（`crossUnique=0`、`crossNone=9`、`crossAmbiguous=0`）。
- 凭据与边界：4 个涉及店铺凭据均在一次性内存进程内成功解密；未调用会写 Receipt/Review 的 Control 方法，未输出密钥、Token、原始身份或完整响应。
- 零写入证据：`stores`、`publish_jobs`、`publish_receipts`、`product_review_states`、`product_drafts`、`publish_execution_runs`、`webhook_events` 精确行数前后不变；对应 PostgreSQL 插入/更新/删除统计前后不变。
- 完成门结论：`BLOCKED`；9 条无法安全建立平台 version 映射，且现有生产模型没有 ProductVersion/PublishAttempt/PlatformProductLink 专用事实，完整对象存储清单也未闭合；ERP-06、ERP-20 修复和任何生产清理/重试不得开始。

## 13. 已结束 Run：行级关系与不可逆指纹补证

### RUN-20260829-ERP05-ROW-RELATION-FINGERPRINT-07

- 类型：ERP-05 数据库行级关系证据补证；核对旧模型各表的关系完整性、缺失字段、重复/冲突和可审计指纹。
- 启动依据：前一 Run 已完成官方回读与 9 条 version 不匹配的交叉核验；ProductVersion/PublishAttempt/PlatformProductLink 仍未在生产模型中形成，用户继续要求“继续”。
- 目标：只读取得 `Draft → Batch → BatchItem → Job → ExecutionRun → Receipt → Review → SPU/SKC/SKU` 及媒体/Webhook/同步关系，按 `mapped`、`legacy_unversioned`、`unmatched`、`conflict`、`UNKNOWN` 分类，输出数量、字段覆盖、关系孤儿和集合/关系指纹，不输出原始身份或 payload。
- 允许范围：非交互 SSH；生产 PostgreSQL `SELECT`、系统目录与统计视图；在 SQL/内存中做计数、关系判断、单向摘要；记录来源、时间和查询边界。
- 禁止范围：任何 `INSERT/UPDATE/DELETE`、迁移、锁表、VACUUM、触发业务方法；SHEIN API、Redis payload、队列消费/重试、对象存储访问；输出 SecretId、SecretKey、Token、Cookie、签名、原始 ID、业务键、完整 JSON 或图片字节。
- 失败关闭：表结构/外键/字段语义无法证明、查询出现写入或锁等待迹象、生产连接需要交互或结果无法脱敏时，立即停止并保持 `UNKNOWN`。
- 完成标准：可读取的核心表逐表给出行数、缺失字段和关系分类；所有未能建立新模型映射的记录明确标为 `legacy_unversioned` 或 `UNKNOWN`；前后关键表行数与 PostgreSQL 写入统计无变化；ERP-05 仍有缺口则保持 `BLOCKED`。
- 回滚点：本 Run 不修改生产数据；仅新增本报告/台账记录。
- 当前状态：`BLOCKED`；允许范围内生产行级关系探针已完成，结果见下方；完整对象证据、新模型逐条映射和 9 条官方 version 不匹配仍未闭合。

### RUN-20260829-ERP05-ROW-RELATION-FINGERPRINT-07 结果

- 生产范围：仅执行 PostgreSQL `SELECT`、系统目录和统计视图；未调用 SHEIN API、Control 业务回读方法、Redis/队列、对象存储或任何写路径。
- Schema 与权限：目标表存在并核验到 50 个声明外键；`public.skus` 为普通表、数据库所有者只读计数为 0，但 `shein_runtime` 无 SELECT 权限，应用角色无法读取 SKU 行；其余目标表可按本 Run 范围读取。
- 关系完整性：BatchItem 缺 Batch/Draft 均 0；Job 缺 Run/Batch/BatchItem/Draft 均 0；Receipt 缺 Job/Webhook 均 0；SKC 缺 SPU 或 `spu_id` 均 0；MediaReference 缺 Asset 0、引用计数不一致 0；SyncItem 缺 SyncJob 0。
- Draft/发布链：93 个 Draft 中 82 个有 Job，61 个被多个 Job 复用，单 Draft 最多 6 个 Job；Batch 失败 13、就绪 20；BatchItem 失败 84、就绪 182；2 个 claimed Job 的 claim 已过期，82 个 submitted Job 均无 `completed_at`；12 个 active ExecutionRun 超过 1 小时。
- 新模型与字段缺口：219 个 Job 中缺 `shein_version` 137、缺 `shein_document_sn` 160、缺 `trace_id` 4；26/28 个 ExecutionRun 的 `execution_enabled` 或 `authorizes_publishing` 不同时为真；Receipt 缺 `platform_code` 173、缺 `trace_id` 91、缺 `document_sn` 82、缺 `occurred_at` 91；没有发现无效 JSON 结构或重复 `request_key`/Receipt `dedupe_key`，但 source fingerprint 有 52 个重复组，登记为冲突候选而非已确认冲突。
- 审核与目录：Review 156 条中 version/document/SPU/SKC 各缺 39 条，workflow_stage 全部缺失，audit_state 缺 39 条；严格同时按 store+version+document+SPU 做本地 Job 候选关联为 unique 57、unmatched 99、ambiguous 0，该关联不是官方映射，最终仍为 `UNKNOWN/legacy_unversioned`。SPU 518、SKC 547，SKC→SPU 无孤儿；SPU audit_state 全部为空，SPU/SKC raw_data 均为有效对象。
- 媒体、Webhook、同步：820 个 Asset、542 个 Reference 无孤儿且引用计数一致，542 条引用没有 ProductVersion/Publish-like 类型；Webhook 为 processed 2,972、queued 13，13 条 queued 同时已有 `processed_at`，无重复 dedupe key；SyncJob 为 succeeded 404、failed 169、queued 4、running 1，4 个 active Job 无 `started_at`，339 个 SyncItem 均 succeeded 且无孤儿。
- 新模型分类：本 Run 没有建立任何可审计的 `mapped` 记录；旧关系表记录保留为 `legacy_unversioned`，官方身份、ProductVersion/PublishAttempt/PlatformProductLink、SKU 应用角色行证据及无法唯一归属的关联保持 `UNKNOWN`；严格本地候选的 99 条只记作 `unmatched`，不据此自动修复。
- 零写入：全部目标表精确行数前后相同；`pg_stat_user_tables` 的 inserts/updates/deletes 前后相同；Run 仅产生本报告/台账文档变更。
- 完成门结论：`BLOCKED`。ERP-05 仍缺完整对象清单、ProductVersion/PublishAttempt/PlatformProductLink 逐条映射、9 条官方 version 不匹配的可解释身份和 SKU 应用角色可读证据；不得开始 ERP-06、ERP-20 修复、生产清理或重试。

## 14. 当前正式 Run：对象清单与媒体归属对账

### RUN-20260829-ERP05-OBJECT-INVENTORY-RECONCILIATION-08

- 类型：ERP-05 对象存储清单与 MediaAsset/Reference 归属只读补证；复核已知 9 条官方 version 不匹配的最终安全分类。
- 启动依据：Run 07 已证明 820 个 Asset/542 个 Reference 的数据库关系无孤儿且引用计数一致，但此前只做过逐资产 HEAD，尚未取得 provider-level 完整对象清单；用户批准开始下一步。
- 目标：从生产数据库读取 MediaAsset/Reference 的非敏感元数据集合，使用既有 S3-compatible 配置执行只读 `ListObjectsV2`，用单向 key 指纹对账数据库 object_key 与对象清单；不下载对象字节。复核 9 条 version 不匹配只沿用已取得的 `crossNone=9` 证据，不发起新的业务回读。
- 允许范围：非交互 SSH；生产 PostgreSQL `SELECT`；对象存储只读 `ListObjectsV2`/必要的 `HEAD`；内存计数、总大小、状态分类和不可逆 SHA-256 摘要；不得输出原始 object key、URL、bucket、凭据或 payload。
- 禁止范围：对象上传/下载/删除/复制/改名；数据库写入/迁移；SHEIN API 和 Control 回读方法；Redis payload、队列消费/重试/claim；部署、重启、切换和任何媒体状态修复。
- 失败关闭：对象存储 provider、Endpoint、分页边界、鉴权或响应无法证明只读；列表被截断、key 无法规范化、存在跨店/跨租户不确定归属或出现任意副作用时，停止并将对应对象归为 `UNKNOWN`，不自动处置。
- 完成标准：取得 provider-level 对象总数/总大小/分页完整性；完成 DB Asset key 与 provider key 的 `verified`、`missing_object`、`orphan_object`、`unknown_role` 分类；9 条官方 version 不匹配仍明确为 `no_cross_match/UNKNOWN`；前后数据库行数与写入统计不变。
- 回滚点：本 Run 不修改生产数据；仅新增本报告/台账记录。
- 当前状态：`BLOCKED`；对象清单只读对账已执行但 provider 返回 HTTP 403，结果见下方。

### RUN-20260829-ERP05-OBJECT-INVENTORY-RECONCILIATION-08 结果

- 执行时间：2026-08-29 20:23:36～20:26:53（Asia/Shanghai）；生产环境只读。
- 数据库侧：MediaAsset 820 行，820 行有 object_key，object_key 唯一；status/content_type 全覆盖，sha256 已有 771 行。数据库关键表本轮行数前后相同。
- 对象存储侧：使用生产已配置 S3-compatible 凭据执行一次 `ListObjectsV2`，第 1 页返回 HTTP 403；未取得 provider 对象数量、总大小、分页完整性或 key 集合，因此 Asset 不能分类为 `verified`、`missing_object` 或 `orphan_object`，全部保持 `UNKNOWN`。未下载、上传、删除、复制或改名对象。
- 官方 version 异常：沿用前序只读证据 `total=9`、`crossUnique=0`、`crossNone=9`、`crossAmbiguous=0`；最终安全分类为 `UNKNOWN`，不重新发起业务回读、不重发。
- 写入审计：本脚本只包含 PostgreSQL `SELECT`/系统目录查询和对象存储 GET 列表请求；行数稳定，但 `sync_jobs` 的 PostgreSQL 更新统计受后台并发活动影响增加 2，前后统计不稳定，按 `UNKNOWN/受并发影响` 记录，不能声称本轮统计完全不变。
- 完成门结论：`BLOCKED`。要闭合对象证据，需要 provider 授予受控只读 List 权限或提供可验证的脱敏对象清单；在此之前不得自动清理 404/超时对象、不得修正媒体状态、不得开始 ERP-06 或 ERP-20。

## 15. 当前正式 Run：对象清单权限复核

### RUN-20260829-ERP05-OBJECT-INVENTORY-RECHECK-09

- 类型：ERP-05 对象存储 `ListObjectsV2` 权限恢复后的完整分页只读复核。
- 启动依据：Run 08 第 1 页返回 HTTP 403；用户已在目标 COS 子用户上直接绑定限定存储桶的 `cos:GetBucket` 策略。
- 允许范围：非交互 SSH；使用现有生产环境变量；PostgreSQL `SELECT`/系统统计只读查询；对象存储 `ListObjectsV2` 分页请求；内存计数、总大小、分页完整性和不可逆 key 摘要。
- 禁止范围：对象下载/上传/删除/复制/改名；数据库写入/迁移；SHEIN API、Redis/队列、部署、重启、切换和任何敏感值输出。
- 失败关闭：任何鉴权、Endpoint、分页、跨租户归属或副作用不确定时立即停止；不自动重试、不自动修复、不改变媒体状态。
- 完成标准：对象列表返回成功并分页到 `IsTruncated=false`；只输出数量/大小/摘要，不输出原始 key；数据库关键表行数在 Run 内稳定；既有 9 条官方 version mismatch 证据仍沿用，不发起业务重读。
- 回滚点：本 Run 不修改生产数据；仅新增证据文档记录。
- 当前状态：`BLOCKED`；Run 09 已执行但 provider 第 0 页仍返回 HTTP 403，结果见下方。

### RUN-20260829-ERP05-OBJECT-INVENTORY-RECHECK-09 结果

- 执行时间：2026-08-29 20:53:23～20:56:51（Asia/Shanghai）；生产环境只读。
- Provider：使用当前生产容器内配置的 S3-compatible 凭据发起一次 `ListObjectsV2`，第 0 页返回 HTTP 403；未取得对象数量、总大小、分页完整性或 key 集合，未下载、上传、删除、复制或改名对象。
- 数据库：目标表行数本轮前后稳定；MediaAsset 820 行、820 行有 object_key、object_key 唯一、sha256 771 行；本轮观察到的 PostgreSQL 写入统计前后稳定。
- 官方 version 异常：沿用既有 `total=9`、`crossUnique=0`、`crossNone=9`、`crossAmbiguous=0`，分类仍为 `UNKNOWN`，不发起业务回读或重发。
- 完成门结论：`BLOCKED`。需先核对服务器实际 `SHEIN_MEDIA_S3_ACCESS_KEY_ID` 所属 CAM 子用户是否就是策略直接关联主体，并核对策略 action/resource；核对完成前不得继续重试、清理媒体或开始 ERP-06/ERP-20。

## 16. 当前正式 Run：修正子用户后的对象清单权限复核

### RUN-20260829-ERP05-OBJECT-INVENTORY-RECHECK-10

- 类型：ERP-05 对象存储 `ListObjectsV2` 权限修正后的完整分页只读复核。
- 启动依据：用户确认此前策略绑定到了错误子用户，并要求查看修正后的结果。
- 允许范围：非交互 SSH；使用服务器当前生产容器环境变量；PostgreSQL `SELECT`/系统统计；对象存储 `ListObjectsV2` 分页请求；内存计数，不输出密钥、原始 object key 或 payload。
- 禁止范围：对象上传/下载/删除/复制/改名；数据库写入/迁移；SHEIN API、Redis/队列、部署、重启、切换和任何状态修复。
- 失败关闭：单次分页请求返回鉴权错误、响应不确定或出现副作用时立即停止；不自动重试、不自动修复、不改变媒体状态。
- 完成标准：对象列表成功并分页到 `IsTruncated=false`；输出对象数量/总大小/分页完整性；数据库关键表行数、MediaAsset 指标和本 Run 内统计可审计；既有 9 条官方 version mismatch 继续沿用，不发起业务回读或重发。
- 回滚点：本 Run 不修改生产数据；仅新增证据文档记录。
- 当前状态：`BLOCKED`；结果见下方。

### RUN-20260829-ERP05-OBJECT-INVENTORY-RECHECK-10 结果

- 执行时间：2026-08-29 21:08:11 左右（Asia/Shanghai）；生产环境只读。
- 运行时身份：读取服务器容器内实际配置，仅在探针内使用；未输出 SecretId、SecretKey、Token 或完整 AccessKey。
- Provider：`ListObjectsV2` 第 0 页返回 HTTP 403，`pages=0`、`objects=0`、`bytes=0`、`complete=false`；未取得对象清单，未下载、上传、删除、复制或改名对象。
- 数据库：13 张关键表行数前后完全相同；MediaAsset 仍为 820 行、820 行有唯一 `object_key`、771 行有 `sha256`。本 Run 内 PostgreSQL 统计增加 inserts 10、updates 7、deletes 0，属于后台并发活动，不能归因于本探针。
- 官方 version mismatch：沿用 `total=9/crossUnique=0/crossNone=9/crossAmbiguous=0`，分类仍为 `UNKNOWN`；不发起业务回读或重发。
- 完成门结论：`BLOCKED`。当前仍需在 CAM 中把 `polaris-media-list-readonly` 直接绑定到服务器运行时 `SHEIN_MEDIA_S3_ACCESS_KEY_ID` 所属的正确子用户，并确认 `cos:GetBucket` 资源与实际 bucket/region 匹配；在闭合前不得进入 ERP-06、ERP-20、媒体清理或自动重试。

## 17. 当前正式 Run：策略调整后的对象清单权限复核

### RUN-20260829-ERP05-OBJECT-INVENTORY-RECHECK-11

- 类型：ERP-05 CAM 策略调整后的对象存储 `ListObjectsV2` 完整分页只读复核。
- 启动依据：用户确认 `wow-rug-cos-service` 为目标子用户，并完成 `polaris-media-list-readonly` 策略调整后要求验证。
- 允许范围：非交互 SSH；使用服务器当前生产容器环境变量；PostgreSQL `SELECT`/系统统计；对象存储单次 `ListObjectsV2` 分页请求；内存计数，不输出密钥、原始 object key 或 payload。
- 禁止范围：对象上传/下载/删除/复制/改名；数据库写入/迁移；SHEIN API、Redis/队列、部署、重启、切换和任何状态修复。
- 失败关闭：鉴权错误或响应不确定时立即停止，不自动重试、不自动修复、不改变媒体状态。
- 当前状态：`BLOCKED`；结果见下方。

### RUN-20260829-ERP05-OBJECT-INVENTORY-RECHECK-11 结果

- 执行时间：2026-08-29 21:21:04 左右（Asia/Shanghai）；生产环境只读。
- Provider：`ListObjectsV2` 第 0 页返回 HTTP 403，`pages=0`、`objects=0`、`bytes=0`、`complete=false`；未取得对象清单，未发生对象下载、上传、删除、复制或改名。
- 数据库：13 张关键表行数前后完全相同；MediaAsset 仍为 820 行、820 行有唯一 `object_key`、771 行有 `sha256`。本 Run 内 PostgreSQL 统计 inserts 增加 4、updates 增加 4、deletes 不变，属于后台并发活动，不能归因于本探针。
- 官方 version mismatch：沿用 `total=9/crossUnique=0/crossNone=9/crossAmbiguous=0`，分类仍为 `UNKNOWN`；不发起业务回读或重发。
- 完成门结论：`BLOCKED`。用户提供的服务器掩码前缀/后缀与 `wow-rug-cos-service` API 密钥截图一致，未记录完整密钥；但 `ListObjectsV2` 仍 HTTP 403，仍需在该用户权限页确认 `polaris-media-list-readonly` 的直接关联及最终 JSON 已保存生效；在闭合前不得继续重试、清理媒体或进入 ERP-06/ERP-20。
