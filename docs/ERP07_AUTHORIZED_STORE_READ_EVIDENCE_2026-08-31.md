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

## 部署后合格目标 canary（2026-08-31）

- 运行编号：`RUN-20260831-ERP07-DEPLOYED-CANARY-22`
- 观测时间：`2026-08-31T04:26:49.059Z`
- 云端执行结果：`ok=true`、`readOnly=true`、`externalWrite=false`；数据库会话保持 `default_transaction_read_only=on`。
- 目标选择边界：仅选取已有授权身份、`product_review_states.audit_state=2`、且同时具有 supplier、SKC、SPU 与 version 的现有本地关联。目标原值不保存，只保留以下摘要哈希：supplier `a4c325039ed5949a81dc8551d897952a1e703bf8660bbee88267528ed945d642`、SKC `85c137baee62aba666eaaca271d58efe9bae1cff3ce7f972f91c02f70fa9d988`、SPU/version `8e258bcfaa6954290721ca7168c8a3c7b78b4b0c3b8920b01f7422f6d6890854`。

| endpoint | HTTP/code | 结果 | traceId |
| --- | --- | --- | --- |
| `product.spu_info` | `200/0` | `read_success` | `49b70fc6fd9a332d` |
| `sales.sku` | `200/0` | `read_success` | `f2eb2ca39a63dba3` |
| `preflight.publish_quota` | `200/0` | `read_success` | `e2d15c5655de89ca` |
| `review.document_state` | `200/0` | `read_success` | `92d9eac755b6e1bf` |

- 此前一次任意历史目标的 SPU 回读出现平台业务失败，SKU 销量读取被安全跳过；该结果证明目标选择不能靠“最新历史任务”猜测。该失败未写入数据库、未调用任何写 endpoint，也未导致重试或状态改写。
- 本节同样不保存原始 payload、字段值、request body/query、headers、凭证或真实身份值；不迁移、不投递队列、不写对象存储、不触发 Webhook。

## 当前结论与保留边界

1. ERP-07 的 adapter 契约、受控网页读取、候选制品、云端部署、线上只读 canary 与完成门复核已完成。
2. 历史证据摘要仍保持 `pending_manual_acceptance`；完成 Run 不会追溯改写 response evidence catalog 或把 `authorizedStoreRead` 自动升级为现场观察。
3. 所有业务写入仍关闭，`rules.custom_attribute_permission` 仍为 source-pending 且保持零读取/零快照写入。
4. ERP-06 生产接入继续为 `BLOCKED/NO-GO`；因此 ERP-08～ERP-23 尚未开始。

结论：部署后的只读验证成功，ERP-07 在其受控只读范围内完成；它没有解除 source-pending 端点的保守语义，也没有授权任何外部写入。
