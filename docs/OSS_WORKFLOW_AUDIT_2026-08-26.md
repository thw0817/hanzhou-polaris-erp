# SHEIN 运营中心：商业级工作流与开源组件对照审计

本轮把现有网站按“数据读取、状态流转、异步任务、界面交互、权限、可观测性”逐板块核对；结论是**优先复用当前已经落地且有测试覆盖的开源栈**，而不是为了追求项目数量再叠加一套运行时。

## 对照结论

| 板块 | 当前实现 | 对照的成熟项目 | 结论 |
| --- | --- | --- | --- |
| 页面数据与缓存 | TanStack Query，按租户/用户/店铺分层 query key，手动刷新，关闭焦点轮询 | [TanStack Query](https://github.com/TanStack/query) | 保留；符合几十店铺、十余用户的低请求目标 |
| 长任务与发布幂等 | BullMQ 队列、任务状态、冻结载荷、结果未知保护 | [BullMQ](https://github.com/taskforcesh/bullmq)；[Temporal](https://github.com/temporalio/temporal) | 继续用 BullMQ。Temporal 适合更大规模持久工作流，但会增加服务、存储和运维边界，当前 4GB 单机不直接引入 |
| 前端状态 | React Query + 明确的发布/同步状态合同 | [XState](https://github.com/statelyai/xstate) | 只借鉴状态机/守卫思想；当前先不引入第二套状态容器，避免状态双写 |
| 表格与长列表 | TanStack Table + TanStack Virtual，分页窗口限制在服务端 | [TanStack Table](https://github.com/TanStack/table)、[TanStack Virtual](https://github.com/TanStack/virtual) | 保留；合规列表本轮补充显式列宽契约，修复重叠 |
| 拖拽/图片排序 | dnd-kit，图片字节直传私有对象存储 | [dnd-kit](https://github.com/clauderic/dnd-kit)、[Uppy](https://github.com/transloadit/uppy) | 保留当前轻量上传链路；Uppy 暂不引入，避免重复上传状态和大包体 |
| UI 组件与可访问性 | Radix primitives、Tailwind、Lucide | [Radix UI](https://github.com/radix-ui/primitives) | 保留；统一焦点、键盘和弹层行为 |
| 分析看板 | 服务器按 SHEIN 官方字段投影，前端只展示缓存/回读值 | [Apache ECharts](https://github.com/apache/echarts)、[Cube](https://github.com/cube-js/cube) | 后续分析增强可按需引入；不允许前端自行推断销量、库存或平台状态 |
| 订阅与动态提醒 | Webhook 验签、幂等落库、队列异步投影 | [OpenTelemetry JS](https://github.com/open-telemetry/opentelemetry-js) | 可观测性优先补 traceId/任务耗时指标；不在 Webhook 请求中执行重业务 |
| 权限与功能开关 | 服务端 tenant/user/store scope，管理员别名只在管理员视图 | [OpenFeature JS SDK](https://github.com/open-feature/js-sdk) | 暂不引入 SDK；权限必须由服务端判定，前端隐藏只能算体验优化 |

## 逐板块检查结果

- **商品草稿/批量建品/新建商品**：数据按当前店铺隔离；模板引用走替换语义；保存前预检不把合规提示误当作 SHEIN 商品发布阻断。
- **商品审核中心**：驳回原因、单个/批量重新发起、归档和任务次数在同一 SKC 任务链上；平台状态必须来自 SHEIN 回读，不用本地猜测覆盖。
- **合规工作台**：合规缓存和 SHEIN 平台状态分列，手动同步完成后只回读活动查询；本轮固定十列宽度，避免长 SKC/类目导致视觉重叠。
- **销量与库存/总览**：只使用 SHEIN 销量、库存接口返回字段；页面缓存不做定时刷新，服务器调度开关默认关闭。
- **模板中心**：模板作用域由服务端执行 `tenant/user/store` 隔离；管理员模板可以共享，但成员不能越权修改或查看管理员别名。
- **今日工作**：按用户可见店铺聚合；管理员看租户范围；只读缓存 + 手动刷新，不新增 30 秒轮询。
- **媒体与图片**：图片字节不经过控制服务，使用短期签名 URL 直传私有对象存储；页面缓存只保存元数据和临时 URL，不写服务器持久盘。

## 当前不直接引入的项目

Temporal、Cube、Superset、Metabase、Uppy、Formily、OpenFeature 和完整 OpenTelemetry exporter 都需要额外的服务、配置或数据治理。本阶段直接引入会扩大故障面；等店铺数量、数据库体量或监控需求达到部署边界，再按迁移门禁逐项加入。

## 发布门禁

每次上线必须满足：

1. `npm test` 全量通过；
2. `npm run build:v2` 通过；
3. `npm run release:audit:v2` 返回 `READY`；
4. 不调用 SHEIN 商品/合规写接口做验收；
5. 云端只原子切换候选 release，保留上一 release，并核验 `/health`、`/ready`、公网首页和登录态边界。

