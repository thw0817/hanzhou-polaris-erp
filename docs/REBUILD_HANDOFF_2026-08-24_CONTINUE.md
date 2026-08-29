# SHEIN超级运营中心｜重建交接文档（2026-08-24 继续）

## 一、当前项目与线上入口

- 本地项目：`/Users/tianhanwen/Documents/SHEIN爆单了`
- 线上网站：`https://app.hanzhou.icu`
- 线上 API：`https://api.hanzhou.icu`
- 当前云端服务器公网 IP：`42.193.179.216`
- 当前云端 release：`/opt/shein-console/releases/shein-cloud-deploy-20260825-compliance-overflow-v1`
- 当前线上版本最后一次已验证部署包：`shein-cloud-deploy-20260825-compliance-overflow-v1.tar.gz`
- 最后一次已验证 SHA-256：`9be2bc5b07b7f1adf3c8467de8add33d1339e463525df579b78e530702060afe`
- SSH 用户为 `ubuntu`。私钥、SHEIN 密钥、邮箱授权码、数据库密码不得写入交接文档或聊天。

## 二、最近已经完成并部署的功能

1. 网站品牌统一为“**SHEIN超级运营中心**”。
2. 注册、登录、忘记密码、重置密码已接入；当前邮箱发送使用 SMTP 配置，敏感配置只保存在云端环境文件。
3. 用户、工作空间、店铺和商品数据按访问边界隔离；管理员可以查看管理范围内店铺，普通成员只能查看自己授权的店铺。
4. 管理员创建的普通模板已恢复为工作空间共享；成员可以读取共享模板，也可以创建、修改、删除自己的模板。
5. 管理员修改店铺别称只影响管理员视图，不改变成员所见的店铺别称。
6. 商品草稿已支持主图缩略图、前两级类目路径显示、批量删除和释放空间。
7. 批量建品已支持主图、通用轮播图、SKU 预览图、方块图、水印应用等既有流程。
8. 合规工作台已隐藏技术审计入口，合规同步入口已合并为一个“合规同步”。
9. 合规工作台已增加批量上传 1630/1631、包装实拍图、商品本体实拍图的草稿入口；1630/1631 要求报告生效日期，实拍图支持模板引用或重新上传。
10. 销量与库存、合规工作台的平台状态只接受 SHEIN 真实回读，不再根据库存、销量或标题猜测状态；缺少可靠回读时显示“待同步”。
11. 合规工作台已增加平台状态列，支持待上架、已上架、已下架、已售罄等状态。
12. 合规工作台已隐藏证书、代理公司、警示语等不需要在列表展示的列。
13. 合规工作台已加入商品主图缩略图和类目展示的基础回退逻辑。
14. 事件订阅、规则同步、合规同步、商品发布 worker、媒体清理、Webhook、PostgreSQL、Redis 均已保留运行。

## 三、当前最新反馈（本轮必须先处理）

### 1. 总览页错误切换店铺

用户反馈：点击“总览”后，网站自动切换到了另一家店铺。

初步原因已定位：

- `src-v2/app/AppShell.tsx` 当前主要从路径解析 `storeId`。
- `/app/overview` 没有携带店铺 ID，因此 `currentStore` 回退为 `stores[0]`。
- 总览页 `src-v2/features/overview/OverviewPage.tsx` 当前仍使用 `useQueries` 查询所有店铺并展示跨店铺对比。

目标行为：

- 总览只展示当前已选店铺。
- 从任意页面进入总览，不得自动切换店铺。
- 店铺选择后要持久化当前选择；重新进入总览、刷新浏览器、切换模块时仍使用该店铺。
- 切换店铺必须保持用户隔离，不能读取其他用户店铺。
- 总览刷新只刷新当前店铺，不得对所有店铺发起 SHEIN 请求。

建议实现：

- 在 `AppShell` 中增加安全的 `localStorage` 当前店铺 ID 持久化。
- 总览支持 `?store=<storeId>`，但优先使用已选择且仍有访问权限的店铺。
- `selectStore` 选择店铺时更新持久化值；进入 `/app/overview` 时保留当前选择。
- `OverviewPage` 改为单个 `useQuery` 查询 `currentStore`，移除跨店铺 `useQueries`、跨店铺刷新和“店铺对比”文案。

### 2. 合规同步后仍显示“待同步”

用户反馈：在合规工作台点击同步后，商品的总体、包装实拍、商品实拍等信息仍显示“待同步”。

初步检查：

- `src-v2/features/compliance/CompliancePage.tsx` 已有同步任务查询和完成后的 invalidate，但完成状态只检查了 `succeeded`。
- 需要核对服务端同步任务的真实终态是否可能为 `completed`、`success` 或其他值。
- 合规查询必须在同步任务成功结束后重新读取当前店铺的 workspace 数据，而不是只刷新前端缓存。
- 如果 SHEIN 没有返回某项状态，必须继续显示“待同步”，不能伪造为通过或失败。

目标行为：

- 点击“合规同步”后，启动真实同步任务。
- 任务结束后，等待服务端保存完成，再重新查询当前店铺的合规列表和汇总。
- 页面状态、主图、类目、总体、包装实拍、商品实拍都必须来自最新回读。
- 失败时显示真实失败原因；不得吞掉任务失败原因。
- 同步只作用于当前店铺，不得跨店铺刷新。

建议检查位置：

- `src-v2/features/compliance/CompliancePage.tsx`
- `server/index.js` 中合规任务状态与 `publicComplianceJob`
- `server/cloud/compliance-sync-service.js`
- `server/cloud/compliance-sync-worker.js`
- `server/cloud/compliance-workspace-service.js`
- 合规同步 repository 的保存与查询逻辑

### 3. 合规列表仍显示类目 ID，主图仍可能为空

用户截图中仍看到：

- `类目 3155`
- 主图位置为空占位图
- 合规状态为“未同步”

目标行为：

- 类目优先显示真实路径，例如：`家居-地毯`、`家纺-地毯`。
- 不能把 `Category ID` 当作类目名称展示；无法得到真实路径时显示“未分类”。
- 主图优先读取 SHEIN 商品真实主图或缓存中的主图 URL，正常显示缩略图。
- 没有真实主图时显示明确空状态，不得误认为已同步。

建议检查位置：

- `src-v2/features/compliance/CompliancePage.tsx` 的 `categoryLabel`
- `server/cloud/compliance-workspace-service.js` 的 `publicCachedSkc`
- `server/shein-product.js` 的 `normalizeProductSearch`
- `server/cloud/store-business-service.js`
- 商品同步时是否把 `categoryPath`、`categoryName`、`imageUrl` 写入 raw/cache 数据

必须兼容的类目字段候选：

- `categoryPath`
- `categoryNamePath`
- `categoryNames`
- `categoryNameList`
- `category.path`
- `category.names`
- `categoryInfo.path`
- `categoryInfo.names`

必须兼容的主图字段候选：

- `imageUrl`
- `mainImageUrl`
- `main_image_url`
- `mainPicUrl`
- `mainPic`
- `skcMainPicUrl`
- `productImageUrl`
- `imageList[0]`
- `images.main[0]`

## 四、必须先写的回归测试

在修改实现前，先补充会失败的回归测试：

1. 总览页只查询并展示 `currentStore`，不再使用 `useQueries` 查询全部店铺。
2. 总览页切换店铺后进入总览仍保持选中的店铺。
3. 合规同步任务终态成功后会重新读取 workspace，而非只修改本地提示。
4. 合规同步任务失败时会保留并展示服务端失败原因。
5. 合规列表能从 raw/cache 读取主图 URL。
6. 合规列表能从 raw/cache 读取类目路径。
7. 只有数字类目或 `类目 3155` 等旧值时显示“未分类”。
8. 当前用户和当前店铺访问边界测试必须继续通过。

现有相关测试：

- `server/cloud/v2-overview-ui.test.js`
- `server/cloud/compliance-workspace-service.test.js`
- `server/cloud/compliance-ui.test.js`
- `server/shein-product.test.js`
- `server/cloud/web-auth.test.js`

## 五、执行顺序

1. 读取本交接文档并检查工作树，保留用户已有修改，不做 reset/clean。
2. 先补充上述失败回归测试。
3. 修复 AppShell 当前店铺持久化和总览单店铺查询。
4. 修复合规同步任务完成后的服务端回读与前端刷新。
5. 修复类目路径与主图字段归一化和回退。
6. 运行定向测试。
7. 运行全量测试：`node --test server/*.test.js` 或项目现行完整测试命令。
8. 运行：
   - `npm run build:v2`
   - `npm run release:audit:v2`
   - `git diff --check`
9. 用本地浏览器检查：店铺切换、总览、合规同步、类目路径、主图缩略图和用户隔离。
10. 生成带时间版本号的部署包，先校验 SHA-256，再原子切换云端 `current`。
11. 云端只重建需要重建的 control/UI 服务；不要重启数据库、Redis、商品发布 worker 或合规同步 worker，除非确有必要。
12. 部署后核验：
    - 内部 `/health`、`/ready`
    - 公网 `https://api.hanzhou.icu/health`
    - 公网 `https://app.hanzhou.icu/`
    - control 容器 healthy
    - 相关 worker running
    - 线上静态资源确实包含本次修复文案

## 六、明确禁止事项

- 不调用 SHEIN 商品/合规写接口，不提交真实商品，除非用户在新对话中明确要求测试真实提交。
- 不消费一次性发布授权。
- 不读取、展示或写入密码、SHEIN 私钥、SMTP 授权码、Resend 密钥。
- 不把所有店铺数据合并到总览或合规页面。
- 不因为接口失败而猜测“已上架”“已售罄”“已通过”。
- 不用类目 ID 伪装成类目路径。
- 不执行 `git reset --hard`、`git checkout --`、递归删除或清理用户文件。

## 七、新对话第一句话

请从本文件开始，先确认当前工作树和上述两个未完成问题，然后按“先写失败回归测试，再修复，再本地验证，最后云端部署”的顺序继续。不要从头重新设计项目，也不要重复已经完成的功能。

## 八、完整资料包与 SHEIN API 文档索引

本文件是当前工作的入口，不替代字段原文。新对话必须把下面文件和目录视为同一个交接资料包；任何接口字段、枚举、请求体、返回体、限流或官方语义，都必须回到原文核对，不能凭记忆补字段。

### 8.1 必读资料顺序

1. `docs/REBUILD_HANDOFF_2026-08-24_CONTINUE.md`：当前线上状态、未完成问题、执行顺序。
2. `docs/REBUILD_HANDOFF_2026-08-12_CONTINUE.md`：完整历史需求、已完成变更、历次线上验收和用户确认；该文件包含第 1—129 节，不能只读摘要。
3. `docs/SHEIN_API_SOURCE_INDEX.md`：API 原始资料的总索引和“原始响应优先”规则。
4. `docs/SHEIN_API_FIELD_HANDOFF.md`：按业务域整理的字段、端点、限流、Webhook、矛盾和缺口。
5. `docs/V2_SHEIN_API_CAPABILITY_MATRIX.md`：V2 端点能力、读写性质、冻结边界、测试状态。
6. `docs/SHEIN_INTEGRATION_BLUEPRINT.md`：浏览器/云端边界、商品、合规、Webhook 和批量流程。
7. `docs/SHEIN_PRODUCT_PUBLISH_CONTRACT.md`：商品发布载荷、图片、SKU、尺寸、回读和失败反馈契约。
8. `docs/V2_DATA_PERMISSION_MODEL.md`：租户、用户、工作空间、店铺、模板、同步任务和行级权限。
9. `docs/CLOUD_DEPLOYMENT_ARCHITECTURE.md`：云端拓扑、Worker、Webhook、缓存、媒体清理和部署边界。
10. `docs/COMPLIANCE_FREEZE_2026-08-22.md`、`docs/NEW_PRODUCT_TEMU_ALIGNMENT_2026-08-22.md`：合规冻结基线和新建商品对齐边界。

### 8.2 SHEIN API 原始资料

`docs/shein-api-raw/` 目录内的全部文件都是交接资料的一部分，不能只读取其中几个文件。本次核对该目录共 55 个文件，后续以目录实际文件数为准。当前包含：

- 归档的 SHEIN 官方接口原文 `.txt` 文件：类目、属性、商品发布、图片、价格、库存、采购、发货、退货、财务和 Webhook 等全部域。
- 三份已整理的官方实拍图文档：
  - `docs/shein-api-raw/official-upload-skc-label-picture-2025-06-27.md`
  - `docs/shein-api-raw/official-skc-save-label-2025-09-29.md`
  - `docs/shein-api-raw/official-skc-label-list-2025-09-24.md`

核对完整性使用：

```bash
rg --files docs/shein-api-raw | sort
```

不把原始全文复制进本交接文档，是为了避免同一字段出现两份互相漂移的版本；上面目录的全部文件、`SHEIN_API_SOURCE_INDEX.md` 的映射和本节的端点清单共同构成完整 API 资料。若原始文档、历史摘要和当前真实店铺响应冲突，优先级固定为：

```text
当前真实店铺动态响应 > docs/shein-api-raw/ 原始文档 > 字段交接摘要 > curl 示例
```

### 8.3 当前项目涉及的 API 端点总表

以下是按业务域的完整实施地图；字段细节和每个端点的原始文件映射以 `SHEIN_API_SOURCE_INDEX.md`、`SHEIN_API_FIELD_HANDOFF.md` 和 `V2_SHEIN_API_CAPABILITY_MATRIX.md` 为准。

#### 鉴权、店铺与基础信息

- SHEIN `openKeyId`、13 位毫秒时间戳、签名、语言请求头及店铺授权回读。
- Webhook 正式入口：`POST /webhooks/shein`。
- Webhook 测试入口：`POST /webhooks/shein/test`。
- 店铺站点和币种：`POST /open-api/goods/query-site-list`。

#### 商品、类目、属性与模板

- 商品综合查询：`POST /open-api/goods/searchProduct`。
- 商品列表：`POST /open-api/openapi-business-backend/product/query`。
- SPU 详情：`POST /open-api/goods/spu-info`。
- 旧 SKU 全量详情：`/open-api/openapi-business-backend/product/full-detail`，已标记即将作废，不得新增依赖。
- 类目树：`POST /open-api/goods/query-category-tree`。
- 类目属性模板：`POST /open-api/goods/query-attribute-template`。
- 发布填写规范：`POST /open-api/goods/query-publish-fill-in-standard`。
- 关联属性规则：`POST /open-api/goods/get-associated-attribute-rules`。
- 自定义属性权限：`POST /open-api/goods/get-custom-attribute-permission-config`。
- 添加自定义属性值：`POST /open-api/goods/add-custom-attribute-value`。
- 品牌：`POST /open-api/goods/query-brand-list`。
- IP：`POST /open-api/goods/query-ip-list`。
- 环保耗材/材料规则：`POST /open-api/goods-quality/environmental-label-rule/material-quality-tree-v2`。

#### 商品图片、发布、审核与上下架

- 图片上传：`POST /open-api/goods/upload-pic`。
- 图片转换：`POST /open-api/goods/transform-pic`，除非原始规则明确需要，否则不新增依赖。
- 发品权限：`POST /open-api/goods/product/check-publish-permission`。
- 发品额度：`POST /open-api/goods-publish-quotas/detail`。
- 商家 SKU 查重：`POST /open-api/goods/product/check-supplierSku-repeated`。
- 商品发布/编辑：`POST /open-api/goods/product/publishOrEdit`。
- 商品部分编辑：`POST /open-api/goods/product/partialEdit`。
- 商品审核状态：`POST /open-api/goods/query-document-state`。
- 撤回商品：`POST /open-api/goods/revoke-product`。
- 商品上下架：`POST /open-api/goods/modify-skc-shelf`。
- 删除预校验：`POST /open-api/goods/check-deletable`。
- 提交删除申请：`POST /open-api/goods/delete/{skcName}`。
- 删除审核记录：`POST /open-api/goods-delete-logs/search`。

#### 商品价格、议价和库存

- 商品售价、成本价、变价原因、价格证明、议价单、建议零售价相关接口，完整端点以字段交接第 9 节和能力矩阵价格域为准。
- SKU 销量：`POST /open-api/goods/query-sku-sales`。
- 库存查询：`POST /open-api/stock/stock-query`。
- 仓库列表：`GET /open-api/msc/warehouse/list`。
- 采购、发货、物流、退货、财务相关接口，完整端点以字段交接第 10—13 节为准；遇到示例中重复的 `/open-api/open-api/` 时，只保留一个 `/open-api/`。

#### 合规、证书、1630/1631 和实拍图

- 合规要求：`POST /open-api/goods-compliance-requirements/list`。
- 实拍图要求：`POST /open-api/goods-compliance/skc-label-list`。
- 实拍图模板：`POST /open-api/goods-compliance/get-label-template`。
- 本地实拍图上传：`POST /open-api/goods-compliance/upload-skc-label-picture`。
- SKC 绑定实拍图：`POST /open-api/goods-compliance/skc-save-label`。
- 证书列表：`POST /open-api/goods-certificates/search`。
- 证书 Schema：`POST /open-api/goods-certificate-schemas/detail`。
- 证书文件上传：`POST /open-api/goods-certificate-files/upload`。
- 证书创建/编辑：`POST /open-api/goods-certificates/save`。
- SKC 绑定证书：`POST /open-api/goods-certificates/bind`。
- 代理公司列表/详情/绑定：`/open-api/goods-compliance/agency-list`、`/open-api/goods-compliance/skc-agency-detail`、`/open-api/goods-compliance/save-skc-agency`。
- 警示语规则/状态/更新：`/open-api/goods-compliance/query-warning-certificate-rules`、`/open-api/goods-compliance/query-skc-warning-status`、`/open-api/goods-compliance/update-skc-warning-certificate`。
- 合规标签打印：`POST /open-api/goods-compliance/label-print`。

实拍图字段必须严格区分：

```text
上传接口：multipart file -> info.imageUrl + info.imageMd5
绑定接口：skcList + packageLableList + bodyLableList
```

其中 `packageLableList` 是商品包装实拍图，`bodyLableList` 是商品本体实拍图；旧字段 `skcLablePicList` 已标记后续废弃，不能继续对接。包装图和本体图不能混用。1630/1631 报告属于商品独立证书材料，不是实拍图字段：报告类型、报告文件、报告生效日期必须独立记录；1630 和 1631 不能共用同一商品绑定，模板引用时继承模板日期，但每个 SKC 仍独立创建/绑定。

### 8.4 通用请求与响应约束

SHEIN API 请求通常需要：`Content-Type: application/json`、`x-lt-openKeyId`、`x-lt-timestamp`（毫秒）、`x-lt-signature`，可选 `language`。文件上传按官方原文使用 multipart，不得强行改成 JSON。服务端必须保留并向 UI 传递 `code`、`msg`、`traceId` 和失败明细；不能把网络超时、限流、IP 白名单问题伪装成店铺失效或业务失败。

限流、批量上限和文件格式以原始文档为准；已核对的关键限制包括：实拍图上传与绑定约 20 QPS、实拍图单文件不超过 10 MB、长宽不超过 8000px；商品发布存在 SKC/SKU 批量限制；销量查询有 SKU 批量和 QPS 限制。所有页面刷新必须走当前店铺的服务端缓存/同步任务，不能在浏览器直接循环打 SHEIN。

## 九、完整业务规则与不可遗漏的用户确认

### 9.1 数据与权限

- 数据边界是“用户/工作空间 → 店铺 → 商品/SKC/SKU”；普通成员不能看到其他用户、其他店铺或其他店铺的草稿。
- 总览、商品经营、销量与库存、经营预警、合规工作台只显示当前选中店铺；切换店铺只改变视图，不删除原店铺数据和草稿。
- 管理员可以查看授权范围内店铺，但管理员改店铺别称只保存管理员视图别称，不回写成员视图。
- 管理员同步的类目、属性、发布规则快照对工作空间成员共享复用；成员不能发起全量类目/属性同步，避免重复请求压垮服务器。
- 管理员创建的模板全站/工作空间共享；成员可读取共享模板，并可创建、修改、删除自己的模板。模板数据和商品数据仍按权限隔离。
- SHEIN 密钥、SMTP 授权码、Resend 密钥、数据库密码、SSH 私钥只能放云端环境或密钥存储，绝不写入代码、日志、交接文档或聊天。

### 9.2 合规

- 合规列表失败项优先展示，成功项可折叠；不要把证书、代理公司、警示语等技术细节挤在主列表。
- 包装实拍图和商品本体实拍图分别对应 SHEIN 两个字段；包装实拍图通常可多选两张，本体实拍图不是默认必传，必须以当前 SKC 的 SHEIN 要求为准。
- 实拍图支持模板引用、批量勾选 SKC 重新上传、缩略图预览、删除/替换本地待提交图；不能声称能读取或删除 SHEIN 历史图片，除非官方接口真实返回对应能力。
- 1630/1631 报告分别建模、分别引用、分别绑定，每个 SKC 需要报告日期；报告缺失在合规工作台提示，但按已确认规则不能成为普通商品发布页面的硬阻断，商品发布后按 SHEIN 返回处理。
- 1630/1631 判定只使用当前官方属性回读：面积大于 2.16m² 或最长边大于 1.8m 任一为“是”时为 1630；两项均为“否”时为 1631；缺项、未知值或来源不可信时显示待确认，不能猜。
- 合规同步结束后必须重新读取当前店铺服务端数据；没有真实回读的字段显示“待同步”，不能显示“通过”。

### 9.3 新建商品与批量建品

- 文件夹导入后图片默认进入商品主图；第一张主图在顶部，可拖动排序；通用轮播图引用/上传后即时追加到主图之后。
- 商品属性默认收起，展开后必填项在前、选填项在后；不显示商品描述、站点详情和内部测试状态。
- 家纺尺寸模板使用 `1pc + 长×宽 cm`，尺寸按用户约定小边在前，例如 `40×60`；写入 SHEIN 时必须转换到该类目的正式 `size_attribute_list` 值，不能只保存本地文本。
- 商家 SKC 自动按类目+日期+序号生成，不能含顿号；商家 SKU 非必填。发布设置统一使用已确认默认值：商城可售、采购可采、无需到仓、自动上架，不在页面单独暴露。
- SKU 预览图可不填；一旦一个 SKU 指定图片，其余 SKU 必须全部指定。支持主图引用、批量选择、缩略图/大图查看、自由裁剪和 OCR/文件名辅助匹配；OCR 不可用时必须保留手工选择。
- 方块图/色块图只能使用真实商品主图生成，允许鼠标取色、自由裁剪、预览、确认后立即保存；失败必须显示原因，不得静默无响应。
- 水印支持自定义文字、大小、颜色/透明度、满屏应用、恢复原图和记忆上次设置；图片超过 3 MB 时可在浏览器压缩并显示上传进度，不能破坏原图回退。
- 批量建品列表至少显示商品主图缩略图、标题摘要、完整前两级类目、SKU 尺寸与对应价格/克重；打包信息不放在总表中，进入单个 SKC 二级编辑页查看。支持批量/单个删除、批量引用标题、批量引用通用图片和批量水印应用。
- 打开单个 SKC 用二级页面/弹层，不需要先保存才能查看，不能因为打开一个 SKC 而从批量列表移除其他 SKC。

### 9.4 发布、状态和刷新

- 发布中心直接展示当前店铺商品列表，显示主图缩略图、标题摘要、前两级类目和每个 SKC 的任务 ID（日期+序号）；支持勾选批量发布和单个发布。
- 发品额度可以在提交前提示，但最终是否可发由 SHEIN 真实 API 返回；不要在本地创建复杂的冻结快照/伪批次来替代真实提交。
- SHEIN 返回失败时，逐商品、逐字段显示真实原因、`code` 和 `traceId`，支持返回草稿修正后重发；“已提交，等待回读”只表示真实写接口已接受且尚未完成回读，不能当作发布成功。
- 商品审核、接收、额度、合规失效、授权变更等 Webhook 先验签落库、幂等入队，再由 Worker 更新投影；审核很慢时用户手动刷新即可，不使用 8 秒高频轮询。
- 总览、商品经营、销量与库存、经营预警、合规工作台的刷新必须是当前店铺的真实同步：优先读取新鲜缓存；用户明确点击刷新时创建限流同步任务；任务结束后重新读取服务端投影。没有新数据就显示最后同步时间，不伪造变化。
- 商品经营和销量库存的“已上架、已下架、已售罄、售完下架、待上架”等标签只来自 SHEIN 真实回读或已验签事件，不根据库存数量猜测。

## 十、必须使用的 Skill、工具和行为规则

### 10.1 本项目强制 Skill

以下 Skill 适用于本项目的代码修改、调试、测试或部署，必须在开始动作前完整读取：

- `shein-rebuild-guardrails`：`/Users/tianhanwen/.codex/skills/shein-rebuild-guardrails/SKILL.md`。强制执行边界、回归优先、模块归属、错误透传和发布门禁。
- `karpathy-guidelines`：`/Users/tianhanwen/.codex/skills/karpathy-guidelines/SKILL.md`。要求先明确假设和验收标准，做最小外科式修改，不顺手重构。

按任务需要使用：

- `browser:control-in-app-browser`：本地浏览器或应用内浏览器验收、截图和检查登录态。
- `chrome:control-chrome`：必须依赖用户现有 Chrome 登录态时使用。
- `shein-full-service-rug-operator`：涉及地毯/地垫/家纺类目业务规则、标题、属性、价格或合规判断时使用。
- `temu-full-managed-rug-erp`：只有对照 TEMU 自建商品架构或迁移思路时使用；不能把 TEMU/RPA 逻辑直接混入 SHEIN API 链路。

不适用时不要强行使用 Sites、文档、表格、PDF、ImageGen 等 Skill；本项目当前部署链路是 Docker/SSH，不是 Sites Hosting。

### 10.2 每次修复的强制闭环

```text
读取本交接与相关 Skill
→ 检查 git 状态和当前实现
→ 定位 UI/V2/API/适配器/缓存/任务/Worker/云端层
→ 先写能复现问题的失败回归测试
→ 做最小修改
→ 定向测试和受影响测试
→ node --test server/*.test.js
→ npm run build:v2（涉及 V2 时）
→ npm run release:audit:v2
→ git diff --check
→ 本地浏览器验收
→ 只有用户明确要求时才做真实 SHEIN 写入或云端部署
→ SHA-256、健康检查、Worker 状态和线上页面复核
```

任何门禁无法运行都必须写明原因，不能宣称完成。已冻结且与当前问题无关的合规模块不能随意改动；跨模块修改必须补充每个消费者的回归测试。

### 10.3 绝对禁止

- 不使用 RPA 代替已有 SHEIN API。
- 不把 SHEIN 写接口放到浏览器直连；签名、密钥、限流、重试和写入都在云端服务端。
- 不在没有用户明确确认时调用真实商品发布、合规绑定、覆盖/删除、证书写入等接口。
- 不重复消耗一次性发布授权，不重试不确定是否已提交的写请求；必须先查任务/回执/幂等状态。
- 不把 SHEIN 网络错误、限流、签名错误、权限错误混成“店铺无效”。
- 不制造状态、类目、图片、审核结果、库存或失败原因；缺数据就显示未同步/未知。
- 不执行 `git reset --hard`、`git checkout --`、递归删除或清理用户文件。
- 不把密钥、授权码、密码、私钥、完整 Cookie、真实图片 URL 查询参数写进日志、截图、交接文档或回复。

## 十一、当前交接完成性检查表

新对话开始时必须逐项确认：

- [ ] 已读取本文件和原始完整交接 `REBUILD_HANDOFF_2026-08-12_CONTINUE.md`。
- [ ] 已读取 API 索引、字段交接、能力矩阵、发布契约、集成蓝图和权限模型。
- [ ] 已确认 `docs/shein-api-raw/` 全目录存在且没有遗漏官方实拍图三份文档。
- [ ] 已确认当前线上入口、API 入口、公网 IP 和最后一次 release 仅作为参考，部署前重新探测，不盲信旧记录。
- [ ] 已确认当前选中店铺没有被总览自动切换，所有查询带当前用户和店铺权限边界。
- [ ] 已确认合规同步后的真实回读、类目路径、主图缩略图三个未完成问题已有失败测试。
- [ ] 已确认真实写接口是否打开只以当前用户的明确指令为准。
- [ ] 已完成测试、构建、审计、浏览器验收和部署后健康检查，才可报告完成。

## 十二、2026-08-24 官方 1630/1631 工作流与商品审核主图修复部署

- 合规工作台不再根据本地商品属性自行判定 1630/1631。列表、详情、批量草稿和发布后复验统一以 SHEIN 当前 SKC 合规要求回读为唯一报告类型来源；官方类型未返回时显示等待，不允许手工选择或猜测，返回后才允许单个或同类型批量上传。混合选择 1630 与 1631 时要求分组处理。
- 新建商品和发布候选不再保存或执行本地报告类型预判，也不再以本地属性判定作为发布阻断；SKC 生成后等待 SHEIN 官方要求，再补充对应报告文件与日期。历史草稿字段和分类工具仅保留兼容，不参与当前操作流程。
- 商品审核中心的外部审核记录增加本地草稿主图回退：发布任务按 SHEIN version 关联原商品草稿，返回首张主图素材 ID，前端优先通过受权限保护的下载票据显示缩略图；同时扩充 SHEIN SKC/SPU 快照主图字段兼容。涵舟-家纺2店当前审核记录已只读核验关联到状态为 `referenced` 且未删除的主图素材。
- 回归测试覆盖官方要求优先、未回读等待、批量同类型限制、商品创建等待、复验材料匹配和审核主图回退；定向测试和全量 `node --test --test-reporter=dot` 均通过。`npm run build:v2` 通过，`dist-v2` 与 Nginx 使用的 `dist-web` 已同步，两个静态目录的发布审计均为 `READY`、14/14 契约、阻断为 0；本地浏览器验收确认合规页不再提供手工报告类型选择，商品审核中心正常加载且布局未挤压。
- 部署包为 `shein-cloud-deploy-20260824-official-compliance-review-image-v1.tar.gz`，SHA-256 为 `d1c95632ae6e5409ad6933e86e2e1609ffd6f7121d222a342c4553244f4b49c5`。云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260824-official-compliance-review-image-v1`，仅重建 `deploy-control-1`；商品发布、合规同步、经营同步 Worker、PostgreSQL 和 Redis 的容器 ID 均保持不变，未执行数据库迁移。
- 部署后 control 为 `healthy`，内部 `/health`、`/ready` 和公网 `https://api.hanzhou.icu/health` 均正常；公网 `https://app.hanzhou.icu/` 返回 HTTP 200 并加载 `assets/index-BdIIlNBz.js`。线上静态资源已确认包含“SHEIN 官方报告要求”和等待官方类型文案，不包含旧“商品属性与 1630/1631 判定”文案。本轮未消费一次性发布授权，未调用 SHEIN 商品或合规写接口，未提交真实商品。

## 十三、2026-08-24 批量建品标题上限与草稿保存修复部署

- 根因是批量建品把完整商品标题同时作为内部草稿名称提交，而草稿名称服务端有独立的 160 字符保护；因此 161—250 字符的合法 SHEIN 标题在草稿保存阶段被错误拦截。该提示合并了“为空”和“超长”两个分支，所以标题不为空时仍显示“不能为空”。
- 批量保存现已分离两个字段：`draft.name` 仅作为内部列表标签并安全截到 160 字符，`draft.data.title` 保留完整商品标题，不再被内部名称截断。服务端同时兼容部署前已打开的旧批量页面：即使旧页面仍把完整标题作为草稿名提交，服务端也只规范化内部名称并保留完整商品标题，因此用户不必刷新页面或重新导入未保存商品。商品标题仍按 SHEIN 当前类目的 `default_language_title_max_length` 动态规则处理，不把 250 写死为全平台规则。
- 批量建品选择商品属性或尺寸模板后，会按模板类目读取当前发布规范；总表和单个 SKC 二级编辑弹层均显示 `SHEIN标题：当前字数/官方上限`，输入框使用官方上限，标题规则模板若生成超长标题则在当前商品阻断摘要中明确提示。当前工作空间的地毯类目 3155、8627 只读回读均为默认语种 `zh-cn`、上限 250 字符。
- 新增 250 字符标题与160字符内部草稿名分离回归、旧页面服务端兼容回归，并补齐批量页面读取官方发布规范、字数提示和保存字段契约；最终定向测试 64/64、`node --test server/*.test.js` 122/122、全量 `node --test --test-reporter=dot` 均通过。`npm run build:v2` 通过，`dist-v2` 与 `dist-web` 发布审计均为 `READY`、14/14 契约、阻断为 0；本地浏览器验收确认批量建品路由正常且无控制台错误。
- 最终部署包为 `shein-cloud-deploy-20260824-batch-title-limit-v2.tar.gz`，SHA-256 为 `273c06842d349e93af8aed54622f462c2009ca5a4068af30e2a2d30c0288ecdb`。云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260824-batch-title-limit-v2`，仅重建 `deploy-control-1`；商品发布、合规同步、经营同步 Worker、PostgreSQL 和 Redis 的容器 ID 均未变化，未执行数据库迁移。
- 部署后 control 为 `healthy`，内部 `/health`、`/ready`、公网 `https://api.hanzhou.icu/health` 和 `https://app.hanzhou.icu/` 均正常；公网加载 `assets/index-DnEDuiT5.js`，已确认包含 `SHEIN标题` 和 `default_language_title_max_length`。本轮未调用 SHEIN 商品或合规写接口，未提交真实商品。

## 十四、2026-08-24 管理员共享轮播图模板跨店引用修复部署

- 线上只读核验确认：公开注册用户位于同一网站工作空间，当前工作空间有 7 个用户、9 家店铺；管理员创建的普通模板使用 `scope=tenant`，因此对该网站工作空间内所有用户和店铺可见。当前“天鹅绒通用主图”模板为管理员共享模板，来源于涵舟-家纺2店并引用 4 张受保护图片。
- 根因是模板可见规则与草稿媒体规则不一致：共享模板能够跨店显示和预览，但草稿保存仍把模板中的 4 张图片当成当前店铺普通图片，强制要求 `media_assets.store_id` 等于目标店铺，因而提示“商品草稿引用了不存在、未完成上传或不属于当前店铺的图片”。
- 草稿媒体校验现允许当前店铺图片，或当前用户可见的指定尾图模板中明确列出的来源店铺图片；仍要求同租户、模板类型为 `tail_image`、素材所属店铺等于模板来源店铺，并按 `tenant/user/store` 作用域校验，不能借模板 ID 读取其他店铺任意图片。
- 批量建品不再把管理员模板图片混入普通 `detail` 数组，而是保存到 `imageAssets.tail` 模板快照；发布预检保留 `templateId`，上传 SHEIN 前通过可见模板解析原始店铺，再读取受保护图片。删除草稿时也会按素材真实归属更新引用计数，不会误删仍被共享模板使用的图片。
- 新增共享模板素材权限、远程上传模板来源和批量建品图片槽位回归。定向测试 68/68、全量 `node --test --test-reporter=dot`、`npm run build:v2` 均通过；`dist-v2` 与 `dist-web` 静态发布审计均为 `READY`、14/14 契约、阻断为 0。运行数据库角色审计通过 52 项，无数据库迁移。
- 部署包为 `shein-cloud-deploy-20260824-shared-carousel-template-v1.tar.gz`，SHA-256 为 `5e3d3ae3103def7a386801b715bcd8cbbfa7bc8e122b38e69a1d00c18659f9f8`。云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260824-shared-carousel-template-v1`，仅重建 `deploy-control-1`；商品发布、合规同步、经营同步、Webhook、PostgreSQL 和 Redis 容器 ID 均保持不变。
- 部署后 control 为 `healthy`，内部 `/health`、`/ready` 与公网 `https://api.hanzhou.icu/health` 均正常；公网 `https://app.hanzhou.icu/` 已加载 `assets/index-ClvgaPd0.js`。本轮未调用 SHEIN 商品写接口、未提交真实商品。

## 十五、2026-08-24 批量建品图片排序与 SKC 紧凑编辑部署

- 批量商品总表的“查看/调整图片用途”不再统一出现在表格最底部，而是在对应 SKC 主行之后以同一表格的下一行就地展开。商品图片缩略图固定为紧凑高度，并同时显示当前 SKC 已引用的管理员通用主图；商品图片和通用主图分别支持原生鼠标拖拽排序，保存草稿时保持每个 SKC 自己的通用主图顺序，同时继续遵守通用主图追加在商品图片之后的发布契约。
- SKC 二级编辑改为“商品属性”和“SKU与包装”两个页签。商品属性页根据当前 SHEIN 类目 Schema 将模板赋值还原为属性名称和官方值标签，以小字号双栏布局展示；SKU 页以紧凑表格展示尺寸、预览图、价格、克重和打包长宽高，价格、克重及三个打包尺寸都可逐 SKU 手工修改并随草稿保存。
- SKU 预览图不再使用无法看清图片的长下拉框，改为缩略图选择器；每张候选图提供“放大”和“引用”，可清除当前引用，引用只更新当前 SKU，不改变商品主图用途。弹窗控制在视口内并允许表格局部横向滚动，不把整个页面挤出屏幕。
- 新增图片拖拽稳定重排的纯函数回归和批量建品 UI 契约回归。定向测试 37/37、全量 `npm test` 997/997、`npm run build:v2` 均通过；`dist-v2` 与 `dist-web` 发布审计均为 `READY`、14/14 契约、阻断为 0。本地浏览器用两张测试图验收：图片面板为 SKC 下一行、两项均可拖拽、缩略图高度 80px；1280×720 下 SKC 弹窗为 1180×434，无滚动溢出，双页签正常，控制台无错误。
- 部署包为 `shein-cloud-deploy-20260824-batch-skc-image-editor-v1.tar.gz`，SHA-256 为 `e0bc555a8178202fe8b5bb56048da2bb631bfb9d61ee8ec622b8e724f30aab86`。云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260824-batch-skc-image-editor-v1`，仅重建 `deploy-control-1`；商品发布、合规同步、经营同步、Webhook、媒体清理、规则刷新、PostgreSQL 和 Redis 容器 ID 均保持不变，未执行数据库迁移。
- 部署后 control 容器 `a659e1b0f72e` 为 `healthy`，内部 `/health`、`/ready` 与公网 `https://api.hanzhou.icu/health` 均正常；公网 `https://app.hanzhou.icu/` 已加载 `assets/index-5m-XaNJ8.js`，线上静态资源已确认包含“打包体积（长×宽×高 cm）”。本轮未调用 SHEIN 商品或合规写接口、未提交真实商品。

## 十六、2026-08-24 批量建品参数区 UI 精简与水印折叠部署

- 采用 OpenAI 官方开源 `frontend-app-builder` Skill 约束本轮视觉改版，并以生成的整页及水印展开态视觉稿进行浏览器对照验收。批量建品页移除了开发期说明、批量方块图技术提示及批量合规模板，保存草稿时也不再写入批量 `complianceTemplateId`；单品编辑和店铺合规能力未改动。
- 参数区重组为“商品模板”和“SKU参数”两段，字段高度、字号和间距统一压缩；“批量引用”改为红色主操作并显示已选商品数。主图满屏水印默认收起为单行摘要，展开后以紧凑横排显示文案、大小、深浅、颜色和应用按钮，不再使用占据整块页面的大灰色模块。
- UI 契约新增旧说明、批量合规模板移除、红色批量引用、水印折叠和已选商品应用范围回归。定向测试 39/39、全量 `npm test` 997/997、`npm run build:v2` 均通过；`dist-v2` 与 `dist-web` 静态发布审计均为 `READY`、14/14 契约、阻断为 0。
- 本地真实浏览器验收使用一个商品文件夹和两张图片：1440×900 桌面端无横向溢出，水印展开区高度约 82px；390×844 窄屏自动单列，页面 `scrollWidth` 与视口同为 390px，所有可见表单控件均在屏幕内。红色批量引用、合规模板缺失、旧说明缺失和水印展开控件均已在运行页面确认。
- 部署包为 `shein-cloud-deploy-20260824-batch-ui-polish-v1.tar.gz`，SHA-256 为 `edf0351767af91155a39369fb3cad927cf0bea3bf1b957874f0188d75bbb7e8b`。云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260824-batch-ui-polish-v1`，仅重建 `deploy-control-1`；新 control 容器 `d4b6849b9e22` 为 `healthy`，商品发布、合规同步、经营同步、Webhook、媒体清理、规则刷新、PostgreSQL、Redis 和 Cloudflare 隧道容器 ID 均保持不变，未执行数据库迁移。
- 部署后内部 `/health`、`/ready` 与公网 `https://api.hanzhou.icu/health` 均正常，公网首页已加载 `assets/index-D47S1lKC.js`，线上 bundle 已确认包含“批量引用”“主图满屏水印”“仅应用到已选商品”，且不再包含批量方块图旧说明。本轮未调用 SHEIN 商品或合规写接口、未提交真实商品。

## 十七、2026-08-24 经营中心侧边栏顺序调整（候选版本）

- 经营中心主导航调整为：总览、商品经营、商品审核中心、销量与库存、经营预警、合规工作台、商品草稿、批量建品、新建商品。商品草稿、批量建品、新建商品三项内部顺序保持不变，只移动到日常经营功能之后。
- 本轮只调整 `AppShell` 的导航数组；路由、图标、权限、店铺作用域、同步任务和 SHEIN 数据链路均未修改。新增导航完整顺序回归，先确认旧顺序失败，再随改动转为通过。
- 定向测试 48/48、`node --test server/*.test.js` 122/122、全量 `npm test` 998/998 通过；`npm run build:v2` 通过，`dist-v2` 与 `dist-web` 静态发布审计均为 `READY`、14/14 契约、阻断为 0。
- 本地浏览器在 1280px 视口确认九项经营导航顺序准确、总览高亮正常、页面无横向溢出，最终验收页控制台无错误。当前只制作云端候选包，未切换线上 release、未执行数据库迁移、未调用 SHEIN 商品或合规写接口。

## 十八、2026-08-24 批量建品保存与发布流修复（候选版本）

- 根因是批量建品页只有“保存已选草稿”，没有进入商品审核中心的下一步入口；保存失败与成功还使用相同的信息提示样式，用户无法判断真实阻断。已保存的 SKC 再次操作时会重新上传整组图片，也会增加保存失败和重复等待的概率。商品草稿向商品审核中心传递的待选草稿状态此前没有被接收。
- 批量建品现明确拆分为“保存已选草稿”和“保存并前往发布”。前者只保存并留在当前页；后者完成保存后进入商品审核中心。商品仍由服务端重新校验，只有真实 `ready` 草稿会自动选中，缺少类目、模板或其他必填数据的草稿显示为“需处理”，不会绕过审核中心或直接调用 SHEIN 发布接口。
- 已保存且没有修改的商品再次执行保存时直接复用草稿 ID 和服务端状态，不重复上传图片；一旦标题、模板、SKU、图片顺序或水印等内容发生变化，才重新保存。每个 SKC 行内显示“可发布 / 待完善 / 有未保存修改”，失败提示使用红色危险状态并原样显示服务端错误。
- 商品审核中心现在会消费当前店铺的草稿交接状态，只自动勾选本次交接且仍为 `ready` 的草稿；跨店或已经变为阻断状态的草稿不会被误选。新增批量保存只执行一次、危险错误提示、保存后交接和审核中心选中契约回归。
- 定向测试 41/41、`node --test server/*.test.js` 122/122、全量 `npm test` 999/999 通过；`npm run build:v2` 通过，`dist-v2` 与 `dist-web` 已同步，两个静态发布审计均为 `READY`、14/14 契约、阻断为 0。应用内浏览器用本地隔离商品文件夹实测：“保存并前往发布”成功进入商品审核中心，缺少模板的商品显示“需处理”及对应完善提示，控制台无错误。
- 当前为本地候选版本，未切换线上 release、未执行数据库迁移、未调用 SHEIN 商品或合规写接口，也未提交真实商品。

## 十九、2026-08-25 合规同步终态兼容修复（已部署）

- 合规同步前端兼容服务端实际返回的 `completed` 与 `completed_with_errors` 终态；成功或部分完成后都会回读当前店铺合规工作台，部分失败保留服务端失败原因。同步任务页同步显示“已完成/部分完成”。
- 新增终态回读回归测试；全量 `npm test` 通过 1012/1012，`npm run build:v2` 通过，`npm run release:audit:v2` 返回 `READY`、14/14 合约、无阻断。
- 部署包为 `shein-cloud-deploy-20260825-compliance-sync-terminal-v1.tar.gz`，SHA-256 为 `5d8dd7558ba2374e08a1c8a9fb29b495134795ac72ce5bc0589adc794b06a02b`。云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260825-compliance-sync-terminal-v1`，仅重建 `deploy-control-1`，未执行数据库迁移。
- 部署后内部 `/health`、`/ready`、公网 `https://api.hanzhou.icu/health` 均正常，公网首页返回 HTTP 200；control、PostgreSQL、Redis、经营刷新、规则刷新、合规同步、Webhook 和商品发布 Worker 均保持运行。本轮未调用 SHEIN 商品或合规写接口、未提交真实商品。

## 二十、2026-08-25 合规工作台表格布局修复（已部署）

- 修复合规列表每页 50 条数据仍强制使用虚拟绝对定位导致的列错位问题；100 条以内使用原生表格保持主图、SKC、类目、状态和更新时间列宽稳定，超过 100 条才启用虚拟化，兼顾窄屏布局和大列表性能。
- 新增表格布局回归测试；全量 `npm test` 通过 1013/1013，`npm run build:v2` 通过，`npm run release:audit:v2` 返回 `READY`、14/14 合约、无阻断。
- 部署包为 `shein-cloud-deploy-20260825-compliance-table-layout-v1.tar.gz`，SHA-256 为 `afdccec0de5c58eaf9b42b8f41d922d2aba324a2e786d135bec52b05dfda600c`。云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260825-compliance-table-layout-v1`，仅重建 `deploy-control-1`，未执行数据库迁移。
- 部署后公网 API 健康、控制服务 ready、首页 HTTP 200、线上 CSS/JS 已包含新的表格布局选择器；PostgreSQL、Redis、经营刷新、规则刷新、合规同步、Webhook 和商品发布 Worker 均保持运行。本轮未调用 SHEIN 商品或合规写接口、未提交真实商品。

## 二十一、2026-08-25 合规列表长文本溢出修复（已部署）

- 修复 SKC/供应商编码过长时溢出覆盖“类目”列的问题：商品标识和供应商编码现在在单元格内省略显示，保留 `title` 悬浮查看完整值；类目列限制最大宽度并省略；所有合规表格单元格统一隐藏溢出内容。
- 新增长标识跨列溢出回归测试；全量 `npm test` 通过 1014/1014，`npm run build:v2` 通过，`npm run release:audit:v2` 返回 `READY`、14/14 合约、无阻断。
- 部署包为 `shein-cloud-deploy-20260825-compliance-overflow-v1.tar.gz`，SHA-256 为 `9be2bc5b07b7f1adf3c8467de8add33d1339e463525df579b78e530702060afe`。云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260825-compliance-overflow-v1`，仅重建 `deploy-control-1`，未执行数据库迁移。
- 部署后 control 为 `healthy`；PostgreSQL、Redis、经营刷新、规则刷新、合规同步、Webhook 和商品发布 Worker 均保持运行。公网 API 返回 `ok:true`，首页 HTTP 200，线上 CSS 已确认包含表格虚拟化选择器和 `overflow:hidden`。本轮未调用 SHEIN 商品或合规写接口、未提交真实商品。

## 二十二、2026-08-25 HZ 浏览器标签图标与 UI 版本部署（已部署）

- 新增 `public/favicon-hz.svg`：黑色圆角底、白色 `HZ` 字母标识；V2 页面通过 `index.html` 的 favicon 链接加载，并将浏览器主题色统一为深色品牌色。
- 新增标签图标契约回归；全量 `npm test` 通过 1021/1021，`npm run build:v2` 通过，`npm run release:audit:v2` 返回 `READY`、14/14 合约、无阻断。
- 部署包为 `shein-cloud-deploy-20260825-ui-favicon-v1.tar.gz`，SHA-256 为 `05daeba05649b4f2625ede5208f07da5c6bef5299709a9735aadbcb20bf21acd`。云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260825-ui-favicon-v1`，仅重建 `deploy-control-1`，未执行数据库迁移。
- 部署后 `control=healthy`，内部 `/health`、`/ready`、公网首页和 `favicon-hz.svg` 均返回成功；线上首页已确认引用 `/favicon-hz.svg`。PostgreSQL、Redis、经营刷新、规则刷新、合规同步、Webhook 和商品发布 Worker 均保持运行，未调用 SHEIN 商品或合规写接口。

## 二十三、2026-08-25 审核版本收敛与图片缓存修复部署（已部署）

- 修复商品审核状态在“重新发起”后仍显示旧的“已驳回”问题：审核流以当前店铺、当前 SKC 最新发布版本为主视图；旧版本驳回记录保留在历史计数中，但不再覆盖新版本的“待审核/审核中”状态。无 SHEIN 事件回读时，当前发布版本会显示为待回读，不会回退到上一版本。审核阶段缺少显式工作流值时，按官方审核状态推导为“待审核”或“已通过”。
- 修复跨页面图片反复请求和缓慢加载：已持久化素材改用稳定的同源内容地址，不再在每次页面挂载时重新申请短期下载票据；草稿、批量建品和单个建品统一使用该地址。媒体内容缓存策略调整为 `max-age=86400, stale-while-revalidate=3600`；素材 ID 不变即复用浏览器缓存，替换素材会产生新 ID，避免旧图污染。
- 新增审核版本收敛、工作流阶段推导、稳定图片地址和长缓存策略回归；定向测试 74/74、全量 `npm test` 通过，`npm run build:v2` 通过，`npm run release:audit:v2` 返回 `READY`、14/14 合约、无阻断。
- 最终部署包为 `shein-cloud-deploy-20260825-review-sync-image-cache-v1.tar.gz`，SHA-256 为 `77bce975f05354efe294417cfcf768448818200487d01a5e6c46c33c99bf9b0d`。云端 `current` 已切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260825-review-sync-image-cache-v1`，仅重建 control 容器；control 容器 `ef30fbd23bb4` 为 `healthy`，经营刷新、规则刷新、合规同步、Webhook、商品发布 Worker、媒体清理、PostgreSQL、Redis 和 Cloudflare 隧道均保持运行，未执行数据库迁移。
- 部署后 `https://api.hanzhou.icu/health` 返回 `{"ok":true,"service":"shein-cloud-control"}`，`https://app.hanzhou.icu/` 返回 HTTP 200，线上首页引用新构建资源；线上 `ProductDraftsPage`、`PublishBatchesPage`、`NewProductPage` 均已确认包含 `mediaContentUrl`，control 线上缓存头已确认使用 24 小时缓存和 1 小时 stale-while-revalidate。本轮未调用 SHEIN 商品或合规写接口、未重复提交真实商品。

## 二十四、2026-08-25 管理员店铺别名与账户别名（本地候选版本）

- 店铺管理员别名能力已补齐并明确化：管理员视图可编辑 `stores.admin_label`，同时显示“成员看到”的原始店铺名；成员继续读取 `stores.label`，不会看到或受到管理员别名影响。清空管理员别名后恢复显示原始店铺名。
- 新增 `users.admin_label` 迁移和管理员专属接口 `PATCH /v1/web/admin/members/:userId/alias`。管理员可为任意租户成员设置或清除账户别名；成员真实 `display_name`、邮箱、登录身份和本人视图均不改变。普通成员调用该接口会被 403 拒绝，写入记录进入管理员审计日志。
- 成员权限页新增“管理员别名”编辑入口，并明确标注“仅管理员可见”；店铺管理页明确区分管理员店铺别名与成员看到的店铺名。演示服务同步支持这两种别名语义，避免本地验收与云端行为不一致。
- 新增管理员/成员隔离、别名写入与清除、迁移契约、控制路由和 V2 UI 回归；定向测试 121/121 通过，`npm test -- --test-reporter=dot` 通过，`npm run build:v2` 通过，`npm run release:audit:v2` 返回 `READY`、14/14 合约、无阻断。
- 当前为本地候选版本：尚未生成云端部署包、尚未切换线上 release、尚未执行数据库迁移，也未调用 SHEIN 商品或合规写接口。部署前需要先在云端执行新增 `044_user_admin_alias.sql` 迁移，再重建 control 并验收管理员/成员两种账号视图。

## 二十五、2026-08-26 合规必填项与 1630/1631 官方回读上传修复（已部署）

- 单 SKC 合规详情现在只展示 SHEIN 合规要求回读中 `required=true` 的证书、代理、警示语和实拍图；移除本地兜底生成的非必填项目，避免用户被要求填写官方未要求的内容。
- 1630/1631 仅以 SHEIN 当前 `reportDecision.reportType` 回读为准。详情页始终显示官方报告类型：已回读显示 1630 或 1631，未回读显示等待；类型回读后即使其它摘要没有阻断，也会保留对应的按 SKC 报告上传入口，并按类型匹配官方报告规则。
- 合规列表增加“官方报告”列，所有 SKC 明确显示 1630、1631 或“等待 SHEIN 返回”；租户、店铺和用户权限隔离保持不变。
- 定向合规测试 16/16、全量 `npm test` 1041/1041 通过；`npm run build:v2` 通过；`npm run release:audit:v2` 返回 `READY`、14/14 合约、无阻断。
- 最终部署包 `shein-cloud-deploy-20260826-compliance-required-report-v2.tar.gz`，SHA-256：`07bedd734323a7d6e841173f20c8c67289796d8da7ac0f1c5cd8bc1b20aadba3`。云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260826-compliance-required-report-v2`；仅重建 `deploy-control-1`，未执行数据库迁移，其他 Worker、PostgreSQL、Redis 保持运行。
- 部署后 control 为 `healthy`，公网 `/health` 返回 `{"ok":true,"service":"shein-cloud-control"}`，公网首页已加载 `assets/index-DHI9kQx9.js`。本轮未调用 SHEIN 商品或合规写接口。

## 二十六、2026-08-26 SRF-01“清流刷新网”刷新架构修复（已部署）

- 刷新边界统一为“页面读取只读、刷新动作显式”：总览、销量与库存、同步任务、合规工作台、模板中心的 GET/React Query 读取不再隐式触发同步；移除页面级 `refetchInterval`，挂载时不自动重复拉取。用户点击手动刷新才创建或推进服务端单飞刷新任务。
- 刷新任务状态只按租户、用户、店铺和任务 ID 隔离；同一任务不会重复入队，页面只回读持久化投影/缓存。空缓存不会因为打开页面而偷偷调用 SHEIN，避免几十家店铺和多人使用时的重复请求、雪崩和长期缓存压力。
- 总览、合规、模板和同步任务页面均保留清晰的手动刷新入口；刷新中显示服务端任务状态，完成后只做一次定向回读，失败保留可重试状态。React Query key 已补充租户/用户 scope，避免跨用户或跨店铺复用错误缓存。
- SRF-01 回归新增空缓存 GET 不触发刷新、控制路由显式 POST 刷新、页面无轮询、任务 scope 隔离和挂载策略检查。定向测试 87/87，全量 `npm test` 1056/1056；`npm run build:v2` 通过；`npm run release:audit:v2` 返回 `READY`、14/14 合约、无阻断；`git diff --check` 通过。
- 首个候选包发现 Nginx 实际读取的 `dist-web` 未随包带入，公网短暂返回 500；已立即用同一份通过构建的 `dist-v2` 同步 `dist-web`，重新打包并原子切换，避免旧静态目录与控制服务版本不一致。
- 最终部署包 `shein-cloud-deploy-20260826-srf-01-manual-refresh-v2.tar.gz`，SHA-256：`87bc4ac963a610c3f73777ac4146a98f9572c16f7a839ea393803517297aa5a2`。云端 `current` 已切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260826-srf-01-manual-refresh-v2`，仅重建 `deploy-control-1`；商品发布、合规同步、经营刷新、规则刷新、Webhook、PostgreSQL 和 Redis 保持运行，未执行数据库迁移，未调用 SHEIN 商品或合规写接口。
- 部署后 control 为 `healthy`；内部 `/health`、`/ready` 返回成功且 PostgreSQL/Redis 为 up；公网 `https://api.hanzhou.icu/health` 返回 `ok:true`，`https://app.hanzhou.icu/` 返回 HTTP 200 并加载含 SRF-01 刷新逻辑的新 V2 静态资源。

## 二十七、2026-08-26 NEXUS-EVO-00 基线冻结与回滚保护（已完成，未改业务）

- 本阶段只建立可追溯基线，不修改业务代码、不切换 SHEIN 写入接口、不执行数据库迁移、不部署新业务版本。
- 线上当前 release 为 `/opt/shein-console/releases/shein-cloud-deploy-20260826-srf-01-manual-refresh-v2`，发布包 SHA-256 为 `87bc4ac963a610c3f73777ac4146a98f9572c16f7a839ea393803517297aa5a2`；线上 release 文件集摘要为 `d8eaf4b8b437f77087ec696246bab8daae9a7a0cf3031981ff00635660533e3b`。
- 线上 `/health` 与 `/ready` 检查通过，PostgreSQL、Redis 均为 `up`。最近 PostgreSQL 回滚备份为 `/opt/shein-console/backups/postgres/shein_console_20260825T193517Z.dump`，大小 53,145,904 bytes，SHA-256 为 `12899519a6384192a104a87271a70ab7b180f82d1959f0a318ebf49f7e895144`。
- 本地门禁基线：`npm test` 1056/1056、`npm run build:v2` 通过、`npm run release:audit:v2` 为 `READY`、14/14 contracts、无 blockers；`dist-v2/index.html` 与 `dist-web/index.html` SHA-256 均为 `3dcb596ea32046485a675912ca9624851561d444189800ecf998318739c46967`。
- 当前工作区没有 Git 提交历史，历史部署包和用户已有改动均保留；后续回滚以线上 release、发布包 SHA-256 和数据库备份为准。完整记录见 `docs/NEXUS_EVO_00_BASELINE_2026-08-26.md`。

## 二十八、2026-08-26 NEXUS-EVO-01 代码与功能资产盘点（已完成，未改业务）

- 已盘点 V2 页面、云端服务、API/数据契约、HEF-01/HST-01/HWF-01/SRF-01 记录和测试资产；当前有 117 个服务端测试文件、27 个 V2/前端契约测试文件。
- 核心能力已经落地并有测试覆盖：手动刷新、官方回读、发布幂等、合规必填、1630/1631 官方判断、Webhook 事件、库存未知值保护和权限服务端校验均保留，不做推倒重写。
- 已确认的结构性风险：部分草稿、建品、合规详情和模板页面的 TanStack Query key 仍未统一显式携带租户/用户作用域；草稿/批量/新建编辑器存在重复逻辑；审核版本投影、经营预警维度和端到端 Trace 指标仍需后续收敛。
- 上述缺口已映射到 NEXUS-EVO-02、03、04、05、06、07、08、09、10、11，不在本阶段直接改动，避免盘点阶段引入回归。
- 完整盘点记录见 `docs/NEXUS_EVO_01_ASSET_INVENTORY_2026-08-26.md`。本阶段未修改业务代码、未执行数据库迁移、未部署线上版本。

## 二十九、2026-08-26 NEXUS-EVO-11 Route Smooth 审核中心切换性能修复（本地候选，未部署）

- 审核中心首屏请求拆分：草稿与审核记录优先读取，批次、核价和经营统计延后 120ms 空闲窗口读取，避免进入页面时同时扇出多路请求；切换店铺时会重置延后窗口，不复用其它店铺的请求状态。
- 移除进入审核中心时自动调用 `revalidateProductDrafts` 的行为。草稿重新校验只在用户点击“手动刷新审核状态”时执行，最多处理 20 条阻断草稿，避免页面挂载触发写请求和 SHEIN/数据库压力。
- 发布回读查询限制为最近 20 个仍处于排队、预检或可执行状态的批次；手动刷新先回读当前回读与审核记录，再统一刷新本地列表，不再重复 refetch 审核记录和同一批次回读。
- 审核列表主图统一 `loading="lazy"`、`decoding="async"`，缩略图查询 key 使用稳定排序；长审核表行启用浏览器 `content-visibility`，共享表格在超过 40 行时启用 TanStack Virtual，降低富内容列表切换时的布局和绘制成本。
- 导航对商品审核中心、合规工作台、销量与库存启用悬停/键盘聚焦预加载，减少首次点击等待懒加载路由块的时间；未引入第二套 UI 框架，继续使用既有 TanStack Query/Table/Virtual 与现有视觉令牌。
- 定向审核中心/UI 测试 36/36，通过 `npm test` 全量 1064/1064；`npm run build:v2`、`npm run release:audit:v2`（READY、14/14 合约、无 blockers）和 `git diff --check` 均通过。
- 本阶段尚未生成云端部署包、尚未切换线上 release、尚未执行数据库迁移，也未调用 SHEIN 商品或合规写接口。需用户明确授权后再部署，并在部署后复验公网健康、静态资源和审核中心请求扇出。

## 三十、2026-08-26 审核中心双勾选与跨店铺重发选择隔离修复（本地候选，未部署）

- 修复审核中心外部审核记录同时显示“归档选择”和“重新发起选择”两个勾选框的问题；现在每个审核记录只有一个选择框，批量归档与批量重新发起共用同一条审核记录选择，重新发起计算只取其中具备当前店铺本地草稿且已驳回的记录。
- 修复店铺切换后沿用上一店铺勾选状态的问题。切换店铺会清空发布草稿选择、审核记录选择、反馈和不确定发布提示，避免把上一店铺的草稿 ID 带入当前店铺造成重发失败或跨店操作。
- 全选审核记录会同时作用于当前列表中的可发布本地草稿和外部审核记录；发布按钮只提交当前店铺、当前选择中满足服务端条件的草稿，归档按钮只提交审核记录 key。
- 新增双勾选回归、单选语义、店铺切换隔离及成功重发后清除选择测试；定向审核中心测试 20/20、全量 `npm test` 1067/1067、`npm run build:v2`、`npm run release:audit:v2`（READY、14/14 合约、无 blockers）和 `git diff --check` 均通过。
- 本阶段尚未生成云端部署包、尚未切换线上 release、尚未执行数据库迁移，也未调用 SHEIN 商品或合规写接口。部署前需明确授权，并在当前店铺分别复验单个重发、批量重发、批量归档和切换店铺后的选择清空。

## 三十一、2026-08-27 NEXUS-EVO-00～10 强制回归与审核中心发布（已部署）

- 审核中心选择模型已收敛为单一语义：每个审核记录（含已驳回记录）仅保留一个行选择框，表头仅保留一个“全选审核记录”选择框；批量重新发起与批量归档共用该选择，不再渲染第二套归档选择框。选择状态按租户、用户、店铺隔离，切换店铺立即清空，成功重发后清空当前选择。
- 发布执行失败现在通过同一数据库事务投影到 `publish_batch_items` 与 `publish_batches`；终态失败会显示失败/可重试，结果不确定时保持 `result_unknown`，不会把未确认的请求误标为失败，也不会重复调用 SHEIN 写接口。
- 审核状态回读补强：本地草稿缺失 `request_summary.skcNames` 时从对应审核版本恢复 SKC；发布后的记录优先使用可信的官方事件时间。若只有旧失败快照且没有官方事件时间，则保持“等待官方回读”，不覆盖较新的提交，避免“已重新发起后仍停留已驳回”。本轮未对历史数据做批量改写，保留原始审计记录。
- 合规查询缓存 key 补充租户/用户作用域；页面读取继续遵循 SRF-01 手动刷新与短期缓存边界，不启用页面定时轮询。
- 回归门禁：`npm test` 1070/1070；`npm run build:v2` 通过；`npm run release:audit:v2` 返回 `READY`、14/14 contracts、无 blockers。
- 云端发布包：`shein-cloud-deploy-20260827-nexus-evo-00-10-checkbox-fix-v1.tar.gz`，SHA-256 `5455c2c19f83f0fceb7927a6484b397f83d802e73b24745521542473208c83ad`；线上 `current` 已切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260827-nexus-evo-00-10-checkbox-fix-v1`。仅重建 `deploy-control-1`，PostgreSQL、Redis 及各类 worker 保持运行；未执行数据库迁移，未调用 SHEIN 商品或合规写接口。
- 部署后验收：公网首页 HTTP 200；公网 API `/health` 返回 `ok:true`；control `healthy`；PostgreSQL、Redis、发布/同步/Webhook worker 均运行。公网新静态资源 `PublishBatchesPage-DJ2_XTal.js` 中“全选审核记录”标记为 1，旧的 `归档 ${e.title}` 标记为 0。

## 三十二、2026-08-27 NEXUS-REVIEW-01 审核状态投影与分类切换修复（已部署）

- 修复 `product_document_audit_status_notice_all_channels` 被当作 stored-only 而不进入商品审核状态投影的问题；现在兼容的全渠道审核事件与标准审核事件共用同一投影、回执和 `product_review_states` 持久化链路。
- 审核状态按官方事件时间单调更新，迟到的旧事件不能覆盖更新事件；同一 SKC 仅展示当前最新审核版本，历史版本仍保留用于发起/驳回次数和审计。官方驳回优先于本地“提交待回读”提示，官方明确工作流阶段才会映射到待审核、待核价、待寄样、待审版、待核样、待终审等分类，不再用本地核价讨论改写官方阶段。
- 审核中心分类切换使用 `startTransition`，避免大列表切换时阻塞交互；静态产物已确认审核记录表头只有一个“全选审核记录”入口，行级每条记录只有一个选择框。
- 全量 `npm test` 1073/1073；`npm run build:v2` 通过；`npm run release:audit:v2` 返回 `READY`、14/14 contracts、无 blockers。候选部署包 `shein-cloud-deploy-20260827-nexus-review-01-v2.tar.gz`，SHA-256 `16679beeaef233648e685c9b8251762dce90716b7c4d43edcd692755b467951d`。
- 云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260827-nexus-review-01-v2`；重建 `deploy-control-1` 与 `deploy-webhook-worker-1`，未执行数据库迁移，PostgreSQL、Redis、商品发布、经营/规则/合规同步、Webhook 接收及媒体清理服务保持运行。control 与 webhook worker 容器内关键文件哈希与 release 一致。
- 部署后内部 `/health`、`/ready`、公网 `https://api.hanzhou.icu/health` 均成功，公网首页 HTTP 200；公网审核页面 chunk 中“全选审核记录”出现 1 次、“全选可发布商品”出现 1 次，`startTransition` 标记存在。

## 三十三、2026-08-27 SRF-02“清流刷新闭环”刷新任务跟踪与缓存回读修复（已部署）

- 修复总览、销量与库存、商品、预警和商品详情页把服务端一次性返回的 `retryAfterSeconds` 当成静态倒计时的问题；现在倒计时只在浏览器本地每秒计算，不产生额外网络请求，刷新按钮会实时显示剩余秒数。
- 手动刷新成功后保存服务端返回的 `refreshJob`，当前页面只对该店铺、该用户、该任务进行轻量状态回读；任务进入成功、完成、失败或取消终态后停止轮询，并只让当前作用域的经营缓存失效后回读一次。普通页面读取仍为手动刷新，不恢复全局定时刷新。
- 页面切换期间若任务仍在运行，业务工作台会从已持久化的 `refreshJob` 接管任务状态；店铺切换、用户切换、查询条件变化均保留租户/用户/店铺隔离，不复用其它作用域的缓存或任务。
- 依据 TanStack Query 的 mutation 后定向 invalidation/cache 复用模式与 BullMQ 持久化任务语义实现；未新增第二套请求库或修改 SHEIN 官方数据口径，Worker 重试和发布幂等边界保持不变。
- 新增刷新闭环回归覆盖：本地倒计时无网络定时器、活动任务轮询终止、终态定向失效、总览活动任务回读及无全局 30 秒轮询。全量 `npm test` 通过 1076/1076；`npm run build:v2` 通过；`npm run release:audit:v2` 返回 `READY`、14/14 contracts、无 blockers；`git diff --check` 通过。
- 最终部署包 `shein-cloud-deploy-20260827-srf-02-refresh-closure-v1.tar.gz`，SHA-256：`061d64d0f493e579a9ea2b6a6f86feab3162be39cc7c9d045b5e0fc6a17085bc`。部署前已将同一份 V2 构建同步到 Nginx 使用的 `dist-web`；云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260827-srf-02-refresh-closure-v1`，仅重建 `deploy-control-1`，未执行数据库迁移，PostgreSQL、Redis、商品发布/经营/规则/合规/Webhook/媒体清理 Worker 保持运行。
- 部署后 `deploy-control-1` 为 `healthy`；公网 `https://api.hanzhou.icu/health` 返回 `{"ok":true,"service":"shein-cloud-control"}`，公网首页 HTTP 200 并加载新入口 `assets/index-CifnJzUw.js`；路由资源已包含 `business-dashboard-refresh-job`、活动任务 `refetchIntervalInBackground=false`、本地 `retryAfterSeconds` 倒计时标记。

## 三十四、2026-08-27 SRF-01 活动同步任务闭环补强（已部署）

- 合规工作台、商品属性模板和同步任务中心的活动任务详情现在只在任务 ID 存在时轻量回读；任务进入 `succeeded`、`completed`、`completed_with_errors`、`failed` 或 `cancelled` 后自动停止，不启用页面级定时刷新。
- 合规同步终态会定向回读当前租户/用户/店铺的合规工作区；属性 Schema 同步终态会刷新覆盖摘要；任务中心从规则/合规刷新接口返回的任务 ID 打开详情并在终态更新任务列表。任务列表在刷新进行中不会因旧列表暂时缺少新任务而清除详情选择。
- 属性 Schema 查询缓存 Key 补充租户/用户作用域，避免不同账号在同一店铺下复用错误的 Schema 快照；窗口聚焦、网络重连和后台标签页均不会启动轮询。
- 新增 SRF-01 活动任务回归测试；全量 `npm test` 通过 1079/1079，`npm run build:v2` 通过，`npm run release:audit:v2` 返回 `READY`、14/14 contracts、无 blockers；V2 构建产物已同步 `dist-web`。
- 最终部署包 `shein-cloud-deploy-20260827-srf-01-refresh-gap-fix-v1.tar.gz`，SHA-256：`606ea2415bc02e4a750893eadef683068b4151ed9834c358dd0ff4e91797ab27`。云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260827-srf-01-refresh-gap-fix-v1`，仅重建 `deploy-control-1`；未执行数据库迁移，PostgreSQL、Redis 和全部 Worker 保持运行，未调用 SHEIN 商品或合规写接口。
- 部署后 control 容器为 `healthy`；公网 `https://api.hanzhou.icu/health` 返回 `{"ok":true,"service":"shein-cloud-control"}`，公网首页 HTTP 200；合规、属性模板和任务中心懒加载资源均包含压缩后的活动任务 `refetchInterval` 与 `refetchIntervalInBackground:false` 配置。

## 三十五、2026-08-27 SRF-03“清流刷新韧性”查漏补缺（已部署）

- 活动刷新任务轮询改为自适应退避：任务刚创建时快速回读，运行时间越长逐步放宽到 10 秒；任务进入成功、完成、失败、取消或请求错误后立即停止，后台标签页不继续轮询。普通页面仍只允许手动刷新，不恢复全局定时刷新。
- 合规工作台、属性模板和同步任务中心会从数据库中恢复当前租户/用户/店铺的 queued/running 任务；页面切换或重新打开后可以接管未完成任务，避免任务 ID 只存在浏览器内存而丢失。所有活动任务查询 key 均包含租户、用户、店铺和任务类型。
- 合规同步 Worker 增加 15 分钟锁租期、30 秒续租和 5 分钟 stalled 检查；合规同步、规则刷新及通用同步任务读取/领取前会把超过 15 分钟仍 queued/running 的陈旧任务标记为失败并留下可重试错误，不再永久显示“处理中”或占用单飞锁。
- 新增 SRF-03 韧性回归，覆盖自适应轮询、活动任务恢复、Worker 锁配置和陈旧任务自愈。全量 `npm test` 通过 1083/1083；`npm run build:v2` 通过；`npm run release:audit:v2` 返回 `READY`、14/14 contracts、无 blockers；V2 构建产物已同步到 `dist-web`。
- 最终云端部署包 `shein-cloud-deploy-20260827-srf-03-refresh-resilience-v2.tar.gz`，SHA-256：`816513af2ca3141e298a8916129991f4261f54bbc508aaae6bf61f8403375ebd`。云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260827-srf-03-refresh-resilience-v2`；仅重建 `deploy-control-1`、`deploy-rule-refresh-worker-1` 和 `deploy-compliance-sync-worker-1`，未执行数据库迁移，PostgreSQL、Redis、商品发布、经营刷新、Webhook、媒体清理服务保持运行。
- 部署后 `control` 为 `healthy`，内部 `/health`、`/ready` 依赖均为 up；公网 `https://api.hanzhou.icu/health` 返回 `{"ok":true,"service":"shein-cloud-control"}`，公网首页 HTTP 200。首次候选包发现未携带 `dist-web` 导致短暂 500，已立即撤回该候选并用包含 `dist-v2`/`dist-web` 的 v2 包重新切换；当前线上静态资源与控制服务来自同一 release。未调用 SHEIN 商品或合规写接口。

## 三十六、2026-08-27 SRF-04“清流任务一致性”查漏补缺（已部署）

- 通用同步任务列表和详情读取现在会统一自愈陈旧的 `store_business_refresh` 任务。经营刷新 Worker 异常退出后，即使用户没有再次点击经营刷新，任务中心读取也会在租户/店铺范围内把超时的 queued/running 任务标记为失败并留下 `SYNC_JOB_TIMEOUT`，避免长期显示处理中。
- 同步任务服务允许筛选 `completed_with_errors` 终态，与 V2 任务中心、活动任务停止条件保持一致；不改变 SHEIN 数据口径，也不把服务不可用伪装成成功。当前云端同步 Worker 仍以 `succeeded` + 进度失败明细表达部分失败，新增筛选仅保持读兼容。
- 新增 SRF-04 回归覆盖陈旧店铺经营刷新任务自愈和 `completed_with_errors` 状态筛选；全量 `npm test` 通过 1085/1085，`npm run build:v2` 通过，`npm run release:audit:v2` 返回 `READY`、14/14 contracts、无 blockers；V2 构建产物已同步到 `dist-web`，`git diff --check` 通过。
- 最终部署包 `shein-cloud-deploy-20260827-srf-04-task-consistency-v1.tar.gz`，SHA-256 为 `65f50ad15604d13f4ea3cba8284347837d6fadffd19ffe5a42d89dbbf195ffbd`；云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260827-srf-04-task-consistency-v1`，仅重建 `deploy-control-1`。部署后控制服务 `healthy`，内部 `/health`、`/ready`、公网 API GET `/health`、公网首页和 favicon 均成功；PostgreSQL、Redis、商品发布、经营/规则/合规同步、Webhook、媒体清理 Worker 保持运行。未执行数据库迁移，未调用 SHEIN 商品或合规写接口。

## 三十七、2026-08-27 SRF-05“清流刷新硬化”查漏补缺（已部署）

- 修复无活动任务时仍持续回读的问题：浏览器刷新状态在没有 queued/running 任务时返回停止轮询；任务进入成功、完成、部分失败、失败或取消后不再产生后台请求。
- 增强经营刷新 Worker 的 BullMQ 锁安全：补齐 15 分钟锁租期、30 秒续租和 5 分钟 stalled 检查配置，避免长任务被误判 stalled 或异常退出后永久占用锁。
- 增加经营快照读取时的陈旧任务自愈：仅当当前快照确实为 refreshing 时，按租户/店铺节流执行一次事务性修复，将超时任务标记为 `SYNC_JOB_TIMEOUT`，并把无活动任务的快照恢复为 ready 或 failed；正常 ready/idle 读取不写库。
- 通用同步任务陈旧自愈覆盖 `store_business_refresh`、`product_incremental_sync`、`sales_daily_sync`、`inventory_sync`、`compliance_sync`、`rule_refresh`、`webhook_reconcile` 七类持久化任务，避免遗漏类型造成任务中心长期卡住。
- 经营刷新调度器改为有界并发池，默认同时处理 2 家店铺且上限 4，不再串行等待全部店铺；经营、规则和合规只读队列统一采用幂等任务 ID、最多一次指数退避重试，不改变 SHEIN 数据口径或发布写入权限。
- 新增 SRF-05 定向回归 6/6；项目全量 `npm test` 通过 1091/1091；`npm run build:v2` 通过；`npm run release:audit:v2` 返回 `READY`、14/14 contracts、无 blockers；V2 构建已同步 `dist-web`。
- 最终部署包 `shein-cloud-deploy-20260827-srf-05-refresh-hardening-v1.tar.gz`，SHA-256：`46e61453c4bf8c8dfc33e977099ae8d2110799b9f88cf4be2309f2ea5689b98b`。云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260827-srf-05-refresh-hardening-v1`；重建 `deploy-control-1`、`deploy-store-business-refresh-worker-1`、`deploy-rule-refresh-worker-1`、`deploy-compliance-sync-worker-1`，未执行数据库迁移，商品发布、Webhook、媒体清理、PostgreSQL、Redis 保持运行。
- 部署后已核验 control/Worker 健康、内部 `/health` 与 `/ready`、公网 API `/health`、公网首页和静态资源；未调用 SHEIN 商品或合规写接口，未消费商品发布授权。旧 release 保留，可按现有流程回退。

## 三十八、2026-08-27 SRF-06“清流作用域隔离”查漏补缺（已部署）

- 排查确认一个真实的跨店状态风险：应用外壳复用页面组件时，经营刷新 Hook 的活动任务 ID 原先只保存在组件状态中，切换店铺后可能沿用上一店铺的任务 ID；合规工作台的刷新任务 ID、同步任务中心的选中任务详情也存在同类的短暂复用窗口。该风险会让新店铺错误回读旧店铺任务，表现为状态归类错误、刷新结果不一致或重发失败。
- 经营刷新活动任务现在绑定完整的租户/用户/店铺 `scopeKey`，只有当前作用域的任务才会轮询、恢复和清理；合规工作台切店时清空 SKC 选择、模板、上传文件、报告日期、提示和刷新任务；同步任务中心切店时清空选中任务详情和反馈。既有服务端权限校验和 SHEIN 官方数据口径未改变。
- 新增 SRF-06 作用域回归，验证活动任务必须匹配当前作用域、切店清理合规临时状态和同步任务详情；同时更新 SRF-02 回归契约以覆盖新的作用域安全存储。
- 全量 `npm test` 通过 1093/1093；`npm run build:v2` 通过；`npm run release:audit:v2` 返回 `READY`、14/14 contracts、无 blockers；`git diff --check` 通过。
- 最终部署包 `shein-cloud-deploy-20260827-srf-06-refresh-scope-v1.tar.gz`，SHA-256 为 `c5dc0181f5d553e9ebc1991c3006db43b3ea4469f753d92df6dd8ebd9fbcec13`；部署前已将同一份 V2 构建同步到 Nginx 使用的 `dist-web`，远端包内 `dist-v2/index.html` 与 `dist-web/index.html` 哈希一致。云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260827-srf-06-refresh-scope-v1`，仅重建 `deploy-control-1`，未执行数据库迁移，PostgreSQL、Redis 及商品发布/经营/规则/合规/Webhook/媒体清理 Worker 保持运行。
- 部署后 `deploy-control-1` 为 `healthy`；内部 `/health`、`/ready`、公网 `https://api.hanzhou.icu/health` 均返回成功，公网首页 HTTP 200。线上 `use-business-dashboard-v07Rpf9f.js`、`CompliancePage-UpGffH12.js`、`SyncJobsPage-D1reBYar.js` 与本地 `dist-web` 对应资源哈希完全一致，确认 SRF-06 作用域隔离逻辑已生效。未调用 SHEIN 商品或合规写接口，未消费商品发布授权；旧 release 保留，可按现有流程回退。

## 三十九、2026-08-27 商品审核中心 AI 标题与成员授权修复（已部署）

- 商品审核中心的本地草稿行现在提供“AI标题”入口；入口只在服务端 `aiTitleCapability.visible=true` 时渲染。管理员授权的成员可见并可使用，未授权成员界面不显示，服务端接口仍会再次校验租户、用户和店铺权限，不能通过前端绕过。
- 点击审核中心的“AI标题”会打开对应草稿编辑器并携带一次性生成标记。编辑器等待当前草稿、主图、已选标题模板和 AI 能力加载完成后自动生成；生成请求复用现有 `buildAiTitleRequest` 与 `composeAiTitle`，保留标题模板开头/AI 图案命名/后缀及 SHEIN 标题长度校验，结果先回填供用户审核，保存后才进入后续发布流程，不直接写入 SHEIN。
- AI 标题服务增加租户/用户/店铺/主图/模板/当前标题维度的短期结果缓存（120 秒）和并发请求去重；重复点击或审核中心快速切换不会重复调用千问服务，错误不缓存，避免跨店或跨成员串标题。
- 新增审核中心入口、成员授权可见性、模板组合、并发去重和短缓存回归。全量 `npm test` 通过 1095/1095；`npm run build:v2` 通过；`npm run release:audit:v2` 返回 `READY`、14/14 contracts、无 blockers。
- 最终云端部署包 `shein-cloud-deploy-20260827-ai-title-review-v1.tar.gz`，SHA-256 为 `f5f0282da15f35acce08dfe0878e2ceaf25086417ff9b7aaabd32a6aef8793de`。云端 `current` 已切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260827-ai-title-review-v1`，仅重建 `deploy-control-1`，未执行数据库迁移，未调用 SHEIN 商品或合规写接口。

## 四十、2026-08-27 SRF-07“清流刷新一致性”查漏补缺（已部署）

- 修复手动刷新冷却倒计时的遗漏：原实现只在服务端 `retryAfterSeconds > 0` 时启动本地计时器；当服务端返回 `retryAfterSeconds=0`、但最近一次手动刷新仍在 60 秒保护窗口内时，界面可能停在初始的“59 秒”而不继续变化。新增 `refreshCooldownActive`，统一用服务端重试值与 `lastManualRefreshAt` 的剩余时间判断是否计时；计时器只更新本地时间，不发起网络请求。
- 为该边界新增 SRF-07 回归测试，并锁定发布页路由交接只允许一次幂等跳转，避免保存后带入发布中心时重复导航和额外查询。
- SRF-01～07 与核心缓存契约定向测试 41/41；项目全量 `npm test` 通过 1097/1097；`npm run build:v2` 通过；`dist-v2` 已同步到 Nginx 使用的 `dist-web`；`npm run release:audit:v2` 返回 `READY`、14/14 contracts、无 blockers；`git diff --check` 通过。
- 最终云端部署包 `shein-cloud-deploy-20260827-srf-07-refresh-coherence-v1.tar.gz`，SHA-256：`a25955b42d04487c262625f9094d65ee5bce758c4fd71273a7eb8299b3cfb477`。云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260827-srf-07-refresh-coherence-v1`，仅重建 `deploy-control-1`，未执行数据库迁移，PostgreSQL、Redis 及各类 Worker 保持运行。
- 部署后 `deploy-control-1` 为 `healthy`；内部 `/health`、`/ready`、公网 `https://api.hanzhou.icu/health` 均返回成功，公网首页 HTTP 200；远端 `dist-v2/index.html` 与 `dist-web/index.html` SHA-256 均为 `799d7870e155f9d0b165fc2ef203fa1b303753fa440db02478f5ef1429f41af0`，实际 `OperationsShared` chunk 已包含时间戳冷却逻辑。未调用 SHEIN 商品或合规写接口，未消费商品发布授权；旧 release 保留，可按现有流程回退。

## 四十一、2026-08-27 SRF-08“清流刷新权威冷却”查漏补缺（已部署）

- 修复服务端冷却值被本地时间窗口覆盖的遗漏：前端现在同时计算服务端 `retryAfterSeconds` 与 `lastManualRefreshAt` 对应的本地剩余时间，并取两者较大值。SHEIN 限流或服务端保护窗口更长时，刷新按钮不会提前解锁；服务端返回 0 时仍由本地时间戳继续无网络倒计时。
- 该改动只影响刷新按钮的可用时间，不改变 SHEIN 数据口径、任务状态机、发布/合规写接口或数据库结构；错误和后台标签页仍不会触发额外轮询。
- 新增 SRF-08 权威冷却回归，验证服务端较长重试时间不会被 60 秒本地窗口缩短。SRF-01～08 与核心缓存契约定向测试 43/43；项目全量 `npm test` 通过 1099/1099；`npm run build:v2`、`npm run release:audit:v2`（READY、14/14 contracts、无 blockers）和 `git diff --check` 均通过。
- 本轮使用同一份 V2 构建同步 `dist-web`，云端仅重建控制服务，未执行数据库迁移，未调用 SHEIN 商品或合规写接口；旧 release 保留，可按现有流程回退。
- 最终上传并部署的安全包为 `shein-cloud-deploy-20260827-srf-08-refresh-authority-v2.tar.gz`，SHA-256：`f5858386a3452d1becb6feee9a94b8901c039ba261922e3681dec2a0fd3b81d7`；打包前已排除 `.env`、`.env.web`、`.data`、`.git`、`node_modules` 及历史压缩包，未上传本地凭据、会话或业务数据。
- 云端 `current` 已切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260827-srf-08-refresh-authority-v2`，仅重建 `deploy-control-1`，PostgreSQL、Redis 及各类 Worker 保持运行。部署后 control 为 `healthy`，内部 `/health`、`/ready` 和公网 `https://api.hanzhou.icu/health` 均返回成功，公网首页 HTTP 200；远端 `dist-v2/index.html` 与 `dist-web/index.html` 哈希一致。

## 四十二、2026-08-27 SRF-09“清流认证缓存边界”查漏补缺（已部署）

- 修复认证会话失效时的缓存边界：收到 401 后立即清空 TanStack Query 全部业务缓存、内存中的当前店铺选择，并移除持久化店铺 ID，再跳转登录页；不会让过期账号继续看到旧店铺或旧任务数据。
- 退出登录同样清理持久化店铺选择；新账号登录前先丢弃上一账号的查询缓存，再写入新的 `session` 查询数据，避免成员/店铺切换时发生跨租户数据残留或登录重定向循环。
- 该修复仅收紧浏览器认证与缓存边界，不改变 SHEIN 官方数据口径、发布/合规写接口、任务状态机或数据库结构；未执行数据库迁移，未调用 SHEIN 商品或合规写接口。
- 新增 SRF-09 认证缓存边界回归，覆盖 401 清缓存、清除店铺选择、退出清理和新登录隔离。SRF-01～09 与相关刷新契约定向测试 10/10；项目全量 `npm test` 通过 1101/1101；`npm run build:v2`、`npm run release:audit:v2`（READY、14/14 contracts、无 blockers）和 `git diff --check` 均通过；V2 构建已同步到 `dist-web`。
- 最终安全部署包 `shein-cloud-deploy-20260827-srf-09-auth-cache-boundary-v1.tar.gz`，SHA-256：`bab9e9d2cff4a4aff35c9099d9a44fb9349a2a42b3f5ffbac5e2ea331943caf8`；打包前已排除 `.env`、`.env.web`、`.data`、`.git`、`node_modules` 及历史压缩包，未上传本地凭据、会话或业务数据。
- 云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260827-srf-09-auth-cache-boundary-v1`，仅重建 `deploy-control-1`；部署后 control 为 `healthy`，内部 `/health`、`/ready`（PostgreSQL、Redis 均 up）、公网 `https://api.hanzhou.icu/health`、公网首页和 favicon 均返回成功；远端 `dist-v2/index.html` 与 `dist-web/index.html` SHA-256 均为 `cd2a9b9b62acdd32bc4b187912283e0bcf0f72286e2e231afbd5b0a6f5b9a12f`。旧 release 保留，可按现有流程回退。

## 四十三、2026-08-27 SRF-10“清流认证作用域缓存”查漏补缺（已部署）

- 收紧认证后的店铺列表缓存：`stores` 查询键现在包含租户 ID 与用户 ID；店铺管理页的重命名、撤销授权和授权回调只失效当前认证作用域，避免不同成员在同一浏览器或切换账号后看到别人的店铺列表。
- 收紧管理员成员与 AI 标题配置缓存：成员键使用租户/用户作用域，AI 设置键使用租户作用域；成员权限、别名和 AI 配置写入只更新对应作用域的缓存，不会污染其他租户或账号。既有 `session` 引导键保持静态是有意设计，所有商品、合规、审核、经营和模板业务键仍包含租户/用户/店铺。
- `use-business-dashboard` 对 `stores` 的前缀失效继续保留，用于覆盖所有认证作用域的只读派生缓存，不读取或写入业务数据；未改变 SHEIN 数据口径、发布/合规写接口、任务状态机或数据库结构，未执行数据库迁移。
- 新增 SRF-10 认证作用域缓存回归，并更新店铺授权 UI 契约；定向 SRF-06～10 测试 10/10，项目全量 `npm test` 通过 1103/1103；`npm run build:v2`、`npm run release:audit:v2`（READY、14/14 contracts、无 blockers）和 `git diff --check` 均通过。V2 构建已同步到 `dist-web`。
- 最终安全部署包 `shein-cloud-deploy-20260827-srf-10-authenticated-cache-scope-v1.tar.gz`，SHA-256：`644b9aee690c082c2350fa05e3bf1acf0d3169aabfcc9cad604adfa3e6bba0e0`；打包前已排除 `.env`、`.env.web`、`.data`、`.git`、`node_modules` 及历史压缩包，未上传本地凭据、会话或业务数据。
- 云端 `current` 已原子切换至 `/opt/shein-console/releases/shein-cloud-deploy-20260827-srf-10-authenticated-cache-scope-v1`，仅重建 `deploy-control-1`；未执行数据库迁移，PostgreSQL、Redis 及商品发布/经营/规则/合规/Webhook/媒体清理 Worker 保持运行。部署后 control 为 `healthy`，内部 `/health`、`/ready`（PostgreSQL、Redis 均 up）正常，公网 `https://api.hanzhou.icu/health` 返回成功，公网首页与 favicon HTTP 200；远端 `dist-v2/index.html` 与 `dist-web/index.html` SHA-256 均为 `11cd5cec47ae733d4fb30609268ad48b4ac7fa7511251b01eaf4736423942575`。
- 未调用 SHEIN 商品或合规写接口，未消费商品发布授权；旧 release 保留，可按现有流程回退。

## 四十四、2026-08-27 NEXUS-AI-FAST-01-A0“AI 标题诊断基线”（已完成本地验证，待部署）

- 为 AI 标题服务建立只读诊断基线：每次请求生成 Trace ID，记录排队、授权、配置、容量、图片读取、模型调用和缓存命中阶段，以及图片/模型/总耗时；诊断写入仅通过安全 sink 输出，不包含 API 密钥、图片内容或用户业务数据。
- AI 标题成功、失败、超时、输入校验、权限拒绝和缓存命中均保留稳定错误码/诊断信息；重复请求继续使用原有并发去重和短缓存，不改变标题模板组合、成员授权、SHEIN 数据口径或发布行为。
- 服务端错误响应将 Trace ID 与诊断透传到 V2 API；单品、批量建品和商品审核中心的 AI 标题失败提示可显示错误码/Trace，便于区分配置、图片、容量和模型服务问题。
- 新增 AI 诊断成功/失败/缓存/去重回归及 UI 契约；项目全量 `npm test` 通过 1105/1105，`npm run build:v2` 通过，`npm run release:audit:v2` 返回 `READY`、14/14 contracts、无 blockers。
- A0 只建立观测基线，尚未实施 A1 输入契约、A2 图片复用、A3 并发调度等性能行为变更；本轮未部署云端，待确认诊断数据后再进入下一步。

## 四十五、2026-08-27 NEXUS-AI-FAST-01-A1“AI 标题契约收紧”（已完成本地验证，待部署）

- 统一单品、批量建品和商品审核中心共用的 AI 标题输入契约：主图、标题模板、语种和标题字符上限在请求发送前完成校验；不再把空值、非法字符、无效数字或错误语种静默转换成默认值。
- AI 标题模板现在必须包含至少一个可用的规则片段（开头、关键词或后缀），标题上限只接受 2-1000 的整数，默认仍为 250；错误返回稳定错误码，服务端不再把所有输入问题混成一个笼统的 `INVALID_AI_TITLE_INPUT`。
- 管理员配置的 API 地址现在必须是有效 HTTPS 绝对地址，禁止账号信息、片段和控制字符；模型名称/地址必须至少提供一个，API 密钥的控制字符会被拒绝。该校验不限制管理员更换 OpenAI 兼容的视觉服务或模型。
- 管理员设置页增加输入长度上限、自动完成和拼写检查保护；服务端保存前先校验，校验失败不会查询或写入数据库。现有授权边界、模板拼接逻辑、图片读取和发布行为保持不变。
- 新增请求与配置契约回归，项目全量 `npm test` 通过 1108/1108；`npm run build:v2` 通过；`npm run release:audit:v2` 返回 `READY`、14/14 contracts、无 blockers。本轮未部署云端，待确认后再进入 A2 图片复用与 A3 并发调度。
