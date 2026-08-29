# ERP-04 商品生命周期与状态字典设计

日期：2026-08-29  
Run：`RUN-20260829-ERP04-LIFECYCLE-DICTIONARY-01`  
步骤：ERP-04  
状态：`COMPLETE`；用户已批准业务名称与工作流

关联方案：

- `docs/HANZHOU_POLARIS_MASTER_BLUEPRINT_2026-08-29.md`
- `docs/COMMERCIAL_ERP_MASTER_EXECUTION_PLAN_2026-08-28.md`
- `docs/COMMERCIAL_ERP_MODULE_ARCHITECTURE_2026-08-28.md`，板块 03
- `docs/REVIEW_CENTER_STATUS_DICTIONARY_2026-08-28.md`
- `docs/COMMERCIAL_ERP_EXECUTION_LEDGER_2026-08-28.md`

## 1. 范围、前提与禁止事项

本 Run 只冻结商品生命周期的业务语义，不实现数据模型，不执行迁移，不修改页面，不部署，不连接生产，不调用真实 SHEIN 写接口。

本设计解决的核心问题是：同一商品不能再用一个 `status` 同时表示草稿编辑、发送执行、SHEIN 审核、上架、合规和系统健康。任何页面、API、Worker 或数据库投影都必须从下列正交事实轴读取状态，不能重新拼接第二套状态机。

本 Run 的进入条件已经满足：

1. ERP-00、ERP-01、ERP-02 已有 `COMPLETE` 证据。
2. ERP-03 已由 GitHub Actions 对提交 `805a43d` 真实执行并返回 `Success`，两个 job 均通过。
3. 当前分支为 `main`，当前提交为 `805a43d`，生产写入和真实 SHEIN 写入仍关闭。
4. ERP-05 的存量关系审计尚未完成，因此本 Run 只定义兼容读取和分类规则，不对旧数据做批量纠正。

## 2. 不可变业务词典

### 2.1 商品对象职责

| 对象 | 唯一职责 | 不拥有的事实 |
| --- | --- | --- |
| `ProductFamily` | 可选的本地 SPU 组织意图 | 不代表 SHEIN 官方 SPU |
| `CatalogProduct` | 长期稳定的本地商品身份；地毯默认一个设计/颜色一个计划中的 SKC | 不拥有草稿编辑内容、官方审核状态或上架结论 |
| `CatalogSku` | 长期稳定的本地尺寸/规格 SKU 身份 | 不因重发、排序或 SHEIN SKU 变化更换内部主键 |
| `ProductDraft` | 当前可编辑工作副本 | 不拥有官方审核、上架、合规完成或发布成功 |
| `ProductVersion` | handoff 时冻结的一次完整业务版本 | 不允许普通 UPDATE/DELETE |
| `PublishAttempt` | 某个 ProductVersion 的一次发布/重发尝试及执行证据 | 不代表官方审核或已上架 |
| `PlatformProductLink` | 本地商品/SKU 与 SHEIN SPU/SKC/SKU/document/version 的证据映射 | 不按标题、supplier code 或时间自动合并 |
| `OfficialProductProjection` | SHEIN 回读/Webhook 得到的官方当前事实投影 | 不作为本地草稿编辑源 |
| `ProductEvent` | 商品、草稿、版本、尝试和平台身份的追加式历史 | 不覆盖原始事件 |

### 2.2 地毯商品边界

1. 一个 `CatalogProduct` 默认表示一个独立设计/图案/颜色，计划对应一个 SHEIN SKC。
2. 不同尺寸/规格/包装组合属于该商品下的多个 `CatalogSku`，计划对应 SHEIN SKU。
3. 多个设计/颜色需要本地归组时使用 `ProductFamily`；是否成为同一 SHEIN SPU 只看官方映射。
4. supplier code、supplier SKU、标题、图片文件夹名都是业务键或属性，不是内部主身份。
5. 一次请求若包含多个 SKC，使用批次和 AttemptItem 映射多个 ProductVersion，不改变单个 CatalogProduct 的责任边界。

## 3. 六维状态字典

六维状态必须同时存在于规范 read model 中。状态值使用稳定英文 code，中文只负责展示；任何未知值必须保留原始值、来源、版本和时间，并进入 `unknown`，不能猜测。

### 3.1 本地可编辑状态 `editingState`

事实源：ProductDraft 的编辑事实、服务端预检结果和显式 handoff 事件。此轴只回答“本地草稿是否还能编辑/提交”。

| code | 中文显示 | 进入条件 | 退出条件 | 终态 |
| --- | --- | --- | --- | --- |
| `editing` | 待完善 | 创建草稿、保存可编辑修改、从版本返回编辑 | 预检阻断、预检通过、显式归档、显式 handoff | 否 |
| `blocked` | 需处理（预检阻断） | 当前草稿存在服务端 blocker | blocker 修复并重新预检、归档 | 否 |
| `ready` | 待提交 | 当前 schema/rule snapshot 下服务端预检通过 | handoff、内容变化导致重新变为 editing/blocked、归档 | 否 |
| `handed_off` | 已交接 | 原子 handoff 成功，已有 ProductVersion/Attempt 关系 | 只允许由后续新 Draft revision 表达修正，不回写旧 Draft | 是（该 revision） |
| `archived` | 已归档（本地） | 用户显式归档或治理流程归档 | 受控恢复为新的 editing revision | 是（该归档记录） |

约束：`ProductDraft` 不允许使用 `published`、`pending_review`、`approved`、`listed`、`rejected` 作为规范状态。旧值只进入兼容层，不能继续写入新状态字段。

### 3.2 传输执行状态 `executionState`

事实源：PublishAttempt/PublishCommand、Outbox、Worker claim/send 事件和 SHEIN 发布接口原始响应。此轴只回答“本地是否发起了这一次传输，以及结果能否安全确定”。

| code | 中文显示 | 进入条件 | 退出条件 | 终态/动作 |
| --- | --- | --- | --- | --- |
| `not_started` | 未开始 | Attempt 已创建但尚未排队 | 入队 | 否 |
| `queued` | 排队中 | Outbox/队列可重放且已创建确定性 jobId | Worker claim、明确取消/终止 | 否 |
| `claimed` | 执行中 | Worker 成功领取并建立 lease | 开始发送、明确失败、lease 恢复 | 否 |
| `submitting` | 正在提交 | 持久化 `send_started`，已跨越外部写入边界 | 明确 accepted、明确失败、无法判断 | 否 |
| `accepted` | 已提交，待回执 | SHEIN 发布接口返回可接受结果并保存原始响应/平台标识（若有） | 接收/审核回读继续推进；不回到草稿 | 对该发送结果为终态 |
| `known_failed` | 发布失败，需处理 | 明确失败，保存 code/message/traceId 和 retry policy | 仅按失败分类重试或返回编辑 | 对该 Attempt 为终态 |
| `result_unknown` | 结果待确认 | `send_started` 后响应缺失、网络中断、进程崩溃或响应无法证明结果 | 只允许官方回读/人工对账恢复为 accepted 或 known_failed | 阻断新尝试 |

`known_failed` 的 `retryPolicy` 必须另存为 `retryable` 或 `terminal`，不能通过增加更多 execution 状态混淆状态轴。`accepted` 只代表发布接口的可接受响应，不代表 SHEIN 审核通过或已上架。

### 3.3 官方审核状态 `officialReviewState`

事实源优先级：官方 Webhook 原始事件和官方 document-state 回读 > 已验证的官方字段映射 > 本地执行事实。平台未给出可证明状态时必须为 `unknown`。

| code | 默认中文显示 | 官方依据 | 退出条件 |
| --- | --- | --- | --- |
| `not_received` | 尚未收到官方审核回执 | 尚无官方 receive/audit 事实 | 获得官方接收或审核事件 |
| `pending_review` | 待审核 | `audit_state=1` 或明确 pending review | 明确进入其他阶段、通过、驳回、撤回 |
| `pricing` | 待核价 | 明确 `workflow_stage=awaiting_price` 等同义官方字段 | 官方下一阶段或终态 |
| `sample` | 待寄样 | 明确 `workflow_stage=awaiting_sample` | 官方下一阶段或终态 |
| `design_review` | 待审版 | 明确 `workflow_stage=awaiting_version_review` | 官方下一阶段或终态 |
| `sample_review` | 待核样 | 明确 `workflow_stage=awaiting_sample_review` | 官方下一阶段或终态 |
| `final_review` | 待终审 | 明确 `workflow_stage=awaiting_final_review` | 通过、驳回、撤回 |
| `approved` | 审核通过 | `audit_state=2` 或明确官方 passed/approved | 官方撤回/新 Attempt 产生新的当前指针时只影响对应 Attempt |
| `rejected` | 已驳回 | `audit_state=3` 或明确官方 rejected/failed | 旧 Attempt 不被重写；新 Attempt 另建版本/父子关系 |
| `withdrawn` | 已撤回 | `audit_state=4` 或明确官方 withdrawn | 需要重发时创建新 Attempt |
| `unknown` | 官方状态待确认 | 缺失、冲突、未识别或无法绑定当前 Attempt | 官方证据补齐或人工对账 |

官方接收事实作为该轴的证据字段保存：`receiveState=accepted|failed|unknown`，并记录事件来源、发生时间、traceId、documentSn/version 和原始值。它不是新增当前审核页签；`receiveState=accepted` 只能把 `not_received` 推进到“已接收，待审核”，不能推导 `approved`、`listed` 或 `pricing`。

优先级固定为：明确 `audit_state=3` 驳回或 `audit_state=4` 撤回等官方终态 > 明确且可识别的当前 workflow stage > 官方通过/待审核状态 > 接收回执 > 本地执行状态。`audit_state=2` 通过若同时存在明确的待核价/待寄样/待审版等后续 workflow stage，页面显示该明确阶段，内部仍保留 `approved` 证据；冲突不覆盖旧事实，进入 `conflict/unknown` 诊断记录。

### 3.4 上架状态 `listingState`

事实源：SHEIN 官方商品列表/上架回读及可验证 Webhook；本地任务完成、HTTP 200、打印标签、审核通过均不能单独推导上架。

| code | 中文显示 | 进入条件 | 不能推导 |
| --- | --- | --- | --- |
| `not_listed` | 未上架 | 官方明确未上架 | 不能由“没有数据”推导 |
| `listed` | 已上架 | 官方明确上架 | 不能由本地 accepted/approved 推导 |
| `off_shelf` | 已下架 | 官方明确下架 | 不能等同 deleted |
| `deleted` | 已删除 | 官方明确删除 | 不能由归档草稿推导 |
| `unknown` | 上架状态待确认 | 缺失、冲突或未回读 | 不显示“已上架” |

### 3.5 合规状态 `complianceState`

事实源：对应 ProductVersion/Attempt 的官方要求快照、材料适用性、证书/实拍/警示语任务和平台回执。合规状态不写回 ProductDraft 的通用状态。

| code | 中文显示 | 进入条件 | 备注 |
| --- | --- | --- | --- |
| `not_checked` | 未检查 | 尚未按当前要求快照执行合规检查 | 不等于通过 |
| `pending` | 合规检查中 | 已建立检查/材料任务但结果未完成 | 可阻断 handoff |
| `needs_action` | 合规需处理 | 存在缺失、过期、不适用冲突或人工待办 | 是运营聚合，不是官方审核状态 |
| `passed` | 合规通过 | 适用要求均有可验证满足证据 | 不等于审核通过/已上架 |
| `unsupported_manual` | 需人工处理 | 平台/本地无法自动验证，必须人工提供证据 | 不伪造为 passed |
| `unknown` | 合规状态待确认 | 规则或证据缺失/冲突 | 保留缺口和来源 |

### 3.6 系统健康状态 `healthState`

事实源：数据快照的 `asOf`、来源响应、覆盖率、权限和服务诊断。此轴只回答“当前显示的数据是否新鲜、完整、可访问”。

| code | 中文显示 | 进入条件 | 允许的页面行为 |
| --- | --- | --- | --- |
| `fresh` | 数据新鲜 | 来源成功、在 SLA 内、覆盖完整 | 正常展示 |
| `stale` | 数据已过期 | 超过 SLA 或仅有旧 LKG | 展示时间/来源，允许显式刷新 |
| `partial` | 数据不完整 | 部分对象/字段成功，覆盖不足 | 展示缺口，禁止补零/伪完整 |
| `service_unavailable` | 服务暂不可用 | 超时、连接失败或依赖不可用 | 保留旧快照并明确不可用 |
| `permission_denied` | 无权限 | 身份/店铺/字段授权失败 | 拒绝数据，不回退到其他店铺 |

### 3.7 本地商品主数据生命周期（独立于六维）

`CatalogProduct.lifecycleStatus` 仅允许：`active`、`retired`、`archived`。它表示本地商品身份是否继续作为业务主数据存在，不覆盖上述任何状态，也不表示 SHEIN 上下架。

## 4. 当前尝试、版本和历史选择规则

### 4.1 建立当前指针

1. 先按 `tenantId + storeId` 限定查询范围，再按 CatalogProduct/SKC/Site/Version 绑定身份。
2. 当前版本由显式 `CatalogProduct.currentVersionId` 或等价规范投影给出；没有显式指针时保持 `unknown`，不得按最近时间猜。
3. 当前 Attempt 由显式 `currentAttemptId` 给出。推进必须来自原子 handoff、明确的 parent/supersedes 关系和官方证据匹配。
4. 官方回读优先用 `documentSn + version + SPU/SKC/SKU` 精确关联；只有 SKC 的旧记录只能作为兼容索引，不能覆盖有明确平台身份的新 Attempt。
5. 新 Attempt 只有在新 ProductVersion、父 Attempt 和原因完整落库后，才可成为当前 Attempt；旧 Attempt 永久留在 timeline。
6. 单纯 `createdAt`、`updatedAt`、数据库最后一行、最新 SHEIN version、标题或图片相似度都不是当前指针规则。
7. 任何父子关系、平台身份或时间线存在冲突，当前列表显示 `unknown/conflict` 并进入人工诊断，不自动合并。

### 4.2 旧驳回、新重发和状态优先级

1. 旧 Attempt 的 `rejected` 只属于旧 ProductVersion；新 Attempt 创建后，旧驳回只能出现在历史时间线和统计中。
2. “修正并重发”必须从被驳回 ProductVersion 派生新的 Draft revision，再生成新 ProductVersion、新 Attempt，并记录 `parentAttemptId`、`supersedesAttemptId`、`reason`。
3. “作为新商品创建”必须 fork 新 CatalogProduct，原商品的审核、平台身份和回执不得混入新商品。
4. `approved` 只表示官方审核通过；若上架仍为 `unknown/not_listed`，页面不得显示“已发布”。
5. `listed` 只由官方上架事实推进，并优先于审核中心的待处理展示，但不删除历史审核记录。

### 4.3 `result_unknown` 恢复矩阵

| 故障位置 | 可否安全重试原命令 | 规范结果 | 下一动作 |
| --- | --- | --- | --- |
| 创建 Command 前崩溃 | 是 | 不产生 Attempt/Command；事务回滚 | 用户可再次提交 |
| Command/Outbox 事务内崩溃 | 是 | 事务原子回滚或保留可重放 Outbox | Dispatcher 按确定性 jobId 恢复 |
| Outbox 已提交、尚未 `send_started` 崩溃 | 是 | 保持 `queued/claimed`，lease 到期可重投 | 只重投同一 Command |
| 已 `send_started`，响应明确失败 | 按 `retryable` 决定 | `known_failed` | 仅允许明确安全的失败策略 |
| 已 `send_started`，响应缺失/网络中断 | 否 | `result_unknown` | 先官方回读/人工对账；禁止自动重发 |
| 已保存 `accepted`，官方尚无回执 | 否 | `accepted + officialReviewState=not_received/unknown` | 等待/显式回读，不回到草稿 |
| 官方明确驳回 | 不复用旧 Attempt | `rejected` 历史终态 | 用户显式修正并重发或 fork 新商品 |

`result_unknown` 在恢复为明确结果前，禁止自动创建新 ProductVersion、自动重发、把原草稿重新放回可提交列表或用“失败”替代未知。

## 5. 合法状态转换矩阵

矩阵中的“动作”是领域动作，不是本阶段实现授权。后续实现必须以服务端命令、权限和审计为准。

### 5.1 ProductDraft 转换

| 当前 | 动作 | 目标 | 前置条件 | 非法/阻断 |
| --- | --- | --- | --- | --- |
| 不存在 | 创建 | `editing` | tenant/store/权限有效 | 跨店或无权限 |
| `editing` | 预检失败 | `blocked` | 服务端 blocker 可解释 | 不得标官方驳回 |
| `editing` | 预检通过 | `ready` | 当前 schema/rule snapshot 有效 | schema 不确定时不得 ready |
| `blocked` | 修正并预检 | `editing` 或 `ready` | 失败字段已更新并重新计算 | 不得手工改成 ready |
| `ready` | 原子 handoff | `handed_off` | lockVersion、fingerprint、Version/Attempt/Outbox 同事务成功 | 任一事务失败全部回滚 |
| `editing/blocked/ready` | 归档 | `archived` | 用户显式确认并记录原因 | 不得删除 Version/Receipt |
| `handed_off` | 直接编辑 | 非法 | 已冻结 | 必须派生新 Draft revision |
| `archived` | 恢复 | 新 `editing` revision | 受控恢复、保留历史 | 不原地改旧归档事实 |

### 5.2 Execution/Review/Listing 转换

| 当前事实 | 动作 | 目标事实 | 禁止推导 |
| --- | --- | --- | --- |
| `not_started` | Outbox/队列入队 | `queued` | 不能显示已提交 |
| `queued` | Worker claim | `claimed` | 不能显示 SHEIN 已接收 |
| `claimed` | 持久化 `send_started` | `submitting` | 不能自动重试跨边界动作 |
| `submitting` | 明确可接受响应 | `accepted` | 不能显示审核通过/已上架 |
| `submitting` | 明确失败 | `known_failed` | 不能显示官方驳回 |
| `submitting` | 响应不确定 | `result_unknown` | 不能自动重发 |
| `accepted` | 官方接收回执 | receive accepted；审核仍为 `not_received/pending_review` | 不能推导 approved |
| 官方审核中 | 官方 stage 回读 | 对应 `pricing/sample/design_review/sample_review/final_review` | 不能按中文文本猜阶段 |
| 任一审核状态 | 官方驳回 | `rejected` | 不能把本地失败覆盖成官方驳回 |
| `approved` | 官方上架回读 | listing `listed` | 不能只凭 approved 显示已上架 |
| 任一有平台身份 | 官方下架/删除 | `off_shelf/deleted` | 不能由本地归档推导 |

## 6. 非法转换矩阵

下列转换必须拒绝并留下审计/诊断记录，不允许通过 UI 文案或兼容层静默完成：

| 非法转换 | 原因 |
| --- | --- |
| `ProductDraft.editing → officialReviewState=approved` | 草稿编辑不能产生官方事实 |
| `ProductDraft.ready → listingState=listed` | 可提交不等于已上架 |
| `ProductDraft.archived → ProductVersion.deleted` | 本地归档不能删除历史版本/平台证据 |
| `executionState=accepted → officialReviewState=approved` | 发布接口接受不等于审核通过 |
| `officialReviewState=rejected → listingState=deleted` | 审核驳回不等于已删除 |
| `officialReviewState=approved → listingState=listed`（无官方上架证据） | 审核与上架是不同事实 |
| `result_unknown → queued` 新 Attempt | 发送边界后不能盲重发 |
| 旧 Attempt `rejected → 当前新 Attempt=rejected` | 不同版本/Attempt 的事实不能串联覆盖 |
| 任一状态 → 另一个 store 的状态 | tenant/store 权限边界禁止 |
| 缺失状态 → `0/通过/完整` | unknown/partial 不得补零或伪造完整 |

## 7. 页面标签、筛选与 read model 映射

页面只消费稳定 code、结构化轴和 `allowedActions`；前端不得从 Draft/Batch/Review/Readback 再做二次 reducer。

### 7.1 草稿箱

| editingState | 页面标签 | 是否进入默认草稿箱 | 允许动作 |
| --- | --- | --- | --- |
| `editing` | 待完善 | 是 | 编辑、保存、预检、归档 |
| `blocked` | 需处理（预检阻断） | 是 | 编辑、查看阻断、重新预检、归档 |
| `ready` | 待提交 | 是 | 查看、提交并交接、归档 |
| `handed_off` | 已交接 | 否 | 查看历史/跳转发布中心 |
| `archived` | 已归档（本地） | 否 | 回收站查看、受控恢复 |

### 7.2 发布/审核中心

| 组合事实 | resolution code | 中文标签 | 分栏/动作 |
| --- | --- | --- | --- |
| queued | `publish_queued` | 排队中 | 全部 / 等待 |
| claimed/submitting | `publish_executing` | 发布执行中 | 全部 / 等待 |
| accepted，无官方接收/审核 | `publish_submitted_waiting_receipt` | 已提交，待回执 | 全部 / 等待并刷新 |
| result_unknown | `publish_result_unknown` | 结果待确认 | 需处理 / 先回读，禁止重发 |
| known_failed + retryable | `publish_failed_retryable` | 发布失败，可重试 | 需处理 / 仅安全重试 |
| known_failed + terminal | `publish_failed_terminal` | 发布失败，需处理 | 需处理 / 返回编辑或解决 |
| receive accepted，无更细官方阶段 | `official_received_waiting_review` | 已接收，待审核 | 待审核 |
| pending_review | `official_awaiting_review` | 待审核 | 待审核 |
| pricing | `official_awaiting_price` | 待核价 | 待核价 |
| sample | `official_awaiting_sample` | 待寄样 | 待寄样 |
| design_review | `official_awaiting_version_review` | 待审版 | 待审版 |
| sample_review | `official_awaiting_sample_review` | 待核样 | 待核样 |
| final_review | `official_awaiting_final_review` | 待终审 | 待终审 |
| rejected | `official_rejected` | 已驳回 | 已驳回 / 修正并重发或新商品 |
| withdrawn | `official_withdrawn` | 已撤回 | 需处理 / 重新发起 |
| approved，未确认上架 | `official_passed` | 审核通过 | 全部 / 继续后续流程 |
| listed | `listed` | 已上架 | 从当前待处理列表移出，保留历史 |
| unknown/conflict | `official_state_unknown` 或 `listing_unknown` | 官方状态待确认 | 全部/诊断，不显示成功 |

`needs_action` 是跨域运营聚合，只能由原因列表、权限和允许动作组成，例如 `preflight_blocked`、`official_rejected`、`result_unknown`、`unsupported_manual`；它不能替代官方审核状态。

### 7.3 所有页面必须显示的证据最小集

任一当前状态至少可追溯：

- `tenantId`、`storeId`、CatalogProduct/CatalogSku/SKC/SKU；
- `currentVersionId`、`currentAttemptId`、父 Attempt 和 supersedes 关系；
- 状态轴 code，而不是单一 `status`；
- 原始来源字段、source map version、发生时间/`asOf`、schema/rule/version fingerprint；
- `traceId`、operationId、错误 code/message（按权限裁剪）；
- `allowedActions` 和阻断原因。

## 8. 旧状态兼容读取与迁移策略

ERP-04 不直接迁移存量数据。ERP-05 先建立只读关系报告，ERP-06 再按批准的结构化模型做 additive 迁移。兼容层必须“先保留证据、后映射”，不允许用猜测覆盖旧值。

### 8.1 `product_drafts.status` 只读映射

| 旧值 | 兼容映射 | 额外要求 |
| --- | --- | --- |
| `draft` | `editing` | 记录 `legacy_status=draft` |
| `blocked` | `blocked` | 保留旧 preflight 原文并重新核对 |
| `ready` | `ready` | 必须确认对应 schema/rule snapshot 未失效 |
| `archived` | `archived` | 不删除平台/版本证据 |
| `published` | 不直接映射官方状态 | 只有存在可验证 handoff/Version 证据才可得到 `handed_off`；否则标 `legacy_unversioned` |
| `waiting_review`/`submitted` | 不直接映射官方审核 | 结合 Attempt、receipt、Webhook/readback 精确绑定；无法绑定为 `unknown/unmatched` |
| 其他/空值 | `unknown` | 原始值保留，进入诊断 |

### 8.2 `publish_jobs.state` 只读映射

| 旧值 | executionState | 不能映射 |
| --- | --- | --- |
| `authorized` | `queued` 或 `not_started`，取决于是否已有 Outbox/queue 证据 | 不能映射 accepted |
| `claimed` | `claimed` | 不能映射 SHEIN 接收 |
| `submitted` | `accepted`（仅当原始 SHEIN 响应已保存且可验证）否则 `result_unknown` | 不能映射审核通过/上架 |
| `completed` | 保留为旧本地完成证据；规范 execution 需按 send/receipt 证据重建 | 不能单独映射 accepted/listed |
| `failed_retryable` | `known_failed` + retryable | 不能映射官方 rejected |
| `failed_terminal` | `known_failed` + terminal | 不能映射官方 rejected |
| `result_unknown` | `result_unknown` | 禁止自动重发 |

### 8.3 审核、平台投影和无法归属数据

1. `product_review_states` 只作为兼容投影来源，必须保存官方原始 code、字段名、来源事件/回读和 source map version。
2. `spus/skcs/skus` 继续作为 SHEIN 官方只读投影；没有 `PlatformProductLink` 不能自动创建本地商品映射。
3. 历史关系必须分类为 `mapped`、`legacy_unversioned`、`unmatched` 或 `conflict`。
4. `unmatched` 不得放入某个商品当前页签；`conflict` 不得按时间选择一条“看起来最新”的记录。
5. 任何兼容读取都不能产生生产写入、自动补 version、自动补 Attempt 或自动删除旧记录。

## 9. 历史问题到状态不变量的映射

| 历史问题 | 本设计不变量 |
| --- | --- |
| `BUG-PROD-001/002/004/007` | CatalogProduct/CatalogSku、ProductVersion、Attempt 和 current pointer 分离；不以 Draft、Job 时间或 SHEIN version 猜身份 |
| `BUG-PROD-003` | Draft 只有 editing 轴；handed_off、审核和上架不写回 Draft |
| `BUG-PUB-001/010/012` | accepted、official review、listing、result_unknown 正交；send_started 后禁止盲重试 |
| `BUG-PUB-005/006/014` | Attempt 必须绑定不可变 Version；批次/命令状态不覆盖单项当前事实 |
| `BUG-REV-005/006/007` | 先绑定 current Attempt，再按官方 code reducer；页面只消费稳定 Snapshot，不二次分类 |
| `BUG-STORE-004/005/008` | 所有身份和查询先限定 tenant/store；切店、授权和状态不可跨店回退 |
| `BUG-GROW-001/002/006` | 商品生命周期不是销量标签；至少按 store/SKC/site/ProductVersion 作用域，unknown 不自动放量/淘汰 |
| `BUG-WORK-001/004/007` | WorkItem、Command、Receipt、Review 和官方状态正交；人工任务完成不代表业务或 SHEIN 成功 |
| `BUG-BI-001/005/006` | 指标/报表消费规范状态和证据，不能把 unknown/partial 补成 0 或完整 |

## 10. 后续实现边界

本设计只授权后续步骤按此语义实现，不授权本 Run 直接改代码：

1. ERP-05：只读盘点旧 Draft/Batch/Job/Receipt/Review/SPU/SKC/SKU/媒体关系，输出 mapped/unmatched/conflict 报告。
2. ERP-06：按批准结果增加 CatalogProduct/CatalogSku/ProductVersion/Link/Event 等结构化事实和约束；已有迁移不得改名或覆盖。
3. ERP-07～ERP-10：分别硬化 SHEIN adapter、Control/Worker、发布命令和官方回读，必须沿用本字典。
4. ERP-11～ERP-14：统一 Snapshot、Draft handoff、页面和 ProductWorkbench；前端不得重新分类。
5. 任何真实 SHEIN 写入、生产迁移、生产部署均不属于本 Run，必须在对应步骤重新申请和记录授权。

## 11. ERP-04 完成门与待批准项

### 已完成的设计交付

- [x] 对象职责和地毯 Product/SKC/SKU 边界。
- [x] 六维状态字典、事实源、进入/退出/终态语义。
- [x] 当前版本/当前 Attempt 选择规则和父子关系。
- [x] 旧驳回、新重发、result_unknown 恢复矩阵。
- [x] 合法转换矩阵和非法转换矩阵。
- [x] 中文标签、筛选分栏和 allowedActions 映射。
- [x] 旧状态兼容读取与 ERP-05/06 分阶段迁移策略。
- [x] 历史问题到状态不变量的映射。

### 用户批准结果

用户已明确确认以下两项按本文执行：

1. 中文页面名称是否采用“待完善、需处理（预检阻断）、待提交、排队中、发布执行中、已提交待回执、结果待确认、待审核、待核价、待寄样、待审版、待核样、待终审、已驳回、已撤回、审核通过、已上架”等精确标签；禁止通用“已发布”。
2. “修正并重发”必须新 Draft revision + 新 ProductVersion + 新 Attempt；`result_unknown` 在官方回读/人工对账前禁止重发；“作为新商品创建”必须 fork 新 CatalogProduct，是否同意。

批准结果：PASS。本 Run 更新为 `COMPLETE`，允许创建 ERP-05 Run；ERP-05 仍只允许做历史数据只读证据盘点。

## 12. 回滚与安全结论

本 Run 仅新增/更新非敏感 Markdown 设计记录。回滚点是 Run 启动前的文档提交 `805a43d`；用户批准后没有新增业务代码、数据库、Redis、对象存储、生产配置或 SHEIN 数据变更。

本设计不会把任何页面截图、HTTP 200、本地队列完成或 GitHub Actions 成功解释成 SHEIN 商品已接收、已审核或已上架。
