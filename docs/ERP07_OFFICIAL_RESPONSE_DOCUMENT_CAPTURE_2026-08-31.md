# ERP-07 官方响应契约摘录（2026-08-31）

本记录只固化公开 SHEIN Open API 文档的接口契约；不含店铺身份、请求签名、原始响应、业务数据或任何凭证。

## 取证方法与范围

- 取证时间：2026-08-31（Asia/Shanghai）。
- 来源：SHEIN Open API 的公开文档目录与详情数据。
- 详情查询来源：`https://open.sheincorp.com/api/api/apiDoc/queryApiPublishDocDetailInfoById?id=<文档 ID>&isLatest=true`。
- 文档页面链接仅用于人工复核；本仓库不依赖页面会话，也不以该记录授权远端调用。
- 本记录与授权店铺只读证据分离；常规远端读取及全部写入仍由运行时开关和业务服务边界控制。

## 根据 SKU 查询销量

- 文档 ID：`3001305`。
- 页面：<https://open.sheincorp.com/zh/documents/apidoc/detail/3001305>。
- 官方更新时间：`2025-07-21 11:33:00`。
- 方法与路径：`POST /open-api/goods/query-sku-sales`。
- 请求体：仅 `skuCodeList`，数组必填，单次最多 100 个 SKU 编码。
- 成功响应：`code`、`msg`、`traceId`，以及 `info.dataList[]` 的 `skuCode`、`realTimeSaleCnt`（当日）、`cydSaleCnt`（昨日）、`c7dSaleCnt`（近 7 日）、`c30dSaleCnt`（近 30 日）、`dt`（数据截止日，`yyyyMMdd`）。四个销量字段均为整数。

## 查询商品审核状态

- 文档 ID：`3001368`。
- 页面：<https://open.sheincorp.com/zh/documents/apidoc/detail/3001368>。
- 官方更新时间：`2025-08-15 14:49:04`。
- 方法与路径：`POST /open-api/goods/query-document-state`。
- 请求体：`spuList` 必填，单次最多 10 项；每项 `spuName` 必填，`version` 可选，且 `version` 必须位于对应的 `spuList` 项内，不得置于请求顶层。
- 成功响应：`code`、`msg`、`traceId`，以及 `info.data[]` 的 `spuName`、`version`、`skcList[]`；每个 SKC 含 `skcName`、`documentSn`、`documentState`、`failedReason`。`info.meta` 含 `count` 与 `customObj`。
- `documentState` 枚举：`-1` 验收失败、`1` 待审核、`2` 审核通过、`3` 审核失败、`4` 已撤回、`5` 申诉中。`failedReason[]` 项含 `content` 与 `language`。

## 实现约束

- ERP-07 schema 仅依据以上官方字段验证传输层结构。
- `document-state-projections` 将官方枚举投影为只读内部状态，未知枚举仍失败关闭。
- 该记录不把历史证据摘要追溯改写为“已现场观察”；历史摘要保持其原始人工复核状态。
