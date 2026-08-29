# SHEIN 涵舟工作室 V2 重构交接

更新时间：2026-08-03  
项目目录：`/Users/tianhanwen/Documents/SHEIN爆单了`  
目标：在新对话中停止继续修补旧页面，以 SHEIN 官方 API 契约为核心，重建一个面向店群内部运营的稳定网页系统。

> 本文件是 V2 重构的首要交接入口。它不替代 SHEIN 原始 API 文档，也不表示允许调用生产写接口。

## 1. 新对话必须先做什么

新对话开始后，按以下顺序执行，不要直接改旧页面：

1. 完整读取本文件。
2. 完整读取项目级代码规范：`.agents/skills/karpathy-guidelines/SKILL.md`。
3. 涉及 SHEIN、地毯、合规或发布时，读取 `shein-full-service-rug-operator` skill 及任务相关 reference。
4. 读取：
   - `docs/SHEIN_API_SOURCE_INDEX.md`
   - `docs/SHEIN_API_FIELD_HANDOFF.md`
   - `docs/SHEIN_INTEGRATION_BLUEPRINT.md`
   - `docs/SHEIN_PRODUCT_PUBLISH_CONTRACT.md`
   - `docs/CLOUD_DEPLOYMENT_ARCHITECTURE.md`
5. 检查 `git status --short`、当前测试和构建结果，保护现有功能与用户文件。
6. 先完成 V2 页面地图、API 能力矩阵、数据/权限模型，确认后再搭前端骨架。

禁止一上来重写全部代码。V2 应与旧版隔离建设，逐模块迁移、逐模块验收。

## 2. 已确认的产品目标

产品名称统一为：**SHEIN 涵舟工作室**。

这是 4–5 人、约 20 家 SHEIN 全托管店铺使用的内部店群管理网站，后续可扩展，但当前不为外部 SaaS 过度设计。

核心能力按优先级排列：

1. 登录、成员、店铺授权和严格的数据隔离。
2. 单店铺商品经营、销量、库存和经营预警。
3. 动态模板中心和单个商品创建/发布。
4. 商品合规资料管理和发布前阻断校验。
5. 单品闭环稳定后再做批量建品、批量预检和批量发布。
6. 单图生图作为辅助创作工具，不是网站首页核心。

## 3. 用户与权限规则

### 3.1 角色

- 管理员：可以查看当前租户全部成员、全部授权店铺、成员生图成功次数和费用。
- 普通成员：只能查看和操作分配给自己的授权店铺。
- 所有数据库业务查询必须同时校验 `tenant_id`、`store_id` 和成员权限。
- 浏览器永远不能获得 SHEIN `secretKey`、COS SecretKey、O1Key 或云端会话主令牌。

### 3.2 店铺

- 每个 SHEIN 授权店铺拥有独立 `openKeyId` 和 `secretKey`。
- 店铺授权后允许用户自定义店铺名称，网站统一显示自定义名称。
- 顶部店铺切换器只列真实 SHEIN 店铺，不混入“团队生图项目”等非店铺项。
- 页面切换店铺后，只显示当前店铺数据，禁止跨店混合。
- 页面进入时只读数据库缓存，不自动触发全店同步。
- 同步由 Webhook、定时任务或明确的“立即刷新”触发；重复点击复用同一个任务。

### 3.3 模板可见范围

- 管理员创建的非合规模板：租户全员、所有店铺可用。
- 普通成员创建的非合规模板：该成员自己名下所有店铺可用。
- 店铺合规模板：只属于来源店铺，不能跨店共用。
- 模板必须可新增、命名、修改、删除；保存后给出明确成功或失败反馈。
- 模板保存的是真实字段 ID、值 ID、规则版本和快照，不是只保存中文标签。
- 模板使用时必须按当前店铺、类目和 SHEIN 实时规则重新验证，过期模板阻断而不是猜测修复。

## 4. 当前仓库真实基线

2026-08-03 本地核验结果：

- 分支：`main`。
- 工作树存在大量未跟踪文件；不要清理、重置或覆盖用户内容。
- `npm test`：286 项通过，0 失败。
- `npm run build:web`：成功。
- Web 构建产物：
  - CSS 约 115.83 kB，gzip 20.54 kB。
  - 主 JS 约 336.94 kB，gzip 103.53 kB。
  - 另一 JS chunk 约 65.87 kB，gzip 19.09 kB。
- 旧前端规模：
  - `src/WebApp.jsx`：6204 行。
  - `src/web-styles.css`：4346 行。
- 旧云端控制服务：`server/cloud/control-server.js` 1871 行。
- 已有 PostgreSQL 迁移 001–020；注意有两个 `014_*.sql`，重构时不能假定仅凭编号唯一排序，先核对迁移器行为与生产记录。

结论：旧版不是废代码。它是业务契约、已验证算法和测试用例来源，但不应继续作为 V2 的页面架构。

## 5. 旧实现哪些保留，哪些不延续

### 5.1 优先复用和迁移

- SHEIN HMAC 签名、AES 解密、请求头差异和错误/TraceId 保留。
- 店铺密钥加密、授权 state 哈希、HttpOnly 会话、Trusted Origin 校验保留。
- Webhook 验签、解密、幂等、原始事件保存、重放和业务投影保留。
- PostgreSQL 多租户数据模型、Redis/BullMQ 任务语义保留并审查。
- 商品、销量、库存、类目 Schema、发布模板、草稿、合规工作区等服务层测试保留。
- COS/S3 预签名上传/下载、HEAD 校验、生命周期和引用保护逻辑保留。
- O1Key 服务端配置、异步任务 ID、计费台账和 3 天创作图片清理保留。
- 图片裁剪比例、包装表解析、面积/克重/价格计算等纯函数与测试保留。

### 5.2 V2 不延续

- 不继续扩展 6204 行的 `WebApp.jsx`。
- 不复制旧页面的巨型条件渲染、手写选择器和散落状态。
- 不在一个页面同时堆商品列表、建品表单、任务中心和模板编辑。
- 不做假数据、假按钮、演示型业务页面。
- 不用页面进入触发整店 SHEIN 拉取。
- 不让图片字节经 Node API 中转后再上传对象存储。
- 不把 SHEIN 动态类目/属性/合规枚举硬编码成长期真相。
- 不同时引入多套 UI 体系。

## 6. SHEIN 文档与事实来源

### 6.1 来源优先级

1. 当前店铺实时 API 返回的类目、字段规范、属性、关联规则和合规规则。
2. `docs/shein-api-raw/` 中 52 份 SHEIN 原始文本。
3. `docs/SHEIN_API_SOURCE_INDEX.md` 的原文映射。
4. `docs/SHEIN_API_FIELD_HANDOFF.md` 和专项契约文档。
5. 示例 curl 只用于参考；标题、参数表、示例冲突时不得盲抄示例。

平台规则、接口权限和合规要求会变化。凡是动态或高风险信息，必须用当前官方文档或真实测试店铺只读响应复核。

### 6.2 已归档的关键接口

| 领域 | 关键接口/资料 |
| --- | --- |
| 鉴权 | 临时令牌换取店铺 `openKeyId`/`secretKey`、签名说明 |
| 商品查询 | `/goods/searchProduct`、`/goods/spu-info`、商品列表 |
| 库存销量 | `/stock/stock-query`、SKU 销量、`/goods/stock-update` |
| 类目发布规则 | `/goods/query-category-tree`、`/goods/query-publish-fill-in-standard` |
| 动态属性 | `/goods/query-attribute-template`、`/goods/get-associated-attribute-rules`、新增自定义属性值 |
| 发布 | `/goods/product/publishOrEdit`、发布权限、额度、商家 SKU 查重、图片上传 |
| 商品维护 | 部分编辑、上下架、删除申请、成本价、建议零售价 |
| 合规 | 合规要求、证书规则/Schema、证书上传、代理公司/责任人、实拍图、警示语 |
| 采购发货 | 采购单、采购退货、发货单、物流相关接口 |
| 财务 | 报账单、销售款/补扣款收支明细 |
| 事件 | 商品、价格、采购、发货、缺货、合规、授权关系 Webhook |

精确原始文件名必须从 `docs/SHEIN_API_SOURCE_INDEX.md` 查找。

## 7. V2 技术选型

原则：少而统一。正式采用一套核心栈；其他项目只借鉴交互，不把所有热门库装进项目。

### 7.1 正式采用

| 领域 | 项目 | 用途 |
| --- | --- | --- |
| 基础 | [React](https://github.com/facebook/react) + TypeScript + [Vite](https://github.com/vitejs/vite) | V2 前端基础 |
| 路由 | [React Router](https://github.com/remix-run/react-router) | 真正的一级/二级页面和 URL 状态 |
| UI | [shadcn/ui](https://github.com/shadcn-ui/ui) + [Radix Primitives](https://github.com/radix-ui/primitives) | 可控、无障碍、统一的表单/弹层/选择器基础 |
| 样式 | [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) + CSS Variables | 黑白中性色设计令牌、紧凑响应式布局 |
| 图标 | [Lucide](https://github.com/lucide-icons/lucide) | 统一图标系统 |
| 服务端状态 | [TanStack Query](https://github.com/TanStack/query) | 缓存、请求去重、失效、后台刷新 |
| 表格 | [TanStack Table](https://github.com/TanStack/table) + [TanStack Virtual](https://github.com/TanStack/virtual) | 商品/SKU 大列表与虚拟滚动 |
| 表单 | [React Hook Form](https://github.com/react-hook-form/react-hook-form) + [Zod](https://github.com/colinhacks/zod) | 动态字段、校验和精确错误定位 |
| 上传 | [Uppy](https://github.com/transloadit/uppy) | 自定义 UI、并发、重试、进度、预签名直传 |
| 裁剪/缩放 | [Cropper.js](https://github.com/fengyuanchen/cropperjs) + [Pica](https://github.com/nodeca/pica) + [Comlink](https://github.com/GoogleChromeLabs/comlink) | 浏览器真实裁剪、Worker 缩放，避免阻塞主线程 |
| 排序 | [dnd-kit](https://github.com/clauderic/dnd-kit) | 主图/尾图拖拽排序 |
| 图表 | [Apache ECharts](https://github.com/apache/echarts) | 经营趋势，按页面懒加载 |
| 队列 | [BullMQ](https://github.com/taskforcesh/bullmq) | 同步、发布、清理、重试、限流 |
| 队列管理 | [bull-board](https://github.com/felixmosh/bull-board) | 仅管理员的内部任务诊断页 |
| 端到端测试 | [Playwright](https://github.com/microsoft/playwright) | 登录、权限、店铺切换、建品、上传、预检 |
| API Mock | [MSW](https://github.com/mswjs/msw) | 前端契约测试与异常场景 |
| 组件验收 | [Storybook](https://github.com/storybookjs/storybook) | 动态字段、表格、上传、裁剪组件独立验收 |
| 性能门禁 | [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) | 构建后的性能回归门禁 |

### 7.2 只借鉴设计，不作为核心依赖

- [shadcn-admin-kit](https://github.com/Kiranism/next-shadcn-dashboard-starter)：借鉴后台壳层、侧边栏、密度和空状态。
- [Ant Design](https://github.com/ant-design/ant-design)：借鉴 Cascader、复杂表单、SKU 表格和确认式选择交互。
- [Formily](https://github.com/alibaba/formily)：借鉴 Schema 驱动和字段联动模型。
- [react-jsonschema-form](https://github.com/rjsf-team/react-jsonschema-form)：借鉴 JSON Schema 表单思想。

### 7.3 需要先做技术验证

- [AG Grid](https://github.com/ag-grid/ag-grid)：只考虑 SKU 电子表格式批量编辑；先核对 Community 能力和许可证，不能让核心流程依赖付费功能。
- [tus](https://github.com/tus/tus-js-client)：仅在大量超大文件确实需要断点续传时引入；普通商品图优先 Uppy + 预签名 PUT。
- [Zustand](https://github.com/pmndrs/zustand)：只有跨路由临时 UI 状态变复杂后再用；不能用它复制服务器缓存。

### 7.4 明确不作为 V2 主框架

- MUI、Mantine、Refine、react-admin。
- Appsmith、ToolJet、Budibase。
- 整套 Next.js SaaS 模板。
- 原因：会形成第二套 UI/路由/数据抽象，增加迁移和样式冲突，并不能替代 SHEIN 领域模型。

## 8. 强制代码规范 Skill

项目级文件：`.agents/skills/karpathy-guidelines/SKILL.md`。  
全局副本：`/Users/tianhanwen/.codex/skills/karpathy-guidelines/SKILL.md`。

后续写、改、审代码必须使用该 skill，执行要点：

1. 编码前写清假设、歧义和取舍。
2. 选择解决问题的最小实现，不做未要求的抽象。
3. 只改当前目标需要的文件，不顺手重构无关代码。
4. 每项工作先定义可验证成功标准，再循环到验证通过。
5. Bug 先写复现测试，再修复。
6. 新代码不以“以后可能用”为由增加配置和框架。

该 skill 是社区维护的行为规范，不是 Andrej Karpathy 官方软件依赖；项目只需要保留这一份 skill，不需要为每个 GitHub 库安装 skill。

## 9. V2 页面信息架构

建议使用真实路由，不再靠一个 React 组件切换全部面板：

```text
/login
/app
  /operations/:storeId/products
  /operations/:storeId/sales-inventory
  /operations/:storeId/alerts
  /publish/:storeId
    /new
    /drafts
    /batches
  /templates/:storeId
    /attributes
    /sizes
    /packaging
    /tail-images
    /compliance
  /compliance/:storeId
    /overview
    /product/:skc
  /creative/image
  /settings/stores
  /settings/members        # 仅管理员
  /settings/integrations   # 仅管理员或指定角色
```

左侧导航按业务分组；店铺切换固定在顶部。店铺授权、成员管理放在导航底部。建品表单使用独立路由或全屏二级工作区，不在商品列表下方展开。

## 10. 前端目录建议

不要一次创建所有目录；随首个垂直切片逐步建立：

```text
src-v2/
  app/                 # 路由、布局、权限边界、QueryClient
  components/ui/       # shadcn/ui 基础组件
  components/domain/   # 店铺切换、动态字段、媒体上传等复用组件
  features/auth/
  features/stores/
  features/operations/
  features/templates/
  features/publishing/
  features/compliance/
  features/creative/
  lib/api/
  lib/schema/
  lib/workers/
  styles/
```

服务端也应按领域拆路由和服务，避免继续扩展一个 1800 行控制器。先加 V2 router，再逐条迁移已有 service，不要复制业务逻辑。

## 11. 数据与任务架构

核心数据关系：

```text
tenant
  -> users / memberships
  -> stores
       -> encrypted_credentials
       -> products / skcs / skus
       -> sales_daily / inventory_snapshots
       -> category_rule_cache / attribute_rule_cache
       -> compliance_rules / compliance_drafts
  -> templates (global / owner / store scopes)
  -> product_drafts / publish_batches / publish_jobs / receipts
  -> media_assets / references
  -> webhook_events / sync_jobs / audit_logs
```

页面读取路径：

```text
Browser -> Node API -> PostgreSQL cache
```

数据更新路径：

```text
Webhook / manual refresh / schedule
  -> BullMQ
  -> rate-limited worker
  -> SHEIN API
  -> transactional database upsert
  -> TanStack Query invalidation or SSE notification
```

同一店铺、同一同步类型只允许一个进行中任务。SHEIN 限流按应用全局、接口和店铺三层控制，不能按前端用户分别放大并发。

## 12. 商品经营模块约束

- 单店铺展示；切换店铺切换整个页面数据。
- 默认商品按近 30 日销量降序。
- 上架、待上架、下架等状态必须使用 SHEIN 精确字段，不以有无销量推断。
- 如果无法可靠判断“虚拟售卖/实际售卖”，完全不展示该标记。
- 销售只显示 SHEIN 真实可验证的销售数量；没有准确财务金额字段时不显示推算金额。
- 库存区分业务文档确认的实际库存字段；不要展示误导性的虚拟库存。
- SKU 展开行可显示：今日、昨日、7 日、30 日销量、实际库存、可售天数、建议备货数。
- 建议备货数按用户当前约定表达为缺口正数，不展示负数；告急项用红色强调。
- 可售天数 ≤ 5 天红灯，> 5 天绿灯；已下架、尾货、售完下架不展示红绿灯。
- 经营预警包含真实主图缩略图、SKC、实际库存、上架天数、日/周/30 日销量。
- 上架 7 天内且周销 > 3 的商品，加入实物库存和备货提醒。
- 页面进入不自动同步；显示缓存时间、销量截止日、数据新鲜度和手动刷新。

## 13. 模板中心约束

### 13.1 商品属性模板

- 类目从左到右级联选择末级类目。
- 类目树和 Schema 使用带版本/时间的缓存，不在每次渲染重复读取。
- 选择末级类目后读取真实属性模板和关联规则。
- 必填项排前、选填项折叠在后。
- 选择器要支持搜索、确认、清除和键盘操作；不能使用难用的原生多选框。
- 保存时在顶部给出缺失字段摘要，并滚动/聚焦到第一个错误，字段旁显示红色错误。

### 13.2 颜色与尺寸模板

- 不要求先选商品类目。
- 一套模板只保存一个共享颜色，不在每个 SKU 重复颜色。
- 用户输入自定义颜色后必须匹配 SHEIN 允许的颜色 ID；不能只提交自由文本。
- 每行只保存：尺寸显示名、SHEIN 尺寸映射、长、宽。
- 只保存尺寸信息，不混入价格、克重、库存和包装。
- 矩形面积为长 × 宽；圆形按用户已确认规则直径 × 直径计算。

### 13.3 打包体积模板

- 只接受用户提供的标准 Excel 格式：`哇噻地毯_打包体积标准模板.xlsx`。
- 每个工作表代表一个材质，列结构必须严格验证。
- 上传后只反馈解析材质数、尺寸数和错误摘要，不展示冗长编辑表格。
- 同材质/尺寸重复时以新文件最后一条为准；上传新模板覆盖旧模板，不能因重复阻断整次导入。
- 产品重量即含包装重量，不再设计两个重复重量概念。

### 13.4 尾部主图模板

- 只追加到商品主图最后几张，不能覆盖或插入首图。
- 用户可连续上传、看缩略图、删除、拖拽排序。
- 满足 SHEIN 1340:1750 或 1:1 规则的图片跳过裁剪；不满足时弹出真实裁剪器。
- 裁剪可切换比例，保存后有即时反馈；Pica/Worker 处理，不能卡住页面。
- 保存对象存储引用与裁剪元数据，不把 Base64 写入模板 JSON。

### 13.5 店铺合规模板

- 欧代/代理公司、制造商、欧代实拍图等店铺共用信息可从当前店铺平台数据读取并保存。
- 1630/1631 是每个商品单独材料，不能进入通用模板。
- 普通商品实拍图与欧代实拍图必须分槽位，不能错误复用。

## 14. 单个商品创建与发布闭环

先只实现单个商品，闭环稳定后才做批量。

推荐步骤：

1. 新建空草稿，生成本地 `draftId`。
2. 上传/编排轮播主图；尾图模板只追加到末尾。
3. 引用商品属性模板，由模板锁定末级类目和真实属性 ID。
4. 引用颜色与尺寸模板，生成一行一个尺寸的 SKU 表。
5. 引用打包体积模板，按材质 + 尺寸匹配包装长宽高。
6. 引用当前店铺合规模板，并补每商品独立的 1630/1631 和其他条件资料。
7. 标题位于属性区前部；先允许人工标题，O1Key 标题生成只预留接口，模型和判断逻辑后续单独讨论。
8. SKU 表只放高频编辑字段：尺寸、SHEIN 映射、商家 SKU、供货价、库存、件数、SKU 图。
9. 供应/包装信息独立紧凑表格：商家状态、停采、包装长宽高、产品重量（含包装）。
10. 产品尺码表独立区域，不重复塞进每张 SKU 卡片；高度等统一值提供一键应用，同时保留逐行修改。
11. 每平方米供货价、每平方米克重、统一库存、统一尺码表高度提供批量应用，并保留逐 SKU 覆盖。
12. 保存草稿必须是显式按钮，有 saving/saved/error 状态。
13. 预检前重新读取当前店铺动态字段、属性关联、发布权限、额度、商家 SKU 查重、合规规则。
14. 把字段错误映射回具体步骤、字段和 SKU，不只显示“请求失败”。
15. 预检成功后冻结发布快照和幂等键。
16. 正式发布进入 BullMQ Worker；保存 SHEIN TraceId、请求摘要、响应和回执。
17. 只有显式功能开关、管理员确认和单品验收均通过后，才允许调用真实写接口。

发布接口事实以 `docs/SHEIN_PRODUCT_PUBLISH_CONTRACT.md` 为准，包括图片类型、动态字段、属性维度、SKU 上限和全托管供货字段。

## 15. 批量建品原则

批量不是复制一张超大表单，而是“批量导入 + 单品规则复用 + 异常队列”：

1. 文件夹/表格解析生成多个草稿，不直接提交 SHEIN。
2. 每个草稿引用同一套已验证模板版本。
3. 批量应用价格、克重、库存、包装匹配和尾图规则。
4. 按草稿逐个执行与单品完全相同的预检。
5. 预览放在流程最下方，按“可发布/需补充/规则过期/图片失败”分组。
6. 只把全部必填通过的草稿加入发布批次。
7. 队列按 SHEIN 单次上限拆批、限流、重试；业务字段错误不自动重试。
8. 失败补跑只重试失败项，不重复提交已成功商品。

## 16. 合规模块原则

- 合规页面先读取实时/缓存规则，不能靠静态表单决定 1630/1631。
- 证书、代理公司、责任人、警示语和实拍图必须按官方 Schema/枚举提交。
- 场景、材料、证书或接口尚未验证时，状态显示“平台待处理/能力未开放”，不能伪装完成。
- 地毯图片不能改变尺寸比例、轮廓、图案数量、文字、颜色或夸大厚度；场景图不能叠放第二张地毯。
- 防滑、防水、阻燃、儿童安全、宠物安全、环保、抗菌等声明需要证据或谨慎表达。
- 发布前合规不通过必须阻断，不能仅警告后继续。

## 17. 图片、文件、裁剪与下载链路

### 17.1 上传

```text
选择文件
  -> 浏览器 Object URL 秒级预览
  -> Worker 校验 MIME/尺寸/哈希
  -> API 获取短时预签名 URL
  -> 浏览器直接上传 COS/S3
  -> API HEAD 校验并只保存元数据
```

- 不把 Base64 图片放入 React 状态、草稿 JSON 或 API 请求。
- 不把图片经 Node API 内存中转。
- Uppy 控制合理并发、进度、失败重试和取消。
- `.DS_Store` 等非媒体文件在客户端先过滤。
- AVIF 可以作为创作输入保留；SHEIN 商品图片最终格式必须服从接口要求。

### 17.2 裁剪

- Cropper.js 负责交互，Pica 负责高质量缩放，Comlink 把耗时处理放 Web Worker。
- 原图 Object URL 不触发重复编码；只有用户点击保存裁剪后才生成 Blob。
- 裁剪 Blob 直接预签名上传；主线程只维护尺寸、比例、状态和对象引用。

### 17.3 下载

- 浏览器获取短时下载 URL 后直接下载对象存储，不经过 Node 代理。
- 点击保存必须显示“准备下载/已保存/失败”反馈。
- 生成记录允许清除；清除元数据前按引用关系判断对象是否可删。

### 17.4 生命周期

- 创作工具临时图片默认只保留 3 天。
- 仍被商品草稿、模板、合规资料或进行中任务引用的图片不得清理。
- 正式商品媒体与合规证据不使用 3 天清理规则。

## 18. 生图工具保留边界

- 网页只保留单图编辑，不继续实现桌面软件的文生图和双图批量逻辑。
- O1Key 永远在服务端保存/加密，用户网页只看到配置状态和密钥尾号提示。
- 生成成功后直接预览，用户点击保存；不增加人工选图审批环节。
- 真实生图会计费，任务提交前应明确显示模型和单价。
- 已约定内部计价：Nano Banana 0.1 元/成功张、Nano Banana 2 0.2 元/成功张、Nano Banana Pro 0.3 元/成功张；费用台账以成功结果为准。
- 管理员可按成员、模型查看今日、近 7 日和每月成功次数/费用；普通成员不可见全员费用。

## 19. 性能预算与稳定性目标

V2 每一阶段都要有性能门禁：

- 已缓存业务页可交互目标：约 1.5 秒内。
- 普通缓存 API P95 目标：300 ms 内。
- 初始 JS gzip 目标：约 300 kB 以内；ECharts、裁剪器、复杂建品页懒加载。
- 大商品列表只渲染可视区域，禁止一次创建几千个 DOM 节点。
- 查询按页/游标返回，列表响应不携带整份原始 SHEIN JSON。
- 类目/Schema 请求用 TanStack Query 去重，并由服务端缓存做第二层保护。
- 输入 100–200 ms 内响应；图片处理不得阻塞主线程。
- Worker 队列延迟、失败率、SHEIN 429/5xx、数据库和 Redis 内存需要监控。
- 2 核 4GB 服务器不处理大量图片字节；API、Worker、PostgreSQL、Redis 按 `CLOUD_DEPLOYMENT_ARCHITECTURE.md` 的预算运行。

## 20. 测试与验收

### 20.1 分层测试

- 纯函数/契约：Node tests 或迁移后的 Vitest。
- API 服务：权限、租户隔离、Trusted Origin、输入限制、幂等和错误映射。
- 组件：Storybook 覆盖加载、空、错误、禁用、长文本和小屏。
- 前端契约：MSW 覆盖超时、限流、部分成功、规则过期和权限变化。
- 端到端：Playwright 覆盖登录、普通成员越权阻断、管理员全店可见、店铺切换、模板、草稿、上传、裁剪、预检和任务恢复。
- 性能：Lighthouse CI 和真实列表/图片场景。

### 20.2 每个改动的最低验收

1. 先写成功标准或复现测试。
2. 只实现该成功标准需要的最小改动。
3. 相关单测通过。
4. 全量测试通过。
5. Web 构建通过。
6. `git diff --check` 通过。
7. 浏览器真实验收加载、空状态、错误反馈和交互。

## 21. 重构阶段与完成定义

### 阶段 0：冻结旧站，建立 V2 隔离

- 保留当前可运行版本和数据库。
- 新增 V2 独立入口/构建，不覆盖生产旧站。
- 真实 SHEIN 写操作默认关闭。
- 完成定义：旧站仍可运行；V2 空壳可独立构建；无生产数据变更。

### 阶段 1：产品地图、API 能力矩阵、数据权限模型

- 每个页面列真实数据源、缓存策略、操作权限、空/错/加载状态。
- 每个 SHEIN API 列模式、路径、Header、限额、动态字段、来源文件和验证状态。
- 完成定义：没有来源的字段不进入 UI；管理员/成员/店铺边界有测试用例。

### 阶段 2：前端基础和设计系统

- React + TS + Router + Query + shadcn/Radix + Tailwind。
- 登录壳、导航、店铺切换、反馈、错误边界、Skeleton、空状态。
- 完成定义：Storybook 和 Playwright 验证统一交互；旧 CSS 不进入 V2。

### 阶段 3：登录、成员和店铺授权

- HttpOnly 会话、角色、店铺白名单、自定义店名。
- 完成定义：管理员全店可见；普通成员越权请求前后端都被拒绝。

### 阶段 4：缓存与同步底座

- 页面只读 DB；手动刷新、定时任务、Webhook 增量更新。
- 完成定义：重复刷新不创建重复任务；页面重进不自动同步。

### 阶段 5：商品销售管理

- 商品经营、销售与库存、经营预警三个独立路由/标签。
- 完成定义：真实店铺数据、精确状态、SKU 展开、缓存时间和告警规则全部可追溯。

### 阶段 6：模板中心

- 先属性模板，再尺寸、包装、尾图、合规。
- 完成定义：作用域正确、动态规则复验、保存反馈、删除和错误定位均通过。

### 阶段 7：单个商品草稿与预检

- 独立二级页面、分步骤表单、自动保存/显式保存状态、完整必填预检。
- 完成定义：不用真实写接口即可生成可审计的最终发布快照，所有缺失字段精确定位。

### 阶段 8：单个商品真实发布

- 功能开关、管理员确认、幂等、队列、回执、读取核验、回滚策略。
- 完成定义：测试店铺单品成功；重试不重复建品；失败有 TraceId 和恢复路径。

### 阶段 9：合规闭环

- 单 SKC 规则、通用店铺模板、1630/1631、实拍图、证书和代理公司。
- 完成定义：支持的官方动作可执行；未验证动作明确阻断；发布前合规缺失被阻断。

### 阶段 10：批量建品与发布

- 复用单品契约，增加导入、批量应用、异常分组和失败补跑。
- 完成定义：批量任务不会绕过单品预检，不会重复提交成功项。

### 阶段 11：创作工具迁移

- 单图、服务端 O1Key、直接预览/下载、3 天清理、管理员费用统计。
- 完成定义：上传/下载不经 API 中转，页面不卡顿，费用与成功任务一致。

### 阶段 12：灰度上线

- 同一服务器部署 V2 staging，环境变量、队列和日志隔离。
- 先管理员，再少量成员，最后全员切换；保留旧版回退入口。
- 完成定义：数据隔离、备份恢复、压测、告警和回滚演练通过。

## 22. 生产和安全边界

- 新对话默认只允许本地开发、只读检查、测试和 staging。
- 未经用户明确同意，不部署生产、不修改真实 SHEIN 商品、不提交真实合规资料。
- 正式发布、库存、价格、上下架、合规绑定等写操作必须逐类单独启用。
- 所有 POST/PUT/DELETE：HttpOnly 会话、店铺权限、Trusted Origin、输入大小限制、审计。
- 日志只保存 TraceId、接口、耗时、业务错误码和脱敏摘要。
- 本文件不保存任何密码、APP_SECRET、店铺密钥、COS 密钥、O1Key 或数据库密码。
- 历史对话中曾以明文出现的凭据不得复制到代码、文档或日志；正式生产前应轮换曾暴露的长期凭据。

## 23. 新对话第一轮建议任务

不要先安装依赖。第一轮只完成三个可审查产物：

1. **V2 页面地图**：路由、角色、店铺上下文、数据源、动作和状态。
2. **SHEIN API 能力矩阵**：原始文档路径、接口适用模式、已验证/待验证、读/写、限额和前端消费者。
3. **V2 数据与权限模型**：现有表复用、需迁移字段、索引、模板作用域和行级访问规则。

三份产物确认后，再开始阶段 0/2 的代码骨架。这样可以避免再次出现“页面先画完，才发现 API 字段和业务流程不成立”的问题。

## 24. 可直接发给新对话的开场指令

```text
请完整读取 docs/REBUILD_HANDOFF_2026-08-03.md，并按其中要求使用项目级
karpathy-guidelines skill；涉及 SHEIN 时使用 shein-full-service-rug-operator skill。

先不要改旧页面、不要部署生产、不要调用真实 SHEIN 写接口。先检查当前仓库和
API 原始文档，完成 V2 页面地图、SHEIN API 能力矩阵、V2 数据/权限模型三份
基线产物，并说明哪些旧服务和测试可以复用。所有判断必须能追溯到本地 SHEIN
文档或当前实时 API，不能用假字段和假页面。
```

## 25. 最后提醒

这次重构的核心不是“换一套更漂亮的组件”，而是同时修正四件事：

1. 页面与真实业务流程一致。
2. UI 由统一设计系统和真实路由组成。
3. 数据从缓存、任务和权限模型中稳定流动。
4. SHEIN 动态字段、合规和正式写操作始终可追溯、可阻断、可恢复。

凡是不能明确说明“数据从哪里来、谁能看、何时刷新、失败如何恢复、提交后如何核验”的功能，都不应进入 V2 正式页面。

## 26. 2026-08-04 V2 增量进度

本轮在阶段 4 同步底座上补齐了只读 `compliance_sync`：

- `POST /v1/web/stores/:storeId/compliance/refresh` 只创建持久化任务，viewer 无权触发。
- 独立 BullMQ Worker 按官方上限每批 20 个 SKC 读取两个合规来源，默认关闭且单次尝试。
- 同步目标只来自当前租户、当前店铺的 `skcs` 表；没有真实 SKC 时任务以 `0/0` 安全成功。
- 只有两个来源都完整返回时，才在一个事务内更新 `skcs`、替换
  `skc_compliance_records` 并写入 `compliance_requirement` 快照。
- 批次报错、缺行或来源覆盖不完整时不删除旧数据；失败 SKC 写入任务明细和游标。
- 证书 Schema 不随全店任务批量拉取，只在单 SKC 合规详情读取时按需写入
  `certificate_schema` 快照，避免重复扩张 SHEIN 请求量。
- V2 任务中心已增加“刷新合规”，演示 API 只创建零目标任务，不伪造 SKC 或合规结论。

相关开关为 `SHEIN_COMPLIANCE_SYNC_ENABLED=false` 和
`SHEIN_COMPLIANCE_SYNC_CONCURRENCY=1`。未经真实只读接口验收不得启用，也不得执行任何
合规绑定或提交写操作。

下一步建议进入阶段 9 的只读前半段：建立合规工作台列表和单 SKC 详情页，页面只读
`skcs.compliance_summary`、`skc_compliance_records` 和有效规则快照，并展示来源覆盖、
缓存时间、失败项与 TraceId。先完成读取和阻断状态，再设计证书/代理公司等写动作。

## 27. 2026-08-04 合规工作台只读页面

阶段 9 的只读前半段已经开始：

- 新增 `GET /v1/web/stores/:storeId/compliance-workspace`，按 50 条分页读取当前租户、
  当前店铺 `skcs` 缓存，支持 SKC/供应商编码搜索和合规状态筛选。
- 新增 `GET /v1/web/stores/:storeId/compliance-workspace/:skc`，读取该 SKC 的
  `skc_compliance_records` 及 `compliance_requirement`、`certificate_schema` 最新快照。
- 过期快照仍可审计查看，但响应和 V2 页面都明确标记为过期，不得用于正式提交。
- V2 侧栏新增“合规工作台”，包含可扫描列表与单 SKC 详情；页面进入和“重新读取”
  都只读取数据库，不创建同步任务、不调用 SHEIN。
- 演示 API 返回真实的零缓存状态，不伪造 SKC、要求或合规结论。

下一步应补合规工作台的草稿只读投影与发布前阻断汇总：把现有
`compliance_drafts.preflight` 与缓存规则状态并列展示。仍不要启用证书绑定、代理公司绑定、
警示语提交或实拍图绑定写接口，直到逐类完成官方请求体和回读验收。

## 28. 2026-08-04 合规草稿只读投影

合规工作台现已并列展示缓存规则与协作草稿状态：

- 列表通过同租户、同店铺、同 SKC 的 LEFT JOIN 投影 `compliance_drafts.status`、
  草稿更新时间和已保存 blocker 数，不返回草稿 inputs、证书内容或媒体引用。
- 单 SKC 详情读取现有草稿并兼容对象 blocker、字符串 blocker、warning 和 waiting 项，
  统一输出去重后的 `code + message` 审计摘要。
- 已知发布阻断会合并当前合规未通过、来源覆盖不完整、规则快照缺失/过期、草稿未就绪
  及草稿预检 blocker；这些是保守阻断提示，不会重新推导 SHEIN 动态规则。
- 响应固定返回 `publishingEnabled: false`。草稿中的 `savedExecutable` 只是历史保存值，
  不能作为服务器授权，也不会在 V2 生成提交按钮。

下一步应建立不可由浏览器伪造的服务端合规预检记录：由服务端从最新规则快照和受保护媒体
重新计算、保存输入指纹与规则指纹，并仅用于 dry-run 审计。真实写操作仍须另行增加管理员
确认、功能开关、幂等键、逐动作回读和失败恢复，不能直接复用当前协作草稿字段放行。

## 29. 2026-08-04 服务端合规 dry-run 审计

单 SKC 合规详情现已支持不可由浏览器字段直接放行的服务端预检：

- 新增 `POST /v1/web/stores/:storeId/compliance-workspace/:skc/preflight`；仅
  owner、admin、operator 可触发，并继续要求 HttpOnly 会话、店铺权限和 Trusted Origin。
- 服务端只读取当前租户和店铺的现有 SKC、协作草稿及未过期
  `compliance_requirement` 快照，不信任草稿保存的 `preflight.executable`。
- 草稿内本地媒体必须引用当前店铺媒体库中的 `compliance_evidence`，状态只能为
  `ready/referenced` 且必须有 SHA-256；浏览器 `blob:`、任意字符串和跨店媒体均阻断。
- 新增 `compliance_preflight_runs` 追加式审计表，保存草稿输入指纹、规则组合指纹、
  媒体证据指纹、服务端计划和规则快照外键；仓库没有更新或覆盖记录的路径。
- 单 SKC 详情只返回最新审计的状态、计数、阻断、动作类型和指纹，不返回完整动作载荷、
  草稿 inputs 或媒体清单。V2 将它与浏览器保存的旧预检摘要分开展示。
- 即使 dry-run 状态为 `ready`，响应仍固定 `publishingEnabled: false`；本轮没有新增任何
  SHEIN 写调用、发布按钮、队列执行器或生产配置变更。

下一步应实现单 SKC 合规草稿编辑页和受保护合规证据上传：动态表单继续以当前规则快照为准，
证书、代理公司、警示语与包装/商品实拍分区保存；每次保存后由用户显式运行服务端 dry-run。
真实合规写动作仍需按官方接口逐类验证请求体、幂等、管理员确认、回读和失败恢复后单独启用。

## 30. 2026-08-04 单 SKC 合规草稿与实拍证据

V2 单 SKC 详情已经接入首个可编辑草稿闭环：

- 草稿编辑器只读取数据库中的要求记录和最新 `compliance_requirement` 快照；快照缺失或过期时
  所有上传、移除和保存操作禁用，不会在页面进入时请求 SHEIN。
- owner、admin、operator 可建立和保存草稿；viewer 只能查看。服务端同时阻断 viewer 的 PUT，
  并将草稿输入限制为 certificates、agencies、warnings、photos 四个数组，每组最多 100 项。
- 包装实拍和商品实拍按 `labelId + labelGroup` 分槽，避免同一标签在两个实拍分组间互相覆盖；
  labelId 11 仍保留已验证的欧盟责任人图片复用标记。
- 图片通过短期签名 URL 直接 PUT 到对象存储，API 服务器不转发图片字节；浏览器计算 SHA-256，
  完成校验后草稿只保存 `media:<uuid>`、文件名、类型和大小。
- 保存采用 `expectedUpdatedAt` 乐观并发保护；其他成员先保存后，旧页面再次保存会返回 409，
  不会静默覆盖新草稿。未保存修改存在时，服务端 dry-run 按钮保持禁用。
- 证书、代理公司和动态警示语当前只展示平台要求及状态。没有已验证选项源时不允许手填平台 ID。
  1630/1631 本地 PDF 也不能冒充 SHEIN 证书直传返回的 `fileUrl/fileMd5`。
- 保存成功只更新协作草稿，不自动运行预检、不创建写任务、不调用任何 SHEIN 接口；用户需显式运行
  服务端 dry-run，正式提交继续固定关闭。

下一步应从当前 SKC 的有效 `certificate_schema` 快照建立服务端编辑模型：按 `inputType` 输出可填写字段，
只允许选择快照中仍启用的证书值和代理公司；手动警示语需先补齐并持久化对应动态规则来源。完成这些
只读选项源和草稿校验后，再讨论证书文件直传或绑定等真实写动作。

## 31. 2026-08-04 动态证书 Schema 编辑

V2 合规草稿已经从有效 `certificate_schema` 快照生成受控证书表单：

- 单 SKC 详情新增服务端 `editorModel`，按合规要求关联证书类型，只投影启用的字段和字段值；
  Schema 缺失、过期、停用、`certificateLabel != 0` 或 `certificateTypeId=844` 时保持只读阻断。
- V2 根据官方 `inputType` 渲染单选、多选、文本和日期控件；`sourceFrom=SRM` 使用当前快照中的
  检测机构与实验室两级选择，不允许输入快照外 ID。
- 证书 PDF/JPG/PNG 仍通过 `compliance_evidence` 直传对象存储并保存 `media:<uuid>`；
  1630/1631 页面明确提示这只是安全暂存，不能冒充 SHEIN 文件接口的 `fileUrl/fileMd5`。
- 服务端 dry-run 不再信任草稿携带的 `schema`、`poolSn`、证书状态、远端文件 URL 或 MD5。
  预检会用当前有效快照重建 Schema 和 SRM 白名单，并只保留通过租户/店铺媒体校验的本地文件。
- 动态字段校验会拒绝已停用或不存在的 `presetValueId`，并核对 SRM 检测机构与实验室的真实归属；
  浏览器伪造 Schema、证书池编号或上传回执均不能生成可执行计划。
- 本轮仍未调用证书文件直传、证书保存或 SKC 绑定接口，也未启用正式合规提交。

下一步应为当前 SKC 持久化并安全投影三类只读来源：生效证书池、可绑定代理公司和手动警示语动态规则。
完成快照时效、租户隔离和选项白名单后，V2 才能开放证书池选择、代理公司选择和警示语编辑；真实绑定
仍需另行增加管理员确认、幂等键、功能开关和写后回读。

## 32. 2026-08-04 GCC 与产品标识符只读能力

单 SKC 合规详情现已为 GCC 与产品标识符建立稳定只读能力槽：

- 服务端只从当前 `compliance_requirement` 快照的 `unsupportedRequirements` 识别 GCC 和
  产品标识符，分别投影为 `gcc`、`product_identifier`；其他未知要求不会自动进入这些槽位。
- 两个槽位保留官方读取接口 `/open-api/goods-compliance-requirements/list` 返回的
  `certificateTypeCode`、`certificateTypeId`、`certificateTypeName`、`complianceGroupCode`、
  `isAutoProductWarning`、`isManualProductWarning`、`isRequired` 和 `reviewState`。
- 官方文档明确 HGXXL 中只有手动警告语可通过 API 创建；产品标识符
  `certificateTypeId=844` 还被明确标记为不支持 API 上传。因此槽位固定为
  `writeStatus=unsupported_by_official_api`、`writeEndpoint=null`、`writeFields=null`，V2 显示
  “API 只读”，没有输入框或提交按钮。
- 未解决的必填或被驳回要求仍由现有服务端 dry-run 产生 `API_UNSUPPORTED_REQUIREMENT`，并保持
  `handlingMode=shein_backstage_only`；能力预留不会绕过发布阻断。
- 后续若平台开放写权限，仍需取得官方写 endpoint、HTTP 方法、请求字段、站点与类目范围、绑定对象、
  文件约束及写后回读方式，再补服务端适配器和契约测试。`gcc` 与 `product_identifier` 只是内部能力键，
  不能当成平台字段发出。

本轮没有新增数据库迁移、SHEIN 写路由、功能开关或生产配置变更。

## 33. 2026-08-04 生效证书库只读快照

单 SKC 合规详情已接入店铺证书库的只读来源：

- 复用官方 `POST /open-api/goods-certificates/search`，按当前 SKC 的证书类型编码查询，每批最多
  10 个类型、每页 100 条，并固定传 `statusList:[2]`，只读取已生效证书。
- 新增 `certificate_library` 规则快照类型，继续按租户、店铺和 SKC 隔离并使用 24 小时有效期；
  页面进入合规详情时沿用现有规则读取链路更新，不新增后台全店扫描任务。
- 写入快照前只保留 `poolId`、`poolSn`、证书类型、适用维度、有效期、绑定标记、更新时间和文件名。
  `fileUrl`、`fileMd5`、供应商 ID、动态字段值及其他远端载荷不会持久化或返回浏览器。
- 服务端只从有效快照投影 `status=2` 且类型属于当前 SKC 要求的记录。快照缺失或过期时 V2 显示
  证书库不可用，不回退使用旧记录。
- V2 当前只展示证书名称、证书编号和生效/失效时间，没有选择、绑定或提交控件；草稿结构与服务端
  dry-run 均未接受 `poolSn`，浏览器仍不能伪造证书池绑定。

本轮新增迁移 `025_certificate_library_snapshot.sql`，只扩展 `shein_rule_snapshots.rule_type` 检查约束，
不创建新表、不改历史数据。本地未执行生产迁移，也未调用任何 SHEIN 写接口。

下一步应以同样边界持久化并投影可绑定代理公司：只保存官方列表中状态有效且申请状态允许绑定的记录，
先只读展示，再为草稿选择与服务端白名单校验单独设计契约。手动警示语动态规则排在代理公司之后。

## 34. 2026-08-04 可绑定代理公司只读快照

存在 GSL 代理公司要求的单 SKC 详情现已接入店铺代理公司只读来源：

- 复用官方 `POST /open-api/goods-compliance/agency-list`，每页最多 100 条；只有
  `agencyStatus=0` 且 `applyStatus` 为 1 或 2 的记录进入安全快照。
- 新增 `agency_library` 规则快照类型，按租户、店铺和 SKC 隔离并沿用 24 小时有效期。当前 SKC
  没有代理公司要求时不创建快照，也不在 V2 显示缺失提示。
- 快照只保存 `agencyId`、公司名称、一级/二级类型、代理期限、审核状态、商品覆盖范围和更新时间。
  联系人、电话、邮箱、详细地址、协议 URL、供应商 ID 等字段不会持久化或返回浏览器。
- 服务端再次过滤快照状态；过期快照和审核失败、尚未生效或已失效的公司不会进入编辑模型。
- V2 区分“全店自动覆盖”和“可绑定 SKC”，但当前只有只读列表，没有选择或绑定控件；草稿输入、
  dry-run 白名单和 SHEIN 写执行器均未接入这些 `agencyId`。

本轮新增迁移 `026_agency_library_snapshot.sql`，只扩展规则快照类型检查约束。本地未执行生产迁移，
未调用 `/open-api/goods-compliance/save-skc-agency` 或任何其他 SHEIN 写接口。

下一步应持久化手动警示语动态规则，只保存当前 SKC 要求 code 对应的规则、启用字段和可选值；先完成
只读展示与过期阻断，再决定是否开放草稿编辑。真实警示语更新继续冻结。

## 35. 2026-08-04 手动警示语规则只读快照

存在 `isManualProductWarning=true` 要求的单 SKC 详情现已接入动态警示语规则：

- 复用官方 `POST /open-api/goods-compliance/query-warning-certificate-rules`，接口返回全量规则后只保留
  当前 SKC `warningRequirements` 中的 `certificateTypeCode`。
- 新增 `warning_rules` 规则快照类型，按租户、店铺和 SKC 隔离并沿用 24 小时有效期。当前 SKC
  没有手动警示语要求时不创建或展示快照。
- 写入快照前过滤停用规则、停用字段和停用选项，并按 `fieldSort`、`valueSort` 排序；普通值的
  `exclusionFieldValueIds` 与警示语值的 `mappingPaths.fieldValueIds` 完整保留，供后续服务端白名单校验。
- 工作台只从有效快照投影当前要求 code，V2 只读展示字段名称和启用选项；快照缺失或过期时明确阻断，
  不回退到旧规则。
- 本轮没有把选择值写入草稿，也没有生成 warning update dry-run 动作；
  `/open-api/goods-compliance/update-skc-warning-certificate` 继续冻结。

本轮新增迁移 `027_warning_rules_snapshot.sql`，只扩展规则快照类型检查约束。本地未执行生产迁移，
也未调用任何 SHEIN 写接口。

证书库、代理公司和手动警示语三类只读来源现已齐备。下一步应先开放“已有证书池选择”的本地草稿能力：
服务端必须只接受当前有效 `certificate_library` 快照内的 `poolSn`，并继续保持真实绑定关闭；完成该项后
再以相同方式开放代理公司选择和警示语选择。

## 36. 2026-08-04 已有证书池草稿选择

V2 合规草稿已支持在单条证书要求中选择同类型的平台生效证书：

- 证书库不再作为独立只读列表，而是按证书要求投影为选择器；选中已有证书时隐藏
  新文件上传和 Schema 字段，清空后恢复新资料模式。
- 浏览器只把 `poolSn` 保存到协作草稿。服务端 dry-run 会重新读取未过期
  `certificate_library` 快照，只信任 `status=2`、`poolSn` 精确匹配且证书类型与当前要求一致的记录。
- 草稿中伪造的证书状态、适用维度、Schema、远端文件和其他证书属性均不会进入预检；
  有效选择的类型、维度和状态由服务端快照重建。
- 预检落库的同一条 SQL 会再校验证书库快照仍属于当前租户、店铺和 SKC 且未过期，
  并将该快照纳入规则指纹；校验失败时不会产生审计记录。
- 1630/1631 每 SKC 检测报告不提供证书池候选，现有工作流也会阻断证书池复用。草稿中已失效、
  已删除或类型不符的历史选择会显示阻断提示，不会回退使用旧快照。
- 只有通过服务端白名单的证书才会在 dry-run 中生成 `certificate.bind_existing` 审计动作。
  `publishingEnabled` 继续固定为 `false`，本轮没有调用 SHEIN 证书绑定接口。

本轮没有数据库迁移、生产配置变更或 SHEIN 写请求。下一步应开放“可绑定代理公司”的本地草稿选择：
服务端必须用当前有效 `agency_library` 快照重建 `agencyId`、状态和类型，并继续保持真实代理公司绑定关闭。

## 37. 2026-08-04 可绑定代理公司草稿选择

V2 合规草稿已支持按每条 GSL 责任人要求选择同类型代理公司：

- 服务端编辑模型按官方 `certificateTypeCode` 投影要求类型：欧盟责任人、英国代理、美国代理、
  制造商和土耳其责任人分别对应 `agencyType` 0–4；未验证的要求 code 保持只读，不猜测类型。
- V2 为每条要求独立渲染选择器，只列出当前类型的有效记录；草稿仅保存要求标识和 `agencyId`。
  公司名称、审核状态、类型、覆盖范围和有效期都不作为浏览器授权输入。
- 服务端 dry-run 只信任未过期 `agency_library` 快照中 `agencyStatus=0`、`applyStatus` 为 1 或 2、
  `agencyId` 精确匹配且 `agencyType` 与当前要求一致的记录。
- 即使草稿伪造了可用状态和正确类型，只要快照中的真实公司类型不符，服务端就会丢弃该选择并产生阻断。
- 预检落库的同一条 SQL 会再校验代理公司快照仍属于当前租户、店铺和 SKC 且未过期，
  并将该快照纳入规则指纹。
- 通过白名单的选择只会在 dry-run 生成 `agency.bind` 或 `agency.recheck_store_scope` 审计动作。
  `publishingEnabled` 继续固定为 `false`，本轮没有调用 `/open-api/goods-compliance/save-skc-agency`。

本轮没有数据库迁移、生产配置变更或 SHEIN 写请求。下一步应开放手动警示语的本地草稿选择：
按启用字段渲染值选项，服务端必须用当前有效 `warning_rules` 快照重建白名单、排斥关系和自动映射，
并继续保持真实警示语更新关闭。

## 38. 2026-08-04 手动警示语草稿编辑

V2 合规草稿已支持按当前 SKC 的动态规则填写手动警示语：

- 服务端编辑模型继续只投影当前要求 code 对应的启用规则，同时向浏览器提供启用值之间的
  `exclusionFieldValueIds` 和 `mappingPaths.fieldValueIds`；这些关系只用于受控表单和即时提示。
- V2 按 `fieldType` 渲染单选或多选控件。规则排序后的最后一个启用字段沿用现有官方契约和工作流，
  作为警示语字段；由普通属性触发的映射警示语会自动勾选并锁定。
- 页面会即时提示互斥值和旧草稿中的失效值，并提供“移除失效值”操作。浏览器只保存
  `certificateTypeId/certificateTypeCode` 与 `selectedByField`，不保存可授权的动态规则对象。
- 服务端 dry-run 会从当前未过期 `warning_rules` 快照重建完整 `rules.presetInfo.presetFields`，
  草稿伪造的字段、启用状态、选项、排斥关系和映射路径全部被忽略。
- 快照外值会产生 `WARNING_VALUE_INVALID`，互斥选择会产生 `WARNING_VALUES_CONFLICT`；
  有效普通属性对应的警示语值由服务端再次自动加入，不能依赖浏览器计算结果放行。
- 预检落库的同一条 SQL 会再校验警示语规则快照仍属于当前租户、店铺和 SKC 且未过期，
  并将该快照纳入规则指纹。
- 通过白名单的选择只会在 dry-run 中生成 `warning.update` 审计动作。
  `publishingEnabled` 继续固定为 `false`，本轮没有调用
  `/open-api/goods-compliance/update-skc-warning-certificate`。

本轮没有数据库迁移、生产配置变更或 SHEIN 写请求。证书池、代理公司和手动警示语的本地草稿选择及
服务端可信预检链现已齐备。下一步应建立统一的 dry-run 审阅投影：按要求展示经过服务端重建的安全动作摘要、
自动映射结果、阻断和规则快照时间，让管理员能够核对计划；真实写执行器、确认流程和功能开关仍保持关闭。

## 39. 2026-08-04 统一 dry-run 审阅投影

V2 合规详情现在可审阅服务端已持久化的最新 dry-run 结果：

- `latestPreflight` 仅投影服务端白名单动作摘要。照片、已有证书、创建证书、代理公司与警示语动作各自
  只返回核对所需的类型、要求标识和有限业务字段；完整 `rules`、`schema`、`files`、`localAssetRef`
  及受保护媒体信息不会返回浏览器。
- 警示语摘要显示服务端重新计算后的 `autoMappedWarningValueIds` 数量；浏览器草稿中的映射判断不作为
  放行依据。
- 本次预检实际使用的规则快照类型、指纹、获取时间和到期时间写入 `plan.audit.ruleSnapshots`，并在详情
  中展示。该记录与已有规则指纹一起用于管理员复核，不复制完整规则载荷。
- 页面按服务端判断、审计指纹、动作摘要和规则快照分区展示；每条动作明确标记为“仅审计”，没有确认、
  提交、执行或回写控件。
- 回归测试对每一条公开动作摘要断言不会泄露 `rules`、`schema`、`files` 或 `localAssetRef`。

本轮没有数据库迁移、生产配置变更或 SHEIN 写请求，`publishingEnabled` 仍固定为 `false`。下一步优先建立
追加式的 dry-run 历史与差异对比，便于管理员比较规则或草稿变化；在此之前不讨论真实写执行、确认流程或
功能开关。

## 40. 2026-08-04 dry-run 历史与差异对比

单 SKC 合规详情现已读取现有 `compliance_preflight_runs` 追加式审计表的最近 5 条记录：

- 仓储新增同租户、同店铺、同 SKC 的历史查询，按 `created_at DESC, id DESC` 排序并限制为 5 条。
  没有新表、迁移、更新或删除路径；旧仓储适配仍可回退为单条最新记录。
- 服务端响应新增 `preflightHistory`，每一项都复用 `publicPreflightRun` 安全投影，因此历史不返回
  完整动作、规则载荷、Schema、文件清单、媒体资产或本地媒体引用。
- V2 在有至少两次预检时展示“与前一次 dry-run 对比”，仅比较状态、动作数、阻断数和规则指纹；
  同时展示最近 5 条的时间、状态、阻断数量和规则指纹，便于核对草稿或规则变化。
- 没有新增确认、执行、写入、发布或功能开关；`publishingEnabled` 继续固定为 `false`。

本轮没有数据库迁移、生产配置变更或 SHEIN 写请求。下一步可在现有只读历史上增加显式的不可变审阅
记录，但必须先定义审阅者、审阅时间和审阅内容的最小安全契约，仍不得变成写入授权。

## 41. 2026-08-04 不可变 dry-run 审阅记录

owner 和 admin 现在可以对当前最新的服务端 dry-run 显式记录“已审阅”：

- 新增 `compliance_preflight_reviews` 追加式表。每条记录保存预检 ID、审阅者快照、审阅时间、状态、
  动作/阻断/警告计数和三类指纹；不保存完整动作、规则、Schema、文件、媒体或浏览器备注。
- 审阅请求只有路径中的 `preflightRunId`，不接受浏览器提交的审阅状态、计数或指纹。数据库通过
  `INSERT ... SELECT` 从同租户、同店铺、同 SKC 的预检记录复制安全字段。
- 写入时再次验证审阅者仍是当前租户的 owner/admin、用户状态有效、目标预检仍是该 SKC 最新记录，
  且当前用户尚未审阅该记录；历史预检或重复确认都会失败。
- 新增受 Trusted Origin、HttpOnly 会话和店铺访问权限保护的审阅 POST 路由。operator 和 viewer
  在服务层继续被拒绝，不能依赖仅隐藏前端按钮实现权限控制。
- V2 对管理员显示“确认已审阅”，并列出审阅者、时间和当时的安全摘要。每条记录明确标记
  “仅确认已阅”，`authorizesPublishing` 固定为 `false`。
- 审阅记录没有更新或删除 API，不参与 `releaseGate`，不改变 dry-run 状态，也不触发队列或 SHEIN API。

本轮新增迁移 `028_compliance_preflight_reviews.sql`，但未在本地或生产数据库执行，也没有生产配置变更或
SHEIN 写请求。下一步应先为该迁移设计部署前检查和回滚说明；真实写入开关仍保持关闭。

## 42. 2026-08-04 028 迁移部署门禁

第 028 号迁移现已具备独立的上线检查与回滚说明：

- `028_compliance_preflight_reviews_preflight.sql` 只读取系统目录和 `schema_migrations`，检查依赖表、
  `plan`/三类指纹字段及迁移尚未登记；不包含 DDL 或数据写入。
- `028_compliance_preflight_reviews_verify.sql` 在迁移后检查审阅表、16 个预期列、两个索引和迁移登记，
  并返回当前审阅记录数量；同样保持只读。
- `028_compliance_preflight_reviews.md` 固定部署顺序：先预检，再执行现有 `db:migrate`，验证通过后才启动
  新版本。通用 `deploy/README.md` 已加入该专属 runbook 入口。
- 默认回滚策略是只回滚应用版本并保留新表。只有应用尚未启动且审阅表为空时，才允许人工锁表、再次检查
  空表后删除 Schema；存在任何审阅记录时明确禁止删表或删除迁移登记。
- 回滚说明禁止 `CASCADE`，也不提供自动回滚命令，避免误删不可变审阅证据。

本轮没有连接数据库、执行迁移、切换 release、修改生产配置或调用 SHEIN 写接口。下一步应在一次性、
非生产 PostgreSQL 环境完整演练“预检、迁移、验证、空表回滚、重新迁移”，确认 runbook 可执行后再讨论
任何真实环境部署。

## 43. 2026-08-04 028 非生产迁移演练入口

仓库现已提供 `npm run db:rehearse:028`，用于在一次性本机 PostgreSQL 数据库自动演练第 028 号迁移：

- 数据库主机只允许 `localhost`、`127.0.0.1` 或 `::1`，数据库名必须包含
  `test`、`rehearsal` 或 `scratch`；默认 `shein_console` 和远程主机直接拒绝。
- 运行前还必须显式设置
  `SHEIN_MIGRATION_REHEARSAL_CONFIRM=REHEARSE_028_ON_EMPTY_LOCAL_DATABASE`，并确认目标数据库没有
  任何 public 用户表。
- 演练会先迁移到 027，运行只读预检，再应用 028、运行验证、执行受保护的空表回滚、检查表和迁移登记
  已移除，最后重新应用 028 并再次验证。
- 新增 `028_compliance_preflight_reviews_rollback_empty.sql`；脚本先获取排他锁并再次检查空表，存在记录
  时抛错，不包含 `CASCADE`。
- 安全门禁、检查结果和回滚顺序均有自动测试。

当前开发机没有 `docker` 或 `psql`，也没有提供合格的一次性 PostgreSQL `DATABASE_URL`。因此本轮只完成
演练工具和门禁，直接运行命令会在连接前被拒绝；不能把这视为真实数据库演练通过。没有连接数据库、执行
迁移、修改生产配置或调用 SHEIN 写接口。

## 44. 2026-08-04 合规列表预检与审阅状态

V2 合规工作台列表现在可以直接查看和筛选服务端 dry-run 审计进度：

- 列表查询按每个 SKC 只读取最新一条 `compliance_preflight_runs`，投影预检 ID、状态、阻断数和运行时间；
  不返回计划动作、规则、指纹、媒体或完整 `plan`。
- 另一条同作用域聚合只返回该最新预检的审阅人数和最后审阅时间，不返回审阅者身份或审阅快照明细。
- V2 新增“服务端预检”和“管理员审阅”两列，区分未运行、已阻断、等待规则、dry-run 就绪、
  待管理员审阅和已审阅。
- 新增审阅状态筛选：未运行服务端预检、待管理员审阅、已审阅。服务端只接受
  `not_run`、`pending`、`reviewed` 三个白名单值，非法值在查询数据库前拒绝。
- SQL 继续使用参数化条件，并按租户、店铺和 SKC 隔离；本轮没有批量审阅、批量预检或任何写操作。

本轮没有数据库迁移、生产配置变更或 SHEIN 写请求，`publishingEnabled` 和
`authorizesPublishing` 仍固定为 `false`。

## 45. 2026-08-04 门店级预检审阅概览

V2 合规工作台列表现已展示当前搜索范围内的三类只读审计工作量：

- “未运行预检”“待管理员审阅”“已审阅”三个计数跟随关键词搜索和合规状态筛选，但不受当前审阅状态
  筛选影响；管理员在查看任一分类时仍能看到其他分类的剩余数量。
- 列表 SQL 将同租户、同店铺的 SKC 安全投影先放入 `enriched`，再由 `filtered` 应用审阅状态筛选。
  `audit_summary` 只从 `enriched` 聚合三个数量，不读取或返回动作、规则、指纹、媒体、审阅者身份或完整计划。
- 即使审阅状态筛选后的分页为空，查询仍返回总数和三个概览计数；服务端统一投影为
  `auditSummary.notRun`、`auditSummary.pending` 和 `auditSummary.reviewed`。
- V2 在表格上方使用紧凑的无操作统计带展示数量，没有批量预检、批量审阅、确认、执行或发布控件。
  仅设置审阅状态筛选且结果为空时，页面会正确显示“没有匹配的合规记录”。

本轮测试先行，新增服务契约和 SQL 结构断言；完整 `npm test` 为 406/406 通过，
`npm run build:v2` 通过，JS gzip 约 146.33 kB。没有连接数据库、执行迁移、修改生产配置、
切换 release 或调用 SHEIN 写接口，`publishingEnabled` 和 `authorizesPublishing` 仍固定为 `false`。

## 46. 2026-08-04 草稿变更后的审阅失效门禁

不可变 dry-run 审阅现在会拒绝草稿已在本次预检后发生变化的记录：

- 预检历史查询补充内部 `draft_id`，详情服务只投影 `currentForDraft` 布尔值，不向浏览器返回草稿 ID。
  当前草稿 ID 必须与预检记录一致，且草稿 `updated_at` 不得晚于预检 `created_at`，否则该预检被标记为
  不再对应当前草稿。
- V2 在陈旧 dry-run 上禁用“确认已审阅”，并提示重新运行服务端预检。该前端判断只用于操作反馈，
  不能作为安全边界。
- 审阅记录的 `INSERT ... SELECT` 现在强制联结同租户、同店铺、同 SKC 的当前草稿，并在数据库内再次检查
  `current_draft.updated_at <= run.created_at`。绕过浏览器直接请求也不能为已修改草稿的旧结果追加审阅记录。
- 已有审阅记录仍保持不可变，不更新、不删除；本轮只阻止新的陈旧确认，不改变历史审计证据。

本轮新增陈旧投影和数据库门禁测试；完整 `npm test` 为 407/407 通过，
`npm run build:v2` 通过，JS gzip 约 146.38 kB。没有数据库迁移、数据库连接、生产配置变更、
release 切换或 SHEIN 写请求，`publishingEnabled` 和 `authorizesPublishing` 仍固定为 `false`。

## 47. 2026-08-04 合规列表陈旧预检分类

V2 合规列表现已把草稿变更后的旧 dry-run 从正常审阅工作量中分离：

- 最新预检的列表查询同时读取内部 `draft_id`，并在数据库内比较当前草稿 ID、草稿更新时间和预检时间，
  只向服务层投影 `server_preflight_current_for_draft` 布尔值。
- 审阅状态新增白名单值 `stale`，V2 显示为“需重新预检”。非法值仍会在查询数据库前被拒绝。
- “未运行预检”“需重新预检”“待管理员审阅”“已审阅”四类互不重叠；待审阅和已审阅只统计
  `currentForDraft=true` 的最新 run，旧审阅记录不会让已修改草稿继续显示为已审阅。
- 门店概览新增 `auditSummary.needsRerun`，继续只跟随关键词和合规状态，不受当前审阅状态筛选影响。
  页面使用四栏紧凑统计带，没有增加批量预检、批量审阅或执行控件。
- 列表行的“服务端预检”和“管理员审阅”会同时提示需要重新预检，管理员可进入详情重新生成可信 dry-run。

完整 `npm test` 为 407/407 通过，`npm run build:v2` 通过，JS gzip 约 146.54 kB。
本轮没有数据库迁移、数据库连接、生产配置变更、release 切换或 SHEIN 写请求，
`publishingEnabled` 和 `authorizesPublishing` 仍固定为 `false`。

下一步应把规则快照变化和过期纳入陈旧预检判定：服务端需要校验本次 dry-run 审计记录中的快照仍是
当前同作用域的有效版本，并在数据库审阅门禁中再次验证；在该契约完成前不能仅依赖浏览器时间比较。

## 48. 2026-08-04 规则快照陈旧预检门禁

dry-run 审阅现在会同时验证本次使用的规则快照仍是当前有效版本：

- 规则快照详情查询在服务内部补充 `id` 和 `fingerprint`，浏览器公开的 `snapshots` 仍不返回这两个内部
  比对字段；预检公开投影只新增 `currentForRules` 布尔值。
- 详情服务从 `plan.audit.ruleSnapshots` 读取本次实际使用的快照集合。集合必须非空，且每个规则类型只能出现
  一次；当前同类型快照必须与审计记录的 ID、指纹一致，并且在服务当前时间仍未过期，否则 fail closed。
- 合规列表使用同一安全语义：每个审计快照必须在同租户、同店铺、同 SKC 下找到同 ID、同类型、同指纹、
  未过期且没有更新版本的记录。草稿或规则任一变化都会归入“需重新预检”，不会进入待审阅或已审阅统计。
- 审阅 `INSERT ... SELECT` 在数据库内按实际 `reviewedAt` 再次展开审计快照数组并执行相同作用域、ID、类型、
  指纹、有效期和最新版本检查。浏览器伪造状态或绕过详情页都不能为陈旧规则结果追加审阅记录。
- V2 会区分“草稿已变更”和“规则已变化”，规则失效时禁用审阅按钮并提示重新运行服务端 dry-run。
  已有不可变审阅记录保持原样，不更新、不删除。

本轮没有数据库迁移。完整 `npm test` 为 408/408 通过，`npm run build:v2` 通过，
JS gzip 约 146.63 kB。没有连接数据库、修改生产配置、切换 release 或调用 SHEIN 写接口，
`publishingEnabled` 和 `authorizesPublishing` 仍固定为 `false`。

下一步应校验 dry-run 审计中的受保护媒体仍存在、状态可用且 SHA-256 与预检记录一致；媒体失效也必须
阻止新的审阅，并在列表与详情中归入“需重新预检”，不能依赖草稿时间间接推断。

## 49. 2026-08-04 受保护媒体陈旧预检门禁

dry-run 审阅现在会验证本次使用的合规媒体仍是同一份受保护证据：

- 预检历史查询在服务内部补充已有 `media_assets` 审计数组；公开响应仍不返回媒体 ID、SHA-256、
  对象存储位置、文件名或完整媒体清单，只新增 `currentForMedia` 布尔值。
- 没有媒体动作的 dry-run 允许审计数组为空；非数组、重复媒体 ID、缺少合法 UUID 或缺少 SHA-256
  均 fail closed。
- 详情服务只按审计记录中的合法媒体 ID 回查同租户、同店铺元数据。每个资产必须仍为
  `ready` 或 `referenced`、用途仍为 `compliance_evidence`，且当前 SHA-256 与预检记录一致。
- 合规列表在数据库内执行相同检查。草稿、规则或媒体任一失效都会进入“需重新预检”，不会被计入
  待管理员审阅或已审阅。
- 审阅 `INSERT ... SELECT` 在追加不可变记录前再次展开 `run.media_assets`，校验数组结构、ID 唯一性、
  租户/店铺作用域、可用状态、合规证据用途和 SHA-256。绕过浏览器不能审阅已删除、失效或内容变化的媒体。
- V2 会显示“媒体已失效”，详情禁用审阅按钮并提示重新运行服务端 dry-run。对象存储读取、SHEIN 上传和
  合规绑定仍未启用。

本轮没有数据库迁移。完整 `npm test` 为 409/409 通过，`npm run build:v2` 通过，
JS gzip 约 146.70 kB。没有连接数据库、修改生产配置、切换 release 或调用 SHEIN 写接口，
`publishingEnabled` 和 `authorizesPublishing` 仍固定为 `false`。

## 50. 2026-08-04 合规审计数据库级不可变门禁

第 029 号迁移现已为两张追加式审计表补齐数据库级不可变约束：

- 新增共享触发器函数 `prevent_compliance_audit_mutation()`。它对
  `compliance_preflight_runs` 和 `compliance_preflight_reviews` 的已有记录统一拒绝修改或删除，
  异常信息明确标识 `append-only compliance audit`。
- 每张表都有一个 `BEFORE UPDATE OR DELETE FOR EACH ROW` 触发器。行级删除门禁也会阻止租户、店铺、
  SKC 或其他父记录删除所触发的外键级联，不再只依赖应用层没有删除接口。
- 每张表另有一个 `BEFORE TRUNCATE FOR EACH STATEMENT` 触发器，防止绕过行级门禁整体清空审计记录。
  正常 dry-run 和管理员审阅的追加写入不受影响。
- `029_compliance_audit_immutability_preflight.sql` 只读检查两张依赖表、PL/pgSQL、迁移待执行状态，
  并拒绝函数或四个同名触发器已被人工残留的冲突状态。
- `029_compliance_audit_immutability_verify.sql` 只读验证迁移登记、共享函数和四个已启用触发器，并返回
  当前 dry-run 与审阅记录数量。
- 默认回滚只回滚应用版本并保留第 029 号迁移及不可变门禁。只有两张审计表都为空时，受保护回滚脚本才会
  在排他锁内再次检查空表并移除触发器、函数和迁移登记；任一表存在记录时不得移除门禁，也不允许
  `CASCADE`。
- 通用 `deploy/README.md` 已加入第 029 号专属 runbook 入口。本阶段没有增加自动迁移演练命令，
  避免在没有明确一次性本地数据库目标时扩大执行面。

本轮完整 `npm test` 为 412/412 通过，`npm run build:v2` 通过，JS gzip 约 146.70 kB。
第 029 号迁移只写入仓库，未连接任何数据库、未执行迁移、未修改生产配置、未切换 release，也未调用
任何 SHEIN 写接口。下一步应为第 029 号迁移建立独立的一次性本机 PostgreSQL 演练入口，验证
“预检、迁移、写入审计样本、修改/删除/清空均被拒绝、空库回滚、重新迁移”的完整顺序；演练目标仍必须
通过本地主机、一次性数据库名和显式确认三重门禁。

## 51. 2026-08-04 第 029 号迁移非生产演练入口

仓库现已提供 `npm run db:rehearse:029`，用于在明确的一次性本机 PostgreSQL 空库演练合规审计不可变门禁：

- 数据库 URL 只接受 PostgreSQL 协议和 `localhost`、`127.0.0.1`、`::1`；数据库名必须包含
  `test`、`rehearsal` 或 `scratch`，默认 `shein_console`、远程主机和非空数据库都会在迁移前拒绝。
- 还必须显式设置
  `SHEIN_MIGRATION_REHEARSAL_CONFIRM=REHEARSE_029_ON_EMPTY_LOCAL_DATABASE`。第 028 号确认词、模糊确认
  或缺少确认都不能启动演练。
- 演练先只迁移到 028，运行第 029 号只读预检，再应用 029 并运行只读验证。首次验证要求 dry-run 和审阅
  两张审计表都为空。
- 演练在一个最终整体回滚的事务中追加最小租户、店铺、SKC、规则快照、dry-run 和审阅样本。每次危险操作
  使用独立保存点，确认两表的修改、删除、清空以及父记录外键级联删除都因
  `append-only compliance audit` 被拒绝；其他数据库错误不会被误判为门禁通过。
- 所有拒绝探测完成后，演练再次核对 dry-run 与审阅样本内容未变化，然后回滚整个样本事务，确认两张审计表
  恢复为空。
- 最后执行受保护的空表回滚，核对共享函数、四个触发器和迁移登记均已移除，再重新应用第 029 号迁移并
  复验对象与空表计数。
- 第 029 号 runbook 已加入准确命令、确认词和完整顺序；相应测试同时固定 package 入口与六类受保护
  表操作，避免后续文档或脚本漂移。

本轮完整 `npm test` 为 416/416 通过，`npm run build:v2` 通过，JS gzip 约 146.70 kB，新增演练脚本
也通过 `node --check`。当前没有提供经过确认的一次性本地 PostgreSQL 空库，因此
`npm run db:rehearse:029` 没有执行；本轮没有连接数据库、执行迁移、修改生产配置、切换 release 或调用
任何 SHEIN 写接口。下一步应加强迁移后只读验证，使其不仅检查四个触发器名称和启用状态，还核对每个触发器
绑定到正确表、正确共享函数、正确事件和行/语句级别，防止同名但定义错误的对象被误判为通过。

## 52. 2026-08-04 第 029 号触发器定义精确验证

第 029 号迁移后的只读验证现已从“对象同名且启用”收紧为完整目录定义核对：

- 共享函数必须位于 `public`，零参数并返回 PostgreSQL `trigger` 类型；函数定义中还必须保留
  `append-only compliance audit` 拒绝消息，避免同名空函数被误判为有效门禁。
- 四个预期触发器必须分别绑定到 `compliance_preflight_runs` 或 `compliance_preflight_reviews`，
  并且 `tgfoid` 必须指向同一个 `prevent_compliance_audit_mutation()`。
- 行级门禁要求 PostgreSQL `tgtype=27`，即 `BEFORE`、`FOR EACH ROW`、`UPDATE` 与 `DELETE` 的精确组合。
- 清空门禁要求 `tgtype=34`，即 `BEFORE`、`FOR EACH STATEMENT` 与 `TRUNCATE` 的精确组合。
- 四个触发器仍必须全部启用且不是 PostgreSQL 内部触发器；表名、函数、事件或级别任一漂移都会让
  `triggers:definitions` 返回失败。
- 029 runbook 已同步该验收口径。预检与验证 SQL 继续只读，不包含 DDL、数据修改、权限修改或清空操作。

本轮完整 `npm test` 为 416/416 通过，`npm run build:v2` 通过，JS gzip 约 146.70 kB。
没有连接数据库、执行迁移或演练、修改生产配置、切换 release 或调用 SHEIN 写接口。下一步应把四个不可变
触发器设为 PostgreSQL `ENABLE ALWAYS`，并让验证 SQL 要求 `tgenabled='A'`，避免具有复制角色模式的维护
会话绕过默认触发器；第 029 号迁移尚未执行，因此可以在部署前直接收紧同一迁移及其测试和 runbook。

## 53. 2026-08-04 第 029 号触发器复制角色门禁

第 029 号迁移中的四个不可变触发器现已全部设为 PostgreSQL `ENABLE ALWAYS`：

- 每个行级和语句级触发器创建后，迁移立即执行对应的
  `ALTER TABLE ... ENABLE ALWAYS TRIGGER ...`，不留普通启用状态的窗口。
- 迁移后只读验证不再接受 `tgenabled='O'`，只接受 `tgenabled='A'`。同名触发器即使事件、级别和函数
  都正确，只要不是 always 状态也会使 `triggers:definitions` 失败。
- 这使触发器在普通 origin 会话和复制角色模式下都保持执行，避免维护或导入流程仅通过
  `session_replication_role` 跳过审计门禁。
- 受保护空表回滚仍按原顺序移除触发器和共享函数，不需要先降级启用状态；任一审计表有记录时仍禁止回滚。
- 029 runbook 已把 `ENABLE ALWAYS` 加入迁移后验证和验收清单。应用追加 dry-run 和审阅记录的路径不变。

本轮完整 `npm test` 为 416/416 通过，`npm run build:v2` 通过，JS gzip 约 146.70 kB，029 演练脚本
继续通过语法检查。没有连接数据库、执行迁移或演练、修改生产配置、切换 release 或调用 SHEIN 写接口。
下一步应审计生产部署的 PostgreSQL 角色边界：如果控制服务运行时仍使用数据库超级用户或表所有者，即使
触发器为 `ENABLE ALWAYS`，该角色仍有能力修改门禁对象。应先确认当前 Compose 和环境变量契约，再决定是否
需要独立的 migration owner 与最小权限 runtime role；在角色方案和回滚路径明确前不得改生产凭证。

## 54. 2026-08-05 PostgreSQL 运行时与迁移角色配置拆分

仓库已为数据库最小权限改造建立配置和只读验收边界，但没有创建或修改任何真实角色：

- `loadConfig()` 新增 `migrationDatabaseUrl`。迁移 CLI 优先读取
  `SHEIN_MIGRATION_DATABASE_URL`，直接 Node 环境未提供该值时才兼容回退到已有 `DATABASE_URL`；
  control 与 worker 继续只使用 `databaseUrl`。
- Compose 新增一次性的 `migration` 服务，只有该服务接收 migration owner URL。control、Webhook、
  媒体、图片和同步 worker 全部只接收 `SHEIN_RUNTIME_DATABASE_URL`，长期运行容器不再获得迁移凭证。
- Compose 对两条 URL 都使用必填插值；缺少任一值时配置阶段直接失败，不再悄悄回退到
  `POSTGRES_USER=shein` 初始化超级用户。现有服务器 `.env` 没有被自动修改。
- 通用部署说明、第 028/029 号 runbook 已把迁移命令改为一次性
  `docker compose run --rm --build migration`。
- 新增 `deploy/postgres/audit-runtime-role.sql`。该只读 SQL 检查 runtime role 不是超级用户、创建角色用户、
  创建数据库用户、复制角色或 bypass-RLS 角色；也检查它不拥有或继承数据库、`public` Schema、
  两张审计表及不可变触发器函数的 owner。
- 审计还要求 runtime role 无权在 `public` 创建对象，对两张审计表只有 `SELECT/INSERT`、没有
  `UPDATE/DELETE/TRUNCATE/TRIGGER`，并且不能写 `schema_migrations`。
- 表 OID 通过 `to_regclass` fail closed 解析；第 029 号对象缺失时返回失败结果，不因缺表异常提前中断。
- `deploy/postgres/runtime-role-hardening.md` 明确指出旧 Compose 的 `shein` 共用连接不能通过审计，
  并要求 DBA 人工核对现有 owner 和历史授权。仓库不提供自动角色创建、密码生成或批量授权脚本。

本轮完整 `npm test` 为 420/420 通过，`npm run build:v2` 通过，JS gzip 约 146.70 kB；
Compose YAML 也已由本地解析器确认包含预期的 `migration` 服务。没有连接数据库、运行角色审计、创建角色、
修改生产 `.env`、执行迁移、切换 release 或调用 SHEIN 写接口。下一步应为只读角色审计增加仓库内 Node
执行器和一次性 Compose 服务，让它使用 runtime URL 在容器网络中运行并对任一 `passed != true` fail
closed；在执行器完成前，不应依赖宿主机 `psql` 解析容器专用的 `postgres` 主机名。

## 55. 2026-08-05 运行时数据库角色只读审计执行器

运行时角色审计现在可以通过仓库内的一次性容器可靠执行：

- 新增 `server/cloud/audit-runtime-database-role.js` 和
  `npm run db:audit:runtime-role`。执行器只读取
  `deploy/postgres/audit-runtime-role.sql`，并使用 PostgreSQL simple query protocol 运行一次。
- 结果必须至少包含一个命名检查，且每个 `passed` 都必须严格等于 `true`。缺少检查、`false` 或 `null`
  均会使进程退出失败，避免对象缺失或权限函数返回未知值时误放行。
- 执行器只读取 `config.databaseUrl`，不会读取 `migrationDatabaseUrl`，因此不能因审计命令获得
  migration owner 凭证。
- Compose 新增一次性的 `runtime-database-audit` 服务。它只接收
  `SHEIN_RUNTIME_DATABASE_URL`，不接收 Redis、SHEIN 凭证、对象存储密钥或 migration URL。
- 审计服务通过 Compose 容器网络连接 `postgres`，不再依赖宿主机安装 `psql`，也不要求宿主机解析容器
  服务名。
- 通用部署顺序现为：运行一次性 `migration` 服务、运行一次性 `runtime-database-audit`、全部通过后再
  启动 control 与 worker。角色加固 runbook 已同步准确命令。
- 单元测试覆盖全通过、空结果、显式失败、`null`、simple query mode、SQL 文件加载、package 入口、
  Compose 服务和 migration URL 隔离。

本轮完整 `npm test` 为 423/423 通过，`npm run build:v2` 通过，JS gzip 约 146.70 kB；
Compose YAML 和新增 Node 文件也通过解析/语法检查。没有运行 `db:audit:runtime-role`，因为尚未提供已人工
准备并确认的 runtime role 与数据库 URL；没有连接数据库、创建或修改角色、改动生产 `.env`、执行迁移、
切换 release 或调用 SHEIN 写接口。

下一步应建立 runtime role 的“应用能力清单”而不是自动授权脚本：从现有仓储 SQL 中按表汇总
`SELECT/INSERT/UPDATE/DELETE` 和序列使用需求，生成可审阅的最小权限矩阵，并用静态测试防止新仓储操作未
同步到矩阵。在 DBA 核对真实 Schema、owner 和历史授权前，仍不得生成或执行生产 `GRANT/REVOKE`。

## 56. 2026-08-05 运行时数据库最小权限能力矩阵

仓库现已生成可审阅的 runtime role 应用能力清单，但没有生成或执行任何授权 SQL：

- 新增 `server/cloud/runtime-database-capabilities.js`、
  `deploy/postgres/runtime-role-capabilities.md` 和
  `npm run db:capabilities:write`。生成器只从八个长期运行 cloud 入口递归跟随本地 `.js` import，
  不扫描 migration、rehearsal、audit、provision 或 demo 等管理入口。
- 表白名单只来自版本化迁移中位于真实 DDL 行首的 `CREATE TABLE`。测试固定迁移注释中的
  `CREATE TABLE ... deliberately` 不得被误识别为表。
- 生成器从 JavaScript 字符串和模板字符串中提取 `SELECT`、`INSERT`、`UPDATE`、`DELETE`；
  `INSERT ... ON CONFLICT ... DO UPDATE` 同时记录 `INSERT/UPDATE`。读取扫描会剔除
  `DELETE FROM` 的删除目标，避免把删除权限误记为 `SELECT`；所有写语句的 `RETURNING` 会计入目标表的
  `SELECT` 需求。
- 对发生 `INSERT` 的 `serial` 或 `bigserial` 表同时记录对应序列 `USAGE`。当前矩阵包含 35 张表和
  1 个序列；`api_audit_logs_id_seq` 明确需要 `USAGE`。
- 两张追加式合规审计表 `compliance_preflight_runs` 和 `compliance_preflight_reviews` 均只记录
  `SELECT, INSERT`，没有 `UPDATE`、`DELETE` 或其他修改能力。
- TypeScript 7 的稳定包入口不再提供源码 AST API，因此生成器改用项目已安装并显式声明的
  `@babel/parser` 解析 ESM；没有依赖 Vite 的未声明传递依赖。
- 静态测试要求生成结果与仓库文件逐字一致，禁止矩阵出现 `GRANT`、`REVOKE` 或管理脚本来源。
  `deploy/postgres/runtime-role-hardening.md` 已加入更新命令和 DBA 人工核对边界。

本轮完整 `npm test` 为 427/427 通过，`npm run build:v2` 通过，JS gzip 约 146.70 kB。
没有连接数据库、运行角色审计、创建或修改角色、生成或执行授权 SQL、修改生产 `.env`、执行迁移、
切换 release 或调用 SHEIN 写接口。离线 `npm install --package-lock-only` 因用户目录
`~/.npm` 中历史遗留的 root-owned 缓存文件被本机拒绝；项目现有依赖、测试和构建不受影响，也没有修改
用户级 npm 权限。

下一步应基于同一静态能力模型生成只读的运行时权限覆盖审计：逐项验证目标 runtime role 具备矩阵要求的
表和序列权限，并对矩阵内对象的额外危险权限 fail closed。该审计仍只能查询 PostgreSQL 系统目录和权限
函数，不得创建角色、修改 owner，或包含任何 `GRANT/REVOKE`。

## 57. 2026-08-05 运行时数据库能力覆盖只读审计

同一个一次性 runtime role 审计命令现在同时验证角色边界和应用能力覆盖，但仍不修改数据库：

- `npm run db:capabilities:write` 现在同时生成
  `deploy/postgres/runtime-role-capabilities.md` 和
  `deploy/postgres/audit-runtime-capabilities.sql`，两者共享同一组 35 张表和 1 个序列的静态模型。
- 能力审计只读取 `pg_namespace`、`pg_class` 和 PostgreSQL 权限函数。对象必须位于 `public`，
  表对象类型只接受普通表或分区表，序列只接受真实序列；对象缺失或类型错误直接返回失败。
- 每张表会精确核对 `SELECT/INSERT/UPDATE/DELETE` 是否与矩阵一致，并统一要求没有额外
  `TRUNCATE/REFERENCES/TRIGGER`。每个序列精确核对 `USAGE/SELECT/UPDATE`，当前
  `api_audit_logs_id_seq` 只允许 `USAGE`。
- 基础角色审计新增 `schema:public_usage`，要求 runtime role 可以使用 `public` Schema，同时继续禁止
  `CREATE`。
- Node 执行器依次读取 `audit-runtime-role.sql` 和 `audit-runtime-capabilities.sql`，每份查询都使用
  simple query protocol，并且必须各自至少返回一个命名检查。第二份空结果不能被第一份通过结果掩盖；
  任一 `false` 或 `null` 仍会使进程失败。
- 静态 SQL 提取补齐 `INSERT/UPDATE/DELETE ... RETURNING` 的读取需求。该修正使
  `api_audit_logs` 从仅 `INSERT` 调整为 `SELECT, INSERT`，避免按矩阵配置后因返回 ID 缺少读取权限。
- 生成 SQL 不包含 `GRANT` 或 `REVOKE`，仓库仍不提供角色创建、owner 修改、密码生成或批量授权脚本。

本轮完整 `npm test` 为 430/430 通过，`npm run build:v2` 通过，JS gzip 约 146.70 kB。
尚未连接数据库或执行 `db:audit:runtime-role`；实际角色和真实 Schema 仍需 DBA 在维护窗口人工准备并
核对。下一步应在不执行真实审计的前提下补充“审计失败结果的可操作摘要”：让命令区分角色边界失败和具体
表/序列能力失败，同时保持输出不泄露连接串、ACL 明细、owner 名称或其他数据库元数据。

## 58. 2026-08-05 运行时数据库审计安全失败摘要

只读 runtime role 审计现在能在不暴露数据库元数据的前提下返回可操作失败摘要：

- 执行器会读取并执行角色边界和能力覆盖两份只读 SQL，先分别验证每份结果至少包含一个命名检查，再汇总
  所有 `passed != true` 的项目；第一份失败不会阻止第二份只读查询收集结果。
- 失败项按“角色边界”和“能力覆盖”分组。角色边界保留仓库定义的
  `role:*`、`schema:*`、`table:*` 等检查名；能力覆盖去掉统一前缀后只显示
  `table:<对象名>` 或 `sequence:<对象名>`。
- 输出不会包含数据库 URL、ACL 明细、owner 名称、角色成员、SQL 参数或数据库查询结果行，只使用仓库内
  静态生成的对象名和检查名。
- 任一 SQL 文件返回空结果、缺少 `check_name`、显式 `false` 或 `null` 时仍 fail closed。两份审计都
  通过时，命令返回合并后的检查数量，Compose 入口和 runtime URL 隔离保持不变。

本轮完整 `npm test` 为 431/431 通过，`npm run build:v2` 通过，JS gzip 约 146.70 kB。
没有连接数据库、执行角色审计、创建或修改角色、修改生产 `.env`、执行迁移、切换 release 或调用 SHEIN
写接口。下一步应为 DBA 准备一份不含凭证和授权语句的人工验收记录模板，固定维护窗口、备份点、目标角色、
审计命令结果、失败修正记录和回滚决策；模板不得自动读取或写入生产数据库。

## 59. 2026-08-05 Runtime Role DBA 人工验收记录模板

仓库现已提供空白的维护窗口验收记录，但不会保存填好的生产记录：

- 新增 `deploy/postgres/runtime-role-acceptance-record.md`，固定“变更识别、安全边界确认、备份与回滚
  准备、静态基线、角色准备记录、只读审计记录、失败修正记录、上线决策、签署与保存”九个区块。
- 模板要求先复制到受控变更系统再填写；填好的记录不得提交回代码仓库。仓库只保留不含真实环境信息的
  空白模板。
- 模板明确禁止粘贴数据库 URL、密码、私钥、访问令牌、完整 `.env`、ACL 明细、角色成员清单、数据库
  查询结果行或可执行权限变更语句。
- 静态基线只记录提交 SHA、三份能力与审计文件的 SHA-256，以及现有逐字一致性测试；不会运行
  `db:capabilities:write`，避免在维护窗口重写仓库生成文件。
- 只读审计区固定使用一次性 `runtime-database-audit` Compose 服务，只允许记录通过数量和仓库定义的
  静态失败检查名；角色边界与能力覆盖结果分开记录。
- 模板要求备份点、恢复验证、回滚负责人、停止条件、每轮失败修正工单、GO/NO-GO 决策和四方签署均有
  明确记录。任何复核人选择 NO-GO 时不得启动或切换长期服务。
- `deploy/postgres/runtime-role-hardening.md` 和通用 `deploy/README.md` 已加入模板入口和“填好后不得
  回写仓库”的边界。静态测试固定九个区块、审计命令、敏感格式禁入及两处文档引用。

本轮完整 `npm test` 为 432/432 通过，`npm run build:v2` 通过，JS gzip 约 146.70 kB。
没有连接数据库、执行角色审计、创建或修改角色、读取生产凭证、修改生产 `.env`、执行迁移、切换 release
或调用 SHEIN 写接口。下一步可增加一个只读取仓库文件的验收基线摘要命令，输出提交 SHA 和三份文件摘要
值，方便 DBA 粘贴到受控记录；该命令不得读取 `.env`、连接数据库或收集系统环境信息。

## 60. 2026-08-05 V2 模板中心：商品属性模板

V2 运营工作台现已完成模板中心的第一个用户可用纵向切片，只覆盖商品属性模板：

- 新增 `/app/templates/:storeId/attributes` 路由和“模板中心 / 商品属性”导航；店铺切换现在同时识别
  `operations` 与 `templates` 路由，并在模板页面保留当前功能位置。
- V2 API 客户端沿用现有
  `publish/categories`、`publish/schema`、`publish/associated-rules` 和
  `publish-templates` 契约，没有新增或猜测 SHEIN 接口。
- 新增可单测的属性模板契约适配层，只提取真实末级类目和 `typeCode=3/4` 的商品属性；隐藏、停用、
  销售属性和规格属性不会进入当前编辑器。
- 页面支持按 SHEIN 类目树逐级选择、当前类目路径确认、SHEIN schema 自动读取、必填优先、选填折叠、
  单选、多选、选择加自定义输入和最大选择数限制。
- 保存前先在浏览器汇总缺失必填项，再调用现有关联属性只读接口；最终仍由服务端用当前 schema
  snapshot 校验属性 ID、值 ID、字段模式、必填项和选择数量。
- 模板列表展示作用域、类目 ID、版本和更新时间；只有 `canManage=true` 的模板显示编辑和删除操作。
  管理员模板继续是租户通用，成员模板继续是本人跨授权店铺通用。
- demo API 的模板响应补齐生产契约已有的 `scope`、`scopeLabel`、`ownerUserId` 和 `canManage`，
  仅用于本地验收，不影响生产服务。
- 页面明确标示“只保存可复用属性值，不创建商品，也不执行 SHEIN 发布”；没有新增发布按钮、
  SHEIN 写调用或发布开关。

测试先固定了 V2 API 路径、末级类目归一化、商品属性筛选、必填汇总、路由、导航和店铺路由识别。
本轮完整 `npm test` 为 439/439 通过，`npm run build:v2` 通过，JS gzip 约 151.95 kB。

本地 demo 浏览器验收已完成：

- 1440px 桌面视口没有页面横向溢出，两栏编辑/列表布局保持在视口内。
- 创建模板成功，编辑保存后版本从 v1 递增到 v2，删除后属性模板列表恢复为 0。
- 390×844 手机视口实际 `clientWidth=375`，页面和正文均无横向溢出；侧栏默认移出屏幕并可正常打开、
  关闭，浏览器控制台没有 error 或 warning。

本轮没有连接数据库、执行迁移、修改角色或生产 `.env`、切换 release、调用 SHEIN 写接口或启用发布。
下一步应在同一模板中心增加“颜色与尺寸模板”页面，继续复用已有 `size` 模板服务契约，只保存共用颜色、
自定义尺寸文本、长和宽，不把类目、价格、库存、克重或包装数据混入尺寸模板。

## 61. 2026-08-05 V2 商品属性模板：动态多级类目选择器

商品属性模板的类目选择已按 SHEIN 后台的级联导航方式修正，不再把所有末级类目压平成搜索结果：

- 类目接口响应先归一化为保留 `children`、`last_category` 和 `product_type_id` 的递归树；原有末级类目
  扁平函数继续复用同一棵树，没有新增或猜测 SHEIN 接口。
- 选择器列数完全由当前类目路径动态生成，不写死三级。三级路径显示三列，四级路径显示四列；更深路径也
  使用同一逻辑继续增加列。
- 点击非末级节点只展开下一列；只有 `last_category=true` 且存在 `product_type_id` 的节点才会成为
  模板类目并触发现有 schema 读取。
- 选中末级类目后显示完整路径、`categoryId` 和 `productTypeId`；“更换类目”会按原路径重新展开。
  切换末级类目仍会清空当前属性填写，模板保存和关联属性检查契约保持不变。
- 类目选择器打开时编辑区临时使用完整内容宽度，桌面端四列可以同时查看；选中后恢复编辑区与模板列表的
  两栏布局。移动端在列数超出可用宽度时保留横向滚动。
- demo API 同时提供三级“家用纺织品 / 地毯和地垫”路径和四级
  “家居&生活 / 家居装饰 / 地毯、地垫和保护用品”路径用于本地验收。名称参考用户提供的后台截图，
  demo ID 及共用 `product_type_id` 仅用于隔离验收，不替代正式 SHEIN 类目接口返回值。

测试先固定了递归类目树、动态列生成、禁止固定二级/末级变量、三级 demo 路径和四级 demo 路径。
本轮完整 `npm test` 为 443/443 通过，`npm run build:v2` 通过，JS gzip 约 152.32 kB。

本地浏览器验收已确认：

- 三级路径会显示三列，四级路径会自动出现第四列。
- 四级末级“长条地毯”选中后完整路径正确，现有“主要材质” schema 正常加载。
- 1280px 浏览器视口下 `documentWidth` 与正文宽度均未超过视口，没有页面级横向溢出。

本轮没有连接数据库、执行迁移、修改生产 `.env`、切换 release、调用 SHEIN 写接口或启用发布。

## 62. 2026-08-05 V2 商品属性模板：完整属性展开

商品属性模板在选择末级类目后只显示一个“主要材质”的问题已修正：

- 根因不是正式属性适配丢字段，而是隔离 demo schema 只有一个可填写的 `attribute_type=3/4` 商品属性；
  颜色、尺寸、长和宽分别属于销售属性或尺码属性，因此按现有模板边界不会出现在商品属性模板中。
- demo schema 现在提供 7 个可填写商品属性，覆盖必填单选、选填单选、选填多选、选择加手工输入和纯手工
  输入；当前示例为 2 个必填、5 个选填。
- 页面不再把选填属性放入默认折叠的 `details`。选择末级类目并完成 schema 读取后，必填和选填商品属性
  会全部直接展开。
- V2 属性适配测试固定：所有 `attribute_status != 1`、`attribute_is_show != 0` 且
  `attribute_type=3/4` 的可填写商品属性必须按 SHEIN 返回顺序保留；停用字段仍不会进入模板。
- 正式环境继续实时使用 `/open-api/goods/query-attribute-template` 返回值。demo 属性名称、ID 和选项只用于
  隔离浏览器验收，不替代正式 SHEIN 店铺和类目的实时字段。
- 模板保存、schema snapshot、关联属性检查和服务端字段/值 ID 校验均保持不变；没有扩大到颜色与尺寸
  模板，也没有新增 SHEIN 写调用。

本轮完整 `npm test` 为 446/446 通过，`npm run build:v2` 通过，JS gzip 约 152.31 kB。

本地浏览器验收已确认：

- 选择“家用纺织品 / 地毯和地垫 / 门垫”后直接显示 2 个必填和 5 个选填商品属性。
- 单选、多选、选择加自定义值和纯手工输入控件均按 schema 正常生成。
- 1280px 视口下页面没有横向溢出，最终刷新后没有新增 browser error 或 warning。

本轮没有连接数据库、执行迁移、修改生产 `.env`、切换 release、调用 SHEIN 写接口或启用发布。

## 63. 2026-08-05 V2 商品属性模板：按官方维度补全 schema

上一节只补全了 `attribute_type=3/4` 商品级属性，不能代表
`/open-api/goods/query-attribute-template` 的完整返回结构。本轮已按 SHEIN 官方字段修正：

- 属性契约新增统一分类，完整保留五个官方维度：
  - 主销售属性：`attribute_type=1` 且 `attribute_label=1`；
  - 次销售属性：`attribute_type=1` 且 `attribute_label!=1`；
  - 尺码属性：`attribute_type=2`；
  - 商品级属性：`attribute_type=3/4` 且 `data_dimension=1`；
  - SKU 级商品属性：`attribute_type=3/4` 且 `data_dimension=3`。
- 页面选择末级类目后会显示全部五个分组、字段数量、必填状态、录入方式、字段 ID 和 SHEIN 属性值摘要；
  即使某个分组为空，也会明确显示 SHEIN 当前类目未返回该类属性。
- 页面读取并展示 `main_attribute_status`：
  - `1`：主销售属性必须使用“默认”属性值；
  - `2`：可使用“默认”或其他属性值；
  - `3`：不能使用“默认”属性值。
- 当前“商品属性模板”仍只编辑和保存 `data_dimension=1` 的商品级属性，对应
  `product_attribute_list`。销售属性、尺码属性和 SKU 级商品属性只展示真实 schema 归属，分别留给
  SKC/SKU 与尺寸模板，未扩大现有持久化契约。
- `buildAttributeFields` 继续作为现有商品级保存入口，内部复用新的完整分类结果；服务端模板校验、关联属性
  检查、发布门禁和 SHEIN 写调用均未改变。
- 隔离 demo schema 现覆盖五个官方维度，并提供 `main_attribute_status=3` 用于页面验收。demo 字段 ID、
  名称和属性值仍不代表正式店铺数据。

本轮完整 `npm test` 为 449/449 通过，`npm run build:v2` 通过，JS gzip 约 153.31 kB。

本地浏览器验收已确认：

- 选择“家用纺织品 / 地毯和地垫 / 门垫”后显示 2 个必填、5 个选填商品级属性；
- 同页继续显示 1 个主销售属性、1 个次销售属性、2 个尺码属性和 1 个 SKU 级商品属性；
- 主销售属性显示“必填：不能使用默认属性值”，与 demo 的 `main_attribute_status=3` 一致；
- 1280px 视口下 `documentWidth=1280`，没有页面级横向溢出；
- 最终控制台没有 error 或 warning。

本轮没有连接数据库、执行迁移、修改生产 `.env`、切换 release、调用 SHEIN 写接口或启用发布。

## 64. 2026-08-05 V2 商品属性模板：撤回跨属性维度展示

第 63 节把 `/goods/query-attribute-template` 返回的全部属性维度展示在“商品属性模板”页面，混淆了接口
响应范围和页面职责，现已撤回。当前实现重新严格遵循 SHEIN API 字段归属：

- 商品属性模板只展示并保存 `attribute_type=3/4` 且 `data_dimension=1` 的商品级属性，对应
  `product_attribute_list`。
- `attribute_type=1` 销售属性不进入商品属性页面；颜色、销售尺寸应由后续 SKC/SKU 销售属性流程处理。
- `attribute_type=2` 尺码属性不进入商品属性页面，应由尺寸模板和 `size_attribute_list` 流程处理。
- `attribute_type=3/4` 且 `data_dimension=3` 的 SKU 级商品属性不进入当前页面，应由具体 SKU 的
  `sku_scope_attribute_list` 流程处理。
- 删除上一轮新增的 `buildAttributeSchema`、五分组 UI、`main_attribute_status` 页面展示和虚构的
  “SKU 成分说明”demo 字段；恢复单一、直接的 `buildAttributeFields` 过滤器。
- 测试现在反向固定：商品属性页面不得出现主销售属性、次销售属性、尺码属性或 SKU 级商品属性；契约测试
  同时输入颜色、销售尺寸、尺码、商品级和 SKU 级字段，结果只能保留商品级字段。

后续开发强制遵循以下项目纪律：

1. 写代码、评审和重构前必须读取并遵循 `karpathy-guidelines`，先声明边界和验收条件，再做最小修改。
2. SHEIN 字段、枚举、接口路径、请求体、响应体和提交归属只以仓库内 SHEIN API 原始文档和已确认契约为准；
   不用 UI 猜测接口，不发明字段，不把不同提交维度合并到同一页面或模板。
3. 每个任务调用与当前问题直接相关的 skill；SHEIN 类目运营与字段语义使用
   `shein-full-service-rug-operator`，代码约束使用 `karpathy-guidelines`，页面变更使用浏览器实际验收。
   无关 skill 不调用，避免引入与任务无关的流程和复杂度。

本轮完整 `npm test` 为 447/447 通过，`npm run build:v2` 通过，JS gzip 约 152.33 kB。

本地浏览器验收已确认：

- 选择“家用纺织品 / 地毯和地垫 / 门垫”后只显示 2 个必填和 5 个选填商品级属性；
- 页面不再出现颜色、销售尺寸、宽度、长度、主/次销售分组或 SKU 级商品属性；
- 1280px 视口下 `documentWidth=1280`，没有页面级横向溢出；
- 最终控制台没有 error 或 warning。

本轮没有连接数据库、执行迁移、修改生产 `.env`、切换 release、调用 SHEIN 写接口或启用发布。

## 65. 2026-08-05 V2 商品属性模板：接入官方装饰地毯快照

第 64 节把商品属性限定为 `data_dimension=1`，会错误丢弃 SHEIN 官方响应中
`data_dimension=2` 的商品属性。本轮按仓库内原始 API 文档、商品发布契约和已缓存的官方只读响应修正：

- 工作区 `.data/shein-schema-cache.v1.json` 已保存 2026-07-29 的官方只读快照。真实类目映射为
  “装饰地毯” `category_id=3155`、`product_type_id=991`；此前 demo 中
  “门垫=3155、所有地毯类目共用 991”的映射是隔离假数据，现已停止使用。
- demo 类目接口现在直接读取官方缓存类目树；schema 接口读取请求体中的 `categoryId` 和
  `productTypeId`，校验二者与官方末级类目映射一致后，只返回同一店铺缓存中的属性模板和发布字段规范。
  缓存不存在、类目不匹配或该产品类型未同步时会失败关闭，不再退回虚构属性。
- 正式 `SheinWebReadService` 保持不变，仍使用
  `POST /open-api/goods/query-attribute-template` 和
  `{ "product_type_id_list": [productTypeId] }` 动态读取当前店铺属性。
- 商品属性页面继续排除 `attribute_type=1` 的销售属性、`attribute_type=2` 的尺码属性，以及
  `data_dimension=3` 的 SKU 维度商品属性；`attribute_type=3/4` 的其他维度均按
  `product_attribute_list` 商品属性保留。当前官方响应实际包含维度 1 和维度 2。
- 装饰地毯官方快照共返回 49 个属性；当前页面过滤后显示 43 个可编辑商品属性，其中 24 个必填、
  19 个选填。用户截图中的 23 个字段全部存在；官方缓存另外把“数量”标记为必填，因此页面按 API
  快照显示 24 项，不根据截图删除该字段。
- `attribute_remark_list` 不再直接显示 `1/2/3/4`，现按官方文档映射为“重要、合规、质量、关务”。
- 新增测试固定官方类目映射、类目与产品类型不匹配时失败、维度 2 商品属性必须保留，以及销售、尺码和
  SKU 维度属性不得混入当前页面。

本轮完整 `npm test` 为 446/446 通过，`npm run build:v2` 通过，JS gzip 约 152.39 kB。

本地浏览器验收已确认：

- 按“家用纺织品 / 地毯和地垫 / 装饰地毯”选择后显示
  `Category 3155 · Product Type 991`；
- 页面显示 24 个必填和 19 个选填商品属性；
- 用户截图中的字段全部出现，颜色、销售尺寸、宽度、长度和 SKU 商品属性均未出现；
- 类目和字段选项均来自 2026-07-29 的官方只读缓存，没有新增或猜测官方 ID、枚举和值。

本轮没有访问生产环境、刷新线上 SHEIN 数据、修改数据库、执行迁移、修改生产 `.env`、切换 release、
调用 SHEIN 写接口或启用发布。

## 66. 2026-08-05 V2 商品属性模板：统一保存与长页面反馈

商品属性模板的保存体验已按长下拉表单场景补全，未改变 SHEIN schema、关联规则或模板持久化契约：

- 必填/选填状态继续由当前末级类目的 SHEIN schema 动态决定，页面以
  `attribute_status=3` 识别必填；切换类目后字段、必填数量和填写进度会随新 schema 重新计算。
- 每个属性不增加单独保存按钮，继续采用一次性统一保存全部属性。保存前先完成页面必填校验，再调用现有
  SHEIN 关联属性规则检查，最后原子保存完整模板，避免出现部分字段已保存、部分字段未保存。
- 新增固定在工作区底部的统一保存栏，桌面端避开 `236px` 侧栏，移动端占满可用宽度；页面底部增加
  `pb-24` 预留，防止固定栏遮住最后几个属性。
- 固定栏实时显示 `必填 X/Y` 和 `还差 N 项`。保存时若存在漏填项，现有逻辑会继续把所有漏填字段标红、
  显示行内错误，并滚动到第一项；固定栏同时在当前视口显示完整失败原因。
- 保存按钮点击后立即进入“正在保存”状态，固定栏通过 `aria-live` 显示
  “正在校验 SHEIN 规则并保存”；成功或失败后，结果仍在同一位置显示，用户无需回到页面顶部寻找反馈。
- 用户修改模板名称或任一属性后会清除旧的成功/失败消息，避免内容已变化但界面仍显示上一次保存结果。
- 未增加关联规则预加载、后台保存或其他复杂缓存。浏览器实测完整 24 项必填模板从点击到成功反馈约
  `518ms`，当前本地链路已低于 1 秒，没有证据支持进一步扩大实现复杂度。

新增 UI 契约测试固定以下行为：

- 页面只有一个“统一保存全部属性”动作；
- 保存栏必须真正固定在工作区底部并为页面内容预留空间；
- 保存栏显示动态必填完成数量和剩余数量；
- 保存中、成功和失败反馈必须在保存动作旁通过 `aria-live` 可感知。

本轮完整 `npm test` 为 449/449 通过，`npm run build:v2` 通过，JS gzip 约 152.69 kB。

本地浏览器验收已确认：

- 装饰地毯仍显示 24 个必填和 19 个选填商品属性；
- 页面滚到约 5430px 长度的中段时，固定保存栏仍完整显示在 720px 高视口底部；
- 未填写时点击统一保存，24 个必填项全部红色高亮，页面滚动到第一项，固定栏同步显示漏填字段；
- 填完后固定栏显示 `必填 24/24 · 已完成`；
- 完整保存成功反馈约 518ms 出现，按钮切换为“更新全部属性”；
- 验收创建的临时 demo 模板已删除。

本轮没有访问生产环境、刷新线上 SHEIN 数据、修改数据库、执行迁移、修改生产 `.env`、切换 release、
调用 SHEIN 写接口或启用发布。

## 67. 2026-08-05 V2 模板中心：颜色与尺寸模板

V2 模板中心已完成第二个用户可用纵向切片，新增颜色与尺寸模板：

- 新增 `/app/templates/:storeId/sizes` 路由和“模板中心 / 颜色与尺寸”导航；店铺切换继续沿用现有
  `templates` 路由识别。
- V2 API 客户端沿用统一的
  `/v1/web/stores/:storeId/publish-templates?type=size` 和模板新增、更新、删除路径，没有新增 SHEIN
  接口或后端路由。
- 页面不要求选择类目。一套模板只保存一个共享颜色；每行只保存尺寸显示名、长和宽，支持添加、删除、
  编辑多个尺寸行。
- 新增 `size-template-contract`，浏览器保存前统一清洗名称和文本、把长宽转换为大于 0 的数字，并一次返回
  所有字段错误。契约测试确认价格、库存、克重等额外输入不会进入规范化结果。
- 生产 `WebPublishTemplateService` 继续作为最终可信边界，只持久化：
  - `colorText`
  - `matchingPolicy=match_current_shein_schema_on_publish`
  - `rows[].sizeText`
  - `rows[].lengthCm`
  - `rows[].widthCm`
- SHEIN 官方文档要求销售属性提交使用真实 `attribute_id` 和 `attribute_value_id`，但这些 ID 属于具体末级
  类目的当前 schema，而颜色与尺寸模板按既定产品约束不绑定类目。因此本页不保存或猜测伪通用 ID；
  模板引用到具体商品后，必须按当前末级类目 schema 匹配真实销售属性值，找不到完全匹配值时在预检阻断。
- 保存采用一个固定在工作区底部的统一动作栏，实时显示完整尺寸行数量、保存中、成功或失败反馈。
- 漏填时模板名称、共享颜色以及每行尺寸名、长、宽全部红色高亮；页面定位到第一处错误。
- 模板列表展示共享颜色、尺寸数量、作用域、版本和更新时间；继续按 `canManage` 控制编辑和删除。
- 页面没有类目、价格、库存、克重、供货、包装或发布按钮，没有扩大尺寸模板的数据职责。

新增测试覆盖：

- 颜色与尺寸路由、导航和 V2 API 方法；
- 草稿清洗只保留共享颜色、尺寸名、长和宽；
- 空名称、空颜色、空尺寸、零值和非数字长宽的完整错误集合；
- 页面必须有可增删尺寸行、统一固定保存栏、`aria-live` 反馈和错误定位；
- 页面源码不得混入类目、价格、库存、重量或包装字段。

本轮完整 `npm test` 为 457/457 通过，`npm run build:v2` 通过，JS gzip 约 155.56 kB。

本地 demo 浏览器验收已确认：

- 1280px 视口下页面无横向溢出，编辑区和模板列表保持两栏；
- 空表单保存时 5 个输入全部红色高亮，固定栏立即显示失败原因；
- 添加两行后显示 `尺寸行 2/2 · 可保存`；
- 创建模板成功反馈约 412ms 出现；
- 修改共享颜色、删除一行并更新后，模板版本从 v1 递增到 v2，反馈约 487ms 出现；
- 固定保存栏始终完整显示；
- 验收创建的临时 demo 模板已删除。

当前浏览器控制面无法切换到 390px 视口，因此本轮没有伪称完成手机实机验收。页面已使用移动端单列字段、
桌面端固定四列表格和底部响应式操作栏，TypeScript 构建通过；手机视口仍应在后续可切换视口时补一次实际验收。

本轮没有访问生产环境、刷新线上 SHEIN 数据、修改数据库、执行迁移、修改生产 `.env`、切换 release、
调用 SHEIN 写接口或启用发布。下一步按阶段 6 顺序进入“打包体积模板”，严格使用用户提供的标准 Excel
格式和现有 `packaging` 模板服务契约。

## 68. 2026-08-05 V2 模板中心：打包体积模板

V2 模板中心已完成第三个用户可用纵向切片，新增打包体积模板：

- 新增 `/app/templates/:storeId/packaging` 路由和“模板中心 / 打包体积”导航；店铺切换继续沿用现有
  `templates` 路由识别。
- V2 API 客户端沿用统一的
  `/v1/web/stores/:storeId/publish-templates?type=packaging` 和模板新增、更新、删除路径，没有新增
  SHEIN 接口、后端路由、数据库字段或迁移。
- 页面只接受 `.xlsx`。浏览器在用户选择文件后才动态加载 `read-excel-file/browser`，一次读取全部工作表；
  没有把 Excel 解析器打入工作台首屏主包。
- 每个工作表名称严格作为一个材质；列继续复用现有 `src/lib/package-template.js` 的唯一解析规则，必须完整且
  仅包含：
  - `宽`
  - `长`
  - `打包长`
  - `打包宽`
  - `打包高`
- 缺列、多列、重复列、空值、零值、负数和非数字继续失败关闭；同一材质内宽长方向互换视为同一尺寸，
  重复尺寸由工作簿最后一行覆盖。
- 新增 `packaging-template-contract`，只负责路径、复用规范化解析器和保存前草稿清洗。保存数据只保留
  文件名、导入时间、材质、五个包装尺寸字段和重复覆盖数；重量、备注等额外字段不会进入请求。
- 页面不展示或编辑大型电子表格，只显示文件名、材质数、唯一尺寸数、有效记录数、重复覆盖数和最多 5 条
  简短错误。重新上传新文件会整体替换当前编辑器中的旧工作簿。
- 保存继续采用一个固定在工作区底部的统一动作栏；空名称、未上传、无有效材质或工作簿存在错误时阻断，
  定位到第一处错误，并在保存按钮旁显示解析、保存、成功或失败反馈。
- 模板列表显示材质数、尺寸数、作用域、版本和更新时间；继续按 `canManage` 控制编辑和删除。
- 没有引入产品重量或包装重量。现有产品重量已包含包装这一业务定义保持不变。

新增测试覆盖：

- 打包体积路由、导航和 V2 API 方法；
- 店铺和模板 ID 的 URL 编码；
- V2 contract 必须复用现有严格工作簿解析器；
- 保存前只保留五个标准包装尺寸字段，额外重量和备注字段必须被剔除；
- 页面必须只接受 `.xlsx`、显示汇总和简短错误、不得出现可编辑表格；
- 页面必须有固定统一保存栏、`aria-live` 反馈和错误定位；
- 页面源码不得引入产品重量或包装重量字段。

本轮完整 `npm test` 为 466/466 通过，`npm run build:v2` 通过。Excel 解析器已拆为按需异步 chunk：
主应用 JS gzip 约 159.83 kB，Excel 解析 chunk gzip 约 19.09 kB。

本地 demo 浏览器验收使用 `@oai/artifact-tool` 创建的临时标准工作簿，确认：

- 初始工作簿包含 2 个材质工作表，同一材质内有一组 `40×60` / `60×40` 重复尺寸；页面准确显示
  `2 种材质、3 个唯一尺寸、4 条有效记录、1 条重复覆盖`。
- 空表单点击保存时，模板名称和工作簿区域均显示红色错误，固定栏同步显示失败原因。
- 创建模板成功反馈约 290ms 出现。
- 编辑状态重新上传只有 1 个材质、1 个尺寸的新工作簿后，摘要立即完整替换为
  `1 种材质、1 个尺寸、1 条有效记录、0 条重复覆盖`。
- 更新模板成功反馈约 278ms 出现，模板版本从 v1 递增到 v2，列表同步显示新摘要。
- 1280×720 桌面视口 `documentWidth=1280`，无页面级横向溢出；固定保存栏底部为 720。
- 390×844 移动视口 `documentWidth=390`，无页面级横向溢出；固定保存栏底部为 844。
- 最终控制台没有 error 或 warning，验收创建的临时 demo 模板已删除。

本轮没有访问生产环境、刷新线上 SHEIN 数据、修改数据库、执行迁移、修改生产 `.env`、切换 release、
调用 SHEIN 写接口或启用发布。下一步按阶段 6 顺序进入“尾部主图模板”。

## 69. 2026-08-05 V2 模板中心：尾部主图模板

V2 模板中心已完成第四个用户可用纵向切片，新增尾部主图模板：

- 新增 `/app/templates/:storeId/tail-images` 路由和“模板中心 / 尾部主图”导航；店铺切换继续沿用现有
  `templates` 路由识别。
- V2 API 客户端沿用统一的
  `/v1/web/stores/:storeId/publish-templates?type=tail_image` 和模板新增、更新、删除路径，没有新增
  SHEIN 写接口、数据库字段或迁移。
- 模板只能追加到商品自身主图最后，固定保存 `placement=append`；不能覆盖首图，也不能插入商品已有图片
  中间。
- 页面支持一次选择多张 JPG、JPEG 或 PNG。符合以下任一现有 SHEIN 主图规则时直接上传：
  - 固定纵图 `1340×1785`；
  - 边长为 900–2200px 的 `1:1` 方图；
  - 文件不超过 3MB。
- 不符合尺寸或比例的图片进入 `react-easy-crop`，用户可选择固定 `1340×1785` 或输出
  `1200×1200`。裁剪继续复用仓库已有并经过测试的 `createImageBitmap`、`OffscreenCanvas`/Canvas
  异步实现；没有为单一页面新增 Pica、Worker 或其他依赖。
- 图片仍通过现有对象存储预签名 PUT 上传。模板 JSON 只保存有序 `media_asset` ID、必要媒体摘要和有限裁剪
  元数据，不保存 Base64、Data URL、原始像素裁剪框或图片二进制。
- 新增 `tail-image-template-contract`，负责 URL 编码、草稿清洗、重复媒体剔除和顺序移动。生产
  `WebPublishTemplateService` 继续作为最终可信边界，只持久化：
  - `placement=append`
  - 有序 `assetIds`
  - 清洗后的 `assets`
  - `crop.mode`
  - `crop.presetId`
  - 输入和输出宽高
- 页面提供缩略图、删除、桌面拖拽排序和移动端前后移动按钮；不增加图片内嵌编辑器或未要求的模板能力。
- 保存继续采用一个固定在工作区底部的统一动作栏。空名称、无图片或仍有图片等待裁剪时阻断保存，定位到
  对应区域并显示红色错误；保存中、成功和失败反馈在按钮旁通过 `aria-live` 持续可见。
- 模板列表显示图片数量、作用域、版本和更新时间；跨店可见模板的预览继续通过短期下载票据读取，不能直接
  构造对象存储地址。
- 页面卸载、店铺切换、删除图片和取消裁剪时会回收本地 Blob 预览 URL，避免连续编辑后的浏览器内存泄漏。

新增测试覆盖：

- 尾部主图路由、导航和全部 V2 API 方法；
- 店铺、模板和媒体 ID 的 URL 编码；
- 草稿保持图片顺序、去重并剔除嵌入图片内容；
- 服务端只持久化追加规则、媒体引用和有限裁剪元数据；
- 多图上传、真实裁剪、缩略图、删除、排序和固定统一保存栏；
- 页面源码不得使用 `FileReader`、`readAsDataURL` 或 Base64。

本轮完整 `npm test` 为 476/476 通过，`npm run build:v2` 通过。主应用 JS gzip 约 174.96 kB；
Vite 仍提示单个主 chunk 超过 500kB，属于构建体积提示，本轮没有为此扩大功能改动范围。

本地 demo 浏览器验收已确认：

- 空表单点击保存时，模板名称和图片区域均显示红色错误，固定栏同步显示失败原因；
- 一张 `1200×1200` 图片直接上传，一张 `1600×900` 图片进入真实裁剪并输出 `1200×1200`；
- 两张图片可通过前移按钮调整顺序，创建后列表显示 2 张且固定追加到末尾；
- 修改名称并更新后，模板版本从 v1 递增到 v2；
- 1280×720 桌面视口下编辑区和模板列表保持两栏，固定保存栏未遮挡内容；
- 390×844 移动视口下页面单列显示，固定保存栏完整可见，前后移动按钮可实际改变图片顺序；
- 最终控制台没有 error 或 warning，验收创建的临时 demo 模板已删除。

本轮没有访问生产环境、刷新线上 SHEIN 数据、修改数据库、执行迁移、修改生产 `.env`、切换 release、
调用 SHEIN 写接口或启用发布。下一步按阶段 6 顺序进入“店铺合规模板”。

## 70. 2026-08-05 V2 模板中心：店铺合规模板

V2 模板中心已完成阶段 6 最后一个用户可用纵向切片，新增店铺合规模板：

- 新增 `/app/templates/:storeId/compliance` 路由和“模板中心 / 店铺合规”导航；店铺切换继续沿用现有
  `templates` 路由识别。
- V2 API 客户端沿用统一的
  `/v1/web/stores/:storeId/publish-templates?type=compliance` 和模板新增、更新、删除路径，没有新增
  SHEIN 写接口、数据库字段或迁移。
- 官方 `POST /open-api/goods-compliance-requirements/list` 只能按 SKC 查询，因此页面必须选择当前店铺
  已同步的真实参照 SKC，再读取该 SKC 的类目、合规记录和规则快照；不能用类目 ID 猜测合规要求。
- 合规工作区 SKC 列表现只读关联 `spus`，返回真实 `categoryId/categoryName`。对应运行时数据库能力
  静态清单新增 `spus: SELECT`；生成过程没有连接数据库、执行 SQL 或修改权限。
- 新增 `compliance-template-contract`：
  - 所有官方要求完整进入规则目录；
  - `isRequired` 原样保留 `0=选填`、`1=必填`、`10=规则确认中`；
  - 任一 `isRequired=10` 都阻断保存，要求重新同步，不能降级成选填；
  - 店铺可复用必填项缺少默认值时一次返回完整错误集合；
  - Base64、Data URL 和未列入白名单的字段不会进入模板。
- 店铺模板只允许保存当前店铺可复用默认值：
  - 非 1630/1631 的有效证书库引用或受保护证书资料；
  - 当前店铺同类型有效代理公司平台 ID；
  - 当前启用规则返回的手动警示语字段和值；
  - 官方示例中的欧代实拍图 `labelId=11`。
- 以下要求仍完整显示，但不进入通用默认值：
  - 1630/1631 检测报告，每个 SKC 单独上传；
  - 普通商品本体或包装实拍图，每个商品单独完成；
  - GCC、产品标识符及其他当前开放平台只读或未验证写入的要求。
- 生产 `WebPublishTemplateService` 作为最终可信边界再次按字段白名单清洗规则目录和默认值，并固定保存
  `storeScoped=true`、`revalidateOnUse=true`。模板引用到目标商品时必须重新查询该商品的实时规则。
- 页面完整分组展示“证书资料、代理公司、手动警示语、实拍图要求、平台其他要求”，并实时统计必填、
  选填和规则确认中数量。
- 保存继续采用一个固定在工作区底部的统一动作栏。漏填或规则未知时定位到第一处错误、字段红色高亮，
  固定栏通过 `aria-live` 显示保存中、成功或失败反馈；没有每个属性单独保存造成的部分状态。
- demo API 按既有安全设计不虚构 SKC 或合规规则，因此本轮浏览器只验收真实空状态和前端失败反馈；
  动态规则、三态必填、1630/1631、欧代实拍图和服务端清洗由契约与服务测试固定。

新增测试覆盖：

- 合规模板路由、导航和全部 V2 API 方法；
- 店铺和模板 ID 的 URL 编码；
- 官方要求目录完整保留三态必填；
- 规则确认中和可复用必填默认值缺失时阻断保存；
- 1630/1631、普通商品实拍图、Base64 和额外私有字段不得进入模板；
- 欧代实拍图 `labelId=11` 可以进入店铺默认值；
- 页面必须有固定统一保存栏、`aria-live` 反馈、错误定位和所有要求分组；
- 页面源码不得出现未经本项目验证的 SHEIN 写 endpoint。

本轮完整 `npm test` 为 487/487 通过，`npm run build:v2` 通过。主应用最大 JS chunk gzip 约
181.52 kB；Vite 仍提示单个主 chunk 超过 500kB，属于既有构建体积提示，本轮没有为此扩大功能改动范围。

本地 demo 浏览器验收已确认：

- 1280×720 桌面视口 `documentWidth=1265`、`clientWidth=1265`，没有页面级横向溢出；编辑区和模板列表
  保持两栏，固定保存栏底部为 720。
- 390×844 移动视口浏览器实际可用宽度为 375，`documentWidth=375`、`clientWidth=375`，没有横向
  溢出；页面单列显示，固定保存栏底部为 844，保存按钮完整可见。
- 空表单点击统一保存后，模板名称 `aria-invalid=true`，页面生成可见 `role=alert` 错误反馈并定位到
  首个漏填项。
- 最终控制台没有 error 或 warning。

本轮没有访问生产环境、刷新线上 SHEIN 数据、修改数据库、执行迁移、修改生产 `.env`、切换 release、
调用 SHEIN 写接口或启用发布。阶段 6 模板中心已完成；下一步按路线进入阶段 7“单个商品草稿与预检”。

## 71. 2026-08-05 V2 单品草稿：店铺合规素材引用

阶段 7 单品创建页现已接入店铺合规模板，沿用页面底部唯一的“统一保存当前草稿”动作：

- 页面按当前店铺和 SHEIN 末级类目列出合规模板；切换类目或店铺会清除旧模板选择，避免跨类目、跨店
  误用。
- 1630/1631 继续只根据实时类目的商品属性判定，不读取 SKU 成品尺寸或包装物流尺寸；模板只选择与判定
  结果一致的报告素材。
- 按最新业务确认，商品本体实拍图和商品包装实拍图可作为店铺通用素材引用，分别保持
  `labelGroup=1` 和 `labelGroup=2`，不得互相替代；这条规则覆盖第 70 节记录的早期边界。
- GCC 和产品标识符在新建商品尚无 SKC 时不写入发布字段，只保存为
  `manualQueue=[gcc, product_identifier]`。SKC 生成后必须重新读取官方要求，再根据真实必填状态进入人工队列。
- 草稿保存 `complianceTemplateId`、清洗后的只读模板快照和 `requiresSkcRevalidation=true`。不会保存
  虚构的 GCC、产品标识符、`labelId` 或 SHEIN 写入状态。
- 服务端重新计算商品属性对应的 1630/1631，再校验模板 ID、店铺、末级类目、规则快照、对应报告、商品
  本体图和包装图；任一失败都会阻止 `ready` 状态。
- 合规模板快照中的 `media:` 报告和实拍图由服务端直接加入草稿媒体引用，不能依赖客户端单独声明，避免
  清理任务误删正在使用的素材。
- 保存完成后统一反馈服务端返回的属性、图片、SKU、合规和本地阻断数量；合规失败时自动定位到合规区，
  不增加逐项保存按钮。

新增测试覆盖模板 ID 伪造、跨店模板、过期规则、类目不一致、错误报告、缺失或 Base64 实拍图、服务端
1630/1631 重算、媒体引用保护，以及 GCC/产品标识符不得进入写字段。

本轮完整 `npm test` 为 542/542 通过，`npm run build:v2`、`npm run build:web` 和 V2 TypeScript 检查
均通过。V2 仍有既有的单个主 chunk 超过 500kB 提示，没有为此扩大本阶段改动。

本地 demo 浏览器验收已确认：

- `家用纺织品 / 地毯和地垫 / 装饰地毯` 能加载完整实时属性 Schema；
- demo 不虚构 SKC 或合规模板，页面准确显示“当前末级类目没有可引用的店铺合规方案”；
- 空合规模板会产生可见阻断，GCC 和产品标识符均显示为 SKC 后读取官方必填状态；
- 375px 视口下 `rootScrollWidth=360`、`rootClientWidth=360`，没有页面级横向溢出；
- 浏览器控制台没有 error 或 warning。

本地演示 API 和 V2 开发服务保持运行：`http://127.0.0.1:8790`、`http://127.0.0.1:5174/`。本轮没有
访问生产环境、刷新线上 SHEIN 数据、修改数据库、执行迁移、修改生产 `.env`、调用 SHEIN 写接口或启用发布。

## 72. 2026-08-05 V2 单品草稿：销售属性、SKU 批量填写与全托管发布设置

阶段 7 单品创建页已完成颜色尺寸、打包体积、SKU 批量填写和全托管发布设置的草稿闭环：

- 颜色尺寸模板不绑定类目；引用到商品时才与当前末级类目的实时销售属性 Schema 匹配。颜色和
  尺寸只有唯一精确匹配时自动带入，失败或歧义时必须人工选择真实
  `attribute_id` 和 `attribute_value_id`，不猜 ID、单位或发布值。
- 尺寸名支持 `40*60`、`40×60` 和 `40x60` 的规范化匹配。打包体积按“材质 + 成品长宽”匹配，
  长宽方向无关；成品尺寸和包装物流尺寸始终分离，1630/1631 仍只读取商品属性。
- SKU 表格支持输入每平方米供货价后按成品面积一键换算每个 SKU 总价，输入每平方米克重后
  一键估算 SKU 重量，并可一键应用统一库存。批量填写后仍可逐行修正，价格、重量和库存保存到
  `skuRows`。
- 商家 SKC/SKU 货号和通用 SKU 图片均进入草稿校验。服务端重新验证销售属性快照、成品尺寸、
  包装匹配、价格、重量、库存和货号，不信任客户端的 `matched` 或 `ready` 状态。
- 全托管发布设置严格使用本地 SHEIN API 文档中的 `mall_state`、`stop_purchase`、`shelf_require`、
  `shelf_way` 和 `hope_on_sale_date`。实时 `fill_in_standard_list` 返回 `show=false` 时字段不显示也不发送。
- 发布设置没有隐藏默认值；所有当前可见必填项都需用户明确选择。定时上架时才要求北京时间，
  严格转换为 `YYYY-MM-DD HH:mm:ss`；自动上架不保存旧的定时值。
- 草稿服务使用服务端固定的全托管模式和已保存的实时填写标准重建发布设置预检，不允许客户端通过
  `businessModeSnapshot` 降级规则。最终草稿只保存经校验的 `root` / `skc` / `sku` 字段分组。
- 发布批次的 SKU 提取已兼容 V2 `skuRows` 和旧版 `sizeRows`，避免有效 V2 草稿被误判为无 SKU。

新增契约与服务测试覆盖销售属性精确匹配、打包尺寸方向归一、批量价格/重量/库存、伪造属性 ID、
伪造包装匹配、发布字段动态隐藏、无默认值、定时北京时间以及 V2 批次 SKU 兼容。本轮完整
`npm test` 为 549/549 通过，`npm run build:v2`、`npm run build:web` 和 V2 TypeScript 检查均通过。Vite 仍有既有的
单个主 chunk 超过 500kB 提示，本轮没有为此扩大改动范围。

本地 demo 浏览器验收已确认：

- “家用纺织品 / 地毯和地垫 / 装饰地毯”能读取实时销售属性和填写标准；
- demo 实时规则隐藏的 `mall_state` 和 `shelf_require` 没有显示，可见的采购状态和上架方式需明确选择；
- 选择“可采 + 自动上架”后发布设置显示“已填写”，统一保存后本区域无错误提示，页面明确反馈草稿已保存与其他剩余阻断项；
- 375×812 视口下 `rootScrollWidth=375`、`rootClientWidth=375`，没有页面级横向溢出；
- 最终控制台没有 error 或 warning。

本地演示 API 和 V2 开发服务地址仍为 `http://127.0.0.1:8790` 和 `http://127.0.0.1:5174/`。本轮没有访问生产环境、刷新线上 SHEIN 数据、修改数据库、执行迁移、
修改生产 `.env`、调用 SHEIN 写接口或启用发布。下一步进入“商品属性服务端重新校验 + 最终可审计发布快照”。

## 73. 2026-08-05 V2 单品草稿：商品属性服务端复验与可审计发布候选快照

阶段 7 已完成商品属性服务端重新校验和最终可审计发布候选快照：

- 服务端不信任浏览器提交的 `product_attribute_list`，而是使用与末级类目绑定的
  `attributeSchemaSnapshot`、用户填写的 `attributeValues` 和服务端实时读取的 SHEIN 关联属性规则重新生成。
- 属性快照必须匹配当前 `categoryId`、`productTypeId` 和有效时间；只接收官方 Schema 中
  `attribute_type=3/4` 且 `data_dimension!=3` 的商品属性。
- 服务端重新验证每项属性的动态必填状态、`modeCode`、最大选择数量、可选值 ID、自定义值权限和
  `ruleInfoList`。未知属性、伪造值、超选、非法自定义值和缺少动态必填项都会阻断草稿进入发布准备状态。
- 关联属性规则由服务端调用官方
  `/open-api/goods/get-associated-attribute-rules` 实时覆盖，浏览器提交的关联规则快照不作为可信依据。
  关联规则只能扩展当前 Schema 已支持属性的必填和值域；指向未支持尺寸属性的规则会保守阻断，不能猜测字段。
- 关联规则接口成功返回空规则时仍保存检查时间，明确区分“已检查且无规则”和“尚未检查”。
- 浏览器保存的属性 Schema 快照补齐 `categoryId`、`productTypeId`、`required`、`modeCode`、
  `maxSelections` 和 `ruleInfoList`，供服务端进行类目绑定和完整复验。

所有可信草稿区块复验完成后，服务端生成 `preflight.publishCandidate`：

- `state` 只能是 `ready_for_remote_preflight` 或 `blocked`；
- `requestBody` 只包含服务端重建并通过校验的发布字段；
- `fingerprint` 是对规范化可信数据计算的确定性 SHA-256，可用于后续审计和发布前防篡改；
- 任一商品属性、内容、SKU、发布设置或合规区块被阻断时，`requestBody=null`；
- 完整草稿保存后自动提升为 `ready`，不完整草稿保持 `blocked`；
- 候选快照记录生成时间、关联规则追踪 ID、待上传图片计划和后续远程预检清单。

当前候选快照只记录官方发布端点 `/open-api/goods/product/publishOrEdit`，继续固定
`publishingEnabled=false`，不会调用 SHEIN 写接口。商品图片没有伪造 SHEIN URL，仍保留为明确的
`pendingImageUploads`，等待后续通过官方上传和转图接口解析成真实可发布地址。

后续必须冻结到候选快照的远程预检包括：

- `check-publish-permission`
- `query-shelf-quota`
- `check-supplierSku-repeated`
- `upload-pic`
- `transform-pic`
- `goods-compliance-requirements/list`

发布批次现已拒绝旧版或伪造的 `ready` 草稿。只有同时满足
`publishCandidate.state=ready_for_remote_preflight` 且存在非空 `fingerprint` 的草稿才能进入批次预检；
候选指纹会复制到每个批次项目的预检审计数据中。

页面侧边栏新增“发布候选快照”状态，统一保存后明确反馈“已生成”或剩余阻断数量。浏览器验收中修复了
本地表单错误与服务端属性/内容错误重复累加的问题；当前装饰地毯未完整填写时，保存反馈和页面阻断数量均为
34，不再显示重复的 59。

新增测试覆盖属性快照类目绑定、动态必填、值域与自定义值规则、实时关联规则覆盖、伪造属性拒绝、候选快照
阻断/生成、确定性指纹、图片待上传计划和发布批次指纹门禁。本轮完整 `npm test` 为 559/559 通过，
`npm run build:v2` 和 `npm run build:web` 均通过。V2 主 JS 约 724.29 kB、gzip 约 209.72 kB，
Vite 仍有既有的单个主 chunk 超过 500kB 提示，本轮没有为此扩大改动范围。

本地 demo 浏览器验收已确认：

- “家用纺织品 / 地毯和地垫 / 装饰地毯”加载 24 个必填和 19 个选填商品属性；
- 未完整填写时保存后候选快照显示“未生成”，保存反馈与页面均显示 34 个阻断项；
- 375×812 视口下 `rootClientWidth=375`、`rootScrollWidth=375`，没有页面级横向溢出；
- 最终控制台没有 error 或 warning。

本轮没有访问生产环境、刷新线上 SHEIN 数据、修改数据库、执行迁移、修改生产 `.env`、调用 SHEIN 写接口
或启用发布。下一步进入“SHEIN 图片上传解析 + 发布权限、货架配额和商家 SKU 重复远程预检冻结”。

## 74. 2026-08-05 V2 发布准备：图片解析与远程预检冻结

发布候选快照现已接入真实发布前的远程预检冻结层，但仍不调用
`/open-api/goods/product/publishOrEdit`：

- 服务端会重新计算并验证草稿候选指纹。旧版、字段被篡改、缺少请求体或指纹不匹配的候选在访问 SHEIN
  或读取图片前直接阻断。
- 候选请求体新增官方图片方案字段 `is_spu_pic`，值只来自服务端重建的实时
  `picture_config_list` 图片方案，不接受浏览器自行声明。
- 发布权限继续调用官方 `/open-api/goods/product/check-publish-permission`。
- 上架额度新增调用官方 `/open-api/goods/query-shelf-quota`。当前草稿没有品牌字段，因此请求不虚构
  `brand_code`；响应必须明确返回大于 0 的 `availableLimit`，缺失、非数字或额度为 0 均失败关闭。
- 商家 SKU 查重继续调用官方 `/open-api/goods/product/check-supplierSku-repeated`。批次超过 200 个
  SKU 时按官方单次上限拆成连续的 200 条请求，不再因整个发布批次超过 200 条而直接拒绝。
- 每个候选必须获得自身全部商家 SKU 的查重结果。缺少回执、返回数量不完整或任一 SKU 已存在都会阻断
  对应草稿，不会让其他草稿的查重结果代替。

新增 `product-remote-preflight` 冻结器：

- 权限、额度和 SKU 查重全部通过后，才开始处理候选中的 `pendingImageUploads`。
- 图片素材必须属于当前租户和店铺，状态为 `ready/referenced`，对象存储记录与实际文件类型一致，并再次
  校验为 JPG/JPEG/PNG 且不超过 3MB。
- 图片通过官方 `POST /open-api/goods/upload-pic` 换取 SHEIN HTTPS URL；不接受浏览器提交的平台 URL。
- 同一个对象存储素材在相同 `image_type` 下被多个 SKU 复用时只上传一次，随后复用同一个 SHEIN URL，
  减少重复上传和等待时间。
- 上传结果按官方结构绑定：
  - SPU 图片写入顶层 `image_info.image_info_list`；
  - SKC 图片写入对应 `skc_list[].image_info.image_info_list`；
  - SKU 图片通过 `supplier_sku` 精确绑定到对应 `sku_list[].image_info.image_info_list`；
  - 站点详情图写入 `site_detail_image_info_list[].image_info_list`，不把上传类型 7 错写成发布图片类型。
- SKU 图片上传计划新增可信 `supplierSku`，解决仅有浏览器行 ID 时无法可靠绑定官方 SKU 报文的问题。
- 当前全部来源都是本地对象存储素材，因此 `/open-api/goods/transform-pic` 明确记录为
  `skipped`，不会为了完成清单而假调用外链转图接口。
- 任一图片读取、上传、URL 校验或报文绑定失败时，远程快照保持 `blocked`、`requestBody=null`；已经完成
  的上传回执只保留在审计结果中，不会形成半完成可发布报文。

全部远程检查和图片解析通过后，每个发布批次项目生成：

- `remotePublishCandidate.state=ready_for_publish_confirmation`
- 新的远程冻结指纹
- 已绑定真实 SHEIN 图片 URL 的完整请求体
- 权限、额度、SKU 查重、图片上传、转图跳过和 SKC 后合规回读的逐项状态
- 各官方调用的 TraceId 和图片复用数量

发布批次只有远程候选状态和指纹同时有效时才进入 `ready`。所有结果继续固定
`publishingEnabled=false`，远程候选只能等待后续人工确认门禁，不能直接执行发品。

演示 API 已改为失败关闭：保留用户输入的 SKU，但明确返回“未连接真实 SHEIN 店铺”，权限为未知、额度为
未知、SKU 检查数量为 0，且不会生成虚假的 SHEIN 图片 URL 或“预检通过”状态。

新增测试覆盖候选指纹篡改、额度缺失/耗尽、SKU 超 200 分批、SKU 回执不完整、对象存储图片二次校验、
共享 SKU 图片去重上传、SPU/SKC/SKU/站点详情图绑定、转图跳过、批次逐项冻结和演示环境失败关闭。
本轮完整 `npm test` 为 563/563 通过，`npm run build:v2` 和 `npm run build:web` 均通过。V2 主 JS
约 724.33 kB、gzip 约 209.74 kB，仍只有既有的大 chunk 提示。

本地浏览器验收已确认：

- 装饰地毯仍加载 24 个必填和 19 个选填商品属性；
- 页面控制台没有 error 或 warning；
- 演示远程预检对一个有效格式商家 SKU 返回 `passed=false`，并明确说明未连接真实 SHEIN 店铺；
- V2 首页和演示 API `/health` 均返回 HTTP 200；
- V2 与演示 API 继续运行在 `http://127.0.0.1:5174/` 和 `http://127.0.0.1:8790`。

本轮没有访问生产环境、刷新线上 SHEIN 数据、修改数据库、执行迁移、修改生产 `.env`、调用真实店铺的
SHEIN 接口、上传生产图片或启用发布。下一步进入“发布批次页面与人工确认门禁”，把逐商品远程预检结果、
阻断原因、候选指纹和待确认请求摘要展示给用户。

## 75. 2026-08-05 V2 发布中心：批次管理与人工确认门禁

V2 经营中心已新增店铺级“发布中心”，完成发布批次创建、远程预检结果查看和人工确认审计，但真实发布仍然
关闭：

- 页面只列出服务端状态为 `ready` 的商品草稿，可多选后创建最多 100 个草稿的幂等发布批次。
- 批次支持 `preflight`、`pause`、`resume`、`retry` 和 `confirm`；没有新增数据库状态或迁移，
  人工确认继续复用批次 `ready` 状态，并写入现有批次和条目 `preflight` JSON。
- 批次列表显示待预检、预检中、待确认、暂停和失败状态；批次详情逐商品显示发布权限、上架额度、
  SKU 查重数量、重复 SKU、图片上传/复用数量、源候选指纹、远程候选指纹和阻断原因。
- 确认按钮只有在批次及全部条目均为 `ready` 时可用，且用户必须先勾选已核对权限、额度、SKU 查重、
  图片结果和两组指纹的声明。
- 页面所有创建、预检、重试和确认动作都有可见 `aria-live` 反馈；长表格在自己的滚动容器内，不产生
  页面级横向溢出。

服务端 `confirm` 动作新增以下强制门禁：

- 当前批次必须仍为 `ready`，且至少包含一个条目；所有条目必须仍为 `ready`。
- 每个草稿当前保存的 `publishCandidate` 必须重新通过确定性指纹校验，并与批次预检时冻结的
  `publishCandidateFingerprint` 完全一致。
- 每个 `remotePublishCandidate` 必须仍为 `ready_for_publish_confirmation`，远程指纹非空、
  `sourceCandidateFingerprint` 与源候选指纹一致、没有阻断项，且
  `publishingEnabled=false`。
- 服务端按条目 ID、草稿 ID、源候选指纹和远程候选指纹生成确定性批次指纹，记录确认用户、确认时间、
  批次指纹和逐条目指纹摘要。
- 确认记录固定 `authorizesPublishing=false`，只证明用户核对了这一份冻结快照，不授权调用
  `/open-api/goods/product/publishOrEdit`。
- 仓储更新使用事务和 JSONB 预期值条件，同时检查批次仍为 `ready`、条目仍为 `ready`。确认期间状态或
  预检 JSON 发生变化时整笔事务回滚并返回 409，不能把旧确认写到新快照上。
- 对同一批次指纹重复确认保持幂等，不重复写入或重新调用远程预检、图片上传和任何发布接口。
- 暂停、失败、部分就绪、源候选变化、远程候选缺少指纹或远程候选来源不一致时均失败关闭。

演示 API 支持识别 `confirm` 动作，但不会伪造成功确认：未通过真实远程预检的批次返回
`BATCH_NOT_READY_FOR_CONFIRMATION`；即使人为构造 `ready` 演示批次，也返回
`DEMO_CONFIRMATION_UNAVAILABLE`。

新增服务、演示和 V2 静态契约测试覆盖确认成功、确认审计字段、指纹过期、状态不合法、重复确认幂等、
演示失败关闭、页面路由、导航、API 方法、确认声明和禁止发布调用。本轮完整 `npm test` 为
572/572 通过，`npm run build:v2` 和 `npm run build:web` 均通过。V2 仍有既有的单个主 chunk 超过
500kB 提示，本轮没有为此扩大改动范围。

本地浏览器验收已确认：

- 可以从一个真实 `ready` 演示草稿创建发布批次，创建后状态为“待预检”，确认声明和按钮保持禁用。
- 演示远程预检完成后批次进入“预检失败”，逐商品显示“未连接真实 SHEIN 店铺”的阻断原因，不生成权限、
  额度、SKU 查重、图片结果或指纹的虚假通过数据。
- 失败批次只允许重试，人工确认仍保持禁用。
- 390px 移动视口 `innerWidth=390`、`documentScrollWidth=375`；默认桌面视口
  `innerWidth=1280`、`documentScrollWidth=1265`，均没有页面级横向溢出。

本轮没有访问生产环境、刷新线上 SHEIN 数据、修改数据库、执行迁移、修改生产 `.env`、调用真实 SHEIN
接口、上传生产图片、调用 `publishOrEdit` 或启用发布。下一步进入“确认后发布执行二次闸门与写后回读
设计”：在任何真实写入启用前，必须先确定一次性执行授权、请求幂等、逐商品结果、失败恢复、SKC/SKU
回读和 1630/1631/GCC/产品标识符的 SKC 后合规复验边界。

## 76. 2026-08-05 V2 确认后执行计划与发布后回读设计

发布中心已完成确认后执行计划，但真实发布继续关闭：

- `plan-execution` 只接受当前已经确认的批次指纹；源发布候选、远程请求体或确认快照发生变化时返回
  409，必须重新预检和确认。
- 服务端重新验证远程候选请求体的确定性指纹，并按官方限制检查每次请求包含 1–40 个 SKC、每个 SKC
  包含 1–400 个 SKU。
- 执行计划只保存逐请求摘要、确定性请求键、批次统计和执行计划指纹，不保存第二份发布报文。
- 执行计划固定 `executionEnabled=false`、`authorizesPublishing=false`，页面“执行发布（未启用）”
  按钮永久禁用，当前代码没有调用 `/open-api/goods/product/publishOrEdit`。
- 用户必须在人工确认之后再次勾选声明，才可以生成执行计划；重复生成相同计划保持幂等。

计划明确记录以下写后回读顺序：

1. 从发布接口回执保存平台商品标识、SKU 标识、`version` 和 `traceId`。
2. 接收 `/product_document_receive_status_notice`，确认平台接收商品文档并保存单据号。
3. 接收 `/product_document_audit_status_notice`，记录待审核、通过、驳回或撤销状态。
4. 通过 `/open-api/goods/query-document-state` 按版本补偿查询缺失通知。
5. 只在审核通过后调用 `/open-api/goods/spu-info` 回读 SPU、SKC 和 SKU 关系。
6. 按 SKC 重新检查 1630/1631、GCC 和产品标识符状态；1630/1631 继续只按已保存的商品属性判定。

V2 页面显示计划请求数、SKC 数、SKU 数、执行指纹和完整回读表。回读来源使用中文名称并同时保留官方
接口路径或内部枚举，英文用途枚举转换为中文操作说明，便于用户核对和后续审计。

演示 API 已识别 `plan-execution`，但不会伪造远程候选或成功计划；未连接真实 SHEIN 店铺时始终失败
关闭。新增测试覆盖远程请求体篡改、确认指纹过期、官方 SKC/SKU 数量边界、计划幂等、回读顺序、
演示失败关闭和 V2 禁止发布契约。本轮完整 `npm test` 为 579/579 通过，`npm run build:v2` 和
`npm run build:web` 均通过。V2 仍只有既有的单个主 chunk 超过 500kB 提示。

本地浏览器验收已确认：

- 可以创建发布批次并获得即时反馈；演示远程预检明确返回“未连接真实 SHEIN 店铺”，确认门禁保持禁用。
- 默认桌面视口 `innerWidth=1280`、`documentScrollWidth=1265`；移动视口
  `innerWidth=390`、`documentScrollWidth=375`，均无页面级横向溢出，长表格使用局部横向滚动。
- 页面控制台没有 error 或 warning。
- V2 与演示 API 已使用最新代码重新启动在 `http://127.0.0.1:5174/` 和
  `http://127.0.0.1:8790`。

本轮没有访问生产环境、刷新线上 SHEIN 数据、修改数据库、执行迁移、修改生产 `.env`、调用真实 SHEIN
接口、上传生产图片、调用 `publishOrEdit` 或启用发布。下一步应实现“真实执行前的一次性授权协议和逐请求
状态机”，但仍先保持执行关闭：定义授权过期、操作人二次确认、请求领取、未知结果恢复、部分失败重试和
回读完成条件，再决定是否具备启用真实写入的条件。

## 77. 2026-08-05 V2 店铺授权与重新授权回显修复

修复了 V2 店铺管理页缺少授权入口、授权回调仍返回旧版页面参数，以及授权成功或失败后用户看不到结果的
问题：

- 管理员和所有者在 `/app/settings/stores` 可以点击“授权或重新授权”，通过既有
  `POST /v1/web/shein/auth/start` 获取 SHEIN 官方授权地址。
- 云端授权回调固定返回 `/app/settings/stores`，不再使用旧版 `?page=stores` 导航约定。
- 授权成功后页面显示具体店铺名称、立即重新读取 `GET /v1/web/stores`，随后清理地址栏中的一次性回调
  参数。
- 授权失败时页面显示云端返回的具体错误。已绑定到其他工作空间的店铺仍由
  `STORE_ALREADY_BOUND` 阻断，不会为了回显问题放宽租户隔离。
- 演示 API 对授权入口明确返回 `SHEIN_AUTHORIZATION_UNAVAILABLE`，不伪造授权地址或成功店铺。

新增 V2 授权 UI 静态契约测试，并更新云端回调测试。本轮完整 `npm test` 为 581/581 通过，
`npm run build:v2` 和 `npm run build:web` 均通过。浏览器已验证授权按钮、演示失败提示、成功回调提示、
店铺列表刷新和回调参数清理；390px 移动视口没有横向溢出，页面控制台无错误。

当前仓库和接口均为 SHEIN，不包含 TEMU 授权能力。若用户所说的“去 TEMU 店铺后台删除”并非口误，
必须切换到 TEMU 项目并按 TEMU 授权文档另行排查，不能复用本项目的 SHEIN 回调。

本轮没有访问生产环境、提交真实授权、读取或修改生产数据库、转移店铺所属工作空间、修改生产 `.env`、
调用商品写接口或启用发布。

## 78. 2026-08-05 生产店铺重授权不显示：只读诊断

用户确认此前把 SHEIN 口误为 TEMU。随后对生产环境进行了只读诊断，没有部署或修改数据库。

线上实际运行版本为 `/opt/shein-console/releases/20260803-publish-ui-v2`，不是旧交接记录中的
2026-07-30 release。控制服务、PostgreSQL、Redis、图片任务服务和媒体清理服务均在运行。线上
`dist-web` 仍是旧版 WebApp，已经包含“授权新店铺”和 `?page=stores` 回调处理，因此不能直接部署当前
V2 的 `/app/settings/stores` 回调改动。

生产授权记录显示：

- Supplier ID `16814339` 于 2026-07-31 通过旧桌面授权创建了独立工作空间
  `SHEIN 店铺 16814339`。
- 当前网页工作空间 `SHEIN涵舟工作室` 在 2026-08-02 三次授权该店，均被
  `STORE_ALREADY_BOUND` 阻断。
- 生产库在 2026-08-05 没有新的授权尝试；从 SHEIN 后台直接删除和重新授权，没有经过网站生成的
  单次 `state`，不会触发本系统接管店铺。
- 当前网页工作空间已有三家正常店铺：Supplier ID `14152389`、`5554076`、`17429754`。

旧工作空间审计结果：

- 没有网页成员。
- SPU、SKC、SKU、同步任务、商品模板和发布模板均为 0。
- 有一台状态为 active 的“macOS 工作电脑”。
- 有一个尚未过期的设备会话，最后活动时间为 2026-07-31。

因此不能未经用户确认直接修改店铺 `tenant_id`：迁移会改变店铺归属，还必须明确旧设备和设备会话是迁移、
吊销还是停用。下一步应在维护窗口执行带预检、事务、写后验证和回滚记录的一次性迁移；执行前必须由用户
确认 Supplier ID `16814339`、目标工作空间和旧设备会话处理方式。

## 79. 2026-08-05 Supplier ID 16814339 生产店铺迁移完成

用户确认将 Supplier ID `16814339` 迁移到当前网页工作空间，并吊销旧工作空间的设备会话。迁移已在
生产环境完成，没有部署本地 V2、修改生产配置或调用 SHEIN 商品写接口。

迁移前已创建完整 PostgreSQL 备份：

- 路径：
  `/opt/shein-console/backups/postgres/manual-store-16814339-before-transfer-20260805T161140Z.dump`
- SHA-256：
  `246ecd31fcf8a9053ccd49cb18baef1a1bc4c1007b5119fdd87980f8fb9a2eb3`
- 大小：`537K`

一次性迁移脚本先以 `execute=false` 执行完整事务演练，所有前置断言、行锁、更新和写后校验均通过，
并明确以 `ROLLBACK` 结束。确认回滚后生产状态没有残留变化、备份校验值一致后，再以
`execute=true` 执行；正式事务明确以 `COMMIT` 结束。

写后独立核验结果：

- 店铺 `84271123-c94a-4b8f-87a5-f4e4e08c21cf` 已从工作空间
  `db2f94ed-bdf2-4f62-bfca-95db8f2f4262` 迁移到
  `SHEIN涵舟工作室`（`3e79a305-255b-4d12-8fe1-02d8c90ec6df`）。
- 店铺状态为 `active`，`authorized_by` 已设置为目标工作空间所有者
  `b5346678-f8b9-4896-83b0-58b7070891c4`。
- 目标所有者已获得该店铺的 `membership_store_access`。
- 旧桌面设备 `904b2575-ddef-434e-8b4f-8ac7b8cc882b` 已设为 `revoked`。
- 旧设备共有 1 个历史会话，未吊销会话数为 0。
- 已写入 `manual.store.transfer`、状态码 `200` 的生产审计记录。
- `deploy-control-1`、PostgreSQL 和 Redis 均为 `healthy`；
  `GET http://127.0.0.1:8790/health` 返回 `{"ok":true,"service":"shein-cloud-control"}`。

旧工作空间没有删除或停用，以保留历史授权尝试和审计记录。若需要整库回滚，必须先停止应用写入并在维护
窗口从上述备份恢复；恢复会回退备份时间点之后的全部生产数据，不能只用于撤销这一个店铺迁移。若只需撤销
本次迁移，应编写新的定向事务脚本，重新执行前置校验，并同时撤销目标访问权、恢复店铺归属和按明确决策处理
旧设备状态。

## 80. 2026-08-05 V2 一次性执行授权协议与逐请求状态机

用户要求后续暂不修改生图板块，可能会移除该模块。本轮没有修改任何生图页面、接口、任务、Worker、模型或
费用配置；后续开发也应先将生图板块视为冻结范围，除非用户重新明确启用。

发布中心在现有人工确认和执行计划之后，新增了不具备真实写入能力的一次性执行授权协议：

- 只有当前确认指纹和执行计划指纹仍然有效时，才能执行 `authorize-execution`。
- 用户必须再次勾选声明，确认请求数量、回读流程和结果未知处理规则。
- 授权协议默认有效期为 10 分钟，只能被一个执行任务消费一次；有效期内重复生成保持幂等，过期后允许重新
  签发。
- 协议保存授权人、授权时间、失效时间、执行计划指纹、协议指纹和逐请求初始状态，不保存第二份发布报文。
- `executionEnabled=false` 和 `authorizesPublishing=false` 仍固定不变；页面执行按钮继续禁用，当前代码
  仍没有调用 `/open-api/goods/product/publishOrEdit`。

新增的逐请求状态机实现以下恢复边界：

- 请求只能由当前执行任务领取一次，领取记录有 2 分钟租约。
- 明确失败且标记为可重试时，只重试失败请求，不重跑已经成功或尚未失败的请求。
- 提交后连接中断、结果无法确认或领取租约过期时进入 `result_unknown`，禁止自动重发。
- 结果未知只能通过 `/product_document_receive_status_notice`、
  `/product_document_audit_status_notice` 或 `/open-api/goods/query-document-state` 恢复。
- 只有平台接收成功、审核通过、`/open-api/goods/spu-info` 完成 SPU/SKC/SKU 关系回读，并按 SKC 完成
  1630/1631、GCC 和产品标识符复验后，该请求才进入完成状态。
- 全部请求完成后协议才进入 `completed`；审核驳回、撤回、终止失败或未完成回读均不能把批次标记为完成。

演示 API 对 `authorize-execution` 继续失败关闭：没有真实远程发布候选和执行计划时不会生成虚假授权协议。
新增测试覆盖授权过期、单次消费幂等、并发领取阻断、已知失败局部重试、未知结果禁止重发、领取过期转未知、
通知恢复和完整回读完成条件。

本轮完整 `npm test` 为 591/591 通过，`npm run build:v2` 和 `npm run build:web` 均通过。V2 主
chunk 约 745.32 kB、gzip 约 215.08 kB，仍只有既有的 500 kB 提示。

本地浏览器验收确认：

- 发布中心路由正常加载，页面仍明确显示 `authorizesPublishing=false`。
- 默认桌面视口 `innerWidth=1280`、`documentScrollWidth=1280`。
- 390px 移动视口 `innerWidth=390`、`documentScrollWidth=390`。
- 两个视口均无页面级横向溢出，控制台没有 error 或 warning。

本轮没有访问或修改生产环境、执行数据库迁移、切换 release、调用真实 SHEIN 接口、上传生产图片、调用
`publishOrEdit` 或启用发布。下一步应实现状态机的 PostgreSQL 原子领取和 Webhook/状态查询投影关联，但
继续保持真实执行关闭；在实现前应先确认生产迁移 021–029 的部署顺序和 V2 上线边界。

## 81. 2026-08-05 V2 生产发布边界只读门禁

在继续实现 PostgreSQL 原子领取前，新增了独立的 V2 release 只读就绪门禁：

- `server/cloud/audit-v2-release-readiness.js` 冻结迁移 `021–029` 的文件名和 SHA-256，同时核对候选
  release 文件、生产 `schema_migrations`、新表、索引、最终规则类型约束、不可变函数和四个
  `ENABLE ALWAYS` 触发器。
- 门禁检查发布批次、执行计划、一次性执行授权、结果未知恢复协议和 V2 发布中心静态构建；实际静态目录可
  通过 `--web-root` 指定，容器依赖目录可通过 `--module-root` 与只读 release 挂载分离。
- 门禁检查 `shein_runtime` 是否存在且非高权限、不能写 `schema_migrations`、对两张合规审计表只有
  `SELECT/INSERT`，并使用 runtime 连接执行既有完整角色边界和能力矩阵审计。
- 风险信号只读取 PostgreSQL 统计估算和对象大小，不做全表精确扫描。输出不包含连接串、密码、角色成员
  清单、ACL 明细或生产业务行。
- 任一缺失、校验和变化、对象或权限不匹配、runtime 审计未执行、候选代码不完整时都失败关闭。
  门禁结果固定保留 `executionEnabled=false`、`authorizesPublishing=false`。

生产环境已通过一次性只读容器实际运行该门禁。当前 release 仍为
`/opt/shein-console/releases/20260803-publish-ui-v2`，Nginx 实际服务
`/opt/shein-console/current/dist-web`。检查结果为 `NOT READY`，符合当前已知边界：

- 当前 release 和生产 `schema_migrations` 均只到 `020`，迁移 `021–029` 全部缺失。
- 当前 release 没有 `dist-v2`，没有 `publish-execution-protocol.js`，现有控制服务和发布批次服务也不
  包含本地最新的一次性执行授权完整契约。
- `member_invitations`、`shein_rule_snapshots`、`compliance_preflight_runs`、
  `compliance_preflight_reviews` 及对应索引、最终约束、函数和触发器均尚未安装。
- PostgreSQL 中没有 `shein_runtime`，因此完整 runtime 能力审计没有执行。
- PostgreSQL 统计估算显示 `sync_jobs`、`skcs`、`compliance_drafts`、`product_drafts`、
  `publish_batches`、`users` 和 `memberships` 当前均为 0 行估算；该数字只是风险信号，不替代维护窗口
  的精确预检和备份。

通用运行说明已写入 `deploy/v2-release-readiness.md`，`deploy/README.md` 也新增了 V2 切换前置门禁。
维护顺序已经固定为：准备未激活候选 release 和 `dist-v2`、备份并停止写入、顺序执行 `021–027`、按专属
runbook 执行 `028` 和 `029`、由 DBA 人工建立最小权限 `shein_runtime`、对候选版本运行门禁、隔离启动
候选控制服务、人工 GO 后切换 release 和 Nginx、再对活动目录重跑门禁。

本轮完整 `npm test` 为 597/597 通过，`npm run build:v2` 和 `npm run build:web` 均通过。V2 主 chunk
约 745.32 kB、gzip 约 215.08 kB，仍只有既有的 500 kB 提示。

本轮生产操作只有读取 release、Nginx 静态目录、PostgreSQL 系统目录、迁移记录和统计估算，并启动了一个
使用只读文件挂载和只读根文件系统的一次性审计容器。没有执行迁移、创建角色、修改权限、修改数据库、
切换 release、重载 Nginx、调用 SHEIN 接口或启用发布。

下一步按独立迁移设计 PostgreSQL 执行任务和逐请求状态表，再实现原子领取、租约过期转
`result_unknown`、Webhook/商品文档状态查询恢复和 SPU/合规回读投影。该迁移必须在 `021–029` 之后，
不能把执行状态继续只保存在 `publish_batches.preflight` JSONB 中，也不能在生产 V2 门禁通过前启用真实
执行。

## 82. 2026-08-06 第 030 号发布执行状态纳入 V2 门禁

本轮完成第 030 号迁移及其只读发布边界接入，仍未执行生产迁移或启用真实发布：

- `server/cloud/audit-v2-release-readiness.js` 现已冻结迁移 `021–030`，第 030 号迁移校验和为
  `12eee269cceca76d5d76f9eee9f0acaced074bce3c6aa5ffaa2134052a6e9528`。
- V2 数据库对象审计新增 `publish_execution_runs`、`publish_jobs`、`publish_receipts`，
  `publish_jobs_claimable_idx`、`publish_jobs_claim_expiry_idx` 和
  `publish_jobs_platform_identity_idx`。
- V2 数据库对象审计新增 `execution_enabled=false` 与 `authorizes_publishing=false` 两个
  发布关闭约束检查。
- V2 release contract 新增 `server/cloud/publish-execution-repository.js`，固定核对
  `FOR UPDATE OF job SKIP LOCKED`、`result_unknown` 和
  `PUBLISH_REQUEST_CLAIM_TTL_SECONDS`。
- `PostgresPublishBatchRepository.recordExecutionProtocol` 现已在同一事务中把一次性授权协议幂等投影到
  `publish_execution_runs`，并把执行计划中的每个冻结请求投影到 `publish_jobs`；成功后把数据库生成的
  `executionRunId` 回写到批次预检快照。
- 投影只保存授权指纹、候选指纹、请求键、分类和数量摘要，不保存完整 SHEIN 请求报文、图片 URL、密钥或
  签名；重试通过 `tenant_id + store_id + request_key` 幂等，并对冲突记录做指纹一致性校验。
- 因控制服务导入了第 030 号仓储，`deploy/postgres/runtime-role-capabilities.md` 和
  `deploy/postgres/audit-runtime-capabilities.sql` 已按生成器同步，新增三张发布状态表的最小运行时权限。
- `deploy/v2-release-readiness.md` 的维护顺序已加入第 030 号专属预检、迁移和验证；030 必须在
  021–029 之后，且门禁通过不等于迁移授权或真实发品授权。
- V2 readiness 测试临时 release 已包含第 030 号迁移和 PostgreSQL 原子领取仓储契约，并覆盖第 030
  迁移缺失、对象和发布关闭约束审计。
- 本轮 `npm test` 为 `605/605` 通过，`node --test server/cloud/audit-v2-release-readiness.test.js`
  为 `6/6` 通过，`node --test server/cloud/publish-execution-repository.test.js server/cloud/migrate.test.js`
  为 `22/22` 通过；`npm run build:v2` 与 `npm run build:web` 均通过。V2 主 chunk 仍为
  `745.32 kB`（gzip `215.08 kB`），只有既有体积警告。

本轮下一步是实现 Webhook 和商品文档状态查询对 `publish_jobs`、`publish_receipts` 的关联投影，再实现
SPU/SKC/SKU 关系回读与 1630/1631、GCC、产品标识符的合规复验；这些工作继续保持真实 SHEIN 写接口
关闭，不能直接调用 `/open-api/goods/product/publishOrEdit`。

## 83. 2026-08-06 商品接收/审核通知回执投影

本轮完成第 030 号状态机的第一段外部回读闭环，仍未执行生产迁移、部署或真实发品：

- `server/cloud/webhook-production-projections.js` 新增
  `/product_document_receive_status_notice` 解析，按 `document_details[]` 生成规范化接收回执；
  已支持官方 `data` 为对象、数组或 JSON 字符串。
- 商品审核通知继续严格按官方 `audit_state` 映射为 `pending`、`passed`、`failed`、`withdrawn`，
  并保留 `document_sn`、`version`、`spu_name`、`skc_name`、`sku_code` 和失败原因。
- 执行计划摘要新增脱敏的 SPU、SKC、SKU、商家 SKU 标识，用于回执关联；不保存完整请求报文、图片 URL、
  密钥或签名。
- `PostgresPublishExecutionRepository.appendWebhookReceipts` 按租户、店铺和
  `document_sn/version/SPU/SKC/SKU` 摘要匹配任务。唯一匹配才追加 `publish_receipts`；没有匹配或存在
  多个候选时只记录未匹配/歧义统计，不猜测任务归属。
- `publish_receipts` 通过 `webhook_event_id + 记录序号` 形成事件内幂等键；`result_unknown` 只恢复为
  `submitted`，不会因一条通知直接标记完成。
- Webhook Worker 已注入 `PostgresPublishExecutionRepository`，测试事件仍不触发数据库发布回执写入。
- V2 readiness contract 已新增 Webhook Worker 和 `appendWebhookReceipts` 检查。

本轮验证：

- `npm test`：`610/610` 通过。
- Webhook、回执仓储和 V2 门禁定向测试：`26/26` 通过。
- `npm run build:v2`、`npm run build:web`：均通过；V2 主 chunk 仍为 `745.32 kB`，
  gzip 为 `215.08 kB`，只有既有体积提示。

下一步是实现只读 `/open-api/goods/query-document-state` 补偿查询的字段规范化和回执投影，然后在审核通过
后按 `/open-api/goods/spu-info` 回读 SPU/SKC/SKU 关系，最后重新执行 1630/1631、GCC 和产品标识符复验。
真实 SHEIN 写接口和生图模块继续保持关闭/冻结。

## 84. 2026-08-06 商品文档状态查询补偿回执

本轮完成只读 `/open-api/goods/query-document-state` 的第一版字段适配，仍未执行生产迁移、部署或真实发品：

- 新增 `server/cloud/document-state-projections.js`，按交接字段规范化
  `spu_name`、`skc_name`、`sku_list[].sku_code`、`document_sn`、`version`、
  `audit_time`、`audit_state` 和 `failed_reason`；支持 `info/data` 对象、数组及 JSON 字符串包装。
- 查询请求只提交官方版本关联字段 `{ "version": "..." }`，服务端先验证当前租户店铺凭证，再调用
  `/open-api/goods/query-document-state`；新增网页只读入口：
  `POST /v1/web/stores/:storeId/publish/document-state`。
- 查询版本会回填到缺少 `version` 的响应记录，审核状态严格映射为
  `pending`、`passed`、`failed`、`withdrawn`；未知状态、非法结构或无任何可追踪标识时失败关闭。
- `PostgresPublishExecutionRepository.appendDocumentStateReceipts` 复用 Webhook 的
  `tenant_id + store_id + document_sn/version/SPU/SKC/SKU` 唯一匹配、租户隔离和歧义不猜测规则。
  查询回执不伪造 `webhook_event_id`，使用规范化内容指纹生成确定性幂等键。
- `document_state` 回执只会把 `result_unknown` 恢复为 `submitted`，不会直接标记任务完成；
  仍需审核通过后的 `/open-api/goods/spu-info` 关系回读以及 1630/1631、GCC、产品标识符复验。
- V2 readiness contract 已新增商品文档状态规范化和补偿回执适配检查；生图模块继续冻结，
  `/open-api/goods/product/publishOrEdit` 继续禁止调用。

本轮验证：

- `npm test`：`616/616` 通过。
- 商品文档状态、网页只读服务、回执仓储和 V2 门禁定向测试：`32/32` 通过。
- `npm run build:v2`、`npm run build:web`：均通过；V2 主 chunk 仍为 `745.32 kB`，
  gzip 为 `215.08 kB`，只有既有体积提示。

下一步是实现审核通过后的只读 `/open-api/goods/spu-info` 关系规范化和回读状态投影；完成后再接入
1630/1631、GCC、产品标识符的合规复验闭环。

## 85. 2026-08-06 审核通过后的 SPU/SKC/SKU 关系回读

本轮完成审核通过后的只读 `/open-api/goods/spu-info` 关系回读，仍未执行生产迁移、部署或真实发品：

- 新增 `server/cloud/spu-readback-projections.js`，只保留官方关系字段：
  `spuName`、`categoryId`、`productTypeId`、SPU/SKC 商家货号、`skcName`、
  `skuCode` 和 `supplierSku`；图片、价格、成本价等无关字段不会进入回读投影。
- `spu-info` 请求严格使用官方字段：
  `{ "languageList": ["zh-cn", "en"], "spuName": "..." }`。
  本地 `version` 只用于关联发布任务，不发送给 SHEIN。
- 新增网页只读入口：
  `POST /v1/web/stores/:storeId/publish/spu-info`，调用前必须在当前租户和店铺内唯一匹配
  `version + spuName`，且 `publish_receipts` 已存在 `audited` 或 `document_state` 的
  `passed` 回执；无审核通过、跨租户、无匹配或多匹配均不会调用 SHEIN。
- `PostgresPublishExecutionRepository.appendSpuReadbackReceipt` 使用关系内容指纹生成幂等键，
  只写入 `readback` 类型回执，并在 `publish_jobs.readback` 保存脱敏的完成摘要；
  不会把任务直接标记为完成，后续仍需合规复验。
- 回读响应必须返回请求对应的 SPU，且每个 SKC必须存在完整 SKU关系；缺失或编码不一致时失败关闭。
- V2 readiness contract 已新增 SPU 回读规范化检查；生图模块继续冻结，
  `/open-api/goods/product/publishOrEdit` 继续禁止调用。

本轮验证：

- `npm test`：`624/624` 通过。
- SPU 字段规范化、审核门禁、租户隔离、路由、回执幂等和 V2 门禁定向测试：`73/73` 通过。
- `npm run build:v2`、`npm run build:web`：均通过；V2 主 chunk 仍为 `745.32 kB`，
  gzip 为 `215.08 kB`，只有既有体积提示。

下一步是把已回读的 SKC 关系接入 1630/1631、GCC、产品标识符的合规复验；其中 GCC 和产品标识符仍保留
API 不可写的人工资料边界。

## 86. 2026-08-06 已回读 SKC 的合规复验闭环

本轮完成审核通过后的服务端合规复验闭环，仍未执行生产迁移、部署或真实发品：

- 新增 `server/cloud/compliance-revalidation-projections.js`，以服务端保存的商品草稿商品属性为唯一
  1630/1631 判定来源；每个已回读 SKC 都重新计算最长边、面积和报告类型，不信任旧的 `reportType`。
- 复验要求已回读的 SPU/SKC/SKU 关系、当前租户/店铺的合规要求快照和商品草稿必须同时存在；缺少
  SKC、属性、要求覆盖、快照或材料时失败关闭。
- 1630/1631 报告材料按重新判定的报告类型匹配合规模板中的对应材料；不能用 1631 旧材料覆盖重新判定的
  1630，也不能用浏览器传入的结果绕过服务端复验。
- GCC 和产品标识符仅按当前 SHEIN 合规要求快照的官方读取状态判断。投影明确保留
  `editable=false`、`writeStatus=unsupported_by_official_api`、无写入 endpoint/字段；API 不支持写入
  不会被显示为“已写入成功”。
- `PostgresPublishExecutionRepository.getComplianceRevalidationSource` 只读取当前租户/店铺任务关联的
  商品草稿、通过的 SPU 回读回执和最新合规要求快照；`appendComplianceRevalidationReceipt` 以内容指纹
  幂等写入 `publish_receipts.receipt_type='compliance'`，并在复验通过时才将 `publish_jobs` 推进
  `completed`。合规失败仅保存失败回执，不推进完成状态。
- 新增只读网页入口：
  `POST /v1/web/stores/:storeId/publish/compliance-revalidation`，请求接收 `spuName` 和 `version`；
  服务端按租户、店铺、SPU 名称和 version 自动解析唯一的已审核通过回读任务，
  不接受浏览器直接指定内部 `jobId` 作为新入口；V2 API 客户端已预留
  `revalidatePublishCompliance`。
- 第 030 号迁移已包含 `publish_receipts` 的 `compliance` 类型，无需新增数据库迁移；V2 readiness contract
  已加入复验投影、仓储、控制路由和客户端方法检查。

本轮验证：

- 合规复验、回执仓储和网页服务定向测试：`35/35` 通过。
- 全量 `npm test`：`632/632` 通过。
- `npm run build:v2` 和 `npm run build:web`：均通过；V2 主 chunk 约 `745.47 kB`（gzip `215.10 kB`），
  只有既有的 500 kB 体积提示。
- 运行时数据库能力矩阵已按新的只读导入图重新生成；没有修改权限、迁移或生产数据库。

下一步应把复验按钮接到发布中心的只读回读工作流，并在界面上明确展示每个 SKC 的 1630/1631 判定、
GCC/产品标识符官方状态和阻断原因。

本轮没有访问或修改生产环境、执行数据库迁移、调用 SHEIN 写接口、调用
`/open-api/goods/product/publishOrEdit`、上传生产图片或恢复生图模块。

## 87. 2026-08-06 发布中心接入只读合规复验

本轮完成发布中心的合规复验界面，仍未执行生产迁移、部署或真实发品：

- `src-v2/features/publishing/PublishBatchesPage.tsx` 在确认后的执行计划下新增
  `SKC 合规复验` 面板，要求输入真实回执中的 SPU 名称和 `version` 后调用服务端复验接口；
  服务端自动解析唯一的已审核通过回读任务。
- 页面明确提示当前真实执行关闭、需要等待平台回执；不会根据草稿预判或浏览器输入直接显示复验通过。
- 复验结果按 SKC 展示：
  - 1630/1631、最长边和面积；
  - GCC 官方读取状态；
  - 产品标识符官方读取状态；
  - 每个 SKC 的通过/阻断状态和阻断原因。
- `src-v2/lib/api.ts` 新增 `revalidatePublishCompliance` 类型化客户端方法。
- 未修改生图页面、未新增 SHEIN 写接口、未调用 `publishOrEdit`。

本轮验证：

- V2 发布中心 UI 契约测试：`7/7` 通过。
- 全量 `npm test`：`633/633` 通过。
- `npm run build:v2`：通过；V2 主 chunk 约 `749.62 kB`（gzip `216.02 kB`），只有既有的 500 kB 体积提示。
- 下一步应在真实回执链路可用后，用平台返回的 SPU 名称和 `version` 做一次只读联调，
  再决定是否增加批量复验入口。

## 88. 2026-08-07 发布中心接入商品文档状态与关系回读

本轮继续保持真实发布关闭、生图模块冻结和 SHEIN 写接口禁用，完成发布中心只读回读顺序：

- `src-v2/lib/api.ts` 新增商品文档状态查询和 SPU 关系回读的类型化客户端方法，
  分别调用现有的 `/publish/document-state` 与 `/publish/spu-info` 网页只读入口。
- `src-v2/features/publishing/PublishBatchesPage.tsx` 新增“平台回执回读”区域：
  - 先按 `version` 查询商品文档状态；
  - 仅发现审核通过记录后开放 SPU/SKC/SKU 关系回读；
  - 展示商品文档号、SPU、SKC、平台 SKU 和商家 SKU；
  - 关系回读成功后才开放 SKC 合规复验，避免跳过审核和关系回读门禁。
- 合规复验区不再重复填写 SPU/version，只显示已回读标识并执行服务端复验。
- 未新增 SHEIN 写接口、未调用 `publishOrEdit`、未恢复生图模块。

本轮验证：

- 发布中心、网页服务和控制路由定向测试：`63/63` 通过。
- `npm run build:v2`：通过；V2 主 chunk 约 `754.81 kB`（gzip `216.87 kB`），只有既有体积提示。

下一步是在真实回执链路可用后，用平台返回的 version 做一次只读联调，再评估批量回读和批量合规复验入口。

## 89. 2026-08-07 发布中心加入批量只读回读队列

本轮仍保持真实发布关闭、生图模块冻结和 SHEIN 写接口禁用：

- `PublishBatchesPage.tsx` 新增按 SPU/version 排队的“批量回读与合规复验”区域。
- 队列逐条执行现有三个只读接口：
  1. `/publish/document-state` 查询商品文档状态；
  2. 审核通过后调用 `/publish/spu-info` 回读 SPU/SKC/SKU；
  3. 关系回读成功后调用合规复验接口。
- 单条失败只记录当前记录的阻断原因，不中断其他记录；已通过记录不会被批处理重复执行。
- 页面展示每条记录的处理状态、关系摘要、合规阻断数量，并允许移除队列项。
- 未新增 SHEIN 写接口、未调用 `publishOrEdit`、未执行生产迁移或部署。

本轮验证：

- V2 发布中心 UI 契约测试新增批量队列约束。
- 下一步应在真实平台回执可用后，用多条真实 SPU/version 做只读联调，确认批量顺序和逐条失败隔离。

## 90. 2026-08-07 发布批次回读状态持久化读取

本轮完成批量回读状态的服务端只读投影：

- 新增 `GET /v1/web/stores/:storeId/publish-batches/:batchId/readback-status`。
- 服务端按租户、店铺和批次隔离读取 `publish_jobs` 与 `publish_receipts`。
- 仅返回：
  - SPU、version、商品文档号；
  - 商品文档状态；
  - SPU/SKC/SKU 关系回读状态和数量摘要；
  - 合规复验状态和阻断数量。
- 不返回回执原始 payload、图片、密钥或完整平台报文。
- 发布中心展示“已保存的平台回读状态”，页面刷新后可重新读取服务端摘要。
- 商品文档状态查询、SPU 关系回读、合规复验和批量回读完成后会自动刷新该摘要；
  用户也可以在标题旁手动刷新，不会触发 SHEIN 写接口。
- 演示服务提供空的只读投影，不伪造真实平台回执。

本轮验证：

- Readiness：`6/6` 通过。
- 全量 `npm test`：`636/636` 通过。
- `npm run build:v2`、`npm run build:web`：均通过；V2 主 chunk 约 `761.06 kB`（gzip `218.19 kB`），
  只有既有体积提示。
- 未执行生产迁移、部署或 SHEIN 写接口调用。

## 91. 2026-08-07 只读回执字段契约联调基线

本轮开始真实平台只读联调准备，但没有连接生产店铺：

- 按官方 `spu-info` 样例固化 `spuName`、`skcInfoList`、`skuInfoList`、
  `skuCode` 和 `supplierSku` 的关系回读契约。
- 按商品审核通知字段固化 `spu_name`、`skc_name`、`sku_list`、`document_sn`、
  `version`、`audit_state` 和 `failed_reason` 的只读投影契约。
- 价格、成本、重量、销售属性和图片等 SPU 详情字段不进入发布关系回读投影，
  避免把非本轮关联字段误当成平台标识。
- 审核失败原因保留语言和内容，供页面显示真实阻断原因。

本轮仍未调用 SHEIN 业务写接口、未执行生产迁移或部署。真实店铺联调需要授权店铺返回的
`version`、SPU 名称和对应只读权限；在此之前只能通过官方字段样例和本地适配器测试验收。

本轮验证：

- 回读解析器与网页只读服务定向测试：`24/24` 通过。
- 全量 `npm test`：`637/637` 通过。

## 92. 2026-08-07 发布中心引用已保存回读标识

本轮继续保持真实平台读接口可用、业务写接口关闭：

- 发布中心的服务端回读状态表新增“引用回读”操作。
- 只有同时存在真实 `SPU` 和 `version` 的记录可以引用；缺少任一标识时按钮保持关闭。
- 引用只填充当前店铺、当前批次的查询表单，并清空旧的商品文档、关系和合规结果；
  用户确认后才发起只读查询，不会因为点击引用而自动请求 SHEIN。
- 交接文档、UI 契约测试和页面反馈均已同步。

## 93. 2026-08-07 授权不可用时的本地字段演示

当前演示环境没有接入真实 SHEIN 授权服务，`POST /v1/web/shein/auth/start` 会明确返回
`SHEIN_AUTHORIZATION_UNAVAILABLE`，因此不能拿到真实店铺的 `version` 和 SPU 做只读联调。
本轮没有绕过授权，也没有把演示店铺伪装成真实 SHEIN 店铺。

为继续验收发布中心界面，新增了纯前端、严格隔离的本地字段演示：

- `src-v2/lib/local-publish-readback-demo.js` 提供明显的 `DEMO-SPU-20260807`、
  `DEMO-VERSION-20260807`、`DEMO-SKC-*` 和 `DEMO-SKU-*` fixture。
- 发布中心顶部新增“本地字段演示”入口，完整展示：
  商品文档状态 → SPU/SKC/SKU 关系 → 1630/1631、GCC、产品标识符摘要。
- fixture 包含两个 SKC：`180 × 120 cm / 2.16 ㎡` 判定为 `1631`，超过最长边阈值的
  第二个 SKC 判定为 `1630`，用于验收阈值分支。
- GCC 和产品标识符固定显示为官方 API 不可写的未知状态；本地结果始终阻断，
  不进入服务端回执、合规完成状态或发布批次状态。
- 本地入口不调用 `/v1/web` 只读接口，避免把 fixture 误当成平台状态；真实授权恢复后，
  仍必须使用店铺实际返回的 `version` 和 SPU 执行只读联调。

本轮验证：

- 本地字段 fixture 契约测试通过。
- V2 发布中心 UI 契约测试新增本地演示隔离检查。
- 未执行生产迁移、部署、SHEIN 写接口调用或生图模块修改。

## 94. 2026-08-07 店铺管理页提供本地演示入口

当演示 API 返回 `SHEIN_AUTHORIZATION_UNAVAILABLE` 时，店铺管理页现在会在错误反馈中显示
“进入本地字段演示”按钮，跳转到当前已显示店铺的独立只读联调页。该按钮只在这个明确的演示错误码下出现，
不会把真实环境的其他授权错误改写成本地演示。

本轮仍未绕过授权、未调用 SHEIN 写接口、未伪造真实回执，也未修改生图模块。

## 95. 2026-08-07 新增店铺级只读联调页

为避免真实授权恢复后仍必须先创建和确认发布批次，V2 新增店铺级“只读联调”页面：

- 路由：`/app/operations/:storeId/readback`。
- 侧边栏入口：`只读联调`。
- 输入真实平台返回的 `version` 和 SPU 名称后，按固定顺序执行：
  1. 商品文档状态查询；
  2. 仅在审核通过后回读 SPU/SKC/SKU；
  3. 仅在关系回读完成后执行服务端合规复验。
- 页面只复用既有 `/v1/web` 只读入口，没有新增写接口、没有放宽服务端任务/审核门禁，
  也没有把浏览器结果当成平台回执。

演示环境仍应通过发布中心的“本地字段演示”验收；真实授权恢复后，再在本页录入真实
`version + SPU` 执行只读联调。

## 96. 2026-08-07 只读联调页支持隔离本地验收

当前无法授权时，“只读联调”页新增“加载本地字段演示”按钮：

- 直接复用 `local-publish-readback-demo` fixture，在当前页面展示文档状态、关系回读和合规摘要。
- 本地字段使用 `DEMO-SPU/DEMO-VERSION`，不会请求 `/v1/web`、不会写入服务端，也不会改变任何发布状态。
- 真实联调仍使用页面中的 `version + SPU` 输入框，服务端审核、店铺权限和合规快照门禁保持不变。

## 97. 2026-08-07 本地演示与真实只读 API 增加互斥锁定

只读联调页加载本地 fixture 后会进入本地演示锁定状态：

- 查询商品文档、回读关系和合规复验按钮全部禁用，避免误把 `DEMO-SPU/DEMO-VERSION`
  发到真实只读接口。
- 修改任一标识会退出本地演示并清空演示结果；也可以点击“退出本地字段演示”主动清除。
- 只有退出本地演示后，真实 `version + SPU` 联调按钮才恢复。

## 98. 2026-08-07 只读联调结果补充来源诊断

只读联调页在商品文档状态和 SPU 关系结果下方展示：

- 来源模式：只读回读或本地字段演示；
- 服务端返回的 `traceId` 和耗时；
- 外部写入状态固定显示为“否”。

诊断信息只用于区分平台回读、服务端投影和本地 fixture，不改变业务状态，也不暴露原始平台报文。

## 99. 2026-08-07 只读联调展示官方审核失败原因

商品文档状态表新增“审核原因”列，直接展示投影中的 `failedReasons[].content`：

- 审核通过记录显示 `--`；
- 审核失败时展示 SHEIN 返回的规范化原因，不在浏览器端改写或猜测；
- 本地字段演示的失败原因数组为空，不会制造虚假的平台驳回文案。

## 100. 2026-08-07 明确区分演示店铺与真实授权店铺

演示 API 返回的店铺对象新增 `environment: "demo"`：

- 顶部状态显示“演示环境”，不再显示“授权正常”；
- 店铺切换器显示“演示环境 · 未接入 SHEIN”；
- 店铺管理页状态显示“演示环境”；
- 真实生产店铺仍按 `status` 显示授权正常、需要处理或禁用。

该字段只用于界面标识，不改变店铺权限、授权数据或 SHEIN API 请求。

## 101. 2026-08-07 店铺管理页持续提示演示授权边界

店铺管理页在发现 `environment: "demo"` 店铺时持续显示演示环境提示，不再要求用户先点击授权
才能知道当前服务边界。提示明确说明：

- 当前不能读取真实店铺的 `version`、SPU 和平台回执；
- 可以进入“只读联调”页加载本地字段演示；
- 真实店铺授权恢复后再执行平台只读联调。

## 102. 2026-08-07 只读联调展示摘要持久化边界

商品文档状态和 SPU 关系结果现在展示持久化状态：

- 真实只读回读返回持久化投影时显示“服务端已保存摘要”；
- 本地字段演示显示“本地未持久化”；
- 没有持久化摘要时显示“未返回持久化摘要”，不猜测保存结果。

该提示只反映服务端返回的投影元数据，不展示原始回执内容，也不改变任务状态。

## 103. 2026-08-07 完成本地浏览器验收

本轮使用本地 V2 页面和演示 API 完成了页面级验收：

- 店铺管理页正确显示“演示环境”，不再显示“授权正常”。
- 点击“进入只读联调”可以进入店铺级只读联调页。
- 加载本地字段演示后，真实商品文档查询、SPU/SKC/SKU 回读和合规复验按钮均保持禁用。
- 本地 fixture 正确展示商品文档状态、3 条 SKU 关系，以及 `1631`（最长边 180 cm、面积 2.16 ㎡）和 `1630`（最长边 200 cm、面积 2.4 ㎡）两个分支。
- 退出本地字段演示后，演示标识和结果会清空，真实联调输入恢复可编辑。
- 演示授权按钮返回 `SHEIN_AUTHORIZATION_UNAVAILABLE` 时，页面显示明确失败反馈和本地演示入口，不伪造授权成功。

回归结果：

- `npm test`：644/644 通过。
- `npm run build:v2`：通过。

## 120. 2026-08-07 批量引用接入服务端只读预检

批量合规引用按钮现在按环境选择预检路径：

- 本地演示店铺继续使用本地契约生成预检清单，不伪造远程 SHEIN 返回；
- 真实店铺调用现有网页只读接口
  `POST /v1/web/stores/:storeId/compliance/preflight`；
- 请求只提交选中的 SKC 和已保存模板中的报告、通用实拍图素材；
- 服务端重新读取当前官方合规要求，并返回逐 SKC 的动作、阻断、警告和等待状态；
- 页面展示“服务端只读预检已完成”，但不会自动保存目标 SKC 草稿，也不会调用任何 SHEIN 写接口。

新增前端 API 方法：
`api.preflightCompliance`。

本轮验证：

- 批量引用专项与 UI 契约：`10/10` 通过；
- 全量测试：`658/658` 通过；
- `npm run build:v2`：通过。

## 132. 2026-08-07 类目 schema 覆盖门禁贯通模板与新建商品

本轮将完整类目覆盖门禁贯通到商品属性模板页和新建商品草稿页：

- 商品属性 schema 或发布填写规范任一缺失时，属性模板页不展示可编辑字段；
- 未完成覆盖的属性模板不能保存，统一保存按钮保持禁用；
- 新建商品页在覆盖状态读取失败或未完成时不展示商品属性字段；
- 新建商品草稿把当前类目 schema 未完整同步记录为本地阻断，仍由服务端预检再次复核；
- 不使用其他类目字段替代，不调用 SHEIN 写接口，不改变真实发布开关。

验证结果：

- 属性模板与新建商品 UI 专项：`18/18` 通过；
- 全量测试：`676/676` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：`READY`，Release contracts `10/10`；
- 未部署生产、未执行数据库迁移、未调用 SHEIN 写接口。

## 133. 2026-08-07 候选 release 纳入类目 schema 门禁

本轮加强 V2 候选 release 的静态就绪审计：

- `dist-v2` 必须包含 `schema-coverage` 接口标识；
- 必须包含“全类目 schema 同步”入口；
- 必须包含“当前类目的官方 schema 尚未完整同步”阻断文案；
- 缺少任一标识时，release audit 直接返回 `NOT READY`，不能误判为可切换；
- 部署说明同步更新，静态包检查覆盖类目 schema 门禁；
- 未部署生产、未执行数据库迁移、未调用 SHEIN 写接口。

验证结果：

- release audit 专项：`8/8` 通过；
- 全量测试：`677/677` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：`READY`，Release contracts `10/10`。

## 126. 2026-08-07 合规详情展示 1630/1631 服务端判定证据

为让用户核对 1630/1631 是否确实依据当前类目的 SHEIN 商品属性，合规详情页新增“判定证据”明细：

- 展示服务端从商品属性快照中实际选取的官方属性名称；
- 展示 SHEIN 返回的平台原始值；
- 展示服务端解析后的规范化数值和单位；
- 阻断时仍优先展示阻断原因，不使用不完整证据替代失败状态；
- 不读取 SKU 颜色、尺寸或包装尺寸，也不新增 GCC、产品标识符写入字段。

验证结果：

- 合规详情专项与工作台回归：`34/34` 通过；
- 全量测试：`670/670` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`；
- 未部署生产、未执行数据库迁移、未调用 SHEIN 写接口。

## 127. 2026-08-07 合规详情展示完整商品属性快照

为解决“商品属性不全”的核对问题，合规详情接口和页面现在展示当前 SKC 的全部商品级属性：

- 服务端从已保存的官方 `query-attribute-template` 快照投影全部字段；
- 每个字段展示官方名称、必填/选填状态、当前赋值和官方填写方式；
- 预置值通过快照中的 `valueId` 映射为官方值名称；
- 手工输入值保留为 `customValue`；
- 未知值 ID 显示为官方值 ID，不猜测名称；
- 商品属性仍按官方规则排除了销售属性和 SKU 维度属性。

验证结果：

- 合规详情与工作台专项：`35/35` 通过；
- 全量测试：`671/671` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`；
- 本地 V2 页面：`200`；
- 未部署生产、未执行数据库迁移、未调用 SHEIN 写接口。

## 131. 2026-08-07 覆盖清单支持直达选择末级类目

商品属性模板页的类目覆盖清单现在支持直接选择末级类目：

- 点击类目路径后，复用现有类目选择逻辑加载该类目的官方 schema；
- 同时保留 Category ID、Product Type ID 和完整类目路径；
- 未同步类目被选中后仍显示官方 schema 待同步阻断；
- 不通过覆盖清单复制其他类目的属性，也不绕过末级类目校验。

验证结果：

- 属性模板、覆盖率和演示数据专项：`36/36` 通过；
- 全量测试：`674/674` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`；
- 本地 V2 页面：`200`；
- 未部署生产、未执行数据库迁移、未调用 SHEIN 写接口。

## 130. 2026-08-07 类目覆盖率增加可搜索明细

商品属性模板页现在可以直接核对全部末级类目的同步状态：

- 展示完整类目路径、Category ID 和 Product Type ID；
- 分别展示商品属性 schema、发布规范和总体状态；
- 支持按类目名称、完整路径、Category ID 或 Product Type ID 搜索；
- 列表可滚动查看全部末级类目，空结果明确提示无匹配项；
- 未同步类目只显示“待同步”，不会借用其他类目的属性字段。

验证结果：

- 类目覆盖率、属性模板 UI 和演示数据专项：`36/36` 通过；
- 全量测试：`674/674` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`；
- 本地 V2 页面：`200`；
- 未部署生产、未执行数据库迁移、未调用 SHEIN 写接口。

## 129. 2026-08-07 任务中心区分全类目 schema 同步

同步任务中心现在根据服务端进度中的官方 `scope` 显示准确任务名称：

- `rule_refresh + scope: "all"` 显示为“全类目 schema 同步”；
- 普通 `rule_refresh + scope: "referenced"` 仍显示为“规则刷新”；
- 列表和任务详情使用同一命名逻辑；
- 任务进度和失败原因继续来自服务端安全投影，不读取原始任务载荷。

验证结果：

- 任务中心、同步服务和属性模板专项：`20/20` 通过；
- 全量测试：`673/673` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`；
- 本地 V2 页面：`200`；
- 未部署生产、未执行数据库迁移、未调用 SHEIN 写接口。

## 128. 2026-08-07 全类目 schema 同步进度反馈

“同步全部类目”现在形成完整的只读任务反馈闭环：

- 规则刷新任务进度保留官方范围 `scope: "all"`，与普通引用类目刷新区分；
- 属性模板页创建任务后自动轮询任务详情；
- 页面展示等待中、同步中、已完成、失败和取消状态；
- 展示已处理类目数 / 总类目数，并显示服务端返回的失败原因；
- 同步完成后自动刷新类目覆盖率；
- 提供“查看任务详情”入口，跳转到同步任务中心；
- 演示环境或云端接口未部署时继续明确阻断，不伪造同步完成或属性字段。

验证结果：

- schema 同步、任务服务和属性模板 UI 专项：`26/26` 通过；
- 全量测试：`672/672` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`；
- 本地 V2 页面：`200`；
- 未部署生产、未执行数据库迁移、未调用 SHEIN 写接口。

## 121. 2026-08-07 合规同步补齐官方商品属性快照

本轮核对了真实 SHEIN API 文档和现有云端只读链路，确认：

- 1630/1631 判定所需的商品属性来源是官方
  `POST /open-api/goods/spu-info`；
- 该接口返回 `productAttributeInfoList`，但官方文档明确说明其中可能包含
  `attribute_type=1` 的销售属性，必须结合
  `POST /open-api/goods/query-attribute-template` 返回的官方属性模板，
  只保留 `attribute_type=3/4` 且非 SKU 维度的商品属性；
- 当前此前的合规同步只保存合规规则，没有把 SPU 商品属性回读写入
  `skcs.raw_data`，因此批量合规引用时会出现
  `ATTRIBUTE_SNAPSHOT_REQUIRED`。

本轮实现：

- 新增 `server/cloud/product-attribute-snapshot.js`：
  - 按官方属性模板过滤销售属性和 SKU 维度属性；
  - 将官方 `attributeValueId` 映射为 `valueIds`；
  - 将官方手工输入 `attributeValue` 映射为 `customValue`；
  - 保留已有 `rugReportSources`，不根据属性名称猜测长度、宽度或面积来源；
- 合规只读同步在保存合规规则前按 SPU 回读商品详情，并读取对应官方属性模板；
- 快照写入已有 `skcs.raw_data.attributeSnapshot` JSON 字段，不新增迁移；
- 无 SPU 关联、官方详情缺失、属性模板缺失或读取失败的 SKC 会进入失败集合；
- 1630/1631 报告仍不会从参照 SKC 复制到目标 SKC；
- GCC 和产品标识符仍保持官方 API 不支持写入的人工补充边界；
- 没有调用 SHEIN 写接口，也没有部署生产。

新增专项测试：

- `server/cloud/product-attribute-snapshot.test.js`
- `web-business-service.test.js` 的官方 SPU 属性回读契约；
- `compliance-sync-service.test.js` 的快照保存与单 SKC 失败隔离契约。

## 122. 2026-08-07 批量合规模板逐 SKC 应用与草稿保存

本轮完成“预检后逐 SKC 保存合规草稿”，但仍不触发 SHEIN 写接口：

- 新增真实网页接口：
  `POST /v1/web/stores/:storeId/compliance/templates/:templateId/apply`。
- 浏览器只提交模板 ID 和目标 SKC 列表；服务端从当前账号可见的合规模板中解析模板，
  不信任浏览器直接提交的完整模板资料。
- 服务端逐个目标 SKC 重新读取 SHEIN 当前合规要求和实拍图要求，检查来源覆盖、类目一致性、
  店铺媒体保护状态，并逐个返回 `saved`、`blocked` 或 `failed`。
- 通用商品本体图、商品包装图会按目标 SKC 当前返回的 `labelId + labelGroup` 重新映射，
  不直接复制参照 SKC 的 labelId。
- 参照 SKC 的 1630/1631 报告不会复制到目标 SKC。目标已有的单 SKC 报告保留，
  目标缺少自己的报告时明确阻断，避免把报告错套到其他商品。
- 1630/1631 分支记录以目标 SKC 本次官方合规要求返回为来源，
  不从 SKU 尺寸、包装尺寸或浏览器自报字段推导。
- 欧代商、制造商继续按上品流程自动绑定；GCC、产品标识符继续保持官方 API
  不支持写入的人工补充边界。
- 成功保存的草稿状态仍为 `draft`，预检只记录模板引用复验结果，
  后续上品前仍必须运行现有服务端可执行预检；`externalWrite: false` 固定返回。
- 本地演示环境不伪造批量真实保存按钮，真实模式才调用该接口。

新增测试覆盖：

- 合规工作台批量应用服务：目标图片 label 重映射、报告隔离、目标报告缺失阻断；
- control-server 路由：模板必须服务端解析、店铺权限和可信来源校验；
- V2 合规模板 UI/API 契约。

本轮验证：

- 全量测试：`661/661` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`；
- 未部署生产、未执行数据库迁移、未调用 `product/publishOrEdit` 或其他 SHEIN 写接口。

## 123. 2026-08-07 批量保存后的工作台状态刷新

- 批量合规模板应用成功返回后，V2 页面自动刷新当前店铺合规工作台查询。
- 目标 SKC 的草稿状态、预检状态和列表摘要不再停留在保存前缓存。
- 逐 SKC 保存/阻断/失败反馈保留在当前页面，不因查询刷新被覆盖。

验证：

- V2 合规模板与批量引用专项：`10/10` 通过；
- `npm run build:v2`：通过。

## 124. 2026-08-07 本地批量引用页面验收

- 已确认本地 V2 页面 `http://127.0.0.1:5174/` 可返回 `200`。
- 已确认隔离演示 API `http://127.0.0.1:8790/health` 返回健康状态。
- 演示会话与隔离店铺可正常读取，页面不要求真实云端管理员账号。
- 演示环境中的批量保存按钮保持禁用并提示“真实模式可保存草稿”，
  不伪造 SHEIN 官方要求、保存回执或真实草稿写入。
- 真实模式仍需使用云端账号和已授权店铺，完成逐 SKC 官方复验后才允许调用批量应用接口。

真实授权恢复后，下一步仍是录入平台实际返回的 `version + SPU`，先执行商品文档状态只读查询，再按页面顺序执行关系回读和服务端合规复验；在此之前不应使用演示标识替代平台回执。

## 104. 2026-08-07 只读联调反馈状态改为显式类型

只读联调页不再根据错误文案中的“失败”“阻断”等关键词猜测提示颜色和图标：

- 反馈统一使用 `success` 或 `danger` 状态；
- API 错误统一渲染为红色 `alert`，不受 SHEIN 错误文案措辞影响；
- 商品文档状态已返回但没有审核通过记录时，按阻断反馈处理；
- 成功信息渲染为绿色 `status`，图标与颜色保持一致。

本轮没有新增 SHEIN 字段、没有调用生产写接口、没有修改生图模块。

## 105. 2026-08-07 演示环境禁用授权操作

根据页面验收反馈，演示店铺仍显示可点击的“授权或重新授权”容易造成误解。

现在当店铺列表包含 `environment: "demo"` 时：

- 授权按钮改为“演示环境不可授权”；
- 按钮保持禁用，并说明当前连接的是本地演示 API；
- 真实店铺环境仍显示并保留“授权或重新授权”；
- “进入只读联调”和“进入本地字段演示”继续可用。

当前本地 `.env` 只有 SHEIN 应用凭证，没有云控运行所需的 PostgreSQL、Redis 和
`SHEIN_RUNTIME_MODE=cloud`，因此真实网页授权服务尚未启动。启用真实授权前必须先接入已配置的
云控服务，不得把演示 API 改成伪造授权成功。

## 106. 2026-08-07 V2 API 目标改为可配置

V2 开发服务器不再把 `/v1` 代理目标永久写死：

- 新增非敏感配置 `VITE_V2_API_TARGET`；
- 默认值仍为 `http://127.0.0.1:8790`，继续指向本地演示 API；
- 真实授权前，只有在本地云控服务或受控反向代理已经准备好后，才可将该值切换到对应地址；
- 该配置只改变开发代理目标，不改变浏览器请求字段、SHEIN 签名或业务门禁。

## 107. 2026-08-07 正式网页服务只读连通性验证

本轮没有启动授权或提交任何业务数据，只做了正式网页服务的只读连通性检查：

- `https://api.hanzhou.icu/health` 返回 200；
- 公网 `/ready` 返回 404，符合仅允许服务器内部访问的部署设计；
- `https://app.hanzhou.icu/v1/web/session` 返回未登录 401，说明正式网页会话路由存在；
- Vite `/v1` 代理增加 `changeOrigin: true` 后，独立本地真实模式可稳定代理到正式网页域名；
- 本地真实模式已确认可以打开登录入口，授权仍需先用有效工作室账号登录。

本地端口边界：

- `5174`：默认演示环境，保持安全隔离；
- `5176`：本轮独立真实网页代理验收端口，不应在未登录前执行授权。

## 108. 2026-08-07 真实网页登录入口与账号边界

页面验收确认：

- 云控允许的本地来源是 `http://127.0.0.1:5173`，不是 `5176`；
- 真实模式使用 `VITE_V2_API_TARGET=https://app.hanzhou.icu` 并运行在 `5173` 时，
  `/v1/web/session` 正常返回未登录 401，不再返回 `ORIGIN_NOT_ALLOWED`；
- 系统没有自助注册入口，网页账号由工作室管理员在云端预置或邀请；
- 未登录前不得调用 SHEIN 授权 start，也不得把登录密码发送到聊天或代码仓库。

## 109. 2026-08-07 恢复默认开发入口为本地演示

为避免没有云端工作室账号时无法继续开发：

- `http://127.0.0.1:5173/` 恢复为默认本地演示 V2 页面；
- 该入口使用本地演示会话，不要求管理员账号；
- 真实网页登录模式只通过显式设置
  `VITE_V2_API_TARGET=https://app.hanzhou.icu` 启动；
- 云端账号仍由管理员预置或邀请，不能从演示账号推导真实管理员身份。

## 110. 2026-08-07 类目属性缓存缺失的页面反馈

商品属性模板页在已选择末级类目、但当前类目没有官方 schema 缓存时，新增明确的类目级阻断面板：

- 展示完整类目路径、Category ID 和 Product Type ID；
- 明确提示需要先同步 SHEIN schema 或更换已同步类目；
- 提供“更换类目”操作；
- 明确声明系统不会猜测或补造商品属性；
- 不修改官方类目树，不把其他类目的属性复制到当前类目。

当前本地官方 schema 快照只包含装饰地毯 `Category 3155 / Product Type 991` 的属性记录；
截图中的被套套装 `Category 1941 / Product Type 199` 没有属性缓存，因此继续阻断是符合字段门禁的。

## 111. 2026-08-07 全部末级类目 schema 覆盖与同步入口

本轮修复“类目树完整，但页面只有地毯属性”的误导性体验：

- 新增只读覆盖接口：`GET /v1/web/stores/:storeId/publish/schema-coverage`。
- 覆盖率按完整 SHEIN 类目树的每个末级类目统计：
  `category_id + product_type_id` 对应的商品属性模板，以及
  `category_id` 对应的发布填写规范。
- 本地官方快照实际包含 `2547` 个末级类目；当前快照只有
  `Category 3155 / Product Type 991` 已缓存，因此页面显示 `1 / 2547`，
  其余类目显示“待同步”，不会复制地毯属性。
- 商品属性模板页新增“同步全部类目”入口：
  `POST /v1/web/stores/:storeId/publish/schema-sync`。
  真实环境走只读规则刷新任务，任务范围为 `all`，按 SHEIN 类目树缓存每个末级类目的动态 schema；
  不调用 `product/publishOrEdit`，不执行任何 SHEIN 写接口。
- 既有 `POST /v1/web/stores/:storeId/rules/refresh` 默认仍只刷新草稿和模板引用的规则；
  全量入口单独使用 `schema-sync`，避免改变旧任务语义。
- 演示环境的全量入口明确返回
  `DEMO_SCHEMA_SYNC_UNAVAILABLE`，因为没有真实授权，不能伪造其他类目的官方属性。

验证结果：

- `npm test`：650/650 通过。
- `npm run build:v2`：通过。

## 125. 2026-08-07 合规详情展示商品属性快照与报告判定

合规详情页补充当前 SKC 的官方商品属性快照明细，帮助用户确认 1630/1631 的判定来源：

- 展示快照是否已回读、获取时间、商品属性字段数量和当前已赋值数量；
- 展示属性来源配置状态和服务端判定的报告类型；
- 判定完成时展示最长边、面积和“当前商品属性”依据；
- 快照缺失、来源未配置或尺寸无法解析时，展示逐条阻断原因；
- 不读取 SKU 颜色、尺寸、包装尺寸，也不从其他 SKC 复制报告；
- GCC、产品标识符继续保留官方 API 不支持写入的人工补充边界。

本轮验证：

- 全量测试：`669/669` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`；
- 未部署生产、未执行数据库迁移、未调用 SHEIN 写接口。
- 本地浏览器已验证四级类目
  `家用纺织品 / 床品 / 被套&套装 / 被套套装`
  能正确显示 `Category 1941 / Product Type 199`，并显示该类目自己的 schema 待同步状态。

## 112. 2026-08-07 本地 V2 真实 API 启动方式

本地演示 V2 与正式旧网页不是同一个数据源：

- 默认 `npm run dev:v2` 继续连接隔离演示 API `http://127.0.0.1:8790`。
- 新增 `npm run dev:v2:real`，本地 V2 通过
  `VITE_V2_API_TARGET=https://app.hanzhou.icu` 连接正式云端 API。
- 真实模式仍在本地页面运行，使用同一个云端登录账号；登录成功后才会读取云端已经授权的 SHEIN 店铺。
- 不把演示店铺、演示会话或本地 schema 快照写入正式云端。
- Vite 配置现在支持命令行 `VITE_V2_API_TARGET` 覆盖默认演示目标，避免因旧进程或默认端口误连演示服务。

## 113. 2026-08-07 本地属性模板区分云端版本缺口

本轮没有部署生产，也没有切换 release。只针对真实模式下“服务暂不可用 / 接口不存在”的反馈做了本地页面修正：

- 已确认当前云端活动 release `/opt/shein-console/releases/20260803-publish-ui-v2`
  的 `control-server.js` 没有 `schema-coverage` 路由，服务器上其他历史 release 也没有该路由。
- 本地 V2 商品属性模板页现在识别 `404 + NOT_FOUND`，显示“云端后端尚未同步新版属性接口”，
  不再把后端版本缺口误报成类目 schema 缓存缺失。
- 当新版属性接口明确不存在时，“同步全部类目”按钮保持禁用；系统不猜测字段、不复制其他类目属性，
  也不因此调用任何 SHEIN 写接口。
- `SHEIN_CLOUD_ALLOWED_ORIGINS` 已在云端增加 `http://127.0.0.1:5173` 和
  `http://localhost:5173`，仅解决本地真实模式登录来源校验，不代表 V2 后端已经部署完成。

验证结果：

- `npm test`：651/651 通过。
- `npm run build:v2`：通过。
- 后续应先完成本地 V2 后端候选 release、只读就绪门禁和必要迁移评审，再统一部署；
  在此之前使用本地演示环境继续开发，不切换生产 release。

## 114. 2026-08-07 类目 schema 控制服务路由契约

为防止本地 V2 前端与云端 control 服务再次出现接口版本错位，新增控制服务专项测试：

- `GET /v1/web/stores/:storeId/publish/schema-coverage` 必须经过当前网页登录会话和店铺权限，
  只返回当前店铺的末级类目覆盖摘要。
- `POST /v1/web/stores/:storeId/publish/schema-sync` 必须经过可信网页来源和店铺权限，
  并固定以 `scope: "all"` 创建只读规则刷新任务。
- 测试不调用 SHEIN、不连接生产数据库、不创建真实同步任务；只验证 HTTP 路由、权限边界和参数契约。

验证结果：

- 控制服务专项测试：`39/39` 通过。
- V2 属性模板 UI 测试：`14/14` 通过。
- 全量 `npm test`：`652/652` 通过。
- `npm run build:v2`：通过。

## 115. 2026-08-07 增加本地 V2 release 静态预检

为支持“开发未完成前不部署生产”的工作方式，新增不连接数据库的候选 release 检查：

- 新命令：`npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`。
- `--static-only` 只读取候选 release 文件、迁移校验和 `dist-v2` 构建产物；
  不读取 `.env`，不连接 PostgreSQL/Redis，不调用 SHEIN。
- release contract 新增检查 `schema-coverage`、`schema-sync` 两条类目 schema 路由，
  防止云端后端漏带本地 V2 页面依赖的接口。
- 同时修正回读页面 marker，使用实际存在的“平台回执回读”文案，避免预检因旧文字误报阻断。

本地候选结果：

- `V2 release artifact readiness: READY`
- Release contracts：`10/10`
- 迁移文件校验：`10/10`
- V2 web artifact：通过
- `npm test`：`653/653` 通过
- `npm run build:v2`：通过

完整数据库门禁仍需在未来候选 release 和受控数据库维护窗口中执行；当前不部署生产。

## 116. 2026-08-07 本地数据库与开发端口边界

本轮检查确认：

- 当前开发机没有 Docker、PostgreSQL，也没有配置本地 `DATABASE_URL`、
  `SHEIN_MIGRATION_DATABASE_URL` 或 `SHEIN_RUNTIME_DATABASE_URL`；
  因此没有执行数据库门禁，也没有用云端数据库代替本地演练。
- `vite.config.js` 已启用 `strictPort: true`。V2 端口被占用时会直接失败，
  不再自动跳到 `5175`、`5176` 等端口，避免真实模式与演示模式误连。
- 默认演示 V2 仍使用 `5174`，真实模式仍显式使用 `5173`；
  两者数据源和授权边界保持隔离。

本轮只修改本地开发工具配置，未部署生产、未执行迁移、未调用 SHEIN 写接口。

## 117. 2026-08-07 一键启动本地 V2 演示环境

为减少本地验收时需要分别启动 API 和网页服务的操作，新增：

- `npm run dev:v2:local`
- 演示 API：`http://127.0.0.1:8790`
- V2 页面：`http://127.0.0.1:5174`

启动器只负责拉起现有的 `web-demo-server.js` 和 Vite V2 页面；任一子进程退出
时会清理另一个子进程，收到 `Ctrl+C` 或终止信号时也会一起退出。

该入口仍然使用隔离演示数据，不提供真实 SHEIN 授权，不调用 SHEIN 写接口，也不会切换云端 release。

## 118. 2026-08-07 固化本地 V2 启动验收

为避免本地开发入口再次出现端口错配或子进程未清理，新增
`server/dev-v2.test.js`，固定检查：

- `dev:v2:local` 仍指向统一启动器；
- 演示 API 使用 `8790`，V2 页面使用 `5174`；
- Vite 使用 `v2` 模式；
- 启动器收到信号、子进程错误或退出时都会清理另一子进程。

该测试只检查本地启动契约，不连接数据库、不调用 SHEIN，也不改变真实发布门禁。

## 119. 2026-08-07 批量合规引用预检清单

店铺合规素材方案页新增“在售商品批量引用”预检操作：

- 可以勾选在售 SKC，或一键全选当前缓存中的在售商品；
- 预检逐条检查模板类目是否匹配、合规规则快照是否有效、合规来源覆盖是否完整；
- 类目不一致、规则过期或来源不完整的 SKC 会明确列为阻断；
- 基础门禁通过的 SKC 只进入“待 SKC 复验”，不会被标记为已合规；
- 1630/1631 仍必须根据目标 SKC 的商品级属性重新判断，GCC 和产品标识符仍按官方能力边界进入人工补充队列；
- 当前操作只生成本地预检清单，不保存目标 SKC 草稿、不调用 SHEIN 写接口。

新增契约和测试：
`src-v2/lib/compliance-template-reuse-contract.js`、
`src-v2/lib/compliance-template-reuse-contract.test.js`。

本轮验证：

- 批量引用专项与 UI 契约：`10/10` 通过；
- 全量测试：`658/658` 通过；
- `npm run build:v2`：通过。

## 134. 2026-08-07 全量类目 schema 同步的部分失败语义

本轮继续完善“同步全部末级类目”的任务行为，未部署生产、未执行数据库迁移、未调用 SHEIN 写接口：

- 单个末级类目的官方 schema 只读请求失败时，任务会继续处理剩余类目；
- `processed / succeeded / failed` 会在每个类目完成或失败后更新；
- 只要存在失败类目，任务最终明确标记为 `failed`，错误码为 `RULE_REFRESH_PARTIAL`，
  不会误报为全部成功；
- 失败任务会把最终进度写入 `sync_jobs.progress`；
- 属性模板页在任务 `succeeded` 或 `failed` 后都会重新读取类目覆盖率，
  页面状态不会停留在旧缓存。

新增失败回归测试：
`server/cloud/rule-refresh-service.test.js`。

本轮验证：

- 规则刷新与属性模板专项：`26/26` 通过；
- 全量测试：`678/678` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断。

## 139. 2026-08-07 展示全量 schema 同步失败类目明细

本轮补齐部分失败任务的诊断信息：

- 失败任务进度安全保存 `categoryId / productTypeId`；
- 公开任务投影最多返回前 500 个失败目标，不返回原始 SHEIN 错误载荷；
- 任务中心展示失败类目数量和对应的 Category / Product Type；
- 不新增数据库表、不执行迁移、不改变重试策略、不调用 SHEIN 写接口。

本轮验证：

- 规则刷新、任务投影和任务中心专项：`15/15` 通过；
- TypeScript 检查：通过；
- 全量测试：`680/680` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断。

## 138. 2026-08-07 去重全量类目 schema 目标

本轮修复全量类目同步的重复目标问题：

- 按 `category_id + product_type_id` 组成稳定目标键；
- 同一官方目标只调用一次 `getPublishSchema`；
- 保留官方类目树首次出现的顺序；
- `total`、处理进度和失败数量均按去重后的目标计算；
- `referenced` 范围继续使用数据库已有的 `DISTINCT` 结果。

本轮验证：

- 规则刷新专项：`10/10` 通过；
- 全量测试：`680/680` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断。

## 135. 2026-08-07 修复类目同步部分失败的重复落库

本轮发现并修复了全量类目 schema 部分失败路径的重复失败写入：

- 单个类目失败后继续处理其他类目；
- 循环结束抛出 `RULE_REFRESH_PARTIAL` 后，只由统一异常出口写入一次失败任务；
- 最终 `progress` 仍保存 `processed / succeeded / failed`；
- 新增回归断言，确保同一任务不会重复调用 `saveFailure`。

本轮验证：

- 规则刷新专项：`8/8` 通过；
- 全量测试：`678/678` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断。

## 136. 2026-08-07 固化类目同步失败进度仓储契约

本轮补充规则刷新仓储层回归测试：

- 失败任务保存最终 `scope / total / processed / succeeded / failed` 进度；
- 错误只保留公开 `code` 和 `message`；
- 额外字段不会写入 `sync_jobs.error`；
- 保持失败任务的租户、店铺和任务 ID 条件不变。

验证结果：

- 规则刷新专项：`9/9` 通过；
- 全量测试：`679/679` 通过；
- V2 构建和 release 静态门禁上一轮已通过，当前未修改生产代码。

## 137. 2026-08-07 修正全量类目同步进度总数

本轮修正同步进度统计：

- “读取类目树”不再被计为一个虚假的类目；
- `total` 只统计真实的末级类目 schema 目标；
- `processed / succeeded / failed` 与实际末级类目数量一致；
- 空目标任务显示 `0 / 0`，不再显示 `1 / 1`。

本轮验证：

- 规则刷新专项：`9/9` 通过；
- 全量测试：`679/679` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断。

## 140. 2026-08-07 固化本地演示环境的定向重试边界

本轮补齐任务中心“仅重试失败类目”的本地演示契约：

- 云端真实接口继续使用服务端按历史失败任务生成的目标列表；
- 本地演示环境没有真实失败类目快照，因此不会伪造失败目标或返回虚假的重试成功；
- 调用本地演示定向重试时明确返回 `503 / DEMO_RULE_REFRESH_RETRY_UNAVAILABLE`，
  页面可以展示可理解的服务边界，而不是落入静默 404；
- 未新增数据库表、未执行迁移、未调用 SHEIN 写接口。

本轮验证：

- 本地演示服务专项：`19/19` 通过；
- 全量测试、V2 构建和 release 静态门禁待本轮最终回归确认。

## 141. 2026-08-07 完成本轮本地 V2 回归

补充修复本地演示服务在无 `process.argv[1]` 的导入方式下会崩溃的问题，
启动保护现在允许诊断脚本和测试工具安全导入服务模块。

本轮最终验证：

- 一次性本地 HTTP 请求确认定向重试返回 `503`、
  `DEMO_RULE_REFRESH_RETRY_UNAVAILABLE` 和明确中文提示；
- 全量测试：`687/687` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布仍保持关闭，未执行数据库迁移、生产部署或 SHEIN 写接口；
- 生图模块保持不变。

## 142. 2026-08-08 补齐商品经营的 SKU 定位闭环

本轮继续完善经营中心已定义但尚未接通的两个交互：

- 商品经营列表右侧按钮现在可展开当前 SKC 的可信 SKU 快照；
- SKU 明细展示 SHEIN/缓存返回的 SKU、供应商 SKU、尺寸、销量、实际库存、可售天数和建议备货；
- 经营预警增加“查看商品”入口，跳转到商品经营页并带入对应 SKC 搜索条件；
- SKU 明细只消费现有经营快照，不新增接口、不补造商品或库存数据；
- 无 SKU 快照时明确显示空状态，不伪造行数据。

本轮验证：

- 经营中心专项 UI 测试：`2/2` 通过；
- 全量测试：`689/689` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 143. 2026-08-08 补齐商品经营的库存风险筛选

本轮在商品经营页增加库存风险筛选，仍只消费现有经营快照：

- `库存风险（≤5天）` 只匹配已上架且 `daysOfCover <= 5` 的商品；
- `库存健康（>5天）` 只匹配已上架且 `daysOfCover > 5` 的商品；
- `无可售天数` 只匹配没有 `daysOfCover` 的商品；
- 下架、待上架、已售罄商品不会被强行标记为红绿风险；
- 不新增接口、不补造库存数据、不改变 SHEIN 写接口边界。

本轮验证：

- 商品经营 UI 契约测试通过；
- 全量测试：`690/690` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 144. 2026-08-08 统一销量与库存页的库存风险口径

本轮补齐“销量与库存”页此前已读取但未展示的 `daysOfCover`：

- 商品经营页和销量与库存页统一复用同一库存风险判定；
- 已上架且 `daysOfCover <= 5` 显示红色风险；
- 已上架且 `daysOfCover > 5` 显示绿色健康；
- 缺少可售天数显示中性状态，并可通过“无可售天数”筛选；
- 销量与库存页增加库存风险筛选和可售天数列；
- 不新增接口、不改变经营快照字段、不补造 SHEIN 库存数据。

本轮验证：

- 经营中心专项 UI 测试：`4/4` 通过；
- 全量测试：`691/691` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 145. 2026-08-08 补齐经营预警的商品信息投影

本轮补齐经营约束中预警页应展示、且已经存在于经营快照的商品信息：

- 预警优先使用官方/缓存返回的 `warning.image`，缺少时按同一 `SKC` 关联商品主图；
- 增加商品主图、上架天数、今日销量、7 日销量和 30 日销量；
- 实际库存优先使用预警行库存，缺少时回退到同一商品快照的 `actualInventory`；
- 无法按 `SKC` 找到商品快照时保持 `--`，不猜测字段；
- 不新增接口、不改变预警生成规则、不补造 SHEIN 数据。

本轮验证：

- 经营中心专项 UI 测试：`4/4` 通过；
- 全量测试：`691/691` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 146. 2026-08-08 补齐经营预警优先级筛选

本轮使用经营快照已有的 `BusinessWarning.tone`：

- 预警页增加“全部 / 高 / 中 / 低优先级”筛选；
- 高、中、低优先级分别使用红、黄、绿的状态提示；
- 未知或缺失 tone 显示“优先级待确认”，保持中性，不强行归类；
- 筛选后无结果时明确提示“没有匹配的经营预警”；
- 不新增接口、不改变服务端预警规则、不补造优先级数据。

本轮验证：

- 经营中心专项 UI 测试：`4/4` 通过；
- 全量测试：`691/691` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 147. 2026-08-08 补齐同步任务操作成功反馈

本轮补齐同步任务中心的操作反馈：

- 刷新规则成功后显示任务已创建，并切换到规则刷新列表；
- 刷新合规成功后显示任务已创建，并切换到合规同步列表；
- 失败类目定向重试成功后显示任务已创建，并打开新任务详情；
- 失败提示、轮询和任务状态机保持原有逻辑；
- 不新增接口、不改变任务状态、不调用 SHEIN 写接口。

本轮验证：

- 同步任务中心专项 UI 测试：`1/1` 通过；
- 全量测试：`691/691` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 148. 2026-08-08 修正销量与库存筛选空状态

本轮修正销量与库存页的两种空状态：

- 经营快照没有商品时显示“暂无商品销量数据”及数据边界说明；
- 快照有商品但当前库存风险筛选无命中时显示“没有匹配的商品”；
- 不新增接口、不改变筛选口径、不补造商品或库存数据。

本轮验证：

- 经营中心专项 UI 测试：`4/4` 通过；
- 全量测试：`691/691` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 149. 2026-08-08 修正同步任务筛选空状态

本轮修正任务中心筛选后的空状态：

- 没有任何任务记录时继续显示“暂无同步任务”；
- 选择任务类型或状态后无命中时显示“没有匹配的同步任务”；
- 给出调整筛选条件的明确提示；
- 不新增接口、不改变任务查询和权限边界。

本轮验证：

- 同步任务中心专项 UI 测试：`1/1` 通过；
- 全量测试：`691/691` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 150. 2026-08-08 补齐新建商品的官方末级类目搜索

本轮在新建商品页补齐全类目场景下的末级类目搜索：

- 搜索范围只来自 SHEIN 官方类目接口已归一化的 `leafCategories`；
- 支持按类目名称、完整类目路径、`Category ID` 和 `Product Type ID` 查询；
- 搜索结果复用现有末级类目选择流程，四级类目树仍按原有路径展示；
- 搜索无结果时明确提示，不伪造类目、属性或接口返回；
- 不新增接口、不改变官方属性加载和必填校验边界。

本轮验证：

- 新建商品页 UI 契约测试：`12/12` 通过；
- 全量测试：`691/691` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 151. 2026-08-08 补齐新建商品的必填属性定位反馈

本轮补齐长页面商品草稿保存失败时的可见反馈：

- 保存尝试后，在页面上方显示统一的“保存前检查未通过”提示和阻断项数量；
- 缺失的当前类目必填商品属性显示“定位”入口，点击后滚动到对应属性并聚焦输入控件；
- 属性输入控件增加 `aria-invalid` 和错误描述关联，保留原有红色背景、边框和字段级提示；
- 定位列表只消费现有 `validateAttributeAssignments` 结果，不新增接口、不猜测必填字段。

本轮验证：

- 新建商品页 UI 契约测试：`12/12` 通过；
- 全量测试：`691/691` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 152. 2026-08-08 完善在售商品批量合规引用队列

本轮继续完善合规模板页的批量引用操作：

- 在售 SKC 队列支持按 SKC、类目和 Category ID 搜索；
- 默认展示前 8 个目标，可展开查看当前缓存中的全部目标；
- 显示当前仍在售且已选中的 SKC 数量，数据刷新后自动清理已失效的旧选择；
- 未保存并选中合规模板时，选择和预检入口保持关闭并给出明确提示；
- 仍按每个目标 SKC 独立预检，1630/1631 根据目标商品属性重新判定，不复制参照 SKC 报告；
- 不新增接口、不伪造在售商品、不调用 SHEIN 写接口。

本轮验证：

- 合规模板 UI 契约测试：`7/7` 通过；
- 全量测试：`691/691` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 153. 2026-08-08 防止合规模板切换后沿用旧预检结果

本轮修正批量合规引用的结果一致性：

- 切换合规模板、模板版本或规则快照时间后，清空旧的本地预检清单；
- 同时清空旧的服务端预检结果和保存结果，避免把旧模板状态误显示为新模板状态；
- 保留用户已经选择的在售 SKC，减少重新操作；
- 不新增接口、不改变服务端逐 SKC 复验、不复制合规报告或审核状态。

本轮验证：

- 合规模板 UI 契约测试：`7/7` 通过；
- 全量测试：`691/691` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 154. 2026-08-08 统一属性模板的大型官方值搜索

本轮补齐商品属性模板页与新建商品页的属性值操作一致性：

- 当当前类目的官方多选属性值达到 20 个时，模板页显示属性值搜索框；
- 搜索支持官方值名称和官方值 ID，不改变原始 `field.values`；
- 搜索无结果时明确提示，清空搜索即可恢复全部官方值；
- 保留最大选择数、必填校验和商品级属性边界，不混入颜色、尺寸等销售属性；
- 不新增接口、不补造属性值、不调用 SHEIN 写接口。

本轮验证：

- 属性模板 UI 契约测试：`19/19` 通过；
- 全量测试：`692/692` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 155. 2026-08-08 补齐属性模板必填项定位反馈

本轮统一商品属性模板页与新建商品页的长表单校验体验：

- 保存失败后，在页面上方显示未填写的必填商品属性数量；
- 每个缺失属性提供“定位”入口，点击后滚动到对应字段并聚焦控件；
- 属性输入控件增加 `aria-invalid` 与错误描述关联；
- 保留当前类目动态必填校验、红色高亮和原有字段级提示；
- 不新增接口、不改变官方 schema、不把销售属性混入商品属性。

本轮验证：

- 属性模板 UI 契约测试：`20/20` 通过；
- 全量测试：`693/693` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 156. 2026-08-08 补齐属性模板的官方末级类目搜索

本轮统一属性模板页与新建商品页的类目选择体验：

- 类目选择器增加按名称、完整路径、`Category ID` 和 `Product Type ID` 搜索；
- 搜索结果只来自当前店铺官方类目树归一化后的末级类目，并显示完整层级路径；
- 点击搜索结果复用原有末级类目选择流程，继续读取该类目的官方 schema 和覆盖状态；
- 未输入搜索词时仍保留四级级联选择，四级类目不会被压平替代；
- 搜索无结果时明确提示，不伪造类目、属性或覆盖数据。

本轮验证：

- 属性模板 UI 契约测试：`20/20` 通过；
- 全量测试：`693/693` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 157. 2026-08-08 增加商品属性模板列表搜索

本轮改善模板中心的日常查找：

- 可按模板名称、类目名称、完整类目路径和 `Category ID` 搜索商品属性模板；
- 筛选只改变列表展示，不改变模板归属、编辑权限、版本或保存逻辑；
- 区分“当前没有模板”和“没有匹配的属性模板”，避免把筛选结果误认为数据缺失；
- 不新增接口、不改变官方属性 schema、不混入销售属性。

本轮验证：

- 属性模板 UI 契约测试：`21/21` 通过；
- 全量测试：`694/694` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 158. 2026-08-08 增加颜色与尺寸模板列表搜索

本轮改善颜色与尺寸模板的日常查找：

- 可按模板名称和共享颜色搜索颜色与尺寸模板；
- 筛选只改变列表展示，不改变模板权限、版本、颜色尺寸数据或 SHEIN 销售属性匹配逻辑；
- 区分“当前没有模板”和“没有匹配的颜色与尺寸模板”；
- 不引入商品属性字段、库存、价格或包装字段。

本轮验证：

- 尺寸模板 UI 契约测试：`5/5` 通过；
- 全量测试：`695/695` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 159. 2026-08-08 增加打包体积模板列表搜索

本轮改善打包体积模板的日常查找：

- 可按模板名称和已解析工作簿文件名搜索打包体积模板；
- 筛选只改变列表展示，不改变 `.xlsx` 解析、材质工作表、尺寸匹配或保存校验；
- 区分“当前没有模板”和“没有匹配的打包体积模板”；
- 不引入商品重量、供货价、库存或其他商品字段。

本轮验证：

- 打包体积模板 UI 契约测试：`6/6` 通过；
- 全量测试：`696/696` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 160. 2026-08-08 增加尾部主图模板列表搜索

本轮改善可复用尾部主图模板的日常查找：

- 可按模板名称和账号可见范围搜索尾部主图模板；
- 筛选只改变列表展示，不改变图片上传、浏览器裁剪、素材顺序或追加位置；
- 区分“当前没有模板”和“没有匹配的尾部主图模板”；
- 未修改生图任务、模型、费用、Worker 或真实执行开关。

本轮验证：

- 尾部主图模板 UI 契约测试：`6/6` 通过；
- 全量测试：`697/697` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 161. 2026-08-08 增加合规素材方案列表搜索

本轮改善合规素材方案的日常查找：

- 可按方案名称、类目名称和参照 SKC 搜索合规素材方案；
- 筛选只改变列表展示，不改变合规规则快照、素材证据、模板权限或保存逻辑；
- 区分“当前没有方案”和“没有匹配的合规素材方案”；
- 批量引用仍按目标 SKC 独立预检，1630/1631、GCC、产品标识符边界不变；
- 不新增接口、不复制审核状态、不调用 SHEIN 写接口。

本轮验证：

- 合规模板 UI 契约测试：`8/8` 通过；
- 全量测试：`698/698` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 162. 2026-08-08 增加发布中心草稿与批次搜索

本轮改善发布中心在草稿和批次增多后的日常查找：

- 新建发布批次区域可按草稿名称、类目名称、Category ID 和 Product Type ID 搜索；
- 发布批次列表可按批次名称、状态和批次 ID 搜索；
- 搜索只过滤已经从当前店铺读取的记录，不改变 `ready` 草稿筛选、选中 ID、预检、确认或回读状态；
- 区分“没有可加入批次的 ready 草稿”和“没有匹配的 ready 草稿”，同样区分批次列表空数据与无搜索结果；
- 不新增接口、不伪造商品草稿或批次、不调用 SHEIN 写接口，真实发布开关保持关闭。

本轮验证：

- 发布中心 UI 契约测试：`9/9` 通过；
- 全量测试：`699/699` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 163. 2026-08-08 增加同步任务本地搜索

本轮改善同步任务中心的日常查找：

- 可按任务 ID、任务类型、任务状态、发起人和已返回的错误信息搜索任务；
- 搜索只在当前服务端已返回且已按店铺权限过滤的任务记录中执行，不扩大查询范围；
- 保留任务类型、任务状态筛选，以及任务详情轮询、规则失败类目定向重试和操作反馈；
- 区分“当前没有任务记录”和“当前搜索/筛选没有匹配任务”；
- 不新增接口、不修改任务状态机、不伪造失败类目、不调用 SHEIN 写接口。

本轮验证：

- 同步任务中心 UI 契约测试：`1/1` 通过；
- 全量测试：`699/699` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 164. 2026-08-08 增加经营预警本地搜索

本轮改善经营预警的日常定位：

- 可按预警标题、商品名、SKC、预警消息和同一商品快照中的供应商编码搜索；
- 搜索与高、中、低优先级筛选在页面端组合执行，只消费当前经营快照；
- 保留预警跳转商品经营页、主图、销量、上架天数和实际库存投影；
- 区分“当前没有经营预警”和“搜索/优先级筛选没有匹配的经营预警”；
- 不新增接口、不改变预警生成规则、不补造商品或库存数据、不调用 SHEIN 写接口。

本轮验证：

- 经营中心专项 UI 契约测试：`4/4` 通过；
- 全量测试：`699/699` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 165. 2026-08-08 增加销量与库存本地搜索

本轮改善销量与库存页的日常定位：

- 可按商品名称、标题、SKC、SPU 和供应商编码搜索当前经营快照中的商品；
- 搜索与库存风险筛选组合执行，库存风险仍统一使用已上架商品的 `daysOfCover` 口径；
- 保留今日、昨日、7 日、30 日销量、实际库存、可售天数和建议备货展示；
- 区分“当前快照没有商品记录”和“搜索/库存风险筛选没有匹配的商品”；
- 不新增接口、不补造商品或库存数据、不改变 SHEIN 写接口边界。

本轮验证：

- 经营中心专项 UI 契约测试：`4/4` 通过；
- 全量测试：`699/699` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：
  `READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 166. 2026-08-08 增加跨店铺经营总览分析面板

本轮新增登录后的跨店铺总览入口 `/app/overview`：

- 总览导航放在经营中心首位，读取当前用户可访问店铺，并通过已有只读 `businessDashboard` 接口分别获取经营快照；没有新增 SHEIN 接口或写操作；
- 汇总展示当日销量、近 7 日销量、近 30 日销量、实际库存、商品级 `replenishmentGap` 和库存风险商品；
- 店铺对比表保留无快照、读取失败、演示环境、需要重新授权和已停用状态，缺失数值显示为 `--`，不把未读取数据当成 0；
- 备货分析按当前经营快照中的正数 `replenishmentGap` 排序，并展示店铺、SKC、可售天数和建议备货量；库存风险只统计已上架且 `daysOfCover <= 5` 的商品；
- 销量图明确标注为“当前经营快照的周期聚合对比，不代表连续历史曲线”。当前 API 只提供当日、7 日、30 日聚合值；若要实现连续日/周趋势，后续必须接入官方历史销售数据或已持久化的带日期经营快照，不能由当前三个聚合值推造曲线；
- 生图模块保持不变，真实发布开关保持关闭，不执行数据库迁移，不调用 SHEIN 写接口。

本轮验证：

- 跨店铺总览 UI 契约测试：`2/2` 通过；
- 全量测试：`701/701` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：`READY`，Release contracts `10/10`，无阻断；
- 真实发布、数据库迁移、SHEIN 写接口和生图模块均未改变。

## 167. 2026-08-08 完善总览分析设计与数据可信度状态

本轮将总览从基础展示推进为可核对的经营分析面板：

- 真实同步服务在保留 SKU 级 `suggestedRestock` 的同时，补充商品级 `replenishmentGap`，供总览和销量库存页统一读取；该字段仍是基于真实销量与实际可用库存的本地计算，不冒充 SHEIN 官方备货建议；
- 店铺对比表增加“已同步、数据过期、部分失败、待同步、读取失败”状态，并显示同步时间和数据截止日期；
- 总览页头部显示当前快照覆盖率、过期店铺数和需要核对的店铺数，避免用户只看见汇总数字而忽略数据新鲜度；
- 继续保留跨店铺权限范围、演示环境、缺失数据不计为 0、周期聚合不是历史曲线等边界；
- 设计参考了开源电商后台的跨渠道/多仓库、销售周期对比、库存风险和数据来源展示思路，但没有复制外部项目代码，也没有改变 SHEIN 官方 API 字段契约；
- 生图模块保持不变，真实发布开关保持关闭，不执行数据库迁移，不调用 SHEIN 写接口。

本轮验证：

- 跨店铺总览与真实同步专项测试：`7/7` 通过；
- 全量测试：`701/701` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：`READY`，Release contracts `10/10`，无阻断；
- 本地 V2 服务继续使用 `http://127.0.0.1:5174/`，演示 API 使用 `http://127.0.0.1:8790/`。

## 168. 2026-08-08 完成云端只读 V2 部署验收

本轮完成云端候选版本的受控切换：

- 云端数据库备份已保留，使用 migration owner 完成 `021–030` 迁移；`028`、`029`、`030` 专项验证全部通过，审计记录保持为空，发布执行关闭约束保持有效；
- 手工建立并加固 `shein_runtime`，按运行时能力矩阵授予最小权限；runtime database audit 通过 `50` 项；不把 migration owner 连接交给长期运行服务；
- 修正云端镜像构建上下文，明确复制 `deploy/postgres`、`src` 和 `src-v2`，避免审计 SQL 与共享运行时代码在容器内缺失；
- 候选 control 容器已使用 runtime 连接启动，`/health` 和 `/ready` 均返回成功，PostgreSQL 与 Redis 依赖状态均为 `up`；
- 静态站点指针已切换到 `/opt/shein-console/releases/20260808-overview-v2-fixed3`，外部 `https://app.hanzhou.icu/` 返回 `HTTP/2 200` 并提供 V2 静态资源；旧 release 目录保留，可用于应用回退；
- 未启动同步、Webhook、图片生成或发布执行 worker；真实 SHEIN 写入和发布能力仍保持关闭，生图模块保持原边界；
- 部署过程中发现的两个打包遗漏已在 `deploy/Dockerfile.cloud-control` 修正，并通过云端重新构建验证；
- 云端验证期间曾在终端截图中暴露敏感配置，后续必须轮换 SHEIN App Secret 与数据库密码后再作为长期生产凭据使用，禁止继续发送 `.env` 或连接串截图。

本轮验证：

- 云端迁移服务：`021–030` 全部执行成功；
- `028` 专项验证：5 项全部为 `t`，`review_count=0`；
- `029` 专项验证：函数、迁移登记、触发器定义全部为 `t`；
- `030` 专项验证：9 项全部为 `t`，发布关闭约束为 `t`；
- runtime database audit：`50` 项通过；
- 云端 control：`/health`、`/ready` 通过；外部静态入口：`HTTP/2 200`；
- 真实发布、SHEIN 写接口、同步 worker 和生图执行均未启用。

## 169. 2026-08-08 修复 V2 店铺边界与经营刷新反馈

本轮针对云端页面反馈完成两项修复：

- V2 前端只把带真实 `supplierId` 的授权记录作为 SHEIN 店铺，顶部店铺切换器和店铺管理不再展示“团队生图项目”等演示/非店铺空间；该过滤不改变数据库中的演示记录，也不把演示数据伪装成真实店铺。
- 总览“刷新总览”改为逐店铺调用现有只读经营刷新 POST 接口，再读取刷新中的快照；商品经营、销量与库存、经营预警页会显示刷新请求失败原因，不再出现点击后无反馈。
- 云端要让刷新真正执行，必须在 `/opt/shein-console/shared/.env` 设置 `SHEIN_STORE_BUSINESS_REFRESH_ENABLED=true`，并启动 `store-business-refresh-worker`；定时调度保持关闭，直到手动刷新验收完成。该 Worker 只读取官方经营数据并写入本地同步快照，不开启 SHEIN 发布、生图或其他写接口。
- 若要让商品属性规则同步和合规同步按钮也真正执行，还需分别开启 `SHEIN_RULE_REFRESH_ENABLED`、`SHEIN_COMPLIANCE_SYNC_ENABLED` 并启动对应只读 Worker；三类同步均不等于发布，不启动 `image` profile。

本轮验证：

- V2 店铺、总览和经营专项测试：`9/9` 通过；
- 全量测试：`701/701` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：`READY`；
- 真实发布开关保持关闭，生图模块保持不变，未执行数据库迁移。

## 170. 2026-08-08 修复经营刷新 SQL 参数类型绑定

本轮针对云端刷新日志中的 `could not determine data type of parameter $8` 完成最小修复：

- `store-business-service` 的经营刷新领取 SQL 已将审计元数据中的 `trigger` 参数明确约束为 `text`，消除 PostgreSQL 在 `jsonb_build_object` 中无法推断参数类型的问题；第 8 个绑定值本身仍由服务端根据 `web` 或 `scheduler` 上下文生成；
- 增加回归断言，锁定 `$8::text` 类型契约，避免刷新请求部署后才在真实数据库解析阶段失败；
- 不改变 SHEIN 请求字段、同步数据边界、数据库表结构或发布权限；不执行迁移，不调用 SHEIN 写接口，不启动生图执行。

本轮验证：

- 经营刷新专项测试：`13/13` 通过；
- 全量测试：`701/701` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：`READY`；
- fixed5 部署包用于替换 fixed4 的控制服务与只读同步 Worker，云端仍需保留真实发布开关关闭。

## 171. 2026-08-08 增加经营刷新限流保护

本轮根据云端真实任务返回的 SHEIN `832213` QPS 限流错误完成保护：

- 单次经营刷新现在通过统一串行请求队列发送商品、销量、库存、上架状态和详情读取，不再让各阶段的并发数直接叠加成应用级 QPS；默认请求间隔约 `150ms`，按保守速率运行；
- 对官方限流错误 `832213`、HTTP `429` 和明确的限流响应执行 `1.5s / 3s / 6s` 退避重试；其他错误不被伪装成限流，也不把失败响应当成空数据；
- 最终仍限流时，数据库任务错误改为稳定的 `SHEIN_RATE_LIMITED` 和用户可读提示，不保存上游内部限流细节；
- 本轮仅影响只读经营同步请求，不改变 SHEIN 官方字段、批量边界、授权范围、数据库结构、发布开关或生图模块。

本轮验证：

- 经营同步限流专项测试通过；
- 全量测试：`702/702` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：`READY`；
- fixed6 部署包用于替换 fixed5 的 control 和只读同步 Worker。

## 172. 2026-08-08 修复经营快照 UPSERT 的运行时 SELECT 权限契约

本轮针对云端经营数据刷新实际返回的 `permission denied for table store_sales_daily (42501)` 完成根因修复：

- PostgreSQL 的 `INSERT ... ON CONFLICT ... DO UPDATE` 不仅需要目标表的 `INSERT`、`UPDATE`，还需要读取冲突目标列，因此运行时角色必须拥有该表的 `SELECT`；此前能力提取器只生成了 `INSERT`、`UPDATE`，导致只读角色审计错误地通过而真实 UPSERT 失败；
- `runtime-database-capabilities` 现在会为检测到的 `ON CONFLICT DO UPDATE` 自动补充 `SELECT`，并同步更新运行时能力矩阵和审计 SQL；`store_sales_daily` 的精确能力变为 `SELECT, INSERT, UPDATE`；
- 本轮只修正运行时权限契约和审计生成，不自动执行生产授权、不执行数据库迁移、不改变 SHEIN API 字段、不调用 SHEIN 写接口、不启动生图执行；云端应由维护者按审计结果手工补充缺失的单表 `SELECT`，禁止使用 `GRANT ALL`；
- 现有 fixed6 的 SHEIN QPS 串行限流和退避保护保持不变；后续再单独评估跨 Worker 共享限流和同步重试状态，不在本轮引入新的队列框架或改写同步流程。

本轮验证：

- 运行时能力生成专项测试：`6/6` 通过；
- 全量测试：`702/702` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：`READY`，Release contracts `10/10`，无阻断；
- fixed7 部署包待云端上传，真实发布、生图执行、SHEIN 写接口和数据库迁移均未启用。

## 173. 2026-08-08 移除发布中心的本地字段演示入口

本轮根据真实上品测试需求收窄正式发布工作流：

- 发布中心不再显示“本地字段演示”按钮和模拟回读结果，避免把本地沙盒误认为 SHEIN 平台回执；
- 本地演示实现和测试保留在开发边界中，真实发布中心继续保留商品草稿筛选、批次冻结、远程预检、指纹确认、合规复验和平台回读安全门；
- 发布审计仍明确 `executionEnabled=false`、`authorizesPublishing=false`，当前云端不能真实调用 SHEIN 发布接口；今晚只能做草稿、预检和安全流程测试，不能把商品提交到平台；
- fixed7 部署时发现压缩包漏带 `dist-web`，导致 Nginx 深层路由回退循环；云端已从 fixed6 补回该静态目录，后续 fixed8 包会同时携带 V2 `dist-v2` 和 Nginx 使用的 V2 `dist-web`，避免重复人工修复。

本轮验证：

- 发布中心专项 UI 契约测试：`9/9` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：`READY`，Release contracts `10/10`，无阻断；
- 未开启真实发布、未调用 SHEIN 写接口，生图执行保持关闭。
- fixed8 包已生成：`shein-cloud-deploy-20260808-overview-v2-fixed8.tar.gz`；SHA-256：`d3dd4c1fad8d90ff90d57158dc0e3fcae471fc265b298a17b0083c8e9372840c`；包内 `dist-web` 与 `dist-v2` 均指向同一套 V2 构建资源。

## 174. 2026-08-08 增加本地浏览器直连授权与只读同步模式

本轮针对本地测试授权和同步流程过于依赖云端设备会话的问题完成最小改动：

- 新增显式环境开关 `SHEIN_LOCAL_DIRECT_AUTH=true`，并提供 `npm run dev:local:direct`；默认值仍为 `false`，普通本地启动和云端设备授权行为不变。
- 本机直连模式下，浏览器授权入口使用本地 `/api/shein/auth/url`，回调后的 `tempToken + state` 使用本地 `/api/shein/auth/exchange`；应用密钥、店铺密钥和签名仍只在 Node 代理内处理，店铺凭证继续写入本机 AES-256-GCM 加密凭证库。
- 授权后的商品、销量、库存和合规读取复用现有本机 SHEIN 只读路由；没有新增 SHEIN 字段，没有调用发布或其他写接口，也没有打开生图执行。
- 本机直连页面隐藏云端设备连接面板，明确显示授权交换、只读同步、凭证存储和发布权限边界；健康检查新增 `localDirectAuthEnabled`，便于确认浏览器当前连接模式。
- V2 `npm run dev:v2:local` 仍保持本地演示 API，不伪装成真实 SHEIN 数据；本轮直连入口是传统本地浏览器版本 `npm run dev:local:direct`。

本轮验证：

- 本地授权/云端兼容路由专项：`9/9` 通过；
- 全量测试：`704/704` 通过；
- `npm run build`：通过；
- `npm run build:v2`：通过；
- 临时端口健康检查返回 `configured=true`、`runtimeMode=local`、`localDirectAuthEnabled=true`、`credentialsStorage=encrypted-file`；临时代理已停止。
- 真实授权、真实同步仍需用户在本机配置有效 `SHEIN_APP_ID`、`SHEIN_APP_SECRET` 后手动启动；发布开关、生图执行和所有 SHEIN 写接口继续关闭。

## 175. 2026-08-08 修复经营预警箭头误跳商品经营列表

本轮针对云端页面中点击经营预警最右侧箭头后只进入商品经营列表、无法查看对应商品详情的问题完成最小修复：

- 经营预警的 SKC 箭头现在进入独立路由 `/app/operations/:storeId/products/:skc`，不再把 `?skc=` 当作商品经营列表的搜索条件；因此预警入口和商品列表入口的职责分开；
- 新增只读商品详情页，按当前店铺经营快照中的 `skc` 精确查找商品，展示现有快照返回的商品概览、销量、库存、可售天数、备货缺口和 SKU 明细；快照中找不到时明确提示，不补造商品、不新增接口；
- 商品经营列表原有的 SKU 行内展开行为保持不变；本轮未改 SHEIN 字段、未调用 SHEIN 写接口、未改变发布权限、未启动生图执行，也未执行数据库迁移。

本轮验证：

- 经营页面专项 UI 契约测试：`6/6` 通过；
- 全量测试：`706/706` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：`READY`，Release contracts `10/10`，无阻断；
- 真实发布开关继续保持关闭，详情页只读取现有经营快照。

## 176. 2026-08-08 修复经营预警上架天数显示为 `--`

本轮针对经营预警中所有商品都显示“上架 -- 天”的问题完成根因修复：

- SHEIN 只读同步层已经将首个有效上架时间计算为内部字段 `listingDays`，但 V2 页面和类型定义错误读取了不存在的 `listedDays`，因此页面始终显示占位符；
- 经营预警和商品详情页统一读取现有经营快照的 `listingDays`，不新增日期推算、不改 SHEIN 请求字段、不把销量或库存当作上架时间；
- 已删除 V2 代码中错误字段 `listedDays` 的残留引用，保持“上架天数只来自同步层首个有效上架时间”的数据边界。

本轮验证：

- 经营页面与同步链路专项测试：`12/12` 通过；
- 全量测试：`706/706` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：`READY`，Release contracts `10/10`，无阻断；
- 未调用 SHEIN 写接口，未执行数据库迁移，发布开关和生图执行继续关闭。

## 177. 2026-08-08 合规工作台无数据的根因与下一轮实施边界

本轮先完成排查和交接，尚未修改代码。用户反馈云端“合规状态没有任何数据”，当前结论如下：

- V2 合规工作台从真实云端接口 `/v1/web/stores/:storeId/compliance-workspace` 读取 `skcs` 表；页面的 `complianceStatus` 为空时会诚实显示“未同步”，不会把商品状态、销量或库存推断成合规状态；
- 合规同步任务同样从 `skcs` 表读取目标，再写入 `skcs.compliance_status`、`skcs.compliance_summary` 和 `skc_compliance_records`；如果 `skcs` 没有真实目标，任务即使可运行也不会产生合规条目；
- 当前真实经营刷新只保存 `store_business_snapshots`、`store_sales_daily` 和店铺同步时间，没有把 SHEIN 只读返回的真实 `snapshot.products` 投影到 `spus/skcs`，这是云端合规工作台无记录的主要根因；
- 本地 `npm run dev:v2:local` 使用演示 API，合规工作台按设计返回空列表，不允许为了“看起来有数据”伪造合规状态。需要真实授权和真实只读同步时使用 `npm run dev:local:direct`，且仍不调用 SHEIN 写接口；
- 不能通过默认值、销量/库存推算或本地样例填充合规状态。所有展示值必须来自真实 SHEIN 只读返回或真实合规同步结果；

下一轮建议按以下最小顺序实施：

1. 在真实经营刷新成功路径中，将实际返回且具有 `skc` 的商品投影到 `spus`、`skcs`；只保存真实商品字段、供应商编码、原始上架状态和原始 JSON，已有合规字段不被刷新覆盖；不删除快照中未出现的旧记录；
2. 使用事务和 `ON CONFLICT` 幂等 UPSERT，保留已有 `spu_id`，不创建缺少真实 `skc` 的占位商品；先投影再标记经营刷新成功，投影权限失败必须让任务明确失败，不得静默吞错；
3. 更新运行时能力生成，最小补充 `spus`、`skcs` 所需的 `SELECT/INSERT/UPDATE`，禁止 `GRANT ALL`；代码和能力审计通过后，再由云端维护者手工授权并重新运行数据库角色审计；不执行数据库迁移；
4. 重新执行一次真实经营数据刷新，再执行合规刷新；验证合规工作台出现真实 SKC 的“未同步”状态，随后验证合规同步结果和失败明细；若 SHEIN 合规接口尚未授权或返回边界错误，页面必须显示真实失败原因；
5. 继续保持 `authorizesPublishing=false`、真实发布开关关闭、生图执行关闭，不因本轮合规修复打开任何 SHEIN 写接口。

当前已知状态和验证基线：

- 最近一次已完成基线：全量测试 `706/706`、`npm run build:v2` 通过、release audit `READY`；
- 最近部署包 fixed7 已验证 control 和三个只读同步 Worker 健康，用户已确认经营数据同步成功过一次；
- fixed8 曾用于补回云端 Nginx 所需的 `dist-web`，避免深层路由 `/app/operations/:storeId/jobs` 回退循环；
- 本条交接之后才允许开始代码编辑；第一目标文件预计为 `server/cloud/store-business-service.js`，配套测试为 `server/cloud/store-business-service.test.js`、运行时能力生成测试和合规工作台测试；
- 新对话开始时先重新读取本条和 `.agents/skills/karpathy-guidelines/SKILL.md`，确认工作树未清理、未重置，再检查 `withTransaction` 与现有测试替身后实施。

## 178. 2026-08-08 经营刷新投影真实 SPU/SKC

本轮按第 177 节边界完成最小代码修复，仍未执行生产授权、迁移或 SHEIN 写接口：

- `PostgresStoreBusinessRepository.saveSuccess` 改为事务保存。经营快照、店铺同步时间、真实商品 SPU/SKC 投影、
  日销量聚合和同步任务成功状态现在同事务提交；投影失败会回滚并让刷新任务失败，不能静默显示成功；
- 只从 `snapshot.products` 中有真实 `skc` 的商品生成投影，不创建缺少 SKC 的占位商品，不删除快照中未出现的旧
  `spus/skcs` 记录；
- `spus` 按当前店铺真实 `spu` 幂等 UPSERT，保存标题、类目 ID/名称和脱敏经营快照摘要；
- `skcs` 按当前店铺真实 `skc` 幂等 UPSERT，保存 `spu_id`、供应商编码、原始上架状态和经营快照摘要；
  已有合规字段不被经营刷新覆盖，已有 `spu_id` 在本轮没有可解析 SPU 时会保留；
- 同步任务进度新增 `productProjectionCount`，用于核对本轮刷新实际投影的 SKC 数量；
- 运行时能力矩阵和只读审计 SQL 已重新生成，`spus`、`skcs` 的 runtime role 最小能力变为
  `SELECT, INSERT, UPDATE`。仓库仍不生成或执行 `GRANT/REVOKE`，云端需维护者按矩阵手工补齐权限并重跑
  runtime database audit。

本轮验证：

- 经营刷新与运行时能力专项测试：`21/21` 通过；
- 全量测试：`708/708` 通过；
- `npm run build:v2`：通过，仍只有既有大 chunk 提示；


## 190. 2026-08-26 NEXUS-EVO-03 统一缓存、手动刷新与数据新鲜度

本阶段按 NEXUS-OPS-01 的低请求压力原则完成前端缓存刷新收敛，未改 SHEIN 写入链路、业务状态机、服务端权限或云端部署：

- 商品草稿、单个建品、批量建品、发布批次、合规详情/草稿、模板中心和今日工作页面的 TanStack Query 统一设置 `refetchOnMount: false`，路由切换复用现有缓存，不再因为组件重新挂载重复拉取；
- 发布批次的回读明细和图片缩略图查询也纳入该策略；保留显式手动刷新、定向失效和写操作成功后的局部更新；
- 新增手动刷新回归合同，确保核心工作区不使用 `refetchInterval`，并且每个手动刷新查询都不会在路由重新挂载时自动刷新；
- 作用域仍沿用 NEXUS-EVO-02 的租户、用户、店铺 Query key，不改变权限边界；首次打开无缓存时仍正常请求；

本轮验证：

- V2 核心 UI：`19/19` 通过；
- 服务端全量：`124/124` 通过；
- 项目全量：`1058/1058` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2`：`READY`，Release contracts `14/14`，无阻断。

本阶段未部署云端，按 NEXUS-EVO 顺序保留到统一发布门禁阶段；真实发布开关、生图执行和所有 SHEIN 写接口继续关闭。完整记录见 `docs/NEXUS_EVO_03_REFRESH_2026-08-26.md`。

## 191. 2026-08-26 NEXUS-EVO-04 收敛发布与审核状态机

本阶段继续按 NEXUS-OPS-01 的“官方状态优先、历史与当前分离”原则完成定向修复：

- 审核事件不再使用通用 `status` 字段推导工作流阶段；只有明确的工作流字段或官方 `audit_state` 才能决定待审核、待核价、已通过和已驳回，避免通用状态文本把待审核错误归入待核价；
- 同一 SKC 重新发起后的最新 SHEIN version 仍是当前任务，旧版本驳回保留在驳回计数和历史中，不再覆盖新任务；未完成回读时保持待回读，不回退到旧驳回；
- 新增审核状态回归合同，覆盖通用状态冲突、重新发起、JSON SKC 列表、同版本重发、任务次数和店铺归档隔离；
- 未修改 SHEIN 写接口、发布幂等、合规写入、权限校验或云端配置。

完整记录见 `docs/NEXUS_EVO_04_REVIEW_STATE_2026-08-26.md`。真实发布开关、生图执行和所有 SHEIN 写接口继续关闭。

## 192. 2026-08-26 NEXUS-EVO-05 合规官方必填视图与 1630/1631 闭环

本阶段继续按 NEXUS-OPS-01 的“官方要求优先、详情可识别、状态不推断”原则完成合规详情的最小修复：

- 单个 SKC 详情标题旁恢复主图缩略图；没有主图时显示明确占位，避免进入详情后无法确认商品；
- 官方报告区块不再因 SHEIN 尚未返回 `reportType` 而整体消失，始终显示“等待 SHEIN 返回 1630/1631”或官方返回类型及对应上传提示；
- 1630/1631 仍只使用 SHEIN 官方回读结果，未返回前不展示本地判定，也不开放错误类型选择；
- 保留单个 SKC 官方必填字段过滤、报告日期校验、文件上传、保存与真实提交链路，不改发布状态机和权限作用域；
- 新增合规详情 UI 回归合同，锁定等待态和主图缩略图。

本轮验证：合规详情与工作台 UI 专项 `22/22` 通过。全量测试、V2 构建和发布审计将在 NEXUS-EVO-10 统一门禁再次执行；本阶段未部署云端。

完整记录见 `docs/NEXUS_EVO_05_COMPLIANCE_2026-08-26.md`。真实发布开关、生图执行和所有 SHEIN 写接口继续关闭。

## 193. 2026-08-26 NEXUS-EVO-06 发布任务进度、幂等与额度回写

本阶段核验发布中心的任务状态、重复提交保护与店铺额度显示：

- 发布中心继续展示排队、提交中、待审核、回读超时、发布失败、审核失败、实拍图失败和已发布等状态，结果待确认时禁止重复提交；
- 服务端在 SHEIN 接收发布回执后原子更新本月额度临时投影，官方额度事件仍是最终权威；
- 前端在发布成功或进入待确认态后立即失效当前租户、用户、店铺的经营快照查询，避免草稿、批量建品和审核中心继续显示旧额度；
- 未修改发布幂等、任务 ID、店铺权限和 SHEIN 写接口，真实发布开关仍保持关闭。

本轮验证：发布中心 UI `15/15`、服务端全量 `124/124`、项目全量 `1062/1062`；V2 构建通过，release audit `READY`（14/14）。本阶段未部署云端。

完整记录见 `docs/NEXUS_EVO_06_PUBLISH_GATE_2026-08-26.md`。

## 194. 2026-08-26 NEXUS-EVO-07 模板替换、单属性重引与编辑闭环

本阶段完成模板使用语义的专项验收：

- 普通套用保持填充空字段；只有显式选择“重新引用（替换）”才覆盖已有模板字段；
- 单个建品和批量建品均支持标题、商品属性、颜色尺寸、打包体积等单属性重新引用，使用替换而不是叠加；
- 打包体积模板缺失尺寸不会静默写入错误值，未匹配项保留为可手动补齐并反馈给用户；
- 模板计划在执行前重新读取当前 SHEIN Schema，货号、价格、库存、包装与预览图不会被普通套用覆盖；
- 模板作用域继续遵守租户、店铺、用户和管理员共享权限，未改服务端授权和 SHEIN 写接口。

本轮模板与编辑专项 `62/62` 通过；本阶段未部署云端，完整记录见 `docs/NEXUS_EVO_07_TEMPLATE_REUSE_2026-08-26.md`。

## 195. 2026-08-26 NEXUS-EVO-08 销量库存、在途与经营分析口径

本阶段完成总览、销量与库存、经营预警及刷新 Worker 的只读验收：

- 销量严格使用 SHEIN SKU 销量接口的官方实时、昨日、7日和30日字段；
- 实际库存、锁定库存和在途库存严格使用 SHEIN stock-query 回读，缺失字段保持未知，不伪造 0；
- 平台上下架状态只接受 SHEIN SKC 标签接口精确回读，旧快照或本地推断降级为“待同步”；
- SKC 展开逐 SKU 展示库存、在途、销量、可售天数和建议备货，建议备货作为本地分析值单独标识；
- 店铺快照、并发任务锁、手动刷新冷却、限流退避和 Worker 失败状态均保持租户/店铺作用域，默认调度关闭。

经营分析专项 `61/61` 通过；本阶段未部署云端，完整记录见 `docs/NEXUS_EVO_08_BUSINESS_ANALYTICS_2026-08-26.md`。

## 196. 2026-08-26 NEXUS-EVO-09 统一 UI、性能与可观测性验收

本阶段完成 V2 统一界面、缓存容量、图片复用和大数据列表的专项验收：

- 统一 Operations primitives、TanStack Table/Virtual、Radix/Tailwind 交互基础，不引入第二套 UI 框架；
- 100 行以内保留原生表格几何，超过 100 行启用虚拟滚动；审核、合规、批量建品和图片编辑保留紧凑布局、横向滚动和放大/占位能力；
- 查询缓存有界回收，关闭窗口焦点/重连刷新风暴；写操作不自动重试，读请求仅有限重试；
- 稳定同源媒体 URL、私有长期缓存和懒加载继续复用图片，页面切换不重复下载；
- 核心页面统一加载、空态、错误、缓存过期、权限和手动刷新反馈，HEF/HST/HWF/SRF 的作用域合同保持通过。

V2 UI、性能与作用域专项 `85/85` 通过；本阶段未部署云端，完整记录见 `docs/NEXUS_EVO_09_UI_PERFORMANCE_2026-08-26.md`。

## 188. 2026-08-26 NEXUS-EVO-02 统一前端租户、用户与店铺 Query 作用域

本阶段按 NEXUS-OPS-01 的权限隔离优先原则完成最小范围前端缓存修复，未改 SHEIN 写入链路、服务端授权逻辑或云端部署：

- 商品草稿、单个建品、批量建品、合规详情/草稿和模板中心的 TanStack Query key 统一增加当前租户、用户和店铺作用域，避免同一浏览器切换账号或店铺后复用旧数据；
- 同步更新相关 `invalidateQueries` 前缀，使保存、归档、模板引用和合规操作只失效当前用户当前店铺缓存；
- 合规草稿编辑器通过父级传入作用域，保持组件可复用且不直接读取会话；批量合规与报告模板子面板同样接收作用域；
- 新增 `v2-core-ui-system.test.js` 作用域回归合同，并更新草稿 UI 合同以锁定新的 key 结构；
- 没有引入新的缓存库、没有调整服务端权限判定，旧页面/旧路由仍保持兼容。

本轮验证：

- 作用域专项：`18/18` 通过；
- 服务端全量：`124/124` 通过；
- 项目全量：`1057/1057` 通过；
- `npm run build:v2`：通过；
- `npm run release:audit:v2`：`READY`，14/14，无阻断；
- 本阶段未部署云端，待 EVO-03 缓存/刷新统一完成后再进入统一发布门禁。

## 188. 2026-08-12 将合规顶部统计改为店群经营口径

本轮针对合规工作台顶部统计与 SKC 明细状态不一致的问题完成定向修复，未修改预检执行、管理员审阅、授权和 SHEIN 写接口：

- 原 `auditSummary` 统计的是服务端预检流程（未运行、需重新预检、待审阅、已审阅），与表格中的商品总体合规状态不是同一口径；该流程统计保留给审阅筛选和兼容调用；
- 新增 `complianceSummary` 店群经营统计：`全部 SKC`、`不合格`、`处理中`、`已通过`；统计基于真实 `skcs.compliance_status`，不从销量、库存或其他字段推断；
- 四项顶部卡片在当前筛选范围内对账：`全部 SKC = 不合格 + 处理中 + 已通过 + 其他未完成状态`，因此 `未同步`、`待补充` 等状态仍通过合规状态筛选查看，不会被漏算；
- 本地真实 V2 适配服务和云端合规工作台服务同时返回相同统计契约，避免本地与云端再次产生两套页面行为；
- 新增云端服务 SQL 聚合、服务映射、本地真实桥接和 UI 契约回归测试；

本轮验证：

- 合规工作台、本地桥接专项测试：`36/36` 通过；
- 全量后端测试：`103/103` 通过；
- `npm run build:v2`：通过，仍只有既有大 chunk 提示；
- 本地浏览器真实模式已验证当前店铺显示：`全部 SKC 1179 / 不合格 319 / 处理中 3 / 已通过 857`，四项与 1179 个 SKC 对账；

真实发布开关、生图执行和所有 SHEIN 写接口继续关闭，云端尚未重新部署。

## 189. 2026-08-12 修复筛选合规 SKC 点击详情后白屏

本轮按项目工程规则处理本地真实 V2 合规工作台回归，未修改筛选逻辑、合规状态、授权和 SHEIN 写接口：

- 根因是本地 V2 合规详情适配层的 `emptyDetail().editorModel` 仍使用旧版简化结构，只返回 `fields` 和 assignment 数组；当前 `ComplianceDraftEditor` 会读取 `agencyRequirements`、`warningRules`、`platformCapabilities` 等新契约字段的 `length`，筛选后点击详情触发 `undefined.length`，页面白屏；
- 本地详情投影补齐完整 `ComplianceEditorModel` 结构，规则、证书库、代理公司库、警示语规则和官方字段在本地未提供时均返回明确的空数组与 `false` 状态；没有伪造合规规则或开放写接口；
- 新增本地详情回归测试，覆盖筛选结果点击详情所需的完整编辑模型契约；

本轮验证：

- 本地 V2 桥接详情专项：`1/1` 通过；
- 合规详情 UI 契约：`2/2` 通过；
- 全量后端测试：`103/103` 通过；
- `npm run build:v2`：通过，仍只有既有大 chunk 提示；
- 本地浏览器实际筛选“需修正”并点击第一条 SKC：详情页正常显示“需修正 / 商品实拍失败”，控制台错误为 `0`，无白屏；

真实发布开关、生图执行和所有 SHEIN 写接口继续关闭，云端尚未重新部署。
- `npm run build:web`：通过；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：`READY`，Release contracts
  `10/10`，无阻断。

下一步云端处理顺序仍应保持保守：

1. 用 fixed8 之后的新包部署 control 和只读经营同步 Worker；
2. 按 `deploy/postgres/runtime-role-capabilities.md` 只给 `spus/skcs` 补最小缺失权限，禁止 `GRANT ALL`；
3. 重跑 runtime database audit；
4. 手动执行一次真实经营刷新，确认 `productProjectionCount` 与真实 SKC 数量合理；
5. 再执行合规刷新，验证合规工作台出现真实 SKC 的“未同步/同步结果/失败原因”。

真实发布开关、生图执行和所有 SHEIN 写接口继续关闭。

## 179. 2026-08-08 合规工作台空状态诊断提示

本轮继续核对“合规状态没有任何数据”的页面链路，并补齐一个容易误导用户的空状态：

- `CompliancePage` 读取 `/v1/web/stores/:storeId/compliance-workspace`，服务端 SQL 明确从 `skcs` 表读取；
- 合规同步 `listTargets()` 同样从 `skcs` 表读取目标，因此 `skcs` 为空时，创建合规同步也只能得到零目标任务，
  不会产生任何合规行；
- 列表中已有真实 SKC 但 `compliance_status IS NULL` 时，页面会诚实显示“未同步”，这部分逻辑保持不变；
- 当合规工作台完全没有缓存 SKC 时，页面空状态从“当前店铺还没有合规缓存 / 可前往同步任务创建合规同步”
  改为“当前店铺还没有可同步的真实 SKC / 请先在经营中心刷新真实商品数据，生成 SKC 缓存后再创建合规同步”；
- 新增 `server/cloud/v2-compliance-workspace-ui.test.js` 固定该提示，避免后续再次误导为“直接点合规同步即可”；
- 本轮没有新增接口、没有改变合规同步目标选择、没有伪造 SKC 或合规状态，也没有调用 SHEIN 写接口。

本轮验证：

- 合规工作台空状态与经营刷新专项：`16/16` 通过；
- 全量测试：`709/709` 通过；
- `npm run build:v2`：通过，仍只有既有大 chunk 提示；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：`READY`，Release contracts
  `10/10`，无阻断。

下一步仍是部署包含第 178、179 节修复的新包，给 runtime role 补齐 `spus/skcs` 的最小权限，重跑经营刷新，
确认 `skcs` 出现真实商品后再运行合规同步。

## 180. 2026-08-08 禁止合规同步空跑 0/0

本轮根据本地浏览器截图修复“合规同步已完成但进度为 0/0”的误导行为，仍未连接云端、执行迁移或调用 SHEIN 写接口：

- `PostgresComplianceSyncRepository` 新增真实 `skcs` 目标检查，并与 `listTargets()` 使用相同的非空 SKC 条件；没有真实 SKC 时，合规刷新返回 `409 COMPLIANCE_SYNC_NO_TARGETS`，不会创建 `sync_jobs`；
- Worker 增加并发兜底：如果任务领取后目标消失，任务保存为失败并记录相同错误，禁止再保存为成功 0/0；
- 本地演示 API 同样拒绝空目标合规同步，不伪造 SKC 或合规状态；
- 本地浏览器验证：点击“刷新合规”显示“当前店铺没有可同步的真实 SKC，请先刷新经营数据”，任务中心保持 0 条记录，合规工作台继续显示真实 SKC 缓存为空的提示；
- 旧的历史 0/0 任务不会被篡改；新任务不会再产生这种成功空跑记录。必须先完成真实经营刷新并确认 `skcs` 有真实 SKC，再运行合规同步。

本轮验证：

- 合规同步、演示 API、同步任务 UI 专项测试：`30/30` 通过；
- 全量测试：`710/710` 通过；
- `npm run build:v2`：通过，仍只有既有大 chunk 提示；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：`READY`，Release contracts `10/10`，无阻断。

真实发布开关、生图执行和所有 SHEIN 写接口继续关闭。云端部署前仍需先完成第 178、179 节的部署与真实经营刷新验证。

## 181. 2026-08-08 建立 V2 本地真实只读验收模式

本轮按用户确认的“先在本地浏览器把真实链路测试完，再重新部署云端”原则实施；没有连接云端，也没有打开任何 SHEIN 写接口：

- 修复本地直连授权回调：`SHEIN_LOCAL_DIRECT_AUTH=true` 时，`tempToken + state` 现在由本地代理直接换取店铺凭证并写入本机加密凭证库，不再无条件依赖云端客户端；非直连模式的云端回调行为保持不变；
- 新增 `npm run dev:v2:real-local`，同时启动本地 SHEIN 只读代理、V2 本地真实适配服务和 V2 页面；默认 `npm run dev:v2:local` 继续是明确标注的空数据演示模式；
- V2 本地真实适配服务复用既有本地代理的授权、经营同步和合规同步实现，只映射店铺、经营快照、商品、合规工作台摘要和同步任务；店铺修改、规则写入、发布、上传和其他 SHEIN 写接口明确返回本地只读错误；
- 合规工作台以经营快照中的真实商品 SKC 作为“未同步”目标，合规刷新后读取本机缓存的真实合规结果，不用演示数据补齐状态，不再产生虚假的 `0/0` 成功任务；
- README 已补充启动命令、浏览器地址和数据边界，应用凭证和店铺密钥不进入浏览器或日志。

本轮验证：

- 本地 V2 真实适配契约测试：通过；
- 授权/云端兼容专项测试：通过；
- `npm run build:v2`：通过，仍只有既有大 chunk 提示；
- 本地浏览器真实模式已读取当前本机授权店铺，商品经营页显示 `1,179` 个真实商品，合规工作台显示 `1,179` 个缓存 SKC，同步任务显示历史合规同步 `1,179/1,179`；
- 当前 `.env` 只在本机服务进程使用，未展示或写入任何密钥；真实刷新是否成功仍以 SHEIN 当前接口响应为准。

下一步：继续在本地真实只读模式验证一次经营刷新和一次合规刷新，记录真实接口成功/失败明细；只有本地回归完成后，才重新制作云端部署包。真实发布开关、生图执行和所有 SHEIN 写接口继续关闭。

## 182. 2026-08-08 真实经营刷新命中 SHEIN 授权签名错误

本地真实模式首次主动刷新当前店铺时，链路已从浏览器经 V2 适配服务、本地代理到达 SHEIN，但 SHEIN 返回：

- `code=openapi00001`；
- `message=签名错误:生成的签名不正确，请检查`；
- 本次经营刷新没有保存新的快照，也没有把失败伪装成成功或 0/0；本机原有 `1,179` 个商品与 `1,179/1,179` 合规任务缓存仍可读取。

当前判断：仓库的签名实现与已确认的官方算法和现有签名专项测试一致，错误更可能来自本机旧店铺授权密钥失效、被撤销或与当前应用授权不匹配；本轮不改签名算法，不把真实接口失败改成演示成功。浏览器已打开“授权或重新授权”入口，需要完成一次 SHEIN 重新授权，换取新的店铺凭证后再重试经营刷新和合规刷新。

真实发布开关、生图执行和所有 SHEIN 写接口继续关闭；重新授权只用于读取凭证交换，不执行发布或商品修改。

## 183. 2026-08-09 修复本地店铺列表混入云端历史授权与备注丢失

本轮针对本地真实模式显示两家店铺、备注回退为 Supplier ID 的问题完成定向修复：

- 本机凭证库中确认存在两条历史记录：`5554076` 为本地 `authorization`，`16814339` 为历史 `cloud-authorization`；没有删除任何凭证；
- V2 本地真实模式现在只展示本地授权来源，云端历史记录保留在本机凭证库但不参与本地页面店铺切换和数据读取；
- 本地代理新增店铺备注元数据重命名接口，备注只写入本机 AES-256-GCM 加密凭证库，不调用 SHEIN 或云端；
- 已将截图中的当前店铺备注 `圣锐达1店` 写回本机凭证元数据，并验证 V2 店铺接口返回 1 家店铺且备注正确；
- 新增凭证库重命名持久化测试和 V2 云端历史店铺隔离测试；

真实发布开关、生图执行和所有 SHEIN 写接口继续关闭。

## 184. 2026-08-09 将真实签名失败转为可操作的重新授权状态

本轮针对本地真实 V2 模式点击“刷新总览”后只显示“出错”的问题完成定向修复，仍未连接云端、执行迁移或调用 SHEIN 写接口：

- SHEIN 返回 `openapi00001` 时，本地 V2 适配服务现在返回稳定错误码 `SHEIN_REAUTHORIZATION_REQUIRED` 和 HTTP 401；原始错误码与 `traceId` 保留在响应中，便于定位，不把真实失败伪装为同步成功或 0/0；
- 经营刷新失败任务的 `lastError` 同样使用可操作的重新授权提示，避免总览刷新失败后又显示含糊的签名错误；
- 总览错误提示在该错误码下增加“重新授权”入口，直接进入店铺管理页完成 SHEIN 授权；
- 新增本地 V2 桥接层回归测试，覆盖真实签名错误映射、HTTP 状态、原始错误码和 traceId；

本轮验证：

- 本地 V2 桥接专项测试：通过；
- 全量测试：`712/712` 通过；
- `npm run build:v2`：通过，仍只有既有大 chunk 提示；
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2"`：`READY`，Release contracts `10/10`，无阻断；
- 本地浏览器点击“刷新总览”后显示重新授权提示，点击入口已跳转到店铺管理页。

当前仍需在本地浏览器完成一次“授权或重新授权”。完成后再点击“刷新总览”验证 SHEIN 真实经营接口；在重新授权完成前，页面显示需要重新授权是正确状态，不应使用旧缓存掩盖失败。真实发布开关、生图执行和所有 SHEIN 写接口继续关闭。

## 185. 2026-08-09 修复本地真实授权回调端口错误

本轮根据浏览器截图修复重新授权后跳转到 `127.0.0.1:5173` 且连接被拒绝的问题，仍未连接云端或调用 SHEIN 写接口：

- 本地直连授权生成的 SHEIN 回调地址改为本机代理的 `/api/shein/auth/callback`，由 Node 代理完成 `tempToken` 交换和加密凭证保存；
- 本地真实 V2 启动器忽略 `.env` 中旧的 `SHEIN_REDIRECT_URL=http://127.0.0.1:5173/`，统一返回 `http://127.0.0.1:5174/app/settings/stores`；
- 授权成功或失败都由代理处理后回到 V2 店铺管理页，避免 SHEIN 将临时授权参数直接交给没有监听的网页端口；
- 普通本地模式和云端授权回调行为保持不变；新增授权地址与启动器回归测试。

本轮验证：

- 授权链路专项：`7/7` 通过；
- 全量测试：`713/713` 通过；
- `npm run build:v2`：通过，仍只有既有大 chunk 提示；
- 实际本地接口返回：`redirectUrl=http://127.0.0.1:5174/app/settings/stores`，SHEIN 回调为
  `http://127.0.0.1:8787/api/shein/auth/callback`；5174、8787、8790 均已恢复监听。

下一步：在已打开的 V2 店铺管理页再次点击“授权或重新授权”，完成 SHEIN 授权后回到页面，再刷新总览验证真实经营数据。真实发布开关、生图执行和所有 SHEIN 写接口继续关闭。

## 186. 2026-08-12 恢复本地真实 V2 服务

本轮处理本地浏览器打不开的问题：确认 `5174` 网页、`8790` V2 桥接和 `8787` 本地授权代理均未监听，原因是本地启动器进程已退出，不是店铺数据或授权丢失。

- 使用独立终端重新启动 `npm run dev:v2:real-local`，避免当前命令行会话结束时连带关闭三个本地服务；
- 已验证网页、桥接健康接口和本地代理健康接口均返回 `200`；
- 浏览器实际打开 `http://127.0.0.1:5174/app/settings/stores`，店铺备注 `圣锐达1店` 和授权按钮均正常显示；
- 未删除本地凭证、缓存或店铺数据，未连接云端、未修改云端配置、未调用 SHEIN 写接口。

后续本地真实模式必须保持一个独立终端运行：

```bash
cd /Users/tianhanwen/Documents/SHEIN爆单了
npm run dev:v2:real-local
```

## 187. 2026-08-12 修复本地任务详情点击后空白

本轮按项目工程规则处理本地真实 V2 任务中心问题，未改同步执行、授权、合规数据和云端代码：

- 根因是本地 V2 任务详情接口对经营刷新和合规同步任务直接返回内部任务对象，缺少前端详情契约要求的 `items` 数组；详情页无条件读取 `detail.items.length`，点击最右侧箭头后触发渲染异常，页面表现为空白；
- 本地 V2 任务详情出口统一补齐 `items: []`，明确表示本地适配任务没有可展示的分批明细；已有任务和运行中的任务都经过同一兼容投影；
- 新增回归测试，覆盖经营刷新任务详情返回空明细数组；同步任务执行链、SHEIN 请求、授权状态和合规同步逻辑未改动；
- 本地浏览器验证：进入 `http://127.0.0.1:5174/app/operations/5554076/jobs`，点击任务右侧箭头后页面保持正常，详情显示“该任务没有分批明细”，没有白屏；

本轮验证：

- 本地 V2 桥接与同步任务 UI 专项测试：`2/2` 通过；
- 全量后端测试：`103/103` 通过；
- `npm run build:v2`：通过，仍只有既有大 chunk 提示；

## 197. 2026-08-26 NEXUS-EVO-10 全量回归与云端发布

本轮完成 NEXUS-EVO-00 至 NEXUS-EVO-09 的发布门禁和云端切换：

- 全量 Node 测试：`1062/1062` 通过；`npm run build:v2` 通过；`npm run release:audit:v2` 返回 `READY`，14/14 合约通过且无阻断；`git diff --check` 通过；
- 发布包：`shein-cloud-deploy-20260826-nexus-evo-10.tar.gz`，SHA-256：`e10048a25e05d58e40fee940a7340d39b05d643fc9e2bcf7e3abfc89eab3815b`；
- 云端 release：`/opt/shein-console/releases/shein-cloud-deploy-20260826-nexus-evo-10`；`/opt/shein-console/current` 已切换到该 release；旧 release 保留，可直接回滚；
- `dist-v2` 与 `dist-web` 已同步，公网 `https://app.hanzhou.icu/` 返回 200，静态入口已使用新构建资产；
- 控制服务仅重建 `control`，内部 `/health` 与 `/ready` 均返回成功，PostgreSQL/Redis 依赖状态正常，容器为 healthy；其他读同步服务、数据库、Redis 和真实发布 Worker 未做无关重启；
- 本轮未执行数据库迁移、未修改生产密钥、未调用 SHEIN 写接口；真实发布开关与生图执行开关保持现有配置。

发布后的回滚点为原 `shein-cloud-deploy-20260826-srf-01-manual-refresh-v2` release；如需回滚，应先停止新的控制服务，再恢复 `current` 指向并按部署说明重建控制服务。
