# NEXUS-EVO-02：租户、用户与店铺作用域收敛

日期：2026-08-26  
范围：V2 前端 Query key 与失效策略  
状态：已完成，未部署云端

## 目标

在进入统一缓存与刷新重构前，先保证不同租户、用户和店铺不会因为浏览器缓存复用而展示错误数据。服务端权限校验和 SHEIN 写入边界保持不变。

## 已完成

- 商品草稿、单个建品、批量建品：查询与保存/归档失效均使用 `queryScope + storeId`。
- 合规详情、合规草稿、批量合规复用和合规报告模板：查询与失效均使用 `queryScope + storeId`。
- 标题、尺寸、包装、尾图、合规模板：查询与增删改失效均使用 `queryScope + storeId`。
- 新增静态回归合同，要求目标模块存在租户/用户作用域并将作用域放入 store key。

## 验证

- `node --test server/cloud/v2-core-ui-system.test.js`：18/18
- `node --test server/*.test.js`：124/124
- `npm test`：1057/1057
- `npm run build:v2`：通过
- `npm run release:audit:v2`：READY，14/14，无阻断

## 未做事项

- 未改服务端权限模型、SHEIN API 适配器和写入开关。
- 未部署云端；EVO-03 将在此基础上统一缓存、手动刷新和新鲜度提示后再进入发布门禁。
