# 涵舟 Polaris 商业 ERP 升级主交接文档（V2 修正版）

版本：2026-08-29-v8
状态：**当前唯一有效的新对话入口；执行状态以执行台账最新版本为准**
当前执行：ERP-05 官方回读不匹配交叉关联 Run 进行中，前序完成门阻断；ERP-06～ERP-23 不得开始。
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
| C | ERP-00～ERP-23 | 为落实 17 个板块而新编制的分阶段工程治理与实施路线 | **当前路线：ERP-00～ERP-04 已完成，ERP-05 当前 Run 已完成允许范围内检查但完成门阻断，ERP-06～ERP-23 尚未开始；前序阻断 Run 保留** | `COMMERCIAL_ERP_MASTER_EXECUTION_PLAN_2026-08-28.md`、执行台账 |

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

ERP-00～ERP-23 不是历史已执行步骤；当前已由用户明确启动并完成 ERP-00～ERP-04，ERP-05 的原始只读历史证据审计和前两轮生产补证均因逐条证据缺口阻断，当前对象与回读结构补证 Run 已完成允许范围内检查但仍因完整对象证据、SHEIN 官方回读和新模型逐条映射缺失而阻断。后续步骤仍只有在前一步完成且用户明确要求后，才读取执行计划和台账并创建 Run。

先只读理解并向我汇报：
- 17 个板块的整体目标和相互依赖；
- 当前我指定板块的现状、问题、目标方案和待确认事项；
- 哪些是历史事实，哪些是当前已验证事实，哪些只是未来设计。

未经我明确要求，不要修代码、改数据、部署、重启服务、切换开关或调用 SHEIN 写接口；也不要擅自开始 ERP-00。
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
- `BLOCKED`：ERP-05（对象与回读结构补证 Run 已完成允许范围内检查；完整对象证据、官方回读和新模型逐条映射仍缺失；前序阻断记录保留）。
- `NOT_STARTED`：ERP-06～ERP-23。
- 当前正式 ERP Run：`RUN-20260829-ERP05-ROW-LEVEL-EVIDENCE-03`；前两次 Run `RUN-20260829-ERP05-HISTORICAL-EVIDENCE-01`、`RUN-20260829-ERP05-PRODUCTION-READONLY-AUDIT-02` 作为阻断历史保留。

使用规则：

1. 用户先选择继续讨论、调整方案、做只读核验，或正式采用实施路线。
2. 只有用户明确说“开始 ERP-XX”或明确批准按该路线实施，才创建对应 Run。
3. 启动前要重新核对当前源码、生产和历史已修复内容，避免把已经解决的问题重复重做。
4. 若路线与 17 个板块目标冲突，先修订路线；若路线与用户当前需求冲突，以用户当前需求为准。
5. 紧急修复可独立进行，但必须定义目标、非目标、失败证据、回归范围和部署授权；不能伪称某个 ERP 步骤因此完成。

---

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
