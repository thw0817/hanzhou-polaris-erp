# SHEIN 商业 ERP 执行台账

版本：2026-08-29-v19
方案名称：**涵舟 Polaris（北极星）商业 ERP 重构计划（HANZHOU-POLARIS）**  
状态：ERP-00、ERP-01、ERP-02 已完成；ERP-03 staging Outbox 全链路与本机 bundled Chromium 已补证，但远端 CI runner 门禁仍为 UNKNOWN，保持 GATE_FAILED；ERP-04～ERP-23 尚未开始；历史修复记录另行保存
主计划：[COMMERCIAL_ERP_MASTER_EXECUTION_PLAN_2026-08-28.md](./COMMERCIAL_ERP_MASTER_EXECUTION_PLAN_2026-08-28.md)  
分板块架构：[COMMERCIAL_ERP_MODULE_ARCHITECTURE_2026-08-28.md](./COMMERCIAL_ERP_MODULE_ARCHITECTURE_2026-08-28.md)  
当前活动步骤：ERP-03 / GATE_FAILED / RUN-20260829-ERP03-STAGING-CHAIN-02

## 0. 台账用途

本台账不是待办清单，而是每一次诊断、修复、迁移、测试和上线的事实记录。主计划规定“按什么顺序做”，本台账证明“实际做了什么、为什么做、如何验证、是否可以回滚”。

执行规则：

1. 同一时间只能有一个 ERP 步骤为 `IN_PROGRESS`。
2. 开始工作前先创建 Run 记录，再读取或修改文件。
3. 没有失败基线、允许范围和成功标准，不得开始写代码。
4. 新问题先登记 Issue ID，再决定是否属于当前步骤；不属于则登记，不顺手修。
5. 任何生产部署、数据库写入或真实 SHEIN 写入都要单独记录授权、时间、操作者、证据和回滚点。
6. 页面截图只能证明页面表现，不能单独证明 SHEIN 已接收、数据库已更新或线上 release 正确。
7. 步骤未通过完成门时，只能标记 `BLOCKED` 或 `GATE_FAILED`，不得写“基本完成”。

## 1. 当前执行总览

| 步骤 | 名称 | 状态 | 当前 Run | 前置条件 | 完成证据 |
| --- | --- | --- | --- | --- | --- |
| ERP-00 | 变更冻结与真相基线 | COMPLETE | RUN-20260829-ERP00-BASELINE-01 | 无 | [ERP-00 基线报告](./ERP00_BASELINE_REPORT_2026-08-29.md)；备份与隔离恢复验证通过 |
| ERP-01 | 源码资产救援与版本控制 | COMPLETE | RUN-20260829-ERP01-ASSET-BASELINE-01 | ERP-00 | [ERP-01 基线报告](./ERP01_BASELINE_REPORT_2026-08-29.md)；commit/tag、私有镜像、空目录 clone、1170 测试、双构建和静态审计通过 |
| ERP-02 | 单一 V2 前端产物恢复 | COMPLETE | RUN-20260829-ERP02-V2-ARTIFACT-01 | ERP-01 | [ERP-02 报告](./ERP02_BASELINE_REPORT_2026-08-29.md)；V2 单一构建、manifest、审计、浏览器关键路由和线上只读核验通过 |
| ERP-03 | CI、预发与发布门禁 | GATE_FAILED | RUN-20260829-ERP03-STAGING-CHAIN-02 | ERP-02 | staging DB/Redis/MinIO/Control、迁移、隔离和 Outbox→BullMQ→Worker synthetic 全链路已实测通过；本机 bundled Chromium 2/2 通过；远端 CI runner 尚未执行 |
| ERP-04 | 商品生命周期与状态字典定稿 | NOT_STARTED | — | ERP-03 | — |
| ERP-05 | 历史数据证据盘点 | NOT_STARTED | — | ERP-04 | — |
| ERP-06 | 规范数据模型与事件账本 | NOT_STARTED | — | ERP-05 | — |
| ERP-07 | SHEIN 适配器契约硬化 | NOT_STARTED | — | ERP-06 | — |
| ERP-08 | Control、Worker 与 release 一致性 | NOT_STARTED | — | ERP-07 | — |
| ERP-09 | 可靠发布命令管线 | NOT_STARTED | — | ERP-08 | — |
| ERP-10 | 官方审核回读与状态投影 | NOT_STARTED | — | ERP-09 | — |
| ERP-11 | 审核中心统一快照 API | NOT_STARTED | — | ERP-10 | — |
| ERP-12 | 草稿到发布批次交接闭环 | NOT_STARTED | — | ERP-11 | — |
| ERP-13 | 发布与审核中心商业级前端 | NOT_STARTED | — | ERP-12 | — |
| ERP-14 | 商品编辑器与预检闭环 | NOT_STARTED | — | ERP-13 | — |
| ERP-15 | 媒体、模板与 AI 标题 | NOT_STARTED | — | ERP-14 | — |
| ERP-16 | 合规与地毯品类闭环 | NOT_STARTED | — | ERP-15 | — |
| ERP-17 | 多店群、权限、经营分析、履约、售后、财务、价格、增长、协同与报表 | NOT_STARTED | — | ERP-16 | — |
| ERP-18 | 可观测性与运营诊断台 | NOT_STARTED | — | ERP-17 | — |
| ERP-19 | 性能、安全、备份与故障演练 | NOT_STARTED | — | ERP-18 | — |
| ERP-20 | 历史数据受控对账修复 | NOT_STARTED | — | ERP-19 | — |
| ERP-21 | Staging 全链路验收 | NOT_STARTED | — | ERP-20 | — |
| ERP-22 | 生产金丝雀与商业发布 | NOT_STARTED | — | ERP-21 | — |
| ERP-23 | 稳定期与遗留退役 | NOT_STARTED | — | ERP-22 与稳定期 | — |

> 状态只允许使用：`NOT_STARTED`、`READY`、`IN_PROGRESS`、`BLOCKED`、`GATE_FAILED`、`READY_FOR_APPROVAL`、`COMPLETE`。

## 2. 已知问题登记

以下问题来自历史交接、用户截图和既往修复记录。它们是“需要重新取证的问题”，不是对当前生产状态的未经验证断言。

| Issue ID | 级别 | 问题 | 当前状态 | 主要步骤 | 关闭所需证据 |
| --- | --- | --- | --- | --- | --- |
| BUG-PUB-001 | P0 | 页面显示已提交或发布，SHEIN 后台无商品，形成伪发布 | OPEN_REVERIFY | ERP-04、09、10、11、13、22 | 同一命令的事件链、SHEIN 接收标识、官方回读、页面状态一致 |
| BUG-PUB-002 | P0 | Control 与 Worker 版本或状态投影不一致 | OPEN_REVERIFY | ERP-08、09、18 | 两类进程同 release、同 schema、同事件解释，重启后仍一致 |
| BUG-PUB-003 | P0 | 真实发布执行开关、路由或运行环境未启用 | OPEN_REVERIFY | ERP-07、08、09 | 启动自检、受控 canary、明确失败反馈和审计日志 |
| BUG-PUB-004 | P0 | PublishCommand/执行协议数据库提交后才调用 BullMQ add，进程在两者之间崩溃可能留下永久未投递命令 | CONFIRMED | ERP-06、08、09、19、21 | 事务 Outbox 故障注入证明提交后可恢复投递，队列不可用不丢 Command |
| BUG-PUB-005 | P0 | 当前 publish_jobs 仍直接关联 ProductDraft，执行候选可受 mutable Draft 与 legacy 状态影响 | CONFIRMED | ERP-06、09、12、20、21 | Command/Job 只引用 immutable ProductVersion，旧 Draft 变化不改变已交接 payload |
| BUG-PUB-006 | P0 | 同一 execution protocol 同时保存在关系表和 batch preflight JSON，存在双写漂移与重放歧义 | CONFIRMED | ERP-05、06、09、20、21 | 唯一规范 Command/Attempt 事实，legacy JSON 仅保留只读证据，投影可重建 |
| BUG-PUB-007 | P1 | 一个 executionRun 队列消息由 Worker 循环领取整批，单项背压、恢复、公平性和诊断边界不清 | CONFIRMED | ERP-08、09、18、19、23 | 一 Command 一 BullMQ Job、确定性 jobId、逐项 lease/事件和多店公平测试通过 |
| BUG-PUB-008 | P1 | 直接发布在一个 HTTP 请求内串行 confirm、plan、authorize、execute，控制器承担长事务编排 | CONFIRMED | ERP-09、12、13、19 | durable handoff 后返回 202；后续只由 Dispatcher/Worker 推进，重复请求复用 operation |
| BUG-PUB-009 | P1 | fast acknowledgement 在创建请求内每 150ms 轮询并最长阻塞约 8 秒，易超时且与业务状态耦合 | CONFIRMED | ERP-03、09、13、19、21 | 202 + operation snapshot/SSE；创建请求不等待外部结果，断线可恢复 |
| BUG-PUB-010 | P0 | 主商品执行完成与 readback、audit、SPU、合规照片完成存在耦合，completed 可能覆盖不同业务事实 | CONFIRMED | ERP-04、06、09、10、11、13 | 执行、核对、官方审核、合规四类状态分离，附属失败不改写 accepted |
| BUG-PUB-011 | P0 | 直接发布存在任一 blocked 项可能把同批 eligible 项一并写为失败的路径 | CONFIRMED | ERP-09、12、13、21 | eligible/blocked 显式预览与确认；逐项命令/结果，blocker 不覆盖其他项 |
| BUG-PUB-012 | P0 | claim 过期未依据外部调用前后的 send_started 边界恢复，可能误置 unknown 或误重试 | CONFIRMED | ERP-04、06、09、19、21 | send_started 持久化；前边界安全恢复，后边界无明确回执只能 result_unknown |
| BUG-PUB-013 | P1 | 通用 BullMQ 默认重试与商品发布 attempts=1 依赖调用点覆盖，未来新增入口可能恢复危险自动重试 | CONFIRMED | ERP-03、08、09、21 | 队列类型级策略和测试固定 publish attempts=1，安全重投只由 Command/Outbox 控制 |
| BUG-PUB-014 | P1 | 批次 pause/resume/retry 对 mixed accepted/unknown/failed 项的精确作用范围需要重新验证 | OPEN_REVERIFY | ERP-04、09、13、21 | 状态矩阵与 E2E 证明只操作 send_started 前或明确可新尝试项，不重置 accepted/unknown |
| BUG-PUB-015 | P1 | 合规照片提交与主商品 executor 同步耦合，附属写失败可能延长或污染主发布结论 | CONFIRMED | ERP-09、16、18、21 | 独立 Command/Workflow 状态；主 accepted 回执先落库且不可被附属失败覆盖 |
| BUG-PUB-016 | P1 | accepted 后本地额度临时投影的 exactly-once 恢复与重复回执处理缺少故障证据 | OPEN_REVERIFY | ERP-06、09、17、19、21 | 重复/乱序回执和落库崩溃测试证明额度只投影一次，未知不扣成确定值 |
| BUG-PUB-017 | P1 | 发布调度缺少明确的每店共享限流、公平队列和全局资源预算，批量大店可能饿死其他店 | CONFIRMED | ERP-08、09、18、19、21 | 每店默认单在飞、跨店公平、全局有界并发和 1/15/50/100 压测指标达标 |
| BUG-REV-005 | P0 | Review Center Snapshot v1 在一次请求内并发拼接草稿、批次、审核和逐批回读，不是同一数据库一致性快照 | CONFIRMED | ERP-03、10、11、19、21 | Snapshot v2 只读规范投影，同事务返回 counts/rows/eligibility/freshness/revision，测试逐项对账 |
| BUG-REV-006 | P0 | 前端继续从 Draft、Batch、Readback、Review 和核价数据执行第二套分类、计数与选择归并 | CONFIRMED | ERP-04、10、11、13、23 | 页面只消费 Snapshot 稳定 code/allowedActions，删除运行时二次 reducer，契约与 E2E 证明一致 |
| BUG-REV-007 | P0 | 当前审核尝试仍可能按 job 更新时间、最新 version 或最新一行启发式选择 | CONFIRMED | ERP-04、06、10、20、21 | 显式 CurrentReviewPointer 和 parent/supersedes 驱动；歧义进入 conflict，旧尝试只在 timeline |
| BUG-REV-008 | P0 | 手动刷新由浏览器 fan-out 多套接口、逐版本 SHEIN 查询和多次 refetch，产生竞态与请求风暴 | CONFIRMED | ERP-03、10、13、19、21 | 单一服务端 Refresh Operation、重复去重、有界并发、202/SSE 和浏览器零 SHEIN fan-out |
| BUG-REV-009 | P0 | document-state 回执与 product review projection 独立并行持久化，单边失败会留下证据/当前状态分裂 | CONFIRMED | ERP-06、10、19、21 | receipt/match/projection/current pointer 单事务提交，失败注入后零半状态且可重放 |
| BUG-REV-010 | P1 | 服务端与前端仍有中文标签/别名参与审核状态分类，文案调整可能改变业务归类 | CONFIRMED | ERP-04、07、10、13、21 | 原始官方值经版本化 source map 转稳定 code，中文只展示，unknown fail closed |
| BUG-REV-011 | P1 | product_review_states 同时承担官方当前投影和本地归档/隐藏，运营偏好可能改写官方事实 | CONFIRMED | ERP-06、10、11、13、20 | 官方 Projection 与 ReviewCenterPreference 分离；归档不改状态、计数事实或 timeline |
| BUG-REV-012 | P0 | 多来源回执缺少统一 envelope、证据等级、优先级和单调归并规则，迟到事件可能覆盖新状态 | CONFIRMED | ERP-04、06、07、10、19、21 | 统一 receipt envelope、mapVersion、幂等键与单调 reducer；重复/乱序 fixture 不倒退 |
| BUG-REV-013 | P1 | `needs_action` 混合草稿阻断、发布失败、结果未知、未接收、撤回和官方驳回，无法给出准确动作 | CONFIRMED | ERP-04、10、11、13 | 运营原因码分域聚合并返回 allowedActions；官方审核状态保持独立 |
| BUG-REV-014 | P0 | 回读来源失败时使用空默认值，可能把 last-known-good 清成 0 或空列表 | CONFIRMED | ERP-10、11、13、21 | source health + stale/partial + last-known-good；仅成功的真实空结果显示 empty |
| BUG-REV-015 | P1 | 审核列表一次读取至多 1000 条 Webhook 事件并在内存归并，缺少大店稳定分页与可重建读模型 | CONFIRMED | ERP-06、10、11、19、21 | 规范投影增量写入、服务端稳定分页、1000+ 行性能/无重复遗漏测试通过 |
| BUG-REL-001 | P0 | legacy 与 V2 双构建导致线上误部署旧前端 | OPEN_REVERIFY | ERP-01、02、03、08 | 单一构建入口、制品 manifest、线上 hash/release 可核验 |
| BUG-REV-001 | P0 | 已驳回商品复选框重复、禁用或无法勾选 | OPEN_REVERIFY | ERP-11、13 | 真实浏览器逐行/全选/取消/切标签/刷新 E2E 通过 |
| BUG-REV-002 | P0 | 可见 4 条但选中 15 条，隐藏选择跨筛选残留 | OPEN_REVERIFY | ERP-11、13 | selection 只含当前可操作集合，UI、请求体和服务端数量一致 |
| BUG-REV-003 | P0 | 待审核、核价、寄样、审版、核样、终审、驳回分类混乱 | OPEN_REVERIFY | ERP-04、10、11 | 官方原始状态 fixture 与本地状态逐项映射，互斥计数一致 |
| BUG-REV-004 | P0 | 已驳回重新发布后未按真实结果动态移出 | OPEN_REVERIFY | ERP-09、10、11、13 | SHEIN 接收后才移出；结果未知与失败保留且可诊断 |
| BUG-REF-001 | P1 | 手动刷新先显示通用失败，随后又显示部分成功 | OPEN_REVERIFY | ERP-10、13、18 | partial success 独立表达，错误归属单个批次/商品，重复点击幂等 |
| BUG-SYNC-001 | P0 | 多套同步 owner、重复任务或不同页面读取不同真相 | OPEN_REVERIFY | ERP-08、10、11、17、18 | 单 owner、单任务状态、统一快照版本和跨页一致性 |
| BUG-DRF-001 | P0 | 已提交商品仍留在草稿箱，草稿与发布批次边界混乱 | OPEN_REVERIFY | ERP-04、06、12、20 | 草稿只展示可继续编辑/待发布项，提交后可审计但不重复出现 |
| BUG-DRF-002 | P1 | 草稿进入审核中心时误判“需处理”，重新保存后才可提交 | OPEN_REVERIFY | ERP-12、14 | 同一预检服务、字段级错误、保存前后无隐式状态差异 |
| BUG-AI-001 | P1 | AI 标题 Provider 失败，错误不可诊断或批量失败 | OPEN_REVERIFY | ERP-15、18 | provider 分类错误、trace、降级、单项重试且不阻塞普通流程 |
| BUG-AI-002 | P1 | AI 标题 A2 图片复用、A3 并发调度本地与云端漂移 | OPEN_REVERIFY | ERP-03、08、15 | 同 release 验证、缓存命中、并发上限、取消/超时/部分成功测试 |
| BUG-AI-003 | P1 | AI 标题请求是同步 HTTP，队列/in-flight/结果只在单个 Control 进程内存，多副本和重启不共享/不恢复 | CONFIRMED | ERP-06、08、15、19、21 | durable Request/Event/Outbox，一 item 一 Job；重启、Redis 丢失和多副本故障注入不丢请求、不重复调用 |
| BUG-AI-004 | P1 | 批量 AI 由浏览器两个 Promise Worker 逐项调用，刷新、断线或关闭页面后没有服务端 operation 真相 | CONFIRMED | ERP-13、15、19、21 | 202 batch operation、逐项 DB snapshot、服务端公平调度、页面恢复和部分成功验收 |
| BUG-AI-005 | P1 | 视觉识别缓存键缺少 variantHash、Provider Profile、model、prompt/schema version，失效主要依赖单进程 epoch | CONFIRMED | ERP-06、15、19、21 | 两级缓存精确键、跨进程失效/自然 miss、错误/unknown 不缓存和跨作用域负向测试 |
| BUG-AI-006 | P1 | 缺少 TitleGenerationRequest、Attempt、Candidate、Decision 和 Usage 持久账本，历史建议与成本无法重现 | CONFIRMED | ERP-06、15、18、20、21 | 追加式对象/事件、输入快照、候选/决定/用量可按 Draft revision 与 trace 对账 |
| BUG-AI-007 | P1 | Prompt 和返回 JSON schema 硬编码在服务中，Attempt 不保存 prompt/schema/policy/adapter 版本 | CONFIRMED | ERP-06、07、15、21 | 版本化 Prompt/Schema/Policy/Adapter、严格解析 fixture、升级不改历史候选 |
| BUG-AI-008 | P1 | Provider 调用直接耦合业务服务，只假设 OpenAI-style 请求，缺少 Adapter、健康、熔断和受控切换 | CONFIRMED | ERP-07、15、18、19、21 | 注册 Adapter/ProfileVersion、能力声明、稳定错误、health/breaker 和无隐藏 failover |
| BUG-AI-009 | P0 | 管理员可配置任意 HTTPS Provider URL，仅语法校验不足以阻断 DNS/重定向访问私网或 metadata | CONFIRMED | ERP-07、15、19、21 | hostname/port/path allowlist、DNS/IP/重定向/egress SSRF 负向测试和密钥目的地主机绑定 |
| BUG-AI-010 | P1 | AI Worker 路径把整张图片读入内存并 Base64 填充 JSON，批量并发存在内存复制与带宽放大 | CONFIRMED | ERP-15、19、21 | 受控 ai_input Variant、短时 URL 或限流流式读取、字节预算和 1/15/50/100 压测 |
| BUG-AI-011 | P0 | 标题合法性仅靠自由文本模板拼接和字符 slice，缺少事实、禁词、重复、语言、片段优先级等权威规则 | CONFIRMED | ERP-04、07、14、15、21 | 版本化 TitlePolicyEngine、稳定 code/path/severity、服务端权威和官方 fixture |
| BUG-AI-012 | P1 | 单品 AI 结果直接替换当前标题，没有 2～3 候选、采用前 diff、旧 revision 检查、Decision 或 undo | CONFIRMED | ERP-12、13、14、15、21 | 候选默认不写 Draft；采用/编辑/拒绝建 Decision 与新 revision，手工值优先、可撤销 |
| BUG-AI-013 | P1 | tenant Provider 设置为可变单行，缺少配置版本、审批/回滚、数据政策、模型切换和完整审计 | CONFIRMED | ERP-06、15、18、19、21 | immutable ProfileVersion、secretRef、审批/停用/轮换审计、历史 Attempt 固定版本 |
| BUG-AI-014 | P1 | AI 标题没有 tenant/store/user 预算、单批上限和 actual/estimated/unknown 用量成本账本 | CONFIRMED | ERP-06、15、17、18、19、21 | UsageEvent、预算/配额/预估、Provider usage 对账和预算超限只阻断 AI |
| BUG-AI-015 | P1 | Provider 发送后超时无法区分未发送、可能已计费与明确失败，通用重试会重复计费 | CONFIRMED | ERP-06、15、19、21 | send_started、known_failed/result_unknown/cost_unknown 状态机，人工 child Attempt 且不盲重试 |
| BUG-AI-016 | P1 | 当前只返回一个图案名和一个拼接结果，没有多候选确定性验证、可解释排序和事实违规隔离 | CONFIRMED | ERP-04、14、15、21 | 2～3 Candidate、严格 schema、TitlePolicy blocker/warning、score breakdown 与 provenance |
| BUG-MEDIA-001 | P1 | 图片用途、模板、主图、SKU 预览图在流程间漂移 | OPEN_REVERIFY | ERP-14、15、16 | canonical media role、稳定排序、编辑/草稿/发布 payload 一致 |
| BUG-MEDIA-002 | P0 | `media_assets.purpose` 同时承担上传来源、生命周期和业务用途，单一资产多角色复用时语义冲突 | CONFIRMED | ERP-04、06、15、20 | Asset/Reference/RetentionPolicy 分离，role/slot/order 归 Reference，purpose 不再驱动业务映射 |
| BUG-MEDIA-003 | P0 | 发布完成会释放 Draft 媒体引用，但现模型不能证明 ProductVersion 已先拥有不可变 VersionMedia | CONFIRMED | ERP-05、06、09、12、15、21 | handoff 同事务冻结全部 VersionMedia 后才释放 Draft Reference，失败完整回滚 |
| BUG-MEDIA-004 | P0 | `reusable_source` 在迁移 014 声明永久保留、迁移 015 又改为 3 天，生命周期定义冲突 | CONFIRMED | ERP-05、15、19、20 | 只读影响报告、唯一版本化 retention policy、迁移 dry-run 和受保护素材零误删 |
| BUG-MEDIA-005 | P0 | Media Cleanup 候选 SQL 存在 SELECT 尾随逗号，上传超时 OR 分支边界也缺少行为证明 | CONFIRMED | ERP-03、15、19、21 | SQL 集成回归、候选 fixture、Worker 重启/重复执行/对象故障测试全部通过 |
| BUG-MEDIA-006 | P0 | 浏览器提交 SHA-256，服务端只做对象 HEAD 大小/类型校验，实际内容 hash 不可信 | CONFIRMED | ERP-03、06、15、19、21 | 对象 checksum 或服务端流式 verifier 证明 hash/MIME/尺寸，未 verified 不可引用 |
| BUG-MEDIA-007 | P1 | 裁剪、压缩、水印和缩略图没有不可变 MediaVariant 与变换版本，结果来源无法重现 | CONFIRMED | ERP-06、14、15、21 | parentVariant/transformSpec/engineVersion/output hash 完整，可幂等复用且不覆盖原图 |
| BUG-MEDIA-008 | P0 | SHEIN 图片 URL、MD5、imageType 和 trace 散落在远端候选/回执 JSON，没有规范平台媒体账本 | CONFIRMED | ERP-06、07、09、15、21 | store-scoped PlatformMediaReceipt，完整键、契约版本、unknown 和 Attempt 引用可审计 |
| BUG-MEDIA-009 | P1 | 媒体列表最多 100 条且无稳定分页、搜索、引用详情、回收站或独立素材中心 | CONFIRMED | ERP-11、13、15、19、21 | 素材中心 API/页面、游标分页、引用/hold/删除资格和大规模 E2E 通过 |
| BUG-MEDIA-010 | P1 | 上传使用页面局部 fetch，缺少统一队列、逐项恢复、取消和批量故障隔离，完成后再次整文件 arrayBuffer 计算 hash | CONFIRMED | ERP-03、13、15、19、21 | 统一 UploadQueue、Worker hash/受控校验、逐项进度/重试/恢复和 15/50/100/500 压测 |
| BUG-MEDIA-011 | P1 | SHA-256 只有索引，没有可信内容寻址、重复冲突处理和安全复用授权 | CONFIRMED | ERP-06、15、17、21 | tenant 内 verified hash 去重建议、scope/capability 校验、冲突 fail closed、跨 tenant 零泄露 |
| BUG-MEDIA-012 | P0 | 跨店模板媒体依赖专项可见性路由，没有统一 MediaShareGrant，权限边界难以扩展和审计 | CONFIRMED | ERP-06、15、17、21、23 | tenant/store/user/compliance scope + ShareGrant，专项旁路零引用后退役 |
| BUG-MEDIA-013 | P0 | 合规证据和普通商品图的限制绑定在 Asset purpose，不能完整表达本体/包装/证书/报告等独立角色和保留 hold | CONFIRMED | ERP-06、15、16、21 | compliance-locked scope、独立 role/receiptKind/RetentionHold 和跨槽/跨店负向测试 |
| BUG-MEDIA-014 | P0 | reference_count/status/引用表由多条路径同步，缓存漂移可能导致清理停滞或误删 | CONFIRMED | ERP-06、15、19、21 | 删除前事务反查 Reference/Hold/active operation，计数只作投影，tombstone 幂等恢复 |
| BUG-MEDIA-015 | P1 | 商品、模板、批量导入、合规和 AI 各自维护局部上传/选择状态，没有统一 MediaPicker 和资产使用证据 | CONFIRMED | ERP-13、14、15、16、21 | 同一 Picker/UploadQueue/Reference command 契约，页面只管理目标 role/slot |
| BUG-CMP-001 | P1 | 合规报告 1630/1631、报告类型与图片字段混用 | OPEN_REVERIFY | ERP-07、14、16 | 官方契约 fixture、报告/图片分离、缺失字段不伪造 |
| BUG-CMP-002 | P0 | 合规 requirement、photo requirement、规则和原始响应分散，来源 partial/empty/unknown 时可能被解释为无要求、假通过或假 0 | CONFIRMED | ERP-06、07、10、16、21 | Raw Inbox、版本化 Snapshot、source health、覆盖率、LKG 和 partial/empty fixture 证明未知不覆盖已知事实 |
| BUG-CMP-003 | P0 | 当前中文汇总状态同时表达要求、材料、执行、平台审核和来源健康，无法准确判断 blockers 与允许动作 | CONFIRMED | ERP-04、06、11、13、16 | 五组正交状态、稳定 reasonCode/allowedActions、一致 Snapshot 和 API/UI 状态矩阵通过 |
| BUG-CMP-004 | P0 | 合规记录未以 requirementId + target + official snapshot/version 形成稳定案件身份，JSON 结果难以证明当前要求和历史变更 | CONFIRMED | ERP-04、05、06、16、20 | 精确 ComplianceCase identity/revision、原始来源、时间线和影子迁移对账通过 |
| BUG-CMP-005 | P0 | 合规材料角色、适用范围和复用边界依赖 Asset purpose、模板或 hash，报告/本体/包装/证书可能跨槽或跨目标误用 | CONFIRMED | ERP-06、15、16、21 | MaterialRole/Applicability/MediaReference 分离，跨店/跨 SKC/跨类型负向测试零副作用 |
| BUG-CMP-006 | P0 | 历史实现与文档曾对 1630/1631 使用本地尺寸推导、旧快照或后续覆盖，当前生产真实边界仍需重新取证 | OPEN_REVERIFY | ERP-05、07、16、20、21 | 当前官方响应是唯一类型来源；无类型时不展示/不提交；真实 fixture 与生产只读取证一致 |
| BUG-CMP-007 | P0 | 证书/报告上传、保存、绑定和回读在一个同步 HTTP 请求中推进，缺少持久分步命令、回执和部分成功恢复 | CONFIRMED | ERP-06、08、16、19、21 | 一动作一 Command/Job，逐阶段 Attempt/Receipt，崩溃/超时/重启后可恢复且不重复外部调用 |
| BUG-CMP-008 | P1 | 代理资料缺少独立主体、市场、type/range/effective dates、适用对象和失效生命周期，难以安全复用与复验 | CONFIRMED | ERP-06、07、16、21 | 版本化 AgencyMaterial/Applicability、到期事件、逐目标绑定和官方回读 fixture 通过 |
| BUG-CMP-009 | P1 | 警示语规则、schema、映射、互斥和排除关系可能随本地规则或旧快照漂移，并与普通描述字段混用 | CONFIRMED | ERP-04、07、14、16、21 | 当前官方 schema/version、确定性 mapping/exclusion、旧 revision 阻断与多市场 fixture 通过 |
| BUG-CMP-010 | P1 | GCC、产品标识符等 API 不支持动作没有规范人工任务、SLA、证明和官方复核，存在人工勾选即假完成风险 | CONFIRMED | ERP-06、13、16、18、21 | ManualComplianceTask 全生命周期、owner/SLA/proof、双人复核可选和平台回读前不显示完成 |
| BUG-CMP-011 | P0 | 合规真实写确认令牌保存在单进程内存且依赖全局总开关，多副本、重启和动作级放量边界不可靠 | CONFIRMED | ERP-03、06、08、16、19、22 | 持久授权/确认、动作级 capability/canary、重启/多副本测试和 release manifest 可核验 |
| BUG-CMP-012 | P0 | 合规写缺少持久 send_started 与 result_unknown 边界，上传/保存/绑定超时后普通重试可能重复提交 | CONFIRMED | ERP-06、07、08、16、19、21 | 外部调用前持久化边界；发送后未知不自动重试；Adapter 幂等能力与人工新 Attempt 可审计 |
| BUG-CMP-013 | P0 | pre-SKC/post-SKC 合规门禁及商品 accepted 与合规失败仍可能在不同路径耦合，附属失败污染主发布事实 | CONFIRMED | ERP-04、09、10、12、16、21 | 门禁阶段分离；SKC 回读后只开 Case；商品 accepted 不可被合规状态覆盖的故障注入/E2E |
| BUG-CMP-014 | P1 | 合规批量选择和执行缺少与当前 Snapshot/eligible 集合绑定的持久 operation，可能残留隐藏选择或整批覆盖逐项结果 | CONFIRMED | ERP-11、13、16、17、21 | Snapshot revision/eligibility token、影响预览、逐项 partial success 和切筛选/切店 E2E |
| BUG-CMP-015 | P1 | 敏感证书/代理/实拍材料的下载、脱敏、保留期、法律 hold、跨店授权及正式 API 合同文档不完整 | CONFIRMED | ERP-00、06、07、15、16、19、21 | 正式来源索引恢复；短时票据、审计、RetentionHold、跨店拒绝和删除资格证明通过 |
| BUG-AUTH-001 | P0 | 用户、租户、店铺、缓存或任务存在越权/串店风险 | OPEN_REVERIFY | ERP-03、06、17、21 | 服务端范围校验、负向测试、切店并发测试、缓存 key 审计 |
| BUG-AUTH-002 | P0 | 多个业务写路由缺少统一动作权限门禁，viewer 只读边界不完整 | CONFIRMED | ERP-03、06、21 | 全路由动作清单、viewer/operator 负向矩阵、写入零副作用、统一 403 |
| BUG-AUTH-003 | P0 | 普通成员可发起 SHEIN 店铺授权并可能修改全局店铺名称 | CONFIRMED | ERP-03、17、21 | 授权/重授权/撤销/全局命名仅限明确管理能力，普通成员 API 与 UI 均拒绝 |
| BUG-AUTH-004 | P1 | 公开注册可加入运营工作空间，不符合内部 ERP 默认邀请制 | CONFIRMED | ERP-03、17、19 | 生产默认关闭注册，邀请可撤销、过期、一次使用且全程审计 |
| BUG-AUTH-005 | P1 | 全局用户状态、单租户邀请和最高角色自动登录不能支持多工作空间成员生命周期 | CONFIRMED | ERP-06、17、19、21 | membership 独立状态、已有用户跨空间邀请、显式工作空间选择和 Owner 保护 |
| BUG-INV-001 | P1 | 未知库存/额度被展示或计算为 0 | OPEN_REVERIFY | ERP-04、10、17 | `unknown` 与数值 0 分离，统计和 UI 均不误算 |
| BUG-INV-002 | P0 | SKU 销量响应缺行或字段缺失时 `sumSales` 以 0 参与商品、店铺和预警聚合，没有 requested/returned target 覆盖对账 | CONFIRMED | ERP-06、07、17、21 | 缺行/缺字段 fixture、SourceReceipt coverage 和 quality propagation 证明 unknown 不写 0、不触发零销量预警 |
| BUG-INV-003 | P0 | 商品与店铺在途库存只求和已知 SKU 子集，未知 SKU 存在时仍可能把部分小计展示为完整在途 | CONFIRMED | ERP-06、17、21 | known subtotal + coverage/partial 语义，SKU/SKC/store 逐层完整性测试和 UI 明示通过 |
| BUG-INV-004 | P1 | 商品、销量、库存、上架和预警主要集中在最新 `store_business_snapshots` JSONB，结构化 SKU 历史事实没有成为读模型 | CONFIRMED | ERP-05、06、17、20、21 | 双写 SourceReceipt/facts、影子对账、一致 Snapshot 切换和旧 JSON 回滚/零引用证明 |
| BUG-INV-005 | P0 | 销量、库存、上架和详情使用不同请求却共用店铺 `syncedAt/dataDate`，无法逐指标表达 cutoff、freshness、partial 和 LKG | CONFIRMED | ERP-06、10、17、18、21 | 分 source receipt/health/cutoff，单元格 quality 和跨来源偏差 fixture 通过 |
| BUG-INV-006 | P0 | `store_sales_daily` 写入与现有表默认值使用 `Number(value || 0)`/NOT NULL DEFAULT 0，可能把未知销量固化成确认 0 | CONFIRMED | ERP-05、06、17、20、21 | quality/source schema 迁移、unknown-safe 持久化和历史影响报告，不批量回填伪 0 |
| BUG-INV-007 | P1 | `stock-query.warehouseInventoryList` 未结构化保留，无法解释不同仓库的可用、锁定、临时锁和在途构成 | CONFIRMED | ERP-06、07、17、21 | WarehouseInventorySnapshot、warehouseCode/invType 合同、聚合和详情 E2E 通过 |
| BUG-INV-008 | P1 | `replenishmentGap/suggestedRestock = max(0, sales7 - availableInventory)` 被作为备货建议展示，缺少 lead time、安全库存、MOQ、包装倍数和生命周期 | CONFIRMED | ERP-06、13、17、21 | 旧值改称 7 日基础缺口；版本化 Policy/Recommendation、公式分解和数据不足边界通过 |
| BUG-INV-009 | P1 | 可售天数无法区分确认零销量、销量 unknown、新品样本不足和断货抑制销量，且没有指标质量与版本 | CONFIRMED | ERP-04、06、17、21 | MetricDefinition、quality propagation 和零销量/断货/新品/unknown 行为矩阵通过 |
| BUG-INV-010 | P1 | 销量下降使用 7 日与 `30日-7日` 近似窗口，没有真实非重叠日序列却容易被解释为趋势 | CONFIRMED | ERP-06、17、21 | 仅在真实历史日事实覆盖后启用 trend；当前近似项降级标识且不画伪曲线 |
| BUG-INV-011 | P1 | 经营预警随快照重算为临时数组，没有规则版本、案件状态、负责人、SLA、去重、解决和复发历史 | CONFIRMED | ERP-06、13、17、18、21 | AlertRuleVersion/BusinessAlertCase、完整事件时间线和重复刷新不重复开案测试 |
| BUG-INV-012 | P1 | 缺货/库存预警 Webhook 与库存读取、快照脏标记和预警案件没有统一经营事件边界 | CONFIRMED | ERP-06、10、17、21 | 正式事件合同、验签幂等 Inbox、EventFact/Case、冲突显示且不直接覆盖库存/自动刷新 |
| BUG-INV-013 | P1 | 跨店总览可能聚合不同截止时间、覆盖率、经营模式和指标版本，缺少可比性门禁 | CONFIRMED | ERP-11、17、21 | 同版本/单位/模式/cutoff 规则，覆盖店铺/unknown/cutoff skew 展示和不可比阻断 |
| BUG-INV-014 | P1 | 定时刷新 Scheduler 实现仍可通过配置启用，且 Webhook dirty 与用户手动刷新边界需要固定，存在未来恢复自动同步风险 | OPEN_REVERIFY | ERP-08、10、17、18、21 | 生产配置/启动自检证明 Scheduler 默认关闭；进页/切店/聚焦/30 秒和 Webhook 不发起全量刷新 |
| BUG-INV-015 | P1 | 库存请求仍同时发送将于 2026-12-31 下线的 `warehouseType` 与 `invType`，兼容期后可能合同失效或语义漂移 | CONFIRMED | ERP-07、17、21、22 | `invType=PI` 单一合同金丝雀、warehouseType 零运行时依赖、正式 fixture 与 release 自检通过 |
| BUG-FUL-001 | P0 | V2 尚无规范采购/备货/仓库/发货履约领域服务与完整工作台，能力主要停留在归档接口清单 | CONFIRMED | ERP-00、05、17 | 源码/接口/表/开关/生产资产全图，FUL-01 基线和零隐藏写 owner 证明 |
| BUG-FUL-002 | P0 | 内部备货建议、人工计划、平台采购单、发货计划和平台发货单缺少独立规范对象与正交状态 | CONFIRMED | ERP-04、06、17、21 | 对象/状态字典、迁移影子对账和 UI/API 契约证明无万能 order/status |
| BUG-FUL-003 | P0 | `need/order/delivery/receipt/storage/defective` 等 SKU 数量没有结构化 unknown-safe 账本，存在合并、补 0 或相互覆盖风险 | CONFIRMED | ERP-06、07、17、21 | Quantity Ledger、缺字段 fixture、守恒/覆盖率和逐阶段差异 E2E 通过 |
| BUG-FUL-004 | P0 | 经营 `replenishmentGap` 可能被误解为可直接执行的备货量，缺少 Plan Revision、审批和平台回执边界 | CONFIRMED | ERP-04、06、13、17、21 | Recommendation→Plan→Approval→Command→Official Order 全链，未确认零 SHEIN 调用 |
| BUG-FUL-005 | P0 | 采购、JIT、物流、仓库、发货、标签、手工备货和修改/取消的大部分正式合同只有归档摘要或局部原文 | CONFIRMED | ERP-05、07、17、21 | 当前官方原文索引、方法/字段/错误/QPS/退役、真实脱敏 fixture 和 unsupported 清单 |
| BUG-FUL-006 | P1 | 采购/发货/物流 Webhook 已登记但未证明形成可重放 Inbox、精确匹配、官方投影和一致 Snapshot | CONFIRMED | ERP-06、10、11、17、21 | 重复/乱序/unmatched fixture、单事务 reducer、手动回读 LKG 和跨页一致性通过 |
| BUG-FUL-007 | P0 | 发货地址、供应商仓、物流产品、货代、收货仓和预约缺少带来源/新鲜度的 Option Snapshot，易出现硬编码或 stale 写入 | CONFIRMED | ERP-06、07、17、21 | 当前 Option Receipt、ID/scope/expiry、地址变更重算、stale fail-closed 和无固定佛山仓证明 |
| BUG-FUL-008 | P0 | 合单/可发资格缺少服务端版本化 Engine，采购类型、仓、市场、标签、品类、JIT、SKU 集合和数量可能靠失败试错 | CONFIRMED | ERP-04、07、13、17、21 | Eligibility revision、完整 blocker matrix、真实错误 fixture 和过期选择零外部写 |
| BUG-FUL-009 | P1 | 包裹、装箱明细、箱唛/条码/物流面单和打印没有独立版本模型，修改后可能继续使用旧标签或数量 | CONFIRMED | ERP-06、13、15、17、21 | Package/Artifact revision、hash/receipt/void、逐项打印审计和 superseded 负向测试 |
| BUG-FUL-010 | P0 | 创建/修改/取消发货与手工备货尚无持久 Command/Outbox/send boundary，未来同步 HTTP 或通用 retry 会造成重复平台写 | CONFIRMED | ERP-06、08、17、19、21 | 一命令一 Job、send_started、result_unknown、同单串行和逐点崩溃注入通过 |
| BUG-FUL-011 | P0 | 本地命令 accepted、队列完成或打印成功可能被错误投影为已发货/到仓/入库，形成履约伪成功 | CONFIRMED | ERP-04、10、11、13、17、21 | 官方 Delivery/Purchase Receipt 单调投影，命令/打印/物流/到仓状态完全分离 |
| BUG-FUL-012 | P1 | 临期、少发/超发、物流停滞、收货/入库/次品差异没有持久案件、负责人、SLA 和复发历史 | CONFIRMED | ERP-06、13、17、18、21 | FulfillmentExceptionCase、去重/分派/解决/复发和不自动补发/退货测试 |
| BUG-FUL-013 | P0 | 履约大列表若复用普通复选框状态，可能产生隐藏选择、过期 eligibility、跨筛选/跨店发货 | CONFIRMED | ERP-11、13、17、21 | selection scope token、当前可见 eligible 集合、切店/刷新/权限变化 E2E 和请求数量一致 |
| BUG-FUL-014 | P1 | 发货地址、联系人、电话、运单和标签文件的脱敏、下载票据、保留与访问审计尚未形成正式合同 | CONFIRMED | ERP-06、17、19、21 | 字段分类、私有对象、短时票据、导出最小化、跨店下载拒绝和 retention 证明 |
| BUG-FUL-015 | P1 | 地毯包装未按尺寸 SKU 维护实重/体积重/箱规/折叠压缩与包材风险，SKC 平均值会误导物流 | CONFIRMED | ERP-06、07、17、19、21 | 尺寸级 Package fixture、unknown 边界、物流限制和大尺寸包装/到仓差异验收 |
| BUG-FUL-016 | P1 | 采购/发货状态若新增 Scheduler、页面轮询或 Webhook 自动读取，会绕过已确认的手动刷新 owner 并形成请求风暴 | OPEN_REVERIFY | ERP-08、10、17、18、21 | 启动/网络 E2E 证明无 30 秒/进页/切店/聚焦/Scheduler；Webhook 只落事件/标 dirty |
| BUG-RET-001 | P0 | V2 尚无规范退货/报废、质量、责任、申诉、处罚和财务对账领域服务与完整工作台 | CONFIRMED | ERP-00、05、17 | RET-01 资产/运行图、规范对象、零隐藏写 owner 和 unsupported 能力清单 |
| BUG-RET-002 | P0 | 退货申请/处置/取件/承运/可退库存和写动作合同只有部分原文或目录线索，且退货列表示例存在重复 `/open-api` 路径冲突 | CONFIRMED | ERP-05、07、17、21 | 当前官方原文/API Explorer/真实脱敏 fixture 三方核准；未核准 action fail closed |
| BUG-RET-003 | P0 | 平台退货状态、质量处理、责任、申诉和财务状态若共用售后状态，会产生“登记/提交即成功”和历史覆盖 | CONFIRMED | ERP-04、06、10、17、21 | 六类正交状态机、append-only event/current pointer 和 UI/API 状态对等测试 |
| BUG-RET-004 | P0 | 预计/实际退货、报废、包裹和签收数量缺少 SKU 级 unknown-safe 账本，可能反向覆盖采购/发货/入库/次品历史 | CONFIRMED | ERP-06、17、21 | Reverse Quantity Ledger、守恒/coverage、上游只读和历史不变回归通过 |
| BUG-RET-005 | P0 | 退货/财务 API 与 Webhook 尚无统一可重放 Inbox/Receipt、60/7 天窗口覆盖和 LKG，空/缺页可能误判为无退货或无扣款 | CONFIRMED | ERP-06、10、11、17、21 | 时间切片/分页/重复乱序/partial fixture、target coverage、一致 Snapshot 和重放通过 |
| BUG-RET-006 | P0 | 未来退货/报废/确认/申诉若沿用同步 HTTP 或通用 retry，发送未知会造成重复申请、重复确认或材料覆盖 | CONFIRMED | ERP-06、08、17、19、21 | Durable Command/Outbox、send_started、result_unknown、业务键锁和故障注入通过 |
| BUG-RET-007 | P0 | 当前消费者售后只有解决方案目录线索而无已核准合同，页面若显示自动同步或 0 会伪造消费者订单、退款和投诉事实 | CONFIRMED | ERP-05、07、13、17、21 | unsupported 明示、最小人工/导入 provenance、无 PII 推造和未来合同门禁 |
| BUG-RET-008 | P1 | 平台退货原因和财务 `replenishCategory` 为可变化文本，缺少 raw 保留与版本映射会造成历史重分类或错误定责 | CONFIRMED | ERP-04、06、17、21 | raw code/text 永久保留、taxonomy/map revision、unknown 新值和历史不改写测试 |
| BUG-RET-009 | P0 | 缺陷图片、测量、面单、消费者沟通和财务证据尚无角色、hash、隐私、hold、保留与访问审计合同 | CONFIRMED | ERP-06、15、17、19、21 | EvidenceBundle、字段分级、私有对象、短时票据、跨店下载拒绝和 lifecycle/hold 测试 |
| BUG-RET-010 | P1 | 质量原因可能被直接当作供应商责任，缺少证据不足、争议、多方责任、审批和 supersede 机制 | CONFIRMED | ERP-04、06、13、17、21 | ResponsibilityAssessment、候选/决定分离、证据矩阵和不自动扣款 E2E |
| BUG-RET-011 | P0 | 同一业务单号/SKU 可能出现在多张财务报告和多项调整中，覆盖式 upsert 或使用当前 supplierSku 会丢账/错账 | CONFIRMED | ERP-06、10、17、21 | FinanceEntry 不可变身份、跨账期 fixture、历史 SKU 映射和多明细完整性对账 |
| BUG-RET-012 | P0 | 财务明细与退货/质量/履约缺少 matched/ambiguous/unmatched 模型，按标题/金额/时间近似会误认领损失 | CONFIRMED | ERP-04、06、17、21 | 版本化匹配、候选证据、Allocation、人工复核和歧义/未匹配可见性通过 |
| BUG-RET-013 | P0 | 官方已结算、待结算和内部预计损失若混合，不同币种直接相加或缺成本仍算利润会产生伪精确经营结论 | CONFIRMED | ERP-04、06、17、21 | 损失层级、currency/FX source/time/version、coverage/unknown 和禁止伪利润测试 |
| BUG-RET-014 | P0 | 逆向/质量大列表若复用普通复选框，可能隐藏选择、跨筛选/跨店或 stale eligibility 批量退货/申诉 | CONFIRMED | ERP-11、13、17、21 | selection 强 scope、当前可见 eligible 集合、影响预览和请求数量一致 E2E |
| BUG-RET-015 | P1 | 质量案件与商品/包装/供应商改善缺少 CAPA、验证窗口和复发历史，关闭任务可能被误当问题已解决 | CONFIRMED | ERP-06、13、17、18、21 | CorrectiveAction、verification due/effective/ineffective、版本化改进和历史不改写证明 |
| BUG-RET-016 | P1 | 退货/财务若新增 Scheduler、页面轮询或 Webhook 自动全店回读，会绕过手动刷新 owner、放大 QPS 与数据竞态 | OPEN_REVERIFY | ERP-08、10、17、18、21 | 启动/网络 E2E 证明无 30 秒/进页/切店/聚焦/Scheduler；Webhook 只落 Inbox/标 dirty |
| BUG-FIN-001 | P0 | V2 没有规范结算、成本、汇率、利润、应收应付、发票、资金和月结领域服务或工作台 | CONFIRMED | ERP-00、05、17 | FIN-01 资产/运行图、规范对象、零隐藏资金写 owner 和 unsupported 清单 |
| BUG-FIN-002 | P0 | 财务只有 report-list/adjustment 原文和 sales 摘要，其他对账/发票接口只有目录线索，字段、分页、错误和身份不完整 | CONFIRMED | ERP-05、07、17、21 | 当前官方合同、7 天/200 页限制、真实脱敏 fixture 和缺口 fail closed |
| BUG-FIN-003 | P0 | 现有 `costPrice` 表示 SHEIN 供货价，却可能被页面/报表误当工厂成本，直接生成虚假毛利 | CONFIRMED | ERP-04、06、13、17、21 | `shein_supply_price` 语义迁移，供货价/报价/采购成本/结算收入 API/表/UI 对等测试 |
| BUG-FIN-004 | P0 | 同单同 SKU 可跨多报告和费用明细，缺少不可变 SettlementEntry 会被覆盖 upsert、重复净额或漏账 | CONFIRMED | ERP-06、10、17、21 | 官方行身份、多报告/跨期 fixture、冲销/补款追加和总额/明细对账通过 |
| BUG-FIN-005 | P0 | 工厂、包材、物流、仓储、AI、售后等成本没有统一 CostLedger、来源、actual/estimate、币种和生效版本 | CONFIRMED | ERP-06、17、21 | CostLedger/Import provenance、SKU/批次/effective period 和 unknown-safe 持久化 |
| BUG-FIN-006 | P1 | 共用成本缺少版本化分摊 driver、输入快照和舍入记录，平均分摊会扭曲大尺寸地毯利润 | CONFIRMED | ERP-04、06、17、21 | AllocationRule/Run、数量/面积/重量/体积分摊 fixture 和未分摊边界通过 |
| BUG-FIN-007 | P0 | 原币种、汇率来源/时点/用途和汇兑差异没有正式模型，跨币种总额可能静默使用过期或任意汇率 | CONFIRMED | ERP-04、06、17、21 | FXRateSnapshot/Policy/Conversion、缺失/过期 fail closed 和原币种不变测试 |
| BUG-FIN-008 | P0 | 缺少版本化 ProfitDefinition/Snapshot 和 coverage/quality，partial 收入或缺成本仍可能输出确定利润/ROI | CONFIRMED | ERP-04、06、11、17、21 | 利润层级、input revision、complete/partial/estimated/stale/conflict/unknown 行为矩阵 |
| BUG-FIN-009 | P0 | SHEIN 已结算、应收、银行到账和核销未分离，页面可能把平台状态直接显示为已收款 | CONFIRMED | ERP-04、06、13、17、21 | Settlement/Receivable/Cash/Allocation 正交状态和部分/短长款 E2E |
| BUG-FIN-010 | P1 | 供应商报价、采购/收货、账单、发票、应付和实际付款没有独立链，容易按报价或计划错误付款 | CONFIRMED | ERP-06、13、17、21 | Payable policy、来源单据、争议/调整、审批和首期零自动付款证明 |
| BUG-FIN-011 | P0 | 只有 `invoice_status_notice` 事件名而无核准合同，缺少 InvoiceDocument/Line、主体、税额、附件和红冲边界 | CONFIRMED | ERP-05、06、07、15、17、21 | unsupported 明示、正式事件/导入合同、敏感票据和不自动确认收入/现金测试 |
| BUG-FIN-012 | P0 | 没有 CashAccount/Transaction、opening balance、流水覆盖和导入幂等，现金余额与回款无法可信计算 | CONFIRMED | ERP-06、13、17、21 | 核准导入、流水 identity、原币种、coverage、重复/冲突和核销 E2E |
| BUG-FIN-013 | P1 | 缺少期间 Close/Reopen、晚到明细和历史计算版本，月报可能随同步静默改变且无法复现 | CONFIRMED | ERP-04、06、13、17、21 | close checklist、冻结 revision、调整期/受控重开和历史 Snapshot 重放 |
| BUG-FIN-014 | P0 | 金额若用 JS 浮点或浏览器当前页求和，会产生分钱误差、分页少算和前后端不一致 | CONFIRMED | ERP-03、04、11、17、19、21 | decimal/最小货币单位、币种舍入、极值/负数/分页/导出一致性测试 |
| BUG-FIN-015 | P0 | 工厂成本、利润、银行账户、发票和供应商资料缺少字段级 capability、审批和访问审计 | CONFIRMED | ERP-03、06、17、19、21 | 权限矩阵、脱敏/私有对象、短时票据、跨店负向测试和高风险双人审批 |
| BUG-FIN-016 | P1 | 财务若引入 Scheduler/进页同步，或 UI 上线时误开放付款/开票/调账入口，会形成请求风暴和不可逆资金风险 | OPEN_REVERIFY | ERP-08、10、17、18、19、21、22 | 无自动刷新网络证明、启动自检、零可达资金写、action capability 和金丝雀门 |
| BUG-PRICE-001 | P0 | 审核中心直接同步调用 SHEIN 接受/拒绝核价，缺少 PriceCommand、Outbox、发送边界、未知结果和官方生效回读 | CONFIRMED | ERP-06、08、10、13、17、19、21 | 浏览器零直调、持久命令故障注入、send_started/result_unknown、动作级回读与旧路径零引用 |
| BUG-PRICE-002 | P0 | 商品审核阶段与平台议价状态混在审核中心，价格动作可能改写或误导商品待核价/驳回分类 | CONFIRMED | ERP-04、06、10、11、13、17、21 | 五套正交状态、同一 Receipt 重放、API/DB/UI 对等和价格 reducer 零商品状态写入 |
| BUG-PRICE-003 | P0 | `costPrice`、平台建议成本价、工厂成本、建议零售价和结算收入语义易混淆，可能错误判断利润或调价 | CONFIRMED | ERP-04、06、17、20、21 | PriceType 强类型迁移、字段/UI/导出语义测试和 Profit 输入白名单 |
| BUG-PRICE-004 | P0 | 接受平台核价前没有成本覆盖、汇率、利润底线和地毯尺寸 SKU 风险门，可能接受实际亏损价格 | CONFIRMED | ERP-06、13、17、21 | ProfitSnapshot 资格、PriceFloorPolicy、大尺寸单位经济 fixture 和低于底线默认阻断 |
| BUG-PRICE-005 | P0 | 拒绝议价会导致商品不能上架且不能再次报价，但现有动作缺少不可逆影响预览、强确认和独立权限 | CONFIRMED | ERP-03、07、13、17、19、21 | action-specific capability、逐 SKU 影响、强确认/step-up、重复/越权零副作用 |
| BUG-PRICE-006 | P0 | 当前 V2 未完整实现重新报价合同，可能错误复用接受/拒绝 payload、旧轮次或失败试错 | CONFIRMED | ERP-07、17、21 | 当前 discussSn/step/lastCost/currency、完整 SKU/原因/材料 fixture 和动作 payload 互斥测试 |
| BUG-PRICE-007 | P0 | RRP 提交为全量替换，若页面只发送修改项会静默清空未展示/未修改的现有建议零售价 | CONFIRMED | ERP-06、07、10、17、21 | read-merge-freeze-current-set、遗漏/并发修改/部分失败 fixture 和全量前后差异预览 |
| BUG-PRICE-008 | P1 | RRP 审核/过期可能按 SKU/site 部分发生，商品级单状态会把部分失败、部分过期或生效混为一类 | CONFIRMED | ERP-04、06、10、11、17、21 | SKU/site 状态矩阵、计数/列表/详情同快照和部分修正 E2E |
| BUG-PRICE-009 | P0 | 价格证明上传成功可能被页面误称调价/议价/RRP 已提交，材料 objectKey 与业务用途、轮次和 revision 缺少完整绑定 | CONFIRMED | ERP-06、15、17、21 | ProofBundle 适用性、上传/提交状态分离、对象回执和跨用途/跨店负向测试 |
| BUG-PRICE-010 | P0 | 调价原因自 2026-07-01 起动态必填且按商家变化，硬编码或 stale reason 会导致真实提交失败 | CONFIRMED | ERP-06、07、17、21 | 店铺/合同版本 Option Snapshot、过期阻断、当前 code 重验和错误 fixture |
| BUG-PRICE-011 | P0 | 金额范围与币种精度依赖官方规则，固定两位小数或 JS 浮点会造成拒绝、舍入差和错误利润 | CONFIRMED | ERP-03、04、06、07、17、19、21 | decimal/最小单位、currency precision version、多币种边界和前后端一致测试 |
| BUG-PRICE-012 | P0 | HTTP 200、平台 accepted 或本地状态可能被显示为价格已生效，形成价格伪成功 | CONFIRMED | ERP-04、10、11、13、17、21 | submitted/effective 分离、官方值/币种/SKU/site/round 匹配和超时/冲突 Case |
| BUG-PRICE-013 | P0 | 价格批量选择可能保留隐藏行、跨 tab/筛选/刷新 revision 或跨店目标，页面可见 4 个却提交更多对象 | OPEN_REVERIFY | ERP-03、11、13、17、21 | selection scope、可见 eligible 集合、影响预览、服务端重验和浏览器 E2E |
| BUG-PRICE-014 | P0 | 利润数据 partial/unknown/stale 时若按 0 成本或旧成本判断，会把不确定价格当安全并错误放行 | CONFIRMED | ERP-06、17、21 | Profit quality gate、LKG/unknown、输入 revision stale 和数据不足行为矩阵 |
| BUG-PRICE-015 | P1 | 消费者售价/活动报名合同不完整，若复用通用改价入口会产生伪活动、伪售价或真实错误写入 | CONFIRMED | ERP-05、07、17、21、22 | capability gap 明示、首期零可达写、人工来源标签和合同恢复独立金丝雀 |
| BUG-PRICE-016 | P1 | 价格刷新若引入 Scheduler/进页/30 秒同步或批量重算，会耗尽 QPS/2 核 4GB 并造成规则与利润竞态 | OPEN_REVERIFY | ERP-08、10、17、18、19、21 | 单一手动 PriceRefreshOperation、无自动网络证明、公平队列和资源预算 |
| BUG-GROW-001 | P0 | 当前只有最新经营 JSONB 和即时 warning 数组，没有持久商品生命周期、实验、活动、决定或复盘领域 | CONFIRMED | ERP-04、05、06、17、20、21 | Portfolio/StageHistory/Experiment/Decision/PostMortem 规范对象、迁移回放和旧标签对照 |
| BUG-GROW-002 | P0 | 当前新品起量、滞销和下降使用固定阈值，未考虑 coverage、利润、质量、合规、断货、版本或站点，容易误分类 | CONFIRMED | ERP-04、06、10、17、21 | 版本化 Segment/Lifecycle Policy、多维 fixture、unknown-safe 和人工决定门 |
| BUG-GROW-003 | P0 | SHEIN 不开放曝光/访客/点击/加购/支付/转化 API，若页面或 AI 补数会产生伪流量和伪增长结论 | CONFIRMED | ERP-03、04、06、07、11、17、21 | unsupported schema、零推造测试、UI/导出/AI 输入负向断言和人工来源标识 |
| BUG-GROW-004 | P0 | today/7/30 日销量窗口可能被当成连续日序列或用于证明换图、标题、价格带来的因果提升 | CONFIRMED | ERP-04、06、10、17、21 | 窗口事实与日事实分离、confounder、observational 标签和因果禁用测试 |
| BUG-GROW-005 | P0 | 0 销量可能来自无流量、缺货、未上架、站点不可售、审核/合规阻断或数据失败，却可能被直接判为滞销/淘汰 | CONFIRMED | ERP-04、06、10、17、21 | 可售/覆盖/阻断诊断树、confirmed_zero/unknown 和零自动动作行为矩阵 |
| BUG-GROW-006 | P0 | 商品生命周期若按全局 SKC/图案保存，会把 A 店/站点结果覆盖 B 店/站点，造成错误放量或退出 | CONFIRMED | ERP-03、04、06、17、21 | store/SKC/site/version identity、跨店负向测试和商品族只读聚合 |
| BUG-GROW-007 | P0 | 测款期间标题、主图、价格、库存或商品版本改变后仍混在同一窗口，结果不可解释且无法复现 | CONFIRMED | ERP-04、06、14、15、17、21 | 冻结 Experiment input revision、变更分段/终止、旧实验重放和 stale 门 |
| BUG-GROW-008 | P0 | 官方明确不支持 API 创建促销活动，若系统显示已报名/已通过或提供自动活动入口会形成伪成功 | CONFIRMED | ERP-05、07、11、13、17、21、22 | unsupported 明示、人工提交证据与官方 Fact 分离、首期零活动写可达路径 |
| BUG-GROW-009 | P0 | 活动候选未校验价格底线、库存/在途、履约、合规、质量和供应，可能促销亏损或活动中断货/违规 | CONFIRMED | ERP-06、13、16、17、21 | CampaignEligibility、跨域 revision、blocker/例外矩阵和逐 SKU 尺寸影响预览 |
| BUG-GROW-010 | P0 | 放量只看 SKC 总销量，可能由小尺寸拉动却让亏损、体积重高或售后风险大的大尺寸同步扩量 | CONFIRMED | ERP-04、06、16、17、21 | 尺寸 SKU 销量/利润/库存/质量门、包装物流 fixture 和逐项 Decision |
| BUG-GROW-011 | P1 | 当前无冻结假设、成功/失败/停止标准、有效天数和数据质量，运营可事后修改标准形成选择性结论 | CONFIRMED | ERP-06、17、21 | 不可变 Experiment revision、预注册标准、Evaluation 和审计 |
| BUG-GROW-012 | P1 | 经营预警只是每次快照重算的数组，没有负责人、SLA、处理、复发和结果证据，问题反复出现 | CONFIRMED | ERP-06、13、17、18、21 | GrowthAlertCase、owner/SLA/事件时间线、去重/复发和行动结果引用 |
| BUG-GROW-013 | P0 | AI 或单一综合分可能自动把商品标爆款/淘汰，并绕过未知数据、利润、质量和人工审批 | CONFIRMED | ERP-03、06、08、17、19、21 | 可解释维度、输入 fingerprint、人工 Decision、零自动迁移/执行和 provider failure 降级 |
| BUG-GROW-014 | P1 | 跨店分析可能混用不同 cutoff、经营模式、商品版本和站点，复制阶段/实验结果并造成数据串店 | CONFIRMED | ERP-03、06、11、17、19、21 | 可比性门、storeSet scope、无全局 current stage 和 A→B→A E2E |
| BUG-GROW-015 | P0 | 增长列表批量操作可能保留隐藏选择或旧 policy/snapshot，把少量可见商品迁移/安排更多任务 | OPEN_REVERIFY | ERP-03、11、13、17、21 | selection scope、当前可见 eligible、影响预览、服务端 revision 重验和浏览器 E2E |
| BUG-GROW-016 | P1 | 增长重算若引入 Scheduler、进页/30 秒同步或全量 AI，可能耗尽 SHEIN QPS、DB/内存和 2 核 4GB | OPEN_REVERIFY | ERP-08、10、17、18、19、21 | 复用手动 RefreshOperation、增量有界计算、无自动网络证明和资源预算 |
| BUG-WORK-001 | P0 | 当前“任务中心”实际只有同步 Job，人工任务、系统执行和业务结果混名，运营无法判断自己要处理什么 | CONFIRMED | ERP-04、13、17、21 | 系统任务独立命名/状态，个人工作台只展示 WorkItem/Approval，跨对象跳转契约测试 |
| BUG-WORK-002 | P1 | 当前 TodayWork 只是发布/价格/驳回/寄样活动聚合，没有 assignee、dueAt、状态、SLA、证据和关闭闭环 | CONFIRMED | ERP-05、06、13、17、21 | WorkItem 规范对象、现有活动流降级、个人队列与历史迁移对账 |
| BUG-WORK-003 | P0 | 各领域零散 owner/reviewer/approval 可能自建状态、重复任务或相互覆盖，缺少唯一协同 owner 与来源追踪 | CONFIRMED | ERP-04、05、06、17、20 | WorkType Registry、WorkSignal、dedupKey、subjectRevision 和单领域 owner 清单 |
| BUG-WORK-004 | P0 | 人工任务完成可能被页面当成发布/价格/审核/履约/财务或 SHEIN 成功，继续制造伪完成 | OPEN_REVERIFY | ERP-03、06、09、10、11、17、21 | WorkItem/Command/Receipt/Readback 正交、结构化完成证据和负向 E2E |
| BUG-WORK-005 | P0 | 局部审批未冻结 subjectRevision、影响范围和风险快照，内容变更后旧批准仍可能执行 | CONFIRMED | ERP-03、06、08、09、17、21 | 不可变 ApprovalRequest、input hash、revision invalidation 和旧批准消费失败测试 |
| BUG-WORK-006 | P0 | 申请人、管理员、代理或同一主体多角色可能完成自审或凑齐双人审批，绕过职责分离 | OPEN_REVERIFY | ERP-03、06、17、19、21 | 服务端审批资格重验、不同主体计数、delegation 约束和 break-glass 审计 |
| BUG-WORK-007 | P0 | 审批通过若直接改业务状态或发送 SHEIN，可能绕过领域预检、命令幂等、send boundary 和回读 | OPEN_REVERIFY | ERP-06、08、09、17、21 | 一次性 ApprovalGrant、领域原子消费、capability/revision/eligibility 重验和 Command 关联 |
| BUG-WORK-008 | P1 | 通知发送失败、已读或重复可能被耦合为任务/审批结果，造成业务回滚、伪完成或消息轰炸 | CONFIRMED | ERP-06、08、17、18、19 | Event/Outbox/Delivery 分层、去重/摘要、独立失败和已读不改业务状态测试 |
| BUG-WORK-009 | P1 | 没有转交、代理、成员停用排空和 orphan queue，高风险任务可能长期无人负责或归属已离职成员 | CONFIRMED | ERP-06、17、18、21 | AssignmentHistory、DelegationGrant、offboarding blocker、孤儿告警和重分配 E2E |
| BUG-WORK-010 | P1 | 缺少响应/解决 SLA、工作日历、时区、节假日和暂停口径，寄样/申诉/发货/月结截止可能误算 | CONFIRMED | ERP-04、06、17、19、21 | 版本化 BusinessCalendar/SlaClock、官方截止保护、DST/跨午夜/节假日 fixture |
| BUG-WORK-011 | P1 | 评论、@成员和附件无统一权限/历史/证据契约，可能以自由文本冒充批准或泄露跨店敏感资料 | OPEN_REVERIFY | ERP-03、06、15、17、19、21 | CommentRevision、授权 mention、私有附件/短时票据和评论不改状态负向测试 |
| BUG-WORK-012 | P1 | 通知缺少接收者权限重验、偏好、去重、摘要和最小正文，可能跨店泄露或让批量事件淹没有效告警 | OPEN_REVERIFY | ERP-03、06、17、19、21 | recipient authorization、groupKey、强制类别、免打扰和敏感正文裁剪测试 |
| BUG-WORK-013 | P1 | 工作/日历跨店聚合可能使用当前切店器、动态店铺组或失效 URL，造成任务串店、目标静默扩张或不可见 | OPEN_REVERIFY | ERP-03、06、11、13、17、21 | 显式 store/storeSet revision、父子项、进入详情重验和 A→B→A E2E |
| BUG-WORK-014 | P0 | 个人/团队列表批量操作可能保留隐藏选择或 stale lockVersion，显示少量任务却分派/关闭更多目标 | OPEN_REVERIFY | ERP-03、11、13、17、21 | WorkSnapshot/selection scope、当前可见 eligible、影响预览和逐项 CAS |
| BUG-WORK-015 | P0 | 周期任务、SLA 到期或日历提醒若触发同步/写入，可能恢复 30 秒自动请求并造成重复 SHEIN 动作 | OPEN_REVERIFY | ERP-03、08、09、17、19、21 | 内部提醒 only、零外部调用测试、action adapter 隔离和生产网络审计 |
| BUG-WORK-016 | P1 | 每任务独立定时器、全表 SLA 扫描、通知 fan-out 和大历史列表可能耗尽 2 核 4GB 与数据库 | OPEN_REVERIFY | ERP-08、17、18、19、21 | DB claim/lease、有界批次、聚合投递、服务端分页、资源预算和重启恢复 |
| BUG-BI-001 | P0 | 同一销量、库存、待处理、利润或任务指标可能由多个页面/SQL/JSONB 各自计算，产生口径漂移 | CONFIRMED | ERP-04、05、06、13、17、20、21 | 指标资产清单、唯一 MetricDefinition owner、影子对账和零页面临时公式 |
| BUG-BI-002 | P0 | SHEIN 未开放曝光/点击/转化/全托管订单时，页面或 Excel 可能补 0、推算或冒充官方指标 | OPEN_REVERIFY | ERP-03、07、13、17、19、21 | unsupported/unknown 契约、负向 fixture、全页面/导出扫描和零伪指标 E2E |
| BUG-BI-003 | P0 | today/yesterday/7/30 日聚合窗口可能被拆成伪日趋势或用于无对照因果结论 | CONFIRMED | ERP-04、06、17、21 | 窗口事实时间语义、真实 daily 独立数据集和趋势/实验负向测试 |
| BUG-BI-004 | P0 | 卡片、图表、列表和下钻各自读取不同最新数据，导致同屏计数、总计和明细不一致 | OPEN_REVERIFY | ERP-06、11、13、17、21 | DashboardSnapshot、共享 snapshotId/cutoff/filter 和下钻总计对账 |
| BUG-BI-005 | P0 | unknown/partial/stale/conflict 被补零或当完整，造成库存、利润、增长和店铺排名错误 | OPEN_REVERIFY | ERP-03、04、06、11、17、21 | MetricObservation quality、coverage 门、confirmed_zero 证据和排名排除测试 |
| BUG-BI-006 | P1 | 指标缺 grain/unit/formula/window/version，SKU、SKC、店铺、时点和期间数据可能错误 join/聚合 | CONFIRMED | ERP-04、06、17、20 | Metric/Dimension Registry、兼容矩阵、单位/时间 fixture 和口径变更 ADR |
| BUG-BI-007 | P1 | 跨店排名可能混用经营模式、币种、FX、指标版本、时间窗和不同 cutoff，输出不可比结论 | OPEN_REVERIFY | ERP-03、06、11、17、21 | comparability gate、storeSet revision、coverage/cutoff skew 和不可比状态 |
| BUG-BI-008 | P0 | 财务/利润页面可能临时以供货价、缺失成本或过期汇率计算伪精确利润并影响价格/备货 | OPEN_REVERIFY | ERP-04、06、13、17、21 | 只消费 ProfitSnapshot、FX/关账/coverage 资格和缺口负向测试 |
| BUG-BI-009 | P1 | 历史组织、类目、商品族、店铺别名变化可能静默重述旧报表，导致已发送月报无法复现 | OPEN_REVERIFY | ERP-04、06、17、20 | effective-dated dimension、当时/当前归属显式模式和不可变 Snapshot |
| BUG-BI-010 | P1 | 人工/Excel 数据缺 provenance、hash、期间和 supersedes，可能覆盖官方事实或重复计算 | CONFIRMED | ERP-05、06、17、19、20 | ImportBatch、来源分层、schema/hash/重复校验和 raw 保留 |
| BUG-BI-011 | P0 | 大明细由浏览器全量下载、当前页求和或服务端无界 join，可能拖垮 2 核 4GB 并输出错误总计 | OPEN_REVERIFY | ERP-03、08、11、13、17、19、21 | 服务端分页/总计、statement timeout、有界 Worker、行字节预算和负载测试 |
| BUG-BI-012 | P1 | 导出由前端拼 CSV 或长期公网 URL 提供，可能精度/时区错误、公式注入和敏感数据泄露 | OPEN_REVERIFY | ERP-03、08、15、17、19、21 | ExportJob、私有 Artifact、短时票据、CSV 防注入、hash/审计和权限重验 |
| BUG-BI-013 | P1 | 报表订阅可能在定时发送前自动刷新 SHEIN，恢复自动同步并放大 QPS/竞态 | OPEN_REVERIFY | ERP-03、08、10、17、19、21 | 只发送已有 Snapshot、零外部网络证明、stale 警告和手动 RefreshOperation owner |
| BUG-BI-014 | P0 | 自定义报表若开放原始 SQL/脚本/任意 join，可能跨租户读取、资源攻击或绕过字段权限 | OPEN_REVERIFY | ERP-03、06、17、19、21 | 白名单语义编译、cost guard、dataset/field capability 和跨租户负向测试 |
| BUG-BI-015 | P1 | 报表卡片直接批量改价/库存/上下架或发布，可能绕过 WorkItem、审批和领域 Command | OPEN_REVERIFY | ERP-03、06、08、09、17、21 | 报表只创建引用 Snapshot 的 WorkItem/Plan，零外部 write route 测试 |
| BUG-BI-016 | P1 | 快照、重算、导出、订阅和慢查询缺 trace/预算/保留策略，故障后无法复现或恢复 | OPEN_REVERIFY | ERP-08、17、18、19、20、21 | 端到端 trace、资源/SLO、retention、重启/late data/回滚演练 |
| BUG-DATA-001 | P1 | 历史 stale job、run、draft、projection 相互矛盾 | OPEN_REVERIFY | ERP-05、20 | 只读盘点、证据分组、受控修复计划与前后对账 |
| BUG-OBS-001 | P1 | trace、命令、批次、Worker、SHEIN 请求难以串联 | OPEN_REVERIFY | ERP-08、09、10、18 | commandId 到官方回读的完整 trace，运营可自助诊断 |
| BUG-QA-001 | P0 | 缺少可靠浏览器 E2E/视觉回归，源码字符串测试替代行为测试 | OPEN_REVERIFY | ERP-03、13、21 | 核心流程 E2E、截图基线、失败注入和 release gate |
| BUG-SCM-001 | P0 | 当前 Git 基线与远端不可信，无法可靠识别改动和回滚 | OPEN_REVERIFY | ERP-00、01 | 完整清单、首个受控基线、私有远端、可恢复 tag |
| BUG-PERF-001 | P2 | 巨型页面/服务和大 bundle 增加回归与性能风险 | OPEN_REVERIFY | ERP-14、18、19、23 | 性能预算、热点测量、按责任边界拆分且行为不变 |
| BUG-UX-001 | P0 | 修复业务流程时意外整体改变前端、导航或品牌界面 | OPEN_REVERIFY | ERP-02、03、13、21 | 视觉基线、路由清单、变更前审批、非目标页面截图无变化 |
| BUG-STORE-001 | P0 | SHEIN 授权完成分阶段落库，失败可能留下半完成店铺、凭证或访问关系 | CONFIRMED | ERP-03、06、07、21 | 数据库失败注入证明本地授权提交原子回滚，不产生 active 空店铺、孤儿凭证或假完成 attempt |
| BUG-STORE-002 | P0 | 新增授权与重授权共用泛化流程，未可靠绑定目标店铺和预期平台身份 | CONFIRMED | ERP-06、07、17、21 | 重授权必须携带 targetStoreId，身份错配阻断，成功后稳定 storeId 和全部历史引用不变 |
| BUG-STORE-003 | P0 | 撤销/断开清理供应商身份或成员店铺关系，导致保留的历史在产品界面不可访问 | CONFIRMED | ERP-06、17、20、21 | disconnected/revoked 店铺按原访问关系可读本地历史，远端动作全部 fail closed |
| BUG-STORE-004 | P0 | 单一店铺状态同时承担生命周期、连接、可运营性、新鲜度和 UI 可见性 | CONFIRMED | ERP-04、06、17 | 四维状态字典、合法组合、迁移映射和 API/UI 一致性测试通过 |
| BUG-STORE-005 | P0 | 切店存在全局持久化键、静默回落及旧请求/选择跨店风险 | CONFIRMED | ERP-03、17、21 | tenant/user/workspace 隔离，无静默回落；A→B→A、旧响应晚到、多标签页和失效 URL E2E 通过 |
| BUG-STORE-006 | P1 | 店铺仅平铺展示，缺少店铺组、标签、负责人、收藏、最近使用和状态分区 | CONFIRMED | ERP-17、21 | 主店铺组+多标签、负责人和访问继承落地，切店器/管理台行为与权限矩阵一致 |
| BUG-STORE-007 | P1 | 授权回调可能把原始错误放入 URL，健康错误无法区分凭证、IP、网络、限流和业务能力 | CONFIRMED | ERP-07、18、19 | 浏览器只接收 attemptId/稳定结果码；错误分类 fixture、脱敏日志和恢复建议通过 |
| BUG-STORE-008 | P0 | 存在仅按 supplierId 标记重授权、未同时限定 tenant/store 的潜在旁路 | CONFIRMED | ERP-03、06、21 | 删除或封死未限定作用域的方法，负向测试证明跨租户 supplier 碰撞无副作用 |
| BUG-STORE-009 | P1 | 断开/撤销前只检查部分发布任务，未统一排空全部在途任务 | CONFIRMED | ERP-06、17、21 | 发布、上传、同步、回读、AI/媒体和迁移任务均纳入动作前检查，重复命令幂等 |
| BUG-STORE-010 | P1 | 店铺管理 UI 混用新增、重授权和撤销入口，缺少连接时间线、健康状态与身份错配恢复 | CONFIRMED | ERP-17、18、21 | 独立动作/文案/权限/影响预览，店铺详情六页签和身份错配恢复 E2E 通过 |
| BUG-PROD-001 | P0 | 缺少稳定 CatalogProduct/CatalogSku，draftId、supplier code 和 SHEIN 身份被混作商品身份 | CONFIRMED | ERP-04、05、06、21 | 内部 ID 稳定，Draft/Version/Attempt/PlatformLink 分离，重发和 SHEIN version 变化不改内部身份 |
| BUG-PROD-002 | P0 | Publish Job 直接引用 mutable Draft，已驳回重发可复用 published/archived 草稿 | CONFIRMED | ERP-06、09、12、21 | Job 必须引用 immutable ProductVersion；重发创建新 revision/version/attempt 并保留父关系 |
| BUG-PROD-003 | P0 | 草稿状态混合编辑、published 和 archived，默认草稿箱依赖是否存在任意 Job 排除记录 | CONFIRMED | ERP-04、06、12、20、21 | Draft 仅有编辑状态；handoff 明确持久化，草稿/发布/审核页面归属刷新后对账 |
| BUG-PROD-004 | P0 | handoff 没有独立不可变 ProductVersion，历史提交只能依赖 mutable JSON、fingerprint 和摘要还原 | CONFIRMED | ERP-06、09、12、15、21 | 每次 handoff 冻结内容、SKU、schema、规则、模板、媒体和 fingerprint，普通路径不可更新 |
| BUG-PROD-005 | P1 | 草稿保存缺少数据库 lockVersion/ETag，并发编辑可能后写覆盖先写 | CONFIRMED | ERP-06、14、21 | 旧版本更新返回 409 和安全 diff，不产生静默覆盖；多标签页/多用户 E2E 通过 |
| BUG-PROD-006 | P1 | 草稿页面加载会自动重校验并保存 blocked 草稿，只读打开页面产生隐藏业务写入 | CONFIRMED | ERP-12、14、21 | 页面 load 零草稿写入/零 SHEIN 请求；仅显式预检或 handoff 前强制预检可写结果 |
| BUG-PROD-007 | P0 | 审核中心通过 version/document/SKC/job/更新时间启发式推断当前尝试 | CONFIRMED | ERP-06、10、11、21 | 显式 currentAttempt 与 parent/supersedes 关系驱动 reducer，旧尝试只在 timeline |
| BUG-PROD-008 | P0 | 本地草稿/商品与 SHEIN document/version/SPU/SKC/SKU 缺少稳定可审计映射 | CONFIRMED | ERP-05、06、10、20、21 | store-scoped PlatformProductLink 有证据来源；冲突 fail closed，unmatched 不自动合并 |
| BUG-PROD-009 | P0 | 发布完成释放 Draft 媒体引用前，无法证明历史提交有独立不可变版本素材所有权 | OPEN_REVERIFY | ERP-05、06、15、20、21 | VersionMedia 独立引用先建立；Draft 释放后历史版本仍可还原 asset hash、用途和顺序 |
| BUG-PROD-010 | P1 | 草稿列表硬限制 100 条且“删除”实际为归档，总数、分页和恢复语义不完整 | CONFIRMED | ERP-12、13、19、21 | 服务端稳定分页/总数，归档/回收站明确，永久删除不在普通列表提供 |
| BUG-PROD-011 | P1 | 草稿动态 JSON 缺少顶层 schemaVersion、revisionNo 和 baseVersionId，兼容与差异无法稳定解释 | CONFIRMED | ERP-06、12、14、20 | 版本化 JSONB、legacy adapter、revision/baseVersion 和字段/SKU/媒体 diff 测试通过 |
| BUG-BUILD-001 | P0 | 单品、批量和草稿批处理存在多个商品 payload 组装 owner，字段/快照/模板语义可能漂移 | CONFIRMED | ERP-03、06、12、14、21 | 同一 ProductFormModel/serializer/template engine；同输入三入口 payload 对等测试通过 |
| BUG-BUILD-002 | P1 | NewProductPage 约 3464 行并混合约 86 次 hook 调用，加载、领域计算、模板、媒体、AI、保存和预检耦合 | CONFIRMED | ERP-14、18、19 | 黄金回归后按垂直领域切片迁移，section 无第二份 truth，性能不退化 |
| BUG-BUILD-003 | P1 | BatchProductCreatePage 约 1090 行并独立组装批量商品，形成第二套编辑领域 | CONFIRMED | ERP-14、19、21 | 批量页仅作协调器，每项使用统一 FormModel/section/command，逐项隔离和有界并发 |
| BUG-BUILD-004 | P0 | 模板版本、适用 schema、应用优先级、覆盖模式、字段来源和 diff 未由单一引擎统一 | CONFIRMED | ERP-06、14、15、21 | TemplateApplicationEngine 统一 fill-empty/显式覆盖/区段替换、provenance、diff 和撤销 |
| BUG-BUILD-005 | P0 | 浏览器即时校验、服务端重算和 SHEIN schema 快照的权威边界可能漂移 | OPEN_REVERIFY | ERP-07、14、21 | 稳定 code/path/schemaVersion 契约，服务端 preflight 最终权威，差异 fixture 为零或已解释 |
| BUG-BUILD-006 | P1 | legacy/V2 单品编辑、文件导入和重复组装路径的生产构建/运行时归属尚不可信 | CONFIRMED | ERP-01、02、03、23 | 构建/运行时引用图、唯一生产入口和写 owner；旧路径零引用后才归档 |
| BUG-BUILD-007 | P1 | 批量保存的进度、部分成功、结果未知、安全重试和逐项幂等边界未形成统一行为契约 | OPEN_REVERIFY | ERP-14、18、19、21 | 15/50/100 商品故障注入，逐项结果、有界并发、未知不盲重试、成功项不被清空 |
| BUG-BUILD-008 | P1 | 文件夹导入对文件名、重复/隐藏文件、Unicode、主图/SKU 图映射的完整歧义策略需复核 | OPEN_REVERIFY | ERP-14、15、21 | 确定性 import contract、导入前预览、歧义逐项阻断、文件夹名不作商品身份 |
| BUG-BUILD-009 | P1 | SKU 批量填充、排序、图片关联和计算字段缺少统一稳定行 ID、patch/diff/undo/source 语义 | OPEN_REVERIFY | ERP-14、21 | stable localRowId、批量 patch 预览/撤销、unknown≠0、错误定位具体 SKU 字段 |
| BUG-BUILD-010 | P1 | AI、图片预览或可选合规失败可能与编辑器保存/预检主链耦合 | OPEN_REVERIFY | ERP-14、15、16、21 | 故障注入证明人工标题、普通编辑和安全保存继续，只有真实必填形成 blocker |
| BUG-BUILD-011 | P1 | legacy 草稿 hydration/serialization 和 schema 升级可能静默遗漏未知字段或反向改写旧数据 | OPEN_REVERIFY | ERP-06、14、20、21 | version adapter、未知字段保留告警、读取零写入、升级前后字段/SKU/媒体守恒 |
| BUG-BUILD-012 | P2 | 商品编辑与批量页面在商业规模下可能出现高重渲染、内存、请求风暴和可访问性缺口 | CONFIRMED | ERP-14、19、21 | 目标规模基准、增量计算、分页/虚拟化、有界缓存并发、键盘和错误关联验收 |

### 2.1 Issue 状态

- `OPEN_REVERIFY`：历史上出现过，必须以当前代码和环境重新取证。
- `CONFIRMED`：当前环境已复现并有失败证据。
- `IN_SCOPE`：已进入当前 Run，且范围已批准。
- `FIXED_PENDING_GATE`：代码已改，但完成门未通过。
- `RESOLVED`：完成门、回归和环境验收全部通过。
- `DEFERRED`：有书面理由、风险和后续步骤，不等于已解决。
- `NOT_REPRODUCIBLE`：需保留测试和观察证据，不能直接删除。

### 2.2 当前登记规模

- Issue：142 个唯一 ID。
- Risk：73 个唯一 ID。
- Decision：188 个唯一 ADR。
- 板块 08 新增范围：BUG-AI-003～016、RISK-050～057、ADR-129～148；AI-01～20 是模块交付编号，不与 Issue ID 混用。
- 板块 09 新增范围：BUG-CMP-002～015、RISK-058～065、ADR-149～168；COMPLY-01～20 是模块交付编号，不与 Issue ID 混用。
- 板块 10 新增范围：BUG-INV-002～015、RISK-066～073、ADR-169～188；BIZ-01～20 是模块交付编号，不与 Issue ID 混用。

## 3. 风险登记

| Risk ID | 风险 | 概率 | 影响 | 预防控制 | 触发后的动作 |
| --- | --- | --- | --- | --- | --- |
| RISK-001 | 线上制品不是本地验收版本 | 高 | P0 | manifest、SHA、releaseId、镜像 digest 四项核对 | 停止放量，回滚至已知 release |
| RISK-002 | Worker 未同步更新，继续按旧逻辑处理 | 高 | P0 | Control/Worker 同一不可变镜像和启动自检 | 停队列领取，保留任务，回滚两类进程 |
| RISK-003 | 超时后自动重发造成 SHEIN 重复商品 | 中 | P0 | 幂等键、`result_unknown`、先回读后人工重试 | 禁止重发，按 commandId 对账 |
| RISK-004 | 状态迁移把历史数据误改为成功或驳回 | 高 | P0 | append-only 事件、dry-run、备份、抽样核对 | 停迁移，从备份恢复并保留审计 |
| RISK-005 | 修审核中心时破坏其他稳定页面 | 高 | P0 | 页面视觉基线、允许文件清单、受影响路由矩阵 | 回滚该 Run，不继续叠加补丁 |
| RISK-006 | 跨店铺或跨用户数据泄露 | 中 | P0 | 服务端授权、tenant/store key、负向测试 | 立即停用相关入口，审计访问记录 |
| RISK-007 | 手动刷新产生并发同步风暴 | 中 | P1 | 单 owner、任务去重、速率限制、有界等待 | 返回已有任务，暂停新同步并观察队列 |
| RISK-008 | 删除“旧代码/旧数据”却仍被运行时引用 | 高 | P0 | 延迟到 ERP-23，先零引用证明再归档 | 从可恢复归档恢复，重新建立引用图 |
| RISK-009 | AI/媒体失败阻断普通发布 | 中 | P1 | 可选能力隔离、超时和降级、状态独立 | 关闭该可选能力，不影响手工标题/发布 |
| RISK-010 | SHEIN API 字段或错误语义变化 | 中 | P0 | 原始响应留存、契约 fixture、适配层隔离 | 将结果置为未知，更新契约后再恢复 |
| RISK-011 | 数据库、Redis、队列备份不可恢复 | 中 | P0 | 定期恢复演练和 RPO/RTO 记录 | 停止不可逆操作，执行灾备 runbook |
| RISK-012 | 计划被聊天中的临时编号绕过 | 高 | P1 | 只接受 ERP-XX，所有 Run 写入本台账 | 停止当前工作，重新绑定正式步骤 |
| RISK-013 | 重授权返回另一平台身份并覆盖原店铺或制造重复店铺 | 中 | P0 | targetStoreId、expectedIdentity、只读身份碰撞审计和 mismatch fail closed | 保留原连接，停止提交，进入人工“取消/作为新店接入”流程 |
| RISK-014 | 失效 URL 或切店竞态静默进入错误店铺并执行写操作 | 中 | P0 | 禁止静默回落、显式 store URL、服务端重验、旧请求隔离和写前目标确认 | 阻断写入，冻结相关入口，按 operationId 审计是否发生串店 |
| RISK-015 | 断开授权同时删除访问关系，使商业历史成为不可达数据 | 高 | P0 | Store 身份、连接和访问分离；断开只失效凭证，迁移前只读对账 | 恢复历史访问映射，保持远端写阻断，生成受影响店铺报告 |
| RISK-016 | 部署误开业务调度器或切店自动同步，引发 SHEIN 限流和任务风暴 | 中 | P1 | manifest 配置审计、调度器默认关闭、切店网络 E2E 和单任务去重 | 暂停新同步、保留当前任务、恢复手动刷新并核对队列 |
| RISK-017 | mutable Draft 在旧 Attempt 后继续变化，使重发内容和历史证据无法重现 | 高 | P0 | handoff 冻结 ProductVersion，Job 只读 Version，不从 Draft 现场构建 | 停止重发，按 fingerprint/receipt 对账，无法证明的记录标 legacy_unversioned |
| RISK-018 | 释放草稿素材引用时删除仍属于历史提交或合规证据的媒体 | 中 | P0 | VersionMedia/合规/模板独立引用、引用计数断言和清理 dry-run | 停止清理，从对象存储/备份恢复并生成受影响 Version 报告 |
| RISK-019 | 用名称、supplier code、SKC 或最新时间自动合并，造成不同商品/尝试串联 | 中 | P0 | 稳定内部 ID、PlatformProductLink 证据、冲突 fail closed | 隔离冲突映射，停止相关写入，人工核对后显式修复 |
| RISK-020 | 多成员或多标签页并发保存草稿导致无提示数据覆盖 | 高 | P1 | lockVersion/ETag、409、diff 和多会话行为测试 | 阻断覆盖，保留服务器版本并要求重新加载/显式合并 |
| RISK-021 | 页面加载触发 revalidation 写入，引起状态跳变、额度消耗或隐藏 API 访问 | 中 | P1 | 读写分离、网络断言、显式预检和 handoff owner | 关闭自动 revalidation，恢复持久草稿快照并审计写入范围 |
| RISK-022 | 抽取统一表单模型时改变已稳定字段、默认值或 payload，造成建品回归 | 高 | P0 | 黄金 fixture、单字段/全 payload diff、垂直切片和新旧影子只读比对 | 停止切换，保留旧写 owner，回滚该切片并定位首个差异 |
| RISK-023 | 单品与批量迁移进度不同，短期继续产生两套不一致草稿 | 高 | P0 | 每个切片同时覆盖单品/批量/草稿批处理，未对等不得启用写路径 | 关闭未对等入口，隔离受影响草稿并出 payload 差异报告 |
| RISK-024 | 模板重引或 schema 升级静默覆盖用户手工值、SKU 或包装数据 | 高 | P0 | fill-empty 默认、显式 diff/确认/撤销、字段 provenance 和 revision | 阻断保存/handoff，恢复上一 revision 并审计模板影响范围 |
| RISK-025 | 大批量建品导致浏览器冻结、DB/对象存储/预检请求风暴 | 中 | P1 | 容量基准、分页/虚拟化、有界并发、背压和任务去重 | 暂停新批次，保留逐项结果，降低并发并从未完成项恢复 |
| RISK-026 | AI、媒体或合规可选服务故障把整件/整批商品误判为不可保存 | 中 | P1 | 独立状态、超时/熔断、manual fallback 和 blocker 分类 fixture | 关闭故障能力，保留人工编辑与草稿，重新分类错误而不重建商品 |
| RISK-027 | 新内核完成后旧编辑/导入路由仍被制品或深层链接调用，形成第二写 owner | 中 | P0 | 唯一 V2 manifest、运行时路由/导入图、访问日志和 ERP-23 零引用门 | 阻断旧路由写入，回退唯一入口并审计期间生成的数据 |
| RISK-028 | Command 已提交数据库但未投递队列，用户以为已交接而系统永不执行 | 高 | P0 | 事务 Outbox、Dispatcher lease/heartbeat、最老事件告警和故障注入 | 停止新命令，恢复 Dispatcher，仅重投未 send_started 的同一 commandId |
| RISK-029 | SHEIN 已接收但 Worker 在回执落库前崩溃，盲重试制造重复商品 | 中 | P0 | send_started、result_unknown、完整 trace/receipt 和只读核对 | 冻结业务键新写，禁止自动重发，按官方证据人工收敛 |
| RISK-030 | 批次一个 blocker 错误阻断或写失败其他 eligible 商品 | 高 | P0 | eligible/blocked 逐项预览、显式确认、逐项事务与结果 | 停止该批次，保留已接受项，重新生成未尝试项计划而不自动发送 |
| RISK-031 | Worker/队列重试越过发送边界造成 SHEIN 重复提交 | 中 | P0 | publish attempts=1、确定性 commandId、发送边界和禁止通用 retry | 停止 Publish Worker 领取，隔离相关业务键并执行官方只读核对 |
| RISK-032 | 大店大批次占满 2 核 4GB 单机与平台 QPS，其他店长期饥饿 | 中 | P1 | 每店单在飞、跨店公平、全局有界并发、积压年龄 SLO | 降低全局并发、暂停大批次新领取并优先恢复已领取命令 |
| RISK-033 | SSE 订阅或事件缓存未按 tenant/user/store/operation 隔离，造成跨店状态泄露或错行更新 | 中 | P0 | 服务端授权、作用域 key、Last-Event-ID 校验和负向 E2E | 关闭 SSE 降级手动刷新，审计连接与事件访问，修复前不恢复 |
| RISK-034 | execution/reconciliation/review/compliance 共用 completed，UI 和运营作出错误商业判断 | 高 | P0 | 正交状态机、统一 reducer、契约 fixture 和禁止万能文案 | 停止相关自动动作，恢复原始事件重建投影，无法解释的标 unknown |
| RISK-035 | 迟到、重复或乱序官方事件使当前审核状态倒退或旧驳回重新占据当前页 | 高 | P0 | append-only receipt、source sequence/时间证据、单调 reducer、current pointer | 暂停自动投影，保留 raw event，shadow replay 后按 Attempt 重建 |
| RISK-036 | version/document/SPU/SKC 歧义把官方回执关联到错误店铺、商品或 Attempt | 中 | P0 | tenant/store 强作用域、exact match、PlatformProductLink、unmatched/conflict fail closed | 隔离错误映射，冻结相关批量动作，按 receiptId 人工核对 |
| RISK-037 | receipt 已保存但 projection/current pointer 未保存，或反之，页面与证据分裂 | 中 | P0 | 单事务写 receipt/match/projection/pointer、Outbox/重放和故障注入 | 阻止新 revision，按 append-only receipt 重建并审计受影响 Attempt |
| RISK-038 | 任一回读来源故障被解释为空，审核中心计数和行瞬间归零 | 高 | P0 | last-known-good、source health、partial/stale、真实空结果契约 | 停止清空缓存，恢复最后可信 snapshot，展示来源故障与截止时间 |
| RISK-039 | 客户端二次 reducer 与服务端 projection 漂移，页签、详情、计数和操作资格相互矛盾 | 高 | P0 | Snapshot 单一读 owner、稳定 code、浏览器零业务分类、契约/E2E | 关闭受影响批量动作，回退到可信 snapshot 读路径并定位首个差异 |
| RISK-040 | 浏览器按版本并发手动刷新导致 SHEIN QPS 风暴、竞态、超时和重复 refetch | 高 | P1 | 服务端 operation 去重、每店限流、有界并发、202/SSE | 复用现有 operation，暂停新刷新，保留旧快照并观察 source health |
| RISK-041 | 本地归档/隐藏直接修改官方 current projection，真实商品从运营视图和审计中消失 | 中 | P0 | Preference 与 Projection 分表、官方事件不可变、timeline 永久可查 | 恢复 preference，按 receipt 重建 projection，审计所有归档动作 |
| RISK-042 | Draft 引用释放或清理 Worker 删除仍属于 ProductVersion/合规审计的对象，历史发布证据不可恢复 | 中 | P0 | VersionMedia/Hold 原子建立、删除前事务反查、回收站与恢复演练 | 停止清理和发布，恢复对象/引用，按 Version/Receipt 输出影响报告 |
| RISK-043 | assetId、模板可见路由或相同 hash 造成跨店/跨租户图片泄露 | 中 | P0 | tenant/store/user/compliance scope、ShareGrant、短时票据和负向测试 | 吊销票据/Grant，隔离入口，审计下载与引用事件并通知负责人 |
| RISK-044 | role/order/imageType 漂移把错误图片或错误顺序提交 SHEIN，造成审核驳回或商品展示事故 | 高 | P0 | VersionMedia 冻结、服务端 role map、payload fixture 和金丝雀逐图核对 | 停止新提交，保留 Attempt/Receipt，创建新版本修正，不覆盖旧证据 |
| RISK-045 | 伪装 MIME、错误 hash、超大像素或损坏文件进入资产库和发布链 | 中 | P0 | 服务端 checksum、MIME sniff、解码/像素限制、quarantine | 隔离 Asset/Variant，阻断全部 Reference/Receipt，重新验证受影响对象 |
| RISK-046 | 清理 SQL/Worker 长期失败导致对象和数据库持续膨胀、配额和成本失真 | 高 | P1 | 集成测试、heartbeat、最老候选/失败告警、只读孤儿报告 | 暂停新增高成本任务，修复 Worker 后从小批 dry-run 恢复，不手工宽删 |
| RISK-047 | 重复上传和派生无内容寻址复用，增加存储、出网、SHEIN QPS 和发布延迟 | 高 | P1 | verified hash、transform fingerprint、PlatformReceipt 精确复用与指标 | 限制批量并发，保留正确对象，按证据合并未来引用而不删历史 |
| RISK-048 | 复用过期/跨 imageType/跨 contract 的 SHEIN URL 或 MD5，生成不可用发布 payload | 中 | P0 | receipt 完整键、validity/contractVersion、写前验证和 unknown | 停止当前候选，重新上传或只读核验，不把旧 URL 写回 Asset |
| RISK-049 | 批量页面整文件 hash/解码和原图预览造成浏览器内存峰值、冻结或崩溃 | 高 | P1 | UploadQueue、有界并发、Worker/流式处理、thumbnail、性能预算 | 降低并发和预览尺寸，保留已上传项，按 operation 恢复未完成文件 |
| RISK-050 | AI 生成未在商品事实中的材质、尺寸、功能、认证或品牌，导致 SHEIN 驳回、合规或消费者风险 | 高 | P0 | 冻结最小事实输入、严格 schema、TitlePolicy blocker、候选不自动采用 | 停用相关 Prompt/Profile，新候选全部重验，已采用标题创建受控修正 revision |
| RISK-051 | AI Provider/Redis/Worker 故障被错误提升为商品保存或发布 blocker，造成业务停摆 | 中 | P0 | A0 独立、可选能力隔离、故障注入和人工 fallback | 关闭 AI capability，保留人工标题和 Draft，重新分类错误而不改商品状态 |
| RISK-052 | 浏览器/单进程队列在刷新、重启或多副本下丢失/重复任务与计费调用 | 高 | P1 | DB Request/Event/Outbox、确定性 jobId、send boundary、恢复演练 | 暂停新批量，按 Request/Attempt 对账，只恢复 pre-send 项，unknown 不重发 |
| RISK-053 | 不完整缓存键或跨作用域缓存复用旧图片/模型/事实结果，生成错误标题或泄露其他店铺信息 | 中 | P0 | variantHash/版本化精确键、scope、两级缓存和负向测试 | 关闭缓存降级实时受控调用，吊销受影响候选并审计 cache/request 关联 |
| RISK-054 | 可配置 Provider Endpoint 被用于 SSRF、DNS rebinding、重定向换 host 或密钥外送 | 中 | P0 | Adapter registry、域名/出站 allowlist、DNS/IP/redirect 阻断和 secret host binding | 立即停用 Profile/轮换密钥、封锁出站、审计请求目的地并启动安全响应 |
| RISK-055 | 大批量图片 Base64、无限排队或 Provider 429 重试耗尽 2 核 4GB、预算和第三方配额 | 高 | P1 | ai_input Variant、字节/队列/并发/预算硬上限、公平调度和 breaker | 暂停新领取、降低并发、保留 operation 结果并按 Profile/tenant 恢复 |
| RISK-056 | AI 候选直接覆盖用户手工标题或旧 revision 晚到覆盖新内容，造成无感数据损坏 | 高 | P0 | 候选默认不写、revision/ETag 检查、diff/Decision/undo 和手工优先 | 阻断采用，恢复上一 Draft revision，按 candidateId 审计受影响记录 |
| RISK-057 | 隐藏 failover、可变模型/Prompt 或成本 unknown 被记为 0，使质量、审计和财务口径失真 | 中 | P1 | immutable Profile/Prompt/Policy、显式 provenance、Usage actual/estimated/unknown | 停止该 Profile 放量，重建用量报表，无法证明的成本保持 unknown |
| RISK-058 | 合规官方来源 partial/empty、超时或 contract 漂移被当作无要求/已通过，导致缺失材料仍发布或错误清空案件 | 高 | P0 | Raw Inbox、source health、LKG、覆盖率、contract fixture 和 unknown fail closed | 暂停受影响动作，恢复 LKG，按原始响应重建 Snapshot/Case，未证实项保持 unknown |
| RISK-059 | 报告、本体图、包装图、证书或代理材料因同模板、同 hash 或错误 role 被绑定到错误 SKC/市场/主体 | 高 | P0 | MaterialApplicability、角色/目标/labelGroup 强校验、逐项预览与跨范围负向测试 | 停止同类绑定，保留历史 Receipt，隔离材料并逐目标核对，创建新修正 Attempt |
| RISK-060 | 商品已获 SHEIN 接受后，合规上传/审核失败又把发布状态改成失败或驳回，运营重复发起商品 | 高 | P0 | 发布、商品审核、合规 Case 和人工任务正交；accepted 单调不可回退 | 禁止重发，按官方商品回执恢复发布投影，合规问题单独开 Case 和操作建议 |
| RISK-061 | 合规上传/保存/绑定发送后超时被盲重试，产生重复文件、重复绑定、冲突记录或不可解释审核结果 | 高 | P0 | 持久 send_started、result_unknown、Adapter 幂等键、逐阶段 Receipt 和人工对账 | 暂停该目标新写，主动回读/后台核验；只有明确未发送或新授权 child Attempt 才继续 |
| RISK-062 | 过期证书、代理授权、报告或旧 requirement snapshot 被缓存/模板继续复用，造成合规失效和批量驳回 | 高 | P0 | 有效期/适用范围/版本参与预检与复用键，失效事件自动开 Case 但不自动写 | 吊销候选适用性，阻断新命令，定位受影响目标并按当前官方要求补证/复验 |
| RISK-063 | GCC/产品标识符等人工任务被勾选完成后页面显示平台完成，形成合规版伪成功 | 中 | P0 | ManualComplianceTask 与 Platform Review 分离，proof/owner/复核/官方证据均可见 | 撤销假投影，保留人工声明审计，重新核验 SHEIN 后台并更新真实案件状态 |
| RISK-064 | Adapter、schema、labelId 或 warning mapping 版本漂移，向 SHEIN 发送字段语义正确但版本错误的 payload | 高 | P0 | 版本化 Adapter contract/mapVersion、启动自检、fixture、release manifest 和金丝雀 | 关闭对应 action capability，冻结新命令，按 Attempt/contractVersion 识别影响面并回读 |
| RISK-065 | 大店合规同步/批量写请求风暴耗尽 SHEIN QPS、2 核 4GB Worker 或对象带宽，并扩大敏感材料暴露面 | 高 | P1 | 单 owner、operation 去重、有界并发、公平限流、字节预算、短时票据和审计 | 停止新批量领取，保留逐项进度，降低并发后按 tenant/store/action 分批恢复 |
| RISK-066 | 销量/库存缺行、字段缺失或部分批次失败被写成 0，触发错误断货、滞销或补货判断 | 高 | P0 | target coverage、quality status、unknown-safe schema、LKG 和缺行 fixture | 暂停受影响指标/预警，恢复 LKG，按 SourceReceipt 重建事实，无法证明的 0 改回 unknown |
| RISK-067 | 部分 SKU 在途或库存小计被当成完整商品/店铺总量，造成低估库存、重复备货或仓库判断错误 | 高 | P0 | SKU 集合版本、逐层 coverage、known subtotal/partial 和 warehouse 明细 | 停用相关建议，显示覆盖缺口，重新读取缺失 SKU 后再生成新 Recommendation |
| RISK-068 | 简单 7 日缺口在缺少 lead time、MOQ、包装倍数、季节性和在途 ETA 时被采纳，造成地毯积压或断货 | 高 | P0 | 基础缺口与正式建议分离、PolicyVersion、参数完整性门和人工决定审计 | 撤回建议资格但保留历史决定，核对库存/在途/生产参数后生成新版本，不自动执行 |
| RISK-069 | 7/30 日窗口被绘制为历史趋势，或未开放的曝光/转化/GMV/利润被推造，导致经营决策建立在假数据上 | 中 | P0 | API 能力矩阵、指标来源标签、真实日事实门和 unsupported 明示 | 下线伪指标/曲线，保留变更审计，向用户说明受影响报表和可用替代事实 |
| RISK-070 | 跨店汇总混用不同 cutoff、覆盖率、经营模式或指标版本，排名和总量看似精确但不可比较 | 高 | P0 | comparability gate、coverage、cutoff skew、metric version 和共同截止选择 | 停止该聚合/排序，拆分不可比店铺，按相同口径重算或保持 unknown |
| RISK-071 | 临时预警重复出现、被隐藏后永久丢失或无人负责，真正缺货风险在刷新间失去闭环 | 高 | P1 | 持久 AlertCase、去重、owner/SLA、状态事件、复发和超时升级 | 从历史事实重建 open cases，恢复负责人和截止日，审计被错误关闭/遗漏的目标 |
| RISK-072 | Scheduler、Webhook 或跨店手动刷新形成请求风暴，耗尽 SHEIN QPS、Worker 和 2 核 4GB 资源 | 高 | P1 | 默认无 Scheduler、单 Operation owner、店铺/endpoint 限流、公平队列和容量预算 | 暂停新刷新、复用在途任务、降低并发，保留 LKG 并按店铺分批恢复 |
| RISK-073 | `warehouseType` 退役或库存模式/仓库语义变化后 Adapter 仍发送旧字段，库存读回失败或读错类型 | 中 | P0 | `invType=PI` 单一合同、退役日门禁、真实金丝雀、contractVersion 和启动自检 | 关闭库存数据源，保留旧快照为 stale，升级 Adapter 后单店核对再恢复汇总/建议 |
| RISK-074 | Recommendation 或人工计划未经确认直接创建平台备货/发货单，造成过量备货、资金占用或错误店铺写入 | 高 | P0 | Plan Revision、审批、动作 capability、目标确认、一次性授权和官方回读 | 立即关闭该动作、冻结同业务键，核对 SHEIN 单据并保留全部 Command/Receipt，不自动取消 |
| RISK-075 | 发送后超时或 Worker 崩溃被自动重试，重复创建/修改/取消发货单或手工备货单 | 高 | P0 | send_started、result_unknown、同单串行、业务键锁和 Adapter 幂等证据 | 停止 Action Worker 领取，只读回查/后台核验；未知收敛前禁止同类写 |
| RISK-076 | 数量缺失被补 0、阶段数量互相覆盖或部分 SKU 汇总成完整总量，导致少发、超发或错误对账 | 高 | P0 | SKU Quantity Ledger、quality/coverage、守恒规则和逐阶段 Receipt | 停止相关计划/发货，恢复 LKG，按官方回执重建 Ledger 并开差异 Case |
| RISK-077 | 合单忽略采购类型、仓、预估仓、市场、安检/品类、JIT 或 SKU 集合规则，被平台拒绝或混错货 | 高 | P0 | Eligibility Engine、当前 Option/Receipt、影响预览和真实错误 fixture | 取消本地未发送计划；已发送则冻结同单并按平台状态处理，不自动拆改重试 |
| RISK-078 | stale/硬编码地址、仓库、物流、预约或包裹限制导致错仓、无法取件、罚款、标签无效或物流拒收 | 高 | P0 | Option Snapshot freshness、官方 ID、写前重验、时区/重量/尺寸规则 | 暂停命令，刷新当前选项，作废未使用标签并创建新 Plan Revision |
| RISK-079 | 地毯大尺寸重量、体积或折叠包装估错，造成超限运费、破损、折痕、受潮、到仓次品与亏损 | 高 | P1 | 尺寸 SKU 实测、Package Revision、物流产品限制、包装风险确认和小批 canary | 停止该包装方案放量，隔离受影响包裹，核对到仓/次品并更新版本化参数 |
| RISK-080 | 隐藏选择、过期 eligibility 或跨店 token 让 UI 显示 4 条却提交更多采购单，形成批量履约事故 | 高 | P0 | selection 强 scope、snapshot/eligibility revision、可见 eligible 集合和服务端重验 | 阻断整个未发送命令，吊销 token，审计请求体/选择事件与受影响店铺 |
| RISK-081 | 发货地址、电话、运单或标签通过日志、导出、缓存或跨店下载泄露 | 中 | P0 | 数据分级、脱敏、私有对象、短时票据、最小导出和负向测试 | 吊销票据、关闭入口、审计访问和轮换可撤销资源，按安全流程处理 |
| RISK-082 | 退货/报废/申诉发送后超时被自动重试，造成重复申请、重复确认、重复申诉或证据覆盖 | 高 | P0 | Durable Command、send_started、result_unknown、业务键锁和 action-specific 幂等证据 | 停止该 action Worker，只读回查/后台核验；未知收敛前冻结同业务键 |
| RISK-083 | 退货或财务时间窗口/分页缺失被当成空，页面显示无退货、无处罚或损失为 0 | 高 | P0 | 60/7 天切片、target coverage、partial/unknown/LKG 和边界 fixture | 暂停受影响汇总，恢复 LKG，按 Receipt 重拉缺口，无法证明的 0 改回 unknown |
| RISK-084 | 平台原因或自由文本财务分类被自动映射成供应商责任并触发扣款/停售，造成商业与合作纠纷 | 高 | P0 | raw 永久保留、版本化 taxonomy、证据门、人工责任决定和零自动扣款 | 撤销错误决定但保留审计，停止相关动作，复核案件/财务影响并通知责任人 |
| RISK-085 | 同单同 SKU 多报告/跨账期扣款和补款被覆盖、重复计算或错误近似匹配，导致财务对账失真 | 高 | P0 | 不可变 FinanceEntry、精确身份、matched/ambiguous/unmatched、Allocation 和人工复核 | 冻结受影响报表，按 raw 重建明细/匹配，单列未匹配与歧义金额后重新关账 |
| RISK-086 | 官方金额、预计损失和不同币种被混合为一个损失/利润数字，误导定价、供应商和运营决策 | 高 | P0 | 口径分层、currency/FX source/time/version、coverage 和缺成本禁止利润 | 下线伪汇总，恢复原币种明细，标注受影响期间并按核准口径重新计算 |
| RISK-087 | 消费者 PII、缺陷证据、面单、地址或争议资料通过日志、导出、对象 URL 或跨店访问泄露 | 高 | P0 | 最小字段、分级脱敏、私有对象、短时票据、retention hold 和跨域负向测试 | 吊销票据、隔离对象、审计访问与导出，按安全流程通知并修复权限/保留策略 |
| RISK-088 | 逆向隐藏选择或 stale snapshot 让 UI 显示少量商品却批量提交更多店铺/退货对象 | 高 | P0 | selection scope、可见 eligible 集合、影响预览、服务端 revision 重验和跨店写禁用 | 阻断未发送命令、吊销 token，审计目标集；已发送逐项后台核对且不自动撤回 |
| RISK-089 | Scheduler/Webhook/跨店刷新请求风暴耗尽 SHEIN QPS 和 2 核 4GB，造成退货/财务事实长期 stale | 高 | P1 | 默认无 Scheduler、单 RefreshOperation、endpoint/店铺限流、公平队列和字节预算 | 暂停新刷新、复用在途任务、降低并发，保留 LKG 并按店铺/时间窗分批恢复 |
| RISK-090 | 把 SHEIN 供货价当工厂成本，生成虚假高/低毛利并错误调价、备货或淘汰商品 | 高 | P0 | priceType 强类型、语义迁移、API/UI 标签和利润输入白名单 | 下线受影响利润，恢复原始价格事实，识别期间/商品并用真实成本重算 |
| RISK-091 | 财务明细 partial/空、成本或售后缺失被补 0，页面仍显示完整利润、已回款或排名 | 高 | P0 | Source coverage、Profit quality gate、LKG、unknown-safe schema 和缺口 fixture | 暂停完整利润/排名，显示缺口并恢复 LKG；无法证明的 0 改回 unknown |
| RISK-092 | 不同币种直接相加、使用过期/错误汇率或浮点舍入，导致利润、应收应付和付款金额失真 | 高 | P0 | 原币种、FX source/time/policy/version、decimal 和币种舍入 | 冻结受影响报表/付款建议，恢复原币种，按核准 FX 重算并审计差异 |
| RISK-093 | 包材/物流/仓储费用按件平均分摊到大尺寸地毯，掩盖体积重和售后亏损 | 高 | P0 | SKU/批次直接成本、版本化 area/weight/volume driver、未分摊边界 | 撤销错误 Allocation pointer，保留旧 Run，使用合理 driver 生成新利润 Snapshot |
| RISK-094 | 银行账户、税号、发票、工厂成本、利润或供应商资料通过日志、导入导出、对象 URL 或跨店访问泄露 | 高 | P0 | 字段级 capability、加密/私有对象、脱敏、短时票据、最小导出和审计 | 吊销票据/账户访问，隔离文件，审计影响面并按安全流程处理与轮换 |
| RISK-095 | UI/配置误开放付款、write-off、开票或调账，或发送未知自动重试，造成真实资金与账务事故 | 高 | P0 | 零可达执行、双人审批、step-up/MFA、账户白名单、send_started/result_unknown 和金丝雀 | 立即关闭 action/Worker，冻结账户与业务键，只读核对银行/平台，不自动冲正 |
| RISK-096 | 月结后晚到报告、成本或汇率静默修改历史利润，管理层使用的月报无法复现 | 高 | P0 | Period close、不可变 Snapshot、调整期/受控 reopen、影响预览和审批 | 恢复旧关闭版本，隔离晚到事实，按批准重开生成新版本并说明差异 |
| RISK-097 | 多店大明细刷新、重算和导出耗尽 SHEIN QPS、DB/内存或 2 核 4GB，造成财务 stale 或服务不可用 | 高 | P1 | 手动单 owner、7 天切片、有界队列、服务端分页/decimal 聚合、后台导出和资源预算 | 暂停新刷新/重算/导出，保留 LKG，降低并发并按店铺/期间分批恢复 |
| RISK-098 | 接受低于真实成本或利润底线的平台建议价，导致每售一件持续亏损且大尺寸地毯损失被平均值掩盖 | 高 | P0 | SKU ProfitSnapshot、PriceFloorPolicy、覆盖/质量门、尺寸单位经济和双人例外 | 关闭接受 capability，锁定受影响讨论，核对平台状态与预计损失，恢复前逐 SKU 复核 |
| RISK-099 | 拒绝议价的不可逆语义未被理解或被重复/越权触发，导致商品永久无法上架或再次报价 | 高 | P0 | 独立 reject capability、强确认、影响预览、revision 锁、一次命令和 step-up | 立即关闭 reject adapter，保留命令证据并人工核对平台；不可伪造撤回或自动重试 |
| RISK-100 | RRP 全量替换时漏发旧值、混用 site 或并发旧 revision，造成大批建议零售价被清空或错误覆盖 | 高 | P0 | read-merge-freeze、完整集合 hash、server-side CAS、分块逐项结果和官方回读 | 停止 RRP 写，保留提交/旧快照，读取官方当前集合并人工制定受控恢复 proposal |
| RISK-101 | 上传材料、HTTP 200 或 accepted 被当成价格生效，运营按错误价格做备货、活动或利润判断 | 高 | P0 | submitted/effective 分层、官方值回读、状态证据和 reconciliation case | 下线伪生效投影，恢复 LKG，标记受影响对象并逐项后台/官方接口核对 |
| RISK-102 | 发送后超时自动重试接受、拒绝、重报价或改价，产生重复动作、错轮次、讨论终止或未知价格 | 高 | P0 | Durable Command、send_started、result_unknown、业务键锁和动作级只读收敛 | 暂停对应 Worker/capability，只读回查；未知收敛前冻结相同讨论/价格键 |
| RISK-103 | 隐藏选择、旧快照或跨店串选让少量可见商品触发更多价格动作，放大亏损与不可逆影响 | 高 | P0 | selection scope、当前可见 eligible、影响金额/数量预览、服务端 revision 重验 | 阻断未发送命令、吊销授权 token；已发送逐项核对且不自动反向操作 |
| RISK-104 | 动态原因、币种精度、规则或利润输入 stale，导致提交失败、舍入错价或批准条件已失效仍执行 | 高 | P0 | Option/Rule/Profit revision、授权时重验、decimal 和 stale fail closed | 停止新授权，刷新指定来源，废止旧 approval/proposal 后重新预检 |
| RISK-105 | 未核准的消费者售价/活动接口被通用改价能力开放，造成真实错误写入、伪活动状态或平台处罚 | 高 | P0 | unsupported 显示、动作白名单、默认关闭、启动自检和独立合同/金丝雀 | 立即关闭未知 adapter/route，审计调用与平台结果，按官方后台恢复并登记事故 |
| RISK-106 | 伪造曝光/点击/转化或把 0 销量当无需求，导致错误换图、降价、清仓或淘汰真实潜力商品 | 高 | P0 | unsupported/unknown、一等 coverage、可售诊断树、人工后台证据和零自动动作 | 下线伪指标/结论，恢复原始事实，标记受影响决定并逐项重新评估 |
| RISK-107 | 全局生命周期或跨店复制实验结果，把单店/小尺寸偶然表现放大到多店和完整尺寸组，造成库存与资金损失 | 高 | P0 | store/site/version 粒度、尺寸 SKU 门、可比性和逐店 Decision | 暂停扩店/放量计划，隔离受影响目标，恢复各店阶段并重新计算资源影响 |
| RISK-108 | 测款中途多变量变化仍被归为一次实验，团队把相关性误判为因果并持续复制错误运营策略 | 高 | P1 | 冻结 revision、变更事件、observational/inconclusive、可比窗口和复盘审核 | 废止错误结论但保留历史，停止复制该策略，按新假设重新测试 |
| RISK-109 | 人工活动提交被当成官方通过，或活动 API 伪开放，导致错价、断货、无法下架、亏损或平台处罚 | 高 | P0 | CampaignPlan/Fact 分层、官方合同门、价格/库存/合规资格和零自动报名 | 关闭活动入口，核对 SHEIN 后台真实状态，冻结冲突动作并记录事故/恢复任务 |
| RISK-110 | 增长建议绕过领域 owner 直接改标题、媒体、价格、库存或上下架，重复制造伪成功和跨模块回归 | 高 | P0 | GrowthActionPlan 交接、对应领域 capability/Command/回读和零通用执行器 | 禁用增长执行路由，保留计划，逐域核对已发送动作并恢复官方/本地状态 |
| RISK-111 | AI 黑盒爆款分或 stale 数据自动晋级/淘汰，放大偏差且无法说明为何做出商业决定 | 高 | P0 | 多维解释、input/policy/model version、人工决定、过期和 provider 降级 | 停止自动推荐/迁移，撤销 current pointer 至最后人工有效决定并审计影响 |
| RISK-112 | 阶段批量隐藏选择或旧 snapshot 作用到额外商品/店铺，造成大范围放量、清仓或任务风暴 | 高 | P0 | selection scope、可见 eligible、逐项 Proposal、影响预览和 revision 重验 | 阻断未执行任务、撤销未开始 Plan，逐项审计已交接任务且不自动反向写平台 |
| RISK-113 | 多店/多窗口增长重算、AI 和导出耗尽 2 核 4GB 或触发刷新风暴，使经营数据 stale 并输出旧结论 | 高 | P1 | 手动单 owner、增量计算、公平队列、资源预算、LKG 和 stale 失效 | 暂停新重算/AI/导出，保留 LKG，降低并发并按店铺/窗口分批恢复 |
| RISK-114 | 任务被关闭或评论“已处理”却没有对应平台回读，页面和团队误以为商品发布、价格或审核已成功 | 高 | P0 | 业务/任务状态正交、结构化领域证据、verified/closed 分层和伪完成负向测试 | 恢复领域官方状态，重开受影响任务，标记错误结论并逐项核对 SHEIN/数据库 |
| RISK-115 | 商品、价格、金额、目标集合或规则变化后继续消费旧审批，向 SHEIN 执行未获批准的新动作 | 高 | P0 | 不可变 subjectRevision/impact hash、自动 invalidation、一次性 Grant 和消费 CAS | 吊销未消费 Grant、停止业务键、只读核对已发 Command，按新 revision 重新申请 |
| RISK-116 | 自审、代理凑人数或越权管理员绕过职责分离，造成亏损价格、资金、批量发布或申诉事故 | 高 | P0 | 不同主体计数、资格实时重验、action capability、step-up 和 break-glass 复核 | 关闭审批/动作 capability，吊销 Grant，审计决定与命令；已执行逐项人工核对 |
| RISK-117 | 批量事件产生通知风暴、Outbox 积压或投递丢失，关键驳回/到期/异常被淹没或无人知晓 | 高 | P1 | groupKey/摘要、优先队列、强制类别、积压 SLO、重放和独立 Inbox | 暂停低优先通知，恢复应用内队列，重放关键事件并核对未确认接收者 |
| RISK-118 | 成员离岗、停用或代理到期留下无人负责的高风险任务/审批，错过寄样、发货、申诉或月结截止 | 高 | P0 | offboarding blocker、orphan queue、管理告警、转交清单和官方截止预警 | 冻结相关外部动作，管理员接管队列，按最早官方截止优先重分配并记录事故 |
| RISK-119 | 工作标题、评论、mention、附件或通知跨 tenant/store 泄露价格、利润、证书、地址、PII 或商业策略 | 高 | P0 | 服务端 scope/capability、字段裁剪、私有对象、短时票据、接收者重验和负向测试 | 吊销票据/会话、隔离附件、停止通知 fan-out、审计访问并按安全流程处置 |
| RISK-120 | 时区、节假日或 SLA pause 误算让团队错过平台硬截止，内部页面仍显示“未逾期” | 高 | P0 | UTC+原时区、BusinessCalendarVersion、官方截止不顺延、边界 fixture 和双重提示 | 纠正政策/时钟，识别所有受影响任务，按官方时间人工补救并保留时间线 |
| RISK-121 | SLA/周期任务/通知 Worker 误触发外部刷新或大规模扫描耗尽 QPS/2 核 4GB，甚至重复发送 SHEIN 动作 | 高 | P0 | 协同 worker 零 SHEIN adapter、有界 claim/lease、网络审计、资源预算和故障注入 | 停止协同 Worker，关闭外部 action capability，核对命令/平台状态后分批恢复本地提醒 |
| RISK-122 | 伪曝光/转化/订单或 unknown 补零进入驾驶舱，管理层据此淘汰潜力款、错误补货或降价 | 高 | P0 | unsupported/unknown、来源/coverage、指标注册、负向 E2E 和零自动动作 | 下线受影响 KPI/报表，标记错误决策，恢复原始事实并逐项重新评估 |
| RISK-123 | 卡片、排名、下钻和导出使用不同快照/口径，同一个数字无法对账并导致错误资源分配 | 高 | P0 | DashboardSnapshot、共享 snapshotId、MetricVersion 和总计对账门禁 | 冻结报表发布，恢复最后一致快照，识别受影响导出/决定并重新生成 |
| RISK-124 | 跨店混用经营模式、币种、窗口、版本和 cutoff，把不可比店铺排成优劣并误导团队绩效/策略 | 高 | P0 | comparability gate、storeSet revision、FX/coverage/cutoff 显示和不可比排除 | 撤销排名/目标，按同口径分组重算，通知使用者并保留旧错误报告证据 |
| RISK-125 | 缺成本/汇率/关账或 partial 财务数据仍输出完整利润，导致调价、活动、备货和资金决策持续亏损 | 高 | P0 | ProfitSnapshot only、quality gate、原币种、FX/period version 和数据不足状态 | 停止利润驱动动作，恢复原币明细/LKG，补齐证据后新版本重算 |
| RISK-126 | 大报表、重算、导出或订阅 fan-out 耗尽数据库/内存/CPU，生产发布与同步服务不可用 | 高 | P1 | 有界 Worker、statement timeout、并发/行/字节预算、缓存和 2 核 4GB 压测 | 暂停分析/导出队列，保留业务服务与 LKG，降低并发后按范围恢复 |
| RISK-127 | 导出、自定义分析、订阅或下钻跨 tenant/store/字段权限泄露利润、成本、PII、证书和商业策略 | 高 | P0 | dataset/field capability、私有 Artifact、短时票据、接收人重验和跨域负向测试 | 吊销票据/订阅、隔离 Artifact、审计访问并按安全流程处置 |
| RISK-128 | 定时报表为追求“最新”触发 SHEIN 刷新或报表动作直写平台，造成 QPS 风暴、重复动作和新伪发布 | 高 | P0 | 已有 Snapshot only、报表零外部 adapter、WorkItem 交接和网络审计 | 停止订阅/分析 Worker 和 action capability，只读核对已发命令与平台状态 |
| RISK-129 | 指标/维度变更、late data 或组织变化静默重写历史报表，已发送月报和决策证据无法复现 | 高 | P0 | 不可变 Snapshot/ReportRun、版本化 dimension/metric、关账与 supersedes | 恢复旧版本指针，隔离新数据，生成带差异的新报告并通知引用者 |

## 4. 架构与产品决策登记

| Decision ID | 决策 | 状态 | 依据 | 可修改条件 |
| --- | --- | --- | --- | --- |
| ADR-001 | 不增加全站每 30 秒自动同步；以手动刷新为主 | ACCEPTED | 用户明确要求，减少任务风暴和状态竞争 | 新业务指标证明需要，且先设计 owner/限流 |
| ADR-002 | 发布后允许仅针对当前活动命令的 SSE 或有界短轮询 | ACCEPTED | SHEIN 常在 2–3 秒内反馈，需要顺滑但不能常驻轮询 | ERP-09/13 验证反馈分布后调整上限 |
| ADR-003 | 页面不得把排队、HTTP 200 或本地写入称为“发布成功” | ACCEPTED | 防止伪发布 | 不可放宽，只能增加更强官方证据 |
| ADR-004 | 只有一套生产 V2 前端构建和部署入口 | ACCEPTED | 历史出现 legacy/V2 误部署 | ERP-02 设计批准后实施 |
| ADR-005 | 草稿提交成功后退出活动草稿列表，但保留不可变审计快照 | ACCEPTED | 草稿箱只服务待编辑/待发布工作 | ERP-04/06 可细化状态名，不可丢审计 |
| ADR-006 | 审核中心由统一快照 API 提供列表、计数、可操作性和版本 | PROPOSED | 避免前端多次查询拼出矛盾状态 | ERP-11 评审后接受或修订 |
| ADR-007 | 选择状态只绑定当前 snapshot 和当前可操作集合 | PROPOSED | 消除隐藏选中、跨筛选残留 | ERP-13 交互评审后接受或修订 |
| ADR-008 | 历史数据修复不自动重发 SHEIN，不把未知批量改成功 | ACCEPTED | 避免重复商品和伪证据 | 不可放宽 |
| ADR-009 | UI 大改必须先出低保真和视觉基线，经用户批准后实现 | ACCEPTED | 防止修业务时意外重做前端 | 用户明确批准具体设计 |
| ADR-010 | 旧代码和旧数据只在 ERP-23 零引用证明后退役 | ACCEPTED | 当前运行边界尚不可信 | 紧急安全风险除外，仍需可恢复处理 |
| ADR-011 | 账号身份保持全局，成员状态和角色属于具体工作空间 | ACCEPTED | 支持同一用户加入多个工作空间且可独立停用 | 只有产品明确永久单租户时重新评审 |
| ADR-012 | 所有业务写统一使用服务端动作能力门禁，店铺白名单不能替代动作授权 | ACCEPTED | viewer 只读和真实发布必须 fail-closed | 不可放宽，只能细化能力词典 |
| ADR-013 | 商业 ERP 默认邀请制，公开注册关闭 | ACCEPTED | 降低攻击面和无效成员 | 未来建立独立公开自助 onboarding 产品时重新设计 |
| ADR-014 | Owner、Admin、Manager、Operator、Reviewer、Viewer 使用预置角色，首期不开放任意权限 DSL | ACCEPTED | 控制复杂度并保持可审计 | 真实客户需求证明预置角色不足 |
| ADR-015 | 真实发布由 `product.publish.execute` 独立授权，不只依赖角色名称 | ACCEPTED | 发布是高风险 SHEIN 写动作 | 不可取消动作门禁，可调整默认角色授予策略 |
| ADR-016 | SHEIN 店铺新增、重授权、撤销和全局命名仅限明确管理能力 | ACCEPTED | 店铺凭证和租户边界属于高风险管理面 | 不可授权给 Viewer；其他委派需单独审计设计 |
| ADR-017 | 权限变化使用 authorizationVersion 驱动服务端即时生效和前端缓存失效 | ACCEPTED | 防止旧页面和旧查询继续暴露已撤销数据 | 可替换技术实现，不可降低即时失效语义 |
| ADR-018 | 现有认证与租户骨架增量升级，不做一次性身份系统重写 | ACCEPTED | 当前基础测试通过且可复用，降低回归风险 | 只有架构验证证明无法安全迁移时重新评审 |
| ADR-019 | `Store` 是稳定业务身份，SHEIN 连接和凭证是可替换子实体 | ACCEPTED | 保持商品、草稿、发布、审核和审计历史连续 | 只有 SHEIN 官方身份模型和存量证据证明无法稳定映射时重审 |
| ADR-020 | 生命周期、连接、可运营性和数据新鲜度使用四个独立状态维度 | ACCEPTED | 避免万能状态同时阻断历史、调度和 UI | 可细化枚举，不可重新合并为单一状态 |
| ADR-021 | 新增授权与指定店铺重授权分离；身份不匹配绝不覆盖 | ACCEPTED | 防止重授权串店、覆盖或隐式重复店铺 | 不可放宽；只能加强人工恢复路径 |
| ADR-022 | 外部令牌交换后，本地授权结果在一个数据库事务中提交 | ACCEPTED | 杜绝半完成 active 店铺和假完成 attempt | 可改变事务实现，不可降低原子性语义 |
| ADR-023 | 断开连接保留店铺身份、历史和访问关系；归档是独立生命周期动作 | ACCEPTED | 历史属于工作空间，不应随凭证失效消失 | 法律合规删除必须走独立受控流程 |
| ADR-024 | 多店组织首期采用一个主店铺组和多个标签，不做深层树与显式 deny | ACCEPTED | 支持当前规模并控制权限继承复杂度 | 真实客户场景证明一层分组不足后重审 |
| ADR-025 | 全店聚合默认只读；跨店写入需要独立 capability、目标清单、预览和确认 | ACCEPTED | 降低店群误操作事故半径 | 不可取消目标确认；可细化审批策略 |
| ADR-026 | 切店是受保护的上下文切换，禁止无权限/失效 URL 静默回落第一家店 | ACCEPTED | 防止用户在错误店铺执行写操作 | 不可放宽 |
| ADR-027 | 当前店铺体验缓存按 tenant/user/workspace 隔离，URL 与服务端授权为最终事实 | ACCEPTED | 防止切账号、工作空间和多标签页串店 | 可替换缓存技术，不可降低作用域 |
| ADR-028 | 已进入服务端的任务始终绑定原 storeId；切店不取消、不转移、不重绑 | ACCEPTED | 保持发布和同步命令的幂等与审计一致 | 只有用户显式取消且任务协议支持时可终止，不得重绑 |
| ADR-029 | 店铺业务数据手动刷新；切店不调用 SHEIN；Webhook 与活动命令有界反馈是例外 | ACCEPTED | 用户明确要求并避免限流、同步风暴和状态竞态 | 未来需以容量数据和新 ADR 才能增加调度 |
| ADR-030 | 平台稳定身份和唯一约束只在当前官方语义及存量数据只读验证后迁移 | ACCEPTED | openKey/supplier 字段永久性尚需证据 | 只读碰撞审计、官方核对和 staging 演练全部通过 |
| ADR-031 | 当前不部署 Keycloak/OpenFGA/Temporal；只借鉴其认证、授权和持久状态机模式 | ACCEPTED | 现有规模可用 PostgreSQL、统一 authorize、outbox/inbox 增量实现 | 现有实现达到可量化瓶颈且迁移收益通过架构评审 |
| ADR-032 | disconnected/reauthorization_required 店铺按原访问权限读取本地历史，远端读写独立受限 | ACCEPTED | 连接失效不应销毁商业历史或访问关系 | 合规或客户数据保留策略明确要求收紧时重审 |
| ADR-033 | 建立稳定 CatalogProduct/CatalogSku，Draft、supplier code 和 SHEIN 身份不作为内部主键 | ACCEPTED | 保持商品跨版本、重发和平台身份变化的连续历史 | 只有业务明确无需本地商品身份时重审 |
| ADR-034 | 地毯默认一件 CatalogProduct 对应一个计划中的 SKC，不同尺寸对应 CatalogSku/SHEIN SKU | ACCEPTED | 符合当前建品工作流并控制一个商品的责任边界 | 当前 SHEIN 契约证明必须多 SKC 同体时以 AttemptItem 扩展，不改变主身份 |
| ADR-035 | 多 SKC 本地分组使用可选 ProductFamily，SHEIN 官方 SPU 只以平台回读为准 | ACCEPTED | 避免本地分组伪装为官方 SPU | 可调整分组交互，不可伪造官方身份 |
| ADR-036 | ProductDraft 是 mutable 工作副本，ProductVersion 是 handoff 生成的 immutable 事实 | ACCEPTED | 编辑便利与历史可重现必须分开 | 不可放宽 ProductVersion 不可变性 |
| ADR-037 | 每个 PublishAttempt 必须引用准确 ProductVersion，并记录 parent/supersedes/reason | ACCEPTED | 消除重发复用 mutable Draft 和当前尝试推断 | 不可取消版本和父尝试关系 |
| ADR-038 | handoff 成功后 Draft 依据 handed_off 事实立即退出默认草稿箱 | ACCEPTED | 草稿箱只服务待编辑/待发布，不能等待 Job/审核/合规才隐藏 | 可调整 UI 动画，不可退回 Job-exists 启发式 |
| ADR-039 | preflight 失败留草稿；handoff 后失败留发布中心；仅显式返回编辑派生新 revision | ACCEPTED | 保持工作流归属和用户意图清晰 | 可增加审批，不可自动开放重复提交入口 |
| ADR-040 | result_unknown 不自动重试、不自动创建可提交 revision | ACCEPTED | 防止 SHEIN 重复商品 | 不可放宽，只能在官方回读确定结果后转换 |
| ADR-041 | 官方审核、上架和合规状态不写入 ProductDraft 万能状态 | ACCEPTED | 六维状态必须由各自事实源负责 | 不可重新合并 |
| ADR-042 | 现有 SPU/SKC/SKU 表作为 SHEIN 官方只读投影，PlatformProductLink 连接本地身份 | ACCEPTED | 分离 authoring 与 official readback | 可替换表结构，不可让草稿覆盖官方事实 |
| ADR-043 | supplier code/supplier SKU 是 store 作用域业务键，不是数据库主身份 | ACCEPTED | 业务编码可能修正、重复或受平台规则影响 | 可加强唯一约束，但不得代替内部 ID |
| ADR-044 | Draft 使用 lockVersion/ETag 服务端乐观并发控制 | ACCEPTED | 防止多成员和多标签页静默覆盖 | 可替换并发技术，不可降低冲突检测语义 |
| ADR-045 | 页面读取不产生草稿写入；规则重校验只由显式操作或 handoff 触发 | ACCEPTED | 读操作不应隐式改变业务事实或调用平台 | 低风险缓存预热可例外，但不得改变 Draft/状态或调用写接口 |
| ADR-046 | ProductVersion 冻结展开内容、SKU、素材及规则/模板 fingerprint，旧规则不反向修改旧版本 | ACCEPTED | 保证每次提交可重现和审计 | 保留策略可调整，不可修改历史语义 |
| ADR-047 | 动态类目继续使用版本化 JSONB，只规范化核心身份、关系、状态和唯一键 | ACCEPTED | SHEIN schema 动态且全量拆列成本高 | 经测量证明特定热点需要结构化时可增量增加投影列 |
| ADR-048 | 商品模型采用 current projection + ProductEvent + outbox/inbox，不引入全量事件溯源 | ACCEPTED | 控制复杂度并保留可靠审计 | 当前模型无法满足恢复/审计且替代方案收益通过评审 |
| ADR-049 | 普通“删除草稿”使用归档/回收站语义，永久删除走独立数据治理流程 | ACCEPTED | 防止误删历史和媒体引用 | 法律保留策略可定义永久删除审批，不在普通列表开放 |
| ADR-050 | 当前发布尝试由显式关系或规范 reducer 推进，不以最新时间启发式判断 | ACCEPTED | 消除旧驳回覆盖新尝试和多来源竞态 | 不可放宽；legacy 数据只能标不确定或人工映射 |
| ADR-051 | 建立一个 ProductWorkbench 领域内核，单品、批量和草稿批处理共享模型、命令与 adapter | ACCEPTED | 消除多个商品组装 owner 和入口漂移 | 只有对等测试证明某入口确需独立领域模型时重审 |
| ADR-052 | 不同入口可有不同布局，但必须共享 ProductFormModel、section 语义、模板和验证 | ACCEPTED | 商业交互可不同，业务事实不能不同 | 可调整视图，不可复制领域规则 |
| ADR-053 | ProductFormModel 是浏览器编辑状态唯一 owner，section 不保留第二份业务值 | ACCEPTED | 防止局部 state、Query cache 和 payload 三份 truth | 可替换状态技术，不可降低唯一 owner 语义 |
| ADR-054 | 服务端 preflight 是 handoff 前最终权威，浏览器校验只负责即时反馈 | ACCEPTED | 权限、最新 schema 和完整规则只能由服务端可信执行 | 不可把正式门禁下放浏览器 |
| ADR-055 | 自动保存只写 mutable Draft，不调用 SHEIN、不 handoff、不改变审核/发布状态 | ACCEPTED | 自动保存必须可逆且无外部商业副作用 | 可调整防抖/离线策略，不可增加外部写入 |
| ADR-056 | 模板使用稳定 ID、不可变版本、tenant/store scope、schema compatibility 和 fingerprint | ACCEPTED | 确保隔离、兼容和历史可重现 | 可扩展模板类型，不可取消版本/作用域 |
| ADR-057 | 模板默认 fill-empty；覆盖选中字段和替换区段必须显式确认 | ACCEPTED | 防止模板静默破坏手工和导入数据 | 不可把覆盖改为默认 |
| ADR-058 | 模板应用前输出新增/覆盖/保留/阻断 diff，并记录字段/区段 provenance 与可撤销 patch | ACCEPTED | 用户必须能理解和恢复批量影响 | 可调整 UI，不可取消差异和来源证据 |
| ADR-059 | 手工修改优先于已应用模板，直到用户显式重引相应字段或区段 | ACCEPTED | 尊重用户意图，避免模板更新抢占事实 | 只有用户明确选择覆盖时例外 |
| ADR-060 | 模板新版本不反向修改既有 Draft 或 ProductVersion | ACCEPTED | 防止历史和待编辑数据随模板漂移 | 受控 schema 升级仍需逐项 diff/确认 |
| ADR-061 | 批量建品页是协调器，不是第二套编辑器；每件商品使用独立统一 FormModel | ACCEPTED | 保持单品/批量输出一致并隔离失败 | 可增加批次级视图，不可复制组装 owner |
| ADR-062 | 批量保存采用逐项幂等、部分成功、有界并发和安全重试，结果未知不盲重试 | ACCEPTED | 防止一项失败清空整批或重复建品 | 并发值可测量调整，语义不可放宽 |
| ADR-063 | 文件夹导入遇到身份/角色映射歧义必须阻断；文件夹名不作稳定商品身份 | ACCEPTED | 防止图片错配和错误合并商品 | 可扩展命名规范，不可恢复猜测式匹配 |
| ADR-064 | SKU 行使用稳定 localRowId；批量操作是可预览/撤销 patch，unknown 不写 0 | ACCEPTED | 保障排序、模板和批量编辑稳定性 | 可替换 UI，不可取消稳定行身份与 unknown 语义 |
| ADR-065 | AI、媒体预览和可选合规能力与编辑器主链隔离，失败不阻断人工安全编辑 | ACCEPTED | 可选服务故障不应造成商业停摆 | 当前 SHEIN 明确必填仍可形成 blocker |
| ADR-066 | 商品工作台采用黄金回归和垂直切片渐进迁移，不做整页一次性重写 | ACCEPTED | 降低修 A 坏 B 和无法定位差异的风险 | 只有旧实现无法形成可测边界且有批准的替代方案时重审 |
| ADR-067 | 动态字段继续使用版本化 JSONB，并以 legacy adapter 保留未知字段；核心身份/并发/检索结构化 | ACCEPTED | 兼顾 SHEIN schema 动态性、兼容与查询约束 | 可增量投影热点字段，不做全量固定列 |
| ADR-068 | 旧单品编辑、批量组装、草稿模板和导入路径仅在 ERP-23 零运行时引用后退役 | ACCEPTED | 防止误删仍运行路径或保留第二写 owner | 紧急安全封禁可提前关闭入口，但仍需可恢复归档 |
| ADR-069 | Publish Worker 是唯一真实 SHEIN 商品发布写 owner | ACCEPTED | 消除 Browser/Control/脚本多写路径和结果解释漂移 | 不可放宽；只能更换唯一执行服务实现 |
| ADR-070 | PublishCommand 必须绑定 immutable ProductVersion | ACCEPTED | 保证执行 payload 可重现，不受 Draft 后续编辑影响 | 不可回退到 mutable Draft；可扩展 VersionItem |
| ADR-071 | PublishBatch、Attempt、Command、Receipt、reconciliation 和 official review 分离建模 | ACCEPTED | 分开用户意图、执行、证据、核对和平台业务状态 | 可调整表名，不可重新合并语义 |
| ADR-072 | Command/Event/Outbox/Draft handoff 在一个 PostgreSQL 事务中提交 | ACCEPTED | 消除数据库提交与队列投递之间的命令丢失缝隙 | 可替换事务实现，不可降低原子 handoff |
| ADR-073 | PostgreSQL 是发布命令真相，BullMQ 只负责投递和唤醒 | ACCEPTED | Redis 丢失或队列重启不能改变商业事实 | 可替换投递系统，不可把队列变为唯一真相 |
| ADR-074 | 每个 PublishCommand 对应一条 Queue Job，jobId 使用 commandId | ACCEPTED | 建立逐项幂等、恢复、公平、诊断和背压边界 | 批量可共享 batchId，不得恢复单 Job 抽干整批 |
| ADR-075 | 商品发布 Queue 固定 attempts=1，安全重投由 Command/Outbox 状态控制 | ACCEPTED | 外部写请求无法靠通用队列重试保证不重复 | 只有 SHEIN 提供可验证平台幂等键后重新评审 |
| ADR-076 | 调用 SHEIN 前必须持久化 send_started，作为不可盲重试边界 | ACCEPTED | 区分未发送崩溃与可能已发送崩溃 | 可细化阶段，不可取消边界证据 |
| ADR-077 | result_unknown 永不自动重新发布，只走 Webhook/官方只读查询核对 | ACCEPTED | 防止 SHEIN 已接收但本地丢回执时重复商品 | 不可放宽；新写需先取得“未接收”充分证据并人工确认 |
| ADR-078 | known_failed 再次发布创建新的 child Attempt/Command，并重新预检和确认 | ACCEPTED | 重试也是新商业动作，必须保留父关系和新版本证据 | 可复用同 ProductVersion，但不得复用旧 Command |
| ADR-079 | accepted 必须具有完整官方接收身份/证据；成功码但身份不完整归 result_unknown | ACCEPTED | 杜绝 HTTP/本地成功被误报为平台接收 | 证据字段只随官方契约加强，不可降为 HTTP 200 |
| ADR-080 | PublishReceipt 与 CommandEvent 追加式、幂等保存，current projection 可重建 | ACCEPTED | 支持乱序、重复、审计和故障恢复 | 可增加归档层，不可覆盖原始事件 |
| ADR-081 | 一次空回读不能证明 SHEIN 未接收，也不能自动开放新 Attempt | ACCEPTED | 平台索引延迟、查询覆盖和权限错误均可能返回空 | 只有正式证据等级和时间窗通过 ADR 修订后调整 |
| ADR-082 | mixed batch 必须展示 eligible/blocked，用户显式确认后才能发布 eligible 子集 | ACCEPTED | 避免系统静默代选或一个 blocker 错误失败整批 | 可调整确认 UI，不可取消逐项预览 |
| ADR-083 | 批次部分成功按单项结果展示，aggregate 不覆盖单项状态 | ACCEPTED | 商业动作和恢复以商品级证据为准 | 不可用批次 completed/failed 改写单项 |
| ADR-084 | pause/cancel 仅作用于 send_started 前 Command | ACCEPTED | 外部写开始后本地无法撤回平台请求 | 平台未来提供正式撤回接口时另建独立命令 |
| ADR-085 | 发布提交采用快速 202 + 当前 operation 专属 SSE | ACCEPTED | durable handoff 与 2～3 秒反馈解耦，避免长 HTTP 轮询 | SSE 可换 WebSocket/短轮询，但不得让创建请求等待终态 |
| ADR-086 | SSE/Redis 只是反馈优化，事件真相留在 PostgreSQL，断线可续读 | ACCEPTED | 实时通道故障不能改变或丢失发布结果 | 可替换推送技术，不可降低可恢复性 |
| ADR-087 | 发布链不增加每 30 秒自动同步或切店自动 SHEIN 调用 | ACCEPTED | 用户明确要求，避免状态竞争和限流风暴 | 未来需新业务指标、调度 owner 和单独 ADR |
| ADR-088 | 每店默认一个在飞发布请求，跨店公平和全局并发以压测定稿 | ACCEPTED | 当前 2 核 4GB 与平台限流需控制事故半径 | 数值可按正式压测调整，公平与有界原则不可取消 |
| ADR-089 | 商品 accepted 与合规照片/复验使用独立命令和状态 | ACCEPTED | 附属流程失败不能抹掉主商品已接收事实 | 可共享 operation 视图，不可共享结论状态 |
| ADR-090 | 当前继续使用 PostgreSQL + Redis + BullMQ，不引入 Kafka、Debezium、Temporal 或新队列 | ACCEPTED | 现有规模先补事务断点，避免基础设施扩张增加风险 | 出现量化容量/恢复瓶颈并完成迁移评审后重审 |
| ADR-091 | Webhook、document-state、SPU readback 和补偿查询统一进入 OfficialEventInbox/Normalizer/Resolver/Reducer | ACCEPTED | 消除多套同步 owner 和来源间不同归并语义 | 官方新增来源且完成同一 envelope/fixture 接入评审后扩展 |
| ADR-092 | 官方 raw event 与 normalized receipt 均追加式保存，不原地改写历史证据 | ACCEPTED | 支持审计、重放、source map 升级和差异解释 | 法规保留政策要求脱敏/删除时走独立治理流程 |
| ADR-093 | Attempt 关联只接受 store-scoped exact match；unmatched/conflict 不进入正常页签 | ACCEPTED | 错配比暂时缺失更致命，必须 fail closed | 新官方稳定身份字段可提高匹配证据但不能降低作用域 |
| ADR-094 | CurrentReviewPointer 显式持久化，并由 parent/supersedes 与官方证据推进 | ACCEPTED | 禁止按更新时间、最新 version 或最新行猜当前尝试 | 领域模型整体替换且有等价不变量证明时重审 |
| ADR-095 | command execution、reconciliation 和 official review 使用三个正交状态投影 | ACCEPTED | 同一个 completed 无法表达发送、核对与审核事实 | 不合并；新增维度只能保持独立 |
| ADR-096 | 业务只使用稳定审核 code 和 mapVersion，中文/多语言文案不得参与分类 | ACCEPTED | 文案变化不应改变状态机 | SHEIN 原始字典变化时新增 mapVersion 和 fixture |
| ADR-097 | `needs_action` 是跨域运营原因聚合，不是 SHEIN 官方状态 | ACCEPTED | 用户需要行动入口，但不能污染官方事实 | 只扩展 reasonCode/allowedActions，不改官方状态字典 |
| ADR-098 | receipt、match、projection、current pointer 在一个 PostgreSQL 事务中提交 | ACCEPTED | 杜绝回执与当前状态单边成功 | 数据量证明需异步化时也必须以 durable event + 原子 revision 保证一致性 |
| ADR-099 | ReviewReducer 对同一 Attempt 单调、幂等并显式处理乱序、终态和新 Attempt | ACCEPTED | 迟到事件不得让当前状态倒退 | 官方证明状态可逆时按新 mapVersion 增加明确转换，不做通用覆盖 |
| ADR-100 | Review Center Snapshot 在同一数据库一致性事务读取，不在请求内调用 SHEIN | ACCEPTED | counts、rows 和资格必须可对账且延迟可控 | 只读副本具备可证明一致性版本后可替换读取节点 |
| ADR-101 | counts、rows、eligibility、freshness、sourceHealth 与 snapshotRevision 由同一谓词/版本返回 | ACCEPTED | 消除计数 0、列表有数据和隐藏选择 | 不拆成独立前端请求 |
| ADR-102 | 浏览器不维护审核业务 reducer，只渲染 Snapshot code/allowedActions | ACCEPTED | 结束多端状态机漂移 | 纯展示派生允许，但不得改变分类、资格或计数 |
| ADR-103 | 手动刷新由后端 Refresh Operation 统一解析目标、去重、限流和落 Inbox | ACCEPTED | 防止浏览器 fan-out、竞态和 QPS 风暴 | 不允许页面恢复逐版本 SHEIN 调用 |
| ADR-104 | 不做 30 秒、进页、切店、窗口聚焦自动同步；仅活动 operation 短时 SSE/轮询 | ACCEPTED | 用户已明确只需手动刷新，并需控制平台限流 | 有量化业务需求和 QPS 预算后另开 ADR |
| ADR-105 | 一次空 readback 只表示该查询未取得记录，不证明从未接收或可重发 | ACCEPTED | 避免空结果制造重复发布 | 官方 endpoint 给出强否定语义且契约可验证时按来源单独升级证据等级 |
| ADR-106 | 部分来源失败保留 last-known-good，返回 partial/stale/source health，不输出假 0 | ACCEPTED | 可用性降级不能篡改业务事实 | 超过保留策略后仍显示 unknown/stale，不自动清空为 0 |
| ADR-107 | 行动态移出由 projectionRevision + Snapshot/SSE 驱动，不乐观伪造官方状态 | ACCEPTED | 既要 2–3 秒反馈，也必须避免伪发布/伪审核 | 仅本地命令排队状态可即时展示，官方状态仍等证据 |
| ADR-108 | 归档/隐藏属于 ReviewCenterPreference，不修改官方 Projection 或 timeline | ACCEPTED | 运营视图偏好与官方事实必须分离 | 合规保留政策另行处理，不复用归档动作 |
| ADR-109 | MediaAsset 表示不可变原始内容，业务用途/顺序/所有权由 MediaReference 表达 | ACCEPTED | 同一文件可安全承担多个角色且不污染生命周期 | 不回退到 Asset purpose 驱动业务行为 |
| ADR-110 | 裁剪、压缩、水印、缩略图和标准化结果使用不可变 MediaVariant | ACCEPTED | 保留原图并可重现每个发布结果 | 只允许新增 transform type/version，不原地覆盖 Variant |
| ADR-111 | 浏览器通过短期预签名 URL 直传私有对象存储，Control API 不转发上传字节 | ACCEPTED | 降低服务器内存/带宽并保持密钥隔离 | 仅对象存储不可用且有正式替代架构时重审 |
| ADR-112 | 客户端 hash 仅作提示，ready 必须由对象 checksum 或服务端 Verifier 证明 | ACCEPTED | 浏览器输入不能成为资产完整性的最终授权 | 存储原生 checksum 能力改变时可替换验证实现，不降低证据等级 |
| ADR-113 | 不进行跨 tenant 逻辑去重/共享；同 tenant 复用仍受 scope 与 capability 约束 | ACCEPTED | 防止 hash/存在性和内容跨客户泄露 | 物理层去重必须对应用完全不可见才可另评审 |
| ADR-114 | 资产作用域采用 tenant_shared/store_private/user_private/compliance_locked | ACCEPTED | 覆盖素材库、商品、个人创作和合规的真实边界 | 新 scope 必须有权限矩阵和迁移方案 |
| ADR-115 | Draft handoff 先同事务冻结 VersionMedia，再释放 Draft Reference | ACCEPTED | 保证历史提交媒体所有权连续 | 不允许异步“稍后补引用”作为正常路径 |
| ADR-116 | Publish Worker 只从 immutable ProductVersion MediaReference 解析图片 | ACCEPTED | 发布内容必须可重现，不受 Draft/Template 后续变化影响 | 无例外 |
| ADR-117 | SHEIN 图片上传结果进入 store-scoped PlatformMediaReceipt | ACCEPTED | URL/MD5/imageType/trace/contractVersion 需要独立账本 | 不以候选 JSON 或 URL 作为唯一真相 |
| ADR-118 | PlatformReceipt 复用键包含 variantHash、imageType 和 adapterContractVersion，跨店不复用 | ACCEPTED | 防止错误类型、旧合同和跨身份复用 | 官方证明更强稳定标识后可加字段，不删现有键 |
| ADR-119 | 业务 role 与 SHEIN imageType 分离，由服务端版本化 Adapter 映射 | ACCEPTED | 页面/Asset 不应直接承担平台契约语义 | imageType 变化通过新 contractVersion 处理 |
| ADR-120 | Reference/RetentionHold/active operation 是删除安全真相，reference_count 只作投影 | ACCEPTED | 缓存漂移不能授权不可逆删除 | 性能优化只能加索引/投影，不降低事务反查 |
| ADR-121 | 普通删除进入回收站；物理对象删除保留 tombstone 和 MediaDeletionEvent | ACCEPTED | 支持恢复、幂等和商业审计 | 法规要求立即删除时走独立审批/证明流程 |
| ADR-122 | published ProductVersion、PlatformReceipt 和合规审计建立显式 RetentionHold | ACCEPTED | 草稿/模板引用释放不能危及正式证据 | 只按批准保留政策解除 hold |
| ADR-123 | 建立独立素材中心，同时向业务页面提供统一嵌入式 MediaPicker/UploadQueue | ACCEPTED | 治理与高频工作流都需要，不应二选一 | 不允许各页面恢复独立上传 owner |
| ADR-124 | 普通商品图先采用预签名 PUT；没有量化需求不引入 tus/multipart | ACCEPTED | 避免基础设施过度设计 | 超大文件/弱网数据达到阈值后另开 ADR |
| ADR-125 | 原图字节不进入 Draft JSON、React State 或 TanStack Query Cache，列表只使用 preview/thumbnail | ACCEPTED | 控制内存、序列化和数据泄露 | 临时单图 object URL 可用，但离开视图必须释放 |
| ADR-126 | AI/媒体处理使用独立临时 role/scope，用户选择后才进入业务 Reference | ACCEPTED | 可选能力失败不能污染商品和正式证据 | 不把 Provider 状态写入 Asset 业务用途 |
| ADR-127 | 跨店模板媒体通过规范 MediaShareGrant/Reference 访问，专项可见性路由逐步退役 | ACCEPTED | 统一授权、审计和撤销模型 | 旧路由在零引用证明前保持兼容只读 |
| ADR-128 | 历史媒体迁移只采用证据驱动分类，unknown/missing/conflict 不伪造 hash、Variant 或 Receipt | ACCEPTED | 防止清理和发布建立在假证据上 | 人工补证必须有受控 Run 和审计 |
| ADR-129 | AI 标题是可选辅助能力，人工标题/A0 不依赖 Provider、Redis 或 AI Worker | ACCEPTED | 可选服务故障不能阻断商品主链 | SHEIN 将特定 AI 服务列为官方强制依赖且有可验证契约时重审 |
| ADR-130 | 版本化 TitlePolicyEngine 是标题合法性的唯一权威，模型自评不能覆盖确定性 blocker | ACCEPTED | 长度、事实、禁词和语言需要可测试、可重现 | 规则实现可替换，权威边界不可下放模型 |
| ADR-131 | 每次 AI 生成冻结 Draft revision、商品事实、模板/Policy 和 MediaVariant 输入 | ACCEPTED | 候选必须可重现且不能读取变化中的 Draft | 只允许增加快照字段，不读取 mutable 当前态替代 |
| ADR-132 | AI Request/Event/Outbox 在一个 PostgreSQL 事务持久化，BullMQ 只负责投递 | ACCEPTED | 刷新、重启、Redis 丢失不能丢用户任务 | 可替换队列技术，不把队列/浏览器变为唯一真相 |
| ADR-133 | 一 TitleGenerationRequest item 对应一 Queue Job，批量页面不再是调度唯一 owner | ACCEPTED | 建立逐项恢复、幂等、公平和诊断边界 | 批次可共享 batchId，不恢复一个浏览器循环抽干整批 |
| ADR-134 | Provider 调用前持久化 send_started，发送后超时标 result_unknown/cost_unknown 且不自动重试 | ACCEPTED | 防止重复计费和不可解释用量 | Provider 提供可验证幂等键时可按 Adapter 单独评审 |
| ADR-135 | AI 只生成 2～3 个候选，不直接写 Draft；默认选择是保留当前标题 | ACCEPTED | 用户决定和模型建议必须分开 | 候选数量可按质量数据调整，禁止自动无确认覆盖 |
| ADR-136 | 候选先由 TitlePolicyEngine 验证和可解释排序，模型 confidence 不能覆盖 blocker | ACCEPTED | 合规和事实正确性高于模型自信 | 排序权重可版本化，blocker 权威不变 |
| ADR-137 | 用户采用/编辑/拒绝形成 TitleDecision；采用创建受控 Draft revision/patch 并可撤销 | ACCEPTED | 防止 AI 无审计改值并保留人工意图 | UI 可调整，不取消 Decision/provenance/undo 语义 |
| ADR-138 | 手工标题优先于已生成候选和模板，旧 revision 候选不得覆盖新内容 | ACCEPTED | 多标签页和延迟结果不能损坏用户工作 | 用户显式确认基于新 revision 重用时例外 |
| ADR-139 | 视觉识别缓存与最终候选缓存分离并使用语义完整的版本化键 | ACCEPTED | 图片识别可复用但标题候选还依赖当前文本/事实/规则 | 缓存技术可替换，键语义和重验不可降低 |
| ADR-140 | AI 图片输入只使用受控不可变 MediaVariant/variantHash 和短时访问 | ACCEPTED | 控制内容、权限、内存和复用正确性 | Provider 输入方式可变，不使用任意 URL/长期 Base64 缓存 |
| ADR-141 | Provider 通过注册的版本化 Adapter/Profile 接入，API Key 加密且出站网络 fail closed | ACCEPTED | 任意兼容 URL 不足以形成商业安全边界 | 新 Provider 只能新增 Adapter/Profile，不旁路策略 |
| ADR-142 | Prompt、输出 Schema、Adapter、模型和 TitlePolicy 均版本化并写入 Attempt | ACCEPTED | 历史建议、质量与成本需要准确重现 | 版本可归档，不得改写已执行版本语义 |
| ADR-143 | 不做隐藏 Provider failover 或偷偷降级模型；切换创建新 ProfileVersion 并展示 provenance | ACCEPTED | 质量、数据政策和成本不能暗中漂移 | 用户/管理员批准的显式路由策略可另开 ADR |
| ADR-144 | A3 批量由服务端 durable operation、公平有界调度和逐项 partial success 驱动 | ACCEPTED | 页面断线/重启不能丢进度，大店不能饿死其他店 | 并发数按压测调整，durable/fair/bounded 不变 |
| ADR-145 | AI 用量区分 actual、estimated 和 unknown，预算超限只阻断 AI | ACCEPTED | 财务口径不能把未知当 0，AI 不应拖停商品主链 | 计费模型可更新，不合并三种证据等级 |
| ADR-146 | AI 输入最小化，未在事实快照中的属性禁止生成，质量反馈默认不用于训练 | ACCEPTED | 降低幻觉、隐私和跨客户数据风险 | 训练用途必须独立授权、脱敏、可退出并审计 |
| ADR-147 | AI 单品/批量 UI 采用增量候选面板，不因模块修复重做全站导航或品牌视觉 | ACCEPTED | 保护已稳定界面并降低回归面 | 用户先批准新的完整设计与视觉基线后可调整 |
| ADR-148 | 旧同步 suggest、内存队列/缓存和浏览器批量 Worker 只在零真实调用与两个稳定 release 后退役 | ACCEPTED | 避免迁移中修 A 坏 B 或产生双调用/双计费 | 紧急安全封禁可提前关闭，但仍需可恢复归档与对账 |
| ADR-149 | 商品合规是独立领域；不再用商品属性、发布状态或一个中文万能状态承载全部合规事实 | ACCEPTED | 要求、材料、执行、平台审核和来源健康具有不同生命周期 | UI 可聚合展示，但规范事实与状态维度不得重新合并 |
| ADR-150 | 当前 SHEIN 官方 RequirementSnapshot 是要求权威，并必须保留 raw source、mapVersion、覆盖率和 source health | ACCEPTED | 历史交接、本地算法和旧快照不能证明当前平台要求 | 官方提供更强事件合同可替换获取方式，不降低原始证据与版本追溯 |
| ADR-151 | ComplianceCase 以 tenant/store/target/requirement/official snapshot/revision 精确标识 | ACCEPTED | 防止同一商品多要求、同要求多目标和历史变更被一行状态覆盖 | 可增加维度，不得回退为仅按 SKC 或商品聚合 |
| ADR-152 | Requirement、Evidence、Execution、Platform Review 和 Source Health 使用五组正交状态 | ACCEPTED | 避免“待处理/完成”掩盖不同事实和允许动作 | 可细化枚举，不得以单一 status 替代规范维度 |
| ADR-153 | `needs_action`、`blocked` 等是带 reasonCode/allowedActions 的运营投影，不是新的真相状态 | ACCEPTED | 页面需要简洁，但必须可解释并可从事实重建 | 投影算法可版本化，不能覆盖底层事件或官方回执 |
| ADR-154 | 材料复用只由 MaterialRole、Applicability、当前官方要求、scope 和有效期决定 | ACCEPTED | 模板、同 hash 和历史通过都不足以证明当前目标可用 | 官方明确允许的复用可编码为版本化 applicability rule，不复制审核结果 |
| ADR-155 | 1630/1631 仅采用当前 SKC 官方返回类型并逐 SKC 管理；本地尺寸、模板和历史商品不得推导 | ACCEPTED | 错误报告类型会直接导致 SHEIN 驳回且历史曾出现边界漂移 | 只有 SHEIN 发布新的正式合同并提供可验证规则时重审 |
| ADR-156 | 本体图与包装图使用独立 role、labelGroup、顺序、目标和 Receipt；不得互填或以通用合规图片替代 | ACCEPTED | 两类证据回答不同官方要求并有不同绑定语义 | 官方合同变更时通过 Adapter/mapVersion 迁移，不覆盖历史 Receipt |
| ADR-157 | 证书、报告和实拍图的上传、保存/创建、绑定、审核及回读分别形成 Attempt/Receipt | ACCEPTED | 多步外部流程会部分成功，必须可恢复和对账 | 平台提供真正原子接口时可合并执行，但历史阶段证据仍保留 |
| ADR-158 | 代理资料是版本化独立材料，包含主体、市场、type/range、有效期和逐目标适用性 | ACCEPTED | 代理授权不等于普通证书或商品属性，失效范围也不同 | 法务/平台合同可扩展字段，不得用自由文本替代核心范围 |
| ADR-159 | 警示语使用当前官方 schema 和版本化 mapping/exclusion 规则，不与标题、描述或普通属性混用 | ACCEPTED | 不同市场/类目存在互斥、必填和排除关系 | 文案可本地化，规范代码和官方语义不可由 UI 自由编辑 |
| ADR-160 | CompliancePreflight 是真实合规命令/人工交接的确定性权威，冻结输入并输出稳定错误路径 | ACCEPTED | 浏览器提示和可变表单不能授权外部写或保证可重现 | 实现可替换，服务端权威、冻结输入和版本化输出不可取消 |
| ADR-161 | pre-SKC 与 post-SKC 合规门禁分离；SKC 生成/官方回读后只打开或复验后置 Case，不自动写 SHEIN | ACCEPTED | 无平台目标时不能预造完成，自动写会扩大副作用 | 若官方支持提交前目标可按正式合同新增阶段，不伪造 SKC |
| ADR-162 | 商品 accepted 是独立且单调的发布事实，合规失败不得将其改写为发布失败或驳回 | ACCEPTED | 防止重复发品和伪发布/伪失败循环 | 官方明确撤销商品时以新的官方商品事件处理，不由本地合规错误推断 |
| ADR-163 | 每个真实合规动作使用持久 ComplianceCommand/Event/Outbox 且一 Command 一 Queue Job | ACCEPTED | 同步 HTTP、浏览器和批次 Worker 都不能成为唯一调度真相 | 可替换队列，不把 durable owner 移回内存或客户端 |
| ADR-164 | 合规外部调用前持久化 send_started；发送后未知进入 result_unknown，禁止通用自动重试 | ACCEPTED | 防止重复上传、绑定和平台冲突 | Adapter 提供可验证幂等键后可针对该 action 独立放宽 |
| ADR-165 | API 不支持的 GCC/产品标识符等动作只创建 ManualComplianceTask，人工声明不等于平台完成 | ACCEPTED | 商业系统必须诚实表达 API 能力边界并保留责任链 | 平台开放正式 API 后以新 Adapter/Command 替代，不回写伪历史回执 |
| ADR-166 | 合规工作台列表、计数、详情和批量资格来自同一 Snapshot，并采用渐进嵌入式 UI 而非全站改版 | ACCEPTED | 解决状态矛盾和隐藏选择，同时保护现有导航/品牌界面 | 用户批准完整设计和视觉基线后可调整外观，不改变一致快照语义 |
| ADR-167 | 合规“已绑定/审核中/已通过”只由官方 Receipt、Webhook 或主动回读证据驱动 | ACCEPTED | HTTP 200、上传成功、预检通过和人工勾选都不能证明平台结果 | SHEIN 提供更强签名事件时可提升证据等级，不降低证据门槛 |
| ADR-168 | 合规继续以手动刷新为主，不增加 30 秒、进页、切店或窗口聚焦自动同步 | ACCEPTED | 用户明确要求且可避免请求风暴、竞态和错误跨店刷新 | 有明确业务指标和单一服务端 owner/限流设计后另开 ADR 评审 |
| ADR-169 | 销量库存板块是经营事实与决策域，不只是 Dashboard UI | ACCEPTED | 商业决策需要来源、质量、历史、公式和责任闭环 | 页面布局可变，事实/指标/决定边界不得回退为卡片拼装 |
| ADR-170 | SHEIN 官方事实、本地衍生指标、人工规划参数和运营决定四层分离 | ACCEPTED | 防止本地建议覆盖平台值或人工输入被误认成官方事实 | 可增加层内实体，不得合并证据等级 |
| ADR-171 | 每个经营值携带 quality/source/cutoff/capturedAt/coverage/contractVersion；unknown/partial/stale/not_applicable 与 0 分离 | ACCEPTED | 没有覆盖证明的数字不能进入商业汇总 | 字段实现可优化，质量语义和 confirmed zero 门槛不可降低 |
| ADR-172 | SKU 是销量与库存最小经营粒度，SKC/SPU/店铺只做有 SKU 集合版本和覆盖率证明的聚合 | ACCEPTED | 地毯不同尺寸销量、库存和备货风险不同 | 官方提供更细粒度时可向下扩展，不用模糊同款替代稳定 SKU |
| ADR-173 | 当前 SKU 销量保存为 today/yesterday/rolling7/rolling30 窗口事实，不反推逐日销量或伪历史曲线 | ACCEPTED | 聚合窗口不足以唯一还原每日序列 | 只有持续采集或官方日事实可新增趋势，不改写历史窗口 |
| ADR-174 | 可用、总量、正式锁、临时锁、在途、缺货需求和 warehouse 明细分别建模 | ACCEPTED | 各字段业务含义、可操作性和风险不同 | 官方合同可新增库存维度，不重新合成一个 inventory 万能值 |
| ADR-175 | 部分 SKU 已知时只展示 known subtotal + coverage，不能把子集和称为完整商品/店铺总量 | ACCEPTED | 在途等可选字段并非每个目标都有返回 | UI 可选择隐藏小计，但不可去掉 partial 证据 |
| ADR-176 | 库存查询迁移到 `invType=PI`；`warehouseType` 仅作有期限兼容并在 2026-12-31 前零运行时依赖 | ACCEPTED | SHEIN 官方已公布 warehouseType 退役日期 | 官方延期可调整期限，目标合同仍以 invType 为准 |
| ADR-177 | 经营刷新保持用户手动触发和服务端单一 Operation owner；Scheduler、进页、切店、聚焦和 30 秒自动刷新关闭 | ACCEPTED | 用户明确要求且避免多 owner、QPS 风暴和跨店竞态 | 只有独立业务批准、容量证明和新 ADR 才能启用定时策略 |
| ADR-178 | Webhook 只生成经营事件、AlertCase 或 dataset dirty 标记，不直接覆盖库存事实或自动发起全量查询 | ACCEPTED | 推送事件与时点库存读回证据不同，自动读取扩大副作用 | 某事件提供完整签名库存事实时可按事件合同单独升级证据等级 |
| ADR-179 | 连续历史只来自真实持久的日/时点事实；漏采日期保留缺口，不插值、不补零 | ACCEPTED | 经营趋势必须可审计，人工补齐会制造假数据 | 经批准的外部历史导入可作为独立来源并保留 provenance |
| ADR-180 | 所有衍生指标由版本化 MetricDefinition 确定性计算并传播输入质量 | ACCEPTED | 公式、单位、粒度、舍入和 freshness 必须可重现 | 指标版本可升级，不覆盖历史定义与结果 |
| ADR-181 | 在途无 ETA 时不默认进入基础可售天数；可单独展示含在途库存位置及其假设 | ACCEPTED | 在途数量不证明会在补货窗口前到仓 | 获得可靠 ETA/采购履约事实后可由 PolicyVersion 明确纳入 |
| ADR-182 | 现有 `max(0, sales7-available)` 只称 7 日基础缺口，不称智能或完整备货建议 | ACCEPTED | 它缺少供应周期、安全库存、MOQ、包装和生命周期 | 兼容字段可保留，名称、证据等级和执行边界不可夸大 |
| ADR-183 | 商业备货建议使用版本化 ReplenishmentPolicy，纳入 lead time、安全库存、MOQ、包装倍数、生命周期和地毯尺寸特性 | ACCEPTED | 不同尺寸/产品阶段的资金占用和断货风险显著不同 | 策略参数可按业务数据调整，必须保留公式分解和人工决定 |
| ADR-184 | 经营预警使用版本化 AlertRule 和持久 BusinessAlertCase，支持 owner/SLA/确认/稍后/解决/复发 | ACCEPTED | 临时快照卡片不能承担责任、去重和复盘 | 通知渠道可增加，不取消案件事实和事件历史 |
| ADR-185 | 数据质量预警与库存/销量业务预警分离；unknown 不得触发确认零库存/零销量 | ACCEPTED | 来源故障与真实经营异常需要不同动作和责任人 | 可在 UI 同页汇总，规则和案件类型不得混为一体 |
| ADR-186 | 多店只聚合同指标版本、单位、经营模式和可比 cutoff，并显示覆盖率、unknown 和 cutoff skew | ACCEPTED | 不同时间和口径相加会产生伪精确经营结论 | 用户可显式选择共同截止或最新视图，但差异必须可见 |
| ADR-187 | 官方未开放的曝光、访客、点击、加购、转化率不推造；缺真实价格/成本/结算/退货时不计算 GMV、利润或 ROI | ACCEPTED | 当前全托管 API 能力不足以支持这些事实 | 正式 API/财务模块提供可核验证据后以新指标版本接入 |
| ADR-188 | 本板块默认只读，不提供库存更新、上下架、采购、备货单或自动补货执行；旧 JSON/预警 owner 渐进退役 | ACCEPTED | 分析和执行必须隔离，避免建议直接变外部副作用 | 后续采购/履约板块可消费 Recommendation，但必须建立独立 Command/权限/回执 |
| ADR-189 | 履约采用“双模式”：SHEIN 下发采购单和人工计划驱动手工备货分别建模，最终汇入同一发货/到仓闭环 | ACCEPTED | 两种需求来源和责任不同，但后续仓储物流能力可共享 | 平台经营模式变化可新增模式，不合并内部计划与官方单据 |
| ADR-190 | Recommendation 只能创建 ReplenishmentPlan Draft，任何 SHEIN 备货/发货写都需要人工审批和再次确认 | ACCEPTED | 经营建议不是平台指令，自动执行会造成库存和资金风险 | 未来自动化必须有独立业务批准、风险数据和新 ADR，默认仍人工控制 |
| ADR-191 | 内部 Plan、官方 PurchaseOrder、ShippingPlan、官方 DeliveryOrder、Package、Artifact 和 ExceptionCase 是独立对象 | ACCEPTED | 各对象身份、来源、状态和证据不同 | UI 可聚合展示，不得恢复万能 order/status |
| ADR-192 | SKU 是履约数量最小粒度，need/order/plan/delivery/receipt/storage/defective 分别进入追加式 Quantity Ledger | ACCEPTED | 尺寸级数量和各阶段差异决定真实履约 | 平台提供更细粒度可扩展，缺失不得补 0 或相互覆盖 |
| ADR-193 | 采购/JIT/发货官方 code 与 Receipt 是状态权威；中文名称、命令完成和打印成功仅为展示/本地事实 | ACCEPTED | 防止履约伪成功和语言文案漂移 | 官方发布版本化新状态合同后更新 map，不降低证据门槛 |
| ADR-194 | 采购/发货手动刷新由单一服务端 Operation owner 执行；Scheduler、进页、切店、聚焦和 30 秒自动同步关闭 | ACCEPTED | 用户明确要求并避免多 owner、QPS 风暴和跨店竞态 | 有独立批准和容量/限流证明后另开 ADR；默认不启用 |
| ADR-195 | 履约 Webhook 只落不可变 Inbox、关联候选和标 source dirty，不自动读取全部店铺或触发平台写 | ACCEPTED | 事件与完整单据回读证据不同，自动动作扩大副作用 | 官方事件提供完整签名事实时可提升该事件证据等级，不自动写 |
| ADR-196 | 合单/可发资格由版本化服务端 ShippingEligibilityEngine 决定并绑定当前 Receipt/Option/Snapshot revision | ACCEPTED | 采购类型、仓、市场、标签、JIT、SKU 与数量规则复杂且会变化 | 规则可升级，旧 revision 失效和稳定 blocker 语义不可取消 |
| ADR-197 | 地址、仓库、物流、货代、收货仓和预约使用带来源/有效期的 Option Snapshot，禁止硬编码名称或示例 ID | ACCEPTED | 平台选项按店铺、地址、场景和时间变化 | 可优化缓存，不允许 stale 选项授权新写 |
| ADR-198 | ShippingPlan 与 PackagePlan 使用不可变 Revision；已 handoff 版本只能通过新修改/取消 Command 变化 | ACCEPTED | 覆盖历史计划会使数量、标签和平台回执无法重现 | 平台提供原子修订接口时仍保留前后 Revision 和 Receipt |
| ADR-199 | 地毯包装按尺寸 SKU 管实重、体积重、箱规、折叠/卷装/压缩和包材，缺实测参数保持 unknown | ACCEPTED | 大小尺寸物流、破损、折痕和资金风险显著不同 | 可按实测和物流规则升级参数，不用 SKC 平均值回退 |
| ADR-200 | 所有履约平台写使用持久 Command/Event/Outbox、一 Command 一 Job、lease 和每店公平调度 | ACCEPTED | 浏览器、同步 HTTP 和 Redis 不能成为唯一执行真相 | 可替换队列，不把 durable owner 移回客户端或内存 |
| ADR-201 | SHEIN 调用前持久化 send_started；发送后未知进入 result_unknown、锁定业务键并禁止通用自动重试 | ACCEPTED | 防止重复备货、重复发货或重复取消 | Adapter 有可验证平台幂等键时按 action 单独评审，不全局放宽 |
| ADR-202 | 创建、修改、取消、手工备货和标签按 action/contract/store/capability/canary 独立开放 | ACCEPTED | 一个接口成功不能证明其他高风险动作安全 | 每个动作通过合同、fixture、故障注入和生产金丝雀后单独放量 |
| ADR-203 | 官方主动读、Webhook 和命令 Receipt 统一进入 Inbox/Normalizer，receipt/match/projection/pointer/ledger 单事务提交 | ACCEPTED | 多来源和部分写失败会造成单据、状态和数量分裂 | 存储实现可变，但 append-only、可重放和原子投影不可取消 |
| ADR-204 | 商品条码、箱唛/包裹面单、发货面单和物流面单分别建模并版本绑定；打印不改变官方履约状态 | ACCEPTED | 不同文件目标、有效期和平台语义不同 | 新 ArtifactType 可增加，不合并为通用 label 成功状态 |
| ADR-205 | 数量、物流、标签和到仓差异使用持久 FulfillmentExceptionCase，不自动补发、退货、改库存或关闭 | ACCEPTED | 异常需要责任、SLA、证据和人工商业判断 | 可增加自动提醒，不增加无确认平台写 |
| ADR-206 | 履约 selection 只绑定当前 tenant/user/store/filter/snapshot/eligibility 的可见 eligible 集合，跨店写默认不存在 | ACCEPTED | 防止隐藏选择、4 条提交 15 条和跨店事故 | 跨页选择可显式实现，但必须目标数/影响预览和服务端重验 |
| ADR-207 | 履约工作台渐进加入现有 V2 壳，不因新板块重做全站 UI、品牌或已稳定业务流程 | ACCEPTED | 项目历史存在修 A 坏 B 和意外前端重做 | 用户批准独立视觉方案和回归基线后可改外观，不改事实边界 |
| ADR-208 | 首期平台写从一个店铺一个采购单的一次创建发货单金丝雀开始；完整回读、标签、到仓和数量对账后才扩动作 | ACCEPTED | 履约写涉及数量、物流和处罚，必须证明全链而非接口 200 | 用户可选择 canary 目标，不能跳过动作级证据与回滚门 |
| ADR-209 | 退货/报废、质量、责任、申诉和财务影响采用独立对象与正交状态，不建立万能 afterSaleStatus | ACCEPTED | 各链来源、责任和完成证据不同，合并会制造伪成功 | UI 可聚合时间线，不得共享可覆盖彼此的状态字段 |
| ADR-210 | 退货与报废是追加式逆向事实，不反向修改采购、发货、到仓、入库或次品历史 | ACCEPTED | 正向履约是已发生事实，逆向动作只能新增事件 | 可生成对账/库存建议，不直接覆盖历史 Ledger |
| ADR-211 | SKU 是逆向数量最小粒度；预计退货/报废、实际出库/退回/报废、包裹和签收分别记录 | ACCEPTED | 尺寸级数量和处理阶段决定真实损失 | 平台提供更细粒度可扩展，缺失不补 0 或相互覆盖 |
| ADR-212 | 退货与财务主动读、Webhook 和核准导入统一进入 ReverseSourceInbox/Receipt，保留窗口、覆盖和 LKG | ACCEPTED | 多来源、分页和空结果必须可重放、可解释 | 存储实现可替换，不取消 raw/coverage/version/quality |
| ADR-213 | 退货读取按最多 60 天窗口、财务报告按最多 7 天窗口切片；confirmed empty 必须有完整覆盖证明 | ACCEPTED | 当前官方合同有窗口限制，空响应不证明业务为空 | 官方限制变化时更新 contractVersion 和 fixture |
| ADR-214 | 平台原始退货原因与财务 replenishCategory 永久保留，内部分类和映射版本化，未知新值保持 unknown | ACCEPTED | 平台文本/分类会变化且影响责任与财务解释 | 可新增 taxonomy 版本，不回写 raw 或重写历史结论 |
| ADR-215 | 消费者售后正式合同未核准前保持 unsupported；只允许带 provenance 的最小人工登记/导入 | ACCEPTED | 解决方案目录不能证明 endpoint、身份、状态或隐私合同 | 恢复当前官方合同并通过 fixture/隐私/canary 后另行接入 |
| ADR-216 | 质量原因只生成责任候选，不自动定责、扣供应商款、停售、退款或关闭案件 | ACCEPTED | 同一现象可能来自商品、包装、仓库、物流、平台或预期 | 可提供评分辅助，最终决定与外部动作仍需明确授权 |
| ADR-217 | 质量证据使用独立 EvidenceRole、hash、来源、隐私、retention 和 legal/appeal hold；不与商品发布媒体用途混用 | ACCEPTED | 争议证据需要完整性、隐私和长期可追溯 | 可复用底层资产，不复用发布用途或普通清理策略 |
| ADR-218 | 退货/报废/确认/取件/申诉按 action/contract/store/capability/canary 独立开放，缺合同一律 fail closed | ACCEPTED | 目录权限或一个动作成功不能证明其他高风险动作安全 | 每个动作通过合同、fixture、故障注入和生产金丝雀后单独放量 |
| ADR-219 | 所有逆向平台写使用持久 Command/Event/Outbox、一命令一 Job、send_started 和 result_unknown 锁 | ACCEPTED | 浏览器/同步 HTTP/通用 retry 会造成重复退货或申诉 | 仅在平台幂等证据充分时按 action 评审重试，不全局放宽 |
| ADR-220 | 退货地址、处置、取件和承运选项使用带来源/有效期的 Option Snapshot；包裹与标签使用不可变 Revision | ACCEPTED | stale 地址/物流和旧标签会造成错退、丢失或拒收 | 可优化缓存，不允许 stale 选项授权新平台写 |
| ADR-221 | 同一业务单号/SKU 的多报告、多费用和跨账期扣款/补款全部保留为不可变 FinanceEntry，不覆盖 upsert | ACCEPTED | 官方明确可能拆分，后续申诉补款不能改写原扣款 | 可建立汇总视图，不删除或合并底层明细 |
| ADR-222 | 财务关联明确区分 matched、candidate、ambiguous、unmatched、reviewed 和 superseded，禁止标题/金额近似自动认领 | ACCEPTED | 误匹配比未匹配更危险，会扭曲损失与责任 | 唯一官方 ID/强组合键可自动 candidate，关账仍按风险复核 |
| ADR-223 | 官方已结算、待确认/结算、已发生未出账、内部预计和无法量化损失分层显示 | ACCEPTED | 证据等级与可用决策不同，混合会形成伪精确 | 口径可扩展，不把估计升级为官方事实 |
| ADR-224 | 不同币种无可审计汇率来源、时点和版本时不汇总；缺真实成本/结算/退货覆盖时不计算利润或 ROI | ACCEPTED | 任意汇率和缺项利润会误导经营 | 下一财务板块可建立正式 FX/Cost Ledger 后启用 |
| ADR-225 | CAPA 通过新商品/包装/质检/供应商版本和验证任务改善，不改写历史商品、采购、包装或履约事实 | ACCEPTED | 历史可重现是责任、财务和复发分析前提 | 允许新版本 supersede，旧版本与案件引用永久保留 |
| ADR-226 | 逆向 selection 只绑定当前 tenant/user/store/tab/filter/snapshot/eligibility 的可见 eligible 集合，跨店批量写默认不存在 | ACCEPTED | 防止隐藏选择、过期资格和跨店退货/申诉事故 | 跨页可显式实现，但必须影响预览、目标 token 和服务端重验 |
| ADR-227 | 逆向与财务继续手动刷新；Scheduler、进页、切店、聚焦和 30 秒自动同步关闭，Webhook 只落 Inbox/标 dirty | ACCEPTED | 用户明确要求且可避免 QPS 风暴、多 owner 和竞态 | 新批准必须先证明 owner、限流、容量与回滚，默认不启用 |
| ADR-228 | 逆向与质量工作台渐进加入现有 V2；首期先只读事实和案件协作，再单店单动作金丝雀 | ACCEPTED | 防止再次因业务修复重做前端，也降低不可逆退货/申诉风险 | 用户批准独立视觉方案或动作 canary 后逐项扩展，不跳过证据门 |
| ADR-229 | 第一阶段建设经营管理会计与平台结算控制台，不自称法定总账、税务申报或审计系统 | ACCEPTED | 当前来源和产品目标服务经营决策，不具备法定会计完整性 | 对接专业会计/税务系统并通过独立法规/审计设计后扩展 |
| ADR-230 | SHEIN `costPrice` 统一解释为供货价，不作为工厂成本、实际采购成本或结算收入 | ACCEPTED | 现有发布合同语义明确，混用会直接产生虚假利润 | 可新增明确 priceType，不得恢复含糊 cost 字段 |
| ADR-231 | 官方结算、商业价格、内部成本、票据/资金、计算结果和运营决定分层建模 | ACCEPTED | 各层证据、时间和可变性不同 | UI 可聚合，不允许上层覆盖底层事实 |
| ADR-232 | 财务金额采用追加式 Entry；冲销、更正、补款、write-off 和重算通过新事件/关系，不覆盖历史 | ACCEPTED | 同单可跨多报告/账期且月报必须可重现 | 可优化投影，不删除源 Entry 或旧 Snapshot |
| ADR-233 | SHEIN 财务 API/Webhook/核准导入统一进入 FinanceSourceInbox/Receipt，保存 raw、coverage、版本和 LKG | ACCEPTED | 列表/明细/分页和空结果必须可重放 | 存储实现可替换，不取消 provenance 和 quality |
| ADR-234 | 报账单读取按最多 7 天窗口切片；列表、销售款和补扣款明细分别证明覆盖，其他目录线索 unsupported | ACCEPTED | 当前官方合同和仓库证据边界如此 | 官方合同恢复/变化后更新 contractVersion 与 fixture |
| ADR-235 | CostLedger 区分 actual/estimated/accrual、direct/allocated，并保存来源、币种、数量/单位和生效版本 | ACCEPTED | 成本事实与估计/分摊的决策等级不同 | 可新增成本类型，不把 unknown 回填 0 |
| ADR-236 | 成本优先按 SKU/采购批次；地毯尺寸、面积、重量、体积和包装差异不得被 SKC 平均值抹平 | ACCEPTED | 大尺寸物流/包装/售后风险决定单位经济 | 无法精确归属时可明确待分摊，不伪精确 |
| ADR-237 | 共用成本使用版本化 AllocationRule/Run；没有合理 driver 时保持未分摊 | ACCEPTED | 强行平均分摊会误导商品利润 | 新 driver 生成新 Run/Snapshot，不回写旧结果 |
| ADR-238 | 原币种金额永久保留；所有换算引用 FXRateSnapshot/Policy 的来源、时点、用途和版本 | ACCEPTED | 跨币种无证据汇总不可审计 | 可选择正式 FX 数据源，不静默覆盖原值 |
| ADR-239 | 利润由不可变 ProfitDefinition/Snapshot 计算，分平台净收入、商品毛利和贡献利润并保存输入/coverage/quality | ACCEPTED | 同一“利润”口径可能不同，必须可解释可重现 | 可新增批准口径，不改变旧 Snapshot |
| ADR-240 | complete_actual、partial、estimated、stale、conflict、unknown 是利润一等质量；缺项不输出完整实际利润/ROI | ACCEPTED | 数字准确度与数据完整性同等重要 | 只有补齐证据后通过新 Snapshot 升级质量 |
| ADR-241 | SHEIN 已结算、Receivable、银行到账和核销使用独立对象与状态 | ACCEPTED | 平台结算不证明现金到账，部分收款也需表示 | 可聚合进度，不合并状态列 |
| ADR-242 | 供应商报价、采购/收货、账单、发票、Payable 和付款独立；计划/报价不自动生成实际应付 | ACCEPTED | 触发条件和争议处理不同，避免错误付款 | 由批准 Payable Policy 定义触发，不隐式推断 |
| ADR-243 | `invoice_status_notice` 未恢复正式合同前不投影；发票状态不自动确认收入、成本、应收应付或现金 | ACCEPTED | 只有事件名不足以证明状态和身份 | 合同、fixture、隐私和金丝雀通过后再接入 |
| ADR-244 | 资金流水通过核准导入/未来只读连接进入；余额必须显示 opening/transaction coverage，自动付款当前冻结 | ACCEPTED | 资金数据高风险且当前无银行合同 | 付款需独立安全架构、审批和 canary 后开放 |
| ADR-245 | 期间关闭冻结计算 revision，不冻结/删除源事实；晚到明细走调整期或受控 Reopen | ACCEPTED | 月报既要稳定又要接收真实晚到事实 | Reopen 保留旧关闭版本和影响审计 |
| ADR-246 | 多店/多主体财务只聚合同 Period、ProfitDefinition、FX Policy 和质量；主体间款项独立建模 | ACCEPTED | 不同主体、币种和口径不可直接比较 | 可增加合并规则，但需独立批准与抵销证据 |
| ADR-247 | 工厂成本、利润、银行、发票和供应商资料使用字段级 capability；付款/write-off/重开等高风险动作双人审批 | ACCEPTED | 普通店铺权限不足以保护高敏财务与资金 | 可按组织细化角色，不降低服务端门禁与审计 |
| ADR-248 | 财务工作台渐进加入现有 V2；先单店只读结算与影子利润，再扩协作/月结，付款执行不随 UI 上线 | ACCEPTED | 防止再次重做前端并避免利润/资金事故 | 用户批准逐阶段 canary 后放量，不跳过合同和对账门 |
| ADR-249 | 建立独立 Price Lifecycle 领域；审核中心只保留商品待核价摘要/跳转，不作为价格执行 owner | ACCEPTED | 商品审核与价格议价是不同业务事实，现有混合造成误分类和直接写风险 | 可调整页面入口，不把状态机和执行权重新塞回审核页面 |
| ADR-250 | SHEIN 供货价、平台建议价、商家报价、RRP、活动价、内部成本和结算收入使用强 PriceType | ACCEPTED | 同名 cost/price 的商业语义不同，混用会产生虚假利润与错误调价 | 可新增 PriceType，不允许弱化为万能 amount |
| ADR-251 | PriceFact/Revision 不可变，当前值使用显式 pointer 和 effective interval，不按更新时间猜最新 | ACCEPTED | 价格历史、审批、利润和回读必须可重现 | 可优化存储，不覆盖历史或丢 supersedes |
| ADR-252 | 商品工作流、议价、RRP、命令和价格生效为五套正交状态机 | ACCEPTED | 一个状态无法表达逐 SKU/site partial 与发送未知 | UI 可聚合摘要，底层状态和证据不能合并 |
| ADR-253 | 接受、拒绝与重新报价是三个独立动作合同；拒绝按不可逆高风险动作治理 | ACCEPTED | 官方语义和 payload 不同，拒绝会终止上架/报价机会 | 官方合同变化后版本化更新，不以通用改价取代 |
| ADR-254 | 议价读取永久保存 discussSn、类型、轮次、剩余次数、SKU 行与全部官方历史 | ACCEPTED | 当前动作资格依赖准确轮次和最新历史，0 次不能重报价 | 可归档冷历史，不删除审计与当前动作证据 |
| ADR-255 | 价格证明上传与业务提交分离，ProofItem 按用途、对象、site/round/revision 管理适用性 | ACCEPTED | objectKey 只证明文件上传，不证明议价/调价已提交 | 可复用同一二进制，不自动复制业务适用性 |
| ADR-256 | 调价原因与 RRP/币种规则使用按店铺和 contractVersion 的 Option/Rule Snapshot，授权时重验 | ACCEPTED | 选项动态变化，stale code/精度会导致真实失败或错价 | 官方明确长期稳定后可延长 TTL，不取消版本 |
| ADR-257 | RRP 按 SKU/site 建模；全量替换必须 read-merge-freeze 当前完整集合并做 revision 重验 | ACCEPTED | 只提交修改项会清空遗漏值，部分状态不能压成商品级 | 官方改为明确 patch 合同后可新增新 actionVersion |
| ADR-258 | 消费者售价和活动价合同未核准前只允许人工来源/unsupported，不开放平台写 | ACCEPTED | 当前能力证据不足，不能靠失败试错或通用改价 | 完整合同、fixture、权限、命令和金丝雀通过后逐动作开放 |
| ADR-259 | PriceFloorPolicy 只消费板块 13 的 ProfitSnapshot/FX/成本 revision，不复制或修改财务事实 | ACCEPTED | 价格与财务需要解耦且利润结论必须可审计 | 可新增批准利润口径，不允许页面自行算安全价 |
| ADR-260 | partial/conflict/unknown/stale 利润默认数据不足而非安全；地毯按尺寸 SKU 判断，不使用 SKC 平均利润 | ACCEPTED | 缺成本与大尺寸物流风险会掩盖实际亏损 | 只有补齐证据或批准的限时例外可执行 |
| ADR-261 | 低于底线可由 Owner/Admin 发起例外，但必须双人审批、预计损失、影响数量、理由和有效期 | ACCEPTED | 商业上需要可控例外，但不能静默自动接受亏损 | 可提高审批等级，不降低不同人审批和 revision 失效 |
| ADR-262 | 例外只授权指定 PriceCommand/action/revision，不永久改写底线，也不能越过 unsupported/canary 门 | ACCEPTED | 防止一次商业决定变成长期安全旁路 | 若需改政策必须走 PriceFloorPolicy 独立变更 |
| ADR-263 | 浏览器不直接调用 SHEIN 价格写；统一 PriceCommand/Event/Outbox、一命令一 Job 和 action adapter | ACCEPTED | 同步 HTTP 无法可靠处理崩溃、重复、审计和回滚 | 只读计划/预检可同步，外部写边界不可回退 |
| ADR-264 | 价格外部调用前持久化 send_started；发送后超时为 result_unknown，禁止通用自动 retry | ACCEPTED | 重复接受/拒绝/重报价/全量替换可造成不可逆后果 | 只有动作合同提供可靠幂等或官方回查证明后受控恢复 |
| ADR-265 | HTTP 200/accepted 仅表示已提交；官方值/状态按 SKU/site/currency/round/revision 匹配才为 effective | ACCEPTED | 防止价格伪成功并保留平台处理时间 | 可缩短回读等待，不降低证据标准 |
| ADR-266 | 价格 selection 绑定 tenant/user/store/tab/filter/snapshot/eligibility，只作用当前可见 eligible 集合 | ACCEPTED | 历史已出现可见行与选择数量不一致，价格动作风险更高 | 可提供显式跨页全选，必须展示完整影响并服务端重验 |
| ADR-267 | 价格读取继续手动刷新单 owner；Webhook 只落 Inbox/标 dirty，无 Scheduler/30 秒/进页/切店同步 | ACCEPTED | 用户已明确拒绝自动同步，且避免 QPS/竞态 | 未来需独立业务批准和负载证据才调整 |
| ADR-268 | 价格工作台渐进加入现有 V2；先只读/影子底线，再用户指定单动作单商品金丝雀，不重做全站 UI | ACCEPTED | 降低前端回归和真实价格事故 | 每一写动作均需合同、回归、staging、批准和后台核对 |
| ADR-269 | 建立独立 Growth Operations 领域；最新快照 warning 只作兼容证据，不再承担生命周期和实验真相 | ACCEPTED | 临时数组无法追踪阶段、决定、SLA 和复盘 | 可保留只读摘要，不作为新写 owner |
| ADR-270 | 商品生命周期、经营分层、平台活动、内部计划、领域执行和风险 Case 正交 | ACCEPTED | 各对象事实来源、状态和动作完全不同 | UI 可聚合摘要，不合并底层状态机 |
| ADR-271 | 生命周期规范粒度至少为 store × SKC × site × productVersion；ProductFamily 无全局 current stage | ACCEPTED | 同图案跨店/站点/版本表现不同 | 可增加 SKU 证据，不允许降低 store/site/version 作用域 |
| ADR-272 | 生命周期采用 candidate/launch_ready/testing/validated/growth/scale/stable/decline/clearance/retired 主链 | ACCEPTED | 覆盖选品到退出且避免把 blocker 变成阶段 | 阶段语义变更需迁移 ADR，不随 UI 文案暗改 |
| ADR-273 | 自动规则只生成阶段 Proposal，current stage 只能由可审计 GrowthDecision 更新 | ACCEPTED | 防止 stale/partial 数据自动放量或淘汰 | 可按权限简化确认，不取消决定和输入证据 |
| ADR-274 | SHEIN 未开放曝光/点击/访客/加购/支付/转化 API 时，这些指标固定为 unsupported/unknown | ACCEPTED | 官方 FAQ 明确无法通过 API 获取 | 官方开放正式合同后以新 MetricDefinition 接入，不回填历史伪值 |
| ADR-275 | today/yesterday/7/30 日销量保存为窗口事实，不生成伪逐日序列或无对照因果结论 | ACCEPTED | 聚合窗口不能恢复日级分布，也不能证明优化原因 | 获得真实日事实后新增来源，不改旧窗口语义 |
| ADR-276 | 0 销量先经过可售、库存、上架、审核/合规、数据覆盖诊断；未知原因不直接判滞销/淘汰 | ACCEPTED | 全托管缺流量数据，0 有多种解释 | 人工后台证据可补充诊断，不自动改官方事实 |
| ADR-277 | 测款开始前冻结假设、版本、变量、窗口和标准；关键变更结束或分段旧 Experiment | ACCEPTED | 防止混算与事后改标准 | 可创建新 revision，不覆盖既有实验 |
| ADR-278 | Experiment 结果区分 pass/fail/inconclusive/data_invalid，并显式记录 confounder 与 observational 局限 | ACCEPTED | 数据不足和因果不可识别不等于失败 | 证据补齐后创建新 Evaluation，不回写旧结论 |
| ADR-279 | 商品分层按需求、利润、库存/履约、质量/售后、合规/内容和供应多维并列，不采用单一黑盒爆款分 | ACCEPTED | 商业价值与风险不能由销量一个维度替代 | 可提供摘要标签，必须保留分解与版本 |
| ADR-280 | 地毯放量按尺寸 SKU、面积/克重、包装/体积重、利润、质量和售后门；小尺寸成功不证明整组 | ACCEPTED | 大尺寸成本、运输和售后风险显著不同 | 只有逐 SKU 证据可扩大范围 |
| ADR-281 | SHEIN 当前不支持 API 创建促销活动；CampaignPlan 首期只生成带证据的后台人工任务 | ACCEPTED | 官方 FAQ 已明确接口边界 | 新活动合同通过验证后逐动作建立独立 adapter/Command |
| ADR-282 | 人工“已提交活动”与官方待审/通过/活动中状态分离，平台 Fact 只来自核准合同/回执 | ACCEPTED | 人工操作不能证明平台处理结果 | 可增加后台导入，必须保留来源和时间 |
| ADR-283 | CampaignEligibility 引用价格、利润、库存/履约、合规、质量和供应 revision，增长域不自建例外旁路 | ACCEPTED | 活动会影响利润、交付、下架和平台风险 | 对应领域批准的例外可被引用，不复制规则 |
| ADR-284 | GrowthActionPlan 只交接对应领域 Task/Plan，不直接拥有标题、媒体、价格、库存、上下架或发布外部写 | ACCEPTED | 防止通用增长执行器破坏已有可靠命令边界 | 可统一展示进度，不统一外部 payload |
| ADR-285 | AI 仅生成可解释 Recommendation；保存 input/model/prompt/policy 与人工采纳/编辑/拒绝，不自动迁移或执行 | ACCEPTED | 黑盒建议不能替代商业责任和数据质量门 | 用户可批准单项计划，仍走对应领域门禁 |
| ADR-286 | 多店增长只聚合可比 Snapshot 和商品族模式，不复制阶段、实验结果或平台事实 | ACCEPTED | 店铺、站点、版本和 cutoff 不同 | 可生成跟进候选，每店重新预检/决定 |
| ADR-287 | 增长刷新复用各领域手动 RefreshOperation；无 Scheduler/30 秒/进页/切店同步，任务进度只在活动期有界读取 | ACCEPTED | 用户明确要求手动刷新并避免请求风暴 | 未来自动化需独立批准、负载和数据新鲜度证据 |
| ADR-288 | 增长工作台渐进加入现有 V2；先 shadow 阈值/人工计划，再单店生命周期与测款，不重做经营中心 | ACCEPTED | 降低 UI 回归并让规则先与真实运营对账 | 两个稳定 release 后按证据退役临时标签 |
| ADR-289 | 建立独立 Collaboration/Work Management 领域，只承担协同控制面，不拥有或改写业务 current truth | ACCEPTED | 任务需要统一，但万能状态机会再次制造跨模块漂移 | 可增加领域 adapter，不合并底层 Fact/Case/Command |
| ADR-290 | WorkItem、Approval、SystemJob、ExternalCommand、Notification 与领域 Fact/Case 使用独立身份和状态机 | ACCEPTED | 各对象的责任、成功证据、重试和权限不同 | UI 可聚合关联，不压成统一 status |
| ADR-291 | WorkItem 必须绑定 tenant/workspace/store、subjectRef/revision、来源、owner/assignee、SLA 和完成证据 | ACCEPTED | 防止串店、旧内容处理和无责任任务 | 全局任务可无 storeId，但必须显式 workspace scope |
| ADR-292 | WorkItem 采用 open/assigned/in_progress/blocked/resolved/verified/closed 主链；关闭不等于领域或 SHEIN 成功 | ACCEPTED | 人工处理与平台结果必须分层 | 可按 WorkType 自动验证候选，不降低领域证据要求 |
| ADR-293 | 领域通过版本化 WorkSignal/WorkType Registry 创建任务，并按 subject/reason/policy 去重和记录复发 | ACCEPTED | 避免页面直写和重复消息轰炸 | 人工 general 任务保留受控入口与 scope |
| ADR-294 | assignee 与 accountableOwner 分离；转交、代理、离岗和 orphan 处理全部事件化且不能扩大 capability | ACCEPTED | 商业责任与实际执行人可能不同 | 可自动建议分派，不自动授权或静默覆盖 |
| ADR-295 | response/resolution SLA 分离，基于版本化 BusinessCalendar；官方硬截止保留原值且不因内部日历顺延 | ACCEPTED | 不同响应/解决责任和跨时区截止需要可解释 | 可调整内部目标，不改官方事实 |
| ADR-296 | ApprovalRequest 冻结 action、subjectRevision、范围、风险与影响 hash；任何相关输入变化使其 invalidated | ACCEPTED | 旧批准不能授权新内容或新目标 | 重新预检后新建 request revision，不更新旧批准 |
| ADR-297 | 高风险审批强制职责分离和不同主体计数；代理与被代理人不能占两个席位 | ACCEPTED | 防止自审与角色叠加绕过双人门 | break-glass 只能走限时、通知和事后复核专用流程 |
| ADR-298 | approved 仅产生一次性 ApprovalGrant，由对应领域原子消费并重验 capability/revision/eligibility | ACCEPTED | 审批不应绕过领域命令和平台可靠性边界 | 领域可拒绝已批准动作，不得扩大 Grant |
| ADR-299 | 评论、mention 和附件只作为协作/证据，不能解析为批准、业务状态或外部命令 | ACCEPTED | 自由文本不具备稳定语义和安全资格 | 可由人引用评论创建正式决定，不自动执行 |
| ADR-300 | 通知使用 Event/Outbox/Delivery，投递独立失败；首期应用内 Inbox 为唯一强制渠道 | ACCEPTED | 业务提交不能依赖消息提供商，当前无需多渠道复杂性 | 新渠道需独立 provider/隐私/成本/失败合同 |
| ADR-301 | 通知按 recipient/subject/type/window 去重聚合，已读/确认/稍后均不修改 WorkItem、SLA 或业务状态 | ACCEPTED | 避免通知风暴与伪完成 | 安全/P0/审批到期可强制应用内，不绕过状态边界 |
| ADR-302 | TodayWork 升级为个人工作台；现有聚合保留为 activity feed，不再冒充任务事实 | ACCEPTED | 当前聚合不可分派、关闭、验收或追踪 SLA | 可渐进映射已有事件，不伪造历史任务 |
| ADR-303 | 当前“任务中心”更名为系统/同步任务；SystemJob 仅在需要人介入时生成关联 WorkItem | ACCEPTED | 机器执行与人工责任不能共用完成语义 | 可以互相跳转，不合并计数/状态/重试 |
| ADR-304 | OperationsCalendar 引用来源对象与原始时区；日历编辑不得静默修改官方截止或业务事实 | ACCEPTED | 日历是视图和内部计划，不是平台真相 owner | 内部计划调整走来源对象新 revision |
| ADR-305 | 周期任务只生成内部 WorkItem，SLA/提醒/日历绝不自动刷新或调用 SHEIN | ACCEPTED | 用户明确要求手动刷新并防止自动动作复发 | 未来外部自动化需独立 ADR、合同、授权和金丝雀 |
| ADR-306 | 跨店任务使用显式 storeSet revision 和父协调项+每店子项；动态店铺组不静默扩张目标 | ACCEPTED | 各店权限、状态、证据和失败独立 | 可批量创建子项，必须影响预览和逐店重验 |
| ADR-307 | WorkSnapshot 统一计数/列表/详情/SLA/allowedActions；selection 只作用当前可见 eligible 并逐项 CAS | ACCEPTED | 历史已出现可见 4 项却操作 15 项 | 显式跨页全选必须展示完整目标并服务端重验 |
| ADR-308 | 协同层渐进接入现有 V2，使用有界 DB claim/lease 和应用内通知；不引入通用 BPMN、聊天或全站重设计 | ACCEPTED | 当前团队规模和 2 核 4GB 需要小而可靠的商业系统 | 业务复杂度和负载证据证明后再扩展单项能力 |
| ADR-309 | 建立独立 Analytics/Reporting 语义层，只消费规范事实，不成为第二套业务数据库或写 owner | ACCEPTED | 统一报表需要语义治理，但复制真相会产生漂移 | 可新增只读聚合，不覆盖领域 current pointer |
| ADR-310 | 所有正式 KPI 通过版本化 MetricDefinition 定义 key/grain/unit/formula/window/quality/owner | ACCEPTED | 防止同名指标在页面、SQL 和 Excel 中含义不同 | 变更必须新版本和影响分析，不静默改历史 |
| ADR-311 | 店铺/商品/SKU/时间/币种/单位等通过 DimensionDefinition 和 effective-dated history 管理 | ACCEPTED | 显示名和组织变化不能改写历史身份 | 可显式选择按当前组织重述，不作为默认 |
| ADR-312 | MetricObservation 保存 value 与 known/confirmed_zero/partial/unknown/stale/conflict/unsupported/not_applicable | ACCEPTED | 数值与质量不可分离，unknown 不是 0 | 只有来源完整覆盖并明确返回 0 才 confirmed_zero |
| ADR-313 | SHEIN 未开放曝光/点击/访客/加购/支付/转化/全托管订单时固定为 unsupported/unknown | ACCEPTED | 官方能力边界不允许通过销量或抓取伪造 | 新官方合同/fixture 核准后新增 MetricVersion，不伪回填历史 |
| ADR-314 | today/yesterday/rolling7/rolling30 是窗口事实，不拆成伪日序列；库存时点、财务期间和事件时间分开 | ACCEPTED | 不同时间语义不可互换 | 获得真实日事实后新增 dataset，不改旧窗口 |
| ADR-315 | AnalyticsSnapshot 冻结 scope/asOf/version/cutoff/quality/lineage；重算新建 revision，不覆盖旧快照 | ACCEPTED | 报表和决策必须可复现 | 可更新 current pointer，已引用旧快照继续可读 |
| ADR-316 | 同一 DashboardSnapshot 下卡片、图表、列表、总计、下钻和导出共享 snapshotId/filter context | ACCEPTED | 防止同屏不同“最新”造成对账失败 | 用户显式刷新生成新快照，不混用旧新结果 |
| ADR-317 | 多店比较必须通过 businessMode/metricVersion/unit/currency/window/cutoff/coverage 可比性门 | ACCEPTED | 不可比数据排序会误导资源和绩效 | 可分组展示，不得强制统一排名 |
| ADR-318 | 财务与利润报表只消费板块 13 ProfitSnapshot/FX/关账事实，不在页面临时算利润 | ACCEPTED | 成本、分摊、汇率和期间缺口会制造伪精确 | 新利润口径先进入 Finance/Metric version 治理 |
| ADR-319 | 报表下钻继承 snapshotId、范围、时间和质量；总计由服务端同口径返回，不以当前页求和 | ACCEPTED | 分页和当前最新会导致总计不一致 | 可提供不同 grain 明细，必须声明转换和对账 |
| ADR-320 | 当前规模优先 PostgreSQL 结构化事实/汇总/索引与有界 Worker，不提前引入独立数仓/CDC 双写 | ACCEPTED | 2 核 4GB 和内部团队规模要求简单可靠 | 经容量测试证明瓶颈后再立项分析存储 |
| ADR-321 | 报表定义版本化；SavedView 只调整允许筛选/列/排序，不能改正式指标公式 | ACCEPTED | 个性化展示不能破坏组织口径 | 自定义公式需审核晋升 MetricDefinition |
| ADR-322 | 自定义分析使用白名单 dataset/metric/dimension 语义编译和 cost guard，禁止原始 SQL/脚本/URL | ACCEPTED | 防止越权、注入、资源攻击和双真相 | 内部受控诊断工具另走管理员/审计边界 |
| ADR-323 | ExportJob 后台流式生成私有 CSV/XLSX，携带口径/质量，使用短时票据、hash 和下载审计 | ACCEPTED | 前端导出不可靠且敏感数据风险高 | 小结果可同步下载，仍需同一权限/Artifact 合同 |
| ADR-324 | ReportSubscription 只发送已有合格 Snapshot，不自动刷新 SHEIN；过期/partial 明确警告或跳过 | ACCEPTED | 用户明确要求手动刷新且避免请求风暴 | 自动源刷新需独立业务批准、QPS 和可靠性证据 |
| ADR-325 | 报表/驾驶舱只能创建引用 Snapshot 的 WorkItem/Plan，不直接执行价格、库存、发布等外部写 | ACCEPTED | 分析与执行需要职责、审批和命令边界 | 对应领域可提供单项跳转，不在报表拼 payload |
| ADR-326 | Analytics/Report 权限按 dataset/field/storeSet/capability 服务端裁剪，搜索/下钻/导出/订阅同样重验 | ACCEPTED | 卡片标题、明细和导出均可能包含敏感数据 | 可增加脱敏摘要，不降低服务端范围校验 |
| ADR-327 | 报表读/重算继续基于已落库事实和手动 RefreshOperation；页面 load/切店/聚焦/30 秒不调用 SHEIN | ACCEPTED | 保持单一刷新 owner 和稳定用户体验 | 未来新鲜度策略需独立 ADR 与负载证明 |
| ADR-328 | 报表中心和管理驾驶舱渐进加入现有 V2，不引入第二套前端/鉴权/权限或大屏式全站重设计 | ACCEPTED | 防止再次因修复一处改变全站并控制复杂度 | 经视觉基线、业务需求和性能证明后可逐页优化 |

## 5. Run 总表

| Run ID | ERP 步骤 | Issue ID | 开始时间 | 状态 | 环境 | 外部写入 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | 尚无执行记录 | — | 否 | 本轮仅建立计划和台账 |

### 5.1 Run ID 规则

格式：`RUN-YYYYMMDD-ERPXX-NN`。

示例：`RUN-20260829-ERP00-01`。同一 ERP 步骤当天再次执行时递增末尾序号，不覆盖旧记录。

## 6. 标准 Run 记录模板

开始任何步骤时，复制本节到文件末尾并完整填写。未填写的字段必须写“不适用”及原因，不能留空。

### RUN-YYYYMMDD-ERPXX-NN

#### A. 基本信息

- ERP 步骤：
- 关联 Issue ID：
- 状态：IN_PROGRESS
- 开始时间：
- 结束时间：
- 执行环境：local / isolated test / staging / production
- 用户授权范围：
- 是否涉及生产部署：否
- 是否涉及数据库写入：否
- 是否涉及真实 SHEIN 写入：否

#### B. 本 Run 合同

- 唯一目标：
- 当前症状：
- 允许修改的文件/服务/表：
- 明确禁止修改的稳定区域：
- 前置条件及证据：
- 成功标准：
- 停止条件：
- 回滚点：

#### C. 基线证据

- 当前 Git/release/镜像/构建 SHA：
- 当前页面及路由：
- 当前 API 请求和响应：
- 当前数据库/事件/队列：
- 当前日志/traceId：
- 当前 SHEIN 官方证据：
- 失败回归测试及结果：

#### D. 分层与责任归属

- 所属层：浏览器 / V2 UI / Control / API / Domain / Repository / DB / Redis / Queue / Worker / SHEIN adapter / Nginx / release
- 唯一 owner：
- 是否发现第二套 owner：
- canonical 数据源：
- 缓存/投影：
- 状态写入者：
- 状态读取者：

#### E. 横向影响矩阵

| 影响面 | 结论 | 所需验证 |
| --- | --- | --- |
| 用户/租户/角色 | | |
| 店铺切换/跨店隔离 | | |
| 草稿生命周期 | | |
| 发布命令/幂等 | | |
| 审核状态/计数 | | |
| 队列/Worker/重启恢复 | | |
| 缓存/投影/版本 | | |
| SHEIN 额度/限流/错误 | | |
| AI/媒体/合规 | | |
| 旧数据/迁移 | | |
| 前端路由/视觉/选择 | | |
| 构建/制品/部署/回滚 | | |
| 性能/安全/可观测性 | | |

#### F. 实际变更

- 修改文件：
- 数据库迁移：
- 配置变更：
- 删除或归档：
- 与原计划不同之处：
- 新增依赖：
- 新发现 Issue ID：

#### G. 验证证据

- 定向单元测试：
- 契约测试：
- 集成测试：
- 受影响测试：
- 全量测试：
- V2 构建：
- E2E 浏览器验收：
- 视觉回归：
- 失败注入/重启恢复：
- 性能/安全检查：
- 数据前后对账：

#### H. 部署记录

- 用户批准时间：
- releaseId：
- commit SHA：
- artifact SHA256：
- 镜像 digest：
- Control 实际版本：
- Worker 实际版本：
- Nginx 实际静态目录：
- 数据库 migration 版本：
- Canary 店铺/商品：
- 部署后浏览器证据：
- 部署后 SHEIN 官方证据：
- 回滚演练/结果：

#### I. 结束结论

- 完成门结果：PASS / FAIL
- 最终状态：COMPLETE / BLOCKED / GATE_FAILED / READY_FOR_APPROVAL
- 已解决 Issue：
- 未解决 Issue：
- 残留风险：
- 下一 ERP 步骤是否 READY：
- 交接文档更新位置：

## 7. 三类固定门禁

### 7.1 开始门

每个 Run 开始前必须全部满足：

- [ ] 已定位到唯一 ERP-XX。
- [ ] 前置步骤状态满足依赖。
- [ ] 已登记 Issue ID 或明确是计划内建设项。
- [ ] 已读取主计划中该步骤全部内容。
- [ ] 已列允许范围和禁止范围。
- [ ] 已取得当前基线，不依赖历史“应该已经部署”。
- [ ] 已定义至少一个能失败的行为测试或证据查询。
- [ ] 已定义回滚点和停止条件。
- [ ] 当前没有第二个 `IN_PROGRESS` 步骤。

### 7.2 代码完成门

- [ ] 修改与当前 Issue 一一对应，没有无关重构。
- [ ] 失败回归从失败变为通过。
- [ ] 定向、受影响和规定的全量测试通过。
- [ ] 没有用字符串源码断言替代核心行为测试。
- [ ] API、数据库、队列和 UI 使用同一状态语义。
- [ ] 多用户、多店铺、未知值、超时、重试和重启路径已验证。
- [ ] 非目标页面和稳定能力没有变化。
- [ ] 新发现问题已登记，没有藏在总结里。

### 7.3 上线完成门

- [ ] 用户明确批准本次部署和外部写入范围。
- [ ] 候选制品通过 staging 全链路。
- [ ] releaseId、commit、artifact、镜像、Control、Worker 一致。
- [ ] Nginx 指向唯一批准的 V2 制品。
- [ ] 数据库迁移可前滚/可恢复且备份有效。
- [ ] Canary 只用批准的测试店铺和测试商品。
- [ ] 页面状态由发布事件和 SHEIN 官方证据支持。
- [ ] 部署后关键 E2E、日志、队列和官方回读通过。
- [ ] 回滚命令、目标版本和触发阈值已验证。
- [ ] 观察窗口结束后才扩大范围。

## 8. 证据标准与存放规则

### 8.1 最低证据组合

| 结论 | 最低证据 |
| --- | --- |
| “代码已修复” | 失败回归 + 修复后测试 + 受影响测试 |
| “前端已部署” | release manifest + artifact SHA + 线上 JS/CSS hash + 浏览器页面 |
| “Worker 已更新” | Worker 启动日志 releaseId + 镜像 digest + 实际处理记录 |
| “商品已提交 SHEIN” | 本地 commandId + SHEIN 接收标识/原始响应 + 状态事件 |
| “商品已发布/上架” | SHEIN 官方回读的明确上架证据，不接受本地推断 |
| “审核状态已同步” | 官方原始状态 + 映射结果 + snapshot version + 页面分类 |
| “草稿已退出列表” | handoff 事件 + 草稿查询结果 + 发布批次审计记录 |
| “没有跨店串数据” | 服务端负向授权测试 + 切店并发 E2E + cache key 证据 |
| “可以删除旧代码/数据” | 零引用图 + 观察期 + 可恢复归档 + 用户批准 |

### 8.2 建议证据目录

每个 Run 的非敏感证据放入：

`docs/evidence/RUN-YYYYMMDD-ERPXX-NN/`

允许的文件示例：

- `baseline.md`
- `test-results.txt`
- `contract-fixtures.json`（必须脱敏）
- `browser-before.png`
- `browser-after.png`
- `release-manifest.json`
- `deployment-verification.md`
- `rollback-verification.md`

严禁把 access token、cookie、私钥、数据库密码、SHEIN 签名密钥或完整个人信息写入仓库。

## 9. 偏差处理

执行中出现以下任一情况必须停止当前 Run，而不是继续扩大修改：

1. 需要改动禁止范围内的稳定模块。
2. 发现问题属于另一个未满足前置条件的 ERP 步骤。
3. 当前源码、线上 release 或数据库事实与基线记录不一致。
4. 无法构造可靠失败回归，根因仍只是猜测。
5. 需要生产写入、真实 SHEIN 商品或不可逆迁移但尚无用户授权。
6. 回归测试显示修复 A 会破坏 B。
7. 无法确认应该回滚到哪个版本。

停止后必须：

- 把 Run 标记为 `BLOCKED` 或 `GATE_FAILED`。
- 记录已完成的只读证据。
- 创建新的 Issue/Risk/Decision 记录。
- 明确恢复执行所需条件。
- 不得以“先部署看看”绕过门禁。

## 10. 本台账的首条记录

### RUN-20260828-GOV-01

- 类型：项目治理文档建立，不属于 ERP 实施步骤。
- 目标：建立 ERP-00～ERP-23 的固定顺序、范围、门禁、证据和执行台账。
- 实际改动：仅新增主执行计划与本执行台账。
- 业务代码：未修改。
- 数据库：未读取或写入生产数据。
- 云端：未部署、未改配置。
- SHEIN：未调用写接口。
- 完整性校验：24 个步骤编号、名称和顺序与主计划完全一致；每一步均包含目标和完成门。
- 追踪覆盖：24 个已知问题、12 个风险和 10 个架构/产品决策已登记。
- 结果：PASS。治理文档建立完成，ERP 实施仍未开始。

### RUN-20260828-GOV-04

- 类型：板块架构方案固化，不属于 ERP 实施步骤。
- 目标：记录板块 04“商品建档、批量建品、编辑器、类目属性与模板复用”的完整商业方案，并同步主计划与台账。
- 实际改动：仅更新三份治理 Markdown 文档；新增 BUILD-01～17、BUG-BUILD-001～012、RISK-022～027 和 ADR-051～068。
- 业务代码：未修改。
- 数据库：未读取或写入生产数据。
- 云端：未部署、未改配置。
- SHEIN：未调用读写接口。
- 校验：三份文档同为 v4；BUILD 编号连续；61 个 Issue、27 个 Risk、68 个 ADR 均为唯一 ID；24 个 ERP 步骤结构保持完整。
- 结果：PASS。板块 04 已形成可执行约束，但任何实现仍须进入正式 ERP-XX Run。

### RUN-20260829-GOV-05

- 类型：板块架构方案固化，不属于 ERP 实施步骤。
- 目标：记录板块 05“发布命令、批次、队列、Worker 与 SHEIN 回执闭环”的完整商业方案，并同步主计划与台账。
- 实际改动：仅更新三份治理 Markdown 文档；新增 PUB-01～20、BUG-PUB-004～017、RISK-028～034 和 ADR-069～090。
- 业务代码：未修改。
- 数据库：未读取或写入生产数据。
- 云端：未部署、未改配置。
- SHEIN：未调用读写接口。
- 校验：三份文档同为 v5；PUB 编号连续；75 个 Issue、34 个 Risk、90 个 ADR 均为唯一 ID；24 个 ERP 步骤结构保持完整。
- 结果：PASS。板块 05 已形成可执行约束，但任何实现仍须进入正式 ERP-XX Run。

### RUN-20260829-GOV-06

- 类型：板块架构方案固化，不属于 ERP 实施步骤。
- 目标：记录板块 06“官方回读、Webhook、审核状态投影与商品审核中心”的完整商业方案，并同步主计划与台账。
- 实际改动：仅更新三份治理 Markdown 文档；新增 REV-01～20、BUG-REV-005～015、RISK-035～041 和 ADR-091～108。
- 业务代码：未修改。
- 数据库：未读取或写入生产数据。
- 云端：未部署、未改配置。
- SHEIN：未调用读写接口。
- 校验：三份文档同为 v6；REV 编号连续；86 个 Issue、41 个 Risk、108 个 ADR 均为唯一 ID；24 个 ERP 步骤结构保持完整。
- 结果：PASS。板块 06 已形成可执行约束，但任何实现仍须进入正式 ERP-XX Run。

### RUN-20260829-GOV-07

- 类型：板块架构方案固化，不属于 ERP 实施步骤。
- 目标：记录板块 07“素材资产、商品图片、上传处理、用途映射与对象存储生命周期”的完整商业方案，并同步主计划与台账。
- 实际改动：仅更新三份治理 Markdown 文档；新增 MEDIA-01～20、BUG-MEDIA-002～015、RISK-042～049 和 ADR-109～128。
- 业务代码：未修改。
- 数据库：未读取或写入生产数据。
- 云端：未部署、未改配置。
- SHEIN：未调用读写接口。
- 校验：三份文档同为 v7；MEDIA 编号连续；100 个 Issue、49 个 Risk、128 个 ADR 均为唯一 ID；24 个 ERP 步骤结构保持完整。
- 结果：PASS。板块 07 已形成可执行约束，但任何实现仍须进入正式 ERP-XX Run。

### RUN-20260829-GOV-08

- 类型：板块架构方案固化，不属于 ERP 实施步骤。
- 目标：记录板块 08“标题规则、AI 标题、视觉识别与批量生成调度”的完整商业方案，并同步主计划与台账。
- 实际改动：仅更新三份治理 Markdown 文档；新增 AI-01～20、BUG-AI-003～016、RISK-050～057 和 ADR-129～148。
- 业务代码：未修改。
- 数据库：未读取或写入生产数据。
- 云端：未部署、未改配置。
- SHEIN：未调用读写接口。
- 校验：三份文档同为 v8；AI 编号连续；114 个 Issue、57 个 Risk、148 个 ADR 均为唯一 ID；24 个 ERP 步骤结构保持完整。
- 结果：PASS。板块 08 已形成可执行约束，但任何实现仍须进入正式 ERP-XX Run。

### RUN-20260829-GOV-09

- 类型：板块架构方案固化，不属于 ERP 实施步骤。
- 目标：记录板块 09“商品合规、资质证书、1630/1631、实拍图、警示语与发布阻断”的完整商业方案，并同步主计划与台账。
- 实际改动：仅更新三份治理 Markdown 文档；新增 COMPLY-01～20、BUG-CMP-002～015、RISK-058～065 和 ADR-149～168。
- 业务代码：未修改。
- 数据库：未读取或写入生产数据。
- 云端：未部署、未改配置。
- SHEIN：未调用读写接口。
- 校验：三份文档同为 v9；COMPLY 编号连续；128 个 Issue、65 个 Risk、168 个 ADR 均为唯一 ID；24 个 ERP 步骤结构保持完整。
- 结果：PASS。板块 09 已形成可执行约束，但任何实现仍须进入正式 ERP-XX Run。

### RUN-20260829-GOV-10

- 类型：板块架构方案固化，不属于 ERP 实施步骤。
- 目标：记录板块 10“销量、库存、在途、备货、经营预警与多店经营分析”的完整商业方案，并同步主计划与台账。
- 实际改动：仅更新三份治理 Markdown 文档；新增 BIZ-01～20、BUG-INV-002～015、RISK-066～073 和 ADR-169～188。
- 业务代码：未修改。
- 数据库：未读取或写入生产数据。
- 云端：未部署、未改配置。
- SHEIN：未调用读写接口。
- 校验：三份文档同为 v10；BIZ 编号连续；142 个 Issue、73 个 Risk、188 个 ADR 均为唯一 ID；24 个 ERP 步骤结构保持完整。
- 结果：PASS。板块 10 已形成可执行约束，但任何实现仍须进入正式 ERP-XX Run。

### RUN-20260829-GOV-11

- 类型：板块架构方案固化，不属于 ERP 实施步骤。
- 目标：记录板块 11“采购、备货、仓库、发运物流与履约闭环”的完整商业方案，并同步主计划与台账。
- 实际改动：仅更新三份治理 Markdown 文档；新增 FUL-01～20、BUG-FUL-001～016、RISK-074～081 和 ADR-189～208。
- 业务代码：未修改。
- 数据库：未读取或写入生产数据。
- 云端：未部署、未改配置。
- SHEIN：未调用读写接口。
- 校验：三份文档同为 v11；FUL 编号连续；158 个 Issue、81 个 Risk、208 个 ADR 均为唯一 ID；24 个 ERP 步骤结构保持完整。
- 结果：PASS。板块 11 已形成可执行约束，但任何实现仍须进入正式 ERP-XX Run。

### RUN-20260829-GOV-12

- 类型：板块架构方案固化，不属于 ERP 实施步骤。
- 目标：记录板块 12“退货、报废、质量缺陷、索赔申诉、平台处罚与财务对账”的完整商业方案，并同步主计划与台账。
- 实际改动：仅更新三份治理 Markdown 文档；新增 RET-01～20、BUG-RET-001～016、RISK-082～089 和 ADR-209～228。
- 业务代码：未修改。
- 数据库：未读取或写入生产数据。
- 云端：未部署、未改配置。
- SHEIN：未调用读写接口。
- 校验：三份文档同为 v12；RET 编号连续；174 个 Issue、89 个 Risk、228 个 ADR 均为唯一 ID；24 个 ERP 步骤结构保持完整。
- 结果：PASS。板块 12 已形成可执行约束，但任何实现仍须进入正式 ERP-XX Run。

### RUN-20260829-GOV-13

- 类型：板块架构方案固化，不属于 ERP 实施步骤。
- 目标：记录板块 13“财务、成本、利润、结算、发票、资金与多币种经营核算”的完整商业方案，并同步主计划与台账。
- 实际改动：仅更新三份治理 Markdown 文档；新增 FIN-01～20、BUG-FIN-001～016、RISK-090～097 和 ADR-229～248。
- 业务代码：未修改。
- 数据库：未读取或写入生产数据。
- 云端：未部署、未改配置。
- SHEIN：未调用读写接口。
- 校验：三份文档同为 v13；FIN 编号连续；190 个 Issue、97 个 Risk、248 个 ADR 均为唯一 ID；24 个 ERP 步骤结构保持完整。
- 结果：PASS。板块 13 已形成可执行约束，但任何实现仍须进入正式 ERP-XX Run。

### RUN-20260829-GOV-14

- 类型：板块架构方案固化，不属于 ERP 实施步骤。
- 目标：记录板块 14“价格生命周期、平台核价/议价、建议零售价、活动价与利润保护”的完整商业方案，并同步主计划与台账。
- 实际改动：仅更新三份治理 Markdown 文档；新增 PRICE-01～20、BUG-PRICE-001～016、RISK-098～105 和 ADR-249～268。
- 业务代码：未修改。
- 数据库：未读取或写入生产数据。
- 云端：未部署、未改配置。
- SHEIN：未调用读写接口。
- 校验：三份文档同为 v14；PRICE 编号连续；206 个 Issue、105 个 Risk、268 个 ADR 均为唯一 ID；24 个 ERP 步骤结构保持完整。
- 结果：PASS。板块 14 已形成可执行约束，但任何实现仍须进入正式 ERP-XX Run。

### RUN-20260829-GOV-15

- 类型：板块架构方案固化，不属于 ERP 实施步骤。
- 目标：记录板块 15“运营活动、商品推广、选品测款、商品分层与生命周期增长”的完整商业方案，并同步主计划与台账。
- 实际改动：仅更新三份治理 Markdown 文档；新增 GROW-01～20、BUG-GROW-001～016、RISK-106～113 和 ADR-269～288。
- 业务代码：未修改。
- 数据库：未读取或写入生产数据。
- 云端：未部署、未改配置。
- SHEIN：未调用读写接口。
- 校验：三份文档同为 v15；GROW 编号连续；222 个 Issue、113 个 Risk、288 个 ADR 均为唯一 ID；24 个 ERP 步骤结构保持完整。
- 结果：PASS。板块 15 已形成可执行约束，但任何实现仍须进入正式 ERP-XX Run。

### RUN-20260829-GOV-16

- 类型：板块架构方案固化，不属于 ERP 实施步骤。
- 目标：记录板块 16“团队任务、审批、通知、SLA 与协同工作流”的完整商业方案，并同步主计划与台账。
- 实际改动：仅更新三份治理 Markdown 文档；新增 WORK-01～20、BUG-WORK-001～016、RISK-114～121 和 ADR-289～308。
- 业务代码：未修改。
- 数据库：未读取或写入生产数据。
- 云端：未部署、未改配置。
- SHEIN：未调用读写接口。
- 校验：三份文档同为 v16；WORK 编号连续；238 个 Issue、121 个 Risk、308 个 ADR 均为唯一 ID；24 个 ERP 步骤结构保持完整。
- 结果：PASS。板块 16 已形成可执行约束，但任何实现仍须进入正式 ERP-XX Run。

### RUN-20260829-GOV-17

- 类型：封版审计缺口补齐，不属于 ERP 实施步骤。
- 目标：补齐板块 17“数据分析、报表中心、指标治理与管理驾驶舱”，使 17 个业务板块与 24 个工程执行步骤形成完整范围。
- 实际改动：仅更新治理 Markdown 文档；新增 BI-01～20、BUG-BI-001～016、RISK-122～129 和 ADR-309～328，并统一方案名称为 HANZHOU-POLARIS。
- 业务代码：未修改。
- 数据库：未读取或写入生产数据。
- 云端：未部署、未改配置。
- SHEIN：未调用读写接口。
- 校验：三份治理文档同为 v17；BI 编号连续；254 个 Issue、129 个 Risk、328 个 ADR 均为唯一 ID；24 个 ERP 步骤结构保持完整。
- 结果：PASS。板块 01～17 业务架构范围封版，后续实施仍须从正式 ERP-00 Run 开始。

### RUN-20260829-HANDOFF-POLARIS-01

- 类型：方案封版、资料汇总与新对话交接，不属于 ERP 实施步骤。
- 目标：审计 17 个业务板块和 24 个工程阶段的完整性，统一命名 HANZHOU-POLARIS，并为新对话建立单一入口、API 资料目录和总蓝图。
- 新增文档：`HANZHOU_POLARIS_REBUILD_HANDOFF_2026-08-29.md`、`HANZHOU_POLARIS_MASTER_BLUEPRINT_2026-08-29.md`、`HANZHOU_POLARIS_API_SOURCE_CATALOG_2026-08-29.md`。
- 关键发现：当前 Git 为 `No commits yet on main` 且无可解析 HEAD；55 份 API 原始资料、46 个迁移、重复 `014` 迁移前缀；旧交接引用的四份 API/部署文档当前缺失；生产信息仅保留历史最新已知状态，未在本轮实时核验。
- 实际改动：仅新增/更新 Markdown 治理与交接文档；未修改业务代码、依赖、部署脚本或环境配置。
- 业务代码：未修改。
- 数据库：未连接、未读取或写入生产数据，未执行迁移。
- 云端：未连接、未上传、未切换 release、未重启服务。
- SHEIN：未调用读写接口。
- 校验：17 个板块、24 个 ERP 步骤、254 个唯一 Issue、129 个唯一 Risk、328 个唯一 ADR；旧交接基准 SHA-256 保持 `ee4d07408af8d2fe797edc77568d95085927ea31057ddf57dd894b296b5cd3a7`。
- 结果：PASS。新对话必须先读 Polaris 主交接，并从 ERP-00 的只读基线开始；本 Run 不代表 ERP-00 已启动或完成。

> 上述“新对话必须从 ERP-00 开始”的交接结论已由 `RUN-20260829-HANDOFF-POLARIS-02` 校正。保留原文只为记录当时写法，不再作为当前启动指令。

### RUN-20260829-HANDOFF-POLARIS-02

- 类型：交接身份与执行状态校正，不属于 ERP 实施步骤。
- 目标：纠正 v1 交接对“历史已执行步骤、17 个板块最新方案、ERP-00～ERP-23 未来路线”的混用，建立唯一有效的 V2 新对话入口。
- 关键结论：历史旧“第 1～20 步”及 NEXUS/EVO/SRF 等是已经发生的修复与部署记录；17 个板块是最新产品目标；ERP-00～ERP-23 是未来实施路线草案，24 步全部 `NOT_STARTED`。
- 新增文档：`HANZHOU_POLARIS_REBUILD_HANDOFF_V2_2026-08-29.md`。
- 更新文档：v1 交接增加归档提示；总蓝图、17 板块架构、未来执行计划和本台账增加身份/状态校正；API 目录改指 V2 入口。
- 启动规则：新对话先理解 17 个板块，不自动开始 ERP-00；只有用户明确采用、修订或启动某个 ERP 步骤后才创建正式 Run。
- 业务代码：未修改。
- 数据库：未连接、未读取或写入生产数据，未执行迁移。
- 云端：未连接、未上传、未切换 release、未重启服务。
- SHEIN：未调用读写接口。
- 历史保护：旧交接 `REBUILD_HANDOFF_2026-08-03.md` 未修改，基准 SHA-256 仍为 `ee4d07408af8d2fe797edc77568d95085927ea31057ddf57dd894b296b5cd3a7`。
- 结果：PASS。三层资料身份清晰，ERP 执行总览仍为 24 个 `NOT_STARTED`，没有伪造任何已完成 ERP 步骤。

## 11. 后续启动格式

只有用户明确决定采用 ERP 路线并要求开始步骤时，才使用以下指令：

> 开始 ERP-00。严格按主计划和执行台账工作，只执行本步骤，不提前做下一步。

执行者必须先创建正式 Run 记录、展示本步合同和开始门结果，然后才允许行动。没有用户的明确启动指令、Run ID、范围、失败证据和成功标准，不得自动开始 ERP-00 或其他 ERP 步骤。

## 12. 正式 ERP-00 Run

### RUN-20260829-ERP00-BASELINE-01

- 类型：ERP 实施步骤；变更冻结与真相基线。
- 启动时间：2026-08-29 11:07:42 +0800。
- 启动依据：用户明确要求开始 Polaris 重构并严格按方案执行。
- 目标：建立可重复、可对比的本地与生产事实快照，确认源码、前端产物、Control、Worker、数据库、队列、部署版本、功能开关和历史问题证据边界。
- 允许范围：只读检查本地文件、Git、依赖、构建入口、部署拓扑、生产健康、数据库/队列聚合和功能开关；生成不含秘密的文件清单、哈希、规模、容器和数据计数报告；更新本计划与执行台账。
- 禁止范围：修改业务代码、生产配置、数据库、队列或 SHEIN 数据；重启服务、切换 release、清理压缩包或未跟踪文件；把历史交接状态当作当前事实。
- 初始失败/未知证据：当前 Git HEAD、生产 current release、Control/Worker/静态前端一致性、数据库/队列实时聚合及功能开关均须本次重新采集；任何无法采集项必须明确标记 `UNKNOWN`。
- 交付物：ERP-00 基线报告、文件/服务/release 哈希清单、当前问题证据包索引、明确的回滚基线。
- 成功标准：任何人可据报告确认当前运行的前端、Control 和 Worker；报告不含秘密；未知项无推测补齐；未使用 `git diff` 代替未跟踪仓库的完整性检查；无超出 ERP-00 范围的修改或外部写入。
- 证据报告：[ERP00_BASELINE_REPORT_2026-08-29.md](./ERP00_BASELINE_REPORT_2026-08-29.md)。
- 用户授权：用户明确授权“创建并验证生产 PostgreSQL 备份”。
- 备份证据：`/opt/shein-console/backups/postgresql-20260829T114751+0800.dump`，`56,607,733` bytes，权限 `600`，SHA-256 `339b189da77dad7de0cd981088c8756d14d2ecd0f5c25f656fd4494b95b8d205`。
- 恢复证据：469 个归档条目在 PostgreSQL 16、无网络、临时 tmpfs 容器中成功恢复；51 张 public 表及关键业务聚合核对通过；临时容器已清理。
- 过程异常：主机未安装 `pg_restore`，改用 PostgreSQL 容器内工具；一次临时容器名包含 Docker 不允许的 `+`，未创建容器，随后用合法名称重试成功；生产数据库、队列、配置和服务未修改。
- 当前状态：COMPLETE；ERP-00 完成门通过，ERP-01 仅在用户单独批准 Git 基线提交和私有远端后启动。

## 13. 正式 ERP-01 Run

### RUN-20260829-ERP01-ASSET-BASELINE-01

- 类型：ERP 实施步骤；源码资产救援与版本控制。
- 启动时间：2026-08-29 12:01:12 +0800。
- 启动依据：用户在 ERP-00 生产 PostgreSQL 备份/隔离恢复验证完成后，明确要求“下一步，严格按照方案执行”；此前已明确批准创建 Git 基线和私有远端。
- 目标：把当前约 1.3GB、无可信 HEAD 的工作区整理为可审计、可回滚、可验证的 Git 基线，不修改业务逻辑。
- 允许范围：完整工作区备份与哈希；源码、文档、测试、迁移、静态资产、部署定义、生成物、本地数据、依赖、发布归档和异常文件分类；安全 `.gitignore`；基线提交/tag；私有远端或明确标注的本地私有镜像；空目录 clone、安装、测试和构建验证；更新资产、台账和回滚证据。
- 禁止范围：删除、覆盖、移动用户文件；修改业务逻辑、API 契约、数据库、生产配置或部署 release；提交 `.env`、`.data`、数据库、密钥、`node_modules`、生成目录或历史发布包；重命名历史迁移；把文件名推断的 release 映射当作真实部署证据。
- 进入门结果：ERP-00 COMPLETE；工作区归档已完成；生产 PostgreSQL 备份已完成并通过隔离恢复；当前仓库无可信 HEAD，原有 `.git` 内部对象/refs 保留，不作为历史提交使用。
- 失败基线/已知边界：未配置外部 Git 服务 URL；本步骤先建立本地可验证私有 bare 镜像，外部托管远端待用户提供目标后再绑定；原始 Markdown 存在历史性尾随空格和 EOF 空行，记录为 `WARN`，不做批量格式化。
- 成功标准：基线提交和 tag 可定位；暂存内容不含受禁资产或高置信秘密；124 个发布归档均有 bytes/mtime/SHA-256/证据映射索引；从私有镜像空目录 clone 后可安装依赖、运行测试和构建；原始工作区和完整备份可回滚。
- 完成证据：[ERP01_BASELINE_REPORT_2026-08-29.md](./ERP01_BASELINE_REPORT_2026-08-29.md)。基线 commit、树哈希、tag、完整备份、124 包索引、私有镜像、空目录 clone、安装、1170 测试、V2/Web 构建、静态 release readiness 和差异可见性验证均已记录。
- 当前状态：COMPLETE；ERP-02 尚未启动，不得把本步骤的本地构建物或静态审计结果当作生产切换授权。

## 14. 正式 ERP-02 Run

### RUN-20260829-ERP02-V2-ARTIFACT-01

- 类型：ERP 实施步骤；单一 V2 前端产物恢复。
- 启动时间：2026-08-29 12:06 +0800。
- 启动依据：ERP-01 完成门通过；用户已明确要求继续按 ERP-00～ERP-23 顺序执行。
- 目标：消除 legacy、V2、`dist`、`dist-web`、`dist-v2` 之间的构建/部署漂移，指定 V2 为唯一发布源；本步骤不改变当前 V2 UI 行为和视觉。
- 允许范围：只调整构建/打包入口、静态目录映射、release marker、asset manifest、审计和引用图；只读取生产 Nginx 当前目录与线上静态事实。
- 禁止范围：修改业务页面、导航、品牌、文案、状态逻辑；删除 legacy 源码；同时修复发布、审核或同步问题；未经用户单独批准切换生产 release。
- 进入门结果：ERP-01 COMPLETE；源码 baseline commit/tag、工作区备份、生产数据库备份和隔离恢复证据已存在。
- 初始未知：生产 Nginx 实际静态目录、当前入口映射、线上 legacy marker 和深层路由回退行为需本 Run 重新取证；任何无法证明项保持 `UNKNOWN`。
- 成功标准：一次构建只产生一套前端事实；本地/候选/云端入口 hash 可对比；生成 buildId/source revision/asset manifest/UI marker；Playwright 或等价浏览器证据证明 V2 品牌、关键路由和无 legacy 标识；深层路由不循环；不执行生产切换。
- 完成证据：[ERP02_BASELINE_REPORT_2026-08-29.md](./ERP02_BASELINE_REPORT_2026-08-29.md)。clean commit 上 `sourceDirty=false` 的 V2 构建、双命令相同 tree hash、静态审计和浏览器复验均通过。
- 当前状态：COMPLETE；ERP-03 尚未启动。生产切换、Nginx reload、迁移、队列和 SHEIN 写入均未执行。

## 15. 正式 ERP-03 Run

### RUN-20260829-ERP03-CI-STAGING-GATE-01

- 类型：ERP 实施步骤；CI、预发与发布门禁。
- 启动时间：2026-08-29 12:19 +0800。
- 启动依据：ERP-02 COMPLETE；用户明确要求继续严格按 ERP-00～ERP-23 顺序执行。
- 目标：把测试、构建、浏览器验收、制品审计、staging 隔离和发布一致性变成可自动阻断的门禁，而不是口头检查。
- 允许范围：固定 Node/npm 版本；新增 CI workflow、门禁脚本、staging compose/env 模板、Playwright 核心流程和不含秘密的 mock；扩展 release manifest/audit；新增只读/故障注入测试；更新部署文档和台账。
- 禁止范围：修改业务页面/API/数据库语义；连接生产 DB/Redis 做 staging；生产迁移、Nginx reload、切换 current、重启生产服务；调用真实 SHEIN 写接口；提交 secrets、真实 env、生产数据或凭证。
- 进入门结果：ERP-00、ERP-01、ERP-02 COMPLETE；V2 单一产物和 audit 已通过；当前仓库 clean、生产写入未授权。
- 初始失败/未知：当前无 CI workflow；Playwright/MSW/Storybook/Lighthouse 是否已安装需核对；Control、Worker、Outbox、schema range 和 flags 尚未由同一 manifest 串联；staging 运行环境尚未建立；12 类故障门尚未完整覆盖。
- 成功标准：CI 失败时不得产出正式制品；clean clone 能执行固定版本检查、secret scan、定向/全量测试、V2 build、release audit；staging 的 DB/Redis/bucket/flags 明确独立且默认不写 SHEIN；manifest 能证明 Control/Publish Worker/Outbox/schema/flags 同版本；故障 fixture 对重复、超时、断线、回读、媒体异常给出确定结果；所有无法执行的项显式标记 `UNKNOWN`。
- 实际改动：新增固定工具链声明、CI workflow、tracked-file secret scan、staging Compose/环境模板、Playwright 核心流程、完整 release manifest/audit、故障契约测试和候选制品打包脚本；将 cloud control Dockerfile 固定到 `node:24.16.0-alpine`；为本地 staging MinIO 增加仅 staging 可启用的显式 HTTP Endpoint 门；未修改生产业务 API/数据库语义。
- 验证结果：固定工具链 PASS；secret scan PASS（591 个 tracked 文件，4 个 reference-only 文档/测试向量已明示）；故障契约 17/17 PASS；全量测试 1194/1194 PASS；V2 build/build:web PASS；V2 artifact audit PASS；完整 release manifest 在 clean revision `b1fc965d23bfbc72f3ce03f5e18976a83720ab45` 上 PASS（`sourceDirty=false` 且 UI source revision 一致）；staging 静态隔离 PASS；Docker Desktop `4.88.1` 已安装并通过 DMG CRC/Gatekeeper 验证；staging 实际运行 PASS（PostgreSQL/Redis/MinIO/Control healthy，46 条迁移记录、51 张 public tables，Redis PONG，Control `/health`/`/ready` 通过，MinIO 写入/读取/删除闭环通过，Publish Worker 未启动）；staging 候选制品打包 PASS（`artifacts/polaris-staging-b1fc965d23bfbc72f3ce03f5e18976a83720ab45.tar.gz`，SHA-256：`b91d2be68b7af497351b2ddbeacb4caddf3d4e2edcc85aba8a43108c730188e0`，权限 `0444`）；Playwright `--list` 发现 2 个测试；本机默认 bundled Chromium 与 headless shell 下 Playwright 实际 E2E 2/2 PASS；系统 Chrome `152.0.7977.64` 的历史 fallback 结果仍为 2/2；in-app browser 深层路由补充验证 PASS。
- 未闭合门：当前没有 Outbox Dispatcher，manifest 固定标记 `not_implemented` 并阻断新 PublishCommand；本机 bundled Chromium 门已闭合，但远端 GitHub Actions runner 尚未实际执行，不能把本机结果写成远端 CI 通过；`npm audit` 仍有 5 个 high、0 个 critical，依赖治理留待后续独立步骤。
- 证据报告：[ERP03_CI_STAGING_GATE_REPORT_2026-08-29.md](./ERP03_CI_STAGING_GATE_REPORT_2026-08-29.md)。
- 外部写入：未连接生产 PostgreSQL/Redis/对象存储；未执行生产迁移、Nginx reload、current 切换、服务重启或 SHEIN 写入。
- 当前状态：GATE_FAILED；staging 与本机 bundled Chromium 运行态已补证，但不满足 ERP-03 完成门，不得开始 ERP-04；必须先实现并验证 Outbox Dispatcher，并在需要时补充远端 CI runner 实际运行证据，再重新跑完整门禁。

## 16. 正式 ERP-03 Outbox 补证 Run

### RUN-20260829-ERP03-OUTBOX-BRIDGE-01

- 类型：ERP-03 补证；可靠发布命令的 durable Outbox 与队列边界实现。
- 启动依据：上一 Run 的明确失败项是 Outbox Dispatcher 缺失；用户继续明确要求按计划执行下一步。
- 目标：使发布 execute 在 PostgreSQL 事务内形成可恢复的 Outbox 事件，由独立 Dispatcher 以 lease/claim/确定性 jobId 投递到 BullMQ，再由 command-scoped Publish Worker 消费；消除 Control 直接写发布队列的失电窗口。
- 允许范围：新增 Outbox 迁移、Dispatcher、配置和 staging profile；改造 publish execute durable handoff、Control queue ownership、Worker command contract；新增单元/静态/迁移/能力审计；不启用 SHEIN 写入。
- 禁止范围：真实 SHEIN 写接口、生产迁移、生产队列/Redis/对象存储、生产服务重启、生产 current 切换；不将 ERP-09 的 ProductVersion、完整发布编排和真实平台写入提前伪装完成。
- 已实施：`046_publish_outbox_events.sql`；`outbox-dispatcher.js`；事务内 `createPublishOutboxEvents`；Dispatcher claim/lease/retry；确定性 `jobId=commandId`；Worker contract version 校验和单命令范围；Control 不再拥有 publish queue；staging 默认关闭 Dispatcher 和 publish live-write。
- 已验证：全量 `npm test` 1202/1202；Outbox/Worker/Repository 定向测试通过；工具链、secret scan、staging isolation、V2 build、release audit、runtime capability audit 通过；默认 bundled Chromium E2E 2/2 通过；046 已应用到独立 staging PostgreSQL；真实 DB Dispatcher 探针 `claimed=0, dispatched=0, failed=0`；无生产写入、无 SHEIN 调用。
- 关键边界：`0/0/0` 只证明 staging 空队列安全探针，不证明真实命令已完成队列投递；真实 PublishCommand 投递仍因 live-write false 未执行；远端 GitHub Actions runner 尚未执行。
- 当前结论：`GATE_FAILED`；Outbox 缺失这一具体实现阻断已解除，但 ERP-03 完成门仍未闭合；不得启动 ERP-04，不得把该 Run 标记为 ERP-09 完成。

## 17. ERP-03 staging 全链路补证 Run

### RUN-20260829-ERP03-STAGING-CHAIN-02

- 类型：ERP-03 补证；真实 staging 基础设施上的 Outbox → BullMQ → command-scoped Worker 安全演练。
- 启动依据：上一 Run 只完成真实 staging PostgreSQL 空队列探针，未完成真实投递闭环；本 Run 将 synthetic command 演练固化为仓库命令，不触碰 SHEIN。
- 固化实现：新增 `server/ci/staging-outbox-chain.js` 与 `ci:staging-outbox-chain`；命令强制 staging/cloud、live-write=false、本机 staging PostgreSQL/Redis 端口，并使用随机 queue/prefix 与 finally 清理。
- 首次 staging 复验：发现 PostgreSQL `42P18` 参数类型错误（`jsonb_build_object` contract version 使用未类型化参数）；事务已回滚。修复为 `$5::text`，并纳入回归测试。
- 第二次 staging 复验：真实 PostgreSQL Outbox `claimed=1, dispatched=1, failed=0`；真实 Redis/BullMQ 确定性 `jobId`；真实 command-scoped Worker `submittedCount=1`；`realSHEINCalls=0`；`contractVersion=publish-command-v1`。
- 清理核验：`syntheticTenants=0`、`outboxRows=0`；随机 Redis prefix 无残留；无生产连接、无 SHEIN 写入。
- 本 Run 验证：Outbox/Worker 定向 10/10；全量 `npm test` 1202/1202；staging isolation PASS；fault gates 17/17。
- 未闭合门：远端 GitHub Actions runner 尚未实际执行；本机结果不能冒充远端 CI 通过。
- 当前状态：`GATE_FAILED`；staging 全链路具体阻断已解除，但 ERP-03 完成门仍未闭合；不得启动 ERP-04，不得把本 Run 标记为 ERP-09 完成。
