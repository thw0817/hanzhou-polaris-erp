> **已停止作为新对话入口。** 本文件是 2026-08-29-v1 归档版，其中把“17 个板块最新产品方案”和“ERP-00～ERP-23 未来实施路线”表达得过于接近，并错误地要求新对话自动从 ERP-00 开始。请改读 [HANZHOU_POLARIS_REBUILD_HANDOFF_V2_2026-08-29.md](./HANZHOU_POLARIS_REBUILD_HANDOFF_V2_2026-08-29.md)。本文件保留仅用于追溯，不再指导后续执行。

# 涵舟 Polaris 商业 ERP 重构主交接文档（v1 归档）

版本：2026-08-29-v1  
方案名称：**涵舟 Polaris（北极星）商业 ERP 重构计划（HANZHOU-POLARIS）**  
工作区：`/Users/tianhanwen/Documents/SHEIN爆单了`  
用途：新对话唯一入口；用于在不丢失历史事实、不重复制造回归的前提下，按新方案升级网站。

> 权限声明：本文记录项目事实、设计决策、风险和建议顺序，不自动授权修改代码、数据库、云端或 SHEIN。每轮以用户当前请求为准；“分析/检查”不等于“修复/部署/调用外部写接口”。

---

## 0. 新对话启动指令

将下面整段作为新对话第一条消息，并附上本文：

```text
你是“涵舟 Polaris（北极星）商业 ERP 重构计划”的项目架构与交付负责人。

先完整阅读：
1. docs/HANZHOU_POLARIS_REBUILD_HANDOFF_2026-08-29.md
2. docs/HANZHOU_POLARIS_MASTER_BLUEPRINT_2026-08-29.md
3. docs/HANZHOU_POLARIS_API_SOURCE_CATALOG_2026-08-29.md
4. docs/COMMERCIAL_ERP_MODULE_ARCHITECTURE_2026-08-28.md
5. docs/COMMERCIAL_ERP_MASTER_EXECUTION_PLAN_2026-08-28.md
6. docs/COMMERCIAL_ERP_EXECUTION_LEDGER_2026-08-28.md

先做只读核验，不要直接修代码、迁移数据库、部署或调用 SHEIN 写接口。当前仓库没有可信 Git HEAD，必须从 ERP-00“变更冻结与真相基线”开始，完成证据和验收后才进入 ERP-01。保持手动刷新，不新增页面加载/切店/聚焦/30 秒自动同步。任何发布成功必须有 SHEIN 接收和官方回读证据，不允许伪发布。任何 UI 修复都不得改变非目标页面或整体前端。

先向我汇报：当前真实基线、文档/源码/生产三者差异、ERP-00 的具体执行清单、只读命令和验收标准；获得我确认后再执行。
```

---

## 1. 项目身份与目标

这是面向 SHEIN 全托管地毯、门垫和家居纺织品运营的内部商业 ERP，目标规模是几十家店铺、十余名成员。它不是演示站，也不是简单的“发品工具”。

核心目标：

1. 真实、可追溯地完成商品建档、发布、平台接收、审核、驳回、重发和生效闭环。
2. 统一多店铺、成员、角色和字段级权限；任何 URL、搜索、导出、任务都不能越权。
3. 将商品、素材、标题、合规、销量库存、备货履约、售后质量、财务价格、增长协同和经营报表纳入同一事实体系。
4. 页面状态清晰、即时、可解释：用户知道发生了什么、为什么、下一步做什么。
5. 任务可恢复、故障可诊断、部署可回滚、历史可对账，避免“修 A 坏 B”。

当前明确非目标：

- 不建设外部 SaaS 计费/租户自助产品。
- 不复制 SHEIN 后台所有能力。
- 不伪造 SHEIN 未开放的指标或动作。
- 不因重构整体换皮或一次性重写前后端。
- 不提前引入超过当前团队和 2 核 4GB 环境必要度的基础设施。

---

## 2. 当前工作区的最高优先级风险

### 2.1 没有可信 Git 基线

2026-08-29 本轮只读核验结果：

```text
git status --short --branch  → ## No commits yet on main
git rev-parse --verify HEAD  → fatal: Needed a single revision
```

几乎全部源码、文档和部署资产都处于未跟踪状态；还有大量历史发布压缩包。由此产生的约束：

- 不得 `git reset --hard`、`git clean`、`git checkout --` 或批量删除。
- 不得把“main”误认为生产对应的已提交分支。
- 不得先重构再补 Git；必须在 ERP-00/01 建立文件清单、秘密扫描、生产 release 对应、备份和首个可信提交。
- 任何自动格式化、依赖升级、目录移动或旧代码删除都要推迟到基线之后。

### 2.2 旧交接完整性保护

历史文件 `docs/REBUILD_HANDOFF_2026-08-03.md` 本轮未修改，SHA-256 保持：

```text
ee4d07408af8d2fe797edc77568d95085927ea31057ddf57dd894b296b5cd3a7
```

它是历史事实，不是新计划入口。

### 2.3 本轮没有核验生产

本交接整理期间：

- 未 SSH 登录服务器；
- 未查询生产数据库、Redis 或队列；
- 未调用 SHEIN；
- 未构建/上传/切换 release；
- 未执行迁移；
- 未修改业务代码。

所以本文所有云端信息均标为“历史最新已知”，新对话必须只读复核后才可作为当前事实。

---

## 3. 当前源码与技术架构

### 3.1 技术栈

- 前端：React 18、TypeScript、Vite、React Router 7、TanStack Query/Table/Virtual、Radix、Tailwind、Lucide。
- 服务端：Node.js ESM，云端 Control API 与多个 Worker。
- 数据：PostgreSQL 16、Redis 7、BullMQ。
- 文件：S3 兼容私有对象存储；短时上传/下载 URL。
- 边缘：Nginx，网站 `app.hanzhou.icu`，API `api.hanzhou.icu`。
- 部署：`deploy/docker-compose.cloud.yml`，release 目录 + `/opt/shein-console/current` 原子切换模式。

### 3.2 规模快照（2026-08-29 本地）

| 项目 | 数量/规模 |
| --- | --- |
| `docs/shein-api-raw/` | 55 个文件 |
| `server/cloud/migrations/` | 46 个 SQL；`014` 前缀重复 |
| `server/**/*.js` | 235 个文件 |
| `server/**/*.test.js` | 131 个文件 |
| `src-v2/**/*.tsx` | 38 个文件 |
| `src-v2` 测试文件 | 27 个 |
| `src-v2/lib/api.ts` | 约 2866 行 |
| `server/cloud/control-server.js` | 约 3111 行 |
| `src-v2/app/AppShell.tsx` | 约 707 行 |

这些数字只是资产规模，不表示测试全部通过；本次文档轮次没有重跑 `npm test` 或构建。

### 3.3 V2 路由入口

入口：`src-v2/app/App.tsx`。

现有页面：

- 登录、注册、邀请、忘记/重置密码。
- 总览、今日工作。
- 商品列表、新建商品、批量建品、草稿箱、商品详情。
- 商品审核中心/发布批次。
- 销量与库存、经营预警、同步任务。
- 合规列表与单 SKC 详情。
- 标题、属性、尺寸、包装、尾图和合规模板。
- 店铺管理、成员管理。

`src-v2/app/AppShell.tsx` 当前同时承担导航、店铺选择、会话和本地店铺记忆；后续应增量拆分为 AppFrame、StoreContext、PermissionContext、GlobalTaskDrawer 等，但不能先重写 UI。

### 3.4 前端源码 owner

| 领域 | 主要路径 |
| --- | --- |
| 应用壳/路由 | `src-v2/app/App.tsx`、`AppShell.tsx`、`query-client.ts` |
| API 契约 | `src-v2/lib/api.ts` 及 `src-v2/lib/*contract*` |
| 总览/今日工作 | `src-v2/features/overview/` |
| 商品经营 | `src-v2/features/operations/` |
| 发布/草稿/编辑器 | `src-v2/features/publishing/` |
| 合规 | `src-v2/features/compliance/` |
| 模板 | `src-v2/features/templates/` |
| 店铺/成员 | `src-v2/features/settings/` |
| 设计与布局 | `src-v2/styles/app.css`、`src-v2/components/` |

### 3.5 服务端源码 owner

| 领域 | 主要路径 |
| --- | --- |
| SHEIN transport/signature | `server/shein-client.js` |
| 商品/合规/上传 Adapter | `server/shein-product.js`、`server/shein-compliance.js`、`server/shein-upload.js` |
| Control/API | `server/cloud/control-server.js` |
| Web 登录与店铺授权 | `server/cloud/web-auth.js`、`web-shein-authorization.js` |
| 经营刷新 | `store-business-service.js`、refresh worker/server |
| 规则刷新 | `rule-snapshot-service.js`、refresh worker/server |
| 发布候选/预检 | `product-publish-candidate.js`、`product-remote-preflight.js` |
| 发布命令/批次 | `publish-batch-service.js`、`publish-execution-repository.js`、protocol |
| 发布执行 | `product-publish-worker.js`、`product-publish-executor.js` |
| 官方回读/状态 | `document-state-projections.js`、`spu-readback-projections.js` |
| 审核中心 | `product-review-service.js`、`review-center-*` |
| 合规 | `compliance-workspace-service.js`、sync/write services/workers |
| 媒体 | `media-service.js`、`media-lifecycle.js`、cleanup worker |
| Webhook | `webhook-ingress.js`、event store/worker/projections |
| AI 标题 | `server/cloud/ai-title-service.js` 与前端 AI contract |
| 迁移与审计 | `server/cloud/migrations/`、`migrate.js`、runtime/release audit |

### 3.6 云端服务拓扑

`deploy/docker-compose.cloud.yml` 当前声明：

- `postgres`：PostgreSQL 16 Alpine。
- `redis`：Redis 7 Alpine。
- `migration`：按 profile 手动执行。
- `runtime-database-audit`：数据库运行角色审计。
- `control`：Web/API/静态入口和命令接收。
- `store-business-refresh-worker`：经营只读刷新。
- `rule-refresh-worker`：类目/属性/发布规则刷新。
- `compliance-sync-worker`：合规只读同步。
- `product-publish-worker`：真实商品发布写入。
- `webhook` / `webhook-worker`：事件入口与处理。
- `media-cleanup`：素材生命周期清理。

目标仍是模块化单体 + 独立 Worker，不是拆成几十个微服务。

### 3.7 数据库迁移风险

当前迁移从 `001_initial.sql` 到 `045_publish_lifecycle_indexes.sql`，总计 46 个文件；同时存在：

- `014_image_provider_settings.sql`
- `014_reusable_media_sources.sql`

新对话首先要只读核对生产 migration ledger、文件 hash 和已执行顺序。不得通过重命名已执行迁移“修复”编号；如需治理，应新增 reconciliation migration/manifest 并保留历史。

---

## 4. 当前云端“最新已知”事实

以下来自 `docs/REBUILD_HANDOFF_MASTER_2026-08-28.md` 的最后记录，不是 2026-08-29 实时核验：

| 项目 | 历史最新记录 |
| --- | --- |
| 网站 | `https://app.hanzhou.icu` |
| API | `https://api.hanzhou.icu` |
| 源站 | `42.193.179.216`，Ubuntu，2 核 4GB，50GB |
| 最新记录 release | `/opt/shein-console/releases/shein-cloud-deploy-20260828-rejected-checkbox-v4` |
| current | 历史记录称已切至上述 v4 |
| 回滚候选 | `...rejected-checkbox-v3` |
| 候选包 SHA-256 | `5612c89fe56b1d1220b0e3c97c2d6f4be42c8fb7ed8b8bf8b9258efde4b811a1` |
| 发布开关 | 历史记录为 `SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED=true` |
| 合规写开关 | 历史记录为 `SHEIN_COMPLIANCE_WRITES_ENABLED=true` |
| 服务范围 | 最后几次仅重建 control，其他 Worker/DB/Redis 多数未重启 |

重要解释：

- 开关为 true 不证明某个商品已被 SHEIN 接收。
- `/health=200` 不证明发布 Worker 与 control 代码一致，也不证明发布成功。
- 生产可能仍是 control 新、Worker 旧或静态产物漂移；必须核对 release path、image ID、容器创建时间、源码/静态 hash 和版本探针。
- 不要在文档轮次直接把开关改回 false/true；真实操作需用户授权和维护窗口。

### 4.1 新对话的只读生产核验项

在用户允许连接服务器后，仅先检查：

1. `/opt/shein-console/current` 实际目标。
2. control、发布 Worker、同步 Worker、Webhook、PostgreSQL、Redis 容器状态、image ID、创建时间和版本环境。
3. 内部 `/health`、`/ready` 与公网健康。
4. `dist-v2/index.html`、`dist-web/index.html` 和入口资源 hash。
5. 生产 migration ledger 与本地 46 个迁移的对应。
6. 队列 counts 和 stale jobs，只读不清理。
7. 关键开关仅显示布尔/是否配置，不回显密钥。
8. 最近错误和 trace，只读不自动重试历史任务。

---

## 5. SHEIN API 文档与接入规则

新入口：`docs/HANZHOU_POLARIS_API_SOURCE_CATALOG_2026-08-29.md`。

辅助资料：

- `docs/V2_SHEIN_API_CAPABILITY_MATRIX.md`
- `docs/SHEIN_INTEGRATION_BLUEPRINT.md`
- `docs/shein-api-raw/`（55 个原始归档文件）

旧交接引用但当前缺失、不得继续引用为事实的文件：

- `docs/SHEIN_API_SOURCE_INDEX.md`
- `docs/SHEIN_API_FIELD_HANDOFF.md`
- `docs/SHEIN_PRODUCT_PUBLISH_CONTRACT.md`
- `docs/CLOUD_DEPLOYMENT_ARCHITECTURE.md`

### 5.1 权威优先级

当前官方文档/店铺真实响应 → 原始归档 → 能力矩阵 → 接入蓝图 → Adapter/测试 → 历史交接。任何动态字段、枚举、限额和权限都要在实施时重新验证。

### 5.2 重点 API 领域

- 鉴权与签名。
- 商品搜索、SPU 详情、SKU 销量、库存。
- 类目、属性模板、发布字段规范和关联规则。
- 发品权限、额度、SKU 查重、图片上传、`publishOrEdit`、单据状态、撤回和上下架。
- 合规要求、实拍图、1630/1631、证书、代理公司和警示语。
- 成本、价格、议价、RRP。
- 库存写入、采购、JIT、发货、退货和财务。
- 审核、价格、额度、采购、退货、合规和授权 Webhook。

### 5.3 不可破坏的契约

- 保留 `code/msg/traceId` 和逐项失败。
- 空/缺行/超时/partial 不补 0。
- `accepted` 不等于 `effective`。
- 发送后超时为 `unknown`，先回读，不盲重试。
- 页面不直调 SHEIN；所有外部调用经服务端 Adapter。
- 真实业务写默认冻结，逐动作 capability、一次性授权和金丝雀。
- API 不支持的动作转为可审计人工任务，不标记平台完成。

---

## 6. 已确认的产品与架构决策

### 6.1 手动刷新

用户明确不需要每 30 秒自动同步。目标规则：

- 页面加载、切店、聚焦和普通 GET 不调用 SHEIN。
- 用户点击“手动刷新”创建/复用唯一 RefreshOperation。
- 有任务时可以有界读取本系统任务状态；没有任务不轮询。
- Webhook 只落事件并标脏，不偷偷全量刷新。
- Scheduler 默认关闭；未来若要开启必须新 ADR、QPS/容量证据和用户批准。

### 6.2 草稿箱

- 默认草稿箱只显示仍可编辑、尚未完成 handoff 的 mutable Draft。
- 提交发布后从默认草稿视图移除，但底层 Draft/Revision/Attempt/审计不物理删除。
- 发布明确失败或驳回时进入“需处理/已驳回”，需要修改则从当前 Revision 派生新 Draft/Revision。
- 历史 33 个或其他已提交仍留在草稿箱的记录只在 ERP-20 做受控修复，先报告再改数据。

### 6.3 发布成功

“网页已提交”至少分层：

- 命令已创建；
- Worker 已领取；
- 已开始发送；
- SHEIN 已接收（有回执）；
- 官方回读为审核中/对应阶段；
- 最终生效或驳回。

页面不得把前四步混成“发布成功”。

### 6.4 审核中心

- 卡片、页签、列表、总计、选择和操作资格来自同一 `ReviewCenterSnapshot`。
- 待审核、核价、寄样、审版、核样、终审、需处理、已驳回按官方 code + 版本化 reducer 分类。
- 未知状态显示待同步/未知，不猜到待审核。
- 选择集合仅限当前 Snapshot 的可见 eligible 行；切页签、搜索、刷新和切店时清理无效选择。
- “4 条可见但发布已选 15”属于禁止回归。
- 重发创建新 Attempt；旧驳回证据保留，当前列表在命令可靠创建后切换新 Snapshot，不伪装平台接收。

### 6.5 UI 稳定性

- 当前 V2 是唯一目标 UI；不得部署早期绿色“全托管运营助手”占位/迁移壳替换商业界面。
- 修复单个页面不得改整体导航、色彩、布局和非目标页面。
- 每个 UI 改动先保存基线截图/DOM/交互，再做局部实现和非目标回归。
- 1280px 可用，表格列/选择/操作不重复，大列表按证据虚拟化。

### 6.6 AI 标题

- AI 是可选辅助；普通标题/A0 不依赖 Provider、Redis 或 AI Worker。
- A2 图片复用、A3 有界并发的历史记录不能代替生产核验。
- 请求、Attempt、输入快照、模型/prompt/schema/policy 版本和候选持久化。
- Provider 失败不缓存、不阻断普通工作流；AI 不自动覆盖用户标题。

### 6.7 地毯品类与合规

- 1630/1631、证书、实拍本体图、包装图、代理材料和警示语是不同材料角色。
- 是否需要报告由当前 SHEIN 要求/属性规则决定，不凭本地固定尺寸永远猜测。
- API 不支持的 GCC/产品标识等动作只能进入人工任务。
- 合规失败不能回写成“商品发布失败/已驳回”；发布、审核和合规案件状态正交。

---

## 7. 历史问题与当前处理方式

以下是历史用户截图、日志和旧交接确认过的问题类型；新对话不能假设都已修复，也不能看到旧部署记录就宣称当前正常。

| 问题 | 根治阶段 | 禁止做法 |
| --- | --- | --- |
| 网页显示发布、SHEIN 无商品 | ERP-04/09/10/11/13/22 | 只改成功文案 |
| control 与发布 Worker 版本漂移 | ERP-08/09/18 | 只重建 control |
| 审核中心复选框不能选/重复 | ERP-11/13 | 继续叠禁用条件或重复 selection column |
| 4 条可见却显示选中 15 | ERP-11/13 | 保留隐藏 selected IDs |
| 重发后未从已驳回动态移除 | ERP-10/11/13 | 假 optimistic success |
| 待审核/核价/寄样/终审错分 | ERP-04/10/11 | 用中文字符串猜状态 |
| 手动刷新先报“服务不可用” | ERP-10/13/18 | 把 partial 变通用 500 |
| 已提交仍留草稿箱 | ERP-12/20 | 物理删除历史审计 |
| 修一个功能整体前端变样 | ERP-00/02/03/13 | 大范围换皮/未知 dist |
| 多套同步 owner | ERP-08/10/17/18 | 新增页面轮询或 Scheduler |
| AI Provider 失败 | ERP-15/18 | AI 阻断普通流程 |
| 合规材料/状态混用 | ERP-04/06/07/16 | 万能 compliance 状态 |
| 未知库存/销量补 0 | ERP-06/07/17/21 | `value || 0` |
| 跨店数据/选择/模板串用 | ERP-03/06/11/13/17/21 | 仅前端过滤 |
| 报表/利润伪精确 | ERP-13/17/21 | 页面临时计算或缺数据补 0 |

完整 Issue/Risk/ADR 在 `docs/COMMERCIAL_ERP_EXECUTION_LEDGER_2026-08-28.md`。

---

## 8. 新方案：17 个业务板块

总蓝图：`docs/HANZHOU_POLARIS_MASTER_BLUEPRINT_2026-08-29.md`。详细设计：`docs/COMMERCIAL_ERP_MODULE_ARCHITECTURE_2026-08-28.md`（版本 2026-08-29-v17）。

1. 账号、成员、角色与店铺权限。
2. 店铺接入、SHEIN 授权、生命周期、多店群与切店。
3. 商品主数据、SPU/SKC/SKU、草稿版本与生命周期。
4. 商品建档、批量建品、编辑器、类目属性与模板。
5. 发布命令、批次、队列、Worker 与回执。
6. 官方回读、Webhook、状态投影与审核中心。
7. 素材资产、图片、上传、用途映射与对象存储。
8. 标题规则、AI 标题、视觉识别与批量调度。
9. 商品合规、证书、1630/1631、实拍和阻断。
10. 销量、库存、在途、备货、预警与经营分析。
11. 采购、备货、仓库、发运物流与履约。
12. 退货、报废、质量、索赔、处罚与对账。
13. 财务、成本、利润、结算、发票、资金与多币种。
14. 价格生命周期、核价/议价、RRP、活动价与利润保护。
15. 活动、推广、选品测款、分层与增长。
16. 团队任务、审批、通知、SLA 与协同。
17. 数据分析、报表中心、指标治理与管理驾驶舱。

第 17 板块是本轮完整性审计新增内容，包含 BI-01～BI-20、BUG-BI-001～016、RISK-122～129 和 ADR-309～328。它只消费规范事实，不建设第二套业务数据库，不自动刷新 SHEIN，不从报表直接执行外部写。

---

## 9. 严格实施顺序：ERP-00～ERP-23

详细计划：`docs/COMMERCIAL_ERP_MASTER_EXECUTION_PLAN_2026-08-28.md`（版本 2026-08-29-v17）。

### 第一波：接管与止血

- ERP-00 变更冻结与真相基线。
- ERP-01 源码资产救援与版本控制。
- ERP-02 单一 V2 前端产物恢复。
- ERP-03 CI、预发与发布门禁。

### 第二波：核心领域地基

- ERP-04 商品生命周期与状态字典。
- ERP-05 历史数据证据盘点。
- ERP-06 规范数据模型与事件账本。
- ERP-07 SHEIN Adapter 契约硬化。
- ERP-08 Control/Worker/release 一致性。

### 第三波：发布与审核闭环

- ERP-09 可靠发布命令。
- ERP-10 官方回读与状态投影。
- ERP-11 审核中心统一 Snapshot API。
- ERP-12 草稿到发布批次交接。
- ERP-13 发布/审核中心商业前端。
- ERP-14 编辑器与预检。

### 第四波：品类和商业能力

- ERP-15 媒体、模板、AI 标题。
- ERP-16 合规和地毯品类。
- ERP-17 多店、权限、经营、履约、售后、财务、价格、增长、协同和报表。

### 第五波：商业上线

- ERP-18 可观测性和诊断台。
- ERP-19 性能、安全、备份和演练。
- ERP-20 历史数据受控修复。
- ERP-21 Staging 全链路验收。
- ERP-22 生产金丝雀和商业发布。
- ERP-23 稳定期和遗留退役。

不能因为某个截图急迫就跳过前序阶段直接“大修”。可做局部止血，但必须记录为 ERP-00 的紧急例外，有明确非目标和回滚。

---

## 10. ERP-00 新对话首轮具体清单

### 10.1 只读资产基线

1. 记录当前时间、主机、工作区、分支状态和所有未跟踪/修改文件。
2. 输出源码、文档、迁移、部署脚本、历史包清单及 hash；不打包秘密。
3. 找出 `.env`、凭证、私钥、数据目录，仅报告路径/是否存在，不回显内容。
4. 识别 V2、legacy、dist-v2、dist-web、dist-web 旧产物和实际 build 输入。
5. 记录 package lock、Node/npm 版本和依赖树风险。

### 10.2 代码/行为基线

1. 当前全量测试、失败清单和耗时。
2. `npm run build:v2` 与 release audit。
3. V2 路由、Control 路由、Worker、队列、迁移和环境开关清单。
4. 核心页面桌面/1280/窄屏截图、DOM 关键计数和交互录像/步骤。
5. 伪发布、选择、草稿、状态分类、刷新等历史事故的失败 fixture/测试现状。

### 10.3 生产只读基线

获得用户连接授权后执行第 4.1 节核验，生成“本地—候选—生产—SHEIN”差异表。禁止顺手重启、清队列、改开关或修数据。

### 10.4 ERP-00 验收

- 有可重复的基线报告和文件 hash。
- 有秘密排除清单，不暴露秘密。
- 有生产 release/容器/静态/迁移对应证据。
- 有当前真实问题清单，按 UI/API/control/worker/DB/SHEIN 分层。
- 用户确认基线后，台账将 ERP-00 标记 `COMPLETE`，方可进入 ERP-01。

---

## 11. 工程与回归护栏

1. 先证据、后根因、再最小修复；不能凭截图直接猜。
2. 每次只允许一个明确 owner 层发生业务变化。
3. 目标/非目标写在改动前；非目标页面和领域默认零变化。
4. 新抽象至少有两个真实消费者，否则先保持局部。
5. 不在同一轮同时做功能修复、全站 UI、依赖升级、数据迁移和部署架构调整。
6. 不修改已执行旧迁移；新增迁移需 preflight、备份、验证和可恢复策略。
7. 查询 key、Repository、API 和队列消息均包含 tenant/store 范围。
8. 浏览器状态不是业务事实；持久任务不保存在 `Map`、组件 state 或 localStorage。
9. 状态机 reducer 单一 owner；UI 只显示规范状态和资格。
10. 旧代码/表/数据/部署包只有在调用证据为零、备份完成、稳定期结束后才可退役。

---

## 12. 测试与发布门禁

基线命令（首次运行前仍需检查脚本，不应调用外部业务写）：

```bash
npm test
npm run build:v2
npm run release:audit:v2
git diff --check
```

每个功能的验收层：

1. 纯函数/状态机/契约单测。
2. Repository 事务、幂等和 store scope 测试。
3. Worker 发送前/后超时、重启、重复消息、部分失败测试。
4. API 权限、错误码、trace 和 Snapshot 一致性测试。
5. 组件/浏览器测试：加载、空、缓存、手动刷新、partial、失败、权限、切店和恢复。
6. 非目标页面视觉/交互回归。
7. Staging 大数据量、断线、429、Redis/Worker/DB 故障注入。
8. 生产单店单对象金丝雀与 SHEIN 官方回读。

发布包必须排除：`.env`、秘密、`.data`、`.git`、`node_modules`、历史压缩包和本地缓存。部署只原子切 current，保留上一 release；只重建目标 owner 相关服务，不无故重启 PostgreSQL/Redis/其他 Worker。

---

## 13. 安全、权限与数据治理

- 浏览器只持有 HttpOnly 会话和短时文件票据。
- 服务端按 `tenantId + membership + storeId + capability + object scope + field policy` 授权。
- 列表、搜索、详情、任务、导出、订阅和 WebSocket/轮询状态都必须重复校验权限。
- 跨店聚合必须声明 storeSet、coverage、cutoff 和可比性。
- 成本、利润、证书、PII、凭证和对象存储材料属于敏感字段/资产。
- 审计记录 actor、目标、前后摘要、原因、授权、trace 和结果，但不保存明文秘密。
- 数据删除遵守保留策略、引用检查、legal hold 和可恢复窗口；不要以“清旧数据”删除业务证据。

---

## 14. 文档体系与读取顺序

### A. 新方案主入口

1. 本文件。
2. `docs/HANZHOU_POLARIS_MASTER_BLUEPRINT_2026-08-29.md`。
3. `docs/HANZHOU_POLARIS_API_SOURCE_CATALOG_2026-08-29.md`。

### B. 完整治理方案

4. `docs/COMMERCIAL_ERP_MODULE_ARCHITECTURE_2026-08-28.md`（17 个板块）。
5. `docs/COMMERCIAL_ERP_MASTER_EXECUTION_PLAN_2026-08-28.md`（24 个阶段）。
6. `docs/COMMERCIAL_ERP_EXECUTION_LEDGER_2026-08-28.md`（Issue/Risk/ADR/Run）。

### C. API、权限和页面

7. `docs/V2_SHEIN_API_CAPABILITY_MATRIX.md`。
8. `docs/SHEIN_INTEGRATION_BLUEPRINT.md`。
9. `docs/V2_DATA_PERMISSION_MODEL.md`。
10. `docs/V2_PAGE_MAP.md`。
11. 目标接口对应的 `docs/shein-api-raw/` 原文。

### D. 部署与历史

12. `deploy/README.md`、`deploy/docker-compose.cloud.yml`、`deploy/v2-release-readiness.md`。
13. `ENGINEERING_RULES.md`、`README.md`。
14. `docs/REBUILD_HANDOFF_MASTER_2026-08-28.md`（最新历史执行记录，但不是新方案入口）。
15. `docs/REBUILD_HANDOFF_2026-08-24_CONTINUE.md`、`REBUILD_HANDOFF_2026-08-12_CONTINUE.md`、`REBUILD_HANDOFF_2026-08-03.md`（历史追溯）。

### E. 历史方案资料

HEF/HST/HWF、NEXUS-EVO、SRF、OSS audit 等文档用于追踪既有实现和事故，不应与 Polaris 并列成为新总架构。

---

## 15. 交接后的第一份输出模板

新对话在完成只读检查后，应先输出：

```text
Polaris 当前阶段：ERP-00 / 未完成

一、已验证事实
- 本地源码基线：
- 测试/构建基线：
- 生产 release/服务基线：
- SHEIN/API 能力基线：

二、差异与风险
- 本地 vs Git：
- 本地 vs 生产：
- 文档 vs 代码：
- 页面 vs API/DB/SHEIN：

三、本轮建议
- 目标：
- 非目标：
- 只读动作：
- 需要用户授权的动作：
- 验收与回滚：

四、台账更新
- Issue：
- Risk：
- ADR：
- Run：
```

不要以“我已经掌握了”结束；必须给出可核验的阶段、证据和下一步。

---

## 16. 方案完成定义

整个项目完成需同时满足：

- 代码有可信 Git 历史、CI、Staging、可重复构建和可回滚 release。
- 生产代码、Worker、迁移、静态产物和文档版本一致。
- 发布不再伪成功，发送后 unknown 可恢复，官方回读闭环。
- 草稿、Revision、Attempt、Document、审核、合规和工作项身份清晰。
- 审核中心所有计数、页签、选择和列表一致；无隐藏选择。
- 手动刷新顺畅、部分失败可解释、无无意义自动同步。
- 多成员多店铺不越权、不串店，所有敏感导出/文件受控。
- 地毯品类合规、素材、标题、备货、履约、售后、价格和利润有可执行工作流。
- 报表只展示有来源、口径、时间和质量的指标，所有管理决定可下钻和复现。
- 2 核 4GB 环境经过容量与故障演练，或以证据决定扩容。
- 遗留代码/数据只在稳定期后受控退役，不再通过不断叠补丁维持系统。

本文创建完成后，后续项目升级以 `HANZHOU-POLARIS` 为唯一总方案名称。
