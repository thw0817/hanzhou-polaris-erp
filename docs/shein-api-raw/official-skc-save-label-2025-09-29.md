# 绑定 SKC 和实拍图

来源：用户于 2026-08-21 从 SHEIN 开放平台复制的官方接口页。官方页面更新时间：2025-09-29 19:19:23。

- 方法：`POST`
- 路径：`/open-api/goods-compliance/skc-save-label`
- Content-Type：`application/json`
- 限流：单开发者 20 次/秒

官方请求体字段（拼写按 SHEIN 原文保留）：

```json
{
  "skcList": ["SKC"],
  "packageLableList": [
    { "imageUrl": "<上传接口返回>", "imageMd5": "<上传接口返回>" }
  ],
  "bodyLableList": [
    { "imageUrl": "<上传接口返回>", "imageMd5": "<上传接口返回>" }
  ]
}
```

- `skcList` 必填。
- `packageLableList` 是包装类型标签实拍图。
- `bodyLableList` 是商品本体类标签实拍图。
- `skcLablePicList` 及其子字段后续废弃，禁止新对接。
- 成功响应的任务汇总字段为 `totalCount`、`successCount`、`faildCount`、`faildList`；失败项为 `skc`、`code`、`reason`。`faild` 的拼写按官方原文保留。

该文档描述“绑定”，没有提供历史图片删除字段，也没有明确承诺新绑定会覆盖或移除历史图。因此实现不能把绑定成功表述为“原图已删除/覆盖”。

接口页把图片 URL/MD5 的来源写成 `/label-print`，但上传接口页明确说明 `/upload-skc-label-picture` 的返回值用于绑定，且绑定示例也是 URL+MD5。当前实现采用专用上传接口的响应，并保留此文档矛盾供真实验收。
