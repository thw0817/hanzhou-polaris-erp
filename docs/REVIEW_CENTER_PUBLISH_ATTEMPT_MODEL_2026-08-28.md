# 商品审核中心发布尝试模型与幂等边界

日期：2026-08-28
对应实施步骤：第 4 步——建立发布尝试模型：一次发布、重发、版本、幂等和结果确认
前置设计：[REVIEW_CENTER_STATUS_DICTIONARY_2026-08-28.md](./REVIEW_CENTER_STATUS_DICTIONARY_2026-08-28.md)
范围：首次发布、驳回重发、批量发布、重复点击、队列执行、SHEIN 平台标识、官方回读、结果未知和历史关联

## 0. 本文边界

本文是只读建模结果，不是代码修复或数据库迁移执行记录。

本步没有：

- 修改前端、Control、服务、Worker、SHEIN 适配器或数据库代码。
- 修改 Postgres、Redis、Webhook 或历史发布记录。
- 调用 SHEIN 商品发布、商品编辑、删除或合规写接口。
- 消费历史发布授权、重试历史任务或部署云端。

目标是先把“哪一次发布”“哪个商品版本”“哪个结果”“能不能重试”定义清楚，再进入第 5 步统一快照实现。

## 1. 当前实际模型

### 1.1 当前四层记录

当前系统不是只有一个发布状态，而是以下四层记录并行存在：

```text
publish_batches
  └── publish_batch_items
        └── publish_execution_runs
              └── publish_jobs
                    ├── publish_receipts
                    ├── Webhook 关联
                    └── document-state / SPU / 合规回读
```

它们的职责不同：

| 层 | 当前主键/唯一约束 | 代表什么 | 不代表什么 |
| --- | --- | --- | --- |
| `publish_batches` | `(tenant_id, store_id, idempotency_key)` | 一次用户请求的批次容器 | 不代表 SHEIN 已收到 |
| `publish_batch_items` | `(batch_id, product_draft_id)` | 批次内草稿的预检/批次操作状态 | 不代表实际调用次数 |
| `publish_execution_runs` | `(tenant_id, store_id, authorization_id)`及授权指纹 | 一次性执行授权和一批请求的运行容器 | 不代表每个 SKC 都成功 |
| `publish_jobs` | `(tenant_id, store_id, request_key)` | 执行计划中一条冻结的 SHEIN 商品请求 | 不代表官方审核通过 |
| `publish_receipts` | `(publish_job_id, receipt_type, dedupe_key)` | 发布、接收、审核、回读等追加证据 | 不是唯一当前展示状态 |
| `product_review_states` | `(tenant_id, store_id, review_key)` | 审核读投影和本地归档 | 不是完整发布执行历史 |

### 1.2 当前一次直接发布的实际流程

审核中心当前页面调用的是：

```text
前端生成 idempotencyKey
  → POST /v1/web/stores/:storeId/publish-now
  → 创建 direct:<idempotencyKey> 的 publish_batch
  → 插入 publish_batch_items
  → 本地发布候选检查
  → SHEIN 只读额度/权限/供应商 SKU 等预检
  → 每个 item 准备 remotePublishCandidate
  → 批次 confirm
  → 生成 executionPlan
  → 生成一次性 executionProtocol
  → 消费 protocol，打开本次执行授权
  → 创建 publish_execution_runs / publish_jobs
  → BullMQ shein-product-publish
  → Worker claim publish_job
  → 冻结候选指纹校验
  → SHEIN product/publishOrEdit 写接口
  → accepted / unknown / failed
  → publish_receipts、Webhook、document-state 回读
```

`publish-now` 的 HTTP 成功返回主要表示“本地批次和队列流程已接受”，返回 `executionStage=queued` 不能表示 SHEIN 已收到，更不能表示审核通过或已上架。

### 1.3 当前保留的另一条批次操作路径

客户端还保留：

```text
POST /publish-batches/:batchId/actions
```

它支持 `preflight`、`confirm`、`plan-execution`、`authorize-execution`、`execute`、`pause`、`resume`、`retry`。当前审核中心页面主要直接调用 `publish-now`，所以系统同时存在：

1. 页面实际使用的 direct publish 组合流程。
2. API 中保留的分阶段 batch action 流程。

第 4 步不删除旧路径，但必须把两条路径最终归一到同一个发布尝试模型；在完成前不能把它们当成两个互不相关的业务状态机。

## 2. 当前字段的语义核对

### 2.1 幂等键有三种不同层级

当前存在三种容易被误称为“幂等”的键：

| 键 | 当前来源 | 作用 | 当前边界 |
| --- | --- | --- | --- |
| 页面 `idempotencyKey` | `crypto.randomUUID()` 或相同页面动作复用 | 识别一次用户请求，网络不确定时避免重复创建批次 | 页面刷新后丢失；已知失败后的显式重试语义不够清楚 |
| 批次 `direct:<key>` | `publishNow()` 服务端加前缀 | 防止同一请求重复创建 `publish_batches` | 只保证批次层去重，不单独保证 SHEIN 请求不重复 |
| `publish_jobs.request_key` | execution plan 指纹 | 保证一个冻结计划中的一条请求不重复插入 | 不是“同一草稿永远只能发布一次”，重发必须生成新 key |

此外还有：

- source candidate fingerprint：防止草稿/发布候选发生变化后继续执行旧载荷。
- remote candidate fingerprint：防止远程预检结果与执行载荷不一致。
- execution plan fingerprint：防止执行计划被替换。
- authorization fingerprint：防止授权协议被替换。
- receipt dedupe key：防止同一回执证据重复写入。

这些指纹解决的是“快照是否被篡改”和“记录是否重复”，不能替代当前尝试、父子重发关系和平台版本关联。

### 2.2 两个 `attempt_count` 不是同一个数

当前代码中至少有两个同名但不同含义的计数：

| 字段 | 增长时机 | 正确命名语义 |
| --- | --- | --- |
| `publish_batch_items.attempt_count` | `recordPreflight()` 更新条目时增长 | 预检/批次处理次数 |
| `publish_jobs.attempt_count` | Worker `claimNextJob()` 领取任务时增长 | 实际执行领取次数 |

因此页面显示的“发起次数”不能直接把这两个字段任意相加，也不能把预检次数当作 SHEIN 调用次数。后续模型必须分别命名：`preflightAttemptCount`、`executionAttemptCount`、`businessAttemptNo`。

### 2.3 当前 `publish_jobs.state` 是执行状态，不是完整业务状态

当前任务状态：

```text
authorized
  → claimed
  → submitted
  → 通过回执/回读后可能 completed

claimed
  → failed_retryable
  → failed_terminal
  → result_unknown
```

语义如下：

| 原始状态 | 进入者 | 需要的证据 | 是否允许再次执行 |
| --- | --- | --- | --- |
| `authorized` | 执行授权消费前创建 | 执行计划、授权协议、指纹 | 仅由当前有效授权领取 |
| `claimed` | Worker 原子领取 | 租约、worker、claim ID | 同一 claim 外禁止并发执行 |
| `submitted` | SHEIN 写接口返回结构化 accepted | 有效 success、SPU、SKC、SKU、version 等 | 不能直接重复；等待接收/审核回读 |
| `result_unknown` | 网络、租约或未知响应 | 不能安全判断写入结果 | 禁止自动重发，先官方回读 |
| `failed_retryable` | 明确可重试失败 | 上游明确失败且非未知 | 只能按安全重试规则再次执行 |
| `failed_terminal` | 明确不可继续失败 | 额度、候选失效、字段阻断等 | 新动作需新业务尝试或先处理原因 |
| `completed` | 审核、关系回读、合规闭环达到本地完成标准 | 由回读链路更新 | 终态，不重复执行 |

`submitted` 只说明本地已经拿到有效的提交接受结果；`completed` 也必须遵守第 3 步定义，不能仅凭本地任务完成显示 SHEIN 已上架。

## 3. 发布尝试的统一定义

### 3.1 一次业务尝试的定义

一次业务发布尝试是：

```text
针对一个租户、一个店铺、一个本地草稿快照、一个明确用户动作，
产生的一组不可替换的本地执行记录和后续 SHEIN 平台证据。
```

它必须具有稳定身份：

```text
businessAttemptId
  ├── tenantId
  ├── storeId
  ├── productDraftId
  ├── businessAttemptNo
  ├── reason: first_publish | rejected_relaunch | explicit_retry | recovery_retry
  ├── parentAttemptId / supersedesAttemptId
  ├── requestId / idempotencyKey
  ├── sourceCandidateFingerprint
  ├── remoteCandidateFingerprint
  ├── publishJobId
  ├── sheinVersion
  ├── sheinDocumentSn
  └── lifecycle timestamps
```

当前系统没有独立的 `businessAttemptId` 表，也没有明确 `parentAttemptId`/`supersedesAttemptId`。目前只能从 batch、job、version、SKC 和时间拼接推测，这不足以支撑稳定的“重发后旧驳回移出当前列表”。

### 3.2 一次尝试的最小身份组合

后续实现必须按以下优先级建立身份关联：

1. `tenantId + storeId`：绝不能跨店铺或跨租户匹配。
2. `publishJobId`：本地执行尝试的最强身份。
3. `requestKey`：同一冻结请求的幂等身份。
4. `sheinVersion`：SHEIN 平台版本，存在时用于官方回读精确绑定。
5. `sheinDocumentSn`：平台文档号，存在时用于官方回读精确绑定。
6. `productDraftId`：本地草稿关联。
7. `skcName`/`spuName`/SKU：只作为辅助匹配，不能在有冲突时单独决定当前尝试。

`reviewKey` 是审核投影索引，不是完整的一次发布尝试身份。尤其是 `reviewKey=skc:<skcName>` 不能区分同一 SKC 的两次没有 version/document 的重发。

## 4. 首次发布和重发规则

### 4.1 首次发布

首次发布产生：

```text
businessAttemptNo = 1
reason = first_publish
parentAttemptId = null
supersedesAttemptId = null
```

它可以经历预检失败、队列失败、SHEIN 明确失败或官方回读，但不能把失败原因直接写成平台审核驳回，除非有当前尝试的官方 `audit_state=3`。

### 4.2 驳回后重新发起

从“已驳回”点击重新发起时：

```text
旧尝试：保留为历史，状态 official_rejected
新尝试：生成新的 businessAttemptId 和 businessAttemptNo
新尝试：parentAttemptId = 旧尝试
新尝试：使用新的 source/remote candidate fingerprint
新尝试：等待新的 SHEIN version/document
```

旧版本不能继续作为当前审核行；但旧驳回原因、时间、平台 version/document、发起人和次数必须保留在历史时间线。

不能因为“从驳回中重发”就本地假定免额度。是否占用额度只能以 SHEIN 官方额度和接收结果为准；重发只是新的业务尝试，不能绕过真实额度预检。

### 4.3 已知终态失败后的重试

例如额度为 0、候选快照失效、字段阻断等 `failed_terminal`：

1. 先展示明确失败原因。
2. 原尝试保持历史终态，不改成成功或驳回。
3. 用户修正原因后点击发布，创建新的业务尝试和新的幂等键。
4. 新尝试重新读取/验证当前草稿和官方额度，不能复用旧的 remote candidate。

### 4.4 可安全重试的明确失败

`failed_retryable` 可以复用同一业务尝试，但必须：

- 只重试明确失败的 `publish_job`，不能整批重发已经成功/未知的其他 job。
- 保留原执行次数、最近错误、每次重试时间和 traceId。
- 重试前再次确认当前候选指纹没有变化。
- 如果平台已返回任何可能代表接收的标识，则不能继续按可重试失败处理。

### 4.5 结果未知后的恢复

`result_unknown` 的流程必须是：

```text
result_unknown
  → 官方 document-state / 接收回执查询
      ├── 明确已接收/有 version → 恢复为 submitted，绑定平台标识
      ├── 明确审核通过/驳回/撤回 → 直接进入对应官方状态
      ├── 明确没有当前版本且平台确认未接收 → 用户明确确认后新尝试
      └── 仍然无法确认 → 保持 result_unknown
```

禁止：

- 仅因为 HTTP 超时就认定 SHEIN 没收到。
- 仅因为页面没有看到商品就认定失败。
- 未做官方回读就自动重新提交。
- 把 `result_unknown` 显示为“已驳回”或“待审核”。

## 5. 幂等和重复点击模型

### 5.1 同一动作的重复请求

下列情况必须使用同一个幂等键：

- 用户点击后浏览器等待超时，但不知道服务端是否已创建批次。
- 前端请求重试但 draft 集合和候选快照没有变化。
- 网络断开后用户重新打开同一页面，希望恢复请求结果。

同一幂等键再次到达时，服务端必须返回原批次、原业务尝试和原结果，不得创建新的 SHEIN 写任务。

### 5.2 新动作不能复用旧幂等键

下列情况必须生成新的幂等键：

- 用户明确点击“重新发起”驳回商品。
- 用户修正额度、字段、图片或草稿内容后再次发布。
- 原尝试已明确 `failed_terminal`，用户重新开始一次发布。
- 当前选择集合发生变化。
- 草稿的 source candidate fingerprint 发生变化。

同一 draft ID 不是复用幂等键的理由；同一草稿可以有多次业务尝试。

### 5.3 批量动作的部分结果

批量发布必须以“每个 draft/SKC 一个独立尝试结果”为准：

```text
批次请求
  ├── SKC-A → submitted
  ├── SKC-B → failed_terminal
  ├── SKC-C → result_unknown
  └── SKC-D → rejected by SHEIN
```

不能因为批次整体 HTTP 200 就把四个商品都显示为发布成功，也不能因为一个商品失败就把整个批次都显示为驳回。

## 6. 证据门和状态转换

### 6.1 允许的转换

```text
本地草稿 ready
  → batch queued
  → preflight passed
  → execution authorized
  → job claimed
  → SHEIN accepted
  → submitted
  → receive accepted
  → audit pending / workflow stage
  → audit passed / rejected / withdrawn
  → 后续核价、寄样、审版、核样、终审
  → 官方上架或业务完成
```

失败分支：

```text
ready / preflight
  → failed_terminal（本地或官方明确阻断）

claimed
  → failed_retryable（明确可重试）
  → result_unknown（不能判断是否已写入）

submitted
  → 官方接收失败
  → 官方审核失败/撤回
  → 官方审核通过
```

### 6.2 不能直接转换的边界

| 看到的证据 | 不允许直接转换为 |
| --- | --- |
| batch `queued` | SHEIN 已接收、待审核、审核通过 |
| batch item `ready` | SHEIN 已发布 |
| execution run `running` | 商品已经写入 SHEIN |
| job `submitted` | 官方审核中、审核通过、已上架 |
| HTTP 200 | 所有商品成功 |
| SHEIN 接收成功 | 审核通过、已上架 |
| `audit_state=1` | 待核价、待寄样、待审版等具体后续阶段 |
| `audit_state=2` | 已上架 |
| `audit_state=3` | 本地发布失败 |
| 本地 `failed_terminal` | SHEIN 驳回 |
| `result_unknown` | SHEIN 没收到、发布失败或可直接重发 |
| 没有出现在 SHEIN 某列表 | 已驳回或没有提交 |

### 6.3 额度边界

额度相关状态必须按以下规则处理：

1. 本地预检读取到额度为 0：在 SHEIN 写入前阻断，状态为 `preflight_blocked`/需处理。
2. 真实发布请求未调用 SHEIN：不能产生 `sheinVersion` 或 `sheinDocumentSn`，也不能显示已提交。
3. SHEIN 明确返回额度错误：状态为 `publish_failed_terminal`，原因保留官方 code/message/trace。
4. SHEIN 接受请求后才允许本地临时更新额度投影；官方额度事件/回读可以覆盖临时值。
5. 重发是否免额度不能由本地根据“旧记录已驳回”推断。
6. 结果未知时不能扣减或恢复额度，除非官方接收/额度证据明确给出结论。

## 7. 当前模型的关键缺口

### 7.1 没有显式当前尝试指针

当前审核聚合依靠：

- `publish_jobs` 按更新时间排序。
- `shein_version` 关联。
- `skcName` 关联。
- `currentLaunchBySkc` 推断。
- 旧驳回时间与本地任务时间比较。

这能覆盖一部分场景，但无法稳定表达：

- 两次发布都没有 version 的情况。
- 同一草稿并行产生两个不同批次。
- 当前请求结果未知但旧版本已有驳回。
- 多个同 SKC 任务的 Webhook 到达顺序颠倒。

### 7.2 没有显式父子重发关系

旧版本和新版本目前主要靠时间、version 和 SKC 推断。缺少：

```text
supersedesAttemptId
parentAttemptId
businessAttemptNo
currentAttempt
currentAttemptReason
```

因此“已驳回重新发起后旧行应立即移出”没有一个单一、可查询、可审计的依据。

### 7.3 `request_key` 不能单独承担业务尝试身份

`request_key` 保证执行计划内一条请求不重复，但它是执行层 key：

- 不能替代用户业务尝试 ID。
- 不能表达重发父子关系。
- 不能单独表达同一 draft 的不同版本。
- 不能决定哪个尝试是当前展示尝试。

### 7.4 批次状态和任务状态可能暂时不一致

批次、条目、执行 run、job 分别更新。虽然已有事务和失败对齐逻辑，但仍存在需要后续回归覆盖的窗口：

- 批次已入队但 job 尚未被 Worker 读取。
- Worker 领取后进程退出，job 变成结果未知。
- job 已提交但批次缓存仍是 ready。
- Webhook 已到达但前端仍持有旧 product-reviews 缓存。
- 部分批次完成、部分失败时批次级状态不能代表每个 SKC。

### 7.5 前端页面状态与服务端尝试状态尚未统一

当前页面用 `publishAttemptRef` 在当前浏览器内复用 idempotency key：

- 已知失败后 ref 没有明确清理，可能把用户新的显式重试当成旧请求回放。
- 页面刷新会丢失 ref，无法仅靠前端判断是恢复原请求还是新尝试。
- 选择集合按 draft ID 组成 key，没有把草稿候选 fingerprint、当前版本或重发原因纳入页面动作语义。
- 发布成功后清空 ref；但服务端是否已经收到/审核，仍需依靠服务端尝试记录和官方回读。

这不是简单的前端按钮问题，必须由服务端尝试模型给出最终判定。

## 8. 建议的最小统一模型

第 5 步不建议马上引入复杂工作流平台；结合当前 Postgres + BullMQ 架构，先增加一个轻量的业务尝试层即可。

### 8.1 逻辑实体

```text
product_publish_attempts
  id
  tenant_id
  store_id
  product_draft_id
  business_attempt_no
  reason
  parent_attempt_id
  supersedes_attempt_id
  current_state
  current_flag
  idempotency_key
  source_candidate_fingerprint
  remote_candidate_fingerprint
  publish_batch_id
  publish_batch_item_id
  publish_job_id
  shein_version
  shein_document_sn
  created_by
  created_at
  updated_at
  completed_at
```

建议约束：

- `(tenant_id, store_id, idempotency_key)` 唯一。
- `(tenant_id, store_id, product_draft_id, business_attempt_no)` 唯一。
- 同一店铺同一草稿最多一个 `current_flag=true`。
- `parent_attempt_id` 和 `supersedes_attempt_id` 必须属于同租户同店铺。
- version/document 绑定后不能被不同尝试覆盖。
- 归档历史不能删除尝试和证据。

这是后续设计建议，不代表现在已经创建表。

### 8.2 与现有表的关系

```text
product_publish_attempts
  1 ── 1/多 publish_batches（按入口兼容）
  1 ── 1 publish_batch_item
  1 ── 1 publish_job（一个 draft 的一次 SHEIN 请求）
  1 ── 多 publish_receipts
  1 ── 多 product_review_states / 官方状态证据
```

如果暂时不添加新表，也必须在统一服务层构造等价的逻辑对象，并明确缺少 `currentAttemptId` 的记录只能降低置信度，不能凭 SKC 名称强行合并。

### 8.3 逻辑状态和业务结果分离

尝试实体至少同时保存：

```text
executionState: queued | claimed | submitted | result_unknown | failed | completed
receiveState: accepted | failed | unknown | null
auditState: pending | passed | failed | withdrawn | unknown | null
workflowStage: explicit stage | null
listingState: listed | not_listed | unknown
resolution: 第3步统一状态字典中的 code/tab/displayLabel
```

这样才能表达：

```text
execution=submitted
receive=accepted
audit=pending
workflowStage=awaiting_price
listing=not_listed
resolution=official_awaiting_price
```

而不是用一个 `state=completed` 或 `status=审核中` 覆盖全部事实。

## 9. 回执关联规则

### 9.1 关联官方回执

官方回执到达时，必须按下列顺序关联：

1. 租户/店铺作用域。
2. `documentSn + version` 精确匹配。
3. `version + spuName + skcName/skuCode` 精确匹配。
4. 只有平台没有 version/document 时，才允许使用受限的草稿/SKC 辅助匹配。
5. 匹配 0 条：保存未关联证据，不能丢弃，也不能编造当前状态。
6. 匹配多条：标记 ambiguous，不能任选最新一条覆盖。
7. 匹配成功：只更新对应尝试，不修改其他版本尝试。

当前 `appendExternalReceipts()` 已有精确关联和 ambiguous/unmatched 计数，但统一快照必须把这些计数和证据暴露出来，不能只在后台日志中消失。

### 9.2 Webhook 和 document-state 的关系

二者都是官方证据，但不是两个业务尝试：

- Webhook 是异步事件证据。
- document-state 是主动官方回读证据。
- 同一 version/document 的两种证据应合并到同一尝试的 evidence timeline。
- document-state 不能因为后到就无条件覆盖更新的官方 Webhook；必须按官方发生时间、来源和字段级合并。
- 空 document-state 只说明本次查询没有返回当前记录，不代表平台删除了旧状态。

### 9.3 发布响应和接收 Webhook 的关系

SHEIN 发布响应的 version/SPU/SKC 是“请求接受/平台标识证据”；接收 Webhook 是“平台文档接收证据”。

两者必须分别存储、分别展示，不能把发布响应直接当作接收 Webhook，也不能把接收成功直接当作审核通过。

## 10. 操作权限与重试决策

每个尝试必须由服务端返回明确的操作决策：

| resolution/actionability | 允许操作 |
| --- | --- |
| `wait` | 等待，不允许再次发布 |
| `wait_and_refresh` | 手动刷新/官方回读，不允许直接重发 |
| `refresh_before_retry` | 必须先回读，回读确认未接收后才允许新尝试 |
| `retry_same_attempt` | 只重试明确失败的当前请求 |
| `edit_or_resolve` | 修改本地阻断项后创建新尝试 |
| `relaunch_or_edit` | 驳回/撤回后关联草稿重新编辑或新尝试 |
| `platform_action` | 等待或执行平台要求的核价/寄样/审版动作 |
| `continue_workflow` | 进入官方后续流程，不显示已上架 |

前端按钮不能只依据 `draft.status`、`label` 或“曾经发起过”决定是否允许重发。

## 11. 必须覆盖的回归场景

### 11.1 幂等场景

1. 同一请求重复提交两次，只创建一个 batch、一个 execution run 和一组 jobs。
2. 第一次请求超时，第二次用同 key 查询/重放，返回同一尝试。
3. 不同 key 的明确重发创建新的业务尝试。
4. 选择集合不同，不能复用旧 batch。
5. 候选 fingerprint 改变，不能复用旧执行计划。
6. 授权过期后不能执行旧协议。
7. 已消费授权再次执行只返回幂等结果，不重复入队。

### 11.2 重发场景

1. 旧版本已驳回，新版本未回读：当前只显示新尝试等待，旧驳回进入历史。
2. 旧版本已驳回，新尝试本地预检额度为 0：显示发布预检失败，不显示旧驳回作为本次结果。
3. 旧版本已驳回，新版本官方再次驳回：新尝试重新进入已驳回，历史中保留两次原因。
4. 同一 SKC 两个没有 version 的尝试：不能只凭 SKC 合并。
5. 驳回重发不能绕过官方额度预检。
6. 驳回重发不应自动继承旧版本已失效的 remote candidate。

### 11.3 结果未知场景

1. Worker 租约过期 → result_unknown，禁止自动重发。
2. SHEIN 请求网络超时 → result_unknown，必须官方回读。
3. 回读明确找到 version → 恢复并绑定当前尝试。
4. 回读明确未接收 → 用户确认后创建新尝试。
5. 回读仍为空但接口不可用 → 保持未知，不当作失败。
6. 结果未知与旧驳回同时存在 → 旧驳回不覆盖当前未知尝试。

### 11.4 部分批次场景

1. 一批 10 个商品中 8 个 submitted、1 个 terminal failure、1 个 unknown，页面逐条展示。
2. 某个 job 成功不能使整个 batch 变 completed。
3. 某个 job 失败不能使其他 submitted job 自动重试。
4. 批次整体状态只能是汇总，不得替代 item/attempt 状态。

### 11.5 证据顺序场景

1. audit rejected 先到，receive accepted 后到：当前仍已驳回，保留两轴证据。
2. receive accepted 先到，audit pending 后到：进入待审核。
3. 旧版本 rejected 后，新版本 submitted：旧拒绝不覆盖新尝试。
4. document-state 空响应后收到 Webhook：Webhook 正常补充状态。
5. Webhook 重复到达：不重复增加发起/驳回次数。
6. 多条回执无法唯一匹配：显示关联待确认，不随机覆盖。

## 12. 第 4 步结论

第 4 步冻结以下结论：

1. 当前批次、条目、执行 run、发布 job 不能直接等价为一次完整业务尝试。
2. 后续必须引入或构造一个稳定的 `businessAttemptId`，并保存当前尝试、父尝试、被替代尝试和业务尝试序号。
3. 同一幂等键只用于恢复同一用户动作；明确重发、草稿变更和候选变化必须生成新幂等键和新业务尝试。
4. `failed_terminal`、`failed_retryable`、`result_unknown`、平台接收、官方审核和上架是不同边界。
5. 结果未知必须先官方回读，不能自动重发。
6. 驳回重发必须按新尝试处理，旧驳回进入历史，且不能绕过官方额度预检。
7. 额度只有在官方接受证据出现后才能按官方/受控本地投影更新，不能因排队或预检成功扣减。
8. `publish_batch_items.attempt_count` 和 `publish_jobs.attempt_count` 必须改用不同业务名称，不能继续让页面将其混称为发起次数。
9. 官方 version/document 存在时必须精确绑定；缺少平台标识时不能只凭 SKC 名称合并多个尝试。
10. 批次级结果只能是汇总，当前审核中心必须以每个 SKC 当前业务尝试为展示和操作单位。

第 4 步已完成。第 5 步可以在此模型和第 3 步状态字典基础上设计统一审核中心快照接口；在第 5 步完成前，不应继续增加新的局部重试、重发或状态标签分支。
