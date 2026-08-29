# SHEIN 商业 ERP 主执行计划

版本：2026-08-29-v21
方案名称：**涵舟 Polaris（北极星）商业 ERP 重构计划（HANZHOU-POLARIS）**  
状态：执行路线；ERP-00～ERP-04 已完成，ERP-05 正在执行限定生产只读补证，ERP-06～ERP-23 尚未开始
适用项目：SHEIN 超级运营中心 / SHEIN 涵舟工作室  
执行编号：ERP-00 至 ERP-23

## 0. 本计划的作用

本文件是未来修复、重构、测试和上线工作的唯一执行顺序。历史交接文件继续作为事实档案和证据来源，但不再作为可以直接执行的步骤清单。

> **重要校正：** ERP-00～ERP-23 是在 17 个板块方案完成后编制的工程实施路线，不是旧“第 1～20 步”的改名版。历史旧步骤与本路线仍然分开；本计划的当前执行状态以执行台账为准。2026-08-29 已取得用户明确启动，ERP-00～ERP-04 已完成，ERP-05 已建立正式只读审计 Run；新对话不得在没有用户明确启动时自行开始后续步骤。

本计划解决四个长期问题：

1. 修复 A 时意外破坏 B。
2. 本地测试通过，但线上仍运行旧前端、旧 Worker 或旧状态投影。
3. 页面显示成功，但 SHEIN、数据库、队列和回读证据并不支持成功结论。
4. 工作靠聊天记忆推进，遗漏测试、数据、权限、回滚或线上验收。

本计划本身不授权修改业务代码、生产数据库、云端配置或 SHEIN 商品。本轮只建立执行制度。

### 0.1 分板块架构决策

各业务板块经过讨论后确认的产品边界、目标架构、实施顺序和验收标准统一记录在 [COMMERCIAL_ERP_MODULE_ARCHITECTURE_2026-08-28.md](./COMMERCIAL_ERP_MODULE_ARCHITECTURE_2026-08-28.md)。主计划决定整体执行顺序，分板块文档决定对应模块“应建成什么样”；发生冲突时必须先书面修订，不允许由实现补丁暗中改变。

当前已确认：

- 板块 01“账号、成员、角色与店铺权限”由 ERP-03、ERP-06、ERP-17、ERP-19、ERP-21 承接；IAM-01 至 IAM-05 是后续业务开发的 P0 前置门。
- 板块 02“店铺接入、SHEIN 授权、店铺生命周期、多店群组织与切店体验”由 ERP-03、ERP-06、ERP-07、ERP-17、ERP-18、ERP-19、ERP-21、ERP-22 承接；STORE-01 至 STORE-06 是稳定身份、授权原子性和定向重授权的 P0 地基，不能被店铺管理 UI 或经营分析提前绕过。
- 板块 03“商品主数据、SPU/SKC/SKU、草稿版本与商品生命周期”由 ERP-03、ERP-04、ERP-05、ERP-06、ERP-09、ERP-10、ERP-11、ERP-12、ERP-13、ERP-14、ERP-15、ERP-20、ERP-21、ERP-22 承接；PROD-01 至 PROD-10 是稳定商品身份、不可变版本和当前尝试投影的 P0 地基。
- 板块 04“商品建档、批量建品、编辑器、类目属性与模板复用”由 ERP-02、ERP-03、ERP-04、ERP-06、ERP-07、ERP-12、ERP-14、ERP-15、ERP-16、ERP-18、ERP-19、ERP-21、ERP-22、ERP-23 承接；BUILD-01 至 BUILD-08 是统一商品表单模型、模板引擎和服务端预检的 P0 地基。
- 板块 05“发布命令、批次、队列、Worker 与 SHEIN 回执闭环”由 ERP-03、ERP-04、ERP-06、ERP-07、ERP-08、ERP-09、ERP-10、ERP-11、ERP-12、ERP-13、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23 承接；PUB-01 至 PUB-11 是不可变发布命令、事务 Outbox、唯一写 Worker、发送边界和 unknown 禁止盲重试的 P0 地基。
- 板块 06“官方回读、Webhook、审核状态投影与商品审核中心”由 ERP-03、ERP-04、ERP-05、ERP-06、ERP-07、ERP-10、ERP-11、ERP-13、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23 承接；REV-01 至 REV-11 是统一事件入口、精确 Attempt 解析、单调状态归并和一致快照的 P0 地基。
- 板块 07“素材资产、商品图片、上传处理、用途映射与对象存储生命周期”由 ERP-03、ERP-05、ERP-06、ERP-07、ERP-09、ERP-12、ERP-14、ERP-15、ERP-16、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23 承接；MEDIA-01 至 MEDIA-10 是不可变资产、可信完整性、版本媒体引用和平台回执的 P0 地基。
- 板块 08“标题规则、AI 标题、视觉识别与批量生成调度”由 ERP-03、ERP-04、ERP-06、ERP-07、ERP-08、ERP-12、ERP-13、ERP-14、ERP-15、ERP-18、ERP-19、ERP-21、ERP-22、ERP-23 承接；AI-01 至 AI-10 是确定性标题规则、冻结输入、持久请求/Attempt、Provider Adapter 和用户决定的 P0 地基。
- 板块 09“商品合规、资质证书、1630/1631、实拍图、警示语与发布阻断”由 ERP-03、ERP-04、ERP-05、ERP-06、ERP-07、ERP-08、ERP-09、ERP-10、ERP-12、ERP-13、ERP-14、ERP-15、ERP-16、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23 承接；COMPLY-01 至 COMPLY-06、COMPLY-13 至 COMPLY-15 是官方要求快照、精确案件范围、材料适用性、持久命令和平台回执的 P0 地基。
- 板块 10“销量、库存、在途、备货、经营预警与多店经营分析”由 ERP-03、ERP-04、ERP-05、ERP-06、ERP-07、ERP-08、ERP-10、ERP-11、ERP-13、ERP-17、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23 承接；BIZ-01 至 BIZ-10 是官方经营事实、覆盖率、结构化历史、手动刷新 Operation 和指标字典的 P0 地基，BIZ-12 至 BIZ-14 是商业备货建议和预警闭环的前置门。
- 板块 11“采购、备货、仓库、发运物流与履约闭环”由 ERP-03、ERP-04、ERP-05、ERP-06、ERP-07、ERP-08、ERP-10、ERP-11、ERP-13、ERP-15、ERP-17、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23 承接；FUL-01 至 FUL-10 是官方单据、数量账本、人工计划、选项快照和发货资格的 P0 地基，FUL-11 至 FUL-14 是任何 SHEIN 履约写入前的可靠性门。
- 板块 12“退货、报废、质量缺陷、索赔申诉、平台处罚与财务对账”由 ERP-03、ERP-04、ERP-05、ERP-06、ERP-07、ERP-08、ERP-10、ERP-11、ERP-13、ERP-15、ERP-17、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23 承接；RET-01 至 RET-10 是逆向事实、数量、质量案件和证据的 P0 地基，RET-13 是任何退货/报废/申诉平台写入前的可靠性门。
- 板块 13“财务、成本、利润、结算、发票、资金与多币种经营核算”由 ERP-03、ERP-04、ERP-05、ERP-06、ERP-07、ERP-08、ERP-10、ERP-11、ERP-13、ERP-15、ERP-17、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23 承接；FIN-01 至 FIN-11 是任何利润结论的 P0 地基，FIN-12 至 FIN-16 是应收应付、票据、资金和月结完整性的前置门。
- 板块 14“价格生命周期、平台核价/议价、建议零售价、活动价与利润保护”由 ERP-03、ERP-04、ERP-05、ERP-06、ERP-07、ERP-08、ERP-09、ERP-10、ERP-11、ERP-13、ERP-15、ERP-17、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23 承接；PRICE-01 至 PRICE-10 是价格真相、合同、状态、利润和材料的 P0 地基，PRICE-11 至 PRICE-15 是任何 SHEIN 价格写入前的可靠性门。
- 板块 15“运营活动、商品推广、选品测款、商品分层与生命周期增长”由 ERP-03、ERP-04、ERP-05、ERP-06、ERP-07、ERP-08、ERP-10、ERP-11、ERP-13、ERP-14、ERP-15、ERP-16、ERP-17、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23 承接；GROW-01 至 GROW-10 是增长事实、生命周期、分层、实验和地毯放量门的 P0 地基，GROW-11 至 GROW-15 是活动、跨域动作和生命周期决定可信闭环的前置门。
- 板块 16“团队任务、审批、通知、SLA 与协同工作流”由 ERP-03、ERP-04、ERP-05、ERP-06、ERP-08、ERP-09、ERP-10、ERP-11、ERP-13、ERP-15、ERP-17、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23 承接；WORK-01 至 WORK-09 是任务、SLA、审批和一次性授权的 P0 地基，WORK-10 至 WORK-15 是证据、通知、个人/团队工作台、日历和系统任务分离的商业闭环前置门。
- 板块 17“数据分析、报表中心、指标治理与管理驾驶舱”由 ERP-03、ERP-04、ERP-05、ERP-06、ERP-07、ERP-08、ERP-10、ERP-11、ERP-13、ERP-17、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23 承接；BI-01 至 BI-08 是指标、维度、质量、血缘和一致快照的 P0 地基，BI-09 至 BI-15 是报表、下钻、领域分析和管理驾驶舱的可信闭环前置门。
- 板块内 IAM-XX、STORE-XX、PROD-XX、BUILD-XX、PUB-XX、REV-XX、MEDIA-XX、AI-XX、COMPLY-XX、BIZ-XX、FUL-XX、RET-XX、FIN-XX、PRICE-XX、GROW-XX、WORK-XX、BI-XX 等编号只用于需求追踪；实际实施仍只能通过正式 ERP-XX Run 开始。

## 1. 执行方法：主计划 + 执行台账 + 问题登记

项目以后采用 PGEL 方法：

- P（Plan）：本文件定义固定步骤、范围和顺序。
- G（Gate）：每一步必须通过进入门和完成门。
- E（Evidence）：所有结论必须有页面、测试、API、数据库、队列、日志或 SHEIN 官方回读证据。
- L（Ledger）：每次实际工作都记录在 COMMERCIAL_ERP_EXECUTION_LEDGER_2026-08-28.md。

### 1.1 唯一活动步骤

- 同一时间只能有一个 ERP 步骤处于 IN_PROGRESS。
- 可以并行做同一步内的只读检查，但不能并行推进两个会改变代码或生产状态的步骤。
- 不允许跳步。若确需跳过，必须在台账中记录原因、风险和用户确认。
- 旧交接中的“第 1 步、第 19 步”等编号只表示历史事件；未来指令必须写成“开始 ERP-XX”。

### 1.2 步骤状态

- NOT_STARTED：尚未开始。
- READY：进入条件已满足。
- IN_PROGRESS：正在执行，且只有一个步骤可处于该状态。
- BLOCKED：缺少外部条件，不能继续。
- GATE_FAILED：执行完成但验收门失败，必须修复或回滚。
- READY_FOR_APPROVAL：技术门通过，等待用户批准外部写入、迁移或部署。
- COMPLETE：全部交付物和证据齐全，没有隐瞒的必做项。

### 1.3 完成的定义

任何步骤只有同时满足以下条件才能标为 COMPLETE：

1. 步骤清单全部完成或明确标记不适用并说明原因。
2. 没有修改允许范围之外的文件、服务、数据或配置。
3. 失败回归先证明问题存在，修复后通过。
4. 定向测试、受影响测试和规定的全局门禁全部通过。
5. 浏览器验收覆盖加载、空状态、错误、权限、切店和关键交互。
6. 所有生产影响都有回滚点，部署后证据齐全。
7. 新发现的问题进入问题登记，不以“以后再看”口头带过。
8. 执行台账已填写，交接文档已更新。

## 2. 事实优先级

发生冲突时，按以下顺序判断：

1. 当前时点的 SHEIN 官方回读和官方原始 API 文档。
2. 当前生产数据库、队列、容器、release 和日志的只读证据。
3. 当前源码、迁移、测试和构建产物。
4. 本计划和已批准的架构决策。
5. 历史交接记录。
6. 截图、经验和推测。

截图可以证明用户看到的症状，但不能单独证明 SHEIN 已收到商品、数据库已更新或云端已部署正确版本。

## 3. 全局不可违反的约束

### 3.1 业务真相

- 不再使用含糊的“已发布”作为万能状态。
- 本地排队、Worker 领取、SHEIN 接收、官方审核、审核通过和商品上架必须分开。
- 没有 SHEIN 接收或回读证据时，只能显示排队、提交中、已提交待回读或结果待确认。
- HTTP 200 只证明当前 HTTP 请求成功，不证明商品已被 SHEIN 接收。
- 网络超时或 5xx 进入结果未知，禁止自动重发。
- SHEIN 的额度、保证金、权限、SKU 重复、审核驳回等错误必须保留 code、message、traceId。
- 官方字段缺失与官方数值 0 必须分开；未知值不能计为 0。
- 内部 CatalogProduct、可编辑 Draft、不可变 ProductVersion、PublishAttempt 和 SHEIN PlatformProductLink 必须分开；不得继续用 draftId、supplier code 或“最新时间”同时代表这些对象。
- 商品、SKU 和版本的内部 ID 长期稳定；SHEIN document/version/SPU/SKC/SKU 只在官方证据返回后建立 store-scoped 映射。

### 3.2 同步与刷新

- 不增加全站每 30 秒自动同步。
- 普通页面只读数据库缓存，用户手动刷新才创建同步任务。
- 切换店铺不得自动调用 SHEIN；先展示目标店铺最近可信快照、截止时间、覆盖率和新鲜度。
- 用户刚点击发布或刷新后，可以为该次活动操作使用 SSE 或有上限的短轮询；任务终止或用户离开页面后必须停止。
- 重复点击复用同一活动任务；无活动任务不轮询。
- 单个目标失败不能清空其他成功结果或旧缓存。

### 3.3 权限和隔离

- 所有业务读写必须包含 tenant、user、store 作用域。
- Query key、API、Repository、Worker、缓存和对象存储引用都必须执行相同隔离。
- 切换账号或店铺必须清理旧作用域的选择状态、活动任务和页面缓存。
- 跨店群默认只允许聚合读取；任何跨店批量写必须单独授权。
- 店铺范围只回答“可在哪些店操作”；所有写请求还必须通过统一动作能力门禁，前端隐藏按钮不构成授权。
- 账号权限板块中的 P0 基础门禁按分板块决策 IAM-01 至 IAM-05 在 ERP-03/ERP-06 完成；团队、店铺组和高级权限运营继续归属 ERP-17，不能把 P0 越权风险推迟到 ERP-17。
- 新增授权、指定店铺重授权、断开、撤销、暂停、归档和全局命名必须通过独立店铺管理能力；普通登录状态或 StoreAccess 不能替代动作授权。
- 无权限、不存在、归档或失效的 URL 店铺不得静默回落到第一家店；服务端必须拒绝原目标，前端引导用户显式选择安全上下文。
- disconnected/reauthorization_required 店铺在原访问关系仍有效时允许读取本地历史；SHEIN 远端读取和写入由连接与业务能力独立阻断。

### 3.4 源码和重构

- Bug 先写失败回归，再做最小修改。
- 不顺手重构无关模块，不为了未来可能需要而增加框架。
- 稳定的签名、加密、会话、授权、对象存储和已执行迁移默认冻结。
- 巨型文件可以逐步拆分，但拆分步骤不得同时改变业务语义。
- 不做一次性全站重写，也不继续无边界补丁；采用受控的纵向切片重建。

### 3.5 数据和删除

- ERP-20 之前不修正历史生产数据。
- ERP-23 之前不删除旧代码、旧表、历史回执、历史任务或部署包。
- 历史数据修复必须先只读报告、备份、dry-run、明确目标 ID、用户批准和写后核验。
- 不通过删除失败记录、清队列或把状态改成成功来“清屏”。
- 素材删除必须同时证明无 MediaReference、无 RetentionHold、无活动任务且保留期/回收期已结束；缓存 reference_count 不能单独授权删除。
- ProductVersion、平台图片回执和合规审计引用的素材不得因 Draft 发布、归档或草稿箱清理而释放。

### 3.6 生产和 SHEIN 写操作

- 本计划不授权生产部署、数据库迁移、角色授权、配置开关、历史数据修复或 SHEIN 写请求。
- 这些动作必须在对应步骤达到 READY_FOR_APPROVAL 后，由用户明确批准。
- Live SHEIN 写验收只能使用用户明确指定的店铺和商品，不允许自己选择商品。
- 结果未知的旧任务永远不能作为自动重试对象。

### 3.7 UI 保护

- 未经设计稿和行为规格批准，不改变全站壳层、品牌、导航或视觉语言。
- 修复交互问题时只修改实际 owner，不重新套后台模板。
- 每个 UI 改动都要有修改前截图、修改后截图、DOM/行为回归和桌面/窄屏验收。
- 选择、发布、归档等危险动作必须显示准确范围、数量、进度和逐项结果。

## 4. 每个步骤开始前的强制步骤合同

开始任何 ERP-XX 前，必须在执行台账填写：

1. 用户症状或商业目标。
2. 当前事实证据。
3. 根因层级：UI、V2 client、control、service、worker、DB、queue、SHEIN 或 deployment。
4. 唯一 owner。
5. 允许修改文件和服务。
6. 明确禁止修改的稳定区。
7. 失败回归测试。
8. 可验证成功标准。
9. 数据库、SHEIN、部署和权限影响。
10. 停止条件与回滚点。

未填写完整时，该步骤只能做只读调查，不能编辑代码。

## 5. 每次修改的横向查漏矩阵

每个改动必须逐项填写“受影响 / 不受影响 / 不适用”，不能留空：

| 维度 | 必查问题 |
| --- | --- |
| 身份权限 | tenant/user/store 是否全链路隔离？ |
| 状态真相 | 页面状态来自哪个权威字段？是否混入旧状态？ |
| 幂等 | 重复点击、重试、刷新会不会重复提交？ |
| 结果未知 | 超时后是否阻止重复写？ |
| 数据模型 | 是否需要迁移？是否保持前向兼容？ |
| 缓存 | key、失效、切店、退出登录是否正确？ |
| 队列 | 入队、领取、租约、失败、重启恢复是否正确？ |
| SHEIN 契约 | endpoint、字段、批量上限、限流、错误是否可追溯？ |
| 媒体 | 图片权限、用途、顺序、稳定 URL、失效是否正确？ |
| UI 状态 | loading、empty、error、partial、permission、stale 是否都有？ |
| 可观测性 | operationId、traceId、release、worker 版本是否可查？ |
| 性能 | 是否产生无界列表、缓存、并发或轮询？ |
| 安全 | 是否泄露密钥、完整请求、个人信息或对象存储路径？ |
| 部署 | 哪些服务必须切换？哪些服务明确不能重启？ |
| 回滚 | 代码、配置、迁移、数据分别如何恢复？ |

## 6. 阶段总览和执行顺序

正常执行严格按 ERP-00 → ERP-23 推进。表中的“必须先完成”只写直接前序步骤；由于禁止跳步，开始任一步骤时，所有更早步骤也必须已经 `COMPLETE`。步骤正文中的额外进入条件同样必须满足。任何例外都要先在台账记录原因、风险并取得用户明确批准。

| 阶段 | 名称 | 必须先完成 | 生产写入 |
| --- | --- | --- | --- |
| ERP-00 | 变更冻结与真相基线 | 无 | 禁止 |
| ERP-01 | 源码资产救援与版本控制 | ERP-00 | 禁止 |
| ERP-02 | 单一 V2 前端产物恢复 | ERP-01 | 仅经批准部署 |
| ERP-03 | CI、预发与发布门禁 | ERP-02 | 禁止 |
| ERP-04 | 商品生命周期与状态字典定稿 | ERP-03 | 禁止 |
| ERP-05 | 历史数据证据盘点 | ERP-04 | 只读 |
| ERP-06 | 规范数据模型与事件账本 | ERP-05 | 迁移需批准 |
| ERP-07 | SHEIN 适配器契约硬化 | ERP-06 | 默认只读 |
| ERP-08 | Control、Worker 与 release 一致性 | ERP-07 | 部署需批准 |
| ERP-09 | 可靠发布命令管线 | ERP-08 | Live 写禁用 |
| ERP-10 | 官方审核回读与状态投影 | ERP-09 | 只读回读 |
| ERP-11 | 审核中心统一快照 API | ERP-10 | 禁止 |
| ERP-12 | 草稿到发布批次交接闭环 | ERP-11 | Live 写禁用 |
| ERP-13 | 发布与审核中心商业级前端 | ERP-12 | Live 写禁用 |
| ERP-14 | 商品编辑器与预检闭环 | ERP-13 | Live 写禁用 |
| ERP-15 | 媒体、模板与 AI 标题 | ERP-14 | AI 外部调用按配置 |
| ERP-16 | 合规与地毯品类闭环 | ERP-15 | 合规写需批准 |
| ERP-17 | 多店群、权限、经营分析、履约、售后、财务、价格、增长、协同与报表 | ERP-16 | 外部动作默认冻结；协同/报表不触发 SHEIN，逐动作金丝雀 |
| ERP-18 | 可观测性与运营诊断台 | ERP-17 | 禁止 |
| ERP-19 | 性能、安全、备份与故障演练 | ERP-18 | 演练需隔离 |
| ERP-20 | 历史数据受控对账修复 | ERP-19 | 必须批准 |
| ERP-21 | Staging 全链路验收 | ERP-20 | Live 写默认禁止 |
| ERP-22 | 生产金丝雀与商业发布 | ERP-21 | 必须批准 |
| ERP-23 | 稳定期与遗留退役 | ERP-22 | 删除需批准 |

## 7. ERP-00：变更冻结与真相基线

### 目标

建立一个可重复、可对比的本地与生产事实快照，停止在不清楚当前版本的情况下继续修复。

### 允许

- 只读检查本地文件、Git、依赖、构建入口、部署拓扑和生产健康。
- 生成不含秘密的文件清单、哈希、规模、容器和数据计数报告。
- 更新本计划和执行台账。

### 禁止

- 修改业务代码、生产配置、数据库、队列和 SHEIN。
- 重启服务、切换 release、清理压缩包或未跟踪文件。
- 把历史交接中的线上状态当作当前事实。

### 必做清单

1. 记录 git status、分支、commit、remote 和 tracked/untracked 数量。
2. 记录 package scripts、V2/legacy 入口、dist-v2/dist-web 实际来源和 Nginx 路径。
3. 记录源码、测试、迁移、部署包数量与大文件清单。
4. 只读记录当前生产 release、静态 hash、control/Worker image ID 和启动时间。
5. 只读记录 PostgreSQL、Redis、关键队列和发布/审核数据聚合。
6. 记录功能开关的布尔状态，但不输出秘密值或完整环境文件。
7. 建立当前 P0/P1 问题的可复现证据索引。
8. 标记每项事实的采集时间和数据新鲜度。

### 交付物

- ERP-00 基线报告。
- 文件/服务/release 哈希清单。
- 当前问题证据包索引。
- 明确的回滚基线。

### 完成门

- 任何人按报告可以确认当前运行的是哪一套前端、control 和 Worker。
- 未发现秘密进入报告。
- 不再用 git diff 检查一个没有 tracked 文件的仓库来宣称“无改动”。
- 所有未知项明确列为 UNKNOWN，不用推测补齐。

### 停止条件

发现生产正在处理 live 发布、数据库备份不可用或当前 release 无法识别时，停止后续步骤并先报告。

## 8. ERP-01：源码资产救援与版本控制

### 目标

把当前 1.3GB 左右、无有效提交历史、存在大量部署包的工作区变成可恢复、可审查、可比较的真实源码仓库。

### 进入条件

- ERP-00 COMPLETE。
- 用户批准创建首个基线提交和配置私有远端；若尚未批准，只能生成方案。

### 允许

- 建立完整备份和哈希。
- 整理 .gitignore、源码/文档/迁移/测试/静态资产的跟踪策略。
- 将构建物、部署包、缓存、密钥和本地数据排除在源码提交之外。
- 创建基线 tag 和私有远端。

### 禁止

- 删除、覆盖或移动用户文件，除非用户批准具体清单。
- 把 .env、.data、数据库、密钥、node_modules 或部署包提交到 Git。
- 在同一步修改业务逻辑。

### 必做清单

1. 创建完整可恢复备份并校验 SHA。
2. 将文件分为 source、docs、tests、migrations、assets、generated、local-data、release-archives。
3. 审计 124 个历史部署包的名称、大小、SHA 和对应 release，不删除。
4. 建立安全 .gitignore 和 secret scan。
5. 创建基线提交，记录树哈希和 tag。
6. 建立私有远端并验证从空目录 clone 后可以构建。
7. 建立部署包保留策略和后续制品仓库方案。
8. 验证工作树能够准确显示后续代码差异。

### 交付物

- 可 clone 的私有源码仓库。
- 基线 tag 与备份清单。
- 历史部署包索引。
- 源码/制品/数据边界说明。

### 完成门

- 新环境从私有仓库可以安装、测试和构建。
- git status 和 git diff 能真实反映源码变化。
- secret scan 无敏感文件。
- 原工作区用户文件完整保留。

### 回滚

保留原目录和完整备份；若 Git 基线错误，不覆盖原目录，另建恢复目录重做。

## 9. ERP-02：单一 V2 前端产物恢复

### 目标

彻底消除 legacy 页面、V2 页面、dist、dist-web 和 dist-v2 之间的构建/部署漂移。

### 允许

- 只调整构建和打包入口、静态目录映射、release marker 和审计。
- 保持当前 V2 UI 行为和视觉不变。

### 禁止

- 改业务页面、导航、品牌、文案或状态逻辑。
- 删除 legacy 源码。
- 同时修复发布、审核或同步问题。

### 必做清单

1. 证明生产 Nginx 当前读取哪个目录。
2. 指定 V2 为唯一发布源。
3. 停止 release 流程调用 legacy build:web 生成不同页面。
4. 若 Nginx 暂时必须读取 dist-web，只允许由同一次 V2 构建确定性复制或链接。
5. 生成 buildId、source revision、asset manifest 和 UI marker。
6. release audit 同时校验 dist-v2 与线上目录字节一致。
7. Playwright 验证登录页、V2 品牌、关键路由，且 legacy 标识不存在。
8. 验证深层路由回退不循环。
9. 建立单品编辑、批量建品、草稿批处理和文件夹导入的构建/运行时引用图，标记唯一生产入口；本步骤只取证和收敛产物，不改业务语义。

### 完成门

- 一次构建只产生一套前端事实。
- 本地、候选、云端入口 hash 一致。
- 线上不能再出现“全托管运营助手 / 网页协作版”等旧壳层。
- 当前业务 UI 没有视觉变化。

### 部署批准

生产切换必须单独得到用户批准，并保留上一 release。

## 10. ERP-03：CI、预发与发布门禁

### 目标

把测试、构建、浏览器验收、制品审计和部署变成自动阻断门，而不是口头检查。

### 必做清单

1. 固定 Node 和包管理器版本，验证 lockfile 完整性。
2. 建立 CI：静态检查、定向测试、全量测试、V2 build、release audit、secret scan。
3. 引入确定性的 Playwright 核心流程，不依赖 live SHEIN。
4. 建立 staging，使用独立 DB/Redis/bucket/flags，不连接生产写接口。
5. 每个 release 生成不可变 manifest：source、UI、control、Worker、migrations、flags、build time。
6. 制品只从已通过 CI 的 revision 构建一次，不在生产机重新拼装不同源码。
7. 部署前验证候选，部署后验证实际运行 manifest。
8. 门禁失败禁止切换 current。
9. 建立发布命令故障注入门：数据库提交后进程崩溃、Outbox 重投、重复 jobId、Worker 发送前/发送后崩溃、SHEIN 超时和 SSE 断线均须产生确定结果。
10. release manifest 必须同时声明 Control、Publish Worker、Outbox Dispatcher、schema range 和 live-write flag；任何一项漂移均阻止新 PublishCommand。
11. 建立审核回读故障门：Webhook 重复/乱序、document-state 与 SPU readback 同义结果、Attempt 歧义、投影事务失败、单来源失败和过期快照均须得到确定结果。
12. 建立媒体故障门：直传中断、重复 complete、对象缺失、hash/MIME/尺寸冲突、Draft→Version 引用事务失败、SHEIN 图片回执缺失和清理 Worker 重启均须产生确定结果。

### 最低浏览器流程

- 登录/退出/切账号。
- 普通成员越权阻断。
- 切店不串数据。
- 草稿保存/预检。
- 单品、批量和草稿批处理对同一输入生成一致的规范 Draft payload。
- 模板默认补空、显式覆盖 diff/撤销、类目变化兼容提示和文件导入歧义阻断。
- 两个编辑上下文的乐观并发冲突、重新加载和显式合并。
- 草稿 handoff 成功移出、事务失败保留、页面加载不产生隐藏写入。
- 发布中心选择、全选、隐藏选择数。
- 排队、失败、结果未知、官方驳回。
- 手动刷新部分成功。
- 手动刷新只创建一个服务端 operation，不允许浏览器按版本 fan-out 调 SHEIN；重复点击复用同一 operation。
- 审核中心 counts、rows、eligibility 和 freshness 必须来自同一 snapshotRevision；重复/乱序回执不得使状态倒退。
- 发布请求返回 202 后，当前 operation 的 SSE 逐项显示 durable queued、sending、SHEIN accepted、known failed 或 result unknown；断线重连不重复写 SHEIN。
- 合规详情与图片槽位。
- 商品/尾图/合规使用同一 UploadQueue/Picker 契约；逐图失败隔离、替换/排序可撤销、刷新后状态可恢复。
- 15/50/100 图上传和预览不把原图字节放入 React State、Query Cache 或 Draft JSON。
- 桌面 1280px 和窄屏。

### 完成门

- CI 失败无法生成正式制品。
- staging 与生产配置和数据完全隔离。
- release manifest 能证明 control 与所有相关 Worker 同版本。

## 11. ERP-04：商品生命周期与状态字典定稿

### 目标

先用业务语言定义唯一状态模型，结束 UI、Service、Worker 和数据库各自解释状态。

### 本步骤只做设计

不得改代码、数据库或生产。需要用户批准状态名称和工作流后才能 COMPLETE。

### 必须分开的六个维度

1. 本地可编辑状态：editing、blocked、ready、handed_off、archived。
2. 传输状态：not_started、queued、claimed、submitting、accepted、known_failed、result_unknown。
3. 官方审核状态：not_received、pending_review、pricing、sample、design_review、sample_review、final_review、approved、rejected、withdrawn、unknown。
4. 上架状态：not_listed、listed、off_shelf、deleted、unknown。
5. 合规状态：not_checked、pending、needs_action、passed、unsupported/manual、unknown。
6. 系统健康状态：fresh、stale、partial、service_unavailable、permission_denied。

### 必做清单

1. 为每个状态定义事实源、进入条件、退出条件和终态。
2. 定义同一 SKC 多版本时“当前尝试”和“历史尝试”的选择规则。
3. 定义旧驳回与新重新发起的优先级。
4. 定义 result_unknown 的恢复和禁止重发规则。
5. 定义页面允许出现的中文标签。
6. 禁止通用“已发布”；只允许“排队中”“SHEIN 已接收”“审核中”“已上架”等精确标签。
7. 定义草稿、发布批次、审核中心之间的归属。
8. 建立状态转换表和非法转换表。
9. 将所有历史用户问题映射到状态不变量。
10. 定义 ProductFamily、CatalogProduct、CatalogSku、ProductDraft、ProductVersion、PublishAttempt、PlatformProductLink 和 OfficialProductProjection 的唯一职责。
11. 定义地毯业务默认“一件 CatalogProduct 对应一个计划中的 SKC、不同尺寸对应 SKU”的边界及多 SKC ProductFamily 例外。
12. 定义 current_version/current_attempt 的推进规则和 supersede/parent attempt 关系；禁止按更新时间猜当前尝试。
13. 定义“返回编辑”“修正并重发”“作为新商品创建”和 approved/listed 后编辑的合法转换。
14. 定义 ProductDraft 只含编辑状态，官方审核、上架和合规状态不得写回草稿万能状态。
15. 将“命令执行状态”“结果核对状态”“SHEIN 官方审核状态”定义为三个正交状态机；不得用 completed 同时代表 SHEIN 已接收、核对完成、审核结束或合规完成。
16. 定义 `send_started` 为外部写入不可安全自动重试的边界，并给出 crash-before-send 与 crash-after-send 的合法恢复矩阵。
17. 为官方审核建立稳定 code 字典、未知值策略和 source map version；中文文案只用于展示，不得作为分类输入。
18. 将 `needs_action` 定义为 authoring/publish/review/reconciliation 原因的运营聚合视图，不得伪装成 SHEIN 官方审核状态。

### 交付物

- Lifecycle ADR。
- 状态字典。
- 转换矩阵。
- UI 标签和筛选映射。
- 兼容旧状态的迁移策略。

### 完成门

- 任一页面状态都能回答“来自哪个字段、哪个版本、哪个时间”。
- 一个商品不会同时属于两个互斥当前页签。
- 用户批准业务名称和页面归类。
- 任一当前状态都能回答对应 CatalogProduct、ProductVersion、PublishAttempt 和 SHEIN 身份；旧尝试只在 timeline。

## 12. ERP-05：历史数据证据盘点

### 目标

在不修改数据的前提下，解释历史草稿、批次、job、run、receipt、审核和 SHEIN 标识之间的真实关系。

### 只读范围

- product_drafts
- publish_batches
- publish_batch_items
- publish_jobs
- publish_execution_runs
- publish_receipts
- 审核/商品/合规投影
- spus、skcs、skus 和 PlatformProductLink 候选关系
- media_asset_references、规则/模板/schema snapshots
- Redis 队列和 Worker 日志
- Webhook 原始事件、document-state 查询结果、SPU readback、official receipt、product_review_states、current review row 与 unmatched/conflict 记录

### 必做清单

1. 按 tenant/store/SKC/version 建立关联报告。
2. 分类 queued、claimed、submitted、accepted、failed、result_unknown、completed。
3. 找出 draft 仍可见但已有执行记录的商品。
4. 找出 job 与 batch item/batch 状态不一致。
5. 找出旧 rejected 覆盖新 attempt 的记录。
6. 找出缺少 version、document、SPU、SKC 或 receipt 的记录。
7. 找出 stale running/claimed 和未结束 execution run。
8. 区分可安全自动修复、必须官方回读、必须人工决策、禁止重试。
9. 输出每类数量和具体 ID 清单，不输出密钥或完整 payload。
10. 找出 mutable draft 被多个 Publish Job/版本复用、published/archived 草稿被直接重发和无法还原提交内容的记录。
11. 找出仅凭名称、supplier code、时间或 SKC 推断商品/当前尝试的歧义关系。
12. 找出草稿引用已释放但历史 Version/Attempt 仍需要的媒体和规则快照。
13. 将历史记录分类为 mapped、legacy_unversioned、unmatched、conflict，不伪造 ProductVersion 或平台映射。
14. 输出草稿页自动 revalidation、并发覆盖和 LIMIT 100 对实际数据规模的影响报告。
15. 对照每个 store/version/document/Attempt 盘点 Webhook、document-state、SPU readback、receipt、projection 和页面行，标记 duplicate、out_of_order、unmatched、conflict、stale 与 source_failed。
16. 证明审核中心计数、列表、选择资格和更新时间是否来自同一数据库版本；记录浏览器 fan-out 和服务端二次归并路径。
17. 对照对象存储盘点 MediaAsset、引用、purpose/status/hash、Draft/Template/Publish/Compliance JSON、SHEIN 图片 URL/MD5/trace 和清理候选。
18. 分类 verified、unverified_hash、missing_object、orphan_object、unknown_role、retention_conflict、embedded_platform_receipt；不读取或输出图片字节。
19. 核对发布完成释放 Draft 媒体前是否已有不可变 ProductVersion 引用，并列出所有无法证明所有权连续性的记录。

### 完成门

- 100% 历史记录进入一个证据分类或明确 UNKNOWN。
- 没有执行 UPDATE、DELETE、重试或清队列。
- ERP-20 的修复范围可以由报告精确指定。

## 13. ERP-06：规范数据模型与事件账本

### 目标

建立一个当前状态记录和不可变历史事件分离的数据模型；只有证据支持时才新增表或字段。

### 原则

- 当前状态只存一份规范投影。
- 尝试、回执、Webhook 和状态转换作为追加式事件保存。
- Redis 是传输工具，不是业务真相。
- 所有迁移只做前向兼容，不重写已执行迁移。

### 必做清单

1. 基于 ERP-05 做 gap analysis，能复用现表就不新增。
2. 定义 product lifecycle current projection。
3. 定义 publish attempts、official receipts、events、outbox、inbox。
4. 定义唯一键：tenant/store/product/version/idempotency。
5. 定义数据保留、审计不可变和敏感字段脱敏。
6. 设计 additive migration、preflight、verify、rehearsal 和 rollback boundary。
7. 验证运行时最小权限矩阵。
8. staging 演练迁移和回退应用版本。
9. 对现有 store/openKey/supplier/access/draft/publish/review 引用执行只读身份碰撞和孤儿关系审计。
10. 将稳定 `Store`、`PlatformIdentity`、`StoreConnection`、版本化凭证、店铺健康、生命周期和授权尝试分开建模；不得用可轮换凭证标识替代永久 storeId。
11. 定义 lifecycle、connection、operational、freshness 四维状态及其合法组合，停止使用万能 `stores.status` 承担全部语义。
12. 设计新增授权完成的单事务提交、幂等 attempt、失败回滚和追加式 StoreEvent。
13. 设计断开后历史可读、远端动作受限且成员/团队访问关系保留的读写门禁。
14. 在现有身份数据 100% 可解释前，不增加生产唯一约束、不合并店铺、不删除旧字段或访问关系。
15. 定义 CatalogProduct、CatalogSku、可选 ProductFamily、ProductDraft revision 和不可变 ProductVersion 的 additive 模型。
16. 为 ProductDraft 增加 schemaVersion、revisionNo、baseVersionId 和 lockVersion/ETag 语义，数据库更新必须检查期望版本。
17. ProductVersion 冻结内容、SKU、类目、规则、模板、预检、媒体顺序/用途和 fingerprint；普通业务路径不可更新。
18. PublishAttempt/Job/BatchItem additive 关联 productId、productVersionId、parentAttemptId、supersedesAttemptId 和 reason。
19. 建立 store-scoped PlatformProductLink，连接本地商品/版本/尝试与 document/version/SPU/SKC/SKU 官方身份。
20. 建立显式 currentVersion/currentAttempt projection 和 ProductEvent；不引入全量 event sourcing。
21. 采用“核心身份关系规范化 + 动态类目内容版本化 JSONB”，不把全部 SHEIN 动态字段拆列。
22. VersionMedia 建立独立素材所有权后才允许释放 Draft 引用。
23. 定义版本化 ProductFormSchema、规范字段路径、unknown 语义和 Draft hydration/serialization adapter 契约。
24. 模板记录稳定 ID、不可变 version、tenant/store scope、schema compatibility、fingerprint 和字段/区段 provenance。
25. 草稿序列化保留无法识别的 legacy 扩展字段并告警，禁止读取即写回或静默丢弃。
26. 增加 PublishBatch、PublishAttempt、PublishCommand、PublishCommandEvent、PublishReceipt、PublishOutbox 的规范关系；Command 必须绑定不可变 ProductVersion。
27. Command/Event/Outbox、Draft handed_off 和 currentAttempt 指针在一个 PostgreSQL 事务中提交，Redis/BullMQ 不作为业务真相。
28. PublishCommand 保存确定性 idempotencyKey、payloadFingerprint、candidateFingerprint、sendStartedAt、lease/claim 和 parentAttempt 证据。
29. Receipt/Event 采用追加式、幂等写入并保留原始响应摘要；current projection 必须可从证据重建。
30. 定义 OfficialEventInbox、OfficialReviewReceipt、ReceiptMatch、AttemptReviewProjection、CurrentReviewPointer 和 ReviewCenterPreference；官方当前投影与本地归档偏好分离。
31. Webhook、document-state、SPU readback 和补偿查询均先进入统一 Inbox/Normalizer/Resolver/Reducer，不允许各自直接更新当前审核状态。
32. raw event 与 normalized receipt 追加式保存；receipt/match/projection/current pointer 在一个数据库事务中提交，失败不得留下半条当前状态。
33. CurrentReviewPointer 只能由显式 version/document/PlatformProductLink/parent-supersedes 证据推进，禁止按更新时间或“最新一行”猜测。
34. 定义 MediaUploadSession、immutable MediaAsset、MediaVariant、MediaReference、MediaShareGrant、PlatformMediaReceipt、MediaRetentionHold 和 MediaDeletionEvent。
35. 将生命周期/保留类别与业务 role/slot/order 分离；MediaReference 必须绑定 ownerId/ownerVersion/provenance，Asset purpose 不再承担业务用途。
36. ProductVersion Media Reference、Draft handoff、Command/Attempt 指针在同一事务建立；Version 引用成功前禁止释放 Draft 引用。
37. PlatformMediaReceipt 按 tenant/store/variantHash/imageType/adapterContractVersion 唯一归并，并保留 trace/URL/MD5/有效状态。

### 禁止

- 修改已执行迁移文件。
- 直接删旧列或将历史状态批量覆盖。
- 在没有备份和用户批准时运行生产迁移。

### 完成门

- migration rehearsal 全部通过。
- 旧代码在迁移后仍可读取必要数据。
- 当前状态和历史事件能独立解释。
- 授权事务失败不会留下 active 空店铺、孤儿凭证、错误访问关系或假完成 attempt。
- 指定店铺重授权后 storeId、历史、成员权限、店铺组和业务引用不变。
- disconnected/revoked 历史店铺可按原权限读取，所有远端动作 fail closed。
- ProductVersion 与 PublishAttempt 一一可追溯，任一历史提交可重现其内容、SKU、规则和媒体证据。
- 并发旧 lockVersion 更新返回冲突，不发生静默覆盖。
- 官方映射冲突 fail closed，不能按名称或 supplier code 自动合并商品。

## 14. ERP-07：SHEIN 适配器契约硬化

### 目标

让 SHEIN transport、字段校验、错误、限流和回读成为可测试的单一适配层。

### 必做清单

1. 为每个已用 endpoint 建立官方原文来源、method、path、headers、request/response schema。
2. 标记 read、write、mixed，禁止调用未验证写 endpoint。
3. 固定 batch limit、QPS、timeout、retry class 和 idempotency 能力。
4. 原样保留 code、message、traceId 和失败明细。
5. 区分业务拒绝、权限、限流、网络失败、结果未知和结构错误。
6. 建立契约 fixture 和 schema validation。
7. 文件上传和商品发布分离；媒体用途和字段映射单独测试。
8. 校验 quota、permission、supplier SKU duplicate 的真实预检。
9. 禁止控制器和页面直接拼接 SHEIN payload。
10. 对照当前官方资料验证 openKey、supplier/platform identity、店铺状态接口和 `/authorization_change_notice` 的真实语义。
11. 将新增授权和指定 `targetStoreId` 重授权定义为两个目的明确的适配器契约；身份不匹配绝不覆盖原连接。
12. 区分凭证/签名失效、官方撤销、IP 白名单、网络、限流、平台 5xx、店铺关闭和业务能力拒绝。
13. 授权回调只向浏览器返回 attemptId 与稳定结果码，原始错误和 trace 保留在服务端诊断链路。
14. 建立授权回放、过期、跨租户、错误 target、身份不匹配和并发较旧回调的契约 fixture。
15. 定义浏览器 validation 与服务端 preflight 共用的稳定错误码、字段/SKU/媒体路径、schemaVersion 和 blocker/warning 语义。
16. 商品编辑器、控制器和批量页不得各自拼 SHEIN payload；发布候选只由服务端规范 adapter 生成。
17. 商品发布适配器输出统一结果分类：accepted、known_failed、result_unknown、not_attempted；HTTP 200 或成功码本身不构成 accepted。
18. accepted 必须取得当前 endpoint 契约要求的完整官方身份或接收证据；身份字段不完整时进入 result_unknown。
19. 对每类错误明确 `safe_before_send_retry`、`manual_new_attempt`、`readback_only` 和 `terminal`，禁止通用 HTTP retry middleware 重试商品写请求。
20. 为 receive/audit/workflow/document-state/SPU readback 建立原始值到稳定审核 code 的独立 source map，并记录 mapVersion；未知原值进入诊断区，不映射成待审核或驳回。
21. 明确空列表、未找到、尚无回执、权限、限流、结构异常和服务不可用的不同语义；空回读不得覆盖 last-known-good 投影。
22. 为商品主图、详情图、方图、色块图、站点详情、SKU 图和合规媒体建立 role → SHEIN imageType/endpoint 的版本化契约 fixture。
23. 图片上传成功只有在当前 endpoint 要求的 URL/MD5/标识和 trace 证据完整时才生成 PlatformMediaReceipt；缺失进入 result_unknown。
24. 同店回执复用必须同时匹配 variantHash、imageType 和 contractVersion；跨店回执永不复用。

### 完成门

- 关键 endpoint 均有官方来源和自动契约测试。
- 未识别字段或状态 fail closed，不猜测。
- 技术重试不会重试业务拒绝或结果未知写请求。
- IP 白名单、限流、网络和 SHEIN 5xx 不会清凭证或错误标记为需要重授权。
- 重授权只更新匹配目标店铺的连接/凭证版本，不能创建隐式重复店铺或覆盖其他身份。

## 15. ERP-08：Control、Worker 与 release 一致性

### 目标

从架构上杜绝 control 已更新、Worker 仍运行旧代码导致的数据库投影漂移。

### 必做清单

1. 每个进程暴露 releaseId、source revision、image digest 和 schema range。
2. control 与 Worker 启动时做版本兼容握手。
3. 版本不兼容时 control 阻止新的发布/同步命令，并给出可操作错误。
4. release manifest 列出所有服务和实际 hash。
5. 部署工具按 owner 只更新相关服务，但必须校验依赖 Worker 同版本。
6. ready endpoint 检查 DB/Redis 之外还检查关键 Worker heartbeat。
7. 部署后对比实际容器创建时间、镜像和 manifest。
8. 建立 worker stale/missing 告警。
9. Outbox Dispatcher、Publish Worker 和 Control 使用同一 release/schema compatibility；Dispatcher 只投递 durable Command，不解释业务成功。
10. Publish Worker 是唯一真实 SHEIN 商品发布写 owner；Control、Browser、回读 Worker 和修复脚本不得直写发布 endpoint。
11. 就绪检查同时验证 Worker heartbeat、Dispatcher heartbeat、积压、最老未投递 Outbox 和 live-write enablement，不得把“页面在线”等同于“发布可用”。

### 完成门

- 人为启动旧 Worker 时测试会阻止新任务。
- 线上诊断页能看到每个进程版本。
- 同一 release 的相关服务 hash 一致。

## 16. ERP-09：可靠发布命令管线

### 目标

实现“命令持久化后再入队、每次只执行一次、结果未知绝不重发”的可靠发布主干。

### 必做清单

1. 用户提交时在一个事务中冻结草稿快照、创建 command/attempt 和 outbox。
2. outbox 负责可靠入 BullMQ；入队失败不能丢失命令。
3. Worker 用数据库原子领取和租约，不只依赖 Redis active 状态。
4. 每个请求使用稳定 idempotency key 和一次性授权。
5. claim、submit、accepted、known failure、result unknown 全部持久化。
6. 业务拒绝不重试；网络/限流只按官方和协议允许重试。
7. submit 后断线进入 result_unknown，必须先官方回读。
8. job、batch item、batch 和 current lifecycle 在同一事务投影。
9. 每个商品独立结果，批次部分失败不覆盖成功项。
10. 额度、保证金、权限、SKU 重复在入队前阻断并显示真实错误。
11. 每个命令引用已冻结 ProductVersion，不再从 mutable ProductDraft 现场读取候选。
12. 同一 Draft revision 只能成功 handoff 一次；重复请求幂等返回原 Version/Attempt。
13. 重发必须创建新 Attempt 并记录 parent/supersedes/reason；需要修改内容时先创建新 Draft revision 和 ProductVersion。
14. result_unknown 阻断同一业务键的新发布，不自动创建可提交 revision。
15. currentVersion/currentAttempt、handoff 事件、command 和 outbox 在一个事务或可证明幂等的 reducer 中推进。
16. 每个 PublishCommand 对应一条 BullMQ Job，jobId 使用 commandId；禁止一个 execution run 的队列消息在 Worker 内循环抽干整批。
17. 商品发布 Queue 显式 `attempts=1`；Outbox 可在发送前安全重投同一 commandId，`send_started` 后无明确结果只允许进入 result_unknown。
18. Worker 在调用 SHEIN 前先持久化 `send_started`；领取超时只能依据该边界恢复，不能一律重跑或一律伪装 unknown。
19. 发布请求完成 durable handoff 后立即返回 `202 + operationId`；不得在创建请求内以 150ms 轮询阻塞至 8 秒等待结果。
20. 批次有阻断项时返回 eligible/blocked 明细；只有用户显式确认后才发布 eligible 子集，单个 blocker 不得把其他 eligible 项写成失败。
21. pause/cancel 只作用于 `send_started` 前的 Command；accepted、known_failed 和 result_unknown 只能走核对或新 Attempt。
22. 主商品 accepted 与合规照片/复验拆成独立命令和状态；附属流程失败不得反写主商品为发布失败。
23. 每店默认一个在飞商品写请求；跨店调度采用公平队列和全局有界并发，最终参数由 2 核 4GB 压测确定。
24. Publish Worker 只从 immutable ProductVersion MediaReference 解析图片；不得从 Draft JSON、当前模板或浏览器 URL 现场组装。
25. SHEIN 图片上传和商品提交分开留 PlatformMediaReceipt；图片 result_unknown 阻断当前候选，不伪造 URL 或盲目重复上传。

### 测试场景

- 重复点击。
- control 在入队前崩溃。
- 入队后 Worker 崩溃。
- SHEIN 接收前超时。
- SHEIN 接收后连接断开。
- 业务拒绝。
- Redis 重启。
- Worker 版本不匹配。
- 同批次部分成功。
- 同一草稿重复 handoff。
- handoff 事务中途失败。
- mutable 草稿在 handoff 后被并发修改。
- 驳回修正重发与“作为新商品创建”。
- 数据库事务已提交但进程在 BullMQ add 前崩溃。
- 同一 Outbox/commandId 被 Dispatcher 重投多次。
- Worker 在 `send_started` 前后两个故障点分别崩溃。
- 批次同时包含 eligible 与 blocked 项。
- 合规照片提交失败但主商品已被 SHEIN 接收。

### 完成门

- 所有故障场景都有确定状态和恢复路径。
- 没有路径能把 queued 显示为 SHEIN 成功。
- 没有路径会自动重发 result_unknown。
- Worker 只能处理不可变 ProductVersion，旧 Attempt 永远保留原版本证据。
- 任一 durable Command 最终均可证明“未发送、已接收、明确失败或结果未知”，不存在数据库已提交但永远未投递的静默缝隙。
- 同一 commandId 的重复投递不产生第二次 SHEIN 写；无法证明未写时必须停在 result_unknown。

## 17. ERP-10：官方审核回读与状态投影

### 目标

让 Webhook、手动刷新和补偿查询使用同一个 reducer，官方状态成为审核真相。

### 必做清单

1. 统一接收通知、审核通知、query-document-state 和 SPU readback 解析。
2. 使用 version、document、SPU、SKC/SKU 做不歧义关联。
3. 官方回读与本地投影持久化解耦；投影部分失败仍返回已取得的官方结果。
4. 当前版本优先，旧版本只进历史时间线。
5. 重新发起后，旧驳回不能继续占据当前驳回页。
6. 手动刷新先重新读取本地目标，再分批回读。
7. 单项失败保留其他成功项，并返回 partial result。
8. 空结果、未找到、无权限、限流和服务不可用分别建模。
9. Webhook 丢失时手动刷新可最终收敛。
10. 不增加全站自动同步；活动操作可以短时监听。
11. 通过 PlatformProductLink 和显式 Attempt 关系关联 version/document/SPU/SKC/SKU；无法关联进入 unmatched，不猜测。
12. current attempt 由规范 reducer 推进，旧版本按 supersede 关系进入 timeline，而不是按更新时间压制。
13. 一次 Attempt 关联多个官方事件时保持同一业务 attemptId；乱序/重复事件幂等。
14. 官方 SPU/SKC/SKU 投影保持只读，不被本地草稿保存覆盖。
15. result_unknown reconciler 只执行 Webhook/官方只读查询和证据归并，不调用商品发布写接口。
16. 核对采用确定性时间窗、查询次数和证据等级；一次空回读不得直接证明 SHEIN 未接收，也不得自动开放重发。
17. 所有官方来源先写 OfficialEventInbox，再由同一 ReviewNormalizer、AttemptResolver 和单调 ReviewReducer 生成投影；任何入口不得旁路写当前状态。
18. 回执采用统一 envelope：tenant/store/source/sourceEventId/observedAt/occurredAt/version/document/SPU/SKC/SKU/rawRef/mapVersion/normalizedStatus/evidenceLevel。
19. Attempt 仅允许 exact_match；歧义、冲突和无匹配进入 unmatched/conflict 诊断区，不能进入正常页签、计数或批量动作。
20. Reducer 按 Attempt 与官方事件证据单调归并；重复事件幂等、迟到旧事件不倒退状态，新 Attempt 通过显式 supersedes 成为 current。
21. 命令执行、结果核对和官方审核保持三个正交投影；`needs_action` 由原因码聚合，不写成官方状态。
22. 手动刷新创建 `202 + refreshOperationId`，服务端解析目标、去重、限流、分批读取并逐项落 Inbox；浏览器不得直接并发调用多套回读接口。
23. 不做 30 秒、切店、进页、窗口聚焦自动同步；仅在用户触发的活动 operation 内使用 SSE 或有上限短轮询。
24. 单来源失败、局部持久化失败或 Redis/SSE 不可用时保留 last-known-good，标记 partial/stale 和 source health，不得返回假 0 或清空列表。

### 完成门

- 同一 fixture 经 Webhook 和手动刷新得到完全相同状态。
- 分类计数、列表和详情来自同一 resolution。
- 官方驳回、待核价、待寄样、待审版、待核样、待终审、通过均可测试。
- 同名、同 supplier code、多 version 和 versionless 历史数据不会错误合并或选错当前尝试。

## 18. ERP-11：审核中心统一快照 API

### 目标

让顶部计数、页签、列表、选择资格和更新时间来自同一数据库快照，消除“计数 0、列表有数据”。

### 必做清单

1. 设计一个服务端快照响应：counts、rows、eligibility、freshness、active operations。
2. 在同一事务/一致性快照中计算计数和行。
3. 服务端分页、筛选、搜索和排序。
4. 每行提供稳定 row identity，不用标题或临时数组位置。
5. 选择资格由服务端明确返回，不让 UI 猜测。
6. 只返回当前尝试，历史从独立 timeline 获取。
7. 同一 SKC 在当前快照中最多一行。
8. 缓存 key 包含 tenant/user/store/filter/snapshot。
9. 每行返回 catalogProductId、productVersionId、publishAttemptId、platform link 摘要和明确 current 标识。
10. 当前 Attempt 与历史 timeline 使用不同 endpoint/read model，当前列表不靠前端去重。
11. unmatched/legacy_unversioned/conflict 进入明确诊断分区，不混入正常当前计数。
12. 商品详情可读取当前线上版本、当前编辑 Draft、当前审核 Version 和完整 Attempt 时间线。
13. 快照逐行返回 command execution、reconciliation 和 official review 三组状态，不用一个万能 flowStatus 合并。
14. active operation 只来自与当前 snapshot/attempt 明确关联的 Command；SSE 更新通过 snapshot version/reducer 合并，不能由前端临时改写官方页签。
15. Snapshot v2 只读 PostgreSQL 规范投影，在同一个 repeatable-read/等价一致性事务内计算 counts、rows、eligibility、freshness、sourceHealth 和 snapshotRevision；不得在请求内调用 SHEIN。
16. rows 和 counts 必须使用同一过滤谓词、current pointer 和 revision；分页响应返回 total、nextCursor 和 serverAppliedFilters。
17. source failure 返回最后可信行及 stale/partial 证据；只有“查询成功且当前结果真实为空”才允许 empty，不得用异常默认空数组生成 0。
18. 选择令牌绑定 store/filter/snapshotRevision/eligibleSet；快照变化或 eligibility 变化返回 409 和差异，不执行隐藏选择。

### 完成门

- counts 与 rows 在所有筛选下对账。
- 同一 SKC 不会同时出现在互斥页签。
- UI 不再拼接多套本地/外部数组推导当前状态。

## 19. ERP-12：草稿到发布批次交接闭环

### 目标

让草稿箱只展示需要编辑或待发布的商品；已经成功交接到发布命令的商品从默认草稿箱移除，但审计数据保留。

### 业务规则

- editing、blocked、ready：显示在草稿箱。
- preflight failed：留在草稿箱并精确定位错误。
- command durably created：转 handed_off，从默认草稿箱移除。
- known business failure requiring edit：创建或恢复可编辑 revision，回到 needs_action。
- result_unknown：只在发布/审核中心显示，禁止回到草稿箱重复提交。
- official rejected：进入审核中心已驳回，可创建新编辑 revision；旧尝试留历史。

### 必做清单

1. 服务端实时预检，不信浏览器旧 ready 状态。
2. 冻结 immutable publish snapshot。
3. 在一个事务中完成 handoff 和 command 创建。
4. 草稿默认查询只返回可编辑状态。
5. 物理记录不删除；详情可查看来源、版本和 handoff 时间。
6. 批量选择只操作当前可见且 eligible 的草稿。
7. handoff 失败不移除草稿。
8. 页面刷新后状态仍一致，不依赖前端临时过滤。
9. 历史 33 个或其他已提交草稿只在 ERP-20 受控清理投影。
10. handoff 前校验 Draft lockVersion，并冻结 ProductVersion、VersionSku、VersionMedia 和规则/模板 snapshot。
11. handoff 事务同时创建 Attempt/command/outbox、设置 handed_off、推进 current 指针和写 ProductEvent。
12. 默认草稿查询按 editing status 读取，不再以“是否存在任意 publish_job”作为唯一归属条件。
13. 草稿页面加载为纯读；后台重校验不得保存草稿，规则变化只提示用户或在 handoff 前强制执行。
14. known failure 只在用户显式“返回编辑”后从对应 Version 派生新 revision。
15. official rejected 的“修正并重发”与“作为新商品创建”是两个明确动作。
16. 草稿普通删除改为归档/回收站语义，永久删除不属于本流程。
17. 草稿列表使用服务端分页、总数和稳定游标，不硬截断 100 后让 UI 误判总量。
18. 草稿批量模板和批量选择必须使用与单品相同的 TemplateApplicationEngine/eligible 规则，并按当前 snapshot 返回逐项结果。
19. handoff 事务必须同时写 PublishCommandEvent 和 PublishOutbox；事务成功即退出默认草稿箱，BullMQ 暂时不可用也不得回滚成可重复提交草稿。
20. 批量 handoff 返回每项 eligible/blocked/handed_off 结果；用户未确认 eligible 子集时不得创建任何发布命令。
21. handoff 事务必须冻结 VersionMedia 的 asset/variant/role/slot/order/hash/transformVersion；任一引用失败整项回滚且 Draft 保留。
22. 只有 VersionMedia 完整性断言通过后才能释放 Draft MediaReference；Draft 删除、归档和默认列表移除都不能替代此断言。

### 完成门

- 一件商品不能同时出现在默认草稿箱和当前审核列表。
- 页面刷新、切店、重新登录后结果保持一致。
- 失败和结果未知不会制造重复提交入口。
- handoff 成功后 Draft、Version、Attempt 和页面归属在一个事实时间点一致。
- 读取草稿箱不会产生数据库写入或 SHEIN 请求。

## 20. ERP-13：发布与审核中心商业级前端

### 目标

在不改变后端真相的前提下，重做该板块的交互所有权、选择模型和动态反馈。

### 先设计后实现

先输出行为规格和低保真稿，经用户批准后再写 UI。不得自行改变全站壳层。

### 必做清单

1. 一个表头全选框、每行一个选择框，DOM 和可访问名称唯一。
2. 默认全选只选择当前可见页；“选择全部 N 条结果”必须是第二个明确动作。
3. selected IDs 作用域包含 tenant/store/tab/filter/snapshot，切换任何一项都清理。
4. 按钮数量等于实际可见选择，不保留隐藏选择。
5. 动态发布进度显示排队、发送、SHEIN 接收、待回读、结果未知和失败。
6. 发布/重发成功的行只在服务端确认 durable transition 后移出当前列表。
7. 用户操作后的 2–3 秒快速反馈使用 SSE 或有上限短轮询；终态后立即停止。
8. 手动刷新显示成功、部分成功、空回读和失败明细。
9. 页签、顶部卡片和列表共用 ERP-11 快照。
10. 错误保留 code、message、traceId，支持复制 operationId。
11. 支持桌面 1280px、窄屏、键盘和屏幕阅读器。
12. 大量记录服务端分页；只有阈值以上才启用虚拟列表。
13. 草稿、Version、Attempt 和官方商品使用不同中文名与入口，不再统一称“商品/已发布”。
14. 商品详情展示线上版本、编辑版本、审核版本和历史版本 diff，不允许原地编辑已提交版本。
15. 驳回操作明确选择“修正并重发”或“作为新商品创建”，并预览将创建的 Draft/Product 关系。
16. 发布按钮提交后以 202 operation 为中心显示逐项进度；只订阅当前 operation 的 SSE，断线后用 `Last-Event-ID` 或 operation snapshot 恢复。
17. 页面文案严格区分“命令已创建”“发送中”“SHEIN 已接收”“结果待确认”“明确失败”“官方审核中”，禁止把本地 durable handoff 显示为发布成功。
18. 批次摘要同时显示总数、eligible、blocked、accepted、known failed、unknown；逐项状态是最终依据，aggregate 不覆盖单项。
19. 审核中心只消费 Snapshot v2 的稳定 code 和 allowedActions，不在 React 中合并 Draft/Batch/Readback/Review 或解析中文状态字符串。
20. Webhook、手动刷新和核对完成后的动态移行以服务端 projection revision 为准；SSE 只通知 revision/operation 变化，客户端重新取快照，不乐观伪造官方状态。
21. 刷新中、partial、stale、source unavailable 和 last-known-good 分开展示；一次来源失败不覆盖页面上仍可信的数据。
22. 归档/隐藏是用户界面偏好，只影响本地 Preference 和默认可见性，不改变官方投影、计数事实或历史 timeline。

### 回归场景

- 已驳回单选、全选、取消、重发。
- 只有 4 条可见时按钮不得显示 15。
- 切换页签/店铺后无隐藏选择。
- 重新发起后从已驳回移出并进入正确新状态。
- 手动刷新部分失败。
- 服务不可用后保留旧数据。
- 旧版本驳回留历史、不占当前列表。
- 并发编辑 409、版本 diff、重新加载和显式合并。
- 商品详情 current/online/editing/review 四种版本关系。

### 完成门

- Playwright 和视觉回归全部通过。
- 页面状态与 ERP-11 响应逐项一致。
- 无重复复选框、隐藏选择、伪发布文案和自动同步。

## 21. ERP-14：商品编辑器与预检闭环

### 目标

建立统一 `ProductWorkbench` 领域内核，让单品、批量和草稿批处理共享同一 ProductFormModel、schema、模板引擎、验证、保存和服务端预检；在保持现有已验证行为与视觉的前提下渐进拆分巨型页面。

### 必做清单

1. 先建立现有字段、验证、模板、图片和保存行为的黄金回归。
2. 将 3000+ 行页面按标题、类目属性、销售属性、SKU、包装、媒体、合规、预检拆分。
3. 表单状态使用统一 schema 和表单 owner，不复制多个局部 truth。
4. 动态类目、属性和填写规范只来自当前 SHEIN 快照。
5. 自动保存只保存安全草稿；正式 handoff 仍需显式操作。
6. 错误摘要可定位到字段/SKU/图片。
7. 预检输出 frozen snapshot、fingerprint、blockers 和 warnings。
8. 旧草稿通过兼容适配器读取，禁止静默丢字段。
9. 性能上避免每次输入重算全表或重复下载图片。
10. 保存请求携带 lockVersion/ETag；冲突不得自动覆盖服务器版本。
11. 表单读取/打开不触发会持久化的规则重校验；显式预检和 handoff 前预检共用服务端 owner。
12. 草稿内容保留 schemaVersion；规则和模板更新不反向改写已冻结 ProductVersion。
13. 从历史 Version 返回编辑时生成新 revision，并显示与 baseVersion 的字段/SKU/媒体差异。
14. 完成 BUILD-01～BUILD-17 的分步交付映射；BUILD-01～08 未通过前不得继续复制页面级模板/验证逻辑。
15. 建立统一 ProductFormModel，规范 identity、schema、content、attributes、sales attributes、SKU、pricing、inventory、packaging、media、compliance、publish settings、template provenance 和 UI 临时状态。
16. 所有字段更新通过明确 command/patch；section 只渲染和派发命令，不维护第二份业务 truth。
17. 单品、批量和草稿批处理对同一输入必须生成一致的规范 Draft payload。
18. 批量页定位为协调器：每件商品独立模型，公共编辑编译为统一 patch，逐项结果、部分成功和有界并发。
19. 文件夹导入建立确定性命名/后缀/Unicode/重复/隐藏文件 contract；主图、详情图、SKU 图映射歧义必须阻断。
20. SKU 行使用稳定 localRowId；批量填充先预览、可撤销，unknown 与 0 分离，错误定位到具体行/字段。
21. 类目/schema 变化先显示失效属性、SKU、模板和合规 diff；当前快照变化不静默重写草稿。
22. 自动保存只写 mutable Draft，使用串行/latest-wins 合并与 lockVersion，不调用 SHEIN、不 handoff、不改变审核状态。
23. AI、媒体预览和可选合规服务失败不阻断人工标题、编辑和安全保存。
24. 域重构与视觉调整分开 Run；每个垂直切片同时通过单品、批量、草稿批处理和 payload 对等回归。
25. 新旧实现并存时只允许一个生产写 owner；影子路径只能只读 diff。
26. 图片 section 只操作规范 MediaReference command；main/detail/square/swatch/site-detail/SKU/tail 不再各自维护独立 asset 数组 truth。
27. 替换、移动、删除和模板追加均生成明确 role/slot/order diff，并可撤销；已冻结 ProductVersion 不受影响。
28. MediaPicker 返回 assetId/variantId，服务端验证 scope/integrity/role eligibility 后才建立 Draft Reference。

### 禁止

- 同时重做全站 UI。
- 在拆组件时改变发布状态机。
- 删除旧字段或旧草稿数据。
- 以减少行数为目标机械拆文件，或一次性重写整个编辑器。
- 让批量页、草稿页继续保留独立商品组装/模板 owner。
- 在页面加载、切店、自动保存或模板更新时调用 SHEIN。

### 完成门

- 黄金回归和浏览器 E2E 通过。
- 旧草稿打开、编辑、保存和预检没有字段丢失。
- 复杂页面有清晰 owner，单文件规模显著下降但没有为了行数制造空抽象。
- 两个浏览器并发编辑不会静默覆盖，页面加载无隐藏业务写入。
- 单品、批量和草稿批处理的同输入 payload 对等，模板/类目/SKU 行为无漂移。
- 15/50/100 商品批量 fixture 在目标资源内逐项隔离，单项失败不清空其他结果。
- AI、图片预览或可选合规能力故障时，人工编辑和草稿保存仍可完成。

## 22. ERP-15：媒体、模板与 AI 标题

### 目标

统一媒体引用、模板替换和 AI 标题的性能/错误边界，使 AI 永远不阻塞普通建品。

### 媒体

1. 以 media asset ID 和用途作为事实，不存 Base64。
2. 同店同素材稳定 URL、有界缓存、失败可重试。
3. 上传、排序、删除、放大和用途映射独立。
4. 图片字节不经过 control 中转。
5. 模板跨店读取必须验证来源媒体权限。
6. handoff 时为 ProductVersion 建立独立不可变媒体引用；只有建立成功后才能释放 Draft 引用。
7. 历史 Version 能还原 asset hash、用途、顺序和当时的 SHEIN 上传映射。
8. 建立独立素材中心和统一嵌入式 Picker/UploadQueue；素材中心负责治理，业务页面负责创建规范 Reference。
9. MediaAsset 原始内容不可变；裁剪、压缩、水印、缩略图和标准化结果使用不可变 MediaVariant。
10. 客户端 hash 只作提示；服务端通过对象 checksum 或受控流式 verifier 验证 hash、MIME、字节和尺寸后才能 ready。
11. 业务用途属于 MediaReference.role，SHEIN imageType 由服务端 adapter 映射，不写入 Asset purpose。
12. 同租户内容复用仍校验 tenant/store/user/compliance scope；不做跨租户去重或存在性泄露。
13. PlatformMediaReceipt 独立保存 store、variant、imageType、URL/MD5、trace 和 contractVersion。
14. 保留/删除由 Reference、RetentionHold、活动 operation、政策和回收期共同决定；reference_count 只作投影。
15. 上传、处理、回收和平台图片上传都有 operationId、逐项结果、幂等和故障恢复。
16. 原图字节不得进入 Draft JSON、React State 或 TanStack Query Cache；列表只加载 thumbnail/preview。

### 模板

1. 模板版本化并保存 schema fingerprint。
2. 普通引用只填空；显式重新引用才替换对应字段。
3. 执行前显示 diff：将新增、覆盖、保留和阻断什么。
4. 打包体积缺失不写伪值。
5. 单属性重新引用不清空其他区域。
6. 所有模板入口共用一个 TemplateApplicationEngine；批量逐商品应用并返回新增、覆盖、保留和阻断明细。
7. 模板拥有 tenant/store scope、type、不可变 version、schema compatibility、fingerprint 和 provenance。
8. 应用模式固定为默认 `fill_empty`、显式 `overwrite_selected_fields` 和高风险 `replace_section`；后两者必须确认且可撤销。
9. 手工字段优先于已应用模板，模板发布新版本不反向改变既有 Draft 或 ProductVersion。

### AI 标题

1. 复核 A0、A1、A2、A3 与生产 release，不直接假设历史修复已部署。
2. A0 先建立版本化 `TitlePolicyEngine`，覆盖长度、事实一致性、必填/禁词、语言、重复、标点和片段优先级；服务端为最终权威。
3. AI 是可选建议能力；Provider、Redis 或 AI Worker 故障不得阻断人工标题、Draft 保存、preflight、handoff 或发布。
4. 每次生成冻结 Draft revision、商品事实、currentTitle、locale、TitleRuleTemplateVersion、TitlePolicyVersion 和 MediaVariant/variantHash。
5. 建立持久 `TitleGenerationBatch/Request`、`AIGenerationAttempt`、`TitleCandidate`、`TitleDecision`、`AIUsageEvent` 和追加式 Event/Outbox。
6. PostgreSQL 是请求/候选真相；一 item 一 BullMQ Job，浏览器不再以 Promise Worker 作为批量任务唯一 owner。
7. Provider 调用使用版本化 Adapter/Profile；密钥加密，Endpoint 实施域名/出站 allowlist、DNS/IP/重定向 SSRF 阻断和稳定错误分类。
8. 调用前持久化 send boundary；发送后超时为 `result_unknown/cost_unknown`，不自动重试可能重复计费的请求。
9. Prompt、输出 Schema、Adapter、模型和 Policy 全部版本化并写入 Attempt，历史候选可重现。
10. A1 默认返回 2～3 个候选；确定性校验/排序后展示，不直接覆盖人工标题。
11. 用户采用、编辑后采用、拒绝或保留原标题形成 `TitleDecision`；采用创建受控 Draft revision/patch，可 diff/undo，手工值优先。
12. A2 将 `VisualRecognitionCache` 与 `FinalCandidateCache` 分离；键使用 variantHash、Provider/model/prompt/schema/policy/template/事实版本，错误与 unknown 不缓存为成功。
13. AI 图片使用受控 `ai_input` MediaVariant、短期票据或 Worker 受限流式读取；不长期缓存 Base64/原图字节。
14. A3 批量生成返回 `202 + batchId`，服务端公平调度、有界并发和逐项结果；刷新、断线、切店、Control/Worker 重启后可恢复。
15. 设置 tenant/store/user/provider 并发、队列、日/月预算和单批上限；用量区分 actual/estimated/unknown。
16. Trace 贯穿 batch/request/input/outbox/job/attempt/provider/candidate/decision/draft revision，页面只展示脱敏阶段、稳定错误和恢复建议。
17. Provider/Profile 故障可熔断该 Profile，但不隐藏 failover、不偷偷换模型、不影响 A0。
18. 单品/批量 UI 采用增量候选面板，不重做全站导航和品牌界面；旧 revision 候选不得覆盖新手工标题。

### 完成门

- Provider/Redis/AI Worker 全停时，人工标题、模板、保存、preflight 和 handoff 仍通过。
- 同图精确复用、图片/模型/Prompt/Policy 变化 miss、跨租户/店铺隔离、错误不缓存均有测试。
- 1/15/50/100 商品批量在刷新、断线、重启和部分失败后可恢复，不重复 Provider 调用。
- 候选不自动覆盖，采用有 diff/undo/provenance；AI 图片、模板和 Provider 各自失败时页面仍可继续安全编辑。
- SSRF、密钥泄露、预算超限、发送后 unknown 和 Provider Profile 变更均 fail closed、可审计。

## 23. ERP-16：合规与地毯品类闭环

### 目标

把官方必填、1630/1631、证书、代理、警示语和实拍图做成清晰、可追溯、不过度阻断的工作流。

### 必做清单

1. 在实施前恢复并核准正式 SHEIN API 来源索引、字段交接、发布合同和云部署架构文档；历史交接、旧代码和本地推导不能替代当前官方合同。
2. 建立原始 `ComplianceRequirementInbox`、版本化 `RequirementSnapshot`、normalizer/mapVersion、覆盖率、来源健康、last-known-good 和 partial/empty/unknown 语义。
3. 每个 `ComplianceCase` 精确绑定 tenant、store、商品、SPU/SKC、requirement、target、market、类目、官方快照版本和当前 revision，不用一行中文汇总状态代表整个合规事实。
4. Requirement、Evidence、Execution、Platform Review 和 Source Health 使用五组正交状态；`needs_action` 只作带 reasonCode/allowedActions 的运营投影。
5. 1630/1631 只采用当前 SKC 官方返回的报告类型，不按尺寸、模板、历史商品或本地算法推导；报告类型、文件、日期、schema、适用 SKC 和平台回执分离。
6. 将报告、本体图、包装图、证书、代理资料、警示语依据和普通商品图片定义为不同 `MaterialRole`/`MediaReference role`，分别校验 scope、MIME、尺寸、顺序、有效期、RetentionHold 和 Receipt kind。
7. `bodyLableList` 与 `packageLableList` 使用独立 labelGroup 和逐目标映射；上传成功、保存成功、绑定成功、审核通过和回读确认必须分别记录。
8. 建立 `MaterialApplicability`，以材料适用范围、当前官方要求、市场/类目/主体/型号和有效期决定是否可复用；模板、相同 hash 或历史通过只能提供候选，不能复制平台绑定/审核结果。
9. 证书形成证书池和独立生命周期：schema、编号、主体、市场、产品范围、签发/到期日、文件、创建、绑定、审核、失效与回读均可追溯。
10. 代理资料独立管理 type/range/effective dates/主体/市场/SKC 绑定；警示语按版本化官方 schema、映射、互斥和排除规则校验，不与普通描述字段混用。
11. API 不支持的 GCC、产品标识符或后台专属动作转为持久 `ManualComplianceTask`，包含 owner、SLA、操作说明、证明材料、人工声明和官方复核；人工声明不得伪装平台已完成。
12. 建立服务端确定性 `CompliancePreflight`，冻结官方快照、商品 revision、材料 revision、规则版本和动作；输出稳定 code/path/severity/allowedAction，浏览器提示不授权真实外部写。
13. 区分 pre-SKC 与 post-SKC 门禁：无 SKC 时不得预造后置完成；SKC 生成并官方回读后自动打开或复验相应 Case，但不自动向 SHEIN 写入。
14. 商品发布执行、商品官方接受、商品审核和合规审核保持独立；商品 accepted 后合规失败只创建/更新 Case 和运营提醒，不把发布结论改写为失败或驳回。
15. 每个真实合规动作建立不可变 `ComplianceCommand`、Event、事务 Outbox 和一个确定性 Queue Job；浏览器刷新、Control/Worker 重启或 Redis 故障后可恢复。
16. 外部调用前持久化 `send_started`；发送后超时进入 `result_unknown`，普通重试按钮不得盲重发。上传、保存、绑定、审核、主动回读分别保存 Attempt/Receipt。
17. Adapter 以 action/contractVersion/store/capability/canary 独立启用、限流和熔断，不用单一 `SHEIN_COMPLIANCE_WRITES_ENABLED` 总开关证明全部能力已上线。
18. Webhook 与主动回读统一进入 Inbox/normalizer，使用平台 Receipt、target 和官方 revision 单调投影；列表、计数、详情和批量资格来自同一数据库 Snapshot。
19. 合规工作台和商品编辑器嵌入面板采用渐进式 UI：来源健康、截止时间、材料、预检、命令、回执、人工任务和时间线清晰可见；不重做全站导航或品牌界面。
20. 批量操作只作用于当前 Snapshot 的可见且 eligible 集合，执行前展示影响预览，逐项 partial success；切筛选、切店、刷新和 revision 变化立即清理失效/隐藏选择。
21. 建立 tenant/store/role/capability 权限、双人审批可选门、短时下载票据、敏感字段脱敏、下载/绑定审计、保留期与法律 hold。
22. 采用影子对账和动作级金丝雀迁移：先单店单 SKC 实拍图，再报告，最后评审证书/代理等写能力；旧路径只有在零真实调用且两个稳定 release 后才归档。

### 完成门

- 正式来源索引、Adapter contract、错误码、批量/QPS 限制和真实脱敏 fixture 可核验；partial/empty/unknown 不显示通过、不清空 last-known-good，也不计为 0。
- 1630/1631、包装图、本体图、证书、代理和警示语的字段、角色、labelGroup、目标、有效期和回执映射均有 contract/E2E；本地类型推导、角色混填、跨 SKC/跨类型复用全部被阻断。
- 证书上传/创建/绑定/回读以及报告/实拍图上传/保存/绑定/审核各阶段可独立恢复；部分成功可解释，发送后 unknown 不重复调用。
- 商品 accepted 后合规失败不改写发布状态；pre-SKC/post-SKC、商品审核/合规审核和人工任务在 API、数据库与 UI 中均保持独立。
- 1/15/50/100 SKC 批量在刷新、切筛选、切店、断线、Worker/Redis 重启和部分失败后逐项恢复，且无隐藏选择、跨店串数据或整批误判。
- 跨 tenant/store、伪造 mediaId、错误 role、过期 schema/证书、无权限、敏感下载和旧 revision 晚到均有负向测试且零外部副作用。
- 金丝雀逐动作与 SHEIN 后台人工核对；页面只有在官方证据支持时显示已绑定、审核中或已通过，回滚不删除历史 Case、Attempt、Receipt、人工声明或商品已接受事实。

## 24. ERP-17：多店群、权限、经营分析、履约、售后、财务、价格、增长、协同与报表

### 目标

让十余用户、几十店铺在明确权限、稳定店铺身份、受控切店和清晰数据新鲜度下稳定运营；建立可追溯、unknown-safe、可解释的销量库存与经营决策域，将人工计划安全交接到采购、仓库、包裹、发运、到仓和数量对账闭环，让退货、报废、质量、申诉、处罚形成独立逆向闭环，以可信结算、成本、汇率、利润、应收应付、票据和资金事实支撑经营决策，把供货价、平台议价、建议零售价、价格证明与利润保护纳入独立闭环，建立选品、测款、商品组合、生命周期、活动计划和增长复盘的证据驱动运营系统，以统一任务、审批、通知、SLA、日历和协同工作台把跨领域人工工作安全闭环，并以统一指标、质量、快照、报表和管理驾驶舱让所有经营数字可解释、可下钻、可复现而不改写业务真相。

### 必做清单

1. 统一 RBAC/ABAC：Owner、Admin、Operations Manager、Operator、Reviewer、Viewer，并以服务端 capability 作为最终授权事实。
2. 第一阶段采用一个主店铺组和多个标签；店铺组授权与单店直接授权取并集，不设计无限层级和显式 deny。
3. 区分 SHEIN 官方名称、租户显示别名和未来个人别名；普通成员不得修改全局/租户店铺身份。
4. 建立店铺列表和详情页：概览、SHEIN 连接、成员与团队、同步与新鲜度、事件与审计、危险操作。
5. 将新增授权、指定店铺重授权、断开连接、暂停运营和归档店铺设计成不同命令、权限、文案和恢复路径。
6. 建立切店协调器：未保存内容确认、旧查询取消、选择清理、显式 URL、权限重验和目标快照加载。
7. 当前店铺体验缓存按 tenant/user/workspace 隔离；无权限或不存在的 URL 不得静默回落。
8. 已进入服务端的任务继续绑定原店铺；切店不取消、不转移，通过全局任务中心标明原店铺并通知结果。
9. disconnected/reauthorization_required 店铺进入历史/需重授权分区，在原访问关系有效时本地历史只读。
10. 恢复并核准销量、库存、仓库、上架状态和经营 Webhook 的正式 SHEIN 合同、限制、错误码、退役字段和真实脱敏 fixture。
11. 所有官方响应先形成 `BusinessSourceInbox/SourceReceipt`，记录 target、trace、contract/normalizer version、截止时间、requested/returned/missing 和覆盖率。
12. SHEIN 官方事实、本地衍生指标、人工经营参数和运营决定分层；任何本地建议不得覆盖官方字段。
13. `known/confirmed_zero/partial/unknown/stale/conflict/not_applicable` 成为指标一等质量状态；只有平台明确覆盖并返回 0 才能写 0。
14. 以 `storeId + platformSkuCode` 建立 SKU 销量/库存身份；SKU 映射冲突保留 orphan fact，不按 supplierSku、标题或图片猜归属。
15. 将 today/yesterday/rolling7/rolling30 保存为 SKU 窗口事实并逐 target 对账；缺 SKU/字段不补零，不从聚合窗口推造逐日曲线。
16. 将总量、可用、正式锁、临时锁、在途、缺货需求和 warehouse 明细分开；部分 SKU 已知只返回 known subtotal + coverage，不冒充完整汇总。
17. 库存合同迁移到 `invType=PI`；`warehouseType` 仅在官方退役日前作兼容并必须有零旧依赖证明。
18. 上下架与 firstShelfTime 保持独立 source/cutoff/LKG；不得从销量、库存或旧中文状态推断当前平台状态。
19. `sku_sales_daily`、`inventory_snapshots` 在支持 quality/source/unknown 后才作为规范历史；漏采日期保留缺口，不自动插值或补 0。
20. 建立版本化 MetricDefinition 和质量传播；可售天数、销量变化、库存位置和多店汇总均记录公式、输入、粒度、单位、截止时间和版本。
21. 将现有 `max(0, sales7 - availableInventory)` 明确降级为“7 日基础缺口”；完整备货建议纳入 lead time、安全库存、MOQ、包装倍数、生命周期、在途策略和地毯尺寸差异。
22. 建立 ReplenishmentPolicy/Recommendation；缺规划参数或数据覆盖时只显示数据不足，不输出貌似精确的建议量。
23. 建立版本化 AlertRule 和持久 BusinessAlertCase，支持 owner、SLA、确认、分派、稍后、解决、复发和证据时间线。
24. 数据质量预警与缺货/低库存/滞销/销量异常等业务预警分离；unknown 不得触发库存为 0 或销量为 0。
25. 核准的经营 Webhook 先验签幂等落库，只开案件/标 dataset dirty；不直接覆盖库存事实，不自动触发全量 SHEIN 刷新。
26. 手动刷新按 tenant/store/dataset 创建或复用单一活动 Operation，返回逐来源进度、冷却和 partial failure；页面不自建第二套任务。
27. Scheduler、进页、切店、窗口聚焦和 30 秒自动同步继续关闭；切店不调用 SHEIN。
28. 单店列表、计数、详情、筛选、导出和批量资格来自同一 snapshotRevision/asOf；前端不按中文字符串二次聚合。
29. 多店总览只聚合同指标版本、单位、经营模式和可比 cutoff，显示覆盖店铺、unknown、最旧/最新截止和过期数。
30. 官方未开放的曝光、访客、点击、加购、转化率和全托管订单分析数据不推造；缺真实价格/成本/结算/退货时不计算 GMV、利润或 ROI。
31. `business.read/refresh/export`、策略管理、建议决定和预警处理使用独立 capability；跨店导出异步、短时票据、全程审计。
32. 跨店批量写默认不存在；该板块不提供库存更新、上下架、采购、备货单或自动补货执行。
33. Query key、Operation、Snapshot、AlertCase、Recommendation、导出和缓存按 tenant/user/store/storeSet 隔离。
34. 采用结构化事实双写、影子指标/预警对账和渐进 UI；两个稳定 release、零引用和回滚证明前不退役旧 JSON 快照 owner。
35. 建立 10/50/100 店、100/1k/10k SKU、限流、断线、Redis/Worker/DB 故障、分页和 2 核 4GB 性能验收。
36. 盘点采购、JIT、发货基础、物流产品、仓库、发货单、打印、手工备货和履约 Webhook 的当前官方文档、源码、表、开关、生产版本与真实使用痕迹。
37. 恢复并核准所有履约 endpoint 的方法、字段、QPS/批量、状态、错误码、退役项和真实脱敏 fixture；文档缺口保持 unsupported，禁止按示例猜字段。
38. 建立 Fulfillment Inbox/Receipt，统一保存主动读、Webhook 和命令回执的 raw、trace、contract/normalizer version、target、cutoff、覆盖率和 LKG。
39. 建立 OfficialPurchaseOrder/PurchaseOrderLine/JitOrderRelation，使用 storeId + 官方 orderNo/skuCode 精确身份，状态只认官方 code，中文仅展示。
40. 将 need/order/delivery/receipt/storage/defective、JIT 已转/未转和本地计划量分别写入 unknown-safe Quantity Ledger；缺失不补 0，汇总带覆盖率。
41. Recommendation 只能创建 ReplenishmentPlan Draft；人工计划调整、来源证据、policy/input snapshot、审批、驳回、撤销、过期和 revision 全量可审计。
42. 手工备货单创建作为独立高风险动作；未恢复正式合同、未通过单店只读验证或未获动作 capability 时保持冻结，不生成本地假平台单号。
43. 建立 Address/Warehouse/DeliveryType/Carrier/Fleet/FreightForwarder/Channel/LogisticsProduct Option Snapshot，所有选项保存官方 ID、scope、来源、新鲜度和限制。
44. 建立服务端 ShippingEligibilityEngine，核对店铺、采购状态、急采/备货、JIT、storageId、recommendedSubWarehouseId、prepareType、market、安检/品类、SKU 集合、数量和冲突锁。
45. 建立 ShippingPlan/Line 和 PackagePlan/Item revision，支持部分发货、拆单/合单、装箱明细、地址/仓/物流/预约、逐包重量尺寸和总量守恒。
46. 地毯按尺寸 SKU 管折叠/卷装/压缩、实重/体积重、箱规、包材和风险；缺实测参数保持 unknown，大尺寸不得使用 SKC 平均值。
47. 采购计划、平台采购单、发货计划、平台发货单、包裹、标签、数量对账和异常使用独立对象与正交状态机，不增加万能 order/status。
48. 创建备货、创建/修改/取消发货和标签请求统一使用持久 Command/Event/Outbox，一命令一 Queue Job、lease、每店公平、同单串行。
49. 外部调用前持久化 send_started；发送后超时进入 result_unknown 并锁定业务键，禁止通用自动 retry；accepted 不等于到仓或入库。
50. Adapter 按 action/contractVersion/store/capability/canary 独立启用、限流和熔断；创建发货开放不得隐式开放修改、取消、备货或批量。
51. PurchaseOrder、DeliveryOrder、Logistics 各自回读并与 Webhook 统一归并；receipt/match/projection/current pointer/quantity event 单事务提交且可从 raw 重放。
52. 采购/发货列表、计数、详情、数量、allowedActions 和异常来自同一 fulfillmentSnapshotRevision；source partial/stale 保留 LKG 并逐源解释。
53. 商品条码、箱唛/包裹面单、发货面单和物流商面单分 ArtifactType；文件私有、短时下载、hash/版本绑定，打印不改官方状态。
54. 建立 FulfillmentExceptionCase，覆盖临期/逾期、身份/合单/数量/包裹/标签/物流/到仓/次品差异，支持 owner、SLA、解决和复发。
55. 当前履约状态仍由用户手动刷新；Scheduler、30 秒、进页、切店和聚焦自动同步关闭，Webhook 只落事件并标 dirty。
56. 建立采购与履约工作台：总览、采购单、备货计划、发货计划、发货单、包裹/打印、异常和单据详情，渐进加入现有 V2 壳。
57. selection 绑定 tenant/user/store/tab/filter/snapshotRevision/eligibilityRevision，只保留当前可见 eligible 行；跨页全选必须显式影响预览。
58. 履约 capability 区分 read/refresh/plan/approve/create/modify/cancel/print/exception/export/diagnostics；高风险动作服务端重验、目标确认和完整审计。
59. 发货地址、联系人、电话、仓库、运单和标签按敏感数据治理；跨 tenant/store、伪造单号/数量/token、越权下载和重放取消负向测试零副作用。
60. 追踪 refresh/source/purchase/plan/eligibility/command/outbox/job/attempt/SHEIN trace/delivery/package/reconciliation/case/release 全链路，并监控逾期、未知、对账差异和标签失败。
61. 建立 10/50/100 店、1k/10k 采购行、1/15/50 发货计划、分页/QPS、断线、Redis/Worker/DB 崩溃、标签大文件和 2 核 4GB 性能恢复验收。
62. 迁移先只读官方事实与影子对账，再上内部 Plan/Eligibility，最后单店单采购单金丝雀；写能力逐动作、逐店铺、逐角色放量。
63. 首个真实金丝雀必须完成创建发货单、官方回读、标签、取件/到仓与数量对账；任一证据缺失立即停止后续动作，不“先部署看看”。
64. 跨店只提供只读汇总与任务中心，首期不提供跨店一键发货、大范围批量修改/取消、自动补发、自动退货或自动库存写入。
65. 两个稳定 release、零旧写/读 owner、回滚演练和用户验收前，旧接口包装、临时状态、标签缓存和兼容快照保持可恢复，不直接删除。
66. 盘点退货/报废、消费者售后、质量、处罚、申诉和财务报告/调整的当前官方原文、权限、代码、表、Webhook、导入、页面、开关和生产痕迹；仅目录/摘要能力标 unsupported。
67. 恢复退货申请明细、退货单列表/商品/包裹/地址及财务报告/调整明细的正式合同、窗口、分页、QPS、状态、错误和真实脱敏 fixture；消除重复 `/open-api` 路径等冲突。
68. 建立 ReverseSourceInbox/Receipt，统一接收 API、Webhook 和核准导入，保存 raw、target coverage、window/page、trace、contract/normalizer version、quality 和 LKG。
69. 退货列表按不超过 60 天窗口、指定退货单号不超过 200 个切片；财务报告按不超过 7 天窗口切片，边界重叠去重并可证明 requested/returned/missing。
70. 建立 ReturnApplication/Line、OfficialReturnOrder/Line 和 ReturnPackage/Item，以 storeId + 官方单据/行身份为主键；不按标题、图片或当前 supplierSku 猜归属。
71. 在板块 11 数量事实之后追加 expected/actual return、expected/actual scrap、package、signed 等独立 SKU Quantity Events；不回写采购、发货、到仓、入库或次品历史。
72. 平台退货状态、质量 Case、责任评估、申诉、财务报告和对账分别使用正交状态机；禁止万能 afterSaleStatus 或用中文原因替代官方 code。
73. 建立版本化 QualityTaxonomy，永久保存平台原始原因与映射版本；地毯覆盖尺寸/形状/厚度/克重、色差/印花、锁边/掉毛、气味/受潮、折痕/回弹、防滑底、包装与错装。
74. 建立 QualityCase，支持 owner、SLA、严重度、影响范围、证据缺口、责任候选、决定、解决、复发和父子聚类，不自动定责或扣款。
75. 建立 EvidenceBundle/Item，区分实物、测量、包装、标签、视频、检验、物流、平台通知和沟通证据，保存 hash、来源、采集时间、隐私、hold、保留与访问审计。
76. 消费者售后正式合同未核准前，页面明确 unsupported；仅允许最小字段人工登记或核准导入并保存 provenance，不推造消费者订单、退款状态、投诉或 PII。
77. 建立 ResponsibilityAssessment，供应商、内部建品、包装、仓库、正/逆向物流、平台、消费者预期和 unknown 可并存；人工决定可 supersede 不可删除。
78. 建立 PenaltyFact、ClaimCase、AppealCase 和 ManualAppealTask；处罚原始事实、索赔诉求、申诉截止/补件/决定和后续补款分离。
79. 退货、报废、确认、更新取件或申诉写在完整合同恢复前冻结；未来按 action 独立 capability/contractVersion/开关/限流/canary。
80. 所有逆向平台写使用 plan/preflight/authorize/ReverseCommand/Event/Outbox/一命令一 Job/lease；发送前持久化 send_started，发送未知 result_unknown 锁定业务键且不通用重试。
81. 建立退货地址、处置、取件、承运 Option Snapshot；ReturnPackage 与 SKU 数量守恒，标签/运单/取件单/签收证明分 ArtifactType，stale 或 revision 冲突 fail closed。
82. 建立 FinanceReport/Entry，保存报告/明细身份、业务单号、平台 SKU、数量、金额、币种、方向、官方状态、原始 replenishCategory、账期和 raw hash。
83. 同一业务单号/SKU 在多报告、多费用和跨账期出现时追加保留，不覆盖；当前 supplierSku 与账单生成时身份差异通过历史映射处理。
84. 建立版本化财务分类映射，输出 raw/normalized/confidence；新分类保持 unknown 待映射，不用自由文本作为稳定 ID 或自动责任依据。
85. 建立 ReconciliationLink/Allocation，区分 matched/candidate/ambiguous/unmatched/reviewed/superseded；金额、时间或标题相似不能单独自动认领。
86. 官方已结算、待确认/待结算、已发生未出账、内部预计和无法量化损失分层；不同币种无汇率来源/时点/version 不汇总，缺成本不输出利润/ROI。
87. 建立 CorrectiveAction/CAPA，将问题转为新质检、包装、商品、供应商或合规任务；历史商品版本、采购、包装和履约事实保持不可变。
88. 建立逆向与质量工作台：总览、退货/报废、质量、索赔申诉、财务影响、改善任务和全链详情，渐进加入现有 V2 壳，不重做全站 UI。
89. 列表、计数、金额/数量、详情和 allowedActions 来自同一 reverseSnapshotRevision；selection 绑定 tenant/user/store/tab/filter/snapshot/eligibility 且只含当前可见 eligible 行。
90. `reverse/quality/return/appeal/finance/loss/diagnostics` capability 分开；高数量/金额/争议动作支持双人审批，跨店批量退货/报废/申诉首期不存在。
91. 手动刷新由单一 ReverseRefreshOperation owner 执行；Scheduler、30 秒、进页、切店和聚焦自动同步关闭，Webhook 只落 Inbox、精确匹配或标 dirty。
92. 追踪 refresh/source/return/quality/evidence/appeal/command/outbox/job/attempt/SHEIN trace/finance/reconciliation/CAPA/release 全链，监控 stale、unmatched、逾期、unknown 和复发。
93. 对地址、运单、消费者数据、证据和财务导出实行分级、脱敏、私有对象、短时票据、最小导出、retention hold 和跨 tenant/store 负向测试。
94. 建立 10/50/100 店、1k/10k 退货行、60/7 天时间切片、重复/乱序、分页、限流、证据大文件、Redis/Worker/DB 故障和 2 核 4GB 性能恢复验收。
95. 迁移先只读退货/财务事实和影子对账，再上线质量/证据/责任协作，最后单店单动作金丝雀；消费者售后和未恢复写合同不随部署隐式开放。
96. 盘点 SHEIN 财务、供货价/核价、成本字段、费用/AI 用量、导入、表、页面、Webhook、开关和生产资产；证明当前无被遗漏的财务 owner 或自动资金写。
97. 恢复并核准 report-list、report-sales-detail、report-adjustment-detail 的方法、7 天窗口、200/页、QPS、字段、状态、错误和真实脱敏 fixture；其他 check/order/invoice 线索保持 unsupported。
98. 建立 FinanceSourceInbox/Receipt，统一 API、Webhook 和核准导入，保存 raw、window/page/target coverage、trace、contract/normalizer version、quality 和 LKG。
99. 建立 SettlementReport/Entry，商品销售款、服务费、补扣款、退款/处罚/补款和平台状态分别保存；同单同 SKU 多报告/多费用/跨期不覆盖。
100. 将现有 `costPrice` 明确迁移为 `shein_supply_price` 语义；供货价、平台建议价、工厂报价、实际采购成本和结算收入在 API/表/UI 中完全分离。
101. 建立不可变 CommercialPriceFact，保存 priceType、SKU、币种、含税口径、生效区间、来源、审批和 revision；商业价格不冒充收入或成本。
102. 建立 CostLedgerEntry，覆盖工厂/加工、包材、正逆向物流、仓储操作、AI/设计/打样/合规、退货/质量/处罚及抵减成本，区分 actual/estimated/accrual。
103. 建立 CostImportBatch 与 provenance；人工/Excel/API 的模板版本、行级校验、重复、错误、成功项、撤销/冲销和导入证据可追溯，未知不补 0。
104. 成本按 SKU/采购批次和 effective period 保存标准/报价/合同/实际版本；修改创建新 Entry/Revision，不回写历史利润。
105. 建立 CostAllocationRule/Run，driver 可为数量、面积、重量、体积、箱数或金额；保存输入、结果、舍入和版本，缺合理 driver 保持未分摊。
106. 地毯单位经济按尺寸 SKU、面积、克重、材料、包材、折叠/卷压、实重/体积重、物流和售后风险建模；大尺寸不使用 SKC 平均成本。
107. 建立 FXRateSnapshot/CurrencyConversion/FXPolicyVersion，永久保留原币种；汇率来源、时点、用途和版本缺失时不跨币种汇总。
108. 建立 ProfitDefinition/ProfitSnapshot，分官方收入、平台净收入、商品毛利和贡献利润；输入快照、FX/分摊/口径版本、coverage、quality 和 unknown 全量可见。
109. 利润资格区分 complete_actual、actual_partial、estimated、stale、conflict、unknown；数据不完整不得显示完整实际利润、ROI 或确定性排名。
110. 建立 ReceivableItem，将平台待确认/待结算/已结算、银行待收、部分收款、短长款、争议和核销分离；没有可靠 due date 不伪造逾期。
111. 建立 PayableItem/SupplierStatement，将采购/收货/入库、供应商账单、发票、争议、应付和付款分离；报价/计划不自动生成实际应付。
112. 建立 CashAccount/CashTransaction 核准导入边界、原币种、value date、流水身份、余额 coverage、重复幂等和敏感账户脱敏；首期不直接连接银行写入。
113. 建立 InvoiceDocument/Line，区分进销项、预期/申请/开收/验真/匹配/红冲；`invoice_status_notice` 合同未核准前不自动投影，不计算税务申报。
114. 建立多链 FinancialReconciliationLink/Allocation/Case，覆盖报告明细、应收/银行、采购/应付/发票/付款和售后/处罚；matched/ambiguous/unmatched 均可见。
115. 建立 AccountingPeriod/CloseRun，soft/hard close 前检查 coverage、未匹配、汇率、成本、票据、资金和跨期；晚到事实走调整/重开并生成新 Snapshot。
116. 建立 BudgetVersion/CashForecastSnapshot，事实应收应付、统计预测和人工计划分层；采购 Recommendation/Plan 不算实际应付，情景不改事实利润。
117. 店铺、店铺组、legalEntity、businessMode 和 settlement currency 分维度；跨店聚合只比较同 Period/ProfitDefinition/FX/quality，主体间款项独立。
118. 建立经营财务工作台：总览、SHEIN 结算、成本、利润、应收应付、发票、资金、月结/异常，渐进加入现有 V2 壳。
119. 财务列表、计数、金额、利润、allowedActions 和导出绑定同一 financeSnapshotRevision/asOf/period/fxVersion/profitDefinitionVersion。
120. finance/cost/profit/receivable/payable/invoice/cash/payment/period/diagnostics capability 分开；成本、银行、票据和全租户利润使用字段级权限。
121. 自动付款、开票、write-off、调账和改价保持冻结；未来 PaymentCommand 必须双人审批、step-up/MFA、收款账户白名单、Outbox/send boundary 和 result_unknown 锁。
122. 财务同步继续用户手动触发，单一 FinanceRefreshOperation owner；Scheduler、30 秒、进页、切店和聚焦自动同步关闭，Webhook 只落 Inbox/标 dirty。
123. 追踪 refresh/source/report/entry/cost/import/allocation/FX/profit/AR/AP/invoice/cash/reconciliation/close/release 全链，并监控 stale、partial、unmatched、跨期和权限访问。
124. 所有金额使用数据库 decimal/最小货币单位和版本化舍入；禁止 JS 浮点累计、字符串拼接或前端当前页计算财务总额。
125. 建立 10/50/100 店、数十万明细、7 天切片、多币种、跨期重算、成本导入、大导出和 2 核 4GB 性能/恢复预算。
126. 银行账户、税号、发票、成本、利润和供应商资料按高敏数据治理；加密/私有对象、脱敏、短时票据、最小导出和跨 tenant/store 负向测试。
127. 迁移先只读 SHEIN 结算和影子对账，再小批成本导入/影子利润，再应收应付/票据/资金协作，最后月结；不随 UI 上线开放付款。
128. 首个金丝雀只选一个店铺、一个完整报账单期间和一批真实脱敏成本，与 SHEIN 后台及人工表逐条核对收入、成本、FX、利润和未匹配。
129. 本阶段明确标注“经营管理会计”，不输出法定总账、税务申报、审计结论、税后净利润或无来源税额。
130. 两个稳定 release、旧财务/成本读写 owner 零引用、历史重算一致、回滚演练和用户验收前，不删除旧字段、模板默认值或导入证据。
131. 盘点供货价更新、调价原因、议价列表/处理、价格材料、建议零售价当前值/规则/提交/审核及消费者售价/活动价线索的官方原文、代码、表、页面、开关、生产版本和真实 owner。
132. 恢复并核准供货价、原因、议价、材料和 RRP 的方法、字段、粒度、状态、批量/QPS、币种精度、错误和真实脱敏 fixture；消费者售价与活动能力合同不完整时保持 unsupported。
133. 建立 PriceType、PriceFact/Revision 和显式 current pointer，完全区分 SHEIN 供货价、平台建议价、商家报价、建议零售价、活动价、内部目标、工厂成本和结算收入。
134. 商品工作流、价格议价、RRP 审核、命令执行和价格生效建立五套正交状态机；价格 reducer 不得写商品审核投影。
135. 建立 PriceSourceInbox/Receipt，统一议价、供货价、RRP、规则与审核读取，保存 raw、target/page coverage、trace、contract/normalizer version、cutoff、quality 和 LKG。
136. 建立 PriceDiscussion/Line/History，保存 discussSn、类型、状态、轮次、剩余次数、平台建议、商家报价、SKU 历史和同价规则；只有当前 revision 的待商家确认状态可行动。
137. 接受、拒绝和重新报价定义为三个独立动作；拒绝必须展示商品不能上架且无法再次报价的不可逆影响，重新报价必须引用最新 discussStep/lastCost/lastCurrency、原因、材料和完整 SKU 集合。
138. 建立 PriceProofBundle/Item，材料上传、SHEIN objectKey 与业务提交分离，并按议价/RRP/供货价涨价、SKC/SKU/site/round/revision 管理适用性、隐私和保留。
139. 供货价 proposal 读取当前完整 SKU 值、币种、平台身份、待审状态和动态调价原因；逐行校验金额范围、币种精度、未变价格、备注、材料和当前合同批量限制。
140. 建立 RRPPolicy/Snapshot/Submission/Audit；按 SKU/site 保存当前值和部分状态，执行 read-merge-freeze-current-set 后才生成全量 replacement payload，遗漏值不得清空。
141. 建立 PriceFloorPolicy，引用板块 13 的 ProfitSnapshot/Definition/FX/成本/质量 revision；partial/conflict/unknown 默认数据不足，地毯按尺寸 SKU/面积/克重/包材/体积重和售后风险判断。
142. 建立 PriceProposal/Decision 和逐项影响预览，展示新旧价、币种、单位/总利润差、影响数量、材料、规则、官方 revision 和数据质量；建议不直接执行。
143. 低于底线只允许 Owner/Admin 发起双人例外审批，发起人与批准人不同；记录预计损失、数量、理由、证据、有效期和单次 action，输入 revision 变化立即失效。
144. 建立 PriceCommand/Event/Outbox，一命令一 Job；浏览器不直调 SHEIN，Worker 外部调用前持久化 send_started，发送后超时进入 result_unknown 并锁业务键、禁止通用重试。
145. 供货价更新、接受、拒绝、重报价和 RRP 提交使用独立 adapter、contractVersion、capability、限流、熔断、开关和 canary；一个讨论/价格对象同时只允许一个活动命令。
146. HTTP 200/accepted 只显示已提交待确认；官方议价/供货价/RRP 回读在 SKU/site/currency/round/revision 匹配后才生成 effective PriceFact，冲突开 PriceReconciliationCase。
147. 价格列表、tab 计数、详情、allowedActions、利润影响和批量目标来自同一 priceSnapshotRevision；selection 绑定当前可见 eligible 集合，切筛选/tab/店铺/刷新后无隐藏选择。
148. 建立价格工作台：总览、平台议价、供货价、建议零售价、活动价格边界、利润保护、命令与异常；审核中心只保留待核价摘要/跳转，不再直接拥有全部价格写入逻辑。
149. 价格刷新继续由用户手动触发，单一 PriceRefreshOperation owner；Scheduler、30 秒、进页、切店和聚焦自动同步关闭，Webhook 只落 Inbox/精确关联/标 dirty。
150. 迁移按只读影子对账、底线/审批影子、用户指定单动作单商品金丝雀、单店小批和多店逐级放量；两个稳定 release、零旧直接调用、回滚演练和用户验收前不退役兼容证据。
151. 盘点当前经营快照、固定阈值预警、商品排序、人工选品/活动表、生命周期标签、活动线索、页面、代码、规则、开关和生产 owner，证明不存在遗漏的自动运营写入。
152. 固化 SHEIN 当前能力边界：全托管只使用核准商品/上架/库存/SKU 销量事实；流量概览与促销创建 API 明确 unsupported，未来合同变更需新 contractVersion 和 fixture。
153. 建立 GrowthInputSnapshot，引用商品、销量、库存、价格、利润、质量、售后、合规、履约、内容和供应 revision/cutoff/coverage/quality；人工市场证据保存 provenance 与有效期。
154. 建立 store + SKC + site + productVersion 粒度的 GrowthPortfolioItem、LifecyclePolicy 和 StageHistory，采用 candidate/launch_ready/testing/validated/growth/scale/stable/decline/clearance/retired 主链。
155. 商品官方状态、商业生命周期、经营分层、实验、平台活动、内部计划、领域执行和风险 Case 正交；缺货/驳回/合规/活动占用作为 blocker，不改写阶段。
156. 生命周期规则只生成迁移 Proposal；人工决定后更新显式 current pointer，保存 policy/input revision、决定人、证据和 reviewAt，回退/复活不覆盖旧历史。
157. 建立 SegmentDefinition/Snapshot，需求、利润、库存/履约、质量/售后、合规/内容和供应并列评分；禁止单一黑盒“爆款分”和 30 日销量直接等同生命周期。
158. 建立 GrowthOpportunity/ProductFamily，接收内部设计、真实经营数据、人工关键词/竞品/评论/季节研究和 AI 候选；保存场景、风格、功能、尺寸、价格带、证据、新鲜度、风险和决定。
159. 建立 GrowthExperiment/Cohort/Observation，开始前冻结假设、store/site/SKC/SKU/version、标题/素材/价格/库存、窗口、最低覆盖、成功/失败/停止/无结论标准和允许变更。
160. 0 销量诊断区分未上架、缺货、价格/站点不可售、审核/合规/活动阻断、数据缺口和需求不足；曝光/点击/转化不可观测时保持 unknown，不自动给出换图/降价/淘汰结论。
161. 地毯增长策略按场景、风格、功能、材料、尺寸梯度、真实厚度/颜色预期、折痕/气味/掉毛/防滑/锁边、包装、体积重和售后风险设测试与放量门；小尺寸成功不代表整组可放量。
162. GrowthEvaluation 保存冻结标准、中途变更、可比窗口、confounder、pass/fail/inconclusive/data_invalid 和局限；7/30 日聚合不生成伪逐日曲线或无对照因果结论。
163. 建立 CampaignPlan/Fact 边界：当前只生成 SHEIN 后台人工任务；人工已提交必须有操作者/时间/证据且不冒充官方通过，未来官方活动事实统一经 Inbox/Receipt。
164. 活动资格检查商品可售、规则、价格底线、利润质量、库存/在途/交期、合规、质量/售后、处罚、供应产能和活动占用；unknown/stale 或关键风险 fail closed。
165. 建立 GrowthActionPlan/Item，将建品、标题、媒体、价格、备货、质量、合规、人工活动和退出候选交接对应领域；增长模块不直接拼装或调用外部写 payload。
166. 建立 GrowthRecommendation/Decision；AI 输出证据、规则、缺口、风险、候选动作和置信度，保存输入/模型/策略版本与采纳/编辑/拒绝，不自动改阶段或执行动作。
167. 建立 GrowthAlertCase 和 PostMortem，覆盖阶段超时、数据不足、断货/利润/质量/供应恶化、活动占用、清仓阻断、实验无效及复发，支持 owner、SLA 和结果证据。
168. 建立增长一致快照 API 和工作台：组合总览、机会池、测款、生命周期、活动计划、增长动作和复盘；计数/列表/详情/allowedActions 同 revision，现有经营页只增摘要/跳转。
169. selection 绑定 tenant/user/store/tab/filter/growthSnapshot/policyRevision，只含当前可见 eligible 行；批量只生成逐项 Proposal，跨店/跨页必须影响预览并服务端重验。
170. 迁移先对照旧阈值预警与人工计划做 shadow，单店运行生命周期/实验/复盘，再扩店组；继续手动刷新，两个稳定 release、零旧标签 owner、规则回放和回滚验收前不退役旧证据。
171. 盘点现有 TodayWork、同步“任务中心”、业务 Case/Plan 中的 owner、局部 reviewer/approval、活动流、页面、表、通知线索和生产 owner，明确哪些是人工工作、系统 Job、业务事实或外部 Command。
172. 固化 WorkItem、ApprovalRequest、SystemJob、ExternalCommand、NotificationEvent 与领域 Fact/Case 的正交状态和完成语义；任务关闭不得修改平台或领域 current 状态。
173. 建立版本化 WorkTypeDefinition/WorkSignal，定义领域 owner、scope、默认优先级、候选角色、SLA、完成证据、dedupKey、允许动作和复发策略。
174. 建立 tenant/workspace/store/subjectRevision 绑定的 WorkItem/Revision/Event；支持 open/assigned/in_progress/blocked/resolved/verified/closed/cancelled、lockVersion、复发和结构化完成证据。
175. 建立团队队列、assignee/accountableOwner、AssignmentHistory、转交、限时 DelegationGrant、成员停用/离岗排空和 orphan queue；代理不得扩大权限或充当第二审批人。
176. 建立 response/resolution SLA、版本化 BusinessCalendar、时区/节假日、受控 pause、官方截止保护和 EscalationEvent；升级只产生本地提醒/管理动作，不调用 SHEIN。
177. 建立不可变 ApprovalRequest/Policy/Step/Decision，冻结 action、subjectRevision、范围、风险、数量/金额/利润、规则和影响预览；任何输入变化使旧审批 invalidated。
178. 高风险动作实施职责分离、禁止自审、顺序/并行/quorum、资格实时重验和 break-glass 独立事件；Owner/Admin 不得绕过不同人审批。
179. approved 只生成一次性 ApprovalGrant；对应领域在创建 Command 时原子消费并重验 capability、revision、eligibility 和业务锁，审批本身不代表执行或平台成功。
180. 建立 CommentThread/Revision/Mention/WorkAttachment；评论不解析成批准/业务状态，mention 只面向有权限成员，附件走私有对象、短时票据、hash、扫描和 retention。
181. 建立 NotificationEvent/Outbox/Delivery/Preference，首期应用内 Inbox；业务事务与消息投递解耦，支持去重、聚合、摘要、免打扰、强制安全事件和独立失败。
182. 将 TodayWork 升级为个人工作台：我的任务、待我审批、团队待领取、关注异常、今日完成和活动流；现有活动聚合明确降为动态而非任务真相。
183. 建立团队队列与管理视图，支持工作类型/店铺组/负责人/SLA/阻塞/风险、工作量、孤儿和审批瓶颈；敏感摘要按 capability 裁剪。
184. 建立 OperationsCalendarEvent，聚合任务、审批、活动/实验、寄样/发货/申诉、证书、价格、备货和月结窗口；日历引用来源，拖拽不得修改官方截止或业务事实。
185. 将当前“任务中心”更名为系统/同步任务并与人工工作台分离；Job 失败仅在需要人工介入时生成关联 WorkItem，重新打开任务不自动重试 Job/Command。
186. 周期任务首期只生成内部检查/提醒 WorkItem；保存 recurrence scope/calendar/template version 和独立 occurrence，禁止自动刷新或调用 SHEIN。
187. 建立 WorkSnapshot 一致 API：计数、列表、详情、SLA、allowedActions、搜索和批量资格同 revision；selection 绑定可见 eligible，跨页/跨店显式影响预览并逐项重验。
188. 建立 `work.*`、`approval.*`、`comment.*`、`notification.*`、`calendar.*` 和 `system_job.*` 独立 capability；每次读、未读计数、mention、导出和动作均重验 tenant/store/敏感字段权限。
189. SLA/通知 Worker 使用数据库 claim/lease、有界批次、公平队列和 backoff；建立任务、审批、通知、孤儿、SLA、重开和 trace 可观测性，验证 2 核 4GB、时区、Worker 重启和投递失败。
190. 迁移按 TodayWork/局部审批/业务 owner 影子映射、单团队试用、个人/团队工作台和系统任务分离逐级进行；保持手动刷新，两个稳定 release、零旧 owner、E2E 与回滚证明前不退役兼容活动流。
191. 盘点所有页面 KPI、JSONB/SQL 聚合、warning 阈值、Excel/CSV、导出、图表、口径、owner、生产使用和相互冲突，建立分析资产与退役候选清单。
192. 固化 SHEIN 可用/unsupported 指标边界；全托管无曝光/点击/转化/订单等官方合同就保持 unknown/unsupported，不用销量、库存或人工估算冒充。
193. 建立 MetricDefinition/Version，定义唯一 key、含义、grain、unit、precision、aggregation、window、inputs、formula、quality propagation、owner 和 effective period。
194. 建立 DimensionDefinition/Member，统一店铺/组、经营模式、商品族/Product/SKC/SKU/尺寸、类目、站点、仓库、时间、币种和单位层级及有效期历史。
195. 建立 AnalyticsDatasetDefinition 和 Quality/Lineage，保存 source Receipt/revision、expected/returned/missing、coverage、cutoff、freshness、conflict、join/aggregation 和公式版本。
196. 建立不可变 AnalyticsSnapshot/MetricObservation，冻结 tenant/storeSet/filter/asOf/window/metricDimensionVersion/input/hash/quality/current pointer；重算不覆盖旧快照。
197. 建立幂等有界 Analytics Compute，金额/汇率使用 decimal，服务端分页/稳定排序/statement timeout/并发预算；首期使用 PostgreSQL 事实/汇总与 Worker，不提前建第二数仓。
198. 建立 ReportDefinition/Version 和 SavedView，白名单数据集、指标、维度、筛选、分组、排序、图表、质量、下钻、权限和共享；用户视图不能改正式公式。
199. 建立 DrilldownContract/Explain，同一 snapshotId 下卡片、图表、列表、总计和明细对账，并显示公式、窗口、unit、coverage、cutoff、version、输入缺口和排除项。
200. 建立角色化报表中心：经营、发布审核、合规质量、履约、财务价格、增长和团队；现有页面临时汇总逐步切换到统一 metric owner。
201. 建立管理驾驶舱，只保留少量跨域数据健康、商品组合、审核/合规、销量库存、履约、质量/售后、利润、任务审批和增长风险 KPI，全部可解释/下钻。
202. 多店比较必须通过 businessMode、metricVersion、unit、currency/FX、window、cutoff skew 和 coverage 可比性门；数据不足不排榜尾，动态店铺组使用固定 revision。
203. 财务/利润报表只消费 ProfitSnapshot/FX/关账事实；原币种、settled/accrual/estimated、direct/allocated、official/manual 分层，晚到数据不静默改历史月报。
204. 经营/履约/质量/合规按正确 grain/time/quantity/status 语义；SKU 尺寸、库存时点、销量窗口、数量账本、缺陷 taxonomy 和官方要求不能被页面平均/补零。
205. 增长报表只消费 GrowthSnapshot/Decision；人工市场证据与官方指标分层，无可靠对照不声称标题、图片、价格或活动造成转化提升。
206. 建立 ExportJob/Artifact，后台流式 CSV/XLSX、行数/字节/并发/期限预算、CSV 注入防护、私有对象、短时票据、hash、水印和下载审计，并携带口径/质量元数据。
207. 建立 ReportSubscription/DeliveryRun，只发送固定 ReportVersion/SavedView 的已有合格 Snapshot；每次发送重验接收人权限，过期/partial 明确警告或跳过，绝不自动刷新 SHEIN。
208. 自定义分析只允许批准数据集/指标/维度/操作符，由服务端语义编译和 cost guard；禁止原始 SQL、任意脚本/URL、跨租户 join 和浏览器全量计算。
209. 建立 analytics/report/metric/quality/export/subscribe/diagnostics capability 与字段级财务/PII 权限；缓存、搜索、未读、下钻、导出和投递按 tenant/user/capability/storeSet 隔离。
210. 迁移按旧页面/Excel 影子对账、单店、店组和管理驾驶舱逐级进行；继续手动刷新，两个稳定 release、零页面临时公式 owner、性能/安全/E2E/回放/回滚通过前不退役旧证据。

### 完成门

- 切店、切账号、回退导航和多标签页均不串数据。
- 所有官方响应 requested/returned/missing target 可对账；销量缺行、库存/在途 partial、接口失败和 stale 均不被写成 0 或完整汇总。
- 所有单店/多店汇总显示覆盖率、新鲜度、unknown、cutoff skew、指标版本和不可比状态。
- 连续趋势只来自真实持久日/时点事实；现有 7/30 日窗口不生成伪历史曲线。
- 可售天数和备货建议在零销量、unknown、库存 0、新品、断货抑制、缺 lead time/MOQ/包装倍数时均正确、可解释、可重算。
- 预警去重、确认、分派、稍后、解决和复发通过；数据质量恢复不伪装业务风险已解除。
- 进页、切店、聚焦和 30 秒定时器不调用 SHEIN；手动刷新只有一个服务端 Operation owner，部分失败保留 LKG。
- A→B、A→B→A、旧请求晚到、未保存表单、失效 URL 和在途任务均通过浏览器行为 E2E。
- 店铺断开、暂停、归档和重授权不会改变稳定 storeId、丢失历史或清除原访问关系。
- 普通成员无法调用店铺连接管理、全局命名、策略管理、越权导出或其他未授权 API。
- 经营分析仍无库存、上下架或自动补货写；Recommendation 未经人工计划/审批/确认不会创建 SHEIN 单据。
- 采购/JIT/发货官方状态和每个 SKU 的 need/order/delivery/receipt/storage/defective 数量可追溯 Receipt/Ledger，unknown、partial 和 confirmed zero 不混淆。
- 合单资格、包裹装箱、重量尺寸、仓库/物流/预约在状态变更和 revision 失效后 fail closed；前端无隐藏选择或过期资格写入。
- 重复点击、断线、切店和 Worker/Redis/DB 崩溃不丢命令、不串店、不重复调用；send_started 后 unknown 不自动重试。
- 打印/标签、平台发货单、取件、到仓、质检和入库状态相互独立，页面不产生履约伪成功。
- 履约写只在单动作金丝雀与 SHEIN 后台、数据库、队列、日志和页面五方对账通过后放量；回滚不删除计划、命令、回执、数量账本、标签或案件。
- 退货 60 天和财务 7 天窗口、分页、重复/乱序与 partial failure 可重放；confirmed empty、partial、unknown 和 stale 不混淆。
- 每个退货/报废 SKU 的预计、实际、包裹、签收和差异均有 Receipt/Ledger；正向履约历史不被逆向流程改写。
- 平台原始退货/处罚/财务类别和内部版本化分类并存；质量、责任、申诉、财务和 CAPA 不共用状态。
- 消费者售后未接入时明确 unsupported，不显示伪 0、伪退款状态、伪退货率或未经必要性评审的 PII。
- 财务同单同 SKU 多报告/多费用/跨账期完整保留；matched、ambiguous、unmatched 和分摊证据均可审计。
- 官方已结算、待结算和内部预计损失分层，不同币种无可靠汇率不汇总，缺真实成本不计算利润或 ROI。
- 退货/报废/申诉命令重复点击、断线、切店和 Worker/Redis/DB 崩溃后不丢失、不跨店、不重复调用；result_unknown 不自动重试。
- 地址、运单、证据、消费者和财务数据跨 tenant/store、伪造 identity/revision/token、越权下载和重放写入均零副作用。
- 逆向只读与质量协作可渐进上线；任何平台写必须单店单动作金丝雀并完成官方回读和后台核对，回滚不删除案件、证据、财务事实或历史回执。
- SHEIN 财务 7 天窗口、列表/销售/补扣款明细、分页、重复/partial 可重放；报告总额、明细和未匹配差额均可解释。
- `costPrice` 在规范模型中只表示 SHEIN 供货价；工厂报价、实际采购成本、平台结算收入和消费者/活动价格不混淆。
- 每条成本有 SKU/批次/类型、actual/estimated/accrual、币种、数量/单位、来源、生效期和 revision；unknown 不补 0。
- 原币种永久保留，FX source/time/policy/version 可追溯；decimal/舍入正确，不同币种无证据不汇总。
- 毛收入、平台净收入、商品毛利和贡献利润分层，利润 Snapshot 显示收入/成本/售后/FX coverage 与质量。
- 平台已结算、应收、银行到账、核销以及报价、应付、发票、付款在 API/表/UI 中保持独立。
- 发票事件未核准不投影；缺银行 opening balance/流水覆盖不显示精确余额；首期无自动付款/开票/调账。
- 月结检查能阻断来源 stale、未匹配、缺成本/汇率/票据；重开生成新版本且旧关闭 Snapshot 可重现。
- 跨 tenant/store、伪造金额/identity/revision/token、越权看成本/银行/票据、重复导入和重放高风险动作均零副作用。
- 单店单期间影子利润与 SHEIN 后台/人工账核对通过后才扩店；回滚不删除报账、成本、FX、利润、核销或关闭历史。
- 供货价、平台建议价、商家报价、RRP、活动价、内部成本和结算收入在 API/表/UI/导出中不混淆，历史 revision 可重放。
- 商品审核、价格议价、RRP、命令和生效状态互不改写；逐 SKU/site partial、过期、失败和 unknown 均可见。
- 接受、拒绝、重报价、供货价和 RRP 的合同、payload、权限、开关、限流、批量与回读独立；未知消费者售价/活动能力不可达。
- 利润 partial/conflict/unknown、币种精度/原因/规则 stale、待审冲突和低于底线默认阻断；例外双人审批、预计损失、数量和有效期可审计。
- RRP 全量替换遗漏值不被清空；价格材料上传不改变业务状态；HTTP 200/accepted 不显示已生效。
- PriceCommand 在重复点击、断线和 Worker/Redis/DB 崩溃后不丢失、不重复调用；send_started 后 unknown 不自动重试。
- 价格 selection 只含当前可见 eligible 行；切 tab、筛选、店铺或 refresh revision 后无隐藏目标和跨店写入。
- 用户指定单动作单商品金丝雀必须与 SHEIN 后台、官方回读、命令/回执和页面五方核对后才扩量；回滚不删除价格、议价、审批、材料或命令历史。
- 生命周期、分层、平台活动、内部计划、领域执行和风险 Case 在 API/表/UI 中正交；同商品跨店/站点/version 阶段独立。
- 每次阶段迁移有 policy/input revision、coverage/quality、决定人、证据和 reviewAt；系统建议不自动晋级、放量、清仓或淘汰。
- 曝光/点击/转化/加购/支付数据未开放时始终 unknown；0 销量能区分可售、断货、下架、阻断和数据缺口，不推造原因。
- 测款冻结商品/内容/价格/库存版本、窗口和成功/停止标准；中途变化结束或分段旧实验，数据不足返回 inconclusive/data_invalid。
- 分层并列展示需求、利润、库存/履约、质量/售后、合规/内容和供应，不用单一销量或黑盒分数决定爆款。
- 地毯放量按尺寸 SKU、包装/体积重、利润、供应、质量和售后风险验证，小尺寸表现不覆盖大尺寸风险。
- 活动 API unsupported 时系统只创建人工后台任务；人工已提交、官方待审、已通过、活动中和结束不混淆。
- GrowthActionPlan 只交接对应领域任务，增长页面不直调标题/媒体/价格/库存/上下架/发布接口。
- 同一 growthSnapshot 的计数、列表、详情、分层和 allowedActions 一致；切店/筛选/刷新后无隐藏选择、旧响应或跨店阶段污染。
- 单店 shadow 与人工运营记录核对后才扩店；回滚不删除机会、阶段、实验、决定、任务、活动证据或复盘历史。

## 25. ERP-18：可观测性与运营诊断台

### 目标

让一次用户操作可以从浏览器追踪到 API、队列、Worker、SHEIN、数据库和最终页面状态。

### 必做清单

1. 每次关键操作生成 operationId。
2. 贯穿 requestId、jobId、batchId、attemptId、traceId 和 releaseId。
3. 诊断台展示服务版本、Worker heartbeat、队列、任务、投影和回读摘要。
4. 支持按店铺、SKC、version、operationId 查询。
5. 日志结构化并脱敏，不记录密钥、完整图片或完整 payload。
6. 建立错误分类和 P0/P1 告警。
7. 显示部分投影失败，不把官方成功和本地保存失败混为通用 500。
8. 建立发布、刷新、Webhook、媒体和 AI 的关键指标。
9. 高风险重放入口默认不存在；只读诊断与写入操作分开。
10. 建立授权 attempt、重授权身份匹配、凭证版本轮换、连接健康、生命周期动作和切店 operationId 时间线。
11. 店铺错误同时保留稳定错误码、脱敏原始证据、最后成功时间和可执行恢复建议。
12. 商品工作台记录 saveOperationId、preflightId、schema fingerprint、批量逐项结果和模板应用摘要；不得记录完整敏感 payload。
13. 指标覆盖草稿保存/409、预检耗时和阻断分布、模板覆盖、批量失败、上传失败与页面错误率。
14. 发布全链路贯穿 operationId、batchId、attemptId、commandId、outboxId、jobId、claimId、SHEIN traceId、receiptId 和 releaseId。
15. 指标增加 Outbox 最老年龄/重投、命令各阶段停留、send_started 后 unknown、每店在飞数、公平等待、SSE 连接/断线恢复和回执延迟。
16. 诊断台必须能回答“是否调用过 SHEIN、调用前后在哪个边界崩溃、收到什么证据、为什么 UI 显示当前状态”，不得只显示通用请求失败。
17. 审核链路贯穿 inboxEventId、receiptId、matchId、attemptId、projectionRevision、refreshOperationId、snapshotRevision 和 SHEIN traceId。
18. 指标增加重复/乱序/unmatched/conflict 回执、Reducer 延迟/失败、投影 revision 滞后、Snapshot p95/partial/stale、手动刷新去重率和各来源健康。
19. 诊断台按 Attempt 展示原始回执摘要、匹配依据、Reducer 决策、current pointer 变化和被忽略旧事件，不暴露完整敏感 payload。
20. 媒体链路贯穿 uploadOperationId、uploadSessionId、assetId、variantId、referenceId、productVersionId、platformReceiptId 和 SHEIN traceId。
21. 指标覆盖上传/校验/处理各阶段、重复内容、隔离、引用/hold、孤儿候选、回收站、删除失败、平台图片复用和原图误加载。
22. AI 标题链路贯穿 batchId、requestId、inputSnapshotId、outboxId、jobId、attemptId、providerTraceId、candidateId、decisionId 和 draftRevisionId。
23. 指标覆盖 Provider/Profile/model/prompt/schema 维度成功率、429/超时/解析失败、排队公平性、缓存命中、候选 blocker/采用/编辑/拒绝和 actual/estimated/unknown 成本。
24. 诊断台显示脱敏输入 fingerprint、send boundary、Profile/Prompt/Policy 版本和人工恢复建议；不显示 API Key、图片字节、完整 Prompt 或 Provider 原始响应。
25. 履约链路贯穿 refreshOperationId、sourceReceiptId、purchaseOrderId、planId/revision、eligibilityId、commandId、outboxId、jobId、attemptId、SHEIN traceId、deliveryId、packageId、reconciliationId 和 caseId。
26. 指标覆盖采购/发货 source freshness、分页覆盖、Webhook 积压、unmatched/conflict、临期/逾期、命令 accepted/known_failed/result_unknown 和官方回读延迟。
27. 按 SKU 展示 need/order/plan/delivery/receipt/storage/defective 数量来源和差异，不记录完整联系人、地址、电话或标签文件内容。
28. 诊断台能回答某次发货是否调用 SHEIN、发送前后边界、平台 code/trace、当前官方单据、为什么不可合单/不可修改以及数量为何不一致。
29. 标签生成、对象存储、短时下载和打印失败单独监控；打印成功不得计为发货或到仓成功。
30. 逆向链路贯穿 refreshOperationId、sourceReceiptId、returnOrderId、qualityCaseId、evidenceId、appealId、commandId、attemptId、SHEIN traceId、financeEntryId、reconciliationId 和 capaId。
31. 指标覆盖退货/财务 source freshness、60/7 天窗口覆盖、unmatched/ambiguous 金额、案件/申诉 SLA、result_unknown、逆向物流停滞和质量复发。
32. 诊断台能回答某条退货/报废/申诉是否调用 SHEIN、发送边界、官方回执、为何处于当前状态、关联哪些证据/财务明细以及为何匹配或未匹配。
33. 原始原因、责任评估、证据与消费者/财务敏感数据只显示脱敏摘要和可审计访问，不进入普通日志或通用错误响应。
34. 财务链路贯穿 refreshOperationId、sourceReceiptId、report/entryId、cost/importId、allocationRunId、fxSnapshotId、profitSnapshotId、AR/AP、invoice、cashTransaction、reconciliationCase、closeRun 和 releaseId。
35. 指标覆盖 SHEIN 报告/明细 freshness/coverage、成本导入失败、未分摊、FX 缺失、利润质量、应收应付账龄、未匹配资金/票据和期间关闭 blocker。
36. 诊断台能回答某个利润数字用了哪些报账单、成本/分摊、汇率和版本，哪些输入缺失，为什么与人工账/SHEIN 后台不同。
37. 金额精度、舍入差额、跨期晚到、重算结果漂移和同单多报告覆盖单独告警；不以通用“数据异常”掩盖影响金额。
38. 银行账户、税号、发票、成本、利润和供应商敏感数据只显示按 capability 裁剪的脱敏摘要；诊断日志不记录完整文件、账户或流水。

### 完成门

- 任一 P0 可以在不看秘密的情况下定位到具体层和版本。
- control/Worker 漂移会自动告警。
- 页面错误可以复制 operationId 给开发排查。

## 26. ERP-19：性能、安全、备份与故障演练

### 目标

在 2 核 4GB 单机约束下证明系统可恢复、可承载且不会因安全边界失败造成商业事故。

### 性能

1. 定义页面、API、队列和发布反馈 SLO。
2. 真实规模 fixture：多店、千级 SKC、百级草稿、批次和图片。
3. 测量 p50/p95/p99、内存、CPU、DB 连接、Redis 和 bundle。
4. 大列表服务端分页；只在必要处虚拟化。
5. 有界缓存、并发、重试和轮询。
6. 对单品编辑和 15/50/100 商品批量 fixture 测量首次可交互、输入延迟、重渲染、内存、请求数、保存和预检耗时。
7. 图片原字节不得进入 React state、Query cache 或 Draft JSON；大 SKU/商品列表按测量采用增量计算、分页或虚拟化。
8. 对 1/15/50/100 条 PublishCommand 测量 Outbox 投递、每店公平等待、SHEIN 反馈、SSE 展示和恢复后的 p50/p95/p99；并发以资源预算和平台限流为上限。
9. 对 1/15/50/100 条 AI 标题请求测量 input snapshot、Outbox、队列等待、取图/编码、Provider、候选校验、缓存命中、CPU/内存/网络和每店公平性；并发以 2 核 4GB、预算与 Provider 限流为上限。
10. 对 10/50/100 店、1k/10k 退货行、退货 60 天/财务 7 天时间切片、质量案件和大证据文件测量分页、匹配、汇总、CPU/内存/DB/对象存储和 p50/p95/p99。
11. 财务匹配、跨账期汇总和多币种转换必须服务端有界执行；浏览器不得下载全部明细或基于当前页计算总损失。
12. 对 10/50/100 店、数十万 Settlement/Cost Entry、7 天切片、多币种、Allocation/Profit 重算、AR/AP 和月结测量 p50/p95/p99、CPU/内存/DB/Redis。
13. 金额聚合、汇率换算、利润重算和导出使用数据库 decimal/有界后台任务；验证极大/极小/负值、舍入和分页顺序一致。
14. 成本/银行/发票文件采用流式校验、异步导入和私有对象；前端不保留完整大文件/明细数组，导出有行数/字节/并发预算。

### 安全

1. secret scan、依赖审计、Trusted Origin、CSRF、session、rate limit。
2. runtime DB 最小权限和迁移角色分离。
3. 对象存储私有、短期票据和跨店媒体隔离。
4. 审计 PII 和日志脱敏。
5. 授权 callback、撤销、断开、归档执行 CSRF、Trusted Origin、速率限制、能力门禁和回放保护。
6. 演练跨租户 state、回调重放、目标店铺错配、平台身份错配和普通成员越权；高风险生命周期动作预留 step-up/MFA 门。
7. AI Provider Endpoint 实施 hostname/port/path allowlist、DNS/IP 私网与 metadata 阻断、重定向不换 host、出站网络限制和密钥目的地主机绑定。
8. 演练普通成员越权配置/查看 Provider、跨 tenant/store 读取候选或缓存命中、日志/Trace 泄密和恶意 Prompt/Schema 输出。
9. 演练跨 tenant/store 读取退货、处罚、财务、消费者或证据，伪造 official identity/revision/token、越权导出/下载和重放退货/申诉命令。
10. 地址、运单、消费者 PII、财务明细和争议证据实行字段分级、日志脱敏、私有存储、短时票据、retention hold 和删除审计。
11. 演练普通运营越权读取/修改工厂成本、利润、银行账户、发票、供应商账单、FX、write-off 或期间关闭；UI 隐藏不能替代 API/SQL 门禁。
12. 成本/银行/发票导入防公式注入、恶意文件、重复/篡改、CSV 注入和对象越权；导出默认转义、最小字段、短时票据和水印/审计。
13. 未来付款执行必须双人审批、step-up/MFA、账户白名单、额度/频率、Trusted Origin、CSRF、回放保护和 send boundary；当前配置证明零可达写路径。

### 恢复

1. PostgreSQL 备份和实际恢复演练。
2. Redis 丢失、Worker 崩溃、control 重启、Webhook 重复、SHEIN 超时演练。
3. release 回滚演练。
4. result_unknown 和部分失败恢复演练。
5. 授权数据库事务中途失败、凭证轮换失败、Webhook 重复/乱序和连接健康误判恢复演练。
6. 切店过程中 control/Worker 重启、多标签页会话变化和 Redis 丢失演练，证明任务仍绑定原 storeId。
7. 在事务提交后、Outbox claim 后、BullMQ add 前后、Worker `send_started` 前后、SHEIN 接收后落库前逐点注入崩溃，证明不丢命令、不盲重发。
8. 演练 SSE/Redis 完全不可用：数据库命令仍推进，用户可通过 operation snapshot/手动刷新恢复，不改变业务结果。
9. 演练 Webhook 重复/乱序、相同事件由 Webhook 与查询重复到达、Attempt 映射歧义、Receipt 与 Projection 写入中途失败和旧终态迟到。
10. 使用 1000+ 当前行、多店并发手动刷新和单来源持续失败 fixture，验证服务端分页、有界并发、last-known-good、DB/内存/连接预算和快照 p95。
11. 演练 15/50/100/500 图直传、浏览器关闭、对象存储 404/5xx、Verifier/Processing/Cleanup Worker 重启和签名 URL 过期。
12. 演练 referenced/held/active-operation 素材在 Draft handoff、发布完成、清理重复执行和 reference_count 漂移下绝不被删除。
13. 测量 thumbnail 列表、原图预览、批量 hash/解码、Variant 处理和 SHEIN 图片上传的 CPU/内存/出网/p95。
14. 演练 AI Request 数据库提交后 Outbox/Redis/Worker 丢失、Provider send_started 前后崩溃、发送后超时、SSE 断线和多副本 Control，证明不丢请求、不自动重复计费调用。
15. 演练 Provider 429/5xx/Schema 违规/熔断、配置版本切换、缓存污染和预算耗尽，证明只降级 AI、A0 与商品主链继续。
16. 演练采购/发货分页重叠与遗漏、Webhook 重复/乱序、官方状态晚到、Receipt/Projection/Ledger 单事务中断和 LKG 恢复。
17. 在创建/修改/取消发货 `send_started` 前后、SHEIN 接收后落库前、同单冲突锁和 result_unknown 人工收敛点逐一故障注入。
18. 使用 10/50/100 店、1k/10k 采购行、1/15/50 发货计划、多个包裹和大标签文件测量分页、资格计算、队列公平、CPU/内存/DB/Redis/网络和 p95。
19. 演练地址/仓库/物流 Option stale、包裹数量/重量/尺寸冲突、标签 superseded、越权下载和跨店 eligibility token 重放，证明 fail closed 且零外部副作用。
20. 演练发货量、收货量、入库量和次品量差异，证明只开异常案件、不自动补发/退货/改库存，且历史 Ledger 可重放。
21. 演练退货/财务时间窗口边界、分页遗漏/重复、Webhook 乱序、列表有单但明细缺失、Receipt/Projection/Reconciliation 中断和 LKG 恢复。
22. 在退货/报废/申诉 send_started 前后、SHEIN 接收后落库前和 result_unknown 人工收敛点注入故障，证明不重复提交或改写官方事实。
23. 演练同业务单号/SKU 多报告、多费用、跨账期扣款/补款、supplierSku 变化、分类未知和 ambiguous 匹配，证明不覆盖、不误认领。
24. 演练消费者售后 unsupported、人工导入 provenance 缺失、证据文件损坏/恶意、hold 与生命周期冲突，证明 fail closed 且不输出伪 0/伪成功。
25. 演练 SHEIN 财务 7 天边界、列表成功但销售/补扣明细 partial、同单多报告、晚到冲销、Receipt/Projection 中断和 LKG 重建。
26. 演练成本导入重复/部分失败/错误币种、Cost/Allocation/FX/Profit 中途崩溃和重算，证明不重账、旧 Snapshot 可重现且 unknown 不变 0。
27. 演练 decimal 极值、负数、不同币种小数位、舍入差额和 FX 缺失/过期，证明前后端/导出结果一致且无浮点漂移。
28. 演练银行/发票导入、部分核销、合并收付款、短长款、跨期晚到、soft/hard close 和受控 reopen，证明源事实不可变。
29. 演练未来 PaymentCommand send_started 前后、审批撤销、账户变更和 Worker/Redis/DB 崩溃；当前阶段验证执行入口不可达且不会因部署误开。

### 完成门

- 恢复演练在隔离环境实际成功，不只是有文档。
- 资源预算在目标负载下有余量。
- P0 故障均有停止和恢复 runbook。

## 27. ERP-20：历史数据受控对账修复

### 目标

在不制造假成功、不自动重发的前提下，修复历史草稿、批次、job、run 和审核投影。

### 进入条件

- ERP-05、ERP-10、ERP-18、ERP-19 COMPLETE。
- 用户批准具体店铺、记录类型和 ID 范围。
- 已完成生产备份和恢复验证。

### 必做清单

1. 先生成 read-only before report。
2. 每种修复使用独立脚本和 dry-run。
3. SQL 目标必须是显式 ID 清单，不使用宽泛时间条件直接写入。
4. 有官方回读的记录按证据修正 current projection。
5. result_unknown 保持未知并阻止重发。
6. stale run 只关闭系统运行态，不改官方业务结论。
7. 已 handoff 草稿只移出默认草稿读模型，不删除草稿审计。
8. 旧驳回移入历史，最新版本保留当前。
9. 写后生成 after report 和差异。
10. 任一断言不符整笔回滚。
11. 只按证据回填 CatalogProduct/ProductVersion/PlatformProductLink，不按名称或 supplier code 自动合并。
12. legacy_unversioned 和 unmatched 保持只读诊断状态，不制造伪冻结版本。
13. 修复 handed_off 草稿读模型时不删除 Draft、Job、Receipt、媒体引用或历史 Attempt。
14. Platform link 冲突必须人工决策，修复脚本一次只处理显式 product/version/attempt ID 集合。
15. 识别旧 execution run“一条队列消息抽干整批”、缺失 send_started、重复 preflight JSON 和 Draft 直连 Job；只做证据分类和 additive 迁移，不自动重放 SHEIN。
16. 对 legacy Command/Job 只回填能由 receipt/log/official identity 证明的关系；无法证明是否发送的一律标 legacy_unknown 并阻断自动重发。
17. 对历史官方事件先执行 shadow replay，比较旧 projection 与新 reducer 结果；只输出差异、unmatched/conflict 和候选映射，不在本步骤之外自动改当前状态。
18. 历史归档/隐藏从官方 projection 拆为 ReviewCenterPreference 时保留审计和可恢复性，不删除 receipt、current pointer 或 timeline。
19. 历史媒体修复先输出对象存在性、可信 hash、role/order、Reference/Hold、ProductVersion 证据和内嵌 PlatformReceipt 的 dry-run。
20. `reusable_source` 保留冲突、missing/orphan 和 legacy_unversioned 保持显式分类；没有证据不伪造 VersionMedia、hash 或平台回执。

### 禁止

- 全量自动重发。
- 把 submitted 批量改 completed。
- 删除 receipt、audit、job 或 run。
- 一次脚本同时修复多个不相关问题。

### 完成门

- before/after/rollback 证据齐全。
- 数据库、统一快照 API 和页面对账。
- 用户确认修复范围结果。

## 28. ERP-21：Staging 全链路验收

### 目标

在生产前证明从草稿到审核回读的完整流程以及所有失败分支。

### 必做清单

1. 使用生产等价拓扑但独立数据、队列、对象存储和密钥。
2. 跑完整 Playwright、契约、集成、负载和故障测试。
3. 验证草稿 handoff 后移除。
4. 验证选择、计数、动态移行和手动刷新。
5. 验证额度 0、保证金、权限、SKU 重复、业务拒绝。
6. 验证 result_unknown 禁止重发和官方回读恢复。
7. 验证旧驳回历史和新尝试。
8. 验证合规与图片字段。
9. 验证 AI provider 不可用时普通流程继续。
10. 验证备份、恢复、回滚和 release 一致性。
11. 验证普通成员不能新增、重授权、断开、撤销、暂停、归档或修改全局店铺身份。
12. 验证新增授权本地事务失败无半完成店铺，回调重放/过期/跨租户被拒绝。
13. 验证指定店铺重授权身份匹配、身份错配阻断，以及成功后 storeId、历史、权限和店铺组保持。
14. 验证断开/官方撤销后本地历史可读、远端动作阻断、访问关系保留。
15. 验证 IP 白名单、限流、网络和 SHEIN 5xx 不会被误判为凭证失效。
16. 验证 A→B、A→B→A、多标签页、回退、失效 URL、未保存表单和旧请求晚到均不串店且不静默回落。
17. 验证切店不调用 SHEIN、业务调度器保持关闭、手动刷新任务幂等且旧快照失败不清空。
18. 验证暂停、断开、归档前检查全部活动任务，服务端在途任务始终绑定原店铺。
19. 验证稳定 CatalogProduct/CatalogSku 身份不随 draft、version、attempt 和 SHEIN version 变化。
20. 验证并发 Draft 保存冲突、旧 lockVersion 409、无静默覆盖。
21. 验证 handoff 单事务：失败完整回滚，成功立即退出草稿箱并出现对应 ProductVersion/Attempt。
22. 验证页面读取不写草稿、不调用 SHEIN，显式预检与 handoff 预检使用同一 owner。
23. 验证 result_unknown、official rejected、修正重发、作为新商品 fork 和旧 Attempt timeline。
24. 验证 PlatformProductLink 的 store 作用域、身份冲突 fail closed、versionless/unmatched 历史兼容。
25. 验证 ProductVersion 的内容、SKU、规则、模板和媒体证据在 Draft 引用释放后仍可重现。
26. 验证同一商品经单品、批量和草稿批处理产生一致 Draft payload，section 无第二份业务 truth。
27. 验证模板默认补空、显式覆盖/区段替换 diff 与撤销、手工值优先和版本不反向生效。
28. 验证文件夹导入重复/歧义/Unicode/隐藏文件，SKU 图映射不猜测，失败只阻断对应商品。
29. 验证 AI、图片预览和可选合规故障不阻断人工编辑；页面加载/自动保存无 SHEIN 调用。
30. 验证 15/50/100 商品的有界并发、逐项失败、重试、选择集合和资源预算。
31. 验证 PublishCommand/Event/Outbox/Draft handoff 原子性，以及数据库提交后 Dispatcher 可恢复投递。
32. 验证一 Command 一 Job、确定性 jobId、重复投递、Worker 发送前/后崩溃和 `send_started` 恢复矩阵。
33. 验证 result_unknown reconciler 只读、一次空回读不开放重发、known failure 新 Attempt 保留 parent/supersedes。
34. 验证 eligible/blocked 混合批次必须显式确认，成功项不被 blocker 或附属合规失败覆盖。
35. 验证 202 + SSE 在断线、重复连接、Redis 丢失和页面刷新后可从 PostgreSQL operation snapshot 恢复，且不产生第二次写请求。
36. 验证同一官方 fixture 经 Webhook、document-state 和 SPU readback 产生相同 normalized receipt/reducer 结果，重复和乱序不倒退。
37. 验证 current pointer 只按显式 Attempt 证据推进；旧版本终态、空回读、source failure 和 unmatched 不能覆盖当前投影。
38. 验证 Snapshot v2 在同一 revision 下 counts/rows/eligibility/freshness 对账，服务端分页 1000+ 行无重复/遗漏，浏览器不执行第二套状态 reducer。
39. 验证手动刷新重复点击复用 operation、浏览器无 SHEIN fan-out、切店/进页/聚焦/空闲 30 秒均不自动同步。
40. 验证 source unavailable 保留 last-known-good 并显示 partial/stale，归档偏好不修改官方状态或历史时间线。
41. 验证预签名直传的越权、过期、错误方法、大小/MIME/hash/尺寸冲突，只有服务端 verified Asset 可被引用。
42. 验证 Draft→ProductVersion MediaReference 原子交接、Draft 释放安全、重发新版本和历史版本完整还原。
43. 验证同资产不同 role/imageType、同店/跨店、模板/合规/AI 的复用边界和 PlatformMediaReceipt 键。
44. 验证素材中心与嵌入式 Picker 的分页、搜索、引用详情、逐项上传、重试、排序、替换、回收/恢复和权限。
45. 验证清理 Worker SQL、policy/hold/recycle/tombstone 在重复执行、对象 404/5xx、数据库失败和重启后仍安全收敛。
46. 验证 TitlePolicy 同版本同输入确定，浏览器即时提示与服务端 code/path/severity 对等，截断不切断词组且无事实属性不会被候选采用。
47. 验证 AI Provider/Redis/Worker 全停、未配置、未授权、429/5xx/超时时人工标题、模板、Draft 保存、preflight 和 handoff 均继续。
48. 验证每个候选可追溯 Draft revision、事实、variantHash、模板/Policy、Provider/model/prompt/schema 版本，且采用前不改变 Draft。
49. 验证 VisualRecognitionCache 与 FinalCandidateCache 精确键、配置/图片/事实变化、错误/unknown 不缓存和跨 tenant/store/user 负向隔离。
50. 验证 1/15/50/100 AI 批量 operation 的公平调度、逐项部分成功、刷新/断线/切店/进程重启恢复和不重复 Provider 调用。
51. 验证 Provider send_started 后超时进入 result_unknown/cost_unknown，不盲重试；人工新 attempt 保留 parent 和可能重复计费提示。
52. 验证候选采用/编辑/拒绝、diff/undo、手工值优先、旧 revision 失效提醒和 ProductVersion 最终 provenance。

### Live SHEIN 边界

默认只使用官方只读接口和确定性 fixture。若必须做写入 canary，需用户指定店铺和商品，并转入 ERP-22。

### 完成门

- 所有 P0 流程通过。
- 无未解释的 flaky 测试。
- release candidate 不再改变源码。

## 29. ERP-22：生产金丝雀与商业发布

### 目标

以最小真实范围验证商业闭环，再逐步放量。

### 进入条件

- ERP-21 COMPLETE。
- 用户明确批准候选、店铺、商品和维护窗口。
- quota、保证金、授权和 SKU 重复预检通过。
- 回滚 release、备份和观察面板就绪。

### 顺序

1. 部署候选但保持 live write 关闭。
2. 核对 manifest、control/Worker、DB、Redis、静态 hash。
3. 仅对一个用户指定商品开启一次性授权。
4. 观察 2–3 秒快速反馈、SHEIN 接收、document/version 和官方回读。
5. 核对页面、数据库、队列、日志和 SHEIN 后台五方一致。
6. 通过后扩大到一个小批次。
7. 再扩大到少量店铺。
8. 任一层不一致立即停止新命令并回滚应用。
9. 商品工作台金丝雀先核对 Draft payload/schema/template fingerprint 与 staging 对等，再允许进入真实 handoff。
10. canary 前核对 Outbox Dispatcher/Publish Worker 与 Control 同 release，最老 Outbox、活动 Command、每店并发和 live-write 一次性授权均正常。
11. canary 必须取得完整 accepted 身份证据；若进入 result_unknown，立即停止该业务键后续写入，只允许官方只读核对。
12. 审核中心金丝雀先对一个只读店铺运行新旧 reducer/snapshot shadow diff，确认 current Attempt、页签计数、行、eligibility 和 freshness 无未解释差异。
13. 再对用户触发的一次手动刷新验证 `refreshOperationId → inbox → receipt → projectionRevision → snapshotRevision → UI`，任一环缺证据立即保持旧读路径。
14. 媒体金丝雀先对一个用户指定商品只读比较旧图片 payload 与 VersionMedia→PlatformReceipt 新链，role/order/imageType/hash 任一不一致即停止。
15. 真实图片上传只使用用户指定店铺/商品，核对对象 hash、Variant、PlatformReceipt、SHEIN trace 与最终商品图片五方一致。
16. AI 金丝雀先只对一个批准用户和少量 Draft 启用：核对 Profile/Prompt/Policy 版本、候选/决定、Provider 调用数、缓存命中、用量成本和 A0 fallback；不允许 AI 自动 handoff 或发布。
17. 履约金丝雀先对一个只读店铺影子同步采购/JIT/发货单，核对状态、SKU 数量链、仓/标签、分页覆盖和 source freshness；任一 unknown 被写 0 或官方 code 映射不一致即停止。
18. 再对用户指定的一个 eligible 采购单创建一张发货单，核对 Plan/Eligibility revision、包裹/装箱、Command send boundary、SHEIN deliveryCode/trace 和官方回读。
19. 只有同一单据完成标签、取件/到仓和 need/order/delivery/receipt/storage/defective 数量对账后，才评审下一店铺或手工备货、修改/取消动作。
20. 履约任一动作出现 result_unknown、身份/数量 conflict、旧 Option 或后台不一致，立即冻结同业务键与该动作放量；只允许只读核对和回滚应用，不删除证据。

### 完成门

- 零伪发布。
- 零跨店数据。
- 零自动重复提交。
- 所有错误可解释并可追踪。
- 用户确认实际工作流可用。

## 30. ERP-23：稳定期与遗留退役

### 目标

在新架构稳定后才移除旧代码、旧产物和无用数据，避免再次把仍在运行的模块误删。

### 进入条件

- ERP-22 COMPLETE。
- 至少两个连续稳定 release，且不少于 7 个自然日无 P0 回归。
- 运行时引用、Nginx、构建、Worker 和导入图证明旧模块为零使用。

### 必做清单

1. 建立 legacy source、routes、build scripts、tables、columns、artifacts 使用清单。
2. 标记 keep、archive、deprecate、delete。
3. 先停止新引用，再观察，再归档，最后才删除。
4. 旧前端和部署包先进入可恢复归档。
5. 数据删除按保留政策、备份和用户批准执行。
6. 清理后从空环境重建并恢复备份。
7. 更新所有文档、diagram、runbook 和 onboarding。
8. 制定下一阶段商业功能路线，不在退役步骤顺手开发新功能。
9. 对 legacy 单品编辑、旧批量组装、旧草稿模板和重复文件导入路径分别出具零运行时引用证明后再归档。
10. 对旧 publish run 抽干 Worker、直接 Draft Job、请求内 fast-ack 轮询和旧队列 consumer 分别证明零 claim/零 enqueue/零路由后再退役。
11. 对前端 Draft/Batch/Readback/Review 二次 reducer、中文状态分类、浏览器回读 fan-out、旧 review snapshot v1 和 projection 归档写路径分别证明零运行时调用后再退役。
12. 对旧 `media_assets.purpose` 业务判断、Draft/Template 图片数组 owner、专项跨店媒体路由、内嵌 SHEIN 图片缓存和旧 Cleanup Worker 分别证明零写/零读依赖后再退役。
13. 对旧 AI 同步 suggest 直调、单进程 Map 队列/缓存、浏览器批量 Promise Worker、可变 Provider 设置和直接覆盖标题路径分别证明零真实调用、候选/用量对账和两个稳定 release 后再退役。
14. 对旧采购/发货接口包装、临时订单 JSON、浏览器合单判断、同步 HTTP 写、通用 retry、标签缓存和任何第二履约写 owner 分别证明零读写、单据/数量对账和两个稳定 release 后再退役。

### 完成门

- 零运行时引用。
- 恢复测试通过。
- 用户批准具体删除清单。
- 代码库、制品库和生产目录边界清晰。

## 31. 已知问题到步骤的追踪矩阵

| 已知问题 | 主要步骤 | 不能提前用补丁掩盖 |
| --- | --- | --- |
| 网页伪发布、SHEIN 无商品 | ERP-04、09、10、11、13、22 | 不能只改文案 |
| control/Worker 投影漂移 | ERP-08、09、18 | 不能只重建 control |
| 已驳回复选框失效/重复 | ERP-11、13 | 不能继续叠加过滤条件 |
| 4 条可见却显示选中 15 | ERP-11、13 | 不能保留隐藏 selected IDs |
| 已驳回重发后未动态移除 | ERP-10、11、13 | 不能用假 optimistic success |
| 待审核/核价/寄样/终审分类混乱 | ERP-04、10、11 | 不能靠中文字符串猜状态 |
| 手动刷新先报错/部分回读失败 | ERP-10、13、18 | 不能把 partial 变通用 500 |
| 已提交商品仍留草稿箱 | ERP-12、20 | 不能物理删除审计草稿 |
| legacy 页面误部署 | ERP-01、02、03、08 | 不能手工复制未知 dist |
| 多套同步 owner | ERP-08、10、17、18 | 不能新增页面级轮询 |
| AI_TITLE_PROVIDER_FAILED | ERP-15、18 | AI 不得阻断普通流程 |
| AI A2/A3 本地/云端漂移 | ERP-08、15 | 不能凭历史记录说已部署 |
| AI 请求/队列/候选只在页面或单进程内存，刷新重启后丢失 | ERP-06、08、15、19、21 | 不能继续用浏览器并发和 Map 当 durable operation |
| AI 缓存缺少 variant/model/prompt/schema/policy 完整版本 | ERP-06、15、19、21 | 不能靠配置后清本进程缓存证明正确失效 |
| AI 直接覆盖标题、缺少候选/决定/Revision provenance | ERP-12、13、14、15、21 | 不能把模型响应当作用户已确认业务事实 |
| 任意 HTTPS Provider URL、发送后超时和用量未知 | ERP-07、15、18、19、21 | 不能盲重试、隐藏换模型或只做 URL 语法检查 |
| 1630/1631 与图片/报告混用 | ERP-16 | 不能本地猜报告类型 |
| 合规要求来源 partial/empty/unknown 被当成无要求或通过 | ERP-07、10、16、21 | 不能用空数组、旧中文汇总状态或 0 覆盖 last-known-good 与来源健康 |
| 报告、本体图、包装图、证书和代理材料角色/范围混用 | ERP-06、07、15、16、21 | 不能因同模板、同 hash、同文件或历史通过就复制平台适用性与回执 |
| 合规上传/保存/绑定在同步 HTTP 中执行，确认令牌只在单进程内存 | ERP-06、08、16、19、21 | 不能靠延长超时、按钮禁用或总开关掩盖持久命令和发送边界缺失 |
| 商品已被 SHEIN 接受后合规失败又把发布改成失败/驳回 | ERP-04、09、10、12、16、21 | 不能把发布执行、商品审核、合规案件和人工任务合成一个万能状态 |
| GCC/产品标识符等后台专属动作在网页被标记已完成 | ERP-06、13、16、21 | API 不支持时只能创建可审计人工任务，未获官方复核不得称为平台完成 |
| 合规批量写保留隐藏选择、整批覆盖逐项结果或跨店串选 | ERP-13、16、17、21 | 选择只能绑定当前 Snapshot 的可见 eligible 集合，必须逐项 partial success |
| 未知库存被当作 0 | ERP-17 | 不能用 UI 默认值修饰 |
| SKU 销量接口缺行/缺字段被补成 0 | ERP-06、07、17、21 | 必须逐 target 对账和传播 coverage，不能用 `value || 0` 制造确认零销量 |
| 部分 SKU 在途求和后被展示为商品/店铺完整在途 | ERP-06、17、21 | 只能展示 known subtotal + coverage，未知子项存在时不得称完整总量 |
| 最新经营事实集中在 JSONB，SKU 销量和库存历史表未成为事实源 | ERP-05、06、17、20 | 不能由 7/30 日窗口反推历史或先删除兼容快照 |
| 销量、库存、上架和详情共用一个截止时间/健康状态 | ERP-06、10、17、18、21 | 每个 source/metric 必须保留独立 receipt、cutoff、quality 和 LKG |
| 7 日销量减可用库存被称为智能备货 | ERP-06、13、17、21 | 只可称基础缺口；完整建议需 lead time、安全库存、MOQ、包装倍数、在途策略和版本证据 |
| 经营预警每次随快照重算，无负责人、处理状态和复发历史 | ERP-06、13、17、18、21 | 不能用卡片隐藏替代持久 AlertCase 与事件时间线 |
| 跨店汇总混用不同截止、覆盖率、经营模式和指标版本 | ERP-11、17、21 | 不可比指标不得强制相加，必须显示覆盖店铺、unknown 和 cutoff skew |
| 官方未开放流量/转化数据被本地估算成经营事实 | ERP-07、17、21 | 不得推造曝光、访客、CTR、加购或转化率；缺真实财务数据也不算 GMV/利润 |
| Scheduler/Webhook/页面事件绕过手动刷新原则 | ERP-08、10、17、18、21 | Webhook 只落事件/标 dirty，Scheduler 和进页/切店/聚焦/30 秒自动刷新继续关闭 |
| Recommendation 或基础缺口被直接当作 SHEIN 备货单 | ERP-04、06、13、17、21 | 必须经 Plan Revision、审批、独立 Command 和官方单号回读，不能自动执行或生成假平台单 |
| 平台采购单、内部计划、发货计划和平台发货单共用一个 order/status | ERP-04、06、10、11、17、21 | 对象和状态机必须正交，UI 聚合不能覆盖底层证据 |
| need/order/delivery/receipt/storage/defective 数量被合并、补 0 或相互覆盖 | ERP-06、07、17、21 | 使用 SKU Quantity Ledger、source/cutoff/quality 和差异 Case，不得用一个 quantity 万能字段 |
| JIT 母子单、部分发货、拆单/合单或采购状态被中文字符串误判 | ERP-04、07、10、17、21 | 只按当前官方 code/ID/Receipt 和版本化 reducer，不靠名称或失败试错 |
| 合单忽略采购类型、仓、预估仓、市场、安检/品类或 SKU 集合约束 | ERP-04、07、13、17、21 | 版本化 Eligibility Engine、稳定 blocker 和当前 revision 影响预览 |
| 地址、仓库、物流、预约或包裹限制被硬编码/使用 stale 选项 | ERP-06、07、17、21 | 当前 Option Snapshot、官方 ID/freshness；stale fail closed，不复用示例值 |
| 创建/修改/取消发货在同步 HTTP 或通用队列 retry 中执行 | ERP-06、08、17、19、21 | 持久 Command/Outbox、一命令一 Job、send_started 和同单串行，发送后 unknown 不自动重试 |
| 页面显示已发货/已入库，但只有 HTTP 200、队列完成或标签已打印 | ERP-04、10、11、13、17、21 | 平台发货单与官方回读是状态证据；打印和本地 accepted 保持独立 |
| 发货量、收货量、入库量、次品量不一致却无闭环或自动改库存 | ERP-06、10、17、18、21 | 开 FulfillmentExceptionCase、保留 Ledger，不自动补发/退货/库存写 |
| 地毯大尺寸使用 SKC 平均重量/箱规，造成体积重、包装或物流事故 | ERP-06、07、17、19、21 | 尺寸 SKU + Package Revision + 当前物流限制；缺实测保持 unknown |
| 履约列表隐藏选择、过期 eligibility 或跨店批量发货 | ERP-11、13、17、21 | selection 绑定当前 store/snapshot/eligibility，只作用可见 eligible 集合，跨店写默认不存在 |
| 采购/发货 Webhook 或 Scheduler 绕过手动刷新形成自动读取/写入 | ERP-08、10、17、18、21 | Webhook 只落 Inbox/标 dirty；当前仍由单一手动 Operation 回读，自动平台写永久禁止 |
| 跨账号/店铺缓存串数据 | ERP-03、17、21 | 不能只清当前组件 state |
| 历史 stale job/run/draft | ERP-05、20 | 禁止自动重发或批量改成功 |
| 巨型页面与控制器 | ERP-14、18、23 | 不在 P0 修复中顺手拆完 |
| 单品/批量/草稿批处理多套商品组装 owner | ERP-03、06、12、14、21 | 不能继续复制页面级 payload/模板逻辑 |
| 模板重引覆盖手工值或入口间语义漂移 | ERP-06、14、15、21 | 不能以 UI 默认值或批量 map 掩盖 |
| 文件夹导入和 SKU 图片映射歧义 | ERP-14、15、21 | 不能猜第一张、用目录名作商品身份 |
| 大批量建品冻结、请求风暴或整批失败 | ERP-14、18、19、21 | 不能用无限并发或全量重算换取表面速度 |
| AI/媒体/可选合规故障阻断安全编辑 | ERP-14、15、16、21 | 不能把可选能力错误提升为通用 blocker |
| 缺少浏览器端到端和视觉回归 | ERP-03、13、21 | 源码字符串测试不能替代 |
| 数据库已提交命令但 BullMQ 未入队 | ERP-06、08、09、19、21 | 不能用请求后补 add 或人工重启掩盖事务缝隙 |
| 一个 execution run 队列任务在 Worker 内抽干整批 | ERP-08、09、19、23 | 不能继续用批次循环代替一 Command 一 Job |
| `result_unknown` 在发送边界后被自动重试 | ERP-04、07、09、10、19、21 | 不能把网络错误当作 SHEIN 未接收 |
| 发布请求内轮询 8 秒才返回 | ERP-03、09、13、19、21 | 不能用阻塞 HTTP 换取表面即时反馈 |
| 发布执行、核对、官方审核和合规共用 completed | ERP-04、06、09、10、11、13 | 不能用一个万能状态覆盖四类事实 |
| 一个 blocker 把同批 eligible 商品全部写成失败 | ERP-09、12、13、21 | 不能静默代用户选择，也不能整批覆盖逐项结果 |
| 审核 Snapshot 由多来源请求临时拼装，计数与列表不是同一数据库版本 | ERP-03、10、11、19、21 | 不能用 Promise.allSettled 或客户端二次合并冒充一致快照 |
| 前端同时读取 Draft/Batch/Readback/Review 并按中文字符串再分类 | ERP-04、10、11、13、23 | 不能在页面维持第二套状态机 |
| current Attempt 依赖更新时间、最新版本或最新行启发式 | ERP-04、06、10、20、21 | 不能用“看起来最新”替代显式指针和证据匹配 |
| document-state 回执与当前审核投影分开持久化，可能只成功一半 | ERP-06、10、19、21 | 不能吞掉部分写失败后继续显示新状态 |
| 回读来源失败时默认空数组，页面出现假 0/空列表 | ERP-10、11、13、21 | 不能用异常默认值覆盖 last-known-good |
| 浏览器手动刷新 fan-out 多接口、多版本和重复 refetch | ERP-03、10、13、19、21 | 不能靠按钮防抖掩盖服务端缺少单一 operation owner |
| 本地归档/隐藏直接改变官方当前投影 | ERP-06、10、11、13、20 | 不能为清理页面而改写官方事实或丢失 timeline |
| Asset purpose 同时承担上传来源、业务用途和保留策略 | ERP-04、06、15、20 | 不能继续增加 purpose 枚举掩盖 Reference/Policy 缺失 |
| 发布完成释放 Draft 图片但没有不可变 VersionMedia 所有权证据 | ERP-05、06、09、12、15、21 | 不能靠延长 expiresAt 或 reference_count 猜测保护 |
| `reusable_source` 永久与 3 天保留迁移相互冲突 | ERP-05、15、19、20 | 不能直接改生产 expiresAt 或先运行清理 Worker |
| 清理候选 SQL/引用缓存漂移可能误删或停止清理 | ERP-03、15、19、21 | 不能用手工删对象或忽略 Worker 错误 |
| 浏览器自报 hash、服务端只 HEAD，内容完整性不可证明 | ERP-03、06、15、19、21 | 不能把客户端 SHA 当可信资产证据 |
| 裁剪/压缩/水印没有不可变 Variant 与变换版本 | ERP-06、14、15、21 | 不能覆盖 objectKey 或在 Draft 只存结果 URL |
| SHEIN 图片 URL/MD5/trace 散落候选 JSON，没有平台媒体账本 | ERP-06、07、09、15、21 | 不能按 URL 或 `assetId:imageType` 内存 Map 宣称可复用 |
| 素材库缺少稳定分页、引用详情、回收站和统一 Picker | ERP-11、13、15、19、21 | 不能让各页面继续自建上传/选择状态 |

## 32. 用户批准点

以下节点必须得到明确批准：

1. ERP-01：建立私有远端、首个基线提交或移动历史制品。
2. ERP-02：生产切换单一 V2 静态产物。
3. ERP-04：生命周期和页面状态名称。
4. ERP-06：任何生产迁移。
5. ERP-13：审核中心交互/低保真设计。
6. ERP-20：任何历史生产数据修复。
7. ERP-22：候选部署、真实 SHEIN canary 和放量。
8. ERP-23：任何删除或不可逆归档。

只读检查、测试、文档、隔离 fixture 和不触及外部状态的本地实现不需要反复确认，但仍必须遵守步骤范围。

## 33. 后续对话的标准指令

用户以后可以直接说：

“开始 ERP-00。严格按主计划和执行台账工作，只执行本步骤，不提前做下一步。”

执行者必须先回复本步骤的：

- 目标。
- 允许范围。
- 禁止范围。
- 失败回归。
- 完成门。

完成后必须报告：

- 实际改动。
- 证据。
- 未通过项。
- 新发现问题。
- 当前步骤状态。
- 下一步是否已具备 READY 条件。

没有台账和证据，不得回复“已经修复完成”。
