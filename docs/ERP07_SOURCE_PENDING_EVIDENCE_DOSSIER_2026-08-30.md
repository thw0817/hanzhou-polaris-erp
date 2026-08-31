# ERP-07 待核验响应证据审阅摘要

日期：2026-08-30
范围：仅本地、仅脱敏摘要、仅 ERP-07；普通 adapter 读取一律拒绝，未来单独授权的读取只能走双重显式证据采集模式；不接入网页、不改变生产配置。

## 目的

为仍处于 `internal_consumer_contract` 的接口建立一份可复核的审阅摘要。摘要把 endpoint 的固定 `method + path`、当前 contract/schema 版本、响应字段覆盖情况和脱敏响应指纹绑定在一起，避免将另一个接口的成功响应误作本接口证据。

这不是自动升级器：即使全部字段出现，输出仍固定为 `blocked_source_pending` 与 `eligible=false`。摘要不保存原始 payload、字段值、请求、请求头、凭证、签名 URL、文件或图片，也不把 `sourceRef` 的格式检查当作授权店铺事实。

## 当前覆盖

| endpoint | 方法 | 固定路径 | 当前字段证据状态 | 目录升级 |
| --- | --- | --- | --- | --- |
| `sales.sku` | `POST` | `/open-api/goods/query-sku-sales` | `internal_consumer_contract` | 禁止 |
| `preflight.publish_quota` | `POST` | `/open-api/goods-publish-quotas/detail` | `official_response_contract` | 需当前商家发品额度授权只读回执 |
| `review.document_state` | `POST` | `/open-api/goods/query-document-state` | `internal_consumer_contract` | 禁止 |

## 审阅规则

1. 只接受现有 `buildErp07ResponseEvidenceSnapshot()` 产生的固定结构；endpoint、contract/schema 版本、成功回执标识、字段列表、字段次数和类型摘要任一漂移均 fail closed。
2. 摘要根据当前 endpoint schema 重新派生 method/path，调用方不能提交或覆盖路径。
3. 所有字段出现情况只代表候选响应与当前 schema 的结构匹配，不证明官方文档、当前店铺权限或真实线上请求来源。
4. 店铺范围仅以 SHA-256 指纹写入审阅摘要；原始 tenant/store/supplier 标识不进入摘要。
5. 未来如取得官方完整 response 页面或经单独批准的授权店铺只读回执，必须先独立人工审阅来源、方法、路径、字段含义、范围和时间，再单独修改 schema evidence catalog；不能使用此摘要自动升格。
6. `sales.sku`、`review.document_state` 不能用普通 `readEnabled` 调用。即使未来获得读取批准，也必须同时启用隔离 adapter 的 source-pending 证据采集开关，并提供格式合法的 `sourceRef/observedAt`；adapter 成功结果仅输出本摘要，不返回原始 payload、scope、body 或 query。`preflight.publish_quota` 已有独立官方响应契约，但真实店铺回读仍只能在明确的只读证据流程中进行，不能因此打开业务发布。

## 单据状态请求前置条件

`review.document_state` 的目标可以由 SKC 指定，但官方回读请求不是 SKC-only 请求；当前冻结的请求契约是：

```json
{
  "version": "<SHEIN version>",
  "spuList": [{ "spuName": "<SHEIN SPU>" }]
}
```

证据采集器只接受显式提供的 `SPU + version`，或从同租户、同店铺、同 SKC 的既有发布回执中通过只读查询解析出唯一的一对身份。两者均不存在时返回 `input_required`，身份不唯一时 fail closed；这两种情况都不会发送单据状态请求。SKC 不是 SPU 的替代字段，也不能把 `{ "skc_name": "..." }` 当作该接口的有效请求体。

因此，接口返回的业务码 `20003` 在缺少 SPU/version 的错误请求场景下只能记录为请求失败证据，不能解释为商品审核失败、未找到或已驳回。

## 销量读取的 SKU 前置解析

`sales.sku` 的远端请求现在不再把目标 SKC 直接作为 `skcNameList` 发送。证据 runner 在已有唯一
`SPU + version` 身份时，先通过官方已记录的只读 `product.spu_info`（`POST /open-api/goods/spu-info`）读取
SPU 详情，从 `info.skcInfoList[]` 精确匹配目标 SKC，再把该 SKC 下的 `skuInfoList[].skuCode` 作为
`skuCodeList` 发送到销量接口。

匹配不到唯一 SKC、SKU 列表缺失、SKU 数量超过接口上限，或 `spu-info` 读取失败时，销量接口不会被调用，
runner 返回 `input_required`/依赖失败诊断。这是为避免把 SKC 当 SKU 导致 `dmsWeb0003`，也避免在映射不确定时
误记录销量证据。SKU 原值只存在于本次受控的上游请求和下游只读请求边界，不进入最终证据摘要；本变更不写入
数据库、不改变网页路由、不触碰生产。

## 回归门禁

- 销量、额度、单据状态三项均有 method/path 固定与 `eligible=false` 回归。
- 修改 snapshot endpoint、字段覆盖范围、字段出现次数或字段类型摘要，审阅摘要均拒绝。
- 任何 payload 值、scope 原值、body、query、headers 或凭证不得进入最终摘要或 source-pending adapter 的成功/失败结果。

## 2026-08-30 结构复核增量

为复核真实授权店铺返回的 `review.document_state` 结构，证据摘要版本已增量为：

- `erp07-response-evidence-capture-v2`
- `erp07-response-evidence-dossier-v2`

新增的 `responseShape` 只记录脱敏的路径和类型，例如
`info.data[].documentNo` + `string`；不记录任何字段值、请求体、请求头、凭证、原始响应或对象存储信息。
结构摘要最多遍历 256 个节点，超出时仅标记 `truncated=true`。它只用于判断当前响应是包装层差异、字段改名、
空数组还是结构缺失，不改变既定字段覆盖统计。

本次授权店铺只读回执确认了 `review.document_state` 的结构轮廓为：`info.data[]` 是记录数组，记录包含
`spuName`、`version`、`skcList[]`；`skcList[]` 包含 `skcName`、`documentSn`、`documentState` 和
`failedReason`。同时存在 `info.meta.count`，本次 `failedReason` 的类型为 `null`。这证明了包装层和字段命名
与当前内部投影层的兼容方向，但不证明 `documentState` 的业务枚举含义，也没有证明存在 SKU 明细或审核时间。

因此，当前可观察到的候选字段为：`spuName`、`version`、`skcName`、`documentSn`、`documentState`、
`failedReason` 和 `info.meta.count`；本次没有观察到 SKU 明细或审核时间，且 `failedReason` 的值类型为 `null`。
本地 source-pending 证据统计已将字段路径对齐为这 7 个实际嵌套路径，但仍只用于结构覆盖记录，不代表官方字段语义
已经核验，也不把这次响应解释为商品通过或驳回。`sales.sku` 的候选字段仍沿用已通过的内部消费者契约。

即使结构摘要发现可疑的新字段，`review.document_state` 仍保持
`sourceEvidenceStatus=internal_consumer_contract`、`catalogUpgrade.status=blocked_source_pending` 和
`eligible=false`。只有独立官方来源或经过单独人工审阅的完整授权店铺回执，才可以提出字段映射变更；本次
结构摘要不能自动升级 schema，也不能解除 ERP-07 的部署或发布门禁。

## 2026-08-30 官方额度接口修复后的真实只读重跑

本次已切换到提交 `017f10b`，使用商品详情页核对后的正确 SPU 和既有 version 重新执行，结果为
`ok=false`、`readOnly=true`、`externalWrite=false`。`product.spu_info` 返回成功，随后 `sales.sku` 返回成功且
当前内部销量字段结构覆盖为 `6/6`、无缺失；这确认 runner 已先从目标 SPU 的 SKC 关系中解析 SKU，再以
`skuCodeList` 调用销量接口，未再把 SKC 直接当作 SKU 发送。前一次 `spu-info` 的 `0003` 是测试输入中的 SPU
与商品详情页实际 SPU 不一致造成的，不能归因于销量接口或生产系统故障。

同一轮 `review.document_state` 也返回成功，真实包装仍为 `info.data[].skcList[]`；提交 `017f10b` 中的旧
source-pending 字段目录因此显示 `0/8`，本地后续修复已将它对齐为 7 个实际嵌套路径，但尚未把它升级为官方字段
契约。此前隔离重跑请求了店铺上架额度接口并返回 HTTP `403`、上游码 `openapi00003`；该接口不属于当前发布流程，
现已从 ERP-07 runner、发布预检和候选检查中移除。当前流程改为读取官方 `POST /open-api/goods-publish-quotas/detail`
的商家发品额度，使用 `isControlled`、`totalQuota`、`availableQuota`、`usedCount`；缺少权限或额度字段时保持未知并
fail closed，不能伪造额度或放行发布。以上均为脱敏结构和状态证据，不代表商品通过/驳回，不写数据库，不触碰生产，也不解除
`blocked_source_pending`。

## 2026-08-31 真实授权店铺只读证据采集

本轮在云端控制容器内执行 `erp07-read-only-evidence-runner-v1`，显式设置只读确认和 source-pending 证据采集确认，结果为
`ok=true`、`readOnly=true`、`externalWrite=false`。数据库连接启用 `default_transaction_read_only=on`；本轮没有执行 migration、数据库写入、队列投递、COS 写入、网页投影或 SHEIN 业务写入。

四项只读调用均返回 HTTP `200`、业务码 `0`、`read_success`：`product.spu_info`、`sales.sku`、官方商家发品额度
`preflight.publish_quota` 以及 `review.document_state`。销量读取先从 SPU 详情的唯一 SKC 关系解析 SKU，再调用销量接口；没有把 SKC 直接当作 SKU。销量内部消费者字段覆盖为 `6/6`，单据状态实际嵌套字段覆盖为 `7/7`，均无缺失。

本轮只保留脱敏的 method/path、状态、traceId、字段路径/类型覆盖和范围摘要哈希，原始 payload、字段值、请求体/查询、headers、凭证和原始身份值均未保存；完整摘要见
[ERP07_AUTHORIZED_STORE_READ_EVIDENCE_2026-08-31.md](./ERP07_AUTHORIZED_STORE_READ_EVIDENCE_2026-08-31.md)。

该结果只能证明当前授权店铺的读取链路和响应结构已被实际观察，不能证明官方字段语义、审核状态枚举、额度业务结论或商品可发布性。故仍保持
`reviewStatus=pending_manual_acceptance`、`catalogUpgrade.status=blocked_source_pending`、`eligible=false`，不升级
`authorizedStoreRead`，不接入普通网页/Worker adapter，不启动 ERP-08。

## 结论

ERP-07 仍在进行。此文档与本地代码只降低“错误来源被误审为正确接口”的风险；它不形成真实授权店铺读取、不会解除 ERP-06 `BLOCKED/NO-GO`，也不授权 staging 或生产部署。
