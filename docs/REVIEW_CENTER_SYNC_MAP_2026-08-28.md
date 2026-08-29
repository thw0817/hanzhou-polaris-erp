# 商品审核中心现有同步链路图

采集时间：2026-08-28 14:50～15:00 CST

本文件是实施步骤 2 的只读架构地图。它描述当前代码真实存在的读取、发布、回读、Webhook、缓存和展示链路，不代表目标架构，也不对任何历史任务做状态判断。采集期间没有调用 SHEIN 写接口，没有修改数据库、Redis 或云端配置。

## 1. 总体链路

```text
草稿/批量建品
    │ 保存、服务端预检、页面 handoff
    ▼
product_drafts + preflight
    │
    ├── 审核中心初始读取：product-drafts
    ├── 发布批次读取：publish-batches
    └── 审核记录读取：product-reviews

审核中心的多个前端查询
    │
    ├── 本地批次/条目/回读投影
    ├── Webhook 事件/审核状态投影
    ├── SHEIN 商品列表与上架状态
    ├── SHEIN 核价/寄样数据
    └── 手动触发的 SHEIN document-state 直读
    │
    ▼
前端 PublishBatchesPage.tsx 独立合并、去重、分类、统计

发布按钮
    │
    ▼
publish-now → publish_batches/items → preflight → execution_run/jobs
    → Redis BullMQ → product-publish-worker → SHEIN 商品写接口
    → publish_receipts / publish_jobs → 后续 Webhook 或 document-state 回读
```

当前不是一条单一同步链路，而是多条可以独立成功或失败的链路在前端汇合。

## 2. 草稿到审核中心链路

### 2.1 草稿保存与预检

入口：

- `src-v2/features/publishing/ProductDraftsPage.tsx`
- `src-v2/features/publishing/BatchProductCreatePage.tsx`
- `src-v2/features/publishing/NewProductPage.tsx`

主要动作：

1. 页面保存草稿。
2. 服务端保存 `product_drafts`。
3. 页面要求进入审核中心时，对选中草稿调用服务端重新预检。
4. 服务端返回可进入审核中心的草稿 ID 与阻断原因。
5. 页面通过 `product-draft-publish-handoff-contract.js` 把草稿 ID 交给审核中心。
6. `PublishBatchesPage.tsx` 消费 handoff，并在本地选择可发布草稿。

关键边界：

- handoff 不是发布，也不是 SHEIN 接收证明。
- 审核中心初始加载仍然重新读取草稿数据。
- 预检结果、草稿状态和发布批次状态由不同查询返回。

## 3. 审核中心初始读取链路

文件：`src-v2/features/publishing/PublishBatchesPage.tsx`

页面实际挂载了以下独立 TanStack Query：

| Query key | API | 当前用途 | 是否自动刷新 |
| --- | --- | --- | --- |
| `store/queryScope/storeId/product-drafts` | `GET /v1/web/stores/:storeId/product-drafts` | 草稿、标题、类目、当前本地状态 | 否，缓存 60 秒 |
| `store/queryScope/storeId/ai-title-capability` | AI 标题能力接口 | 是否显示 AI 标题按钮 | 否，缓存 60 秒 |
| `store/queryScope/storeId/publish-batches` | `GET /v1/web/stores/:storeId/publish-batches` | 批次、批次条目、预检状态 | 否，缓存 60 秒 |
| `store/queryScope/storeId/price-discussions` | `GET /v1/web/stores/:storeId/price-discussions?status=1` | 核价/寄样辅助展示 | 否，缓存 60 秒 |
| `store/queryScope/storeId/product-reviews` | `GET /v1/web/stores/:storeId/product-reviews` | 外部审核记录和审核状态 | 否，缓存 60 秒 |
| `store/queryScope/storeId/business-dashboard` | `GET /v1/web/stores/:storeId/business-dashboard?refreshIfEmpty=0` | 商品列表、上架状态、额度和经营统计 | 否，缓存 60 秒 |
| `store/queryScope/storeId/publish-readback/:batchId` | `GET /v1/web/stores/:storeId/publish-batches/:batchId/readback-status` | 单批次本地回执和任务状态 | 否；挂载最多前 20 个可回读批次 |
| `store/queryScope/storeId/publish-thumbnails/:assetIds` | 同源媒体 content URL | 主图展示 | 否，缓存 5 分钟 |

所有 query key 有租户/用户/店铺作用域，这一点是正确的；但它们仍然是多个独立缓存，没有审核中心主快照。

## 4. 当前页面实际使用的发布链路

### 4.1 页面按钮

当前页面的单个发布、批量发布和驳回重发最终都调用：

```text
POST /v1/web/stores/:storeId/publish-now
```

请求内容包括：

- draftIds
- idempotencyKey
- `CONFIRM_SHEIN_PRODUCT_PUBLISH`

### 4.2 Control 路由

`server/cloud/control-server.js` 完成：

1. 可信来源校验。
2. Web session 认证。
3. 当前租户和店铺权限校验。
4. 调用 `webPublishBatches.publishNow()`。

### 4.3 发布服务

`server/cloud/publish-batch-service.js` 的 direct publish 流程为：

1. 检查真实发布总开关和队列是否启用。
2. 校验二次确认和幂等键。
3. 创建或复用 `publish_batches`。
4. 创建 `publish_batch_items`。
5. 检查已驳回重发条件。
6. 对草稿做本地候选阻断检查。
7. 调用 SHEIN 只读额度/发布预检。
8. 调用远程图片和候选载荷预检。
9. 写入一次性 `publish_execution_runs` 和冻结候选。
10. 将任务放入 `shein-product-publish` 队列。
11. 返回 `executionStage=queued`，这只表示进入本地执行队列。

### 4.4 Redis 与 Worker

队列常量：

- 队列：`shein-product-publish`
- Job 名称：`product-publish-run`
- 当前 Worker 并发约束：1～2，默认 1

`server/cloud/product-publish-worker.js`：

1. 从 BullMQ 取执行运行。
2. 从数据库领取 `authorized` 任务。
3. 生成 claimId 并锁定任务。
4. 重新校验本地候选和远程候选 fingerprint。
5. 候选不一致则终止，不能调用 SHEIN。
6. 调用 `product-publish-executor.js`。
7. 根据 SHEIN 返回结果记录 accepted、failed 或 unknown。
8. 记录提交回执、失败原因或结果未知。
9. 结算 `publish_execution_runs`。

### 4.5 SHEIN 写接口边界

`server/cloud/product-publish-executor.js` 才是真正调用商品发布接口的位置。

返回处理分为：

- `accepted`：SHEIN 接口返回可接受的提交结果，仍需后续官方审核/回读。
- `failed`：有明确 SHEIN 错误响应。
- `unknown`：网络中断、响应不完整或无法确认结果。

即使 `accepted`，也不能直接代表 SHEIN 审核通过或商品已上架。

## 5. 当前代码中另存的一条批次动作链

API 客户端还保留：

```text
POST /v1/web/stores/:storeId/publish-batches
POST /v1/web/stores/:storeId/publish-batches/:batchId/actions
```

它支持批次创建、execute、pause、resume、retry、confirm 等动作。

但当前审核中心页面没有调用 `createPublishBatch` 或 `actPublishBatch`，页面主要使用 `publishNow` direct publish。也就是说，代码层仍有一套批次动作接口，而当前页面主要走另一套直发入口；这不是两个 Worker，但属于两个发布入口，需要后续明确是否保留。

## 6. 官方审核回执链路一：Webhook

### 6.1 Webhook 入口

`server/cloud/webhook-server.js`：

1. 接收 SHEIN Webhook。
2. 验签/时间窗口/重放保护。
3. 将事件写入 `webhook_events`。
4. 将事件放入 Webhook BullMQ 队列。

### 6.2 Webhook Worker

`server/cloud/webhook-worker-server.js`：

1. 从队列取得事件。
2. `webhook-event-processor.js` 根据事件类型选择生产投影器。
3. `webhook-production-projections.js` 规范化商品接收、审核、全渠道审核事件。
4. 写入 `publish_receipts`，用于关联本地发布任务。
5. 写入 `product_review_states`，用于审核中心状态聚合。

商品审核相关事件包括：

- `product_document_receive_status_notice`
- `product_document_audit_status_notice`
- `product_document_audit_status_notice_all_channels`

除此之外，Webhook 还会投影额度、授权、合规失效、缺货等业务状态，但这些不是审核中心当前状态的唯一事实源。

### 6.3 Webhook 链路的独立性

Webhook 投影成功不等于：

- 本地发布任务已经完成；
- 前端 `product-reviews` 查询已经刷新；
- 页面 `publish-readback` 缓存已经刷新；
- 商品经营统计已经刷新。

它们需要分别读取或失效缓存。

## 7. 官方审核回执链路二：手动 document-state 直读

入口：

```text
POST /v1/web/stores/:storeId/publish/document-state
```

调用链：

1. 前端手动刷新根据当前本地批次回读和审核记录整理 `version + spuNames`。
2. Control 做 session 和店铺权限校验。
3. `web-business-service.js` 调用 SHEIN `/open-api/goods/query-document-state`。
4. `document-state-projections.js` 规范化返回。
5. 非空结果写入 `publish_receipts` 的 `document_state` 回执。
6. 非空结果写入 `product_review_states`。
7. 将规范化结果返回给当前刷新请求。

这里是“手动读官方状态”链路，不是 Webhook 链路，也不是批次本地回读链路。

合法空结果表示官方暂时没有返回记录，不能写入伪造审核状态。

## 8. 官方审核回执链路三：本地批次回读

入口：

```text
GET /v1/web/stores/:storeId/publish-batches/:batchId/readback-status
```

`publish-execution-repository.js` 从以下本地数据组合返回：

- `publish_jobs`
- `publish_receipts` 的 `audited`/`document_state`
- `publish_receipts` 的 `readback`
- `publish_receipts` 的 `compliance`
- job 的 `readback`、`receipt`、`shein_version`、`shein_document_sn`

它回答的是“本地系统已经收到并保存了哪些发布/回读证据”，不等于每次都会直接向 SHEIN 发起实时读取。

## 9. 审核中心后端聚合链路

入口：

```text
GET /v1/web/stores/:storeId/product-reviews
```

`PostgresProductReviewRepository.listSources()` 并行读取五类数据：

1. `webhook_events`：最近最多 1000 条生产商品接收/审核事件。
2. `product_review_states`：未归档的审核状态投影。
3. `skcs + spus`：商品标题、图片和上架状态。
4. 已归档 review key。
5. `publish_jobs + product_drafts`：只读取 `shein_version IS NOT NULL` 的本地发布任务。

`WebProductReviewService.list()` 随后执行：

1. 事件规范化。
2. 审核状态表补充。
3. 本地发布版本补充。
4. 按 SKC 选择当前本地发布版本。
5. 旧版本隐藏。
6. 旧驳回与新提交按时间和版本比较。
7. 已上架商品隐藏。
8. 已归档记录隐藏。
9. 每个 SKC 只保留一条当前展示记录。

这套服务端聚合与前端的本地 drafts/batches/readback 合并仍然是两套解析层。

## 10. 前端二次聚合链路

页面拿到数据后继续执行：

1. `latestItems()` 从批次中取每个 draft 最新条目。
2. 将本地草稿映射为 `statusLabel()`。
3. 将外部审核记录映射为 `externalStatusLabel()`。
4. 以失败草稿 ID和挂载回读版本过滤外部审核行。
5. 将本地行和外部行分别按 tab 过滤。
6. 根据外部行是否为空，选择两种不同表格渲染分支。
7. 顶部统计另行计算，不完全复用 tab 列表。

因此当前状态会经过：

```text
数据库/官方数据
→ 后端 product-review-service 聚合
→ React Query 独立缓存
→ 前端本地/外部去重
→ 两套状态标签函数
→ tab 过滤
→ 顶部独立统计
```

这就是“同一商品在不同板块看到不同状态”的主要结构性来源。

## 11. 当前缓存失效和刷新关系

### 11.1 发布成功后

`publishMutation.onSuccess` 当前主要失效：

- product-drafts
- publish-batches
- business-dashboard

没有同时失效：

- product-reviews
- 已挂载的 publish-readback 明细
- price-discussions
- 审核中心的本地/外部合并快照（因为尚未存在）

因此发布成功后，旧驳回记录仍可能留在审核中心缓存中。

### 11.2 发布失败后

发布 mutation 会保留错误状态，并更新发布批次；手动刷新主要更新局部反馈和查询结果。旧 mutation 错误可能与新的刷新成功/部分成功提示同时显示。

### 11.3 手动刷新

当前手动刷新大致是：

1. 重新读取草稿、批次、审核记录。
2. 挂载查询最多覆盖 20 个批次；手动刷新会对全部可回读批次分批读取本地回执。
3. 将本地回读结果写入对应 Query cache。
4. 从本地回读和审核记录整理 version/SPU。
5. 分批调用 SHEIN document-state。
6. 再刷新经营统计和核价数据。
7. 使用 `Promise.allSettled` 汇总部分成功/失败。

它是前端编排的多请求刷新，不是服务端一个原子刷新事务。

## 12. 数据存储角色表

| 存储 | 当前角色 | 是否审核中心唯一事实源 |
| --- | --- | --- |
| `product_drafts` | 草稿、预检、标题、图片、草稿状态 | 否 |
| `publish_batches` | 发布批次和批次级状态 | 否 |
| `publish_batch_items` | 草稿在批次中的预检/条目状态 | 否 |
| `publish_execution_runs` | 一次性执行授权和执行运行状态 | 否 |
| `publish_jobs` | 冻结发布任务、SHEIN 版本、执行状态 | 仅代表本地发布尝试 |
| `publish_receipts` | 发布、接收、审核、官方文档状态等追加回执 | 证据存储，不是单一展示模型 |
| `webhook_events` | 原始生产 Webhook 及投影状态 | 原始事件源 |
| `product_review_states` | 审核状态读投影和本地归档 | 当前后端审核聚合的主要投影 |
| `skcs/spus` | 商品信息和上架状态 | 上架事实辅助源 |
| `sync_jobs` | 经营、规则、合规等同步任务 | 不直接等于审核状态 |
| Redis BullMQ | 发布、Webhook、经营、规则、合规异步任务 | 队列执行状态，不是审核事实 |

## 13. 已确认的架构断点

1. 当前页面存在多个独立 Query，没有 `ReviewCenterSnapshot`。
2. 页面实际使用 `publishNow`，但客户端仍保留另一套 batch action API。
3. 后端审核聚合与前端审核合并各有一套去重/当前版本规则。
4. 本地批次回读、Webhook 投影、官方 document-state 直读是三条独立回读路径。
5. `product_review_states`、`publish_receipts`、`webhook_events` 各自保存状态/证据，但没有统一的当前 SKC 尝试指针。
6. `publish_jobs` 审核聚合只纳入已有 `shein_version` 的任务，排队/授权阶段可能无法压制旧驳回记录。
7. 发布成功后的缓存失效不包含 `product-reviews`。
8. 手动刷新由前端编排多个来源，缺少服务端统一结果合同。
9. 顶部统计、tab 列表和表格渲染不是同一个解析函数。
10. 失败、空回读、结果未知、网络失败在用户界面上仍可能共用泛化错误呈现。

## 14. 第 2 步结论

当前确实存在多套同步/状态读取架构，准确说是“多来源、多投影、多前端查询并行”，不一定是多个重复 Worker。

现阶段不能继续通过单点补丁解决所有问题。后续第 3 步必须先定义唯一状态字典、来源优先级和状态转换边界；否则统一快照仍会把已有歧义带入新接口。

本地图未执行任何修复。云端真实 release、容器、Redis、Postgres 当前运行态仍需受控源站通道后另行只读核验，不能用历史部署记录替代。
