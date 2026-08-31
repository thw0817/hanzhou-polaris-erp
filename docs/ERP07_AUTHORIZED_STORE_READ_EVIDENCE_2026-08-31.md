# ERP-07 授权店铺只读响应证据（2026-08-31）

## 执行范围

- 运行器：`erp07-read-only-evidence-runner-v1`
- adapter 契约：`erp07-shein-adapter-v1`
- endpoint 契约：`erp07-shein-endpoints-v1`
- 观测时间：`2026-08-31T02:25:03.354Z`
- 云端执行结果：`ok=true`、`readOnly=true`、`externalWrite=false`
- 数据库边界：运行器启用 `default_transaction_read_only=on`；本轮未执行 migration、INSERT、UPDATE、DELETE、队列投递、COS 写入或网页投影。

目标店铺、supplier、SKC、SPU 和 version 只以摘要哈希进入本记录，不保存原始身份值：

- supplier 摘要：`15e1a9f6804feb124cd52d440a3d9cec7dc91939b97a8ec12dc86c01d323fe1e`
- SKC 摘要：`25d4433833b763b28764fc1b9e64514b7cb53869626be556d2b51b3ef737e397`
- SPU/version 身份摘要：`c7704e6ac6d9a1fa4877237f8d822997d53153c06d98be65ea720f688af1a4b5`
- 销量/单据状态范围摘要：`df209b0dc038d59f80904f580316eab0927d7d5e4b99525da2d696b76356e84a`

## 只读调用结果

| endpoint | method/path | HTTP/code | 结果 | traceId |
| --- | --- | --- | --- | --- |
| `product.spu_info` | `POST /open-api/goods/spu-info` | `200/0` | `read_success` | `2c24cfb4a9c6db94` |
| `sales.sku` | `POST /open-api/goods/query-sku-sales` | `200/0` | `read_success` | `64c7272eaaa78031` |
| `preflight.publish_quota` | `POST /open-api/goods-publish-quotas/detail` | `200/0` | `read_success` | `bb3f7d4b668ee780` |
| `review.document_state` | `POST /open-api/goods/query-document-state` | `200/0` | `read_success` | `1422c56b95d44745` |

脱敏结构覆盖结果：

- `sales.sku`：官方字段 `6/6`，缺失 `[]`；本轮先通过 `product.spu_info` 解析唯一 SKC 下的 SKU，再调用销量接口，未把 SKC 当作 SKU 发送。
- `review.document_state`：官方字段 `7/7`，缺失 `[]`；观测到 `info.data[].skcList[]` 包装层和 `spuName`、`version`、`skcName`、`documentSn`、`documentState`、`failedReason`、`info.meta.count` 的类型轮廓。
- `preflight.publish_quota`：官方额度路径读取成功；本记录不保存额度值，也不据此放开发品写入。

## 接受边界

这是一轮真实授权店铺的脱敏只读结构采集，不等同于官方完整 response contract，也不等同于商品通过、驳回、可发布或可编辑结论。

- 原始 payload、字段值、request body/query、headers、凭证、原始店铺/supplier/SKC/SPU/version、图片和对象存储信息均未保存。
- 证据摘要保持 `reviewStatus=pending_manual_acceptance`、`eligibleForCatalogUpgrade=false`。
- 后续官方语义审阅已完成：`sales.sku` 与 `review.document_state` 现为 `official_response_contract`，详见 [ERP07_OFFICIAL_RESPONSE_DOCUMENT_CAPTURE_2026-08-31.md](./ERP07_OFFICIAL_RESPONSE_DOCUMENT_CAPTURE_2026-08-31.md)。本历史摘要仍保持 `pending_manual_acceptance`，不被追溯改写为现场观察；各 endpoint 的 `authorizedStoreRead` 仍为 `not_observed`。
- 网页服务、旧本地入口和 Worker 不因本轮采集自动放行；远端读取默认关闭，业务写入继续关闭。

## 当前未完成项

1. 本轮授权店铺回执仍不得仅凭 HTTP 200/code 0 把 `authorizedStoreRead` 升级为现场观察。
2. ERP-07 完成前仍需受控 adapter 接线、预发 canary/readback 和完成门复核。
3. ERP-08～ERP-23 尚未开始；ERP-06 生产接入继续为 `BLOCKED/NO-GO`。

结论：本轮只读证据采集成功，降低了“没有真实授权店铺回执”的缺口，但没有解除 ERP-07 的 source-pending 阻断，也没有授权任何外部写入或生产切换。
