# 涵舟 Polaris 商业 ERP 升级主交接文档（V2 修正版）

版本：2026-08-30-v51
状态：**当前唯一有效的新对话入口；执行状态以执行台账最新版本为准**
当前执行：用户已批准 COS-first 与 ERP-05 历史映射冻结豁免；ERP-05 已完成范围收口，ERP-06 隔离实现已完成但生产接入前置审查为 `NO-GO/BLOCKED`：生产仍运行旧 release/旧 Worker，未执行 ERP-06 正式 migration，发布开关处于开启状态但没有 ERP-06 Outbox/官方回读闭环。全站诊断日志保持已实现但未部署，按用户要求本轮不继续扩展。ERP-07 已完成 33 项 endpoint 契约目录、版本化 schema 覆盖、失败 fixture、状态 fail-closed、唯一 server adapter、response evidence 完整性、字段级 provenance 回归、只读响应证据脱敏捕获边界、diagnostics 敏感字段、未知 metadata、response evidence 状态一致性、来源引用完整性、证据捕获入口/范围未知字段 fail-closed 修正以及 3 项官方响应来源核验，其中 23 项可执行校验、10 项显式阻断；销售、发布额度、单据状态 3 项 source-pending 接口的字段仍明确标记为内部消费者契约，真实授权店铺只读证据尚未捕获；ERP-07 是当前唯一 `IN_PROGRESS` 步骤，当前 Run 为 `RUN-20260830-ERP07-OFFICIAL-RESPONSE-SOURCES-14`，ERP-08～ERP-23 尚未开始。
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
| C | ERP-00～ERP-23 | 为落实 17 个板块而新编制的分阶段工程治理与实施路线 | **当前路线：ERP-00～ERP-04 已完成，ERP-05 已按用户批准的 COS-first/历史映射冻结豁免完成范围收口，ERP-06 仍处于非生产接入前置阶段，ERP-07 正在进行 endpoint schema/fixture 隔离，ERP-08～ERP-23 尚未开始；前序阻断 Run 保留** | `COMMERCIAL_ERP_MASTER_EXECUTION_PLAN_2026-08-28.md`、执行台账 |

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
- `COMPLETE`：ERP-05（用户已批准 COS-first 与历史映射冻结豁免；历史关系保持只读 legacy，不迁移、不恢复、不删除、不阻断新链路；前序未映射证据继续保留为只读风险记录）。
- `BLOCKED`：ERP-06（隔离 foundation 与发布-回读组合已完成；生产接入前置审查为 `NO-GO`，生产迁移、真实 Worker/SHEIN sender、正式回读接线和部署等待单独批准）。
- `IN_PROGRESS`：ERP-07 整体仍在进行，当前活动开发单元为 `RUN-20260830-ERP07-OFFICIAL-RESPONSE-SOURCES-14`；这是当前唯一 `IN_PROGRESS` 步骤。
- `NOT_STARTED`：ERP-08～ERP-23；不得因 ERP-07 局部 schema 覆盖完成而提前进入后续步骤。
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

## 16. ERP-07 关键接口 schema/fixture 隔离验证（2026-08-30）

### RUN-20260830-ERP07-ENDPOINT-SCHEMA-FIXTURES-02

- 类型：ERP-07 契约基础的第二个本地隔离单元；为首批关键接口补齐版本化 request/response schema、读写模式和失败回归 fixture，不代表 ERP-07 整体完成，也不改变 ERP-06 生产 `NO-GO`。
- 实际文件：[erp07-shein-endpoint-schema.js](../server/cloud/erp07-shein-endpoint-schema.js)、[erp07-shein-endpoint-schema.test.js](../server/cloud/erp07-shein-endpoint-schema.test.js)。本轮没有接入线上路由、Worker、真实传输或生产配置。
- 覆盖范围：商品查询、SPU 详情、SKU 销量、发布权限/额度/商家 SKU 查重预检、商品图片上传、商品发布、单据状态回读、合规实拍图上传/绑定、价格证明上传，共 12 个关键 endpoint。每个 schema 同时记录 `erp07-shein-endpoint-contract-v1` 与 `erp07-shein-endpoint-schemas-v1`、method/path、读写模式、请求字段、响应 envelope、来源文件、官方更新时间（可得时）和 `authorizedStoreRead` 状态。
- 来源诚实性：商品查询、SPU、商品发布、合规实拍图上传/绑定具备对应官方资料与代码回归；销量、预检、单据状态和价格证明等仍明确标为 `source_pending` 或“仅有官方方法/代码证据”，`authorizedStoreRead` 统一保持 `not_observed`，未把本地 fixture 冒充真实店铺证据。
- 失败语义：读接口具有 success/empty/partial/business failure/auth failure/rate limited/timeout；写接口具有 success/business failure/auth failure/rate limited/timeout，并对缺失回执单独保留 `result_unknown`。发送边界后的超时、429 和网络不确定性只允许 `readback_only`，不自动重发；成功必须保留完整回执证据，不能用 HTTP 2xx 或 `code=0` 单独冒充 accepted。
- Fail-closed：严格 schema 拒绝缺失必填字段、未知字段和未知枚举；未知 endpoint 直接拒绝；fixture 只能按 response schema 校验，request 必须传入实际请求对象；schema 验证返回值不包含凭证字段或秘密值。
- 本地验证：ERP-07 契约与 schema 定向回归 `22/22`；相邻 SHEIN/ERP-06 回归 `80/80`；最终全量 `npm test` 已通过 `1333/1333`；V2 构建通过；`ci:toolchain` 通过（Node `24.16.0`、npm `11.13.0`、lockfile `3`）；密钥扫描 `scannedFiles=642` 且 `findings=[]`；静态 release audit 为 `READY`、14/14 release contracts 通过且 live-write flags 关闭；staging isolation audit `14/14` 通过；未执行真实 SHEIN HTTP、生产/现有 staging 数据库/COS/Redis/队列访问、migration、部署、重启或配置切换。
- 当前状态：`COMPLETE / PARTIAL SLICE`。本隔离单元已完成，但 ERP-07 整体仍为 `IN_PROGRESS`；33 个契约项中只有 12 个进入首批 schema/fixture slice，剩余逐 endpoint 官方 request/response 完整证据、限制/分页/单位/状态枚举、authorized-store read evidence、staging canary/readback 和统一 adapter 接线仍是后续门禁。
- 下一执行单元：逐 endpoint 完成官方来源和字段证据，补齐剩余契约项 schema/fixtures，并在不打开生产写入的前提下，把 schema 校验接入唯一 server adapter 的隔离边界；完成前不得评审 ERP-08 或执行生产部署。

## 17. ERP-07 远程构建器状态 fail-closed 加固（2026-08-30）

### RUN-20260830-ERP07-ENDPOINT-SCHEMA-COVERAGE-03 增量修正

- 本地补齐类目树、属性模板、发布字段规范官方必需的 `language` 请求头元数据；库存查询和议价列表虽保留本地 schema 校验，因 `archived_requires_revalidation` 状态仍禁止构建远程请求。
- 通用 endpoint 构建器对 `archived_frozen`/`archived_requires_revalidation` 返回 `ERP07_ENDPOINT_STATUS_BLOCKED`；`credential_write` 返回 `ERP07_ENDPOINT_CREDENTIAL_EXCHANGE_DISABLED`。凭证字段进入 body 的既有拒绝优先级保持不变。
- 实际增量文件：[erp07-shein-endpoint-contract.js](../server/cloud/erp07-shein-endpoint-contract.js)、[erp07-shein-endpoint-contract.test.js](../server/cloud/erp07-shein-endpoint-contract.test.js)、[erp07-shein-endpoint-schema.js](../server/cloud/erp07-shein-endpoint-schema.js)、[erp07-shein-endpoint-schema.test.js](../server/cloud/erp07-shein-endpoint-schema.test.js)。仍未接入生产/现有 staging。
- 验证结果：ERP-07 定向回归 `27/27`；全量 `npm test` `1338/1338`；V2 构建通过；工具链、密钥扫描（`scannedFiles=644, findings=[]`）、静态 release audit（`READY`，14/14）、staging isolation（14/14）和 `git diff --check` 均通过。
- 当前状态：`COMPLETE / PARTIAL SLICE`；33 项契约均有 schema，23 项可执行本地校验，10 项显式阻断。ERP-07 整体仍 `IN_PROGRESS`，ERP-06 生产接入仍 `NO-GO`，ERP-08～ERP-23 未开始。
- 环境边界：未解析或打印真实凭证，未发送 SHEIN HTTP，未访问或写入生产/现有 staging 数据库、COS、Redis、队列，未执行 migration、部署、重启、配置切换或历史回填。

## 18. ERP-07 唯一 SHEIN server adapter 隔离边界（2026-08-30）

### RUN-20260830-ERP07-ADAPTER-BOUNDARY-04

- 类型：ERP-07 第四段本地隔离实现；在不接入线上路由、Worker、生产配置或真实 HTTP 的前提下，建立唯一 `Erp07SheinAdapter` 边界和失败回归。
- 实际文件：[server/cloud/erp07-shein-adapter.js](../server/cloud/erp07-shein-adapter.js)、[server/cloud/erp07-shein-adapter.test.js](../server/cloud/erp07-shein-adapter.test.js)，并更新 [server/cloud/audit-v2-release-readiness.js](../server/cloud/audit-v2-release-readiness.js) 及其回归测试，把 adapter 纳入候选制品必要契约。
- 边界顺序：endpoint allowlist/作用域/敏感 body 先由既有契约构建器校验；再由版本化 request schema 校验；只有显式启用对应 read/write 开关后才解析凭证并调用注入的底层 SHEIN transport；返回结果再次经过 response schema，再统一输出 `read_success`、`accepted`、`known_failed` 或 `result_unknown`。
- 安全语义：read 和 write 默认关闭；业务写入仍保持关闭；凭证只传给底层签名传输，不进入 adapter 结果；不自动重试；写入缺少完整成功证据，或发送后发生超时、网络异常、429、5xx，均为 `result_unknown/readback_only`；响应 schema 不通过时不返回原始响应内容。
- 本地验证：adapter 定向回归 `12/12`；adapter + release readiness 回归 `22/22`；项目全量 `npm test` `1351/1351`；`npm run build:v2` 通过；`ci:toolchain` 通过（Node `24.16.0`、npm `11.13.0`、lockfile `3`）；密钥扫描 `scannedFiles=644, findings=[]`；静态 release audit 为 `READY`，release contracts `15/15`；staging isolation `14/14`；变更 JS `node --check` 与 `git diff --check` 通过。
- 制品状态：工作树尚未形成干净 revision 时，`node server/ci/release-manifest.js --check` 按预期仅报告 `source_dirty`；这不是发布通过证据。提交后必须重新构建并重跑 release manifest 与候选包校验。
- 环境边界：仅使用本地 fake credentials/transport 和 synthetic response fixture；未读取或打印真实密钥，未发送真实 SHEIN HTTP，未访问或写入生产/现有 staging PostgreSQL、COS、Redis、队列，未执行 migration、部署、重启、配置切换、历史回填或自动重发。
- 当前状态：`COMPLETE / ISOLATED ADAPTER BOUNDARY`。本 Run 完成，但 ERP-07 整体仍为 `IN_PROGRESS`，ERP-06 生产接入仍为 `NO-GO`，ERP-08～ERP-23 未开始。
- 未完成门：逐 endpoint 官方来源版本与完整 response 字段映射、真实授权店铺只读 evidence、现有线上业务路径的受控 adapter 接线、预发 canary/readback、完成门审查和单独部署批准仍未完成；本 Run 不得被解释为已上线。

## 19. ERP-07 response evidence 与消费者字段失败边界（2026-08-30）

### RUN-20260830-ERP07-RESPONSE-EVIDENCE-05

- 本地隔离实现已为全量 33 个 endpoint 增加 response evidence 清单完整性门禁；缺少清单、非法状态、空字段、无效来源或 `authorizedStoreRead` 不一致时直接失败。
- 对 SKU 销量、发布权限、发布额度、商家 SKU 查重、单据状态和价格证明上传，已按现有本地消费者与测试证据建立显式 response schema；6 项均保持 `internal_consumer_contract`，并保留 `official_response_fields_not_captured`，不把内部字段推断冒充官方完整响应。
- 明显错误类型已进入失败回归：销量统计对象、布尔字符串、额度对象、重复标记字符串、审核状态对象和数字 `objectKey` 均被拒绝；响应 schema 失败时 adapter 不返回原始响应。
- 变更文件：[erp07-shein-endpoint-schema.js](../server/cloud/erp07-shein-endpoint-schema.js)、[erp07-shein-endpoint-schema.test.js](../server/cloud/erp07-shein-endpoint-schema.test.js)、[erp07-shein-adapter.js](../server/cloud/erp07-shein-adapter.js)。本轮未接入线上路由、Worker、生产配置或真实 SHEIN HTTP。
- 本地验证已完成：定向回归 `41/41`；项目全量 `npm test` `1353/1353`；V2 构建、工具链、密钥扫描（`scannedFiles=646, findings=[]`）、静态 release audit（`READY`，15/15）、staging isolation（14/14）和干净 revision release manifest（`passed=true, sourceDirty=false`）均通过。已生成 staging 候选包，SHA-256：`5b99da9f146a80cb229e1b2b7f85a359aad6ab2dcab5fd6a8d6b09f7045bef94`。
- 当前状态：`COMPLETE / RESPONSE EVIDENCE HARDENED`。本 Run 的代码、回归和制品验证已完成；ERP-07 整体仍为 `IN_PROGRESS`，ERP-06 生产接入仍为 `NO-GO`，ERP-08～ERP-23 未开始。

## 20. ERP-07 字段级 response evidence 来源账本（2026-08-30）

### RUN-20260830-ERP07-FIELD-PROVENANCE-06

- 本地隔离复核为 33 个 endpoint 的每个 response evidence 字段补齐 `field/status/sourceFiles/observed` 记录；字段清单必须一一对应，不能只依赖 endpoint 级摘要。
- 复核确认：SKU 销量、发布权限、发布额度、商家 SKU 查重、单据状态和价格证明上传共 6 项 source-pending 接口，当前仍没有足以支持完整响应字段的官方原文，也没有授权店铺真实只读回执；全部字段保持 `internal_consumer_contract`、`observed=false`，并继续保留 `official_response_fields_not_captured`。
- Fail-closed 规则：字段缺失、重复、顺序或覆盖范围不一致、非法证据状态、来源格式错误、未捕获字段声称已观测、官方字段原文声称为店铺实测，均阻断 evidence catalog；当前 `authorizedStoreRead` 仍为 `not_observed`。
- 实际变更：[erp07-shein-endpoint-schema.js](../server/cloud/erp07-shein-endpoint-schema.js)、[erp07-shein-endpoint-schema.test.js](../server/cloud/erp07-shein-endpoint-schema.test.js)。本轮没有接入线上路由、Worker、生产配置、真实 SHEIN HTTP、生产/现有 staging 数据库、COS、Redis、队列或 migration。
- 定向字段级回归 `15/15`；项目全量 `npm test` `1354/1354`；最终文档 revision 后的构建、工具链、密钥扫描、release audit、staging isolation、release manifest 和只读 staging 候选包均已重新验证通过。
- 制品状态：已生成最终文档 revision 对应的只读 staging 候选包；releaseId、绝对路径和 SHA-256 以本 Run 完成报告为准，未部署。
- 当前状态：`COMPLETE / LOCAL FIELD PROVENANCE HARDENED`。本 Run 的代码、文档、门禁和候选包验证已完成；ERP-07 整体仍为 `IN_PROGRESS`，ERP-06 生产接入仍为 `NO-GO`。
- 未完成门：官方完整 response 字段、真实授权店铺只读 evidence、现有线上业务路径的受控 adapter 接线、预发 canary/readback、ERP-07 完成门和单独部署批准仍未完成。

## 21. ERP-07 授权店铺响应证据脱敏捕获边界（2026-08-30）

### RUN-20260830-ERP07-RESPONSE-EVIDENCE-CAPTURE-07

- 类型：ERP-07 第七段本地隔离实现；建立真实授权店铺只读回执的脱敏捕获候选边界，不触碰生产，也不把人工声明或本地 fixture 当成真实证据。
- 实际文件：[erp07-response-evidence.js](../server/cloud/erp07-response-evidence.js)、[erp07-response-evidence.test.js](../server/cloud/erp07-response-evidence.test.js)。本 Run 未接入网页、现有 SHEIN adapter、Worker、路由、数据库或 COS。
- 只读约束：只允许 read endpoint；输入必须包含授权只读回执编号、完整 tenant/store/supplier scope、观测时间、结构化 payload/diagnostics；只接受 HTTP 200、上游 `code=0`、traceId 存在且通过版本化 response schema 的响应。
- 脱敏输出：只保留 scope、endpoint/contract/schema 版本、HTTP/code/traceId、时间、payload SHA-256 和逐字段存在性/次数/类型；不保留原始 payload、字段值、请求头、请求体、凭证、签名 URL、文件或图片内容；输出内部对象冻结。
- 证据语义：固定输出 `pending_manual_acceptance` 和 `eligibleForCatalogUpgrade=false`，不会修改现有 response evidence catalog；真实授权店铺只读 evidence 仍须人工核验来源后另行批准并更新字段账本。
- 失败回归：写入接口、缺 scope/时间/traceId/code/status、非成功上游响应、schema 不合格、伪造 sourceRef、headers/request/credential/sensitive keys 均 fail closed；空数据不推断零值或完整字段证据。
- 本地验证：证据捕获 `5/5`；ERP-07 相邻定向回归 `32/32`；项目全量 `npm test` `1359/1359`；未执行真实 SHEIN HTTP、真实凭证解析、生产/现有 staging 访问、migration、部署、重启或配置切换。
- 当前状态：`COMPLETE / LOCAL REDACTED CAPTURE ONLY`；ERP-07 整体仍为 `IN_PROGRESS`，ERP-06 生产接入仍为 `NO-GO`，ERP-08～ERP-23 未开始。
- 未完成门：官方完整 response 字段、真实授权店铺只读 evidence、统一 adapter 受控接线、预发 canary/readback、ERP-07 完成门、候选制品重建与单独部署批准仍未完成。

## 22. ERP-07 diagnostics 脱敏输入 fail-closed 修正（2026-08-30）

### RUN-20260830-ERP07-RESPONSE-EVIDENCE-DIAGNOSTICS-08

- 本地失败回归发现：响应证据捕获器原先只对 `payload` 做敏感键递归检查，`diagnostics` 内部的 `authorization`、签名或请求字段虽不会输出到摘要，但仍可能被接受，违反“捕获器不接收敏感输入”的边界。
- 已以最小变更修正：`diagnostics` 结构在读取 `status/code/traceId` 前复用同一递归敏感键检查；正常诊断字段 `status/code/traceId/durationMs` 不受影响，敏感 diagnostics 稳定返回 `ERP07_RESPONSE_EVIDENCE_SENSITIVE_INPUT`。
- 实际文件：[erp07-response-evidence.js](../server/cloud/erp07-response-evidence.js)、[erp07-response-evidence.test.js](../server/cloud/erp07-response-evidence.test.js)。本 Run 未接入线上路由、Worker、数据库、COS 或 SHEIN 网络。
- 当前验证：证据捕获 `6/6`、ERP-07 相邻定向回归 `33/33`、项目全量 `npm test` `1360/1360` 已通过；V2 构建、工具链、密钥扫描（`scannedFiles=648, findings=[]`）、静态 release audit（`READY`、15/15）、staging isolation（14/14）和当前 revision release manifest（`passed=true, sourceDirty=false`）均通过。
- 制品状态：已生成当前文档 revision 对应的只读 staging 候选包；releaseId、绝对路径和 SHA-256 以本 Run 完成报告为准，未部署。
- 状态边界：`pending_manual_acceptance`、`eligibleForCatalogUpgrade=false`、`authorizedStoreRead=not_observed` 和 ERP-07 整体 `IN_PROGRESS` 保持不变；本 Run 标记为 `COMPLETE / LOCAL FAIL-CLOSED CORRECTION`，不授权生产部署，不把本地回归转成真实店铺证据。

## 23. ERP-07 diagnostics 未知 metadata fail-closed 修正（2026-08-30）

### RUN-20260830-ERP07-RESPONSE-EVIDENCE-DIAGNOSTICS-09

- 脱敏响应证据捕获器的 `diagnostics` 现在只接受 `status`、`code`、`traceId`、`durationMs` 四个字段；未知扩展 metadata 在进入摘要边界前直接返回 `ERP07_RESPONSE_EVIDENCE_SENSITIVE_INPUT`。
- 失败回归先证明修复前未知 `diagnostics.message` 会被静默接受，修复后证据捕获 `7/7`、ERP-07 相邻回归 `34/34`；原有敏感 diagnostics、顶层未知字段和非成功响应规则保持不变。
- 只修改本地 `server/cloud/erp07-response-evidence.js` 与对应测试；不接入网页、SHEIN adapter、Worker、数据库、COS、Redis、队列，不执行 migration、部署、重启或配置切换。
- 全量门禁已通过：项目全量 `npm test` `1361/1361`、V2 构建、工具链（Node `24.16.0`、npm `11.13.0`、lockfile `3`）、密钥扫描（`scannedFiles=648, findings=[]`）、静态 release audit（`READY`、15/15）、staging isolation（14/14）和 release manifest（`passed=true, sourceDirty=false`）。
- 已生成与本 Run 最终提交和 release manifest 对齐的只读 staging 候选包；releaseId、绝对路径、大小、权限和 SHA-256 以本 Run 最终完成报告及包内 `release-manifest.json` 为准，未部署。
- 本 Run 状态：`COMPLETE / LOCAL FAIL-CLOSED CORRECTION`；未接入网页、SHEIN adapter、Worker、数据库、COS、Redis、队列，不执行 migration、部署、重启或配置切换。ERP-07 整体仍为 `IN_PROGRESS`，ERP-06 生产接入仍为 `NO-GO`。

## 24. ERP-07 response evidence 状态一致性 fail-closed 修正（2026-08-30）

### RUN-20260830-ERP07-RESPONSE-EVIDENCE-STATUS-CONSISTENCY-10

- 类型：ERP-07 第十段本地证据账本修正；逐项复核 6 个 `source_pending` 接口的归档资料，并修复 endpoint 级 response evidence 状态与字段级状态可能混搭的问题，不触碰生产。
- 资料结论：当前来源目录和归档原文可证明销量接口用途/存在，以及商品页中若干接口的目录、方法或业务字段约束；不能证明 6 项接口的独立完整官方 response 字段契约。`goods-publish-quotas/detail` 在当前原始资料归档中没有独立完整 response 字段原文，价格证明上传也没有独立 `objectKey` 官方响应契约原文。6 项继续保持 `internal_consumer_contract` 和 `official_response_fields_not_captured`，不因本地 schema 或 fixture 升级。
- 失败基线：证据 catalog 原先没有强制 endpoint 状态与 `fieldEvidence[].status` 同态，未来可能出现一个内部 endpoint 混入官方字段或店铺实测字段的账本污染。
- 实际修正：`server/cloud/erp07-shein-endpoint-schema.js` 新增并接入 `assertErp07ResponseEvidenceStatusConsistency()`；`gaps` 清单必须为字符串数组；`official_response_contract` 只能映射 `official_response_field`，其他状态逐字段一致。对应 schema 测试新增混搭拒绝回归。
- 本地验证：schema `16/16`、ERP-07/ERP-06 相邻回归 `45/45`、全量 `npm test` `1362/1362` 已通过；干净提交后的构建、工具链、密钥扫描、发布审计、隔离审计、release manifest 和候选包需重新验证。
- 环境边界：仅使用归档资料和 synthetic fixture；未读取/打印真实凭证，未发送 SHEIN HTTP，未访问或写入生产/现有 staging PostgreSQL、COS、Redis、队列，未执行 migration、部署、重启、配置切换、历史回填或自动重发。
- 当前状态：`COMPLETE / LOCAL FAIL-CLOSED CORRECTION`；ERP-07 整体仍为 `IN_PROGRESS`，ERP-06 生产接入仍为 `NO-GO`，ERP-08～ERP-23 未开始。
- 未完成门：官方完整 response 字段、真实授权店铺只读 evidence、统一 adapter 线上接线、预发 canary/readback、ERP-07 完成门、干净 revision 制品和单独部署批准仍未完成。

## 25. ERP-07 来源引用完整性防回归（2026-08-30）

### RUN-20260830-ERP07-SOURCE-REFERENCE-INTEGRITY-12

- 类型：ERP-07 本地证据账本防回归；将 endpoint 来源文件、response evidence 来源文件及可选行号引用固化为自动门禁，不触碰生产。
- 审计结论：33 个 endpoint 的来源引用均指向仓库内实际文件；4 个带行号/行号范围引用均在有效文件边界内。该检查此前只是一次性审计，现已纳入持续回归，防止文件移动或行号漂移导致证据链接失效。
- 实际变更：[erp07-shein-endpoint-schema.test.js](../server/cloud/erp07-shein-endpoint-schema.test.js) 新增路径边界、文件存在性、文件类型、正行号、行号范围和越界校验；同时检查 `source.files` 与非空 `responseEvidence.sourceFiles`。
- 证据语义：仅证明本地来源引用可读取，不升级官方 response evidence，不生成 `authorizedStoreRead`。6 项 source-pending 接口继续保持 `internal_consumer_contract`、`official_response_fields_not_captured`、`observed=false` 和 `authorizedStoreRead=not_observed`。
- 本地验证：ERP-07 schema 回归 `17/17`；全量 `npm test` `1364/1364`；V2 构建（1953 modules）、工具链（Node `24.16.0`、npm `11.13.0`、lockfile `3`）、密钥扫描（`scannedFiles=649, findings=[]`）、静态 release audit（`READY`，15/15）、staging isolation（14/14）和当前 revision release manifest（`passed=true, sourceDirty=false`）均通过。来源引用检查覆盖 33 个 endpoint、56 条来源引用和 4 个带行号/行号范围引用。
- 制品状态：上述旧提交的只读 staging 候选包已作废；文档提交完成后将重新生成与最终提交一致的只读候选包，最终路径、releaseId、SHA-256、大小和权限以最终完成报告为准，未部署。
- 环境边界：上述验证仅为本地/静态/隔离检查；未执行真实 SHEIN HTTP、真实凭证解析、生产/现有 staging 访问、migration、部署或任何外部写入。
- 当前状态：`COMPLETE / SOURCE REFERENCE INTEGRITY GUARD`；ERP-07 仍为唯一 `IN_PROGRESS`，ERP-06 为 `BLOCKED/NO-GO`，ERP-08～ERP-23 未开始。
- 下一执行单元：继续补齐 6 项 source-pending 接口的官方完整 response 字段/版本与真实授权店铺只读 evidence；在 ERP-07 完成门、预发 canary/readback 和单独批准前，不接入线上 adapter，不执行外部写入。

## 26. ERP-07 证据捕获入口与范围未知字段 fail-closed 修正（2026-08-30）

### RUN-20260830-ERP07-EVIDENCE-INPUT-BOUNDARY-13

- 类型：ERP-07 本地安全边界修正；拒绝证据捕获入口和 `scope` 中未声明的扩展字段，不触碰生产。
- 失败基线：入口参数和 `scope` 的未知字段此前可能被静默忽略，无法证明这些字段经过审计。
- 实际修正：[erp07-response-evidence.js](../server/cloud/erp07-response-evidence.js) 只接受五类入口字段，`scope` 只接受 `tenantId/storeId/supplierId`；未知字段直接 fail closed。输出仍为 `pending_manual_acceptance`，不升级官方 response 或 `authorizedStoreRead`。
- 失败回归：[erp07-response-evidence.test.js](../server/cloud/erp07-response-evidence.test.js) 新增未知入口字段和敏感 `scope` 字段拒绝测试。
- 本地验证：证据捕获/ERP-07 schema 定向回归 `25/25`；全量 `npm test` `1365/1365`；V2 构建（1953 modules）、工具链、密钥扫描（`scannedFiles=649, findings=[]`）、静态 release audit（`READY`，15/15）、staging isolation（14/14）和干净 release manifest 均通过。
- 环境边界：仅使用 synthetic payload/diagnostics；未发送真实 SHEIN HTTP，未访问或写入生产/现有 staging PostgreSQL、COS、Redis、队列，未执行 migration、部署或配置切换。
- 当前状态：`COMPLETE / LOCAL INPUT FAIL-CLOSED CORRECTION`；ERP-07 仍为唯一 `IN_PROGRESS`，ERP-06 为 `BLOCKED/NO-GO`，ERP-08～ERP-23 未开始。
- 下一执行单元：继续补齐 6 项 source-pending 接口的官方完整 response 字段/版本与真实授权店铺只读 evidence；未取得人工核验材料前，不升级证据状态。

## 27. ERP-07 官方响应来源增量核验（2026-08-30）

### RUN-20260830-ERP07-OFFICIAL-RESPONSE-SOURCES-14

- 只核验公开 SHEIN Open API 官方页面，不发送真实请求、不读取授权店铺、不接触凭证、不触碰生产。
- 新增 [ERP07_OFFICIAL_RESPONSE_SOURCE_AUDIT_2026-08-30.md](../docs/ERP07_OFFICIAL_RESPONSE_SOURCE_AUDIT_2026-08-30.md)，保存 3 个接口的官方 URL、页面更新时间和响应字段范围：发布权限、供应商 SKU 查重、价格证明材料上传。
- 这 3 项升级为 `official_response_contract`，补齐上传响应的 `info.url`、`bbl`，并为官方契约强制绑定 HTTPS `open.sheincorp.com` 来源 URL。兼容字段不会被列为官方字段；`authorizedStoreRead` 仍为 `not_observed`，官方字段 `observed=false`。
- 请求/响应侧漂移同步修正：可选 `brandCode` 从 V2/旧路由贯通到权限查询并纳入签名路径；商家 SKU 查重上限与官方单次 200 统一；权限成功响应允许官方示例中的 `info.reason=null`，补充 query schema、响应类型和 200/201 边界回归。
- `sales.sku`、`preflight.publish_quota`、`review.document_state` 仍保留 `internal_consumer_contract` 和 `official_response_fields_not_captured`；新额度路径没有因旧额度接口资料被误放行。
- 对应本地 schema、来源 URL 和字段状态回归已加入；完整测试、构建、工具链、密钥扫描、发布审计、隔离审计、manifest 和候选制品必须以最终提交结果为准。
- 当前状态：本 Run `COMPLETE / OFFICIAL RESPONSE SOURCE RECONCILIATION`；ERP-07 整体仍 `IN_PROGRESS`，ERP-06 仍 `BLOCKED/NO-GO`，ERP-08～ERP-23 尚未开始。剩余真实授权店铺只读 evidence、统一 adapter 受控接线、预发 canary/readback 和单独部署批准未完成。
