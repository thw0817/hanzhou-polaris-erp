# 涵舟 Polaris 商业 ERP 升级主交接文档（V2 修正版）

版本：2026-08-30-v33
状态：**当前唯一有效的新对话入口；执行状态以执行台账最新版本为准**
当前执行：用户已批准 COS-first 与 ERP-05 历史映射冻结豁免；ERP-05 已完成范围收口，ERP-06 已完成规范数据模型、版本冻结、原子发布交接、Outbox claim/lease、SHEIN adapter boundary、发布结果持久化、Worker 编排、真实 sender/readback 边界、官方回读事实落账、单阶段官方回读编排和发布-回读组合隔离验证；预发/生产接入前置审查已取得真实服务器只读证据，但结果为 `NO-GO`：生产仍运行旧 release/旧 Worker，未执行 ERP-06 正式 migration，发布开关处于开启状态但没有 ERP-06 Outbox/官方回读闭环。全站诊断日志保持已实现但未部署，本轮不继续扩展。ERP-07 当前开始适配器契约目录隔离基础，ERP-07 整体仍在进行，ERP-08～ERP-23 尚未开始。
方案名称：**涵舟 Polaris（北极星）商业 ERP 升级计划（HANZHOU-POLARIS）**  
工作区：`/Users/tianhanwen/Documents/SHEIN爆单了`  
修正原因：明确分离历史已执行工作、17 个板块最新产品方案和 ERP-00～ERP-23 未来实施路线。

> 权限边界：本文只记录事实、目标、风险和后续协作方式，不自动授权修改代码、数据库、云端配置或 SHEIN 数据。用户说“分析/检查”时只读；用户明确说“修复/部署/执行”时才进入相应动作。

---

## 0. 先读这一节：三套内容不是一套方案

此前交接把三类资料放在一起，容易让人误以为 ERP-00～ERP-23 已经执行，或误以为它就是凌晨讨论的 17 个板块方案。正确关系如下。

| 层级 | 名称 | 内容 | 状态 | 权威文件 |
| --- | --- | --- | --- | --- |
| A | 历史修复与部署记录 | 旧“第 1～20 步”、NEXUS/EVO/SRF、发布/同步/审核中心/复选框等历次修复和 release | 历史上确实执行过许多步骤并有部署记录；当前效果仍需现场核验 | `REBUILD_HANDOFF_MASTER_2026-08-28.md`、`REBUILD_HANDOFF_2026-08-03.md` 等历史交接 |
| B | 17 个板块最新详细方案 | 账号权限、店铺、商品、建档、发布、回读、素材、AI、合规、经营、履约、售后、财务、价格、增长、协同、BI | **最新产品与架构目标，已讨论并完整记录；尚未作为整体实施完成** | `COMMERCIAL_ERP_MODULE_ARCHITECTURE_2026-08-28.md` |
| C | ERP-00～ERP-23 | 为落实 17 个板块而新编制的分阶段工程治理与实施路线 | **当前路线：ERP-00～ERP-04 已完成，ERP-05 已按用户批准的 COS-first/历史映射冻结豁免完成范围收口，ERP-06 正在进行非生产模型、版本冻结实现与验证，ERP-07～ERP-23 尚未开始；前序阻断 Run 保留** | `COMMERCIAL_ERP_MASTER_EXECUTION_PLAN_2026-08-28.md`、执行台账 |

必须牢记：

1. 历史“第 19 步已部署”不等于 `ERP-19` 已执行。
2. 17 个板块是“做成什么样”；ERP-00～23 是“将来可能怎样实施”。
3. 17 个板块已记录完整，不代表对应代码、数据和云端已经完成。
4. ERP 路线可以在正式启动前根据当前代码和生产事实修订；不能反过来篡改已发生的历史。
5. 新对话不自动开始 ERP-00，也不自动修复或部署。

---

## 1. 新对话正确启动指令

将下面内容和本文一起交给新对话：

```text
你是“涵舟 Polaris 商业 ERP 升级计划”的项目架构与交付负责人。

先完整阅读：
1. docs/HANZHOU_POLARIS_REBUILD_HANDOFF_V2_2026-08-29.md
2. docs/COMMERCIAL_ERP_MODULE_ARCHITECTURE_2026-08-28.md
3. docs/HANZHOU_POLARIS_API_SOURCE_CATALOG_2026-08-29.md
4. docs/HANZHOU_POLARIS_MASTER_BLUEPRINT_2026-08-29.md

需要了解历史时再读：
5. docs/REBUILD_HANDOFF_MASTER_2026-08-28.md
6. docs/REBUILD_HANDOFF_2026-08-03.md

ERP-00～ERP-23 不是历史已执行步骤；当前已由用户明确启动并完成 ERP-00～ERP-04。ERP-05 已完成只读证据盘点和 COS 原生对象对账；用户已批准 COS-first，并批准历史 ProductVersion/PublishAttempt/PlatformProductLink 映射冻结为只读 legacy，不迁移、不恢复、不删除，不作为新链路进入 ERP-06 的前置条件。ERP-06 当前执行规范模型、事件账本、版本冻结实现、ProductVersion 到 Attempt/Command/Outbox 原子交接、隔离 Dispatcher/Worker、SHEIN adapter boundary、`send_started`/结果持久化和隔离验证；foundation、版本冻结、原子 handoff 与零远端演练均已通过，但生产切换尚未完成；生产迁移仍需单独批准。后续 ERP-07 及生产写入仍须以前一步完成门和单独批准为前提。

先只读理解并向我汇报：
- 17 个板块的整体目标和相互依赖；
- 当前我指定板块的现状、问题、目标方案和待确认事项；
- 哪些是历史事实，哪些是当前已验证事实，哪些只是未来设计。

未经我明确要求，不要修代码、改数据、部署、重启服务、切换开关或调用 SHEIN 写接口；ERP-06 仅按已批准的非生产设计/验证范围继续，任何生产迁移或外部写入都必须重新取得明确批准。
```

---

## 2. 方案权威顺序

发生冲突时按以下顺序处理：

1. 用户当前明确请求和边界。
2. 本 V2 修正版交接的身份、状态和读取规则。
3. 17 个板块详细架构：决定目标产品应是什么。
4. 当前 SHEIN 官方文档与当前店铺真实响应：决定外部字段、枚举、限制和事实。
5. 当前源码、数据库、运行容器、队列、静态产物和线上页面的实测证据。
6. API 资料目录、总蓝图和工程规则。
7. ERP-00～ERP-23：仅在用户确认采用后约束未来实施。
8. 历史交接和旧 release：只证明过去记录，不自动证明当前线上状态。

若文档与当前运行事实冲突，记录差异并请求决策；不得默默选择一边，也不得用页面文案覆盖平台事实。

---

## 3. 最新产品目标：17 个业务板块

详细、完整方案以 `COMMERCIAL_ERP_MODULE_ARCHITECTURE_2026-08-28.md` 为准。17 个板块是：

1. 账号、成员、角色与店铺权限。
2. 店铺接入、SHEIN 授权、店铺生命周期、多店群组织与切店体验。
3. 商品主数据、SPU/SKC/SKU、草稿版本与商品生命周期。
4. 商品建档、批量建品、编辑器、类目属性与模板复用。
5. 发布命令、批次、队列、Worker 与 SHEIN 回执闭环。
6. 官方回读、Webhook、审核状态投影与商品审核中心。
7. 素材资产、商品图片、上传处理、用途映射与对象存储生命周期。
8. 标题规则、AI 标题、视觉识别与批量生成调度。
9. 商品合规、资质证书、1630/1631、实拍图、警示语与发布阻断。
10. 销量、库存、在途、备货、经营预警与多店经营分析。
11. 采购、备货、仓库、发运物流与履约闭环。
12. 退货、报废、质量缺陷、索赔申诉、平台处罚与财务对账。
13. 财务、成本、利润、结算、发票、资金与多币种经营核算。
14. 价格生命周期、平台核价/议价、建议零售价、活动价与利润保护。
15. 运营活动、商品推广、选品测款、商品分层与生命周期增长。
16. 团队任务、审批、通知、SLA 与协同工作流。
17. 数据分析、报表中心、指标治理与管理驾驶舱。

跨板块总原则：

- SHEIN 官方事实、内部领域事实、命令、回执、投影和人工任务分层保存。
- 页面不是事实 owner；页面只消费稳定状态码、允许动作和一致快照。
- 租户、成员、店铺、对象和字段权限必须在服务端重复校验。
- 外部写操作必须可审计、幂等、可恢复；`accepted`、`received`、`auditing`、`effective` 分开。
- 商业分析只使用有来源、口径、时间和质量状态的数据；未知不能补 0。
- 这是内部商业 ERP，不做无边界 SaaS，不复制 SHEIN 后台，不为重构整体换皮。

---

## 4. ERP-00～ERP-23 的正确身份

`COMMERCIAL_ERP_MASTER_EXECUTION_PLAN_2026-08-28.md` 是未来实施路线草案，覆盖源码接管、单一 V2、CI/预发、数据模型、Adapter、发布与回读、商业模块、可观测性、安全、Staging、金丝雀和遗留退役。

当前状态：

- ERP 步骤总数：24。
- `COMPLETE`：ERP-00、ERP-01、ERP-02、ERP-03、ERP-04。
- `BLOCKED`：ERP-05（行级关系 Run 已完成允许范围内检查；Run 08～Run 11、Run 13 的 S3/AWS4 兼容列表请求返回 HTTP 403，但 Run 14 的 COS 原生 HMAC-SHA1 列表成功并完成归属对账：633 个对象匹配，187 条历史媒体记录无远端对象且均无引用；目标关系孤儿为 0，但 ProductVersion/PublishAttempt/PlatformProductLink 逐条映射、9 条官方 version 不匹配和 SKU 应用角色可读证据仍缺失；前序阻断记录保留）。
- `IN_PROGRESS`：ERP-06 整体生产接入门仍为 `NO-GO`；当前活动开发单元为 ERP-07 契约目录 Run：`RUN-20260830-ERP07-ENDPOINT-CONTRACT-01`。
- `NOT_STARTED`：ERP-08～ERP-23；ERP-07 整体仍未完成。
- ERP-05 已按用户批准的 COS-first/历史映射冻结豁免完成范围收口；Run 14 的历史证据缺口继续保留为只读 legacy，不阻断 ERP-06 新链路，但不允许历史自动回填。

使用规则：

1. 用户先选择继续讨论、调整方案、做只读核验，或正式采用实施路线。
2. 只有用户明确说“开始 ERP-XX”或明确批准按该路线实施，才创建对应 Run。
3. 启动前要重新核对当前源码、生产和历史已修复内容，避免把已经解决的问题重复重做。
4. 若路线与 17 个板块目标冲突，先修订路线；若路线与用户当前需求冲突，以用户当前需求为准。
5. 紧急修复可独立进行，但必须定义目标、非目标、失败证据、回归范围和部署授权；不能伪称某个 ERP 步骤因此完成。

---

## 4.1 已批准的 COS-first 边界

1. COS 是新系统媒体文件本体的唯一主存储；PostgreSQL 保存 Asset 元数据、业务引用、ProductVersion 所有权、完整性和审计。
2. 当前已核验的 633 个 COS 对象进入新系统可复用资产边界；187 条无远端对象且无业务引用的历史记录只读冻结。
3. 不自动删除、恢复、重试、改写历史媒体状态，不因历史映射缺口伪造 ProductVersion、PublishAttempt 或平台 Link。
4. 新上传顺序固定为：COS 直传 → 服务端完整性/存在性核验 → 数据库登记元数据和引用。
6. ERP-06 当前设计契约见 [ERP06_DATA_MODEL_EVENT_LEDGER_DESIGN_2026-08-29.md](./ERP06_DATA_MODEL_EVENT_LEDGER_DESIGN_2026-08-29.md)；该文档完成门通过前，不执行生产迁移或生产写入。
5. ERP-06 只做新模型、版本冻结实现和隔离环境验证；任何生产迁移、历史修复、媒体清理和 SHEIN 写入仍需独立 Run 与批准。

### 4.2 ERP-06 当前 Run 事实

- PublishBatch/BatchItem 已在隔离 additive 草案中通过 nullable 扩展接入新链路；新 BatchItem 显式绑定 ProductVersion、来源 Draft、CatalogProduct 和租户/店铺范围，历史批次行不回填。
- PublishAttempt/Command/Outbox 原子交接现在必须携带 Batch/BatchItem，幂等返回会复核完整批次项关联；`result_unknown` 仍禁止新 requestKey 重发。
- 旧 `publish_jobs`/`publish_receipts` 仅由 `legacy_readonly` adapter 读取和分类，不生成新版本/尝试，不写回旧表，不泄露 raw JSON 凭证。
- 本 Run 仍只在本地 fake pool 与一次性 PostgreSQL rehearsal 验证；未接入生产路由、生产 Dispatcher/Worker、生产迁移或 SHEIN 写接口。

### 4.3 ERP-06 Outbox Dispatcher/Worker 隔离事实

- 当前 Run：`RUN-20260830-ERP06-OUTBOX-DISPATCH-WORKER-IMPLEMENTATION-09`。
- 已实现隔离服务：`server/cloud/erp06-outbox-dispatcher-service.js`。Dispatcher 按租户/店铺 claim Outbox，使用 `FOR UPDATE SKIP LOCKED`、递增 attempt、lease 和确定性 `jobId=publish_command_id`；Worker 只领取已 dispatched 且 Attempt 非 `result_unknown` 的 Command，写入 worker lease 后在本 Run dry-run 释放回 `queued`。
- 新增数据库草案字段用于 worker claim 与投递证据：`publish_commands.worker_id/worker_claim_id/worker_claimed_at/worker_lease_expires_at`；`product_publish_outbox.queue_job_id/dispatched_at/last_error`，并增加状态配对约束。仍属于隔离 additive draft，不是正式生产迁移。
- 失败保护已验证：队列失败只标记当前 lease 对应 Outbox 为 `failed`；scope/command identity 不一致拒绝；`result_unknown` Attempt 不得被 Worker 再次领取；payload 不含 credential、raw body、图片 URL。
- 证据：新增服务定向回归 `6/6`；与前序 ERP-06 定向回归合计 `29/29`；一次性本机 Docker PostgreSQL `127.0.0.1:55437/erp06_outbox_rehearsal` 真实应用 001–046 与 047 草案并通过 handoff → dispatch → worker dry-run → `result_unknown` no-claim；临时容器已移除，现有 staging 未触碰。
- 明确未完成：没有接入生产 Dispatcher/Worker，没有运行真实 SHEIN adapter/HTTP，没有发送、重发、上传、删除或修改生产数据；本 Run 的 Worker 结果不等于 SHEIN 接收或商品发布成功。

### 4.4 ERP-06 SHEIN publish adapter boundary 隔离事实

- 当前 Run：`RUN-20260830-ERP06-PUBLISH-ADAPTER-BOUNDARY-10`。
- 已新增隔离契约：[erp06-shein-publish-adapter-contract.js](../server/cloud/erp06-shein-publish-adapter-contract.js) 与其测试；适配器只接受既有 `erp06-publish-command-v1` 队列命令和同租户/店铺、同 `ProductVersion` 指纹的冻结 source，唯一写 endpoint 固定为 `/open-api/goods/product/publishOrEdit`。
- 边界要求发送前先持久化 `send_started`；默认 `executionEnabled=false`，关闭时不加载冻结 source、不配置 sender、不调用 SHEIN。适配器未接入生产 Worker，也没有真实 sender、凭证读取或远端 HTTP。
- 结果分类：完整的官方成功回执才投影为 `accepted/submitted`；明确响应按 `failed` 分类，`openapi00001` 仅标记 `requiresReauthorization`，429/5xx 作为可重试明确失败；无明确响应、网络异常或成功响应缺少完整 SPU/SKC/SKU/版本均进入 `unknown/result_unknown`，禁止自动重试。
- 结果回读先提供 `/open-api/goods/query-document-state` 的 `not_implemented` 占位，明确 `externalRead=false`、`resolvesResultUnknown=false`；占位不能解除 `result_unknown`，不能建立平台 Link 或完成状态。
- 失败回归覆盖 10 项（含 sender 缺失与 `send_started` 持久化失败），只使用内存 fake，不连接生产 PostgreSQL/COS/Redis/队列/SHEIN；历史数据仍冻结只读。
- 收尾证据：全量测试 `1247/1247`、秘密扫描 `findings=[]`、V2 构建、release audit、`node --check` 与 `git diff --check` 均通过；现有 staging 容器仅做只读核对且未触碰。本 Run 状态：`COMPLETE`。
- 明确未完成：真实 SHEIN sender/签名凭证接入、`send_started`/receipt 持久化实现、官方 Webhook/单据状态回读、SPU 关系回读、生产 Worker/迁移/部署和任何 SHEIN 写入，均需单独评审与明确批准。

### 4.5 ERP-06 send_started 与发布结果持久化隔离事实

- 当前 Run：`RUN-20260830-ERP06-PUBLISH-RESULT-PERSISTENCE-11`。
- 已新增隔离 repository：[erp06-publish-result-repository.js](../server/cloud/erp06-publish-result-repository.js) 与回归测试；`recordSendStarted` 在同一事务内追加 `publish_send_started` 事件、更新 Attempt=`dispatched` 和 Command=`send_started_at`；`recordPublishResult` 在同一事务内追加平台回执/结果事件、更新 Attempt/Command 最终结果并清理当前 Worker claim。
- accepted/failed/unknown 的结果合同与 adapter boundary 一致：accepted 需要完整 receipt，明确失败区分可重试与终止失败，网络异常/不完整响应进入 `result_unknown` 且 `retryable=false`；重复相同结果按 dedupe 幂等，未知结果不得被覆盖或自动重发，不建立 PlatformProductLink。
- 048 仅为 `server/cloud/erp06-draft/` 中的 additive 草案：新增 `publish_commands.send_started_at/result_recorded_at`、配对约束、索引和隔离 preflight/verify/空库 rollback；未修改 `server/cloud/migrations/`，未执行正式迁移。
- 失败保护已验证：scope、ProductVersion、Worker claim、`send_started` 前置条件和敏感结果字段漂移均拒绝；事务中途失败不会留下半条事件、回执或状态；新回归 `12/12`，ERP-06 相关定向回归 `72/72`。
- 收尾证据：全量测试 `1259/1259`、服务端测试 `125/125`、秘密扫描 `findings=[]`、V2 构建、release audit、`node --check` 与 `git diff --check` 均通过；staging Redis/PostgreSQL/MinIO 只读核对为 healthy，未触碰。
- 明确未完成：repository 与本 Run Worker 编排尚未接入生产 Worker；真实 SHEIN sender/签名凭证、官方 Webhook/单据状态/SPU 回读、正式生产迁移、生产部署和任何 SHEIN 写入均未执行。

### 4.6 ERP-06 Worker 编排边界隔离事实

- 当前 Run：`RUN-20260830-ERP06-PUBLISH-WORKER-ORCHESTRATION-12`。
- 本 Run 只在隔离代码与 fake dependency 中实现 `erp06-publish-command-v1` 的 Worker 编排：先按租户/店铺 claim Command，再验证 Command/Attempt/ProductVersion/版本指纹/claim identity，随后调用隔离 SHEIN adapter；adapter 的 `send_started` 通过结果 repository 先行持久化，最终 accepted/failed/unknown 结果再持久化。
- `not_sent` 只在显式 dry-run 下调用 `releaseCommandDryRun`；`result_unknown` 和 `superseded_by_new_attempt` 在 adapter 前阻断；结果持久化异常原样上抛，不释放、不转成安全重试。默认仍关闭真实执行和远端调用。
- 实际文件：[erp06-publish-worker-service.js](../server/cloud/erp06-publish-worker-service.js)、[erp06-publish-worker-service.test.js](../server/cloud/erp06-publish-worker-service.test.js)。未修改旧 `product-publish-worker`，未修改 `server/cloud/migrations/`，未接入生产队列、生产 Worker、真实 sender、凭证或 SHEIN HTTP。
- 证据：Worker 回归 `7/7`；ERP-06 相关定向回归 `79/79`；全量测试 `1266/1266`、服务端测试 `125/125`；秘密扫描 `findings=[]`；V2 构建、release audit、`node --check`、`git diff --check` 均通过；现有 staging Redis/PostgreSQL/MinIO 仅只读核对，未触碰。
- 本 Run 状态：`COMPLETE`。ERP-06 整体仍为 `IN_PROGRESS`；生产 Worker 接入、真实 SHEIN sender/签名凭证、官方 Webhook/单据状态/SPU 回读、正式迁移、生产部署和任何 SHEIN 写入均未执行。

### 4.7 ERP-06 真实 sender → 官方回读边界隔离事实

- 当前 Run：`RUN-20260830-ERP06-SHEIN-REMOTE-BOUNDARY-13`。
- 本 Run 新增隔离边界：[erp06-shein-remote-boundary.js](../server/cloud/erp06-shein-remote-boundary.js)；它只接受 `erp06-publish-command-v1`，在远端动作前校验 Command、Attempt、ProductVersion、来源 Revision、租户/店铺和版本指纹，拒绝 scope/identity/path/body 漂移。
- 发布写路径固定为既有 `/open-api/goods/product/publishOrEdit`，并要求显式 `authorizesPublishing=true`、Attempt=`claimed`；授权、开关或契约不满足时，不解析凭证、不调用网络。上游 status/code/traceId 原样保留，不自动重试。
- 官方回读路径固定为 `/open-api/goods/query-document-state` 与 `/open-api/goods/spu-info`；请求体分别固定为 `version + spuList:[{spuName}]`、`languageList + spuName`，回读只经过安全 normalizer，不在本边界层写入数据库。
- `result_unknown` 只能在非空且版本、SPU 证据完整的官方回读下解除；空回读、部分回读、版本漂移、SPU 不匹配和 malformed 记录均保持未解析，不允许重发。回读要求 Attempt=`submitted` 或 `result_unknown`，并且 `authorizesReadback=true`。
- 默认开关为 `executionEnabled=false`、`readbackEnabled=false`；本 Run 的 sender/request/credential resolver 全部为 fake 或注入依赖，没有真实签名凭证和 SHEIN HTTP。
- 证据：新边界回归 `9/9`；组合定向回归 `40/40`；全量测试 `1275/1275`；服务端测试 `125/125`；秘密扫描 `scannedFiles=627, findings=[]`；V2 构建、release audit、`node --check`、`git diff --check` 均通过；现有 staging Redis/PostgreSQL/MinIO 仅只读核对，未触碰。
- 本 Run 状态：`COMPLETE`。ERP-06 整体仍为 `IN_PROGRESS`；尚未接入生产 Worker、预发/生产凭证、生产队列、回读持久化、正式 migration、部署或任何 SHEIN 写入。

### 4.8 ERP-06 官方回读事实落账隔离事实

- 当前 Run：`RUN-20260830-ERP06-OFFICIAL-READBACK-PERSISTENCE-14`。
- 本 Run 新增隔离 repository：[erp06-official-readback-repository.js](../server/cloud/erp06-official-readback-repository.js)。它接收已由远端边界校验并安全投影的 document-state/SPU readback，不接收或保存 raw SHEIN response、凭证、图片地址或授权对象。
- 官方回读事实在单一事务内依次落入 `official_event_inbox`、`product_publish_receipts` 和 `product_events`，使用 scope、stage、projection fingerprint 和 dedupe key 保护重复回读；复用 047 草案已有表，不新增正式 migration。
- 空回读、部分回读、版本不一致、SPU 关系不完整或敏感字段均 fail closed 或标记 `unknown`，不能解除 `result_unknown`。只有边界明确给出完整官方证据时，`result_unknown` 才能转为 `resolved_by_official_readback`；`submitted` 只保留回读证据，不改成 `completed`，不建立 `PlatformProductLink`。
- 失败保护已验证：scope/版本/Attempt 状态漂移、Inbox/Receipt/Event 冲突、重复事实、敏感字段、缺少安全 projection 和破坏性 SQL 均被拒绝或回滚；事务失败不会留下半条事实。
- 证据：新回读持久化回归 `8/8`；组合定向回归 `60/60`；全量测试 `1283/1283`；服务端测试 `125/125`；秘密扫描 `scannedFiles=629, findings=[]`；V2 构建、release audit、`node --check`、`git diff --check` 均通过；现有 staging Redis/PostgreSQL/MinIO 仅只读核对，未触碰。
- 本 Run 状态：`COMPLETE`。ERP-06 整体仍为 `IN_PROGRESS`；repository 尚未接入生产 Worker、真实凭证、生产队列、真实 SHEIN HTTP、正式 migration 或部署。

### 4.9 ERP-06 单阶段官方回读编排隔离事实

- 当前 Run：`RUN-20260830-ERP06-OFFICIAL-READBACK-ORCHESTRATION-15`。
- 本 Run 新增隔离编排服务：[erp06-official-readback-orchestrator.js](../server/cloud/erp06-official-readback-orchestrator.js)。一次操作必须明确选择 `document_state` 或 `spu_info`，编排层只调用对应的 remote boundary 方法，不隐式补调另一阶段。
- 关闭态边界：remote boundary 返回 `disabled` 时，编排层返回安全关闭状态，不解析凭证、不发网络请求、不调用 readback repository；成功回读才允许向既有 repository 传递一次安全 projection。
- 作用域与版本保护：队列任务 contract、tenant/store、Command/Attempt/ProductVersion、source revision、版本指纹、stage、官方 endpoint 和 dry-run projection 均在编排入口校验；版本指纹与队列任务不一致直接拒绝。
- 失败保护：授权失败、非法输入、stage/endpoint/状态漂移、危险或非 `read` 结果、repository 失败均 fail closed；不自动重试、不自动重发、不把空回读当成功、不把 `submitted` 改成 `completed`。
- 实际文件：[erp06-official-readback-orchestrator.js](../server/cloud/erp06-official-readback-orchestrator.js)、[erp06-official-readback-orchestrator.test.js](../server/cloud/erp06-official-readback-orchestrator.test.js)。未修改生产 Worker、路由、队列、正式 migration 或现有 staging。
- 证据：新编排回归 `8/8`；组合定向回归 `68/68`；全量测试 `1291/1291`；服务端测试 `125/125`；秘密扫描 `scannedFiles=631, findings=[]`；V2 构建、release audit、`node --check`、`git diff --check` 均通过。
- 环境证据：现有 staging Redis/PostgreSQL/MinIO 仅只读核对且均 healthy；测试仅使用 fake remote/repository，未解析真实凭证、未连接生产或 staging、没有真实 SHEIN HTTP。
- 本 Run 状态：`COMPLETE`。ERP-06 整体仍为 `IN_PROGRESS`；真实 Worker/凭证/生产队列/回读持久化接线、正式 migration、生产部署和 SHEIN 写入仍未开始。

### 4.10 ERP-06 发布 → 官方回读 → 结果落账组合隔离事实

- 当前 Run：`RUN-20260830-ERP06-PUBLISH-READBACK-COMPOSITION-17`。
- 本 Run 暂停诊断日志扩展，新增隔离组合器：[erp06-publish-readback-pipeline.js](../server/cloud/erp06-publish-readback-pipeline.js)。它只编排既有 Worker、SHEIN publish adapter、remote boundary、单阶段 official readback orchestrator 与 readback repository，不接入生产 Worker、Control 路由或现有 staging。
- Worker 接线修正：`adapterFactory` 与 `adapter.execute` 现在共享同一份冻结 job 和一次性授权对象，授权中携带 tenant/store、Command、Attempt、ProductVersion、claimId 与 `attemptState=claimed`，避免 factory 与 execute 使用不同作用域。
- 成功顺序固定为：claim → source/冻结版本 → `send_started` → SHEIN publish boundary → publish result persistence → 明确选择一个官方回读阶段 → readback persistence；`spu_info` 不会被隐式追加到 `document_state`，反之亦然。
- 失败保护：执行关闭时为 `not_sent` 并仅在显式 dry-run 释放；`result_unknown` 只允许以 `result_unknown` Attempt 状态回读，空/不完整证据保持 `readback_pending`，未回读前不重发；回读 scope/fingerprint 非法在 claim 前拒绝；结果或回读落账失败原样上抛，不自动重试。
- 实际文件：[erp06-publish-readback-pipeline.js](../server/cloud/erp06-publish-readback-pipeline.js)、[erp06-publish-readback-pipeline.test.js](../server/cloud/erp06-publish-readback-pipeline.test.js)，以及更新后的 [erp06-publish-worker-service.js](../server/cloud/erp06-publish-worker-service.js) 与测试。未修改旧 `product-publish-worker`、Control 路由、生产配置、正式 migration 或诊断日志实现。
- 本 Run 已通过：组合/Worker 定向回归 `15/15`；回归覆盖成功顺序、关闭态零远端、`result_unknown` 未解除、单阶段、scope 漂移、回读持久化失败、缺少回读规格和 factory/execute 授权一致性；项目全量 `npm test` `1311/1311`；V2 构建、静态 release audit、秘密扫描、JS 语法和差异检查均通过。
- 当前状态：`COMPLETE / ISOLATED ONLY`。本 Run 未解析真实凭证、未连接生产或现有 staging、未发真实 SHEIN 请求、未部署、未执行 migration；日志功能保持已实现但未部署，本 Run 未继续扩展。ERP-06 下一步仍需另行评审预发真实接入授权和回滚证据。

## 5. 历史已执行工作如何使用

历史交接记录显示，项目已经进行过大量真实开发、测试和部署，包括但不限于：

- 旧第 1～20 步的发布、同步、审核中心改造与上线过程。
- 发布真实执行、SHEIN 回读、状态分类、草稿交接、手动刷新和复选框多轮修复。
- AI 标题 A2 图片复用、A3 有界并发及后续审计。
- NEXUS-EVO、SRF、HEF/HST/HWF 等专项治理和 release。
- 多次生产切换、回滚点、数据库迁移、运行角色审计和浏览器验收。

这些记录的正确用途是：

- 确认历史上改过哪些 owner、接口、状态、测试和部署包。
- 防止新方案重复造轮子或重新引入已经修过的回归。
- 为生产差异、版本漂移和回归定位提供证据。

这些记录不能单独证明：

- 2026-08-29 当前生产仍运行对应 release。
- 当前 Worker、Control、静态前端和数据库迁移完全一致。
- 某个具体商品已经被 SHEIN 接收或审核。
- 历史修复没有在后续部署中被覆盖。

---

## 6. 当前源码与运行架构基线

以下是 2026-08-29 文档整理时的本地事实，不等于实时生产事实。

### 6.1 技术栈

- 前端：React 18、TypeScript、Vite、React Router、TanStack Query/Table/Virtual、Radix、Tailwind。
- 服务端：Node.js ESM，Control API 与独立 Worker。
- 数据：PostgreSQL 16、Redis 7、BullMQ。
- 文件：S3 兼容私有对象存储与短时上传/下载票据。
- 边缘与部署：Nginx、Compose、release 目录和 `/opt/shein-console/current` 原子切换。

### 6.2 主要源码 owner

| 领域 | 主要路径 |
| --- | --- |
| V2 路由与应用壳 | `src-v2/app/App.tsx`、`src-v2/app/AppShell.tsx` |
| 前端 API/契约 | `src-v2/lib/api.ts`、`src-v2/lib/*contract*` |
| 商品、发布、审核 | `src-v2/features/publishing/`、`server/cloud/publish-*`、`product-review-*`、`review-center-*` |
| 合规 | `src-v2/features/compliance/`、`server/cloud/compliance-*` |
| 经营与刷新 | `src-v2/features/operations/`、`server/cloud/store-business-*` |
| 模板和 AI 标题 | `src-v2/features/templates/`、`server/cloud/ai-title-service.js` |
| SHEIN Adapter | `server/shein-client.js`、`server/shein-product.js`、`server/shein-compliance.js`、`server/shein-upload.js` |
| Control 与授权 | `server/cloud/control-server.js`、`web-auth.js`、`web-shein-authorization.js` |
| Webhook/回读 | `server/cloud/webhook-*`、`document-state-projections.js`、`spu-readback-projections.js` |
| 媒体 | `server/cloud/media-*` |
| 迁移与审计 | `server/cloud/migrations/`、`migrate.js`、runtime/release audit |

### 6.3 运行拓扑

`deploy/docker-compose.cloud.yml` 声明 PostgreSQL、Redis、migration、runtime database audit、control、经营刷新、规则刷新、合规同步、商品发布、Webhook 与媒体清理服务。目标形态仍是模块化单体加有界 Worker，不是大规模微服务拆分。

### 6.4 当前本地资产风险

- Git 当前没有可信 HEAD，仓库内容几乎全部未跟踪；禁止 reset/clean/批量删除。
- `server/cloud/migrations/` 有 46 个 SQL，存在两个 `014` 前缀；不得重命名已执行迁移。
- 历史压缩包很多；只有建立调用/部署证据、备份和稳定期后才能受控退役。
- 本 V2 文档轮次没有重跑全量测试、构建，也没有连接生产。

---

## 7. 当前云端最新已知记录

以下来自历史交接，**不是 2026-08-29 实时核验**：

| 项目 | 历史最新记录 |
| --- | --- |
| 网站 / API | `https://app.hanzhou.icu` / `https://api.hanzhou.icu` |
| 主机 | `42.193.179.216`，Ubuntu，2 核 4GB，50GB |
| 最新记录 release | `/opt/shein-console/releases/shein-cloud-deploy-20260828-rejected-checkbox-v4` |
| 回滚候选 | `...rejected-checkbox-v3` |
| 发布执行开关 | 历史记录为 `true` |
| 合规写开关 | 历史记录为 `true` |

开关为 `true`、网页 200 或本地状态变更都不能证明 SHEIN 已接收商品。需要判断当前生产时，必须只读核对 current、容器 image/创建时间、版本探针、静态 hash、迁移、队列和最近 trace；未经授权不重启、不清队列、不改开关。

---

## 8. SHEIN API 资料和不可破坏契约

API 总入口：`HANZHOU_POLARIS_API_SOURCE_CATALOG_2026-08-29.md`。

现有资料：

- `docs/V2_SHEIN_API_CAPABILITY_MATRIX.md`
- `docs/SHEIN_INTEGRATION_BLUEPRINT.md`
- `docs/shein-api-raw/`：55 份原始归档文件

旧交接提到但当前缺失的四个文件不得当作现存事实继续引用：

- `docs/SHEIN_API_SOURCE_INDEX.md`
- `docs/SHEIN_API_FIELD_HANDOFF.md`
- `docs/SHEIN_PRODUCT_PUBLISH_CONTRACT.md`
- `docs/CLOUD_DEPLOYMENT_ARCHITECTURE.md`

强制契约：

- 当前官方文档和真实响应优先；动态字段、枚举、额度和权限在实施时重验。
- 保留 `code`、`msg`、`traceId`、平台标识和逐项失败。
- 空、缺行、超时、partial、unknown 不补 0、不猜成功。
- `accepted` 不等于 `effective`；发送后结果未知先回读，禁止盲重试。
- 浏览器不直调 SHEIN，全部经过服务端 Adapter、权限、幂等和审计。
- 官方 API 不支持的动作进入人工 WorkItem，不标记平台完成。

---

## 9. 当前已经确认的关键产品规则

### 9.1 手动刷新

- 用户明确不要每 30 秒自动同步。
- 页面加载、切店、聚焦和普通 GET 不应触发 SHEIN。
- 手动刷新创建或复用唯一 RefreshOperation；存在任务时可有界读取本系统任务状态。
- Webhook 落事件和投影，不偷偷发起全量刷新；Scheduler 默认关闭。

### 9.2 草稿、发布和审核

- 默认草稿箱只显示仍可编辑、尚未完成 handoff 的 Draft。
- handoff 成功后从默认草稿视图移除，但保留 Revision、Attempt、Command 和审计证据。
- 发布失败/驳回需要修改时，从当前版本派生新 Draft/Revision，不篡改旧证据。
- 发布至少区分：命令创建、Worker 领取、开始发送、SHEIN 接收、官方审核、最终生效/驳回。
- 审核中心卡片、页签、计数、行、选择和动作资格必须来自同一一致 Snapshot。
- 选择仅限当前可见 eligible 行；切页签、搜索、刷新和切店必须清理无效选择。

### 9.3 UI 与 AI

- 当前 V2 是目标 UI；修复业务不得整体换皮或替换为旧绿色迁移壳。
- 单页改动必须保存基线并验证非目标页面零变化。
- AI 标题是可选辅助；Provider 失败不阻断普通标题和发布流程。
- AI 请求、Attempt、输入/模型/prompt/schema/policy 版本和候选可追溯，候选由人确认。

### 9.4 地毯品类和合规

- 1630/1631、证书、本体实拍、包装实拍、代理材料和警示语是不同材料角色。
- 报告要求以当前 SHEIN 要求和商品属性规则为准，不用 SKU/包装尺寸硬猜。
- 合规失败、发布失败和官方审核驳回是正交状态，不互相覆盖。

---

## 10. 历史致命问题必须纳入验收

后续无论采用何种实施路线，都必须覆盖以下历史问题：

- 网页伪发布：页面显示提交/发布，SHEIN 后台没有商品。
- Control、发布 Worker、静态前端和数据库版本漂移。
- 审核中心已驳回无法勾选、重复复选框、4 条可见却选中 15 条。
- 重发后旧驳回未移除，待审核/核价/寄样/审版/核样/终审混类。
- 手动刷新先报服务不可用、partial 被压成通用失败。
- 已交接商品仍留在草稿箱，隐藏待发布或隐藏选择污染操作。
- 修复业务却整体改掉前端，或部署了错误静态产物。
- 多套同步 owner、自动轮询、跨店缓存串用。
- AI Provider 故障、合规材料/状态混用、未知库存销量补 0。

这些是历史问题清单，不等于当前全部仍在线上复现；关闭必须有当前证据。

---

## 11. 后续协作方式

### 11.1 如果继续讨论 17 个板块

按板块编号继续，输出当前架构、目标架构、业务流程、数据模型、权限、API、UI、风险、迁移、验收和与其他板块依赖。只更新方案文档，不写代码。

### 11.2 如果要求检查或分析问题

只读取证，区分 UI、API、Control、Worker、队列、数据库、SHEIN 和部署版本；给出根因、证据、影响和解决方案，不实施修复。

### 11.3 如果要求修复

先定义目标、非目标、失败基线、允许文件、成功标准和回归矩阵，再做最小 owner 修改。不得顺手重构、换 UI、删旧代码或修改无关模块。

### 11.4 如果要求部署

部署是独立动作：先通过测试/构建/release audit，生成可校验包和回滚点，再按用户授权上传、切换、重建目标服务并做线上证据核验。

### 11.5 如果决定采用 ERP 路线

先复核并必要时修订 ERP-00～23，使它与 17 个板块、当前源码和生产事实一致；随后才创建第一个正式 Run。不得把历史 Run 写进 ERP 完成状态。

---

## 12. 必读顺序

新对话默认顺序：

1. `HANZHOU_POLARIS_REBUILD_HANDOFF_V2_2026-08-29.md`：身份、状态和协作边界。
2. `COMMERCIAL_ERP_MODULE_ARCHITECTURE_2026-08-28.md`：17 个板块完整目标。
3. `HANZHOU_POLARIS_API_SOURCE_CATALOG_2026-08-29.md`：API 资料与能力边界。
4. `HANZHOU_POLARIS_MASTER_BLUEPRINT_2026-08-29.md`：总览和跨板块关系。
5. 目标接口对应的 `docs/shein-api-raw/` 原文、能力矩阵和接入蓝图。
6. `REBUILD_HANDOFF_MASTER_2026-08-28.md` 与旧交接：仅在需要历史证据时读取。
7. `COMMERCIAL_ERP_MASTER_EXECUTION_PLAN_2026-08-28.md` 与执行台账：仅在用户决定采用/修订/启动未来路线时读取。

旧 `HANZHOU_POLARIS_REBUILD_HANDOFF_2026-08-29.md` 已归档，不再作为入口。

---

## 13. 本次修正的完成边界

本次只做文档身份和状态校正：

- 新增 V2 唯一入口。
- 明确三类资料的关系和状态。
- 取消“新对话自动开始 ERP-00”的错误指令。
- 保留 v1 和全部历史交接，不删除、不改写历史事实。
- 未修改业务代码、数据库、部署脚本、生产配置或 SHEIN 数据。
- 未执行测试、构建、SSH、部署或外部 API 调用。

从现在起，新对话应以本 V2 为入口，以 17 个板块为最新产品目标；ERP-00～ERP-23 只有在用户明确确认后才进入执行。

## 14. 全站诊断日志（2026-08-30，已完成代码实现，尚未部署）

本次新增全站诊断捕获，用于定位图片上传、COS 预览/下载、接口、页面动作和异步执行问题。它不是新的业务状态系统，也不改变任何商品、发布、合规、库存或 COS 数据。

### 14.1 覆盖范围

- V2 路由进入、页面模块识别和查询存在性摘要。
- 所有按钮、链接、`role=button`、提交控件、折叠摘要和显式 `data-diagnostic-action` 控件的点击。
- `input`、`select`、`textarea` 的字段变更，只保存控件类型和安全的字段名，不保存输入值。
- 所有浏览器 `fetch`，包括统一 API、图片预览、COS 直传和外部图片请求；记录方法、脱敏路径/目的地、HTTP 状态、耗时和可读的 `X-Trace-Id`。
- API 业务错误、网络错误、浏览器 `error` 和 `unhandledrejection`。
- Control 服务为每个非诊断写入请求生成/透传 `X-Trace-Id`，并追加服务端请求摘要。

### 14.2 隐藏入口和存储

- 浏览器自动批量写入 `POST /v1/web/diagnostics/events`；该入口要求登录和可信来源，没有网页导航入口。
- 管理员诊断读取入口为 `GET /v1/internal/diagnostics/events?limit=100`；要求登录、管理员角色和当前租户范围。
- 日志复用现有 `api_audit_logs`，本次不新增正式数据库 migration，不改变生产表结构。
- 浏览器内存队列最多保留 100 条，单批最多 20 条；服务端最多接收 50 条，查询最多 100 条，诊断写入失败不会阻断正常业务请求。

### 14.3 安全边界

日志只保留操作类型、模块、动作标签、脱敏路径、状态、耗时、TraceId 和有限摘要；明确丢弃密码、Token、Secret、Authorization/Cookie、请求/响应 body、headers、签名 URL、文件/图片内容和表单输入值。外部 COS/SHEIN URL 只保留目的地类别，不持久化对象路径或查询参数。

### 14.4 当前状态和查看方式

本次已完成代码、回归测试、构建、密钥扫描和静态审计；未执行生产部署、重启、切换、数据库 migration、COS 写入或 SHEIN 请求。上线后由管理员通过受保护的 internal API 查看；在上线前，任何生产页面不应出现诊断日志菜单，也不能把本地测试记录当成生产证据。

## 15. ERP-07 SHEIN 适配器契约硬化（当前隔离基础已开始）

### 15.1 当前 Run

`RUN-20260830-ERP07-ENDPOINT-CONTRACT-01` 仅建立本地机器可读 endpoint 契约目录、请求 allowlist 和失败分类，不代表 ERP-07 整体完成，也不改变 ERP-06 生产 `NO-GO` 结论。

已覆盖当前代码实际使用的商品、规则、预检、媒体、合规、核价和授权路径，共 33 个契约项；每项记录 exact method/path、来源 owner、读写模式、已知限制、重试类别、成功证据和冻结策略。当前 `GET /open-api/goods/product/check-publish-permission` 的方法已按源码证据纠正。

写入默认关闭；凭证字段不得进入 endpoint body；HTTP 2xx + `code=0` 但缺 TraceId 或完整回执时保持 `result_unknown/readback_only`；发送边界后的网络/429/5xx/超时禁止自动重发；`openapi00001` 要求人工新 Attempt 与重新授权；作用域和 TraceId 超长直接拒绝。

本地验证已通过：新回归 `14/14`，相邻回归 `72/72`，全量 `npm test` `1325/1325`；V2 构建、密钥扫描（`findings=[]`）、静态 release audit（`READY`）、干净 revision release manifest（`sourceDirty=false`）、`node --check` 和 `git diff --check` 均通过；已生成只读的本地 staging 候选包。当前仍未完成逐接口官方来源版本、请求/响应 schema、完整 fixtures、authorized-store read evidence、staging canary/readback 和线上接线；未执行生产或现有 staging 的网络、写入、migration、部署、重启或配置切换。
