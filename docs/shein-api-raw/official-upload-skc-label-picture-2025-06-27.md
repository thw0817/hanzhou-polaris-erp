# 上传实拍图图片

来源：用户于 2026-08-21 从 SHEIN 开放平台复制的官方接口页。官方页面更新时间：2025-06-27 15:10:05。

- 方法：`POST`
- 路径：`/open-api/goods-compliance/upload-skc-label-picture`
- 限流：单开发者 20 次/秒
- 文件字段：`file`（blob）
- 文件限制：PNG/JPEG/JPG；不超过 10 MB；宽、高均不超过 8000px
- 成功响应：顶层 `code="0"`、`msg="OK"`；`info.imageUrl` 和 `info.imageMd5` 用于后续绑定；保留 `info.code`、`info.msg` 和顶层 `traceId`

官方请求头表写 `Content-Type: application/json`，但同页 curl 示例使用 `--form file=@...`。实现以文件字段和官方 curl 为准，发送 multipart，并让运行时自动生成带 boundary 的 Content-Type，不手写 JSON Content-Type。

官方示例中的签名、openKeyId 和带签名图片 URL 未复制进仓库；本文件只保留字段级契约。
