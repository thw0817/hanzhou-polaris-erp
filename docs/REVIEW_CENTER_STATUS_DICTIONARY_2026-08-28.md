# 商品审核中心统一状态字典与优先级

日期：2026-08-28
对应实施步骤：第 3 步——建立统一状态字典、来源优先级和状态转换边界
范围：商品审核中心的发布、接收、审核、核价/寄样阶段、驳回重发、回读和列表分类

## 0. 本文的边界

本文是第 3 步的只读设计产物，不是修复代码，也不是生产数据迁移方案。

本步没有：

- 修改前端、Control、Worker、SHEIN 适配器或数据库代码。
- 修改 Postgres、Redis、Webhook 记录或生产配置。
- 调用 SHEIN 商品发布、编辑、删除或其他写接口。
- 改变真实发布执行开关或部署云端。

本文只冻结后续实现必须遵守的状态语义，避免第 4 步开始后又出现“修复 A、破坏 B”。

## 1. 先固定一个原则：状态不是一个字段

一个 SKC 在同一时间至少有五条互相独立的事实轴：

```text
商品身份/当前尝试
        │
        ├── 本地发布执行：草稿是否可发、是否排队、是否已调用 SHEIN、结果是否未知
        ├── SHEIN 接收：平台是否接收商品文档
        ├── SHEIN 审核：官方 audit_state 及 workflow_stage
        ├── 上架事实：商品是否已经在 SHEIN 商品体系中上架
        └── 合规/寄样/核价：各自的独立业务状态
```

不能再把以下概念互相替换：

| 不能混用 | 正确含义 |
| --- | --- |
| “本地任务已入队” | 只证明本地队列接受了任务，不证明 SHEIN 收到商品 |
| “SHEIN 接收成功” | 证明平台接收了文档，不证明审核通过或已上架 |
| `audit_state=1` | 官方审核仍在进行/等待，不能推导为核价或寄样 |
| `audit_state=2` | 官方审核通过，不等于商品已经上架 |
| `audit_state=3` | 官方审核失败，展示为已驳回；这是平台事实，不是本地发布失败 |
| `audit_state=4` | 官方撤回，不能伪装成已驳回或已通过 |
| `shelf_status=已上架` | 商品已上架事实，优先于审核中心当前待处理展示 |
| `publish_jobs.state=completed` | 本地发布任务完成，仍需结合平台回执和上架事实 |
| `result_unknown` | 结果未知，既不能显示成功，也不能显示失败，更不能自动重发 |

## 2. 当前代码中的原始字段分类

### 2.1 草稿和预检字段：只代表本地可发布性

来源：`product_drafts.status`、批次条目 `publish_batch_items.state`。

当前可见值包括：

| 原始值 | 所属轴 | 说明 | 不能推导 |
| --- | --- | --- | --- |
| `draft` | 本地准备 | 草稿存在但未达到发布条件 | 不能推导 SHEIN 状态 |
| `blocked` | 本地准备 | 本地预检有阻断项 | 不能推导 SHEIN 驳回 |
| `ready` | 本地准备 | 本地草稿可进入发布流程 | 不能推导已提交 |
| `waiting_review` | 本地准备 | 历史/兼容草稿状态 | 不能直接当官方待审核 |
| `submitted` | 本地准备 | 历史/兼容草稿状态 | 不能替代 `publish_jobs` 和官方回执 |
| `archived` | 本地准备 | 本地草稿归档 | 不能删除平台事实 |
| `published` | 本地准备 | 历史本地标记 | 不能单独称为 SHEIN 已发布 |

批次条目当前值：

```text
queued → preflighting → ready → 执行后由发布任务/回执反映结果
paused / failed / completed
```

这些值服务于“本地操作能不能继续”，不属于审核中心的官方审核阶段。

### 2.2 发布任务字段：代表一次本地发布尝试

来源：`publish_jobs.state`。

| 原始值 | 规范含义 | 用户应看到的事实 | 是否能称为“发布成功” |
| --- | --- | --- | --- |
| `authorized` | 一次性执行授权已建立，尚未完成 SHEIN 调用 | 等待发送 | 否 |
| `claimed` | Worker 已领取任务并开始处理 | 发布执行中 | 否 |
| `submitted` | SHEIN 发布接口已接受当前请求并保存平台标识/版本（若返回） | 已提交，等待平台接收/审核回执 | 否，仍需官方确认 |
| `result_unknown` | 请求或执行结果无法安全判断 | 结果待确认 | 否，禁止自动重发 |
| `failed_retryable` | 明确失败且允许仅重试该请求 | 发布失败，可安全重试 | 否 |
| `failed_terminal` | 明确失败且当前请求不可继续 | 发布失败，需要处理 | 否 |
| `completed` | 本地执行任务闭环完成 | 本地任务完成 | 仍不能单独证明已上架 |

注意：`submitted` 是“写请求已被接受/已完成调用”的本地证据，不是 `audit_state=1`，也不是“待审核”。在官方审核或接收状态尚未返回前，统一显示为“等待 SHEIN 回执/结果待确认”，不能伪造审核阶段。

### 2.3 SHEIN 接收状态：平台收件轴

来源：`product_document_receive_status_notice` 及其投影。

| 规范值 | 来源字段 | 用户展示 | 后续边界 |
| --- | --- | --- | --- |
| `accepted` | `received_success=true` | SHEIN 已接收，等待官方审核 | 不能直接显示审核通过 |
| `failed` | `received_success=false` | 接收失败 | 归入需处理，但不能归入已驳回 |
| `unknown` | 缺失或无法确认 | 等待 SHEIN 接收回执 | 不能猜测 accepted/failed |

接收失败和审核驳回是两个不同阶段：前者说明平台没有正常接收文档，后者说明平台接收后审核不通过。

### 2.4 官方审核状态：唯一官方审核结果轴

来源：`product_document_audit_status_notice`、`product_document_audit_status_notice_all_channels`、`/open-api/goods/query-document-state`。

当前代码和数据库约束明确支持的 `audit_state`：

| `audit_state` | 原始标准标签 | 规范状态码 | 默认中文显示 | 当前审核中心分栏 |
| ---: | --- | --- | --- | --- |
| `1` | `pending` | `official_awaiting_review` | 待审核 | 待审核 |
| `2` | `passed` | `official_passed` | 审核通过 | 全部/后续上架流程 |
| `3` | `failed` | `official_rejected` | 已驳回 | 已驳回 |
| `4` | `withdrawn` | `official_withdrawn` | 已撤回 | 需处理（保留“已撤回”标签） |
| 缺失 | `unknown` | `official_state_unknown` | 官方状态待确认 | 全部/状态待确认 |

强制规则：

1. `audit_state=3` 必须压过陈旧的 `workflow_stage=awaiting_*`、本地 `submitted` 和旧的待审核投影。
2. `audit_state=4` 必须保持“已撤回”，不能被归类为“已驳回”；若平台要求重新发起，操作分栏可放入“需处理”，但内部状态仍是 `official_withdrawn`。
3. `audit_state=2` 只表示官方审核通过；若同时有明确的后续 `workflow_stage=awaiting_price` 等，应显示该明确阶段，而不是直接显示“已发布”。
4. 缺失或无法解析的官方状态必须保留原始值和来源，显示“官方状态待确认”，不能生成一个看似正常的 0 或通过状态。

### 2.5 官方工作流阶段：只接受明确阶段字段

来源：`workflow_stage`、`workflowStage`、`stage` 等明确工作流字段；当前后端已有别名归一化。

统一内部码和中文显示：

| 内部码 | 已识别别名 | 中文显示 | 分栏 |
| --- | --- | --- | --- |
| `awaiting_review` | `awaiting_review`、`pending_review`、待审核、审核中、提交中、已提交，待审核、已接收，待审核 | 待审核 | 待审核 |
| `awaiting_price` | `awaiting_price`、`pending_price`、待核价 | 待核价 | 待核价 |
| `awaiting_sample` | `awaiting_sample`、`pending_sample`、待寄样 | 待寄样 | 待寄样 |
| `awaiting_version_review` | `awaiting_version_review`、`pending_version_review`、待审版 | 待审版 | 待审版 |
| `awaiting_sample_review` | `awaiting_sample_review`、`pending_sample_review`、待核样 | 待核样 | 待核样 |
| `awaiting_final_review` | `awaiting_final_review`、`pending_final_review`、待终审 | 待终审 | 待终审 |
| `rejected` | `rejected`、`failed`、已驳回、审核失败 | 已驳回 | 已驳回 |
| `passed` | `passed`、`approved`、已通过 | 审核通过 | 全部/后续流程 |
| 未识别 | 其他非空值 | 官方阶段待确认 | 全部/状态待确认 |

规则：通用 `status`、`message`、失败原因文本和本地发起次数不能单独推导工作流阶段。只有明确阶段字段，或上述已确认的 `audit_state` 规则，才允许进入阶段分栏。

## 3. 统一对外状态模型（第 5 步实现时必须遵守）

后续统一快照不应只返回一个 `status` 字符串，至少应包含以下结构：

```text
item {
  identity: {
    tenantId,
    storeId,
    skcName,
    spuName,
    localAttemptId,       // publish_jobs.id，优先作为一次尝试的本地身份
    requestKey,
    sheinVersion,
    sheinDocumentSn,
    reviewKey             // 兼容/历史索引，不再单独承担当前尝试身份
  },
  currentAttempt: true|false,
  execution: {
    state,
    submittedAt,
    attemptCount,
    lastError,
    traceId
  },
  receive: {
    state: accepted|failed|unknown|null,
    occurredAt,
    source,
    traceId
  },
  audit: {
    state: pending|passed|failed|withdrawn|unknown|null,
    workflowStage,
    failedReasons,
    occurredAt,
    source,
    traceId
  },
  listing: {
    state: listed|not_listed|unknown,
    source,
    observedAt
  },
  resolution: {
    code,
    displayLabel,
    tab,
    actionability,
    confidence,
    asOf
  }
}
```

### 3.1 `resolution.code` 的规范集合

#### 本地准备和执行类

| code | 中文显示 | tab | actionability | 说明 |
| --- | --- | --- | --- | --- |
| `draft_incomplete` | 待完善 | 全部 | `edit` | 本地字段/预检未完成 |
| `preflight_blocked` | 需处理 | 需处理 | `edit` | 本地预检阻断，不是 SHEIN 驳回 |
| `publish_queued` | 排队中 | 全部 | `wait` | 已进入本地发布队列 |
| `publish_executing` | 发布执行中 | 全部 | `wait` | Worker 正在处理 |
| `publish_submitted_waiting_receipt` | 已提交，待回执 | 全部 | `wait_and_refresh` | SHEIN 写请求已接受，但官方接收/审核尚未确认 |
| `publish_result_unknown` | 结果待确认 | 需处理 | `refresh_before_retry` | 禁止直接重复发布 |
| `publish_failed_retryable` | 发布失败，可重试 | 需处理 | `retry_same_attempt` | 明确失败、允许安全重试 |
| `publish_failed_terminal` | 发布失败，需处理 | 需处理 | `edit_or_resolve` | 明确终态失败 |

#### 官方接收和审核类

| code | 中文显示 | tab | actionability | 说明 |
| --- | --- | --- | --- | --- |
| `official_received_waiting_review` | 已接收，待审核 | 待审核 | `wait` | 接收回执成功但尚无更细审核阶段 |
| `official_receive_failed` | 接收失败 | 需处理 | `resolve_and_retry` | 平台收件失败，不称为驳回 |
| `official_awaiting_review` | 待审核 | 待审核 | `wait` | `audit_state=1` 或明确审核阶段 |
| `official_awaiting_price` | 待核价 | 待核价 | `platform_action` | 明确 `workflow_stage` |
| `official_awaiting_sample` | 待寄样 | 待寄样 | `platform_action` | 明确 `workflow_stage` |
| `official_awaiting_version_review` | 待审版 | 待审版 | `platform_action` | 明确 `workflow_stage` |
| `official_awaiting_sample_review` | 待核样 | 待核样 | `platform_action` | 明确 `workflow_stage` |
| `official_awaiting_final_review` | 待终审 | 待终审 | `wait` | 明确 `workflow_stage` |
| `official_rejected` | 已驳回 | 已驳回 | `relaunch_or_edit` | `audit_state=3` 或明确官方驳回 |
| `official_withdrawn` | 已撤回 | 需处理 | `relaunch_or_edit` | `audit_state=4`，保留与驳回不同的内部码 |
| `official_passed` | 审核通过 | 全部 | `continue_workflow` | 不能单独表示已上架 |
| `official_state_unknown` | 官方状态待确认 | 全部 | `refresh` | 不猜测阶段 |

#### 上架和不可见类

| code | 中文显示 | 展示规则 |
| --- | --- | --- |
| `listed` | 已上架 | 从当前审核待处理列表移出，保留历史 |
| `not_listed` | 未上架 | 不能由缺失数据推导 |
| `listing_unknown` | 上架状态待确认 | 保留在全部/状态待确认，不显示已上架 |
| `archived_local` | 已归档 | 仅隐藏本地审核记录，不改变 SHEIN 商品 |

## 4. 唯一状态解析优先级

必须先绑定“当前 SKC 当前发布尝试”，再进行状态解析。不能先把所有事件按 SKC 合并后再猜当前状态。

### 4.1 第一步：确定当前尝试

按以下顺序建立当前尝试指针：

1. 租户和店铺必须先限定。
2. 同一 SKC 取最新的有效本地 `publish_jobs` 尝试；优先使用 `localAttemptId`、`requestKey` 和 `sheinVersion` 进行绑定。
3. 有新的本地重发尝试时，旧版本官方驳回只能进入历史时间线和驳回计数，不能覆盖当前尝试。
4. 如果当前尝试已经有官方 version/document，则官方事件必须按该平台标识精确关联；不能仅凭 SKC 名称覆盖不同版本。
5. 没有 version/document 的早期尝试仍可展示本地执行状态，但不能拿旧版本官方审核记录当作本次结果。
6. `review_key=skc:<skcName>` 只能作为兼容索引，不能作为不同发布尝试的唯一身份。

### 4.2 第二步：过滤不应进入当前列表的状态

在产生用户可见分类前：

1. 当前店铺中官方确认 `shelf_status=已上架` 的商品从当前审核列表移出。
2. 本地归档的 review key 只隐藏本地当前视图，不能删除回执和历史。
3. 旧版本的审核事件保留在历史，不参与当前状态和当前 tab 计数。
4. 空响应、接口失败、Webhook 延迟不能转换成“待发布 0”“驳回 0”或“审核通过”。

### 4.3 第三步：解析当前状态

针对同一当前尝试，严格使用以下顺序：

```text
官方上架事实
  > 官方审核终态：failed/rejected、withdrawn
  > 明确官方 workflow_stage：待核价/待寄样/待审版/待核样/待终审/待审核
  > 官方 audit_state=1：待审核
  > 官方 audit_state=2：审核通过（若无更具体阶段）
  > 官方接收失败：接收失败
  > 官方接收成功：已接收，待审核
  > 本地明确终态失败：发布失败
  > 本地结果未知：结果待确认
  > 本地已提交未收到回执：已提交，待回执
  > 本地排队/执行中：排队中/发布执行中
  > 本地预检阻断：需处理
  > 草稿未完成：待完善
  > 无法确认：官方状态待确认/等待同步
```

补充约束：

- 官方 `failed/rejected` 和 `withdrawn` 优先于陈旧 workflow stage；旧代码中的“状态标签先后”不能反过来。
- 明确 workflow stage 优先于笼统的 `audit_state=1`，因为“待核价”等阶段已经比“审核中”更具体。
- 本地执行状态只在缺少当前尝试的官方事实时生效；本地状态不能覆盖官方审核事实。
- `publish_result_unknown` 永远不进入“已发布”“待审核”或“已驳回”。
- `official_passed` 永远不直接等价于 `listed`。

## 5. 用户可见分栏和统计口径

当前 UI 有 9 个分栏：全部、待审核、待核价、待寄样、待审版、待核样、待终审、需处理、已驳回。

第 5 步统一快照实现时，分栏必须由 `resolution.tab` 产生，顶部统计也必须复用同一批已经归类的 item，不能再次对中文标签做 `filter`。

建议口径：

| 分栏 | 纳入 code |
| --- | --- |
| 待审核 | `official_received_waiting_review`、`official_awaiting_review` |
| 待核价 | `official_awaiting_price` |
| 待寄样 | `official_awaiting_sample` |
| 待审版 | `official_awaiting_version_review` |
| 待核样 | `official_awaiting_sample_review` |
| 待终审 | `official_awaiting_final_review` |
| 需处理 | 本地预检阻断、接收失败、结果未知、发布失败、已撤回、合规失败等明确可操作状态 |
| 已驳回 | 仅 `official_rejected` |
| 全部 | 当前未归档、未上架、可追踪的当前尝试，包含同步中和状态待确认 |

特别禁止：

1. 不把“已提交，待回执”伪装成“待审核”；否则页面显示审核中但 SHEIN 尚未收到商品，重新制造伪发布。
2. 不把“发布失败”计入“已驳回”；发布失败和平台驳回必须分别统计。
3. 不把 `audit_state=4` 计入已驳回；保留“已撤回”标签并放入需处理操作口径。
4. 不用 `auditStateLabel === "pending"`、`workflowStage` 或中文标签分别计算顶部数字；所有数字来自统一分类结果。
5. “审核通过”不计入“待审核”，也不直接计入“已发布”；上架必须有独立官方上架事实。

## 6. 来源可信度、时间和冲突规则

### 6.1 来源层级

在同一尝试、同一字段上，来源优先级为：

1. SHEIN 官方 document-state 当前回读。
2. SHEIN 生产审核 Webhook 的规范化投影。
3. SHEIN 生产接收 Webhook 的规范化投影。
4. SHEIN 发布接口明确返回的接收/版本信息。
5. 本地 `publish_jobs`、`publish_receipts` 执行记录。
6. 批次条目、草稿和本地缓存。

这不是允许低层来源覆盖高层来源的顺序。高层来源字段缺失时可以由低层来源补充，但不能用低层来源覆盖高层来源已经明确给出的冲突事实。

### 6.2 时间字段

每条证据必须保留：

- 官方发生时间：`occurred_at`、`audit_time` 等。
- 系统收到时间：Webhook `received_at` 或回读完成时间。
- 本地更新/任务时间：`updated_at`、`submitted_at`。
- source 和 traceId。

比较时间时统一解析为 UTC 时间戳；不能用未规范化的日期字符串或本地格式直接比较。官方发生时间缺失时，不能假装它比本地时间新或旧，只能降低置信度并显示待确认。

### 6.3 冲突处理

| 冲突 | 处理 |
| --- | --- |
| 当前尝试已提交，旧版本返回驳回 | 保留旧驳回历史；当前列表显示当前尝试的等待状态 |
| 同一版本官方审核失败，但本地仍是 submitted | 显示已驳回，官方事实压过本地等待 |
| 同一版本 workflow_stage=待核价，audit_state=1 | 显示待核价，具体阶段压过笼统 pending |
| 同一版本 workflow_stage=待审核，audit_state=3 | 显示已驳回，审核失败压过陈旧阶段 |
| 接收失败但旧审核通过 | 先按当前尝试/版本绑定；若确实同一当前版本，保留两轴证据，resolution 以接收失败为需处理，不篡改历史审核通过 |
| 官方返回空数组 | 记录“官方查询为空”证据，不改写为 0 个状态、不删除旧证据 |
| 官方接口超时/服务不可用 | resolution 为同步失败/结果待确认，不能改成发布失败或驳回 |
| Webhook 重复 | 按事件 ID、版本、document 和 dedupe key 去重，但不丢失首次/最后一次时间和 trace |

## 7. 当前实现与统一字典的差异清单

以下是第 3 步发现的必须在后续步骤处理的差异；本步不直接修改：

1. 后端 `workflowStage()`、`resolvedWorkflowStage()` 和前端 `workflowLabel()` 分别维护映射，存在漂移风险。
2. 前端 `statusLabel()` 把本地 `submitted` 显示为“已提交，待回读”，但 `workflowKeyFromLabel()` 又把它放进待审核分栏，混淆执行和审核。
3. 前端 `externalStatusLabel()` 对 `audit_state=1` 显示“审核中”，而统一字典要求在无更具体阶段时显示“待审核”，避免同一官方状态在 tab 和统计中出现两个名称。
4. `audit_state=4` 虽可显示“已撤回”，但 `workflowKeyFromLabel()` 没有对应分栏，导致它可能落入全部或无法统计。
5. `审核通过`、`已发布`、`shelf_status=已上架` 三者在当前页面的不同分支中分别判断，缺少统一的上架事实边界。
6. 顶部 `reviewingCount` 只匹配部分中文标签，漏掉 `待审核`、`已接收，待审核` 等合法状态，造成数字与列表不一致。
7. `statusClass()` 使用了“寄样”而不是完整的“待寄样”，视觉状态也会出现漏映射。
8. `reviewKey` 在缺少 version/document 时可能退化为 `skc:<skcName>`，不能安全表达同一 SKC 的多次重发尝试。
9. `reviewStage` 同时承担事件来源和阶段含义；`received`、`audited`、`document_state` 不能代替独立的 receive/audit/workflow 三轴。
10. 空回读、接口失败、结果未知和真实发布失败在当前 UI 中仍可能共用泛化错误展示，后续必须由错误轴和 resolution code 分开。

## 8. 第 4～第 6 步的实现约束

### 第 4 步：发布尝试模型

- 以 `publish_jobs.id` 作为本地一次发布尝试的主身份。
- 明确区分“请求已入队”“SHEIN 接口已接受”“平台接收回执”“官方审核结果”。
- 重发生成新的当前尝试指针，旧版本只进入历史。
- 结果未知禁止自动重发，必须先走回读/恢复。

### 第 5 步：统一审核中心快照

- 服务端一次返回身份、执行、接收、审核、上架、解析结果和证据来源。
- 前端不再从 drafts、batches、readback、reviews 各自拼出当前状态。
- 快照必须能表达部分成功、空官方响应、服务不可用和状态待确认。

### 第 6 步：统一分类和统计

- 只使用 `resolution.code/tab` 过滤和统计。
- 中文展示文本只负责显示，不再参与业务分类。
- “已驳回”只收官方审核驳回；“需处理”收本地失败、接收失败、结果未知和已撤回等行动态。
- 所有板块、顶部数字、列表行状态、批量按钮权限复用同一解析结果。

## 9. 必须覆盖的状态测试矩阵

后续写回归测试时，至少覆盖以下场景：

1. 草稿 blocked，无任何 SHEIN 证据 → 需处理。
2. 批次 queued，无任何 SHEIN 证据 → 排队中，不得待审核。
3. job submitted，无官方回执 → 已提交，待回执，不得称已发布。
4. job result_unknown → 结果待确认，不得自动重发。
5. job failed_terminal → 发布失败，不得已驳回。
6. receive accepted，无 audit → 已接收，待审核。
7. receive failed → 接收失败，不得已驳回。
8. `audit_state=1` 无 workflow → 待审核。
9. `audit_state=1` 且 workflow=awaiting_price → 待核价。
10. `audit_state=3` 且 workflow=awaiting_review → 已驳回。
11. `audit_state=4` → 已撤回，进入需处理操作口径但不进入已驳回。
12. `audit_state=2` 无上架事实 → 审核通过，不得已发布。
13. `audit_state=2` 且 shelf_status=已上架 → 从当前审核列表移出。
14. 新版本 submitted + 旧版本 rejected → 当前显示新版本等待，旧驳回只进历史。
15. 同 SKC 两个不同 publish job、无 version → 不能互相覆盖。
16. 官方 document-state 空数组 → 状态待确认，不得清空为 0 成功。
17. 官方 document-state 超时 → 同步失败/结果待确认，不得修改平台状态。
18. Webhook 重复到达 → 结果和计数不重复增加。
19. 待审核、待核价、待寄样、待审版、待核样、待终审各至少一条 → tab 与顶部统计一致。
20. 多店铺/切店 → 状态、选择、统计和缓存不得串店。
21. 审核通过但平台未上架 → 不显示已上架。
22. 归档后 → 当前视图隐藏，历史证据仍可查询。
23. 一批部分成功、部分失败、部分结果未知 → 每个 SKC 按自己的当前尝试分类。
24. 手动刷新部分接口成功、部分失败 → 成功来源更新，失败来源保留且明确提示，不整页伪造成功。

## 10. 第 3 步结论

统一字典已经冻结为“多轴事实 + 单一 resolution”的模型：

```text
当前尝试身份
  → 本地执行轴
  → SHEIN 接收轴
  → 官方审核/工作流轴
  → 上架事实轴
  → 单一 resolution.code / displayLabel / tab
```

最关键的纠偏是：

- “发布请求已提交”不再等于“待审核”。
- “发布失败”不再等于“已驳回”。
- “审核通过”不再等于“已上架”。
- “已撤回”不再等于“已驳回”。
- “结果未知/官方查询失败”不再等于成功、失败或 0 条。
- 所有 tab、统计和按钮权限最终只读取同一个 `resolution`。

第 3 步已完成。第 4 步应在此字典基础上建立一次发布尝试模型；在第 4 步完成前，不应继续对审核中心做局部标签补丁。
