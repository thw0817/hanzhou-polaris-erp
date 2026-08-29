# SHEIN 涵舟工作室 V2 页面地图

更新时间：2026-08-03  
状态：阶段 1 基线，待产品确认  
依据：`REBUILD_HANDOFF_2026-08-03.md`、现有云端路由与迁移 001-020

## 1. 目标与假设

本文件固定 V2 的页面边界，不定义视觉稿，也不表示启用 SHEIN 写接口。

当前假设：

1. 数据库已有 `owner`、`admin`、`operator`、`viewer` 四种角色。产品文案中的“管理员”映射为 `owner/admin`，“普通成员”映射为 `operator`；`viewer` 保留为只读成员。
2. 所有 `/app` 页面要求有效 HttpOnly 会话。带 `:storeId` 的页面必须同时通过租户、店铺和成员店铺白名单校验。
3. 页面进入只读取 PostgreSQL 缓存，不自动调用 SHEIN。只有明确点击“立即刷新”才创建或复用后台同步任务。
4. V2 首个业务闭环是单店铺经营读取与单商品草稿/预检。批量发布、生产写入和创作工具后置。
5. `owner` 与 `admin` 当前权限相同；只有租户所有权转移等未来能力才区分二者。

## 2. 全局壳层

### 2.1 登录外页面

| 路由 | 用户 | 店铺上下文 | 数据源 | 主要动作 |
| --- | --- | --- | --- | --- |
| `/login` | 未登录用户 | 无 | `POST /v1/web/login`、`GET /v1/web/session` | 登录、恢复会话 |
| `/app/forbidden` | 已登录但无权限 | 无 | 路由权限结果 | 返回可访问页面 |
| `/app/no-stores` | 无可用店铺的成员 | 无 | `GET /v1/web/stores` | 管理员授权店铺；普通成员联系管理员 |

登录页只处理身份验证，不展示经营数据、演示数据或产品介绍。

### 2.2 应用框架

应用框架固定包含：

- 左侧导航：经营、发布、模板、合规、创作、设置。
- 顶部店铺切换器：只列当前成员可访问的真实 SHEIN 店铺。
- 当前页标题、面包屑和数据新鲜度。
- 全局任务入口：显示当前用户可见的同步、预检、发布和生图任务。
- 用户菜单：账号、角色、退出。

店铺切换规则：

- 带 `:storeId` 的 URL 是店铺上下文唯一事实来源。
- 切换店铺时保留当前业务子路由，替换 `storeId`；目标店铺无权访问时回到该成员第一家可用店铺。
- 本地只记录最近访问的 `storeId`，不能据此授予权限。
- 顶部切换器不加入“全部店铺”“团队项目”等非真实店铺项。

## 3. 页面总表

角色缩写：`A` = owner/admin，`O` = operator，`V` = viewer。

| 路由 | 页面 | 角色 | 主数据源 | 可执行动作 | 阶段 |
| --- | --- | --- | --- | --- | --- |
| `/app/operations/:storeId/products` | 商品经营 | A/O/V | `spus`、`skcs`、`skus`、最新销量/库存投影 | 搜索、筛选、展开 SKU；A/O 可刷新 | 5 |
| `/app/operations/:storeId/sales-inventory` | 销量与库存 | A/O/V | `sku_sales_daily`、`store_sales_daily`、`inventory_snapshots` | 查看趋势与缺口；A/O 可刷新 | 5 |
| `/app/operations/:storeId/alerts` | 经营预警 | A/O/V | 结构化商品、销量、库存投影 | 筛选、定位商品；A/O 可刷新 | 5 |
| `/app/operations/:storeId/products/new` | 新建单个商品 | A/O | `product_drafts`、模板、规则缓存、媒体 | 新建、保存、预检 | 7 |
| `/app/operations/:storeId/products/drafts` | 商品草稿 | A/O/V | `product_drafts` | A/O 编辑/归档；V 查看 | 7 |
| `/app/operations/:storeId/publishing` | 发布批次 | A/O/V | `publish_batches`、`publish_batch_items`、发布执行状态与回执 | 预检、暂停、恢复；A/O 在服务端执行门禁开启时可逐项核对冻结载荷、生成并消费一次性授权 | 8/10 |
| `/app/templates/:storeId/attributes` | 商品属性模板 | A/O/V | `publish_templates`、类目/属性规则缓存 | A/O 新增、编辑、删除、复验 | 6 |
| `/app/templates/:storeId/sizes` | 颜色与尺寸模板 | A/O/V | `publish_templates` | A/O 新增、编辑、删除 | 6 |
| `/app/templates/:storeId/packaging` | 打包体积模板 | A/O/V | `publish_templates` | A/O 上传标准 Excel、覆盖、删除 | 6 |
| `/app/templates/:storeId/tail-images` | 尾部主图模板 | A/O/V | `publish_templates`、`media_assets` | A/O 上传、裁剪、排序、删除 | 6 |
| `/app/templates/:storeId/compliance` | 店铺合规模板 | A/O/V | 店铺范围 `publish_templates`/合规工作区 | A/O 保存店铺共用资料 | 6/9 |
| `/app/compliance/:storeId/overview` | 合规总览 | A/O/V | `skcs`、`skc_compliance_records`、同步任务 | 筛选、进入 SKC；A/O 刷新 | 9 |
| `/app/compliance/:storeId/product/:skc` | 单商品合规 | A/O/V | 合规规则、`compliance_drafts`、媒体 | A/O 保存、预检；真实提交默认关闭 | 9 |
| `/app/creative/image` | 单图创作 | A/O | 生图任务、媒体、租户计价配置 | 规划、确认计费、生成、下载、清除 | 11 |
| `/app/settings/stores` | 店铺管理 | A/O/V | `stores`、`membership_store_access` | A 授权/分配/停用；有权成员改显示名 | 3 |
| `/app/settings/members` | 成员管理 | A | `users`、`memberships`、店铺白名单 | 新增、禁用、改角色、分配店铺 | 3 |
| `/app/settings/integrations` | 集成设置 | A | 授权状态、O1Key 状态、Webhook 健康状态 | 配置/测试允许的集成 | 3/11 |
| `/app/settings/usage` | 生图用量 | A | `image_generation_usage_events` | 按成员、模型、周期查看 | 11 |

## 4. 经营模块

### 4.1 商品经营

默认排序为近 30 日销量降序。列表字段只使用可追溯数据：

- 主图、标题、SPU/SKC、SHEIN 精确上架状态。
- 今日、昨日、7 日、30 日销量及统计截止日。
- 实际库存、上架天数、最新同步时间。
- SKU 展开行中的尺寸、商家 SKU、销量、实际库存、可售天数和建议备货缺口。

不展示：推算销售额、无法确认的虚拟/实际售卖标记、误导性虚拟库存。

页面动作：

- 搜索 SKC、SPU、商家 SKU。
- 按精确上架状态和库存风险筛选。
- 展开单个 SKC 的 SKU，不在当前页编辑发布资料。
- 点击“立即刷新”创建或复用 `store_business_refresh` 任务。

### 4.2 销量与库存

视图分为“SKU 明细”和“店铺趋势”两个标签。默认不加载 ECharts，进入趋势标签后懒加载。

- 可售天数 `<= 5` 显示红色状态，`> 5` 显示绿色状态。
- 已下架、尾货、售完下架不显示红绿灯。
- 建议备货只显示缺口正数，不显示负数。
- 每个值同时展示数据日期/采集时间，避免把每日统计误称实时数据。

### 4.3 经营预警

预警类型只由真实指标生成：库存告急、动销新品、滞销和销量下降。上架 7 天内且周销大于 3 的商品进入实物库存与备货提醒。

每条预警包含真实主图、SKC、实际库存、上架天数和销量窗口；点击后进入商品经营页并定位该 SKC。

## 5. 模板与发布模块

### 5.1 模板可见性

| 创建者/类型 | 数据库 scope | 可见范围 | 可管理人 |
| --- | --- | --- | --- |
| 管理员创建的非合规模板 | `tenant` | 当前租户全部成员和店铺 | owner/admin |
| 普通成员创建的非合规模板 | `user` | 创建者自己的全部授权店铺 | 创建者 |
| 店铺合规模板 | `store` | 来源店铺 | 创建者或 owner/admin |

模板列表必须明确显示范围、版本、更新时间和规则快照时间。模板使用时按当前店铺、类目和实时规则重新验证；规则过期时阻断。

### 5.2 单商品工作区

`/app/publish/:storeId/new` 是独立全宽工作区，步骤固定为：

1. 基础信息与标题。
2. 主图、尾图和 SKU 图。
3. 商品属性模板与末级类目。
4. 颜色、尺寸和 SKU 高频字段。
5. 包装、重量和尺码表。
6. 店铺共用合规与商品独立材料。
7. 预检与冻结快照。

草稿只有显式“保存”动作，并显示 `saving/saved/error`。离开存在未保存内容的页面时确认。预检错误必须映射到步骤、字段和 SKU。

真实发布按钮默认不渲染。部署第 034 号迁移并显式开启控制服务与独立发布 Worker 后，仍要求逐商品冻结载荷核对、最终人工确认、一次性授权、幂等任务、平台回执、商品状态回读和发布后合规复验。

## 6. 合规模块

总览只读取缓存状态，支持“全部、通过、需修正、审核中、平台待处理、规则过期、同步失败”筛选。

单 SKC 页面按平台返回的 `complianceGroupCode` 分组：

- 资质证书。
- 代理公司/责任人。
- 警示语。
- 商品本体与包装实拍图。
- API 只读能力，包括可同步官方要求字段、但开放平台暂不支持提交的 GCC 与产品标识。

1630/1631 和商品独立实拍材料不能进入通用模板。未验证动作显示“平台待处理/能力未开放”，不能显示成功态。

## 7. 页面通用状态

每个数据页面必须实现以下状态，不能用假数据填充：

| 状态 | 页面行为 |
| --- | --- |
| 首次加载 | 保持稳定布局的 Skeleton，不触发 SHEIN 同步 |
| 无数据 | 解释当前缓存为空，并提供有权限的“立即刷新”动作 |
| 缓存新鲜 | 展示最近同步时间和来源截止日 |
| 缓存过期 | 继续展示旧缓存，明确标记过期；允许刷新 |
| 刷新中 | 展示同一任务进度；重复点击复用任务 |
| 部分失败 | 保留成功数据，列出失败批次/SKC 和重试入口 |
| 权限变化 | 清除当前页面查询缓存并跳转到可访问店铺 |
| 店铺需重新授权 | 页面只读，阻断新同步与写操作 |
| 网络错误 | 保留已加载数据并提供重试，不清空列表 |

## 8. 前端查询边界

建议的 TanStack Query key：

```text
['session']
['stores']
['store', storeId, 'products', filters]
['store', storeId, 'sales-inventory', filters]
['store', storeId, 'alerts', filters]
['store', storeId, 'templates', templateType]
['store', storeId, 'drafts']
['store', storeId, 'compliance', filters]
['store', storeId, 'jobs', jobType]
```

任何 key 都不能遗漏 `storeId`。切换店铺时不复用上一个店铺的占位数据；mutation 成功后只失效所属租户与店铺的查询。

## 9. 现有能力与页面缺口

可直接复用：网页登录会话、店铺列表与访问校验、店铺改名、经营快照、商品查询适配器、发布规则读取、模板、商品草稿、批次预检、合规工作区、媒体直传和生图用量服务。

进入 V2 骨架前必须补齐的接口设计：

- 经营列表改为 PostgreSQL 结构化查询，不能继续让页面 `GET /products` 直连 SHEIN。
- 成员列表、角色修改和店铺分配 API 尚未形成网页路由。
- `sync_jobs` 的统一任务列表/详情/重试 API 尚未形成网页路由。
- 商品草稿缺少按 `draftId` 的读取、更新和归档路由。
- 经营页分页、排序和筛选需要服务端契约，不能只在前端处理全量数据。
- V2 创作工具是否脱离店铺上下文需在阶段 11 前确认；当前服务仍以 `storeId` 授权。

## 10. 验收清单

- 所有业务路由均有明确角色和店铺上下文。
- 所有页面均有真实数据源、动作、加载、空、错误和过期状态。
- 页面进入不会触发 SHEIN 全店同步。
- 普通成员不能通过修改 URL 访问未分配店铺。
- 店铺切换不会混入跨店查询缓存。
- 未验证的写能力和动态字段不会出现在可执行 UI 中。
