# SHEIN 接入与产品架构

多人商用部署、4GB 服务器容量和扩展边界见
[`CLOUD_DEPLOYMENT_ARCHITECTURE.md`](./CLOUD_DEPLOYMENT_ARCHITECTURE.md)。

## 1. 产品边界

第一阶段交付本地浏览器版本，用于多轮确认页面、字段和操作流程。第二阶段再接真实 SHEIN 测试环境、云端多租户服务和桌面封装。

核心业务：

1. 单个/批量识别 SKC。
2. 单个/批量创建与编辑商品。
3. 单个/批量处理合规。
4. 商品模板与合规模板。
5. 多店铺销量、风险和任务。

不开发打印中心、条码、箱唛或面单功能。

## 2. 部署边界

### 浏览器或桌面端

- 界面、表格编辑、本地文件选择和图片预校验。
- 只持有登录会话和短时上传授权。
- 不保存 SHEIN `secretKey`。

### 云端服务

- 保存应用级配置及每个授权店铺独立的 `openKeyId + secretKey`。
- 密钥加密存储，解密只发生在签名服务进程内。
- API 签名、批量队列、速率限制、失败重试、审计日志和 Webhook。
- 新店铺授权后写入租户数据表，不需要修改服务器配置或重新部署。

### 文件上传

正式版本采用：

1. 客户端向云端申请某店铺、某接口的短时上传授权。
2. 云端返回限接口、限时间、一次性的上传信息。
3. 客户端在本地校验尺寸、格式和大小后直接上传 SHEIN。
4. 云端只记录 SHEIN 返回的文件标识和业务绑定结果。

永久密钥不下发客户端，大文件也不经过轻量云服务器中转。

## 3. SKC 识别

识别只允许当前授权店铺拥有的 SKC。识别结果不是简单复制，而是重新适配当前规则：

1. 通过商品查询接口定位 SKC、SPU、SKU 和商家 SKU。
2. 使用 `/open-api/goods/spu-info` 读取商品详情。
3. 使用当前类目、发布字段、属性关联规则、站点、品牌和 IP 接口重新校验。
4. 将字段标记为“平台明确返回”“自动映射待确认”“不可复用”。
5. 生成商品模板和合规模板草稿。

商家 SKU、已失效动态 ID、审核上下文和历史实拍图不直接克隆。

### 自建模板

模板有两种来源，必须在数据结构中明确区分：

- `skc_recognition`：从店铺已有 SKC 识别生成。
- `shein_schema`：先选店铺、末级类目和站点，读取 SHEIN 当前发布字段后自建。

商品模板保存字段映射、默认值、图片槽位和变体规则，不保存可直接重放的固定请求报文。合规模板通过参照 SKC 读取要求，保存合规类型和处理策略，不复制参照 SKC 的实拍图或审核结果。

模板每次用于发品或合规处理时，都要重新查询动态规则并生成差异：

1. 新增必填字段：阻断提交并要求补充。
2. 已删除或失效字段：从请求中移除并记录模板升级提示。
3. 枚举值变化：重新映射，无法映射时转人工确认。
4. 合规类型暂不支持 API：明确显示“需商家后台处理”，不得发送伪造请求。

### 模板发品

商品模板支持单个和批量两种模式。提交前依次执行：

1. 单个模式选择一个商品文件夹；批量模式选择根目录，根目录下每个一级子文件夹代表一个商品。
2. 按文件名识别主图、详情图、色块图和独立 SKU 图；SKU 图缺失时允许显式引用该商品主图 1。
3. 先在本地完成格式、尺寸、大小、重复图片和图片槽位校验，不使用 Excel 作为发品数据源。
4. 确认店铺可发品及上架额度。
5. 刷新发布字段、属性、关联规则、站点、品牌和 IP。
6. 校验商家 SKU 在店铺内全局唯一。
7. 上传已通过本地预检的图片并取得 SHEIN 图片地址。
8. 校验商品对应的合规要求。
9. 调用发布接口，保存返回版本号。
10. 区分“平台接收”和“公文审核”两个阶段继续跟踪。

文件命名前缀与槽位映射：

- `main_`：主图，上传 `image_type=1`
- `detail_`：细节图，上传 `image_type=2`
- `square_`：方形图，上传 `image_type=5`
- `swatch_`：色块图，上传 `image_type=6`
- `description_`：详情图，上传 `image_type=7`
- `sku_`：独立 SKU 预览图；未提供时可显式引用主图

自动识别结果必须允许用户逐图调整槽位。调整映射不修改本地文件，只改变待上传任务中的图片用途。

## 4. 商品接口流程

### 发布前

- `/open-api/goods/product/check-publish-permission`
- `/open-api/goods/query-publish-fill-in-standard`
- `/open-api/goods/query-category-tree`
- `/open-api/goods/query-attribute-template`
- `/open-api/goods/get-associated-attribute-rules`
- `/open-api/goods/query-site-list`
- `/open-api/goods/query-brand-list`
- `/open-api/goods/query-ip-list`
- `/open-api/goods/product/check-supplierSku-repeated`

### 图片

- `/open-api/goods/transform-pic`
- `/open-api/goods/upload-pic`

图片类型和本地预校验：

- 主图/细节图：`1340x1785`，或 `1:1` 且边长 `900-2200px`。
- 方形图：`1:1`，边长 `900-2200px`。
- 色块图：`80x80px`。
- 详情图：`3:4`，像素大于 `900px`。
- JPG/JPEG/PNG，单图不超过 `3MB`。

### 提交和状态

- `/open-api/goods/product/publishOrEdit`
- `/open-api/goods/product/partialEdit`
- `/open-api/goods/query-document-state`
- `/open-api/goods/revoke-product`

接收成功和审核成功是两个阶段，分别处理：

- `/product_document_receive_status_notice`
- `/product_document_audit_status_notice`

撤回不会触发商品审核 Webhook，必须主动查询或在本地记录撤回结果。

## 5. 合规完整流程

先调用 `/open-api/goods-compliance-requirements/list`，依据 `complianceGroupCode` 分流。

### 资质证书 `ZSZZL`

- `/open-api/goods-certificates/search`
- `/open-api/goods-certificate-schemas/detail`
- `/open-api/goods-certificate-files/upload`
- `/open-api/goods-certificates/save`
- `/open-api/goods-certificates/bind`

也保留旧证书池接口的兼容适配层，但新旧接口不可在业务代码中混用。

### 代理公司 `GSL`

- `/open-api/goods-compliance/agency-list`
- `/open-api/goods-compliance/skc-agency-detail`
- `/open-api/goods-compliance/save-skc-agency`

### 警告语 `HGXXL`

- `/open-api/goods-compliance/query-warning-certificate-rules`
- `/open-api/goods-compliance/query-skc-warning-status`
- `/open-api/goods-compliance/update-skc-warning-certificate`

只有 `isManualProductWarning=true` 的警告语可通过当前开放接口创建。其他未开放的合规类型在界面中显示“平台暂不支持 API 处理”，不能伪装成可提交。

### 实拍图

- `/open-api/goods-compliance/skc-label-list`
- `/open-api/goods-compliance/get-label-template`
- `/open-api/goods-compliance/upload-skc-label-picture`
- `/open-api/goods-compliance/skc-save-label`

合规模板复用填写规则和图片槽位，不复用其他 SKC 的历史实拍图。每次绑定前重新查询当前 SKC 要求。

### 失效事件

`/product_compliance_change_notice` 到达后立即把对应 SKC 标记为风险，并主动回查平台状态。

## 6. 批量引擎

批量不是前端循环调用，而是云端任务：

1. 导入并规范化数据。
2. 去重和格式校验。
3. 按店铺、接口和业务依赖分组。
4. 按文档单次上限拆批。
5. 使用店铺级令牌桶限制 QPS。
6. 保存每条记录的请求摘要、结果、`traceId` 和重试次数。
7. 只重试网络错误、限流和明确可重试错误；字段错误进入人工修正。

已确认的部分上限：

- SKU 销量：单次最多 100 个 SKU，平台提示 QPS 40/s。
- 商家 SKU 查重：单次最多 200 个。
- 商品删除预校验：单次最多 50 个 SKC。
- 建议零售价提交：单次最多 10 个 SKC。

其他接口必须由接口元数据配置，不允许在组件中写死统一批次大小。

## 7. 销量总览

`/open-api/goods/query-sku-sales` 返回：

- `realTimeSaleCnt`：当日销量
- `cydSaleCnt`：昨日销量
- `c7dSaleCnt`：7日销量
- `c30dSaleCnt`：30日销量
- `dt`：统计截止日期

服务端按店铺分批查询全部 SKU 后聚合。页面显示数据更新时间，避免把平台每日统计值误称为严格实时数据。

## 8. Webhook

云端提供生产和测试两个公网 HTTPS 地址。接收器必须：

- 快速验签、落库并返回成功。
- 支持对象、`data` 对象、`data` 字符串化 JSON 和整体字符串化 JSON。
- 使用事件类型、店铺、业务单号和时间生成幂等键。
- Webhook 触发增量同步，定时任务负责最终一致性。
- 记录原始载荷、解析结果和处理状态，但日志中脱敏密钥及隐私信息。

关键事件包括商品接收/审核、价格、建议零售价、额度、删除审核、采购单、发货单、缺货、合规失效和授权关系变化。

## 9. 文档矛盾处理

SHEIN 文档示例存在路径、字段类型或 Header 命名不一致的情况。实现规则：

1. 以页面标题中的正式方法和路径为主，curl 示例只作为参考。
2. 使用测试环境真实响应校准类型。
3. 对响应做宽容解析，对请求做严格校验。
4. 每个差异记录文档更新时间、测试日期、请求摘要和 `traceId`。
5. 未经测试确认的字段不进入生产批量任务。

例如部分采购退货示例出现重复 `/open-api/open-api/`，实现时不得照抄示例路径。

## 10. 原型到生产

当前 React 原型完成后按顺序推进：

1. 确认页面、字段和操作流程。
2. 建立 API Schema、Mock Server 和契约测试。
3. 接测试店铺，先打通只读查询。
4. 打通单个商品和单个合规写入。
5. 打通文件直传。
6. 上批量队列、限流、审计和 Webhook。
7. 多店铺压力测试和失败恢复演练。
8. 最后评估 Tauri 桌面封装。
