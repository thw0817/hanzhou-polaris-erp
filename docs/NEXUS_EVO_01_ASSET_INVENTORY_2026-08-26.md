# NEXUS-EVO-01 代码与功能资产盘点

日期：2026-08-26（Asia/Shanghai）  
方案：NEXUS-OPS-01-EVO：渐进式店群运营中台升级  
阶段：EVO-01

## 盘点范围

- V2 页面：`src-v2/features`、`src-v2/app`、`src-v2/components`
- 云端服务：`server/cloud`
- API 与数据契约：`src-v2/lib/api.ts`、`docs/V2_PAGE_MAP.md`、`docs/V2_DATA_PERMISSION_MODEL.md`
- HEF-01、HST-01、HWF-01、SRF-01 实施记录
- 117 个服务端测试文件、27 个 V2/前端契约测试文件

本阶段只盘点和记录，不修改业务代码、不修改数据库、不改变线上行为。

## 总体结论

当前系统已经具备 NEXUS 的大部分基础能力：React/Vite、TanStack Query、TanStack Table/Virtual、Radix/Tailwind/Lucide、BullMQ、Webhook 幂等落库、SHEIN 官方回读、发布结果未知保护、合规官方必填回读和手动刷新机制均已存在。

但这些能力在页面和接口之间还没有完全收敛为统一合同。当前最重要的结构性风险不是“缺一个页面”，而是：

1. 部分前端 Query key 只包含 `storeId`，没有统一加入租户和用户作用域。
2. 草稿、批量建品、新建商品仍有部分重复编辑逻辑，未来修复容易出现行为漂移。
3. 审核、发布、合规虽然有状态合同，但页面投影、任务回读和历史版本收敛还需要统一入口。
4. Trace ID 已在 SHEIN 请求和部分结果中传递，但尚未形成完整的 API→队列→数据库可观测指标体系。
5. 经营分析目前以官方字段投影和规则计算为主，预警类型、趋势维度和深链还没有完全达到 NEXUS 的目标范围。

## 九大模块资产矩阵

状态含义：`稳定` = 已有测试并可保留；`部分完成` = 能力存在但还有统一性/覆盖缺口；`风险` = 后续必须优先处理。

| 编号 | 模块 | 现有资产 | 当前状态 | NEXUS 缺口/风险 | 对应后续步骤 |
| --- | --- | --- | --- | --- | --- |
| 01 | 总览/经营驾驶舱 | `OverviewPage`、`store-business-service`、经营快照、手动刷新、来源截止时间 | 部分完成 | 指标来源/缓存状态还未形成统一展示合同；经营分析维度仍有限 | EVO-03、EVO-09 |
| 02 | 销量与库存 | `SalesInventoryPage`、SKU 展开、销量/库存/在途投影、未知值保护 | 稳定+部分完成 | 需要统一服务端分页、更多风险维度和官方/本地计算标识 | EVO-03、EVO-09 |
| 03 | 经营预警 | `AlertsPage`、库存/销量规则、深链基础 | 部分完成 | 预警类型尚未覆盖发布待确认、合规缺失、API 异常等完整集合；历史确认/指派能力不足 | EVO-09、EVO-11 |
| 04 | 商品草稿 | `ProductDraftsPage`、`product-draft-service`、预检、保存/归档/额度提示 | 部分完成 | 与单个/批量编辑器仍有重复逻辑；部分 Query key 未带完整 scope；统一步骤合同需收敛 | EVO-02、EVO-03、EVO-08 |
| 05 | 批量建品/新建商品 | `BatchProductCreatePage`、`NewProductPage`、图片/模板/SKU/预检链路 | 部分完成 | 两个页面仍存在重复状态和表单分支；需要统一编辑器内核、单属性替换和大列表窗口 | EVO-08、EVO-10 |
| 06 | 商品审核中心 | `PublishBatchesPage`、`product-review-service`、状态别名归一化、驳回/重发/归档、任务 ID | 稳定+部分完成 | 需进一步统一“当前版本 vs 历史版本”投影、动态发布进度、批量归档和官方状态回读 | EVO-05、EVO-06 |
| 07 | 合规工作台 | `CompliancePage`、`ComplianceDetailPage`、必填项回读、1630/1631 官方回读、报告/实拍图入口 | 部分完成 | 详情、草稿、模板查询 key 仍不完全统一；官方报告等待和写入能力需要统一状态合同 | EVO-02、EVO-03、EVO-07 |
| 08 | 模板中心 | 属性/尺寸/包装/尾图/标题/合规模板页面、服务端 tenant/user/store scope | 部分完成 | 多数模板页面 Query key 仅带 store；版本/共享/复制/复验在 UI 上未完全统一 | EVO-02、EVO-08、EVO-10 |
| 09 | 今日工作 | `TodayWorkPage`、`today-work-service`、HEF 动态流、手动刷新、管理员/成员范围 | 稳定+部分完成 | 事件类型、类目/操作人维度和时间线投影仍需扩展；错误恢复和来源标签需统一 | EVO-03、EVO-09、EVO-11 |

## 基础设施资产矩阵

| 能力 | 已有实现 | 盘点结论 |
| --- | --- | --- |
| UI 组件 | Radix、Tailwind、Lucide、共享 `OperationsShared` 和 primitives | 保留，后续统一设计令牌和状态组件，不引入第二套 UI 框架 |
| 服务端缓存 | PostgreSQL 快照、Redis/任务状态、Query cache | 保留；需要统一 stale/cache/source 契约 |
| 异步任务 | BullMQ、`sync_jobs`、发布/规则/合规/经营 Worker | 保留；后续补统一任务投影、队列指标和限流观察 |
| 图片与媒体 | `media_assets`、同源内容地址、对象存储、清理 Worker | 保留；继续加强跨页面缓存和引用生命周期 |
| SHEIN 适配 | `shein-client`、`store-data-sync`、合规/上传/发布适配器 | 保留；后续统一错误码、trace、状态映射和只读/写入边界 |
| 权限 | 会话、租户、店铺白名单、服务端角色检查 | 服务端基础稳定；前端缓存 key 和个别路由合同仍需复核 |
| 可观测性 | traceId、任务错误、来源时间、审计日志 | 部分完成；尚无统一端到端指标和管理员观测面板 |
| 测试 | 服务端单测、V2 UI 静态契约、构建/发布审计 | 基线稳定；后续每个 EVO 步骤必须先增加回归覆盖 |

## 已确认的 Query key 风险清单

以下页面当前存在“没有同时显式带 tenant/user scope”的查询 key，不能直接认定为跨店串数据，但应在 EVO-02/EVO-03 统一收敛：

- `src-v2/features/publishing/ProductDraftsPage.tsx`
- `src-v2/features/publishing/NewProductPage.tsx`
- `src-v2/features/publishing/BatchProductCreatePage.tsx`
- `src-v2/features/compliance/ComplianceDetailPage.tsx`
- `src-v2/features/compliance/ComplianceDraftEditor.tsx`
- `src-v2/features/templates/TitleRuleTemplatesPage.tsx`
- `src-v2/features/templates/SizeTemplatesPage.tsx`
- `src-v2/features/templates/PackagingTemplatesPage.tsx`
- `src-v2/features/templates/TailImageTemplatesPage.tsx`
- `src-v2/features/templates/ComplianceTemplatesPage.tsx`

统一目标：

```text
["tenant", tenantId, "user", userId, "store", storeId, module, query, filters]
```

切换店铺、退出登录、权限变化时，必须只失效当前作用域，不复用旧店铺/旧账号的占位数据。

## 已确认的非阻断缺口

这些不是本阶段立即修改项，但必须进入后续开发清单：

1. 经营预警需要补齐发布结果待确认、合规缺失、API 同步异常等预警类型。
2. 审核中心需要统一当前发布版本与历史驳回版本的时间线投影。
3. 发布动态需要从“任务状态”扩展为每个 SKC 的可读进度和结果摘要。
4. 草稿、批量建品、新建商品需要共享同一个编辑器状态合同。
5. 模板中心需要统一版本、共享范围、复制和复验 UI。
6. Trace ID 需要贯通浏览器请求、控制服务、队列、Worker、数据库和 SHEIN API。
7. 总览和今日工作需要增加官方来源、缓存时间和统计截止时间的统一展示。

## NEXUS-EVO 后续执行顺序

盘点结果确认后，执行顺序固定为：

1. `EVO-02`：先修权限和作用域，避免后续改缓存时扩大串店风险。
2. `EVO-03`：再统一 Query key、缓存、刷新和新鲜度。
3. `EVO-04`：统一 SHEIN API 适配、错误码和 trace。
4. `EVO-05/EVO-06`：收敛审核状态机和发布任务幂等。
5. `EVO-07/EVO-08`：合规与统一商品编辑器。
6. `EVO-09/EVO-10/EVO-11`：分析、UI 和可观测性。
7. `EVO-12`：全量门禁、灰度、部署和回滚验收。

## 阶段结论

EVO-01 已完成。现有稳定能力已标记为保留，结构性缺口已映射到后续序号；本阶段没有修改业务代码或部署线上版本。
