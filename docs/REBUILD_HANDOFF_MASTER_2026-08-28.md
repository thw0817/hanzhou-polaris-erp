# SHEIN 超级运营中心｜总交接记录

版本：`REBUILD_HANDOFF_MASTER_2026-08-28`
用途：供下一次新对话继续开发、排查、测试和云端部署。
本文件只记录事实、边界、代码入口、已部署版本和未完成事项；不包含任何密码、私钥、Cookie、SHEIN secretKey、SMTP/Resend 密钥、数据库密码或完整签名。

> 重要：本文件是新对话入口，不替代 API 原文。凡是字段、枚举、请求体、返回体、限流、Webhook 语义发生疑问，必须回到 `docs/shein-api-raw/` 原始文件和当前真实店铺回读核对，不能凭记忆补字段。

---

## 0. 新对话启动指令

新对话第一句话建议直接复制：

> 请先完整阅读 `docs/REBUILD_HANDOFF_MASTER_2026-08-28.md`，再按其中的“当前 P0/P1 问题”和“启动检查清单”工作。先只读检查工作树、线上健康状态、当前 release、control 与各 Worker 镜像/代码版本；不要 reset/clean，不要读取或展示密钥，不要调用 SHEIN 写接口。先为本轮问题补失败回归测试，再做最小范围修复，运行全量测试、V2 构建和 release audit，最后只有在我明确要求部署时才原子切换云端并完成线上核验。

新对话必须先确认：

1. 当前工作树是否有未提交或用户已有改动；所有改动均属于用户，不能清理。
2. `https://api.hanzhou.icu/health`、`https://app.hanzhou.icu/` 是否可用。
3. `/opt/shein-console/current` 当前实际 release，不要直接相信旧交接里的 release 名称。
4. control、PostgreSQL、Redis、经营同步、规则同步、合规同步、商品发布、Webhook、媒体清理容器是否健康，以及 Worker 镜像是否落后于本地代码。
5. 数据库中的 `publish_jobs`、`publish_batch_items`、`publish_batches`、`publish_execution_runs` 是否一致；不能只看网页提示。

---

## 1. 项目身份、环境和安全边界

### 1.1 本地与线上入口

| 项目 | 值 |
| --- | --- |
| 本地项目 | `/Users/tianhanwen/Documents/SHEIN爆单了` |
| 网站 | `https://app.hanzhou.icu` |
| API | `https://api.hanzhou.icu` |
| 云端主机 | 现有受控 SSH 主机（公网地址/账号以部署环境为准，不在本文件保存凭据） |
| 云端目录 | `/opt/shein-console/current`、`/opt/shein-console/releases/`、`/opt/shein-console/shared/.env` |
| 控制服务内端口 | `127.0.0.1:8790` |
| Webhook 内端口 | `127.0.0.1:8791` |
| 默认运行模式 | 本地 `local`；云端 `cloud` |

### 1.2 绝对禁止

- 不把 SHEIN `APP_SECRET`、店铺 `secretKey`、O1Key、SMTP 授权码、Resend key、数据库密码、SSH 私钥写入代码、日志、交接文档或聊天。
- 不执行 `git reset --hard`、`git checkout --`、递归删除或清理用户文件。
- 不为了验收调用 SHEIN 商品发布、商品编辑、合规写入或真实批量写接口；真实发布必须由用户明确授权并遵循一次性确认、幂等和回读流程。
- 不消费一次性发布授权，不重复提交“结果未知”的发布任务。
- 不用本地推算覆盖 SHEIN 返回的库存、销量、审核、合规或上架状态。
- 不把网络超时、限流、IP 白名单、额度不足、保证金限制伪装成“已发布”“已通过”或“店铺失效”。
- 不把类目 ID（例如 `3155`）当作类目名称；无法得到路径时显示“未分类”。
- 不把包装实拍图和商品本体实拍图混用，不把 1630/1631 报告混入实拍图字段。

### 1.3 工程规则与强制技能

- `ENGINEERING_RULES.md`：范围最小化、先写失败回归、冻结稳定区、错误真实、测试/构建/发布门禁。
- `shein-rebuild-guardrails`：SHEIN 集成、缓存、云端路由和同步任务修复必须先明确 bug/layer/owner/allowed files/regression/success criteria。
- `karpathy-guidelines`：手术式修改，避免无关重构和把猜测当事实。
- `frontend-app-builder`：仅在明确的 UI 重构范围使用；当前 UI 采用其设计约束，但不重新引入另一套运行时框架。
- `sites:sites-building`、`sites:sites-hosting`：项目含 `.openai/hosting.json` 时，涉及网站构建/部署需遵循；部署前后必须执行安全发布和健康检查。

---

## 2. 当前真实云端诊断（最新已知事实）

上次只读核查时间：2026-08-28 本地时间（云端容器日志时间约为 2026-08-27 UTC）。以下事实优先于旧交接中的“已部署”摘要；下一次必须重新探测，因为容器和数据库状态会变化。

### 2.1 健康状态

- `https://api.hanzhou.icu/health` 返回 HTTP 200：`{"ok":true,"service":"shein-cloud-control"}`。
- `https://app.hanzhou.icu/` 返回 HTTP 200。
- Docker Compose 中 control、PostgreSQL、Redis、经营同步、规则刷新、合规同步、商品发布、Webhook、媒体清理容器上次均为运行/健康状态。
- Redis 队列上次检查：`LLEN wait=0`、`ZCARD active=0`、`ZCARD delayed=0`；没有证据表明队列本身卡死。

### 2.2 关键发布事故：网页发布不等于 SHEIN 已接收

用户反馈“网页发布十多个 SKC，但 SHEIN 后台没有”。数据库和 Worker 只读核查得到：

| 项目 | 事实 |
| --- | --- |
| 涵舟-家居2店 | 最新相关批次 10 个商品，`publish_jobs` 全部 `failed_terminal`，`submitted_at`/`shein_version`/`shein_document_sn` 均为空 |
| 涵舟-家居3店 | 最新相关批次 15 个商品，`publish_jobs` 全部 `failed_terminal`，同样没有 SHEIN 接收凭证 |
| SHEIN 错误码 | `20100` |
| 家居2店错误 | `剩余可发品额度为0，禁止发品` |
| 家居3店错误 | `您的店铺存在未完成的保证金缴纳任务，已被限制发布商品，请前往“我的资金管理”页面尽快处理。` |
| 队列状态 | 已取空，不是 Redis 等待队列堆积 |
| 真实结论 | 这些商品没有成功提交到 SHEIN；页面“没有商品”是平台限制/额度导致，不应归因于 SHEIN 审核延迟 |

### 2.3 已确认的部署漂移/投影缺口

- 云端 `deploy-product-publish-worker-1` 镜像创建/启动时间明显早于 control；Worker 仍运行旧版 `recordExecutionFailure`。
- 旧 Worker 只更新了 `publish_jobs`，没有执行当前本地代码中的事务性批次投影更新（同步更新 `publish_batch_items` 与 `publish_batches`）。
- 因此生产数据库出现：`publish_jobs.state=failed_terminal`，但对应 `publish_batch_items.state=ready`、`last_error` 为空；网页可能继续显示“待提交/已提交待审核”，这是严重的事实投影不一致。
- 当前本地 `server/cloud/publish-execution-repository.js` 已包含“批次投影与任务失败同事务对齐”的代码，但尚未证明云端 Worker 已包含它。
- `publish_execution_runs` 中存在旧的 `running` 且 `completed_at` 为空记录，需要下一轮做只读核对和安全自愈；不能直接删除历史记录。
- `src-v2/features/publishing/PublishBatchesPage.tsx` 的 `statusLabel` 必须把 `failed_terminal/failed_retryable` 优先于 workflowStage，避免 workflowStage 遮盖真实发布失败。当前源码虽然已有失败判断，但生产 stale projection 仍可能使 UI 先落到 `item.state=ready`。

### 2.4 当前必须列为 P0 的 UI 回归

用户多次截图仍显示商品审核中心表头和每行左侧出现两个相邻勾选框。虽然部分本地契约曾通过、旧版本记录写过“已修复”，但线上截图说明实际页面仍存在回归或部署漂移。下一轮必须：

1. 在 DOM/组件树中确认唯一 selection column 的来源；区分表头全选与行选择，禁止重复渲染。
2. 只保留一个表头全选框和一个每行选择框；不要用两个不同组件叠加。
3. 先写浏览器/源码契约测试，再改 `PublishBatchesPage.tsx`、`OperationsDataTable.tsx` 或实际 owner 文件。
4. 覆盖已驳回单个勾选、全选、跨店切换、批量重新发起，确认选择状态不串店。

---

## 3. 产品目标与用户已确认的业务规则

这是面向几十家 SHEIN 店铺、十余名用户的多人商业运营中台，不是演示站。核心目标是：真实 API 数据、严格店铺/用户隔离、可追踪的发布/审核/合规工作流、低请求压力、可回滚部署和可解释错误。

### 3.1 数据和权限

- 作用域层级：`tenant/workspace → user → store → SPU/SKC/SKU`。
- 普通成员只能访问管理员分配的店铺；viewer 只读；operator 可执行被授权的业务动作；owner/admin 可管理租户、成员、店铺和全站模板。
- 管理员可看到管理范围内店铺；管理员设置的店铺别名只影响管理员视图，成员仍看到自己的店铺名。
- 管理员可设置用户账户别名，该别名只对管理员可见，不改变用户登录身份。
- 所有 API、Repository、Query key 都必须同时包含租户/用户/店铺作用域；修改 URL 中的 `storeId` 不能越权。
- 共享模板可以跨授权店铺读取，但来源媒体必须按模板来源店铺验证；不能借模板 ID 读取其他店铺任意素材。

### 3.2 商品与模板

- 商品草稿、批量建品、新建商品共用同一套契约和编辑器语义。
- 模板引用必须是“替换”而不是叠加：标题、尺寸颜色、打包体积、图片用途、合规模板分别替换对应字段；允许单属性重新引用。
- 管理员创建的普通模板为租户共享；成员可读取但不能修改原模板，可复制成自己的模板。
- 模板使用前重新校验当前 SHEIN 类目/属性/发布规范；字段、枚举或报告类型变化要转人工确认。
- 商品标题：内部草稿名称上限 160；SHEIN 商品标题上限来自 `default_language_title_max_length` 等动态官方规范（当前常见地毯类目曾回读 250，但不能全平台写死）。
- 数量属性按实际件数输入，不再按百分比；官方自定义属性值（如“多色”）允许按 SHEIN 官方值或授权自定义值录入，不能擅自造枚举。
- 主图、通用图、SKU 预览图支持多图上传、删除、拖拽排序、放大查看；包装实拍图和本体实拍图分开，多张上传走官方字段。
- 满屏水印、生图模块已按用户要求移除/收敛；不要重新启用旧生图入口。

### 3.3 合规

- 合规只展示 SHEIN 对当前商品实际必填的字段；非必填字段不挤进单品工作区。
- 1630/1631 必须等 SHEIN 官方返回判断，平台未回读显示“官方判断中/等待 SHEIN 返回”，不由本地规则猜测。
- 官方返回 1630 或 1631 后，单个/批量上传对应报告并记录生效日期；1630 与 1631 混合选择必须分组处理。
- 合规资料可保存草稿、批量引用模板和重新上传；模板是填写规则/媒体槽位，不复制其他 SKC 历史审核结果。
- 合规提示不是普通商品发布的硬阻断，除非 SHEIN 官方发布接口明确拒绝；合规状态与商品审核状态分列。
- 包装实拍图字段：`packageLableList`；商品本体实拍图字段：`bodyLableList`。旧 `skcLablePicList` 已废弃，禁止新代码依赖。
- 官方不提供历史实拍图删除能力时，UI 只能表示新增/绑定请求，不宣称已覆盖或删除 SHEIN 历史图。

### 3.4 审核与发布

标准审核阶段严格映射：

```text
待审核 → 待核价 → 待寄样 → 待审版 → 待核样 → 待终审 → 已通过/已上架
任意阶段 → 已驳回
已驳回 → 重新编辑/重新发起
任意本地记录 → 已归档（从当前审核视图移除，但保留审计历史）
```

- 状态归类只能依据 SHEIN 返回的 workflow stage、audit state、receive state 和明确错误，不可用本地“发起次数”猜阶段。
- 每个 SKC 保留稳定任务链：任务 ID、当前官方状态、官方更新时间、发起次数、驳回次数、最近驳回原因、最近请求、平台 document/version、操作人、租户、店铺、草稿关联。
- 重新发起后，旧“已驳回”记录必须进入历史时间线，当前列表不能继续把它当成当前驳回状态；成功提交后不可显示为旧驳回，除非最新官方回读再次返回驳回。
- 发布 UI 必须显示：排队中、上传中、SHEIN 接收中、官方审核中、结果待确认、已成功、已驳回、网络异常、可安全重试。
- 发布请求失败和“结果未知”不同：HTTP 超时不能推断失败，也不能重复提交；先手动刷新/回读，再允许安全重试。
- 额度、保证金、授权、商家 SKU 重复等平台拒绝必须原样展示 code/message/traceId。

### 3.5 经营、库存和今日工作

- 销量严格来自 `query-sku-sales`；库存/在途严格来自 `stock-query` 或官方返回字段。
- 官方字段缺失与官方返回 0 必须区分；未知值不生成缺货/补货假预警，也不汇总为 0。
- 今日工作按用户可见店铺统计今日上新、审核通过、驳回、核价通过、寄样、待处理及动态事件；管理员看租户范围。
- 今日工作使用手动刷新和缓存，不做 30 秒定时刷新。
- 每店铺在商品草稿、批量建品、新建商品、商品审核中心等页面显示本月剩余发品额度；额度以 SHEIN 官方回读为准，真实发布被平台接收后才按官方事件/回读更新。

---

## 4. 最新架构：NEXUS-OPS-01 / NEXUS-EVO / SRF

### 4.1 NEXUS-OPS-01：SHEIN 店群精品运营中台

目标不是换皮，而是统一：视觉设计、数据缓存、任务状态、SHEIN API 适配、权限、错误/刷新、审计/可观测性。

```text
Browser V2
  → V2 API client
  → tenant/user/store authorization
  → TanStack Query scoped cache
  → PostgreSQL projections + snapshots
  → Redis/BullMQ jobs
  → rate-limited SHEIN adapter
  → official readback / webhook
  → transactional upsert + audit/trace
```

SHEIN 官方 API 是库存、销量、审核、核价、寄样、合规、发布状态唯一来源；本地系统只做权限、缓存、任务编排、状态映射、审计和展示。

### 4.2 NEXUS-EVO-00～10 状态

| 步骤 | 内容 | 当前记录 |
| --- | --- | --- |
| EVO-00 | 基线冻结、回滚保护 | 已完成；无业务变更 |
| EVO-01 | 代码/功能/资产盘点 | 已完成；无业务变更 |
| EVO-02 | 租户、用户、店铺作用域 | 已部署并有回归 |
| EVO-03 | 统一缓存、手动刷新、新鲜度 | 已部署并有回归 |
| EVO-04 | 发布/审核状态机收敛 | 已部署，但生产仍需核对投影漂移 |
| EVO-05 | 合规必填、1630/1631 官方闭环 | 已部署；合规写仍按开关控制 |
| EVO-06 | 发布进度、幂等、额度回写 | 本地仓储已含修复；云端 Worker 投影需重新部署/验证 |
| EVO-07 | 模板替换、单属性重引、编辑闭环 | 已部署记录；需继续验证老草稿和单属性重引 |
| EVO-08 | 销量/库存/在途/经营分析口径 | 已部署记录；以官方字段为准 |
| EVO-09 | UI、性能、可观测性 | 已部署记录；线上合规双勾选/布局仍有回归证据 |
| EVO-10 | 综合回归与发布审计 | 已部署记录；不能替代线上 Worker 版本核对 |

### 4.3 HEF/HST/HWF

- `HEF-01` 事件订阅：Webhook 验签、去重、持久化、异步投影；今日工作消费可见范围内动态事件。
- `HST-01` 销量库存：官方销量/库存/在途字段，未知和 0 分离；缓存、手动刷新、作用域隔离。
- `HWF-01` 统一工作流：审核阶段别名统一、未知阶段 fail-closed、发布幂等/结果未知、权限和缓存一致。

### 4.4 SRF-01～10

| 方案 | 目标 | 已有收敛 |
| --- | --- | --- |
| SRF-01 | 清流刷新网 | 手动刷新、任务闭环、活动同步；不做普通页面轮询 |
| SRF-02 | 清流刷新闭环 | 任务跟踪、缓存回读、完成后状态一致 |
| SRF-03 | 清流刷新韧性 | 失败恢复、部分失败、服务不可用真实反馈 |
| SRF-04 | 清流任务一致性 | 陈旧 queued/running 自愈、`completed_with_errors` 兼容 |
| SRF-05 | 清流刷新硬化 | BullMQ lock/renew/stalled、并发池、七类任务自愈 |
| SRF-06 | 清流作用域隔离 | 活动任务 ID 绑定 tenant/user/store，切店清理临时状态 |
| SRF-07 | 清流刷新一致性 | 修复冷却倒计时与单次路由交接 |
| SRF-08 | 清流刷新权威冷却 | 取服务端 retryAfter 与本地保护窗口较大值 |
| SRF-09 | 清流认证缓存边界 | 401/退出/新登录清空业务缓存和店铺选择 |
| SRF-10 | 清流认证作用域缓存 | stores/members/AI 配置按认证作用域缓存和失效 |

SRF 的“已部署”不能证明每个生产 Worker 都是最新镜像；任何同步/发布问题都要做代码 SHA、容器 image created/start time 和数据库状态三方核对。

### 4.5 AI 标题

- 仅负责地毯图案的短命名、标题去重和结构检查；标题仍遵守用户定义的“开头 + AI 图案命名 + 后缀”、SHEIN 动态长度和语种。
- 单品、批量建品、商品审核中心应复用同一 `buildAiTitleRequest`/`composeAiTitle` 契约。
- 管理员在网页设置中配置 API URL、模型名/模型 URL、密钥和超时；代码不得写死模型，允许更换 OpenAI 兼容视觉服务/千问视觉模型。
- 服务端强制 tenant/user/store 和成员功能授权；未被管理员授权的成员页面不渲染 AI 按钮，服务端也必须拒绝越权调用。
- A0（诊断 Trace/阶段耗时/错误码）、A1（输入契约收紧）、A2（图片复用）和 A3（有界并发调度）已完成本地验证、尚未部署。

---

## 5. GitHub 开源项目的实际采用边界

开源项目用于成熟的 UI、缓存、表格、虚拟化、队列、上传和测试模式；不负责替代 SHEIN API 语义、权限判定或业务状态机。

| 项目/模式 | 已采用或计划 | 作用 | 禁止误解 |
| --- | --- | --- | --- |
| shadcn/ui 思路 + Radix primitives | 已部分采用 | Button、弹层、可访问性、设计令牌 | 当前没有把完整后台模板强行套入运行时 |
| TanStack Query | 已采用 | 服务端缓存、去重、失效、取消、错误重试、手动刷新 | key 必须包含 tenant/user/store；不能缓存越权数据 |
| TanStack Table | 已采用/逐步统一 | 复杂商品、SKU、审核表格 | 不能用前端全量数据替代服务端分页 |
| TanStack Virtual | 已采用 | 大量 SKC/SKU 虚拟滚动 | 小表格强制虚拟定位会导致列错位，100 条以内优先原生表格 |
| BullMQ | 已采用 | 发布、同步、合规、规则、媒体任务 | 不会自动解决业务投影一致性；Worker 必须与 control 同版本 |
| dnd-kit | 已采用 | 图片排序和拖拽 | 只改变图片用途/顺序，不修改原文件 |
| Uppy | 评估但未直接引入 | 大文件/断点上传模式参考 | 当前轻量直传链路未引入重复上传状态 |
| ECharts | 计划按需 | 经营驾驶舱趋势图 | 只能画官方字段投影，不能前端推算库存销量 |
| Playwright | 测试模式 | 浏览器核心流程、布局、双勾选、权限、发布进度 | 不以 live SHEIN 作为唯一确定性测试 |
| MSW/网络 mock 思路 | 计划 | API 响应变体和错误场景 | 不能把 mock 当线上真实状态 |
| Storybook/视觉回归思路 | 计划 | 组件状态和布局回归 | 目前仓库未确认完整 Storybook 运行时 |
| Lighthouse CI | 计划 | 性能预算、首屏、图片和 JS 体积 | 不替代真实多店压力测试 |
| OpenTelemetry JS 思路 | 部分采用 traceId/审计 | 串联用户操作→API→队列→SHEIN→DB | 完整 exporter/collector 尚未确认部署 |
| Temporal、Cube、Superset、Metabase、OpenFeature | 暂不引入 | 作为规模化方案参考 | 4GB 单机和当前数据量直接引入会扩大故障面 |

当前比较的 GitHub 项目没有统一“评分”字段；判断标准是 Star/Fork、活跃度、许可证、维护质量、与现有 React/Node/Postgres/Redis 栈的适配，而不是只看 Star。

---

## 6. SHEIN API 对接总表与不可混用规则

### 6.1 请求签名和通用约束

通常需要：

```text
Content-Type: application/json
x-lt-openKeyId
x-lt-timestamp（毫秒）
x-lt-signature
language（按官方要求）
```

文件接口按官方 multipart 规则调用。服务端必须保留 `code`、`msg`、`traceId` 和失败明细；API 超时不改变业务状态。限流、批量上限、文件大小/格式以 `docs/shein-api-raw/` 原文为准。

### 6.2 鉴权、店铺、基础和规则

- 店铺站点/币种：`POST /open-api/goods/query-site-list`
- 类目树：`POST /open-api/goods/query-category-tree`
- 类目属性模板：`POST /open-api/goods/query-attribute-template`
- 发布填写规范：`POST /open-api/goods/query-publish-fill-in-standard`
- 关联属性规则：`POST /open-api/goods/get-associated-attribute-rules`
- 自定义属性权限：`POST /open-api/goods/get-custom-attribute-permission-config`
- 添加自定义属性值：`POST /open-api/goods/add-custom-attribute-value`
- 品牌：`POST /open-api/goods/query-brand-list`
- IP：`POST /open-api/goods/query-ip-list`
- 环保/材料规则：`POST /open-api/goods-quality/environmental-label-rule/material-quality-tree-v2`

旧 `/open-api/openapi-business-backend/product/full-detail` 已标记即将作废，新代码不得新增依赖。

### 6.3 商品读取、图片、发布、审核、上下架

- 商品综合查询：`POST /open-api/goods/searchProduct`
- 商品列表：`POST /open-api/openapi-business-backend/product/query`
- SPU 详情：`POST /open-api/goods/spu-info`
- 图片上传：`POST /open-api/goods/upload-pic`
- 图片转换：`POST /open-api/goods/transform-pic`（只有原始规则明确需要时使用）
- 发品权限：`POST /open-api/goods/product/check-publish-permission`
- 发品额度：`POST /open-api/goods/query-shelf-quota`
- 商家 SKU 查重：`POST /open-api/goods/product/check-supplierSku-repeated`
- 商品发布/编辑：`POST /open-api/goods/product/publishOrEdit`
- 商品部分编辑：`POST /open-api/goods/product/partialEdit`
- 商品审核状态：`POST /open-api/goods/query-document-state`
- 撤回商品：`POST /open-api/goods/revoke-product`
- 上下架：`POST /open-api/goods/modify-skc-shelf`
- 删除预校验：`POST /open-api/goods/check-deletable`
- 删除申请：`POST /open-api/goods/delete/{skcName}`
- 删除审核记录：`POST /open-api/goods-delete-logs/search`
- SKU 销量：`POST /open-api/goods/query-sku-sales`
- 库存：`POST /open-api/stock/stock-query`
- 仓库：`GET /open-api/msc/warehouse/list`

商品发布必须拆开“平台接收”和“官方审核”：平台接收/回执事件和审核事件不是同一状态。

### 6.4 合规、证书、1630/1631、实拍图

- 合规要求：`POST /open-api/goods-compliance-requirements/list`
- 实拍图要求：`POST /open-api/goods-compliance/skc-label-list`
- 实拍图模板：`POST /open-api/goods-compliance/get-label-template`
- 实拍图上传：`POST /open-api/goods-compliance/upload-skc-label-picture`
- SKC 绑定实拍图：`POST /open-api/goods-compliance/skc-save-label`
- 证书列表：`POST /open-api/goods-certificates/search`
- 证书 Schema：`POST /open-api/goods-certificate-schemas/detail`
- 证书文件上传：`POST /open-api/goods-certificate-files/upload`
- 证书创建/编辑：`POST /open-api/goods-certificates/save`
- 证书绑定：`POST /open-api/goods-certificates/bind`
- 代理公司：`/open-api/goods-compliance/agency-list`、`/open-api/goods-compliance/skc-agency-detail`、`/open-api/goods-compliance/save-skc-agency`
- 警示语：`/open-api/goods-compliance/query-warning-certificate-rules`、`/open-api/goods-compliance/query-skc-warning-status`、`/open-api/goods-compliance/update-skc-warning-certificate`
- 合规标签打印：`POST /open-api/goods-compliance/label-print`

实拍图绑定字段：

```text
上传返回：info.imageUrl + info.imageMd5
绑定请求：skcList + packageLableList + bodyLableList
```

1630/1631 报告必须作为独立报告类型、文件和生效日期记录。报告不是 `packageLableList`/`bodyLableList`。

### 6.5 Webhook 和事件

- 正式入口：`POST /webhooks/shein`
- 测试入口：`POST /webhooks/shein/test`
- 关键事件：商品接收/审核、价格、建议零售价、额度、删除审核、采购、发货、缺货、合规失效、授权关系变化。
- Webhook 只做快速验签、幂等落库和异步入队；不在请求内执行重业务。
- Webhook 是增量触发，查询接口/手动刷新负责最终一致性。

### 6.6 已核对的批量限制样例

这些仅是已核对样例，不可推广成统一上限：

- SKU 销量单次最多约 100 个 SKU，平台提示 QPS 40/s。
- 商家 SKU 查重单次最多约 200 个。
- 删除预校验单次最多约 50 个 SKC。
- 建议零售价提交单次最多约 10 个 SKC。
- 实拍图单文件不超过约 10 MB、长宽不超过约 8000px、接口约 20 QPS；实际以原文和真实响应为准。

批量引擎必须按“店铺 + 接口 + 业务依赖”分组、按接口元数据拆批、店铺级令牌桶限流；字段错误人工处理，只有网络/限流/明确可重试错误才重试。

---

## 7. 数据模型、任务和状态投影

### 7.1 关键表/实体

- 身份与权限：`users`、`memberships`、`membership_store_access`、`stores`、设备/会话表。
- 商品读模型：`spus`、`skcs`、`skus`、经营快照/销量/库存表。
- 规则快照：`shein_rule_snapshots`（按租户/店铺/规则类型/类目/产品类型/subject 唯一）。
- 合规：`skc_compliance_records`、`compliance_drafts`、证书/代理/警示语快照、实拍图绑定。
- 草稿：`product_drafts`（版本、schema fingerprint、rule snapshot、冻结发布快照）。
- 发布：`publish_batches`、`publish_batch_items`、`publish_jobs`、`publish_receipts`、`publish_execution_runs`。
- 任务：`sync_jobs`（`store_business_refresh`、`product_incremental_sync`、`sales_daily_sync`、`inventory_sync`、`compliance_sync`、`rule_refresh`、`webhook_reconcile`）。
- 媒体：`media_assets`、模板媒体引用、对象存储元数据。
- 模板：`publish_templates`、模板 scopes/version/变更记录。
- 事件：Webhook 原始事件、审计事件、今日工作动态投影。

### 7.2 发布任务最小字段

```text
publish_jobs:
id, tenant_id, store_id, product_draft_id, publish_batch_id?
idempotency_key, state, attempt_count
request_summary, frozen_snapshot_hash
shein_document_sn, shein_version, trace_id
last_error, requested_by, confirmed_by
created_at, started_at, completed_at
```

发布成功需同时具备：SHEIN 接收/版本或 document 回执、任务终态、批次投影、后续官方状态回读。单有本地“提交成功”不能称为已上架。

### 7.3 同步任务状态

页面不能只看 `succeeded`。兼容 `queued`、`running`、`completed`、`completed_with_errors`、`failed`、`cancelled` 等终态；但所有状态必须由服务端真实记录决定。陈旧 queued/running 可在读取时按租户/店铺安全自愈，留下 `SYNC_JOB_TIMEOUT`，不删除审计。

---

## 8. 前端页面与代码地图

### 8.1 V2 应用壳

- `src-v2/app/App.tsx`：V2 路由入口。
- `src-v2/app/AppShell.tsx`：导航、店铺选择、会话、当前店铺持久化、全局任务入口。
- `src-v2/app/query-client.ts`：TanStack Query client、缓存策略。
- `src-v2/lib/api.ts`：V2 API 类型、请求、错误和读写契约。
- `src-v2/styles/app.css`：V2 设计令牌、布局、表格、状态和响应式样式。
- `src-v2/components/ui/button.tsx`、`src-v2/components/operations/*`：可复用 UI/表格原语。

### 8.2 业务页面

| 模块 | 入口 |
| --- | --- |
| 总览/今日工作 | `src-v2/features/overview/OverviewPage.tsx`、`TodayWorkPage.tsx` |
| 商品经营 | `src-v2/features/operations/ProductsPage.tsx`、`ProductDetailPage.tsx` |
| 销量库存 | `SalesInventoryPage.tsx`、`OperationsShared.tsx`、`use-business-dashboard.ts` |
| 经营预警 | `AlertsPage.tsx` |
| 同步任务 | `SyncJobsPage.tsx`、`refresh-state.ts` |
| 商品草稿 | `ProductDraftsPage.tsx` |
| 批量建品/新建 | `BatchProductCreatePage.tsx`、`NewProductPage.tsx`、`ProductFolderImport.tsx` |
| 图片/合规素材 | `ProductImagesSection.tsx`、`ProductComplianceSection.tsx` |
| 发布批次/审核中心 | `PublishBatchesPage.tsx` |
| 合规总览/详情/草稿 | `CompliancePage.tsx`、`ComplianceDetailPage.tsx`、`ComplianceDraftEditor.tsx`、`ComplianceCertificateEditor.tsx` |
| 成员/店铺设置 | `MembersPage.tsx`、`StoresPage.tsx` |
| 模板中心 | `features/templates/*` |

### 8.3 服务端 owner

- SHEIN transport/signature：`server/shein-client.js`、`server/shein-product.js`、`server/shein-compliance.js`、`server/shein-upload.js`。
- 本地路由/兼容：`server/index.js`、`server/v2-local-real-server.js`。
- 云端 control/auth/API：`server/cloud/control-server.js`、`web-auth.js`、`web-shein-authorization.js`。
- 草稿/发布：`product-draft-service.js`、`product-publish-candidate.js`、`product-publish-executor.js`、`publish-batch-service.js`、`publish-execution-protocol.js`、`publish-execution-repository.js`、`product-publish-worker*.js`。
- 审核：`product-review-service.js`、`document-state-projections.js`、`spu-readback-projections.js`、`webhook-production-projections.js`。
- 合规：`compliance-workspace-service.js`、`compliance-sync-service.js`、`compliance-sync-worker*.js`、`compliance-write-service.js`、`compliance-revalidation-projections.js`。
- 经营/刷新：`store-business-service.js`、`store-business-refresh-worker*.js`、`store-business-refresh-scheduler.js`、`sync-job-service.js`、`rule-refresh-*`。
- 事件：`webhook-server.js`、`webhook-worker*.js`、`webhook-event-processor.js`、`webhook-*repository.js`。
- AI 标题：`server/cloud/ai-title-service.js`、`src-v2/lib/ai-title-contract.*`。
- 媒体/清理：`media-service.js`、`media-lifecycle.js`、`media-cleanup-worker*.js`、`s3-object-storage.js`。
- 额度/用量：`workspace-quota.js`、`workspace-usage-service.js`。

### 8.4 旧版代码

- `src/WebApp.jsx`（约 6200 行）和 `src/web-styles.css`（约 4300 行）是旧单体页面。新修复默认只改 V2 owner；除非明确证明线上旧路由仍使用 legacy，否则不要继续扩展旧单体。

---

## 9. 缓存、刷新、性能和容量原则

### 9.1 浏览器

建议/现行 Query key：

```text
['session']
['stores', tenantId, userId]
['store', storeId, 'products', filters]
['store', storeId, 'sales-inventory', filters]
['store', storeId, 'alerts', filters]
['store', storeId, 'templates', templateType]
['store', storeId, 'drafts']
['store', storeId, 'compliance', filters]
['store', storeId, 'jobs', jobType]
```

任何业务 key 必须带租户/用户/店铺；401、退出、新登录、切店时清理或失效旧作用域。页面切换应复用缓存和请求去重；不要因为切换页面重新下载相同图片。

### 9.2 刷新

- 普通页面只显示缓存、来源、截止日期、上次同步时间和新鲜度；页面 GET 不直接调用 SHEIN。
- 只允许用户手动刷新；普通今日工作不做 30 秒自动刷新；活动任务才监听轻量进度。
- 重复点击复用同一 `sync_jobs` 任务 ID；无活动任务停止轮询；任务完成/失败/部分失败后停止后台请求。
- 服务端 `retryAfterSeconds` 与本地保护窗口取较大值；冷却倒计时只更新本地时间，不发网络请求。
- 当前快照为 ready/idle 时读取不能写库；只有 refreshing/陈旧任务自愈时才按租户/店铺节流写入。

### 9.3 云端容量

- PostgreSQL 保存可靠投影和审计；Redis 保存短期缓存、队列和去重。
- control 默认约 256 MB，Redis 约 192 MB maxmemory，PostgreSQL 约 1.2 GB；具体以云端 compose 和实际容量为准。
- 经营、规则、合规、发布 Worker 默认并发 1；调度器有界并发，不能无上限扩展。
- 图片字节不经过 Node control，走短时签名/私有对象存储；对象存储清理需保留恢复期，引用中的图片禁止清理。
- 销量明细按月份/时间保留，长期保留聚合；Webhook/审计按时间归档；同步任务和失败记录不能为了“看起来干净”删除。

---

## 10. UI/交互统一要求

- 页面壳层统一：左侧导航、顶部店铺切换、页标题、筛选/刷新/批量动作位置统一。
- 1280px 桌面宽度不横向溢出；复杂编辑使用抽屉/弹窗/分步页，不堆巨型输入框。
- 字体小而清晰，状态颜色固定：成功绿色、警告琥珀、阻断/危险红色、缓存/未知灰色。
- 每个页面必须有 loading、空数据、缓存过期、刷新中、部分失败、权限拒绝、网络错误和服务不可用状态。
- 主图固定缩略比例，支持放大；图片未加载时保留稳定占位而不挤压列。
- 表格小数据使用原生布局保持列宽；大数据才启用虚拟化；列有明确最小/最大宽度与溢出省略。
- 危险动作（发布、拒绝核价、批量归档、删除、重新发起）需要明确文案、进度、结果和审计。
- 浏览器标签图标为黑底白字 `HZ`，文件 `public/favicon-hz.svg`；不重新引入生图模块或旧技术说明。

---

## 11. 已部署版本、候选版本和本地-only 版本

以下来自 `docs/REBUILD_HANDOFF_2026-08-24_CONTINUE.md` 的历史记录。包名/SHA 是历史审计证据，不代表今天线上实际 release；下一次部署前必须重新核对远端。

### 11.1 已记录为云端部署

| 时间/版本 | 内容 | 包/SHA（历史） |
| --- | --- | --- |
| 2026-08-24 | 官方 1630/1631 工作流、审核主图回退 | `shein-cloud-deploy-20260824-official-compliance-review-image-v1.tar.gz` / `d1c95632ae6e5409ad6933e86e2e1609ffd6f7121d222a342c4553244f4b49c5` |
| 2026-08-24 | 草稿内部名称 160 与 SHEIN 标题上限分离 | `shein-cloud-deploy-20260824-batch-title-limit-v2.tar.gz` / `273c06842d349e93af8aed54622f462c2009ca5a4068af30e2a2d30c0288ecdb` |
| 2026-08-24 | 管理员共享轮播图跨店媒体权限 | `shein-cloud-deploy-20260824-shared-carousel-template-v1.tar.gz` / `5e3d3ae3103def7a386801b715bcd8cbbfa7bc8e122b38e69a1d00c18659f9f8` |
| 2026-08-24 | SKC 图片排序、SKU 紧凑编辑 | `shein-cloud-deploy-20260824-batch-skc-image-editor-v1.tar.gz` / `e0bc555a8178202fe8b5bb56048da2bb631bfb9d61ee8ec622b8e724f30aab86` |
| 2026-08-24 | 批量参数 UI、水印折叠、移除旧说明 | `shein-cloud-deploy-20260824-batch-ui-polish-v1.tar.gz` / `edf0351767af91155a39369fb3cad927cf0bea3bf1b957874f0188d75bbb7e8b` |
| 2026-08-25 | 合规同步终态兼容 | `shein-cloud-deploy-20260825-compliance-sync-terminal-v1.tar.gz` / `5d8dd7558ba2374e08a1c8a9fb29b495134795ac72ce5bc0589adc794b06a02b` |
| 2026-08-25 | 合规表格布局 | `shein-cloud-deploy-20260825-compliance-table-layout-v1.tar.gz` / `afdccec0de5c58eaf9b42b8f41d922d2aba3242e786d135bec52b05dfda600c` |
| 2026-08-25 | 合规长文本溢出 | `shein-cloud-deploy-20260825-compliance-overflow-v1.tar.gz` / `9be2bc5b07b7f1adf3c8467de8add33d1339e463525df579b78e530702060afe` |
| 2026-08-25 | HZ favicon | `shein-cloud-deploy-20260825-ui-favicon-v1.tar.gz` / `05daeba05649b4f2625ede5208f07da5c6bef5299709a9735aadbcb20bf21acd` |
| 2026-08-25 | 审核状态/图片缓存 | `shein-cloud-deploy-20260825-review-sync-image-cache-v1.tar.gz` / `77bce975f05354efe294417cfcf768448818200487d01a5e6c46c33c99bf9b0d` |
| 2026-08-26 | 合规必填、官方 1630/1631 | `shein-cloud-deploy-20260826-compliance-required-report-v2.tar.gz` / `07bedd734323a7d6e841173f20c8c67289796d8da7ac0f1c5cd8bc1b20aadba3` |
| 2026-08-26 | SRF-01 活动/手动刷新 | `shein-cloud-deploy-20260826-srf-01-manual-refresh-v2.tar.gz` / `87bc4ac963a610c3f73777ac4146a98f9572c16f7a839ea393803517297aa5a2` |
| 2026-08-27 | EVO-00～10 强制回归/审核中心发布 | `shein-cloud-deploy-20260827-nexus-evo-00-10-checkbox-fix-v1.tar.gz` / `5455c2c19f83f0fceb7927a6484b397f83d802e73b24745521542473208c83ad` |
| 2026-08-27 | NEXUS-REVIEW-01 | `shein-cloud-deploy-20260827-nexus-review-01-v2.tar.gz` / `16679beeaef233648e685c9b8251762dce90716b7c4d43edcd692755b467951d` |
| 2026-08-27 | SRF-02 | `shein-cloud-deploy-20260827-srf-02-refresh-closure-v1.tar.gz` / `061d64d0f493e579a9ea2b6a6f86feab3162be39cc7c9d045b5e0fc6a17085bc` |
| 2026-08-27 | SRF-03 | `shein-cloud-deploy-20260827-srf-03-refresh-resilience-v2.tar.gz` / `816513af2ca3141e298a8916129991f4261f54bbc508aaae6bf61f8403375ebd` |
| 2026-08-27 | SRF-04 | `shein-cloud-deploy-20260827-srf-04-task-consistency-v1.tar.gz` / `65f50ad15604d13f4ea3cba8284347837d6fadffd19ffe5a42d89dbbf195ffbd` |
| 2026-08-27 | SRF-05 | `shein-cloud-deploy-20260827-srf-05-refresh-hardening-v1.tar.gz` / `46e61453c4bf8c8dfc33e977099ae8d2110799b9f88cf4be2309f2ea5689b98b` |
| 2026-08-27 | SRF-06 | `shein-cloud-deploy-20260827-srf-06-refresh-scope-v1.tar.gz` / `c5dc0181f5d553e9ebc1991c3006db43b3ea4469f753d92df6dd8ebd9fbcec13` |
| 2026-08-27 | AI 标题审核中心入口/成员授权 | `shein-cloud-deploy-20260827-ai-title-review-v1.tar.gz` / `f5f0282da15f35acce08dfe0878e2ceaf25086417ff9b7aaabd32a6aef8793de` |
| 2026-08-27 | SRF-07 | `shein-cloud-deploy-20260827-srf-07-refresh-coherence-v1.tar.gz` / `a25955b42d04487c262625f9094d65ee5bce758c4fd71273a7eb8299b3cfb477` |
| 2026-08-27 | SRF-08 | `shein-cloud-deploy-20260827-srf-08-refresh-authority-v2.tar.gz` / `f5858386a3452d1becb6feee9a94b8901c039ba261922e3681dec2a0fd3b81d7` |
| 2026-08-27 | SRF-09 | `shein-cloud-deploy-20260827-srf-09-auth-cache-boundary-v1.tar.gz` / `bab9e9d2cff4a4aff35c9099d9a44fb9349a2a42b3f5ffbac5e2ea331943caf8` |
| 2026-08-27 | SRF-10 | `shein-cloud-deploy-20260827-srf-10-authenticated-cache-scope-v1.tar.gz` / `644b9aee690c082c2350fa05e3bf1acf0d3169aabfcc9cad604adfa3e6bba0e0` |

这些部署记录普遍声明：`npm test`、`npm run build:v2`、`npm run release:audit:v2` 通过，未执行数据库迁移，未调用 SHEIN 商品/合规写接口；但历史记录不能替代本轮线上核验。

### 11.2 已完成本地验证但未部署

- `NEXUS-AI-FAST-01-A0`：AI 标题诊断基线、Trace/阶段耗时/稳定错误码。
- `NEXUS-AI-FAST-01-A1`：AI 标题输入契约与管理员配置校验收紧。
- A2 图片复用、A3 有界并发调度：已完成本地候选，尚未部署。
- 管理员账户别名迁移/网页能力：旧交接曾标记本地候选，涉及迁移 `044_user_admin_alias.sql` 时必须先做迁移预检。
- EVO-11 Route Smooth、早期导航候选、部分批量保存候选：不要假设已部署，先查实际文件和 release。

### 11.3 当前明显的“已部署记录但线上仍有证据回归”

- 商品审核中心双勾选框仍在用户截图中出现。
- 已驳回重发后列表未及时移除/仍显示旧驳回，需以最新官方回读和本地任务链修复。
- 待审核、待核价、待寄样、待终审分类曾出现错放；必须用 `product-review-service.js` 单一状态归一化和严格 store scope。
- 合规列表主图/类目/字段布局曾出现空图、类目重叠；生产静态资源和数据投影需要重新核验。
- control/API 健康不代表 SHEIN 发布成功；发布额度 0、保证金限制必须显式显示。

---

## 12. 当前 P0/P1 待处理清单（新对话不要遗漏）

### P0-A：生产发布 Worker 与批次投影漂移

**症状**：SHEIN 后台没有商品；网页可能显示排队/待审核。
**已知根因**：平台真实返回 `20100` 额度/保证金限制；同时生产 Worker 旧镜像未包含失败向 `publish_batch_items/publish_batches` 的事务投影。
**下一步**：

1. 只读核对远端 release、control/Worker image ID、容器创建时间和本地 `publish-execution-repository.js` 版本。
2. 增加失败投影一致性回归：job terminal failure 必须同事务更新 batch item/batch，且幂等。
3. 增加 UI 回归：`failed_terminal` 优先显示“发布失败”，不被 workflowStage 或 `ready` 遮盖。
4. 对历史 stale `ready` 批次做只读报告和受控修复脚本/迁移方案；禁止直接批量改生产状态。
5. 仅在用户明确授权且维护窗口确认后，重建 control + product-publish-worker；不重启 DB/Redis。
6. 发布后验证 SHEIN 平台回读、document/version、数据库三层一致，不能只看 HTTP 200。

### P0-B：审核中心双勾选框

**症状**：表头、每行出现两个相邻 checkbox；导致已驳回单个/批量重新发起勾选体验异常。
**下一步**：DOM 计数→owner 组件定位→失败浏览器测试→单列选择实现→桌面/窄屏验收→云端静态资源核对。

### P0-C：官方审核阶段严格分类

**症状**：已驳回出现在待审核；待终审有商品但网页没有；分类切换反馈慢。
**下一步**：以 `product-review-service.js` 的 `resolvedWorkflowStage` 为唯一归类入口；未知状态保留待同步；后端分页/filter 优先；每条读模型保存来源时间、raw status、traceId；切店清缓存。

### P1-A：手动刷新/任务自愈

- 复核 `sync_jobs` stale running、`publish_execution_runs` stale running、Redis queue 和 worker lock。
- 保持手动刷新；没有活动任务不轮询；失败不清空旧数据；服务不可用不能伪装成功。

### P1-B：合规单品页面

- 恢复/确认主图缩略图、官方必填字段、1630/1631 返回后上传入口。
- 逐项验证 `packageLableList`/`bodyLableList`、模板引用、单属性重新引用和保存后回读。
- 继续检查合规列表的列宽、空图、类目路径和点击打开详情。

### P1-C：草稿/批量建品

- 复核打包体积缺失、重新引用按钮无反应、标题替换而非叠加、图片删除/排序/放大、保存并前往发布。
- 模板替换须按字段局部替换，不得清空未选择字段或叠加旧值。

### P1-D：AI 标题

- A0/A1 本地-only，需用户明确部署后才上线。
- 诊断 AI 慢/失败必须保留 Trace、稳定错误码、缓存命中和权限原因；错误不缓存。
- 管理员配置 URL/模型，不能写死；未授权成员不能看到按钮也不能调用接口。

### P1-E：商业级 UI/性能

- 以 Radix/shadcn 思路统一状态、按钮、弹窗、表格，不直接引入第二套后台模板。
- 1280px 不溢出；大列表才虚拟化；图片复用浏览器/对象存储缓存；避免切换页面重新请求/下载。
- 继续补 Playwright、组件视觉回归、Lighthouse 性能预算，但不为“好看”改变 SHEIN 数据语义。

---

## 13. 测试、构建、审计和部署门禁

### 13.1 本地命令

```bash
npm test
npm run build:v2
npm run release:audit:v2
git diff --check
```

定向测试按 owner 选择，例如：

```bash
node --test server/cloud/product-publish-worker.test.js
node --test server/cloud/publish-execution-repository.test.js
node --test server/cloud/product-review-service.test.js
node --test server/cloud/v2-publish-batch-ui.test.js
node --test server/cloud/srf-01-refresh-closure.test.js server/cloud/srf-02-refresh-ui.test.js
```

### 13.2 成功标准

- 失败回归先失败，修复后通过；全量 `npm test` 通过。
- `npm run build:v2` 通过，且 `dist-v2` 与线上使用的 `dist-web` 内容同步。
- `npm run release:audit:v2` 返回 `READY`，契约无 blocker。
- 没有密钥、`.env`、`.data`、`.git`、历史压缩包进入部署包。
- 不因构建/测试调用 SHEIN 写接口；live SHEIN 只做用户授权后的只读/明确授权验收。
- 页面加载、空、缓存、手动刷新、部分失败、权限、切店、任务进度和错误状态均有可见反馈。

### 13.3 云端部署原则

1. 生成时间版本号 release，校验 SHA-256。
2. 先上传候选并执行 `audit-v2-release-readiness`。
3. 只原子切换 `/opt/shein-console/current`；保留上一 release，失败立即回退。
4. 只重建本次 owner 相关 control/UI/Worker；不要无故重启 PostgreSQL、Redis 或无关 Worker。
5. 涉及迁移先做备份、preflight、migration、runtime role audit；不修改已执行旧迁移文件。
6. 部署后核验 control `/health`、`/ready`、公网 API、网站首页、favicon、静态资源 hash、相关 Worker healthy。
7. 发布/审核修复必须额外核验数据库 job/batch/readback 与 SHEIN 官方状态，不能仅以网页状态结束。

### 13.4 云端环境关键开关（不写实际秘密）

```text
SHEIN_RUNTIME_MODE=cloud
SHEIN_STORE_BUSINESS_REFRESH_ENABLED=false（只读验收后按需开启）
SHEIN_STORE_BUSINESS_SCHEDULER_ENABLED=false（默认手动刷新）
SHEIN_RULE_REFRESH_ENABLED=false（验收后按需开启）
SHEIN_COMPLIANCE_SYNC_ENABLED=false（验收后按需开启）
SHEIN_WEBHOOK_INGRESS_ENABLED=false（正式路由确认后开启）
SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED=false（真实发布维护窗口按需开启）
SHEIN_COMPLIANCE_WRITES_ENABLED=false（默认关闭）
SHEIN_PRODUCT_PUBLISH_CONCURRENCY=1
```

真实发布停止时先关 control 开关、等待 Worker 可审计收尾，再停 Worker；不能删除失败/未知回执制造成功。

---

## 14. 完整资料索引与文档可信度说明

### 14.1 必读资料（按顺序）

1. 本文件：当前入口、P0/P1、线上诊断和启动清单。
2. `docs/REBUILD_HANDOFF_2026-08-24_CONTINUE.md`：当前历史部署、用户反馈和 API 端点摘要。
3. `docs/REBUILD_HANDOFF_2026-08-12_CONTINUE.md`：完整历史需求、历次修复、用户确认和验收。
4. `docs/REBUILD_HANDOFF_2026-08-03.md`：原始产品边界、页面、权限、阶段和早期实现。
5. `docs/SHEIN_INTEGRATION_BLUEPRINT.md`：当前可用的 API 接入、模板、商品、合规、批量、Webhook 蓝图。
6. `docs/V2_SHEIN_API_CAPABILITY_MATRIX.md`：端点能力、读写性质、冻结边界和上线前确认。
7. `docs/V2_DATA_PERMISSION_MODEL.md`：租户/用户/店铺/模板/任务/行级权限与迁移原则。
8. `docs/V2_PAGE_MAP.md`：V2 路由、页面数据源、角色、动作和页面状态。
9. `docs/HEF_HST_HWF_IMPLEMENTATION_2026-08-26.md`：三大横切方案实施记录。
10. `docs/OSS_WORKFLOW_AUDIT_2026-08-26.md`：GitHub 开源项目对照和不直接引入清单。
11. `docs/NEXUS_EVO_00_BASELINE_2026-08-26.md` 至 `docs/NEXUS_EVO_09_UI_PERFORMANCE_2026-08-26.md`：EVO 各阶段记录。
12. `docs/COMPLIANCE_FREEZE_2026-08-22.md`、`docs/COMPLIANCE_REQUIRED_REPORT_UI_2026-08-26.md`：合规冻结与官方报告 UI。
13. `deploy/README.md`、`deploy/docker-compose.cloud.yml`、`deploy/v2-release-readiness.md`：云端拓扑、开关、迁移、审计和回滚。
14. `ENGINEERING_RULES.md`、`README.md`：工程和本地运行规则。

### 14.2 当前工作树中存在的 SHEIN 原始 API 资料

```bash
rg --files docs/shein-api-raw | sort
```

当前目录包含 50 余个官方接口原文 `.txt`，以及：

- `official-upload-skc-label-picture-2025-06-27.md`
- `official-skc-save-label-2025-09-29.md`
- `official-skc-label-list-2025-09-24.md`

这些原文覆盖类目、属性、商品、图片、价格、库存、采购、发货、退货、财务、Webhook 和合规域；原始文档优先级高于历史摘要。

### 14.3 旧交接引用但当前工作树缺失的文件

旧文档曾引用以下文件名，但本次只读核对 `rg --files docs` 时没有找到：

- `docs/SHEIN_API_SOURCE_INDEX.md`
- `docs/SHEIN_API_FIELD_HANDOFF.md`
- `docs/SHEIN_PRODUCT_PUBLISH_CONTRACT.md`
- `docs/CLOUD_DEPLOYMENT_ARCHITECTURE.md`

新对话不得假设这些文件存在，也不能凭旧摘要补造；以本文件、`SHEIN_INTEGRATION_BLUEPRINT.md`、`V2_SHEIN_API_CAPABILITY_MATRIX.md`、`V2_DATA_PERMISSION_MODEL.md`、`deploy/README.md` 和 `docs/shein-api-raw/` 为准。若未来补回这些文件，必须在本文件中更新可信度和版本。

---

## 15. 变更记录格式（后续每次必须追加）

每次修复/部署追加一节，至少包含：

```text
日期与方案编号：
用户症状：
事实证据（页面/API/DB/队列/日志）：
根因层级（UI / V2 client / control / worker / DB / SHEIN）：
允许修改文件：
失败回归测试：
实现摘要：
SHEIN 写接口是否调用：否/明确授权后调用
数据库迁移：无/迁移编号与 preflight
测试：定向、npm test、build:v2、release audit、diff check
部署包与 SHA：
切换的服务：
部署后 health/ready/公网/Worker/DB 回读：
回滚 release：
仍未解决：
```

不要只写“已修复/已部署”。凡是线上用户截图与历史“已部署”相冲突，优先记录为回归/漂移，重新做证据核对。

---

## 16. 最终交接结论

项目已经从早期本地原型演进到 React/Vite V2 + Node cloud control + PostgreSQL + Redis/BullMQ + Webhook + SHEIN adapter 的多租户运营中台，GitHub 开源项目已用于成熟模式，但并没有替代 SHEIN 官方 API 或自动保证生产一致性。

当前最重要的事实不是继续增加页面，而是先解决生产一致性：

1. 平台拒绝必须真实显示，不能把额度/保证金限制显示成审核中。
2. control 与 Worker 必须同版本，`publish_jobs`、批次投影和网页状态必须同事务/同事实源。
3. 审核阶段只能按官方回读严格分类，已驳回重发要从当前驳回视图正确移除并留历史。
4. 双勾选框必须彻底消除并用浏览器回归保护。
5. 刷新只手动、缓存有界、任务可自愈、切店/切账号不串数据。
6. 合规只展示官方必填，1630/1631 等待官方判断后再上传，主图和报告字段必须严格区分。
7. 每次部署必须可审计、可回滚、无秘密泄露，并验证线上真实 release 而不是只看本地测试。

本文件创建本身没有修改业务代码、没有执行 SHEIN 写接口、没有执行数据库迁移、没有部署云端。

---

## 17. 历史需求到代码/资料的对应矩阵

本节用于新对话快速判断“用户以前提过的要求是否已有归属”，不把历史截图当作运行时事实。

| 需求主题 | 约束与验收口径 | 主要 owner / 资料 | 当前风险 |
|---|---|---|---|
| 店铺切换与权限 | 总览、草稿、建品、审核、合规、模板、今日工作均按 tenant/user/store 隔离；管理员可看全站；店铺/账户别名仅管理员可见 | `V2_DATA_PERMISSION_MODEL.md`、`src-v2/app/AppShell.tsx`、`server/cloud/auth-*` | 切店后必须清 query/cache 和临时任务；任何跨店数据都是 P0 |
| 今日工作 | 普通用户只看名下店铺，管理员看全站；手动刷新+缓存，不再 30 秒轮询；上新、核价、驳回、寄样、类目维度和动态 | `src-v2/features/today-work/`、`HEF_HST_HWF_IMPLEMENTATION_2026-08-26.md` | 服务不可用要显示失败原因，不显示伪造 0 |
| 销量/库存 | SHEIN 官方销量、库存为事实源；今日/昨日/7/30 日、在途、可售天数、SKU 展开；本地建议值必须标注计算来源 | `src-v2/features/operations/`、`server/cloud/store-business-*` | 不得把缓存或推算覆盖官方回读 |
| 经营预警 | 库存、销量、驳回、核价、合规、发布确认、API 异常可跳转到商品/SKC/SKU/任务 | `src-v2/features/alerts/`、`server/cloud/alert-*` | 告警去重、过期和权限边界需回归 |
| 商品草稿/批量建品/新建商品 | 标题、属性、图片、SKU、价格、重量、包装体积、合规、预检；单个/批量共用编辑内核；模板引用是替换而非叠加 | `src-v2/features/drafts/`、`src-v2/features/product-create/`、`src-v2/features/batch-products/` | 旧图片结构、缺尺寸、保存慢、发布入口和图片删除曾多次回归 |
| 图片与素材 | 商品本体/包装实拍可多图手传或引用模板；主图/通用图可放大、删除、排序；引用后写入 SHEIN 正确字段；跨店模板媒体需权限 | `server/shein-upload.js`、`src-v2/features/compliance/`、模板资料 | 图片 URL 过期、缩略图失败和引用不落 SHEIN 是高风险 |
| 标题与 AI | SHEIN 标题上限 250；草稿内部名称独立限制；前缀+AI 图案短命名+后缀；AI URL/模型由管理员设置；只给授权成员显示/调用；批量与单品一致 | `server/cloud/ai-title-*`、`src-v2/features/drafts/`、`NEXUS-AI-FAST-01` | AI 失败/慢不能阻塞普通建品；错误和权限原因需可见 |
| 合规工作台 | 只呈现 SHEIN 对当前 SKU/SKC 实际必填字段；1630/1631 由 SHEIN 返回后显示并提供报告上传；合规不擅自替代审核状态；主图缩略图恢复 | `server/shein-compliance.js`、`src-v2/features/compliance/`、`COMPLIANCE_*` | 官方报告待回读与本地快照不同步；单品打不开、列布局和阻断需回归 |
| 商品审核中心 | 待审核→待核价→待寄样→待审版→待核样→待终审→已通过/上架；任意阶段可驳回；已驳回单个/多选重发、驳回原因、归档；每个 SKC 任务 ID、发起/驳回次数和时间线 | `server/cloud/product-review-*`、`src-v2/features/publishing/` | 生产曾出现双勾选框、驳回留在列表、待终审丢失、分类慢 |
| 发布与幂等 | 发布阶段可见；请求超时显示“结果待确认”；禁止运行中重复入队；SHEIN 失败码与批次/job/readback 一致；额度按店铺回读并扣减 | `server/cloud/product-publish-worker.js`、`publish-execution-repository.js`、`PublishBatchesPage.tsx` | 当前线上代码/镜像与本地不一致，且曾出现 20100 终态投影未更新 |
| 模板中心 | 标题/属性/尺寸/包装/图片/合规模板版本化；管理员模板可跨店共享但用户不可改原件；店铺/个人模板隔离；使用前校验结构 | `src-v2/features/templates/`、`server/cloud/template-*` | 旧模板字段缺失、多色、局部重新引用需确保替换和版本快照 |
| UI 与体验 | 统一 SHEIN 外壳、状态、表格、抽屉、上传、空/错/缓存/权限态；1280px 不横溢；主图缩略、放大；字体不能挤压 | `src-v2/styles/app.css`、shadcn/Radix 设计令牌、`NEXUS_EVO_09` | 生产截图显示合规表格重叠；必须做浏览器视觉回归 |
| 刷新/缓存/同步 | 手动刷新；缓存 key 含 tenant/user/store/module/query；任务期间轻量状态；页面离开取消监听；SHEIN 读超时不改变业务状态 | `src-v2/app/query-client.ts`、`server/cloud/*refresh*`、SRF-01～10 | 59 秒倒计时卡住、服务不可用后恢复、认证缓存串联，必须查任务和镜像 |

---

## 18. 线上排障与恢复 Runbook（只读优先）

### 18.1 先确认版本和健康度

```bash
curl -fsS https://api.hanzhou.icu/health
curl -fsS https://api.hanzhou.icu/ready
docker compose -f /opt/shein-console/current/deploy/docker-compose.cloud.yml ps
docker images --format '{{.Repository}} {{.Tag}} {{.CreatedAt}}' | rg 'shein|console'
```

若 `/health` 正常但页面异常，不要直接重启全套服务；先比较 control/UI/worker 镜像创建时间、Git/SHA 和 release manifest。

### 18.2 发布/审核状态问题

1. 记录当前用户、tenant、store、页面筛选、SKC、批次 ID、job ID 和页面时间。
2. 只读查询 `publish_batches`、`publish_batch_items`、`publish_jobs`、`publish_execution_runs`，比较 job 终态、批次投影和 `readback`。
3. 检查 Redis `shein-product-publish` 的 wait/active/delayed/failed 数量、worker lock 和日志。
4. 对 SHEIN 只执行明确授权的状态读取；不能用“请求失败”推断“发布失败”，也不能用本地状态覆盖官方状态。
5. 若 job 已 `failed_terminal`，必须将 batch item 从 `ready` 修正为真实失败终态；若请求结果未知，保持“结果待确认”，禁止再次自动发布。
6. 若重新发起后 SHEIN 已变为待审核，页面必须从“已驳回当前视图”移除，历史时间线保留旧驳回；不得只依赖浏览器刷新。

### 18.3 同步/刷新问题

- 校验任务是否真的入队、是否被 worker 消费、是否完成并写快照；队列为空不代表历史 stale run 已收尾。
- 校验 retryAfter、冷却窗口、认证作用域和 cache key；不同店铺/用户不能共享状态。
- 服务不可用时保留上次数据并显示缓存时间；恢复后由用户手动刷新，禁止整站轮询。
- 对图片使用稳定媒体 ID/对象存储 URL 和有界 TTL；页面切换不重复下载同一资源，失败缩略图可重试。

### 18.4 安全恢复边界

- 任何写操作（发布、合规提交、模板写入、数据库修复、迁移、重启、清队列）都要先确认目标和授权。
- 不删除 job、审计、失败回执来“清屏”；不手工把状态改成成功。
- 先导出证据和备份，再做最小范围修复；修复后跑定向测试、构建、release audit，再灰度切换。
- 回滚只切换到已验证的上一 release，不回滚数据库结构；迁移必须前向兼容。

---

## 19. 交接完整性清单

新对话开始时按下列顺序确认，任何一项缺证据都标记为“待核验”，不能沿用“历史已部署”结论：

- [ ] 读取本文件全文及第 14 节列出的必读资料。
- [ ] 运行 `rg --files docs/shein-api-raw | sort`，确认原始 API 文件数量和新增文件。
- [ ] 查看 `git status --short`，保留用户未提交文件，不 reset、不清理未知文件。
- [ ] 核对 `package.json`、`tsconfig.v2.json`、`vite.config.*`、Docker Compose 与当前入口。
- [ ] 运行 `npm test`、`npm run build:v2`、`npm run release:audit:v2`、`git diff --check`。
- [ ] 做一次生产只读 health/ready、容器、队列、DB projection 和 worker 日志核对。
- [ ] 重点验证双勾选框、审核分类、驳回重发移除、待终审、合规 1630/1631、图片缩略/缓存、切店权限、额度和手动刷新。
- [ ] 只有用户明确要求部署且门禁通过后，才生成 release、校验 SHA、原子切换并做线上回读。
- [ ] 每个修复追加第 15 节格式的变更记录，包含“仍未解决”和回滚 release。

### 19.1 当前不可省略的 P0 复核项

1. 商品审核中心出现两个相邻勾选框的线上回归。
2. 重新发起后已驳回视图未移除、官方待审核/待终审分类不准。
3. 发布 worker 失败终态未同步到批次投影；SHEIN 20100 配额/保证金限制需正确呈现。
4. 部分线上 worker 镜像不是当前本地代码，需重新发布并核对 created/start 时间。
5. 合规单品打开、主图缩略、官方必填和 1630/1631 回读/上传链路。
6. 认证、店铺、用户和模板缓存的隔离及手动刷新行为。

本交接文件的版本日期为 2026-08-28；若新对话发现事实变化，以最新只读证据和 SHEIN 官方回读为准，并在第 15 节追加变更，而不是覆盖历史记录。

## 20. 2026-08-28 发布状态优先级与今日提交口径修复（云端待部署）

本轮根据用户反馈“已发布一批 SKC，但 SHEIN 后台没有，网页却显示已提交、审核中”完成本地全站同类问题审计和最小修复；尚未切换云端：

- 用户症状：发布中心在发布任务已进入 `failed_terminal` / `failed_retryable` 时，可能仍被工作流阶段或待核价条件覆盖为“审核中/待核价”；发布进度也可能只读批次 item 的旧 `ready` 投影，把终态失败计入“已提交”。
- 事实证据：2026-08-28 线上只读首页入口哈希为 `11cd5cec47ae733d4fb30609268ad48b4ac7fa7511251b01eaf4736423942575`；线上 `PublishBatchesPage-aU-p4j-X.js` 仍存在工作流阶段先于失败状态的旧渲染顺序，线上 `TodayWorkPage-Cuu92TYG.js` 仍显示“今日上新”。公网 `/health` 返回成功，但网页域名 22 端口 SSH 检查超时；交接资料未提供源站地址/账号。
- 根因层级：V2 UI 状态优先级与批次进度投影读取；不是本轮新增 SHEIN API 签名或写接口问题。服务端 `recordExecutionFailure` 已有事务同步 `publish_jobs` 与批次投影的逻辑，但旧线上静态 bundle 仍可掩盖该事实。
- 允许修改文件：`src-v2/features/publishing/PublishBatchesPage.tsx`、`src-v2/features/overview/TodayWorkPage.tsx`、对应 UI 回归测试；不修改 SHEIN 写接口、数据库迁移或生产数据。
- 失败回归测试：新增“终态发布失败不能被工作流/核价标签覆盖”和“发布进度读取回读终态”断言；新增“今日工作显示今日提交而非今日上新”断言。新增回归先失败，修复后通过。
- 实现摘要：终态发布失败优先于工作流/审核阶段；核价覆盖只允许发生在实际“审核通过”状态；审核筛选和外部审核行复用已解析状态；发布进度以回读 jobState 覆盖过期批次 item；今日工作保留兼容字段但改为准确显示“今日提交”。
- SHEIN 写接口是否调用：否。
- 数据库迁移：无。
- 测试：定向 UI `23/23`；项目全量 `npm test` `1109/1109`；`npm run build:v2` 通过；`npm run build:web` 通过后已将同一份 V2 构建同步到 `dist-web`；`dist-v2` 与 `dist-web` 静态 `release:audit:v2` 均为 `READY`、14/14、无 blocker；`git diff --check` 通过。
- 部署包与 SHA：`shein-cloud-deploy-20260828-status-precedence-v1.tar.gz`；SHA-256 `6d325d954fd1bbd659789b7921733adce8f9c6bff7390bcfb2be5ca526c80c30`。候选本地首页 `dist-v2/index.html` 与 `dist-web/index.html` 哈希均为 `c9309d414934d0824a492292f6ae54b45b06f42bfb4285152f854b67d5e467c8`。
- 切换的服务：无。云端上传/原子切换尚未执行；未重启 control、Worker、PostgreSQL 或 Redis。
- 部署后 health/ready/公网/Worker/DB 回读：仅完成公网只读核对；`https://api.hanzhou.icu/health` 返回 `{"ok":true,"service":"shein-cloud-control"}`，公网首页返回 200 但仍是旧入口哈希；未执行云端候选 release、容器、Worker、DB projection 回读。
- 回滚 release：未切换，因此保持现网 release 不变；完成部署前不得填写新的回滚点。
- 仍未解决：缺少可达的云服务器源站 SSH/上传通道。`app.hanzhou.icu` 解析到 Cloudflare 地址，不能把 Cloudflare 代理地址当作源站部署地址。下一步需提供现有部署用的 SSH 主机/端口/账号，或在受控部署工具中开放同一目标；拿到后先上传候选、做云端静态门禁，再原子切换并核验 control/Worker/DB/readback。

## 21. 2026-08-28 NEXUS-AI-FAST-01-A2“图片复用与性能优化”（本地完成，待部署）

本轮继续执行 AI 标题方案 A2；未执行云端部署、SHEIN 写操作、数据库迁移或生产数据修改：

- 根因：AI 标题服务此前只缓存完整标题请求结果。缓存键包含当前标题、标题模板等上下文，同一主图在不同商品或不同标题请求下仍会重复从对象存储读取，并重复转换为 base64 发给模型。
- 实现：在 `server/cloud/ai-title-service.js` 增加 tenant/store/asset 作用域的图片字节短缓存和并发读取去重；默认 TTL 5 分钟、最多 64 张、最多 16MB，采用 LRU 淘汰；超出容量的图片不缓存。缓存只复用已通过媒体服务校验的图片字节，不改变标题结果缓存、成员授权、模型并发上限或发布流程。
- 隔离与失败边界：不同店铺不共用图片缓存；对象存储读取失败只释放 in-flight 记录，不写入缓存；缓存命中诊断区分 `memory` 与 `inflight`，不记录密钥、图片内容或业务标题。
- 回归：新增同图跨不同标题请求只读取一次、后续命中内存缓存、不同店铺隔离、失败读取不缓存的服务测试；新增 A2 有界缓存/作用域/可观测性的 V2 UI 静态回归。
- 测试与门禁：定向 AI 服务 10/10、AI UI 8/8；全量 `npm test` 1113/1113；`npm run build:v2` 通过；`npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"` 返回 `READY`、14/14 contracts、无 blocker；`git diff --check` 通过。
- A2 仍未覆盖：A3 并发调度尚未实施；不把多张不同主图合并为同一素材，不改变批量建品上传、标题模板组合、SHEIN 发布或审核状态口径。
- 云端状态：未切换 release，线上版本保持不变；本轮没有新的部署包或回滚点。若后续明确要求部署，仍需先取得可达的源站 SSH/上传通道，完成候选包静态门禁、原子切换及 control/Worker/DB/readback 核验。

## 22. 2026-08-28 NEXUS-AI-FAST-01-A3“并发调度与快速生成”（本地完成，待部署）

本轮继续执行 AI 标题方案 A3；未执行云端部署、SHEIN 写操作、数据库迁移或生产数据修改：

- 用户目标：批量 AI 标题生成不能因逐条串行而过慢；服务达到并发上限时不能把容量内请求直接误判为忙碌，同时必须防止无界扩张。
- 根因：`WebAiTitleService.performSuggest` 原先在 `inflight >= maxConcurrent` 时立即返回 `AI_TITLE_BUSY`，且图片读取发生在并发槽位之外；`BatchProductCreatePage` 使用串行 `for...of` 逐个上传主图并调用 AI。
- 实现：服务端新增默认最多 8 个等待任务的有界 AI 队列；并发槽位在图片读取和模型调用前统一取得，释放后按先进先出唤醒等待者。超过 `maxConcurrent + maxQueue` 才返回 `AI_TITLE_BUSY`；并发硬上限为 8、队列硬上限为 64，新增 `queueWaitMs` 诊断，不记录密钥、图片内容或标题。
- 配置：新增 `SHEIN_TITLE_AI_MAX_QUEUE`，默认值为 8，并由 cloud control 注入服务；原有 `SHEIN_TITLE_AI_MAX_CONCURRENT` 默认值 2 保持不变。
- 缓存查漏：结果缓存不再把无关的当前标题作为 key，避免同图同模板重复调用模型；结果缓存最多 128 条并采用 LRU，管理员修改模型配置时清空旧结果，旧配置的在途结果不会重新写回缓存。
- 前端：批量建品使用最多 2 个 worker 并行生成，所有结果按原选择顺序汇总；单条失败不会阻塞其他商品，仍展示完成进度、成功数量和前 3 条失败原因。上传缓存与 A2 图片复用保持有效。
- 允许修改文件：`server/cloud/ai-title-service.js`、`server/cloud/ai-title-service.test.js`、`server/config.js`、`server/cloud/control-server.js`、`src-v2/features/publishing/BatchProductCreatePage.tsx`、`src-v2/lib/api.ts`、`server/cloud/v2-ai-title-ui.test.js`、本交接文档。
- 失败回归测试：新增“容量内请求进入有限队列并且 provider 并发不超过配置值”“超过有界队列才返回 AI_TITLE_BUSY”“同图当前标题变化复用结果”“结果缓存有界且配置变更失效”“并发/队列配置硬上限”服务回归；新增批量页面“2 worker 并行、Promise.all、可见进度”静态回归。修复前分别暴露直接 429、模型重复调用、缓存无界/不失效和配置可无限放大，修复后通过。
- SHEIN 写接口是否调用：否。
- 数据库迁移：无。
- 测试与门禁：定向 AI 服务、契约与 AI UI `29/29`；项目全量 `npm test` `1119/1119`；`npm run build:v2` 通过（Vite 1952 modules）；`npm run build:web` 仅生成旧 web 模式产物，未作为 V2 发布物使用；将通过门禁的 `dist-v2` 同步到 `dist-web` 后，`npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"` 与 `--web-root "$PWD/dist-web"` 均返回 `READY`、14/14 contracts、无 blocker。
- 部署包与 SHA：未生成；本轮未部署。
- 切换的服务：无。云端 control、Worker、PostgreSQL、Redis 均未重启或切换。
- 部署后 health/ready/公网/Worker/DB 回读：未执行；线上版本保持现状。
- 回滚 release：未切换，因此无新的回滚点。
- 仍未解决：云端候选尚未发布；若后续明确要求部署，仍需取得可达源站 SSH/上传通道，并在部署后验证 control/Worker 同版本、队列积压、AI 诊断和网页真实 bundle。

## 23. 2026-08-28 全站板块复核与云端版本漂移复核（本地门禁通过，云端待授权上传）

本轮继续对 V2 已暴露页面、路由、演示 API 和云端运行状态做全站复核；没有调用 SHEIN 写接口，没有执行数据库写入、迁移、清队列或生产状态修复：

- 本地浏览器逐一验收 5 个认证页和 18 个已暴露业务板块：总览、今日工作、商品经营、商品审核中心、销量与库存、经营预警、同步任务、合规工作台、商品草稿、批量建品、新建商品、标题规则、商品属性、颜色与尺寸、打包体积、通用商品图片、合规实拍图、店铺管理、成员权限。页面标题、店铺作用域、空数据/未同步状态和错误边界均正常。
- 修复预览入口漂移：根目录 `dist/` 是旧生成产物，默认 `vite preview` 曾误加载它；`package.json` 现在将默认预览固定为 `dist-web`，并新增 `preview:v2` 指向 `dist-v2`。已将确认无运行时用途的旧 `dist/` 移至可恢复临时目录，未删除 `src/`、`server/` 或 `.data/`。
- 本地门禁：全量 `npm test` 通过 `1121/1121`；`npm run build:v2` 通过；`dist-v2/index.html` 与 `dist-web/index.html` SHA-256 均为 `723bd1d5057f3cc542268fb524f124616bf077f27f2345e91cdab8a526fe3b72`；`release:audit:v2` 为 `READY`、14/14 contracts、无 blocker。
- 云端只读状态：当前 release 仍为 `shein-cloud-deploy-20260827-srf-10-authenticated-cache-scope-v1`；control、PostgreSQL、Redis、各 Worker 容器运行中，control `/health` 与 `/ready` 正常，公网首页/health 返回 200；线上 `dist-v2`/`dist-web` 首页哈希仍为旧值 `11cd5cec47ae733d4fb30609268ad48b4ac7fa7511251b01eaf4736423942575`。
- 云端代码漂移：control 容器的 `server/cloud/ai-title-service.js`、`server/cloud/control-server.js`、`server/config.js` 与本地不一致；商品发布 Worker 创建于 `2026-08-25`，与本地有 22 个运行文件漂移，包含 `publish-execution-repository.js`、审核/合规/经营同步和 Webhook 相关模块。其他同步 Worker 抽查的关键文件与本地一致，仍需在候选发布后完成全服务同版本核验。
- 云端数据证据：`publish_jobs` 中 `failed_terminal` 84 条，其中 82 条对应 `publish_batch_items.state=ready`、2 条为 `failed`；`publish_execution_runs` 有 17 条 `completed_at IS NULL`（10 条 failed、7 条 running）；`submitted` 任务 49 条均缺少 `shein_document_sn`，Redis 发布队列当前无 wait/active/delayed/failed 积压。以上是历史投影/执行记录问题，不直接删除、不手工改成功。
- 功能缺口分类：`V2_PAGE_MAP.md` 中的销量趋势、更多经营预警类型以及创意/集成/用量路线页当前未暴露；现有真实接口与历史序列数据不足，不能用本地推算或假数据补齐，暂列后续需求而非本轮擅自扩展。
- 候选发布：本地已生成不含 `.env`、`.data`、`.git`、`node_modules` 和历史压缩包的候选包 `/private/tmp/shein-cloud-deploy-20260828-full-board-v1.tar.gz`，SHA-256 为 `414a528b43f5c6f2ee17912159d0e8f76e9a354c75dd604da0b62b9d529452a6`。上传到 `42.193.179.216` 被安全策略要求对具体敏感 payload 再确认；在获得确认前不上传、不解包、不切换、不重启。
- 仍未解决：需先获得用户对该候选包及目标主机的明确上传确认；部署后还必须重建 control 与商品发布 Worker，验证投影修复只影响真实失败任务，并对历史 `failed_terminal`/未结束 run 走备份、只读报告和受控修复流程，不能把“网页健康”当成 SHEIN 已接收。

## 24. 2026-08-28 全站复核候选已部署（历史发布投影待受控修复）

用户已明确确认上传指定候选包和目标主机；本节记录实际部署后的只读证据：

- 候选包：`/private/tmp/shein-cloud-deploy-20260828-full-board-v1.tar.gz`；SHA-256 `414a528b43f5c6f2ee17912159d0e8f76e9a354c75dd604da0b62b9d529452a6`。远端校验一致；候选目录为 `/opt/shein-console/releases/shein-cloud-deploy-20260828-full-board-v1`。
- 原子切换：`/opt/shein-console/current` 已指向上述 release。仅重建 `control` 与 `product-publish-worker`，PostgreSQL、Redis 及其他同步/清理/Webhook 服务未重启；旧 release 保留，可回滚到 `shein-cloud-deploy-20260827-srf-10-authenticated-cache-scope-v1`。
- 云端候选静态门禁：`release:audit:v2 --static-only` 返回 `READY`、14/14 contracts、无 blocker；候选 compose 配置通过；control 与商品发布 Worker 镜像均成功构建。
- 线上服务回读：control 与商品发布 Worker 均已在切换后创建并启动；全量 10 个容器为 running，control 健康状态 healthy。公网 `https://app.hanzhou.icu/` 返回当前 V2 HTML，`https://api.hanzhou.icu/health` 返回 `{"ok":true,"service":"shein-cloud-control"}`；公网 favicon 返回 200。
- 代码一致性：公网 `dist-v2/index.html` 与 `dist-web/index.html` 均为 `723bd1d5057f3cc542268fb524f124616bf077f27f2345e91cdab8a526fe3b72`；云端 control 的 AI 标题/控制服务/配置哈希与候选一致，商品发布 Worker 的发布执行仓储/审核服务哈希与候选一致。
- 队列回读：`shein-product-publish` 的 wait、active、delayed、failed 均为 0；没有发现发布队列积压。
- 数据库只读回读：`publish_jobs` 为 `failed_terminal=84`、`submitted=49`；`publish_batch_items` 为 `ready=138`、`failed=7`；`publish_execution_runs` 为 `failed=10`、`running=7`。部署未执行数据库写入、迁移、删除、清队列或状态覆盖，历史投影数量保持原样。
- SHEIN 写接口与授权：本轮未调用 SHEIN 写接口，未消费发布授权；因此“网页已部署”不等于历史 49 条 `submitted` 已被 SHEIN 接收，也不等于历史 82 条失败终态投影已经修复。
- 仍未解决且不得自动处理：历史 `failed_terminal` 对应的 `ready` 批次投影、未结束 execution run，以及缺少 `shein_document_sn` 的提交记录，必须先按交接第 18 节导出证据、备份并生成受控修复报告，再由用户明确确认具体范围后执行；结果未知的 SHEIN 发布禁止自动重试。
- 本轮交付门禁：本地全量 `npm test` 为 `1121/1121`；V2 构建通过；本地与云端候选静态门禁通过；浏览器已逐一验收 5 个认证页和 18 个已暴露业务板块，未见错误边界、错误门店作用域或异常空态。

## 25. 2026-08-28“网页已发布但 SHEIN 无商品”状态语义修复（本地完成，待部署）

针对用户反馈“网页显示已发布，但 SHEIN 后台没有商品”，本轮完成只读取证、最小修复和本地门禁：

- 线上证据：`publish_jobs` 当前为 `failed_terminal=84`、`submitted=49`，没有 `completed`；49 条 `submitted` 全部有 `submitted` 回执和审核 `version`，但 `shein_document_sn`、官方 `document-state` 回读均为空，批次 item 仍为 `ready`。这表示“发布请求已被服务接受、等待 SHEIN 审核/回读”，不能等同于“商品已发布/已上架”。SHEIN 官方资料也说明审核中或审核失败的商品不会出现在审核通过商品列表中。
- 根因：`src-v2/features/publishing/PublishBatchesPage.tsx` 的 `statusLabel` 原先允许旧的本地 `draft.status="published"` 覆盖当前 `submitted/result_unknown` 任务；合规实拍图失败文案也错误使用“商品已发布”。这会把未完成官方回读的记录显示成成功态。
- 修复：当前 `submitted/result_unknown` 优先显示“已提交，待回读”；`ready` 也显示“已提交，待回读”；只有 `publish_batch_items.state="completed"` 或 `readback.jobState="completed"` 才显示“已发布”；合规图片失败统一显示“商品提交已接受，但……”。同时保留兼容筛选标签，不改变 SHEIN API 请求、授权、队列或数据库语义。
- 回归测试：新增“提交中/结果未知不能被本地 published 覆盖”和“提交后合规图失败不得声称已发布”；定向发布相关测试 `73/73`；全量 `npm test` `1123/1123`；V2 构建通过；`dist-v2`/`dist-web` 均为同一首页哈希 `3fc89ea1cabc5c034b3100530d3fb23f032615cff5ca5c548ebf5874477bc303`；release audit `READY`、14/14、无 blocker。
- 生成物：已移除 `dist-web` 内残留的旧哈希 chunk，仅保留本次构建产物；旧生成目录已可恢复保存在 `/private/tmp/shein-dist-web-before-publish-state-fix-20260828`。
- SHEIN/数据库操作：本轮未重发任何历史 SKC，未调用 SHEIN 写接口，未执行数据库写入、迁移、删除、清队列或状态覆盖。线上上一版 release 保持不变。
- 仍未解决：49 条历史 `submitted` 记录是否真正进入 SHEIN 审核，必须用对应 `version + SPU` 执行官方只读 `query-document-state`，或等待/核对官方审核回执；缺少回读的记录禁止自动重试。新代码需用户明确确认后，才上传候选包、原子切换并做线上回读。

## 26. 2026-08-28“网页已发布但 SHEIN 无商品”状态语义修复（已部署）

用户已确认部署。本轮只部署第 25 节已完成的状态语义修复，AI 标题问题仍保持未修复、未扩大部署范围：

- 本地门禁：`npm test` `1123/1123`；`npm run build:v2` 通过；`dist-v2` 与 `dist-web` 一致；候选 `release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"` 为 `READY`、14/14、无 blocker。
- 部署包与 SHA-256：`shein-cloud-deploy-20260828-status-precedence-v2.tar.gz`；`b4c69e14df208d005cee99be27ac4b5c26076ed931c33df1e49f4d69ed94346e`。远端上传后 SHA-256 一致；候选目录 `/opt/shein-console/releases/shein-cloud-deploy-20260828-status-precedence-v2`。
- 云端候选门禁：使用只读挂载执行静态 `release:audit:v2`，返回 `READY`、14/14、无 blocker；候选 control 与 product-publish-worker 镜像构建成功；发布开关仍为关闭状态。
- 原子切换：`/opt/shein-console/current` 已切换至 `shein-cloud-deploy-20260828-status-precedence-v2`；回滚 release 保留为 `shein-cloud-deploy-20260828-full-board-v1`。仅重建 `control` 与 `product-publish-worker`，未重启 PostgreSQL、Redis、合规/经营/规则/Webhook/媒体 Worker。
- 部署后验证：内部 `/health=200`、`/ready=200`；公网 `https://api.hanzhou.icu/health=200`；公网首页 `=200` 并加载新入口；`control=healthy`，`product-publish-worker` 已运行。
- SHEIN 写接口/数据库：未调用 SHEIN 商品或合规写接口，未消费发布授权；未执行迁移、数据库写入、删除、清队列或历史状态覆盖。
- AI 标题边界：`server/cloud/ai-title-service.js` 与 `BatchProductCreatePage.tsx` 指纹与线上当前版本一致；截图中的 `AI_TITLE_PROVIDER_FAILED` 未在本轮修复，后续继续按“先分析、后授权修复”的流程处理。
- 仍未解决：历史 `submitted`/`failed_terminal` 的 SHEIN 官方回读与旧投影仍需按第 18 节做只读核对和受控修复，不能因本次状态文案修复而视为商品已进入 SHEIN。

## 27. 2026-08-28 商品发布 Worker 42P18 收口修复（已部署）

针对用户刚刚发布两件商品后云端任务停在“提交中/已提交待回读”、SHEIN 后台没有商品的问题，完成了数据库参数错位修复并部署：

- 线上证据：北京时间 10:00:35 和 10:07:15 的两条 `publish_jobs` 被 Worker 领取后，分别在 10:00:36 和 10:07:16 触发 PostgreSQL `42P18`；PostgreSQL 记录的失败 SQL 为 `recordExecutionFailure` 中的 `UPDATE publish_batches`。
- 根因：`server/cloud/publish-execution-repository.js` 的批次投影更新 SQL 传入了未使用的 `$2`（`batchItemId`），实际占位符跳过 `$2` 使用 `$3` 至 `$7`，PostgreSQL 无法确定参数 `$2` 类型，事务回滚，导致 job 保留为过期 `claimed`、批次/条目保留为 `ready`、执行 run 保留为 `running`。
- 修复：将批次更新 SQL 参数改为连续 `$1` 至 `$6`，移除未使用参数；新增回归断言校验参数编号连续且与 values 数量一致。
- 回归与门禁：发布仓储/Worker 定向测试 `24/24`；项目全量 `npm test` `1123/1123`；`npm run build:v2` 通过；`release:audit:v2` 为 `READY`、14/14、无 blocker；`dist-v2` 与 `dist-web` 首页哈希一致。
- 部署包与 SHA-256：`shein-cloud-deploy-20260828-publish-repository-fix-v1.tar.gz`；`b0a042403f55a3fff74793d0a5fc43e530dcf30745012a49e4f43e737ffe4c83`。云端候选静态审计通过，候选 control 与 product-publish-worker 镜像构建成功。
- 原子切换：`/opt/shein-console/current` 已切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260828-publish-repository-fix-v1`；回滚 release 保留为 `shein-cloud-deploy-20260828-status-precedence-v2`。仅重建 control 与 product-publish-worker，PostgreSQL、Redis 及其他 Worker 未重启。
- 部署后验证：control `/health=200`、`/ready=200`，公网 API health=200，公网首页=200；control healthy，商品发布 Worker ready、并发 1；Redis 发布队列 wait/active/delayed/failed 均为 0；线上 Worker 修复文件 SHA 与候选一致。
- 历史数据边界：没有执行数据库迁移、没有清理或覆盖历史 job/run、没有消费旧授权、没有重发这两件商品，也没有调用新的 SHEIN 写接口；两条旧的过期 `claimed` 任务仍保持原状，待后续按结果未知边界做官方只读核对和受控处理。
- 仍未解决：本次只修复 Worker 数据库收口错误，不代表这两次旧请求已被 SHEIN 接收；下一次真实发布前应先核对旧请求的官方状态，随后用单商品做受控验收。

## 28. 2026-08-28 草稿提交前预检与审核分类复发修复（已部署）

针对“草稿内容已填写但进入审核中心提示需处理”以及“官方驳回仍显示已提交/待审核、待核价等分类混淆”的复发问题，按交接文档和开源方案的权威状态、实时预检、回归优先原则完成修复并部署：

- 草稿交接：选中草稿进入审核中心前，强制调用服务端实时预检并重新读取草稿；不再只信任浏览器缓存或旧 `status`。服务端支持显式强制重验，但真实阻塞项仍保持阻塞，不会被强制标记为可发布。
- 审核状态：官方 `audit_state=3/failed` 优先于本地 `submitted/result_unknown`；补齐待核价、待寄样、待审版、待核样、待终审到对应筛选分类；官方事件时间为空时，使用可用的状态观测时间，避免错误隐藏当前驳回。
- 允许修改文件：`server/cloud/product-draft-service.js`、`server/cloud/control-server.js`、`server/cloud/product-review-service.js`、`src-v2/lib/api.ts`、`src-v2/features/publishing/ProductDraftsPage.tsx`、`src-v2/features/publishing/PublishBatchesPage.tsx` 及对应回归测试。
- 本地门禁：定向回归 `118/118`；全量 `npm test` `1126/1126`；`npm run build:v2` 通过；`dist-v2` 与 `dist-web` 首页 SHA-256 均为 `b71a015c74ac69291f24b8dc97b258461c07d130dbdb3af0c1535bb04399bae8`；两份静态 `release:audit:v2` 均为 `READY`、14/14、无 blocker；`git diff --check` 通过。
- 部署包与 SHA-256：`shein-cloud-deploy-20260828-review-preflight-classification-v1.tar.gz`；`926c8ad42cca617aebba1a39406a76c2fd2cc5aef7652d7a024d464d427e0d58`。
- 云端候选审计：只读挂载候选目录执行 `release:audit:v2 --static-only`，返回 `READY`、14/14、无 blocker；候选 control 与商品发布 Worker 镜像构建成功。
- 原子切换：`/opt/shein-console/current` 已切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260828-review-preflight-classification-v1`；回滚 release 保留为 `shein-cloud-deploy-20260828-publish-repository-fix-v1`。仅重建 control 与商品发布 Worker，PostgreSQL、Redis 及其他 Worker 未重启。
- 部署后核验：control `/health=200`、`/ready=200`；control healthy；商品发布 Worker running 且输出 ready；control/Worker 审核服务哈希均为 `7af3cabb3bc0567a0d6eb707e05ae311b5e29124903ee000461b25faa0ba596b`；云端 `dist-v2` 与 `dist-web` 首页哈希与本地一致；发布队列 wait/active/delayed/failed 均为 0。
- SHEIN/数据库边界：本轮未调用 SHEIN 商品或合规写接口，未消费发布授权，未执行数据库迁移、历史数据覆盖、清队列或自动重发；历史 `submitted/failed_terminal` 是否被 SHEIN 接收仍需按版本 + SPU 做官方只读回读，不能由本次页面分类修复推断。

## 29. 2026-08-28 手动刷新审核状态失败与空回读韧性修复（已部署）

针对“发布后点击手动刷新先提示请求失败，请稍后重试”的问题，按审核回读链路做了最小闭环修复：

- 根因：刷新前使用旧的批次/审核缓存构造 SHEIN 回读目标；回读批次筛选漏掉 `submitted` 和 `result_unknown`；单个 SHEIN 回读失败会把整次刷新判为失败；官方合法空结果被后端当成异常并返回 500，前端最终只显示通用失败提示。
- 修复：手动刷新先重新读取草稿、发布批次和审核基础数据，再对所有最新可回读批次按每批 5 个并发读取本地回执；纳入 `submitted/result_unknown`；SHEIN 官方空记录返回明确的 `empty` 结果，不写入伪造状态；单项失败保留成功结果，并展示上游错误码、消息和 trace；页面挂载的自动回读查询仍限制为 20 个，避免常驻请求无限扩大。
- 数据边界：未清理历史任务、回执、队列或数据库记录；未调用 SHEIN 商品发布写接口，未重发任何商品；合法空结果不再写入假审核状态，未知结果仍保持未知。
- 本地门禁：专项回归 `60/60`；全量 `npm test` `1130/1130`；`npm run build:v2` 通过；`npm run release:audit:v2` 返回 `READY`、14/14 contracts、无 blocker。
- 候选包与 SHA-256：`shein-cloud-deploy-20260828-manual-review-refresh-resilience-v1.tar.gz`；`22cddb5740a4790e04f9ef5c8f5f2fb2fbf25dc15aa55cf1b74bcd310b883566`。
- 原子切换：`/opt/shein-console/current` 已切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260828-manual-review-refresh-resilience-v1`；之前的 release 保留，可回滚；只重建 control，未重启 PostgreSQL、Redis 或其他同步/Webhook/媒体 Worker。
- 发布安全边界：部署前发现共享配置及实际 control/商品发布 Worker 曾加载 `SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED=true`。本次按用户确认将共享配置改为 `false`，重建 control，并停止商品发布 Worker；历史 `.env` 保留为 `/opt/shein-console/shared/.env.backup-20260828-manual-review-refresh`，没有删除数据。
- 部署后核验：control healthy；内部 `/health=200`、`/ready=200`；公网 API health 返回 `{"ok":true,"service":"shein-cloud-control"}`；公网首页返回 200，首页哈希与候选 release 均为 `c17ac376c694a4bf696653e7b4b1db1c1948a998b2586c643ec06472e36aa927`；control 实际加载发布开关为 `false`，product-publish-worker 为 stopped；四个受影响源文件云端 SHA 与本地候选一致。
- 仍需注意：本次修复解决的是“刷新失败/状态回读与展示边界”，不等于历史 `submitted` 已被 SHEIN 接收；历史记录仍必须按版本 + SPU 执行官方只读回读，结果未知禁止自动重发。

## 30. 2026-08-28 额度预检绕过与本地发布失败分类修复（已部署）

针对“额度为 0 仍进入发布流程、SHEIN 返回 20100 后网页显示旧驳回/待发布，以及同一草稿的当前失败项无法正确归类”的问题，按开源方案的服务端权威预检、结果未知隔离和本地/官方状态分离原则完成最小修复并部署：

- 线上证据：最新批次的 10 个任务均返回 SHEIN `20100`“剩余可发品额度为0，禁止发品”；原直发路径却硬编码 `shelfQuota.availability="unlimited"`，绕过了真实额度预检，随后才在候选准备/提交边界失败。该批次没有 `shein_version`、`shein_document_sn` 或发布回执，不能视为已提交给 SHEIN。
- 根因一：`WebPublishBatchService.publishNow` 的直发路径使用伪造的 unlimited 预检结果，没有调用官方只读额度、权限和供应商 SKU 重复检查，因此额度为 0 时无法在提交前阻断。
- 根因二：发布页把当前批次失败项与旧的官方驳回审核记录叠加；失败 item 在部分草稿状态下还会落入“待发布”，旧驳回记录继续覆盖用户对当前尝试的判断。
- 修复：直发路径统一执行真实 `preflightPublish`，额度为 0 时记录真实预检结果、批次和条目失败状态，并在候选准备前结束，不进入 SHEIN 写队列；发布页将批次失败显示为“发布失败”，允许编辑后重试；新增“需处理”分类；当前草稿存在失败 item 或失败回读时，隐藏旧官方驳回覆盖行，保留当前失败身份和错误信息。
- 允许修改文件：`server/cloud/publish-batch-service.js`、`server/cloud/publish-batch-service.test.js`、`src-v2/features/publishing/PublishBatchesPage.tsx`、`server/cloud/v2-publish-batch-ui.test.js` 及本交接文档。未修改历史数据、数据库结构、队列内容或 SHEIN 发布执行开关。
- 回归与门禁：额度直发预检和 UI 状态分类回归先红后绿；定向发布/审核/预检测试 `81/81`；项目全量 `npm test` `1132/1132`；`npm run build:v2` 通过；`dist-v2` 同步到 `dist-web`；两份 `release:audit:v2 --static-only` 均返回 `READY`、14/14 contracts、无 blocker；`git diff --check` 通过。
- 部署包与 SHA-256：`shein-cloud-deploy-20260828-quota-status-separation-v1.tar.gz`；`b31f9da140ea9ee6b6507c4c12df762745c92103d6c858f6edb4bcfff33f5d48`。远端包校验一致；云端容器内只读静态门禁返回 `READY`、14/14、无 blocker。
- 原子切换：`/opt/shein-console/current` 已指向 `/opt/shein-console/releases/shein-cloud-deploy-20260828-quota-status-separation-v1`；回滚 release 保留为 `shein-cloud-deploy-20260828-manual-review-refresh-resilience-v1`。本轮仅重建 control，未启动或重建商品发布 Worker，PostgreSQL、Redis 和其他 Worker 未重启。
- 部署后核验：control 为 `healthy`；内部 `/health=200`、`/ready=200`；公网 `https://api.hanzhou.icu/health=200`、`https://app.hanzhou.icu/=200`；云端 `dist-v2/index.html` 与 `dist-web/index.html` SHA-256 均为 `bdf2f45e067325bc0d8bfe9801f228067d79475aada234e831f188e4584d0d0f`；修复源文件 SHA 与本地候选一致；`SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED=false`；`product-publish-worker` 保持 stopped。
- SHEIN/数据库边界：本轮没有调用 SHEIN 商品或合规写接口，没有消费发布授权，没有执行数据库迁移、写入、删除、清队列或历史状态覆盖。真实发布仍关闭；额度预检使用只读接口。
- 仍需注意：本次修复不推断“驳回重发一定免额度”，也不自动修改历史 `failed_terminal`、`submitted`、未结束 run 或旧审核记录；历史结果仍需按版本 + SPU 做官方只读回读，结果未知禁止自动重发。

## 31. 2026-08-28 审核中心“需处理/已驳回”顶部统计去重修复（已部署）

针对截图中“已驳回”页显示 9 条商品，同时顶部“需处理”也显示 9 的重复统计问题，完成最小 UI 口径修复并部署：

- 根因：顶部“需处理”统计直接使用 `externalReviews.filter(item => item.auditStateLabel === "failed")`；SHEIN 官方驳回记录也可能使用 `auditStateLabel="failed"`，因此被错误重复计入“需处理”。列表和 Tab 本身已经通过 `externalStatusLabel`/`workflowKeyFromLabel` 区分为“已驳回”，统计逻辑未复用同一映射。
- 修复：外部审核记录的“需处理”计数改为仅统计 `workflowKeyFromLabel(externalStatusLabel(item)) === "needs_action"`；官方“已驳回”继续只归入 `rejected`，不再同时进入 `needs_action`。未改变重新发起、归档、SHEIN 回读或发布逻辑。
- 回归：新增“rejected external reviews are not double-counted as needs action”回归；修复前测试先失败，修复后 UI 定向测试 `28/28`，全量 `npm test` `1133/1133`；`npm run build:v2` 通过；`dist-v2` 已同步 `dist-web`；两份 `release:audit:v2 --static-only` 均为 `READY`、14/14 contracts、无 blocker；`git diff --check` 通过。
- 部署包与 SHA-256：`shein-cloud-deploy-20260828-review-metric-separation-v1.tar.gz`；`fb216a3ec474e667f72685559f99466121e42bd6bf2871077c7327cc05769e46`。远端包校验一致，云端容器内只读静态门禁为 `READY`、14/14、无 blocker。
- 原子切换：`/opt/shein-console/current` 已指向 `/opt/shein-console/releases/shein-cloud-deploy-20260828-review-metric-separation-v1`；回滚 release 保留为 `shein-cloud-deploy-20260828-quota-status-separation-v1`。本轮仅重建 control，未启动或重建商品发布 Worker，PostgreSQL、Redis 和其他 Worker 未重启。
- 部署后核验：control 为 `healthy`；内部 `/health=200`、`/ready=200`；公网 API health=200，公网首页=200；线上 `dist-v2/index.html` 与 `dist-web/index.html` SHA-256 均为 `41a9c73fe60aa4eef29df0c190aeccbe064fbce6f9f0cd54733f80df8f4922cd`；线上修复文件 SHA 与本地一致；`SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED=false`；`product-publish-worker` 保持 stopped。
- SHEIN/数据库边界：本轮没有调用 SHEIN 商品或合规写接口，没有消费发布授权，没有执行数据库迁移、写入、删除、清队列或历史状态覆盖。

## 32. 2026-08-28 真实商品发布执行恢复启用（已开启）

用户明确要求恢复网站真实发品能力，本轮完成上线前门禁核验并开启 control 与商品发布 Worker：

- 开启前核验：第 034 号迁移 `034_publish_execution_enablement.sql` 已记录；`publish_execution_runs` 已存在 `publish_execution_runs_execution_flags_consistent` 与 `publish_execution_runs_execution_flags_state` 两个数据库约束；runtime 数据库只读角色审计通过 50 项。
- 历史任务边界：开启前 Redis `shein-product-publish` 的 wait、active、delayed、failed 均为 0；数据库中已有 2 条历史 `claimed` 和 11 条未结束 run，但本轮未修改、未清理、未重试，Worker 启动后没有自动领取历史任务。
- 配置变更：云端 `/opt/shein-console/shared/.env` 的 `SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED` 已由 `false` 改为 `true`；变更前配置备份为 `/opt/shein-console/shared/.env.backup-20260828-enable-publish`，权限保持受控。control 与 Worker 使用同一开关。
- 服务状态：`deploy-control-1` 为 `healthy`；`deploy-product-publish-worker-1` 为 `running`，启动日志显示 `queue=shein-product-publish`、`concurrency=1`、`executionPolicy=single-use-authorization-no-automatic-publish-retry`；control/Worker 均实际加载 `true`。
- 公网验收：内部 `/health=200`、`/ready=200`；公网 API health=200；公网网页=200；启用后队列 wait/active/delayed/failed 仍均为 0。
- 真实写入边界：开启只代表用户点击“发布/重新发起”后允许进入受控执行门禁；本轮没有发起商品发布、没有消费一次性授权、没有调用 SHEIN 商品或合规写接口，没有执行数据库迁移或历史数据修改。额度、权限、SKU 重复、幂等和结果未知保护保持有效。
- 应急回滚：如需临时关闭真实发布，先将共享配置恢复为 `false`，重建 control 并停止 `product-publish-worker`；不得删除历史任务、回执或执行记录。应用 release 仍为 `shein-cloud-deploy-20260828-review-metric-separation-v1`。

## 33. 2026-08-28 伪发布状态语义与结果未知隔离修复（本地完成，待部署）

针对“网页看起来已经发布，但 SHEIN 后台没有商品”的致命伪发布风险，本轮先基于线上证据完成最小修复和本地门禁；未部署、未写入 SHEIN、未修改历史数据：

- 当前批次证据：最新批次 `1b72982d-340d-440a-ac44-c84094f0b829` 的官方额度预检为 `totalQuota=15`、`usedCount=15`、`availableQuota=0`，服务端已在入队前以真实额度结果阻断；该批次没有 `publish_jobs`，因此没有进入 Redis Worker，也没有产生 SHEIN 商品发布写入。该次失败是额度阻断，不是新的官方驳回。
- 当前历史边界：线上 `publish_jobs` 聚合为 `claimed=2`、`failed_terminal=104`、`submitted=80`，没有 `completed`；80 条 `submitted` 有提交回执和 `shein_version`，但没有 `shein_document_sn`。这些记录不能推断为 SHEIN 已发布，历史 `claimed`、`submitted`、未结束 run 和结果未知记录本轮均未自动重试或覆盖。
- 根因：批次接口原先把“已接受入队”与“已被 SHEIN 接收/已发布”混为一个状态；前端又可能把本地旧 `published` 状态覆盖当前 `submitted/result_unknown`，并将未知网络结果压成提交成功，形成伪发布。
- 修复：服务端明确返回 `executionStage=queued`；前端将入队显示为“排队中，待发送 SHEIN”，只将带有有效完成态的本地/官方回读显示为“已发布”；提交后未完成回读显示“已提交，待回读”；网络/5xx 不确定结果显示“结果待确认”，不再自动归类为成功，也不允许因未知结果重复发布。发布进度将队列、SHEIN 已接收、结果待确认分开统计。
- 允许修改文件：`src-v2/features/publishing/PublishBatchesPage.tsx`、`src-v2/lib/api.ts`、`server/cloud/publish-batch-service.js` 及对应 UI/服务端回归测试。未修改配额策略、SHEIN 写接口、Worker 重试策略、数据库结构或历史数据。
- 回归与门禁：发布相关定向回归 `80/80`；项目全量 `npm test` `1134/1134`；`npm run build:v2` 通过；`npm run release:audit:v2 -- --static-only --root "$PWD" --web-root "$PWD/dist-web"` 返回 `READY`、14/14 contracts、无 blocker；`dist-v2/index.html` 与 `dist-web/index.html` SHA-256 均为 `15d04a65f2ecf2f80084f62b7e996c2d9a32c387bc88b5fc3c27e28c64457109`。
- 生成物：通过构建的 `dist-v2` 已同步至 Nginx 实际读取目录 `dist-web`，并确认新发布状态资源存在；本轮未清理旧生成文件，避免在未部署前扩大变更范围。
- 云端边界：本轮没有上传候选包、没有切换 release、没有重启 control/Worker，没有调用 SHEIN 商品或合规写接口，没有消费发布授权，没有数据库迁移、写入、删除、清队列或历史状态覆盖；云端当前版本和真实发布开关保持不变。
- 部署前仍需用户明确确认：应先生成候选包、执行候选静态/容器门禁，再原子切换并验证网页、control、Worker、Redis 队列和认证后的发布/回读路径。历史 `submitted` 缺少 `shein_document_sn` 的记录仍必须按 `shein_version + SPU` 做官方只读回读，结果未知禁止自动重发。

## 34. 2026-08-28 伪发布状态语义与结果未知隔离修复（已部署）

用户已确认部署。本轮仅部署第 33 节的前端状态语义与 control 服务修复：

- 候选包：`shein-cloud-deploy-20260828-pseudo-publish-result-separation-v1.tar.gz`；SHA-256 `17f3270a09663fec1fc783ca31eb2b4b0adef69f1ebf9fc9209adf8af172fb99`。远端候选包校验一致，候选静态审计和容器内审计均为 `READY`、14/14 contracts、无 blocker；control 镜像构建成功。
- 原子切换：`/opt/shein-console/current` 已切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260828-pseudo-publish-result-separation-v1`；上一 release `/opt/shein-console/releases/shein-cloud-deploy-20260828-review-metric-separation-v1` 保留，可回滚。未删除旧 release。
- 切换服务：仅重建 `deploy-control-1`；PostgreSQL、Redis、商品发布 Worker、经营/规则/合规/Webhook/媒体 Worker 均未重启。商品发布 Worker 继续运行原已验证版本，避免扩大本轮 owner 范围。
- 代码一致性：本地与云端 `dist-v2/index.html`、`dist-web/index.html` SHA-256 均为 `15d04a65f2ecf2f80084f62b7e996c2d9a32c387bc88b5fc3c27e28c64457109`；`PublishBatchesPage.tsx`、`api.ts`、`publish-batch-service.js` 的云端 SHA 与本地候选完全一致。
- 部署后核验：control 容器为 `healthy`；内部 `/health=200`、`/ready=200`，PostgreSQL/Redis 均为 `up`；公网 `https://api.hanzhou.icu/health=200`；公网首页=200，加载新入口 `assets/index-BmIs-m1Q.js` 和 `PublishBatchesPage-BQBxeml9.js`，新资源包含“排队中，待发送 SHEIN”“SHEIN已接收”“结果待确认”；favicon=200；未登录 `publish-now` 路由返回 401，路由存在且认证边界正常。
- 发布运行态：`SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED=true` 保持不变；商品发布 Worker 为 running；Redis `shein-product-publish` 的 wait/active/delayed/failed 均为 0；`publish_jobs` 只读聚合仍为 `claimed=2`、`failed_terminal=104`、`submitted=80`，没有因部署新增或重试历史任务。
- SHEIN 写接口与数据库：本轮未调用 SHEIN 商品/合规写接口，未消费发布授权，未执行数据库迁移、写入、删除、清队列或历史状态覆盖。
- 回滚：如发现异常，先切回 `/opt/shein-console/releases/shein-cloud-deploy-20260828-review-metric-separation-v1`，再按交接流程仅重建 control；不得清理历史任务或把结果未知改成成功。
- 仍需注意：本轮解决的是“网页误显示已发布/入队结果混淆”的伪发布风险，不会把没有 SHEIN 官方回执的历史 `submitted` 变成已发布。历史 80 条记录仍需按 `shein_version + SPU` 做官方只读回读；额度为 0 的新批次仍应在入队前阻断，驳回重发是否免额度不能凭经验推断。

## 35. 2026-08-28 第 14 步：全板块经营同步 owner 收敛（本地完成，未部署）

本轮针对“多个板块可能各自维护同步状态，导致总览、商品经营、销量库存、经营预警和审核中心显示不一致”的风险完成最小架构收敛；没有调用 SHEIN 写接口，没有执行数据库写入、迁移、清队列或云端切换：

- 用户症状：不同板块在同一店铺可能出现不同的经营快照、刷新任务和缓存更新时间；审核中心刷新还会直接另起经营刷新请求并同时 refetch 同一快照，存在竞态和重复请求风险。
- 事实证据（源码/测试）：总览页原先独立声明 `business-dashboard` 查询、手动刷新和任务轮询；商品经营、销量库存、预警、商品详情使用 `useBusinessDashboard`。审核中心原先独立声明同名经营查询，并在手动刷新中同时调用 `refreshBusinessDashboard` 和 `businessQuery.refetch()`。
- 根因层级：V2 client 查询 owner 与刷新生命周期分裂；不是 SHEIN 写接口或数据库结构问题。
- 允许修改文件：`src-v2/features/overview/OverviewPage.tsx`、`src-v2/features/publishing/PublishBatchesPage.tsx`、`src-v2/lib/hef-hst-hwf-cache-contract.test.js`、`server/cloud/srf-02-refresh-ui.test.js`、`server/cloud/v2-core-ui-system.test.js`、`server/cloud/v2-overview-ui.test.js`、`server/cloud/v2-business-dashboard-consistency-ui.test.js`。
- 失败回归测试：新增“总览和经营板块共享一个经营快照刷新 owner”“审核中心不再直接重复启动经营刷新或独立 refetch”；修复前先失败，修复后通过。同步更新原先要求总览自建轮询的过时契约，使测试改为锁定共享 hook owner。
- 实现摘要：总览与审核中心改用 `useBusinessDashboard`；经营刷新统一由该 hook 创建、缓存、跟踪 active job，并在终态用同一 query key 回读；审核中心手动刷新改为调用共享 mutation，移除重复的经营刷新请求和竞态 refetch；今日工作和审核中心的显式手动刷新边界保持不变，未强行改成全站轮询。
- SHEIN 写接口是否调用：否。
- 数据库迁移：无。
- 测试：经营/发布相关定向回归 `71/71`；项目全量 `npm test` `1154/1154`；`npm run build:v2` 通过；`dist-v2` 已同步至 `dist-web`，两份入口 SHA-256 均为 `3549a8f3674f08e4a9eec4496e68a3885b84a9d6a1d7a67da11be6311a2395f8`；两份 `release:audit:v2 --static-only` 均为 `READY`、14/14 contracts、无 blocker；`git diff --check` 通过。
- 部署包与 SHA：未生成；本轮未部署云端。
- 切换的服务：无；control、商品发布 Worker、PostgreSQL、Redis 和其他 Worker 均未重启。
- 部署后 health/ready/公网/Worker/DB 回读：未执行；云端版本、真实发布开关、历史任务和历史回执保持不变。
- 回滚 release：未切换，因此无新的回滚点；现网 release 保持不变。
- 仍未解决：本轮解决的是前端经营快照多 owner 和刷新竞态，不等于历史发布记录已经获得 SHEIN 官方回执；历史 `submitted`、`failed_terminal`、未结束 execution run 仍须按第 18 节做只读证据核对和受控修复。云端若要使用本轮产物，必须另行生成候选包并按部署门禁执行。

## 36. 2026-08-28 第 16 步：云端候选包与静态门禁（候选已生成，未部署）

本轮只生成可审计候选包并完成本地候选验收；没有上传、原子切换、重启服务、数据库写入/迁移、消费发布授权或调用 SHEIN 写接口：

- 候选包：`/private/tmp/shein-cloud-deploy-20260828-step16-candidate-v1.tar.gz`；SHA-256 `6ddb05425cc8e94ce83fb174b88479a4979c274e18d714ebdaeb13d41c2c8551`；归档 744 项，解包后 712 个文件，压缩包约 2.8 MB。
- 包内容：包含当前 control、商品发布 Worker、经营/规则/合规/Webhook/媒体 Worker、V2 前端、`dist-v2`、`dist-web`、全部发布审计 SQL/迁移与 Compose 文件；必需入口与审计文件逐项存在。
- 安全排除：候选包未包含 `.env`/`.env.*`、`.data`、`.git`、`node_modules`、历史 `*.tar.gz`、密钥/证书/数据库文件或 `.DS_Store`；未改变工作树中既有用户文件。
- 静态 release audit：候选 `dist-v2` 和 `dist-web` 分别执行 `npm run release:audit:v2 -- --root ... --web-root ...`，均返回 `READY`、23/23 迁移、14/14 release contracts、Web artifact passed、blocker=none；候选中 `executionEnabled=false`、`authorizesPublishing=false` 的安全边界仍完整。
- Web 一致性：候选 `dist-v2/index.html` 与 `dist-web/index.html` 字节一致，SHA-256 均为 `3549a8f3674f08e4a9eec4496e68a3885b84a9d6a1d7a67da11be6311a2395f8`。
- Compose 门禁：Ruby YAML 解析通过；12 个服务均存在，构建上下文/Dockerfile 路径存在，control `/ready` 健康探针存在，商品发布 Worker 仍隔离在 `publish` profile。当前机器未安装 Docker/Docker Compose，因此未执行镜像构建、Compose 实际 config/build 或容器内审计；该项不能标记为通过。
- 本地前置证据：第 14 步已完成定向回归 `71/71`、全量 `npm test` `1154/1154`、`npm run build:v2`、两套静态 `READY` 和 `git diff --check`；本轮打包后未修改源代码。
- 云端边界：未上传候选包、未切换 `/opt/shein-console/current`、未重启 control/Worker、未核对线上容器/数据库/readback；线上版本和真实发布开关保持原状。
- 仍未解决：第 15 步认证后网页回归仍因缺少用户手动登录而未完成；Docker 容器构建/候选云端门禁及线上发布、Worker、DB/readback 核验必须在取得部署通道和用户登录配合后进行。候选包通过静态门禁不等于已部署，也不等于历史商品已被 SHEIN 接收。

## 37. 2026-08-28 第 17 步：候选上传与远端门禁（通道阻塞，未上传）

本轮尝试进入候选上传阶段，但在任何外部写操作前完成了目标与通道核对；没有上传、切换 release、重启服务、执行迁移、访问生产数据库或调用 SHEIN 写接口：

- 待上传候选：`/private/tmp/shein-cloud-deploy-20260828-step16-candidate-v2.tar.gz`；SHA-256 `86fb55dd77d5f8b8253c5c008fdcdbc8c09217997aaf9639d7512c2b1723c33a`。第 16 步的候选解包和静态审计证据仍有效。
- 通道核对：仓库未提供可执行的 SSH/SCP/rsync 主机、端口、账号或部署脚本；当前环境没有 Docker/Docker Compose；环境中没有部署目标变量；Git remote 也未提供可直接作为云端部署入口的地址。
- 公网只读核对：当前命令环境解析 `app.hanzhou.icu`、`api.hanzhou.icu` 失败，未执行任何上传尝试；Cloudflare 代理/公网域名不能替代源站 SSH 通道。
- 远端门禁：未执行。原因是没有可达源站与受控认证，无法读取 `/opt/shein-console/current`、上传 `/opt/shein-console/releases/`、执行远端 `release:audit:v2` 或验证容器/Worker/数据库；不得用历史交接中的远端 release 记录代替本次事实。
- 部署边界：线上 release、control/Worker、PostgreSQL、Redis、真实发布开关和历史任务保持不变；没有任何生产状态变化。
- 继续条件：需要提供现有部署使用的源站 SSH 主机、端口、账号及受控密钥/部署工具，或在受控部署工具中开放同一目标。取得后必须先做远端只读基线，再上传候选并校验 SHA，远端静态/容器门禁通过后才能进入第 18 步原子切换。

## 38. 2026-08-28 第 18 步：原子切换 release 与服务一致性核验（前置条件未满足）

第 18 步未执行。根据部署门禁，候选必须先完成第 17 步远端上传和远端静态/容器审计，且取得当前 release、容器、Worker、数据库和备份基线后，才允许原子切换：

- 当前状态：候选仍只存在于本机 `/private/tmp/shein-cloud-deploy-20260828-step16-candidate-v2.tar.gz`，没有远端 release 目录；候选 SHA-256 为 `86fb55dd77d5f8b8253c5c008fdcdbc8c09217997aaf9639d7512c2b1723c33a`。
- 未执行事项：没有创建或切换 `/opt/shein-console/current`，没有重建/重启 control 或任何 Worker，没有修改 Nginx 静态目录，没有执行迁移、数据库写入、队列操作或 SHEIN 写接口。
- 一致性核验：无法在没有源站通道的情况下核对远端 release manifest、control/Worker image ID、容器创建/启动时间、实际配置、PostgreSQL/Redis 状态和回滚 release；历史交接数据不作为本次线上事实。
- 继续条件：第 17 步必须先提供受控源站 SSH/部署通道并通过远端候选门禁；之后先保留并记录现网回滚点，再只切换已验证候选，按 owner 仅更新相关服务，最后进入第 19 步线上健康/队列/数据库/readback 核验。

## 39. 2026-08-28 第 19 步：线上健康、队列、数据库与回读核验（前置条件未满足）

第 19 步未执行。该步骤必须在第 18 步完成候选 release 原子切换后，针对同一 release 做线上三方核验；当前不能以公网入口可达或历史记录替代：

- control：尚未核对候选 release 内部 `/health`、`/ready`、实际加载配置和代码/镜像 SHA。
- Worker/队列：尚未核对 control 与商品发布 Worker 是否同一候选版本、Worker healthy/ready、Redis `shein-product-publish` 的 wait/active/delayed/failed，以及 stale claim/lock。
- PostgreSQL/读模型：尚未核对 `publish_jobs`、`publish_batches`、`publish_batch_items`、`publish_execution_runs`、`publish_receipts` 与审核投影是否一致；没有执行写入、清队列、重试或历史状态覆盖。
- SHEIN 官方回读：尚未按 `shein_version + SPU` 对历史或新批次做官方只读回读；没有因网页状态推断商品已发布。
- 阻塞原因：第 17 步没有远端上传/门禁，第 18 步没有 release 切换；当前环境没有可达源站部署通道。
- 继续条件：先完成第 17、18 步，再按同一 release、同一服务版本、同一数据库/队列时间点逐项记录健康、队列、数据库和官方回读证据；任一层不一致即停止后续观察，不把页面成功状态当作 SHEIN 成功。

## 40. 2026-08-28 用户授权后部署通道复测（仍不可达）

用户已明确授权上传候选、切换 release，并在无异常后执行第 19 步；本轮按该授权进行了无副作用的 SSH 目标探测，但没有任何生产写操作：

- 候选包：`/private/tmp/shein-cloud-deploy-20260828-step16-candidate-v2.tar.gz`；SHA-256 `86fb55dd77d5f8b8253c5c008fdcdbc8c09217997aaf9639d7512c2b1723c33a`。
- 目标解析：本机 SSH 配置将 `app.hanzhou.icu` 解析为用户 `tianhanwen`、端口 `22`；未发现可直接使用的独立源站主机别名或部署脚本。
- 连接结果：使用 BatchMode、严格主机校验和超时保护探测 `app.hanzhou.icu:22`，连接超时；没有执行远程命令、上传文件或读取服务器数据。
- 第 17 步：未上传，远端静态/容器门禁未执行。
- 第 18 步：未切换 `/opt/shein-console/current`，未重建或重启 control/Worker，未改 Nginx、数据库、Redis 或真实发布开关。
- 第 19 步：未执行；没有把公网域名可达性或历史交接记录当作 control/Worker/Redis/PostgreSQL/SHEIN 官方回读证据。
- 继续条件：请提供现有部署使用的源站 SSH 主机、端口、账号及受控密钥/跳板机，或在受控部署工具中开放同一目标；拿到后从第 17 步重新开始，先只读识别主机与现网基线，再上传、校验 SHA、执行远端门禁、原子切换，最后执行第 19 步。

## 41. 2026-08-28 源站 IP 提供后 SSH 认证复测（认证阻塞）

用户提供源站实例截图和公网 IP `42.193.179.216`，并授权继续上传、切换和执行第 19 步。本轮仅做受控公钥认证探测，没有生产写操作：

- 目标：`42.193.179.216:22`，网络层可达。
- 认证结果：使用当前本机 SSH 配置依次探测 `tianhanwen`、`ubuntu`、`root`，均返回 `Permission denied (publickey,password)`；没有启用密码登录，没有读取或发送私钥，没有执行远程命令。
- 第 17–19 步：候选未上传，远端门禁未执行，release 未切换，服务/数据库/Redis/Nginx/真实发布开关未改变，第 19 步未执行。
- 安全边界：停止继续猜测账号或密钥，避免触发实例登录保护；不要求用户在对话中发送密码、私钥或 SHEIN 密钥。
- 继续条件：在云服务器控制台将当前 Mac 的对应公钥绑定到实例，或提供正确的 SSH 登录账号并在受控环境配置匹配密钥；认证成功后先执行只读远端基线，再按第 17 步上传并校验候选 SHA，门禁通过后进入第 18、19 步。

## 42. 2026-08-28 公钥写入后登录复测（仍未匹配部署密钥）

用户按引导在云端网页终端操作并提供截图；本轮再次使用两把本机密钥进行无副作用 SSH 登录测试，没有上传或执行部署：

- 云端用户：`ubuntu`；源站：`42.193.179.216:22`。
- 本机部署候选密钥指纹：`id_ed25519.pub` 为 `SHA256:xiVXPEbAcmEf1KidIJ2J4iu3yEDuOp0vC1i6gcRJ7Os`；`wow_deploy_ed25519.pub` 为 `SHA256:OmuHAGk8TVfKUgfVesw477pBwpG5O20Eb4kQ02FWzOI`。
- 登录结果：两把密钥均返回 `Permission denied (publickey,password)`。
- 截图证据：`cat >> ~/.ssh/authorized_keys` 之后没有显示 `ssh-ed25519` 公钥行；终端中出现的 `cat >> ...` 不是已写入的部署公钥。此前 `grep -c '^ssh-'` 返回 1，只能证明文件中存在一行以 `ssh-` 开头，不能证明是本机部署密钥。
- 第 17–19 步：候选未上传，远端门禁未执行，release 未切换，control/Worker/PostgreSQL/Redis/Nginx/真实发布开关未改变。
- 继续条件：把 `id_ed25519.pub` 与 `wow_deploy_ed25519.pub` 两行都追加到云端 `ubuntu` 的 `~/.ssh/authorized_keys`，再用 `ssh-keygen -lf ~/.ssh/authorized_keys` 对照上述指纹；匹配成功后才能继续部署。

## 43. 2026-08-28 第 17–18 步：候选上传、远端门禁与原子切换（已完成）

用户确认由本机继续上传、切换并在无异常后执行第 19 步；本轮通过 `ubuntu@42.193.179.216` 的受控密钥通道完成了候选部署。除部署所需的 release 文件上传、release 目录创建、control/商品发布 Worker 镜像构建与服务重建外，没有执行数据库迁移、历史数据修改、队列清理、自动重发或 SHEIN 商品写接口调用：

- 候选包：`/private/tmp/shein-cloud-deploy-20260828-step16-candidate-v2.tar.gz`；本机与远端校验 SHA-256 均为 `86fb55dd77d5f8b8253c5c008fdcdbc8c09217997aaf9639d7512c2b1723c33a`。
- 远端候选 release：`/opt/shein-console/releases/shein-cloud-deploy-20260828-step16-candidate-v2`；解包后未包含 `.env`、`.data`、`.git`、`node_modules`、历史归档、密钥/证书/数据库文件或 `.DS_Store`。解包时出现的 macOS `LIBARCHIVE.xattr.com.apple.*` 提示仅为扩展属性警告，不影响文件内容；候选包已删除远端临时上传文件。
- 候选远端静态/容器门禁：Compose 配置有效；候选 control 与商品发布 Worker 构建成功；候选容器内执行 `release:audit:v2 --static-only` 两次均为 `READY`，23/23 migrations、14/14 release contracts、Web artifact、DB objects、runtime role、runtime capability 全部通过，blocker=none。
- Web 产物：候选 `dist-v2` 与 `dist-web` SHA-256 均为 `3549a8f3674f08e4a9eec4496e68a3885b84a9d6a1d7a67da11be6311a2395f8`。
- 原子切换：`/opt/shein-console/current` 已切换到候选 release；切换前回滚点为 `/opt/shein-console/releases/shein-cloud-deploy-20260828-pseudo-publish-result-separation-v1`。没有删除回滚 release。
- 服务一致性：仅重建 `deploy-control-1` 与 `deploy-product-publish-worker-1`；PostgreSQL、Redis、Webhook、Webhook Worker、合规/媒体/规则/经营同步 Worker 未重启。候选 control 镜像为 `sha256:4115a73c12dec1b6395489fc7155c20b0c8e98af8b8dd6df68a97b6b0aa2f3fa`，候选商品发布 Worker 镜像为 `sha256:d340e13b9838e395687d470c69d4065a0e41d2da5fc067c4c151928425071935`。
- 线上真实执行开关：control 与商品发布 Worker 实际加载 `SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED=true`、`SHEIN_COMPLIANCE_WRITES_ENABLED=true`；本轮没有改动这些配置，也没有以“开关为 true”推断某个商品已被 SHEIN 接收。

## 44. 2026-08-28 第 19 步：线上健康通过，但历史发布数据核验发现闭环异常（未完成收口）

候选切换后已完成运行态和公网只读核验，但不能把第 19 步标记为“全部正常”，原因是生产数据库中存在历史发布记录闭环异常。该异常均发生在本次候选容器于北京时间约 17:28 启动之前；切换后没有观察到新的发布失败记录：

- control `/health` 与 `/ready` 均返回 HTTP 200；`ready` 显示 PostgreSQL、Redis 均为 `up`。公网 API、首页、favicon 均返回 HTTP 200。
- control 与商品发布 Worker 的源文件哈希一致且与候选 release 一致；Worker 日志显示商品发布 Worker 已 ready，队列并发为 1，执行策略为一次性授权、禁止自动发布重试。
- Redis `shein-product-publish` 队列只读检查：`wait=0`、`active=0`、`delayed=0`、`failed=0`、`completed=0`；没有发现新容器启动后的 Worker error/fatal/unhandled 日志。
- 数据库当前只读计数：`publish_jobs` 为 `claimed=2`、`failed_terminal=115`、`submitted=80`；`publish_batches` 为 `failed=10`、`ready=19`；`publish_batch_items` 为 `failed=48`、`ready=180`；`publish_execution_runs` 为 `failed=14`、`running=11`。
- 时间边界：最新 `publish_jobs` 失败记录更新时间为 `2026-08-28 06:30:47 UTC`（北京时间 14:30:47），早于候选容器北京时间约 17:28 的启动时间；`running` execution run 最新更新时间为北京时间约 11:35，属于切换前历史状态。
- 发布证据缺口：197 条 job 的 `readback` 全部是默认空对象 `{}`；80 条有 `shein_version`/`submitted_at` 的记录没有 `shein_document_sn`，也没有 `completed_at`。当前 `publish_receipts` 只形成 80 条 `submitted|accepted` 记录，不能证明 SHEIN 后台已创建并进入审核流程。
- 历史失败原因中同时存在真实业务拒绝与本地流程失败：预检属性值不存在、卖家 SKU 重复、SHEIN 返回“剩余可发品额度为 0”、以及 `PRODUCT_PUBLISH_QUEUE_ENQUEUE_FAILED`（明确表示未调用 SHEIN）。因此不能把所有“驳回/失败”归因于额度，也不能把 `submitted/accepted` 当成平台成功。
- 本轮处理边界：没有修改上述历史状态，没有清队列，没有重试或重新消费授权，没有把未知结果改成失败/成功，也没有调用 SHEIN 写接口。下一步应先按 `shein_version + SPU` 选定受控范围，执行官方只读回读并区分“平台已收到/平台已驳回/未找到/接口不可用”，再单独处理过期 claim、running run 和历史批次投影；禁止盲目全量重发。

## 45. 2026-08-28 第 19 步：发布关联字段缺失导致官方回读无法正确编排（已确认，待修复）

继续第 19 步只读核对时确认了一个现行代码与生产数据同时存在的结构性断点；本轮没有修改代码或生产数据：

- 生产数据证据：`publish_jobs` 的 197 条记录中，`request_summary->>'spuName'` 长度全部为 0，`request_summary->>'skcNames'` 全部为 `[]`；80 条 `submitted` 记录则全部在其本地 `receipt` 中保存了非空 `spuName`、`version` 和 `skcs`。因此 SHEIN 返回的关键关联信息存在，但没有回填到任务的 `request_summary`。
- 代码证据：`server/cloud/publish-batch-service.js` 组装执行计划时从 `requestBody.spu_name` 写入 `request.spuName`；当前首发请求体的 `spu_name` 可以为空。随后 `publish-execution-repository.js` 将该空值写入 `publish_jobs.request_summary`。相反，`product-publish-executor.js` 已从 SHEIN 响应 `info.spu_name`、`info.version`、`info.skc_list` 构造完整 accepted receipt，`recordSubmitted()` 也已把完整回执保存到 `publish_jobs.receipt` 与 `publish_receipts`。
- 回读影响：`publicReadbackStatus()` 主要从 `request_summary.spuName/skcNames` 展示；`findApprovedReadbackJob()`、`getComplianceRevalidationSource()` 的匹配条件也使用 `request_summary->>'spuName'`。因此即使提交回执中有真实 SPU，官方 document-state/SPU 关系回读仍可能无法找到对应 job，页面就会出现“已提交但没有官方状态/审核归类不动”。
- 需要的修复方向：以已验证的 SHEIN 提交回执作为任务关联信息的补偿来源，统一生成不可歧义的 `version + spuName + skcNames + skuCodes` 关联快照；所有回读、审核投影和批次展示统一使用该快照，并对多任务匹配、空回读、未找到和接口不可用分别建模。历史记录只能通过受控迁移/回填审计后修复，不能直接把空值改成成功。
- 当前边界：本轮只确认根因，没有执行回填、迁移、官方批量查询、重发或状态覆盖；第 19 步仍未完成。修复前应先增加失败回归测试，明确“首发 request body 没有 spu_name，但 SHEIN accepted receipt 有 spuName”这一场景，然后重新走候选包、远端门禁、原子切换和线上核验。

## 46. 2026-08-28 第 19 步：发布回执关联补偿修复、候选切换与线上核验（已完成部署，官方回读待用户触发）

针对第 45 节确认的结构性断点，本轮在用户授权后完成了最小范围修复和云端部署。修复目标是让历史 accepted/submitted 回执在不改写历史业务状态的前提下重新具备可靠的 `version + SPU + SKC/SKU` 查询关联；本轮没有重发商品、没有调用 SHEIN 商品写接口、没有执行数据库迁移或历史数据 UPDATE：

- 先增加失败回归再修复：覆盖首发请求 `spu_name` 为空但 accepted receipt 有 `spuName/skcs`、列表回读字段回退、Webhook/文档状态/合规复检使用统一有效标识的场景。修复后发布仓储与批次服务定向测试 `51/51`，项目全量 `npm test` `1155/1155`，`npm run build:v2` 通过，`git diff --check` 通过。
- 代码修复：`recordSubmitted()` 在新提交回执已包含平台标识时，将非空 `spuName`、`skcNames`、`skuCodes`、`supplierSkus` 合并进任务摘要；读取路径统一使用“任务摘要优先、提交回执安全回退”的有效 SPU/SKC/SKU 表达式。空摘要不会被伪造为成功，也不会覆盖用户已有的非空请求字段。
- 候选包：`/private/tmp/shein-cloud-deploy-20260828-step19-association-fix-v1.tar.gz`；SHA-256 `3f73fd0b350c914a3584240860fc2e14ef58dec878e6f9a592b95a5373da90d1`。包内排除了 `.env`、`.data`、`.git`、`node_modules`、历史压缩包、密钥/证书/数据库文件和系统元数据；远端上传后校验一致，临时上传文件已删除。
- 远端候选 release：`/opt/shein-console/releases/shein-cloud-deploy-20260828-step19-association-fix-v1`。Compose 配置有效；control 与商品发布 Worker 构建成功；容器内只读 `release:audit:v2 --static-only` 返回 `READY`，24/24 migrations、14/14 release contracts、Web artifact 全部通过，无 blocker。
- 原子切换：`/opt/shein-console/current` 已切换至上述 release；上一 release `/opt/shein-console/releases/shein-cloud-deploy-20260828-step16-candidate-v2` 保留，可用于回滚。只重建 `deploy-control-1` 与 `deploy-product-publish-worker-1`，PostgreSQL、Redis、Webhook、Webhook Worker、经营/规则/合规/媒体 Worker 未重启。
- 线上一致性：control 与商品发布 Worker 均加载 `SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED=true`、`SHEIN_COMPLIANCE_WRITES_ENABLED=true`；源文件 SHA-256 为 `c6396d19bc43312f7262a4d4edcc4440aadbeb2c5bfae31d47290af3f51a7ec8`；V2 与 web 入口 SHA-256 均为 `3549a8f3674f08e4a9eec4496e68a3885b84a9d6a1d7a67da11be6311a2395f8`。control/Worker 启动时间为 `2026-08-28T10:06:30Z`，即北京时间 18:06:30。
- 运行态：内部 `/health`、`/ready` 均 HTTP 200，PostgreSQL/Redis 均为 up；公网 `https://app.hanzhou.icu/` HTTP 200，`https://api.hanzhou.icu/health` HTTP 200，未登录 app session 返回预期 HTTP 401；Redis `shein-product-publish` 队列长度为 0，control/Worker 最近 5 分钟 error/fatal/unhandled 扫描为 0。
- 关联核验：生产数据库只读查询结果为 `80|80|80`：80 条历史提交回执中任务摘要为空但回执含 SPU 的记录全部可取得有效 SPU；80 条记录均可取得有效 SPU；80 条记录均可取得有效 SKC 列表。该结果证明本地关联补偿已生效，不证明 SHEIN 后台已审核通过或已上架。
- 第 19 步边界：官方 SHEIN 状态尚未由本轮自动批量读取，因为没有用户指定的单批次/单商品范围和新的登录态回读证据；页面下一次“手动刷新审核状态”会沿新关联路径执行官方只读回读。若 SHEIN 返回已收到、待审核、驳回、未找到或接口不可用，系统应分别保留对应事实，不得把本地 `submitted/accepted` 直接显示为平台成功。

## 47. 2026-08-28 第 19 步：审核中心及后续入口遗漏分支补齐（最终线上版本）

第 46 节首版切换后，继续做全链路字段搜索时发现审核中心 SQL 投影、今日工作活动标题、合规复检入口仍有直接读取空 `request_summary` 的分支。该遗漏已先增加回归再修复，并重新走完整部署门禁；当前线上版本以本节为准：

- 补齐范围：审核中心 `localDrafts` 查询使用提交回执中的有效 SPU/SKC 回退；今日工作发布活动标题使用有效 SPU 回退；合规复检任务身份校验和期望 SKC 使用仓储输出的有效字段；Webhook、文档状态、SPU 回读和批次展示继续使用同一套有效字段策略。
- 回归门禁：上述定向发布/审核/合规服务测试 `73/73`，项目全量 `npm test` `1155/1155`；`npm run build:v2` 通过；远端 Compose 配置、control/商品发布 Worker 构建和 V2 静态审计再次通过，`READY`、24/24 migrations、14/14 contracts、无 blocker。
- 最终候选包：`/private/tmp/shein-cloud-deploy-20260828-step19-association-fix-v2.tar.gz`；SHA-256 `49e9ef297fa8445405c97cbd2470f9fc8416cca0185dc2b8f3f4e54905bc67ab`。远端 release：`/opt/shein-console/releases/shein-cloud-deploy-20260828-step19-association-fix-v2`；上一版 `/opt/shein-console/releases/shein-cloud-deploy-20260828-step19-association-fix-v1` 保留，可回滚。
- 最终切换：`/opt/shein-console/current` 已原子切换至 v2；只重建 `deploy-control-1` 与 `deploy-product-publish-worker-1`，数据库、Redis、Webhook、Webhook Worker、经营/规则/合规/媒体 Worker 未重启。最终 control/Worker 启动后均正常运行，实际发布开关保持 `true`，未改动共享配置。
- 最终线上核验：内部 `/health`、`/ready` HTTP 200，PostgreSQL/Redis up；公网 app 首页 HTTP 200，未登录 `/v1/web/session` HTTP 401；Redis `shein-product-publish` 队列为 0；control/Worker 最近 5 分钟 error/fatal/unhandled/exception 扫描为 0。最终 `dist-v2` 与 `dist-web` 入口 SHA-256 均为 `3549a8f3674f08e4a9eec4496e68a3885b84a9d6a1d7a67da11be6311a2395f8`。
- 最终数据库只读关联核验仍为 `80|80|80`：历史 80 条提交回执均可取得有效 SPU，均可取得有效 SKC 列表；未执行历史回填、迁移、清队列、自动重发或 SHEIN 写接口调用。
- 结论边界：本轮已完成本地发布/同步关联闭环和线上运行态部署，但“商品是否真实进入 SHEIN 哪个审核状态”仍必须由用户在登录态下对指定批次点击手动刷新，读取官方 document-state/SPU 回执后才能确认；平台返回“驳回/待审核/核价/未找到/服务不可用”时分别保留，不以页面本地 `submitted/accepted` 推断平台成功。

## 48. 2026-08-28 第 20 步：官方审核回读与本地投影解耦、统一审核归类（已部署）

针对“手动刷新偶发请求失败”“官方结果已经读到但审核中心仍按旧文字归类”的问题，本轮先补失败回归，再做最小范围修复并完成云端部署；没有修改历史业务状态、没有清队列、没有自动重发商品、没有调用 SHEIN 商品写接口：

- 根因：`queryDocumentState` 先调用 SHEIN 官方回读，再串行写入发布回执和审核投影；任一条本地写入异常都会让整个 HTTP 请求失败，前端无法看到已成功取得的官方结果。审核中心前端同时存在服务端字段和本地文字映射，容易造成“待审核/驳回/核价”计数与列表不一致。
- 服务端修复：官方回读成功后，发布回执投影与审核状态投影使用独立结果记录；任一侧失败都返回官方记录，并在 `projection.persistence` 标出 `partial`、各投影状态和受控错误码。官方 SHEIN 请求、鉴权、签名、空结果和上游错误仍保持原有失败语义，不被吞掉或伪造成成功。
- 状态归类修复：审核服务和发布回读均输出统一 `resolution`，由 `review-center-status.js` 按官方审核状态、工作流、接收证据和本地执行状态按优先级分类。V2 审核中心的外部商品列表、统计、审核页签和驳回重发资格优先使用该 resolution；旧字段文字映射仅作为兼容回退。本地草稿的既有状态逻辑未改动。
- 刷新反馈修复：手动刷新检测到“官方结果成功、本地审核投影部分失败”时，显示“官方结果已读取，请再次刷新”的明确部分成功提示，不再笼统显示“请求失败，请稍后重试”，也不把官方结果当作本地完全同步。
- 回归门禁：受影响定向测试 `112/112`；项目全量 `npm test` `1157/1157`；`npm run build:v2` 通过；本地和远端 V2 release audit 均为 `READY`、无 blocker。
- 候选包：`/private/tmp/shein-cloud-deploy-20260828-step20-review-resolution-v1.tar.gz`；SHA-256 `094678280827cdcf9b49274dbf8062af29a138fbd2b0b247560551f211c7ac10`。远端上传包 SHA 一致，候选 release 未包含 `.env`、`.data`、`.git`、`node_modules` 或密钥/证书/数据库文件。
- 远端 release：`/opt/shein-console/releases/shein-cloud-deploy-20260828-step20-review-resolution-v1`；`/opt/shein-console/current` 已原子切换至该 release。上一版本 `/opt/shein-console/releases/shein-cloud-deploy-20260828-step19-association-fix-v2` 保留，可回滚。
- 服务范围：仅重建 `deploy-control-1` 与 `deploy-product-publish-worker-1`；PostgreSQL、Redis、Webhook、Webhook Worker、经营/规则/合规/媒体 Worker 未重启。control/Worker 代码 SHA 分别为 `c66d64931da135a885d20a68cbc3583d20c310b6f5058edadcb8939e928fe4e0`、`2586ee2efdb009536037fd1fd8f397625557df271e41cb173c7b01af68c15c1b`、`472ed148ad9bef0313dd6b4d7e8364014b9bd9ad0fae7bf1336820a9dcacd814`；`dist-v2/index.html` SHA 为 `8510ba0b68141ed12cd749362038b6349e8f0caf6573a286d3ac1437328d06f9`。
- 线上运行态：control/Worker 均 running；`/health`、`/ready` HTTP 200，PostgreSQL/Redis up；`shein-product-publish` 队列为 0；`SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED=true` 和 `SHEIN_COMPLIANCE_WRITES_ENABLED=true` 均保持不变；公网 app/API HTTP 200，未登录 web session HTTP 401；切换后 10 分钟内 `publish_jobs` 没有新增记录。
- 当前事实边界：数据库历史回执仍为 `document_state failed 24 / passed 2 / pending 18、submitted accepted 80`，这只是本地已有记录，不代表 SHEIN 已真实审核或上架。必须由用户在登录态下对指定商品/批次点击手动刷新，拿到官方 `query-document-state` 返回后，才能确认具体是“待审核、待核价、已驳回、已通过、未返回或服务不可用”。

## 49. 2026-08-28：已驳回商品勾选修复（已部署）

针对“已驳回”页签中的商品行无法勾选问题，本轮只修复审核中心前端重复投影，没有修改同步、发布执行、额度、审核归类、数据库或历史数据：

- 根因：官方已驳回且关联本地草稿的记录被本地草稿投影占用，真正可勾选的外部审核记录又被 `activeLocalDraftIds` 过滤，页面最终只剩下不可选的本地草稿行。
- 修复：以官方 `resolution.code=official_rejected` 为优先，并保留旧字段兼容回退；关联本地草稿从本地草稿列表移出，回到可勾选的审核记录列表，保留重新发起和归档能力。
- 回归门禁：审核中心定向测试 `34/34`；项目全量 `npm test` `1158/1158`；`npm run build:v2` 通过；本地和远端静态 release audit 均为 `READY`、14/14 contracts、无 blocker。
- 候选包：`/private/tmp/shein-cloud-deploy-20260828-rejected-checkbox-v1.tar.gz`；SHA-256 `2f5376c6281021c0dc79f5d3dda63c86a0e89b3260f06521f2fdeb37f4c537eb`。
- 线上 release：`/opt/shein-console/releases/shein-cloud-deploy-20260828-rejected-checkbox-v1`；`/opt/shein-console/current` 已原子切换；上一版本 `/opt/shein-console/releases/shein-cloud-deploy-20260828-step20-review-resolution-v1` 保留，可回滚。
- 服务范围：仅重建 `deploy-control-1`；PostgreSQL、Redis、商品发布 Worker、Webhook、Webhook Worker、经营/规则/合规/媒体 Worker 未重启，未执行迁移、队列清理、自动重发或 SHEIN 写接口调用。
- 线上核验：公网审核中心分包已包含 `official_rejected` 逻辑；公网首页、API health、内部 `/health` 与 `/ready` 均成功；未登录 `/v1/session` 返回 `401`；`dist-v2`/`dist-web` 入口 SHA-256 均为 `f8e726ed155d0c22e222bb403a3b538fb81e553f506486e3390e362be5924e48`；发布队列长度为 `0`；最近 10 分钟 control 无 error/fatal/unhandled/exception；真实发布和合规写开关保持原线上值 `true`。

## 50. 2026-08-28：已驳回商品勾选的版本去重遗漏修复（已部署）

第 49 节首版修复后，已驳回记录仍可能因与本地回读记录共享同一 SHEIN `version`，被 `allExternalReviews` 的版本去重条件过滤；页面随后回落到不可选的本地草稿行。本轮只修复这一处过滤遗漏，没有修改同步、发布执行、额度、审核归类、数据库或历史数据：

- 修复：版本去重仍对普通审核记录生效，仅对 `isRejectedExternalReview(item)` 的官方驳回记录豁免，确保其保留在外部审核列表并使用审核行复选框；既有本地草稿、失败任务、重新发起中的过滤条件保持不变。
- 回归门禁：新增版本去重回归断言后先验证旧代码失败；修复后审核中心定向测试 `34/34`，项目全量 `npm test` `1158/1158`；`npm run build:v2`、`git diff --check` 通过；本地 `dist-v2`、`dist-web` 静态 release audit 均为 `READY`、14/14 contracts、无 blocker。
- 候选包：`/private/tmp/shein-cloud-deploy-20260828-rejected-checkbox-v2.tar.gz`；SHA-256 `73f6f0f3a280adb498ffa98ca03a5cc046fface12cf37eb650c7cb1afbc78c36`。远端上传包 SHA 一致，未包含 `.env`、`.env.web`、`.data`、`.git`、`node_modules`、密钥/证书或数据库文件。
- 远端 release：`/opt/shein-console/releases/shein-cloud-deploy-20260828-rejected-checkbox-v2`；`/opt/shein-console/current` 已原子切换到该版本；上一版本 `/opt/shein-console/releases/shein-cloud-deploy-20260828-rejected-checkbox-v1` 保留，可回滚。
- 服务范围：仅重建 `deploy-control-1`；PostgreSQL、Redis、商品发布 Worker、Webhook、Webhook Worker、经营/规则/合规/媒体 Worker 未重启；未执行数据库迁移、队列清理、自动重发或 SHEIN 写接口调用。线上 `SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED=true`、`SHEIN_COMPLIANCE_WRITES_ENABLED=true` 保持不变。
- 线上核验：control 容器 `healthy`；内部 `/health`、`/ready` 与公网 app/API health 均 HTTP 200；未登录 `/v1/session` 返回 `401`；公网 `dist-web/index.html` 哈希与候选一致（`c9f46c64ee1f9d754ba9b535ed83e2108916d286fdf78b38f1dd270774c82e4e`）；公网审核中心分包 `PublishBatchesPage-D1bN1x4d.js` 已包含 `official_rejected` 逻辑；发布队列为 `0`；control 最近 10 分钟无 error/fatal/unhandled/exception。

## 51. 2026-08-28：官方驳回记录被本地失败任务遮蔽修复（已部署）

第 50 节部署后仍发现“已驳回”无法勾选的第二条遗漏：官方驳回记录虽然已经豁免版本去重，但仍可能被本地失败任务过滤；服务端在无 SHEIN 版本的终态失败尝试下也会生成更新的本地占位记录，最终遮蔽官方驳回行。本轮只修复该链路：

- 服务端修复：无 `sheinVersion` 且状态为 `failed`、`failed_terminal` 或 `failed_retryable` 的本地失败尝试，不再覆盖同一 SKC 的官方驳回事实；不生成会抢占当前审核行的本地占位记录。已提交且等待回读的无版本尝试仍保持原有“当前尝试优先”语义。
- 前端修复：官方驳回审核记录豁免 `failedDraftIds` 和 `activeLocalDraftIds` 过滤，仍保留“重新发起中的记录暂不重复显示”和普通记录去重规则；本地失败/未 ready 行继续不可直接发布，避免把失败任务误当成可发布任务。
- 回归门禁：先验证新增服务端回归失败，修复后发布/审核定向测试 `56/56`；项目全量 `npm test` `1159/1159`；`npm run build:v2`、`git diff --check` 通过；本地与远端 V2 静态 release audit 均为 `READY`、14/14 contracts、无 blocker。
- 候选包：`/private/tmp/shein-cloud-deploy-20260828-rejected-checkbox-v3.tar.gz`；SHA-256 `bdb5f8cc3d1b849e51aee583ed5dd3a735ec8e7e7eba62dca1aa5108f81975ab`。远端上传包 SHA 一致，未包含环境文件、数据目录、Git 元数据、依赖目录、密钥/证书或数据库文件。
- 远端 release：`/opt/shein-console/releases/shein-cloud-deploy-20260828-rejected-checkbox-v3`；`/opt/shein-console/current` 已原子切换到该版本；上一版本 `/opt/shein-console/releases/shein-cloud-deploy-20260828-rejected-checkbox-v2` 保留，可回滚。
- 服务范围：仅重建 `deploy-control-1`；商品发布 Worker、PostgreSQL、Redis、Webhook、Webhook Worker、经营/规则/合规/媒体 Worker 未重启；未执行数据库迁移、历史数据更新、队列清理、自动重发或 SHEIN 写接口调用。线上 `SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED=true`、`SHEIN_COMPLIANCE_WRITES_ENABLED=true` 保持不变。
- 线上核验：control `healthy`；内部 `/health`、`/ready` 与公网 app/API health 均 HTTP 200；未登录 `/v1/session` 返回 `401`；公网入口哈希与候选一致（`b1aaff89e5cbf71d4f95a29efccb7111846bc55681d8c320527a004d4ee917bc`）；公网审核中心分包 `PublishBatchesPage-B-4fgge4.js` 已包含新驳回筛选逻辑；发布队列为 `0`；control 最近 10 分钟无 error/fatal/unhandled/exception。

## 52. 2026-08-28：官方驳回回执与 submitted 传输状态冲突修复（已部署）

针对“已驳回”页面显示官方驳回，但商品复选框仍无法选择、无法重新发起的问题，本轮只修复官方审核回执与本地传输状态的投影冲突，没有扩大到同步、额度、发布请求体或历史状态改写：

- 根因：SHEIN 已返回 `document_state` 驳回回执（`auditState=3`），但对应 `publish_jobs.state` 仍为传输层 `submitted`。前端把所有 `submitted` 都当成发布中，服务端又用任务 `updated_at` 覆盖同一版本的官方驳回事实，导致页面同时出现“已驳回”和不可勾选。
- 服务端修复：审核中心读取每个发布任务最新的 `audited/document_state` 回执并投影 `documentAudit*` 字段；当前任务存在终态官方驳回时，不再把 `submitted` 解释为等待回读，也不再清空官方驳回结果。`submitted` 仍保留为传输执行状态，没有被直接改写成失败或成功。
- 前端修复：`documentState.auditState=3` 或失败标签优先于 `submitted`；审核状态显示为“已驳回”，发布进度为终态失败，重新发起资格恢复，已驳回行复选框恢复可选。普通 `submitted`、重试中、未收到官方回执的记录继续保持原有保护逻辑。
- 数据库/业务边界：没有数据库迁移、没有历史数据 UPDATE、没有清理队列、没有自动重发、没有调用 SHEIN 商品写接口或消费发布授权；运行时能力矩阵仅按现有 `publish_receipts` 只读查询同步生成并通过审计。
- 回归门禁：审核/发布定向测试 `61/61`；项目全量 `npm test` `1162/1162`；`npm run build:v2`、`git diff --check` 通过；本地和远端候选 V2 静态审计均 `READY`、14/14 contracts、无 blocker；远端运行时数据库角色审计 `50` 项全部通过。
- 候选包：`/private/tmp/shein-cloud-deploy-20260828-rejected-checkbox-v4.tar.gz`；SHA-256 `5612c89fe56b1d1220b0e3c97c2d6f4be42c8fb7ed8b8bf8b9258efde4b811a1`。包内未包含生产环境文件、本地数据、Git 元数据、依赖目录、历史压缩包、密钥或证书。
- 远端 release：`/opt/shein-console/releases/shein-cloud-deploy-20260828-rejected-checkbox-v4`；`/opt/shein-console/current` 已原子切换至该版本；上一版本 `/opt/shein-console/releases/shein-cloud-deploy-20260828-rejected-checkbox-v3` 保留，可回滚。
- 服务范围：仅重建 `deploy-control-1`；商品发布 Worker、PostgreSQL、Redis、Webhook、Webhook Worker、经营/规则/合规/媒体 Worker 未重启。生产 `SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED=true`、`SHEIN_COMPLIANCE_WRITES_ENABLED=true` 保持原值。
- 线上核验：control `healthy`；内部 `/health`、`/ready` 均 HTTP 200，PostgreSQL/Redis 为 up；公网 `https://app.hanzhou.icu/` 与 `https://api.hanzhou.icu/health` 均 HTTP 200；公网入口 SHA-256 与候选 `dist-web/index.html` 均为 `0b6c2907e9e8b79f366d77b974393754ece928eaf0007b9b92426f8ec60bb762`；公网 `PublishBatchesPage-CoDN8x6u.js` 已包含新驳回状态逻辑；发布队列保持 0；control 最近 3 分钟无 error/fatal/unhandled/exception。
- 运行一致性：候选与运行中 `/app/server/cloud/product-review-service.js` SHA-256 均为 `6cf193249c1bf875da3b66f44149dc5c8afc0e9d32b084dfdc01ac2877fa3254`；商品发布 Worker 启动时间未因本轮部署改变。
- 回滚：如线上出现回归，先将 `/opt/shein-console/current` 切回 v3，再按交接流程只重建 control；不得清理历史任务、改写 `submitted`、删除回执或自动重发商品。
