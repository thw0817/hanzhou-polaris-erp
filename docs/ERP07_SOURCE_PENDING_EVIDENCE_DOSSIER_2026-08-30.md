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
| `preflight.publish_quota` | `POST` | `/open-api/goods-publish-quotas/detail` | `internal_consumer_contract` | 禁止 |
| `review.document_state` | `POST` | `/open-api/goods/query-document-state` | `internal_consumer_contract` | 禁止 |

## 审阅规则

1. 只接受现有 `buildErp07ResponseEvidenceSnapshot()` 产生的固定结构；endpoint、contract/schema 版本、成功回执标识、字段列表、字段次数和类型摘要任一漂移均 fail closed。
2. 摘要根据当前 endpoint schema 重新派生 method/path，调用方不能提交或覆盖路径。
3. 所有字段出现情况只代表候选响应与当前 schema 的结构匹配，不证明官方文档、当前店铺权限或真实线上请求来源。
4. 店铺范围仅以 SHA-256 指纹写入审阅摘要；原始 tenant/store/supplier 标识不进入摘要。
5. 未来如取得官方完整 response 页面或经单独批准的授权店铺只读回执，必须先独立人工审阅来源、方法、路径、字段含义、范围和时间，再单独修改 schema evidence catalog；不能使用此摘要自动升格。
6. `sales.sku`、`preflight.publish_quota`、`review.document_state` 不能用普通 `readEnabled` 调用。即使未来获得读取批准，也必须同时启用隔离 adapter 的 source-pending 证据采集开关，并提供格式合法的 `sourceRef/observedAt`；adapter 成功结果仅输出本摘要，不返回原始 payload、scope、body 或 query。

## 回归门禁

- 销量、额度、单据状态三项均有 method/path 固定与 `eligible=false` 回归。
- 修改 snapshot endpoint、字段覆盖范围、字段出现次数或字段类型摘要，审阅摘要均拒绝。
- 任何 payload 值、scope 原值、body、query、headers 或凭证不得进入最终摘要或 source-pending adapter 的成功/失败结果。

## 结论

ERP-07 仍在进行。此文档与本地代码只降低“错误来源被误审为正确接口”的风险；它不形成真实授权店铺读取、不会解除 ERP-06 `BLOCKED/NO-GO`，也不授权 staging 或生产部署。
