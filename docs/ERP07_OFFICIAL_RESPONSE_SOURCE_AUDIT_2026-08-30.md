# ERP-07 官方响应来源核验记录

日期：2026-08-30
范围：只核验公开的 SHEIN Open API 官方页面，不发送请求、不读取店铺、不接触凭证、不改变 `authorizedStoreRead`。

## 已核验的官方响应契约

| ERP-07 endpoint | 官方页面 | 页面更新时间 | 本次确认的响应字段 |
| --- | --- | --- | --- |
| `preflight.publish_permission` | <https://open.sheincorp.com/zh/documents/apidoc/detail/3001589-1000001> | 2026-02-06 18:06:06 | `code`、`msg`、`traceId`、`info.canPublishProduct`、`info.reason` |
| `preflight.publish_quota` | <https://open.sheincorp.com/documents/apidoc/detail/3001680> | 2026-08-10 14:59:29 | `code`、`msg`、`traceId`、`info.isControlled`、`info.totalQuota`、`info.availableQuota`、`info.usedCount` |
| `preflight.supplier_sku_duplicate` | <https://open.sheincorp.com/zh/documents/apidoc/detail/3001437> | 2025-10-22 20:45:14 | `code`、`msg`、`traceId`、`info[].supplierSku`、`info[].repeated` |
| `pricing.proof_upload` | <https://open.sheincorp.com/zh/documents/apidoc/detail/3001728> | 2026-05-22 11:58:16 | `code`、`msg`、`traceId`、`info.objectKey`、`info.url`、`bbl` |

以上来源只证明官方页面公开了这些字段。它们不证明当前授权店铺可调用、不证明当前凭证有效，也不证明线上 adapter 可以放行；因此 4 项的 `authorizedStoreRead` 仍必须是 `not_observed`，字段 `observed` 必须是 `false`。

## 本次一并修正的请求侧契约漂移

- `preflight.publish_permission`：官方文档将 `brandCode` 定义为可选查询参数；预检链路现在会在调用方提供时向 SHEIN 转发，并把查询参数纳入签名路径。未提供时保持原来的无查询参数请求。
- `preflight.supplier_sku_duplicate`：官方文档规定 `supplierSkuList` 单次最多 200 个；schema 与分批调用均统一为 200，补充了 200/201 项边界回归测试。
- `preflight.publish_permission` 的 `info.reason`：官方成功示例返回 `null`，schema 现在接受 `string|null`，避免把合法成功响应误判为格式错误。
- `preflight.publish_quota`：根据官方商家发品额度页面，接口是 `POST /open-api/goods-publish-quotas/detail`，`info.isControlled=false` 表示不受发品额度管控；受管控时以 `info.availableQuota` 作为可用额度，并以 `totalQuota`、`usedCount` 保留总量和已发品数。店铺上架额度接口不属于当前发布流程。

这些修正只改变请求契约的准确性，不会打开 ERP-07 远端读取开关，也不代表已完成授权店铺实读。

## 仍然阻断的接口

以下 2 项当前没有足够的独立官方完整 response 原文或店铺只读回执，继续保留 `internal_consumer_contract` 与 `official_response_fields_not_captured`：

- `sales.sku`
- `review.document_state`

此前隔离只读重跑请求了店铺上架额度接口并得到 HTTP `403`、上游码 `openapi00003`。这不是商家发品额度结果，
不能解释为发品额度为零；该店铺上架额度能力现已从 ERP-07 和发布预检中移除。当前商家发品额度继续按官方
`/open-api/goods-publish-quotas/detail` 单独核验。COS 的对象存储授权与 SHEIN Open API 的接口授权是两套权限，
不能用 COS 策略解决 SHEIN 接口授权问题。

## 结论

本记录只完成 ERP-07 的来源证据增量，不代表 ERP-07 完成，不代表 ERP-06 可以解除 `BLOCKED/NO-GO`，不代表可以部署或执行任何真实 SHEIN 写入。额度接口虽已具备独立官方响应字段来源，仍需按新路径取得真实授权店铺只读回执；后续还需销量/单据状态来源复核、统一 adapter 受控接线、预发 canary/readback 和单独部署批准。
