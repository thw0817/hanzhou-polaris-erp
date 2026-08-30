# SHEIN 涵舟工作室 V2 API 能力矩阵

更新时间：2026-08-03  
状态：阶段 1 基线，实施前仍需按原始文档和当前店铺响应复核

## 1. 使用规则

本矩阵回答五个问题：接口从哪里来、能否用于全托管、是读还是写、当前验证到哪一步、由哪个 V2 页面消费。

状态定义：

- `归档`：本地已有 SHEIN 原始文档或对话原文摘要，尚未真实调用。
- `代码测试`：已有适配器/契约测试，但不表示真实店铺已验证。
- `只读实测`：已使用授权店铺完成只读调用或非业务写入验证。
- `待补文档`：只有权限或名称，不足以构造请求。
- `冻结`：即使已有实现也不允许 V2 调用真实业务写接口。

通用要求：

1. 每次请求按接口保存方法、正式 path、Header 变体、模式、限额、超时和响应 schema。
2. 请求严格校验，响应兼容文档已出现的对象、数组和 JSON 字符串形态。
3. 所有失败保留 SHEIN `code`、`msg`、`traceId` 和脱敏请求摘要。
4. 动态规则以当前店铺实时响应为最高事实来源；静态文档不能长期替代。
5. 写接口默认关闭，必须逐类功能开关、管理员确认、幂等、审计和写后读取核验。

## 2. 鉴权与基础能力

| 能力 | 方法与路径 | 模式 | 类型 | 来源 | 当前状态 | V2 消费者 |
| --- | --- | --- | --- | --- | --- | --- |
| API 签名 | HMAC-SHA256，按接口 path | 通用 | 基础 | `0aa9785d-...txt` | 代码测试 | 服务端 SHEIN client |
| 临时令牌换店铺凭证 | 以原始授权文档正式路径为准 | 通用 | 写凭证 | `53477f6a-...txt`、`9bc012dc-...txt` | 代码测试，生产未验收 | 店铺授权 |
| 应用权限清单 | SHEIN 应用配置页 | 全托管已审核 | 只读配置 | `b8f93f3c-...txt` | 归档 | 集成设置、上线门禁 |
| 店铺授权变更 | Webhook `/authorization_change_notice` | 通用 | 事件 | 字段交接 14.17 | 接收器代码测试 | 店铺状态、任务冻结 |

安全边界：`APP_SECRET`、店铺 `secretKey`、对象存储密钥和 O1Key 只存在于服务端；浏览器只持有 HttpOnly 会话和短时上传/下载 URL。

## 3. 商品查询与经营数据

| 能力 | 方法与路径 | 模式 | 类型/限额 | 来源 | 当前状态 | V2 消费者 |
| --- | --- | --- | --- | --- | --- | --- |
| 商品综合查询 | `POST /open-api/goods/searchProduct` | 含全托管 | 读；云端建议每页 10 SPU | `19ae8c53-...txt` | 代码测试 | 同步 Worker，不由页面直调 |
| 商品列表 | `/open-api/openapi-business-backend/product/query` | 按原文 | 读 | `5e17972e-...txt` | 归档 | 商品同步备选，实施前择一主源 |
| SPU 详情 | `/open-api/goods/spu-info` | 含全托管 | 读 | `70563550-...txt` | 代码测试 | 商品详情、模板识别 |
| SKU 全量详情 | `/open-api/openapi-business-backend/product/full-detail` | 按原文 | 读；即将废弃 | `c24ae928-...txt` | 禁止新增依赖 | 无新消费者 |
| SKU 销量 | `POST /open-api/goods/query-sku-sales` | 含全托管 | 读；100 SKU/次；40 QPS | 字段交接 10.4 | 代码测试 | 销量同步 Worker |
| 商家库存查询 | `/open-api/stock/stock-query` | 按原文 | 读 | `4c50e94e-...txt` | 归档 | 库存同步 Worker |
| 商家仓库列表 | `GET /open-api/msc/warehouse/list` | 自运营/半托管 | 读；50 QPS | 字段交接 10.1 | 归档；全托管页面不消费 | 后续其他模式 |
| 缺货需求 | Webhook `/out_of_stock_notice` | 含全托管 | 事件 | 字段交接 14.15 | 接收器可接，业务投影待建 | 经营预警 |

经营页面只读取 PostgreSQL 中的 `spus/skcs/skus`、销量和库存投影。现有网页 `/products` 直连 SHEIN 的方式仅作为旧实现，不进入 V2 页面读取路径。

## 4. 类目、动态字段与模板

| 能力 | 方法与路径 | 类型/限额 | 来源 | 当前状态 | 缓存与消费者 |
| --- | --- | --- | --- | --- | --- |
| 类目树 | `POST /open-api/goods/query-category-tree` | 读 | `eab38e01-...txt` | 代码测试 | 店铺+规则版本缓存；属性模板/建品 |
| 属性模板 | `POST /open-api/goods/query-attribute-template` | 读 | `cd73132c-...txt` | 代码测试 | 店铺+`product_type_id` 缓存 |
| 发布字段规范 | `POST /open-api/goods/query-publish-fill-in-standard` | 读 | `db52ff3f-...txt` | 代码测试 | 店铺+末级类目缓存 |
| 属性关联规则 | `/open-api/goods/get-associated-attribute-rules` | 读；每次最多 10 商品组 | `5dc7f766-...txt` | 代码测试 | 属性表单联动、预检 |
| 新增自定义属性值 | 以原始文档正式 path 为准 | 业务写 | `5f068191-...txt` | 归档、冻结 | 仅动态规则允许时考虑 |
| 站点列表 | `/open-api/goods/query-site-list` | 读 | `54ad5f7b-...txt` | 归档 | 发布预检；全托管不生成 `site_list` |
| 品牌列表 | `/open-api/goods/query-brand-list` | 读 | 发布契约前置调用 | 归档摘要 | 发布预检 |
| IP 列表 | `/open-api/goods/query-ip-list` | 读 | 集成蓝图 | 归档摘要 | 发布预检 |
| 环保材质树 v2 | 以原始文档正式 path 为准 | 读 | `d5230e16-...txt` | 归档 | 属性/合规动态字段 |

缓存必须持久化 `fetched_at`、请求维度、schema fingerprint、原始响应摘要和来源 TraceId。模板只保存真实字段 ID/值 ID及快照，不保存可直接重放的固定发布报文。

## 5. 商品发布、编辑与图片

| 能力 | 方法与路径 | 模式 | 类型/限额 | 来源 | 当前状态 | V2 门禁 |
| --- | --- | --- | --- | --- | --- | --- |
| 发品权限 | `/open-api/goods/product/check-publish-permission` | 含全托管 | 读 | 发布契约 | 代码测试 | 每次预检必查 |
| 发品额度 | `/open-api/goods-publish-quotas/detail` | 含自运营/全托管/半托管 | 读 | SHEIN 官方文档 3001680（2026-08-10） | 官方响应字段已锁定；代码测试 | 每次预检查询，`isControlled=false` 时通过 |
| 商家 SKU 查重 | `/open-api/goods/product/check-supplierSku-repeated` | 含全托管 | 读；200 SKU/次 | 发布契约 | 代码测试 | 每次预检必查 |
| 商品图片上传 | `POST /open-api/goods/upload-pic` | 含全托管 | 非业务写；JPG/PNG，常规 3 MB | `53ae...` 配套文档 | 真实直传实测 | 仅白名单短时代签 |
| 图片转换 | `/open-api/goods/transform-pic` | 按原文 | 非业务写 | 集成蓝图 | 归档 | 非必要不依赖 |
| 新增/编辑商品 | `POST /open-api/goods/product/publishOrEdit` | 全托管等 | 业务写；40 SKC/SPU，400 SKU/SKC | `53ae21b9-...txt` | 契约代码测试、冻结 | 阶段 8 单品验收后逐店启用 |
| 商品部分编辑 | `/open-api/goods/product/partialEdit` | 按原文 | 业务写 | `05562b51-...txt` | 归档、冻结 | 不作为 V2 首个闭环 |
| 单据状态 | `/open-api/goods/query-document-state` | 按原文 | 读 | 集成蓝图 | 归档 | 发布回执补偿查询 |
| 撤回商品 | `/open-api/goods/revoke-product` | 按原文 | 业务写 | 集成蓝图 | 归档、冻结 | 独立开关与确认 |
| 商品上下架 | `/open-api/goods/modify-skc-shelf` | 按原文 | 业务写 | `b89edd4a-...txt` | 归档、冻结 | 不进入首期 UI |
| 商品删除申请/记录 | 以原始文档正式 path 为准 | 按原文 | 业务写/读；相关页面 20 QPS | `d97ae87e-...txt` | 归档、冻结 | 不进入首期 UI |

图片提交约束以当前发布规范为准。已归档基线：主图/细节图 `image_type=1/2`，方图 `5`，色块 `6`，详情图上传 `7`，SKU 图只支持 `1` 且每 SKU 一张。所有正式请求只能提交 SHEIN URL。

## 6. 合规

| 能力 | 方法与路径 | 类型 | 来源 | 当前状态 | V2 消费者/限制 |
| --- | --- | --- | --- | --- | --- |
| 商品合规要求 | `POST /open-api/goods-compliance-requirements/list` | 读 | `ebf508e0-...txt` | 1179 SKC 只读实测 | 合规总览、单 SKC 规则 |
| SKC 实拍图要求 | `POST /open-api/goods-compliance/skc-label-list` | 读 | `1c4baafc-...txt`、`official-skc-label-list-2025-09-24.md` | 1179 SKC 只读实测；新版字段已归档 | 合规总览、实拍图状态；不返回历史图片 URL/ID |
| 实拍图模板 | `/open-api/goods-compliance/get-label-template` | 读 | 集成蓝图 | 代码测试/原文需核 | 单 SKC 合规 |
| 实拍图上传 | `POST /open-api/goods-compliance/upload-skc-label-picture` | 文件写；20 QPS；PNG/JPEG/JPG；10 MB；长宽各不超过 8000px | `official-upload-skc-label-picture-2025-06-27.md` | 官方字段、multipart 和响应收据已做契约测试；真实店铺待用户验收 | 仅本地单 SKC 明确确认后可用；云端冻结 |
| 实拍图保存 | `POST /open-api/goods-compliance/skc-save-label` | 业务写；20 QPS | `official-skc-save-label-2025-09-29.md` | `skcList/packageLableList/bodyLableList` 契约与本地闭环测试通过；真实店铺待用户验收 | 仅本地单 SKC、写入开关+确认令牌；覆盖/删除语义未获官方保证，云端冻结 |
| 证书规则 | 以原始文档正式 path 为准 | 读 | `2a06eb...`、`83a2d3...` | 代码测试 | 动态证书表单 |
| 证书 Schema | `/open-api/goods-certificate-schemas/detail` | 读 | `6645cacd-...txt` | 代码测试 | 动态证书表单 |
| 证书文件上传 v2 | `/open-api/goods-certificate-files/upload` | 文件写 | `186a02...`、`76b2ae...` | 代码测试；真实上传待验 | 冻结 |
| 证书创建/编辑 | `/open-api/goods-certificates/save` | 业务写 | `6b7fb45f-...txt` 及新接口摘要 | 代码测试 | 冻结 |
| 证书绑定 | `/open-api/goods-certificates/bind` | 业务写 | 集成蓝图 | 代码测试 | 冻结 |
| 证书列表 | `POST /open-api/goods-certificates/search` | 读；10 类型/次；100 条/页；20 QPS | `b48b87e0-...txt` | 原文与代码测试；只缓存 `status=2` | 单 SKC 生效证书库只读列表 |
| 代理公司列表 | `POST /open-api/goods-compliance/agency-list` | 读；100 条/页 | `8592d2a2-...txt` | 原文与代码测试；只缓存状态有效且审核允许绑定记录 | 单 SKC 可绑定代理公司只读列表 |
| SKC 代理公司详情 | `/open-api/goods-compliance/skc-agency-detail` | 读 | 集成蓝图 | 代码测试 | 单 SKC 合规 |
| 保存 SKC 代理公司 | `/open-api/goods-compliance/save-skc-agency` | 业务写 | 集成蓝图 | 代码测试 | 冻结 |
| 警示语/证书规则 | `POST /open-api/goods-compliance/query-warning-certificate-rules` | 读 | `9f9f5a62-...txt` | 原文与代码测试；按当前 SKC code 裁剪启用字段/值 | 单 SKC 手动警示语规则只读列表 |
| 警示状态 | `/open-api/goods-compliance/query-skc-warning-status` | 读 | `af60637d-...txt` | 代码测试 | 合规状态 |
| 更新警示语 | `/open-api/goods-compliance/update-skc-warning-certificate` | 业务写 | 合规原文 | 代码测试 | 仅 `isManualProductWarning=true`；冻结 |
| 合规失效 | Webhook `/product_compliance_change_notice` | 事件 | 字段交接 14.16 | 已接入本地 SKC 风险投影；不自动调用外部写接口 | 标记“需修正”并由合规页面重新校验 |

GCC 与产品标识可通过 `/open-api/goods-compliance-requirements/list` 读取官方要求字段和审核状态。
V2 通过 `gcc`、`product_identifier` 两个只读能力槽投影这些字段；官方说明非手动警告语的
HGXXL 信息暂不支持 API 创建，产品标识符 `certificateTypeId=844` 也明确不支持 API 上传，
因此两类能力不生成提交动作。

## 7. 价格、成本与建议零售价

| 能力 | 方法与路径 | 类型/限额 | 来源 | 当前状态 | V2 策略 |
| --- | --- | --- | --- | --- | --- |
| 更新商品售价 | `/openapi-business-backend/product/price/save` | 业务写 | 字段交接 9.1 | 待补完整字段 | 不进入 V2 |
| 更新成本价 | `/open-api/goods/update-cost` | 业务写 | `89b9c6ab-...txt` | 归档、冻结 | 后续独立功能开关 |
| 涨价原因 | `POST /open-api/goods/query-change-price-reason` | 读；50 QPS | 字段交接 9.2 | 归档 | 原因实时读取 |
| 价格证明上传 | `POST /open-api/goods/discuss/upload-discuss-file` | 文件写；10 QPS；10 MB | 字段交接 9.3 | `type=4` 真实直传实测 | 只保存 `objectKey`；业务提交冻结 |
| 议价单列表/处理 | 以两份原始文档正式 path 为准 | 读/业务写 | `9e0c21...`、`8b7e05...` | 归档、写冻结 | 后续模块 |
| 当前建议零售价 | 以原始文档正式 path 为准 | 读 | `46f077...txt` | 归档 | 全量覆盖前必查 |
| RRP 填写规则 | `POST /open-api/goods/query-recommend-retail-price-rule` | 读 | 字段交接 9.6 | 归档 | 品牌维度动态读取 |
| 批量提交 RRP | `POST /open-api/goods-recommend-retail-price/batch-save` | 业务写；10 SKC/次；20 QPS | 字段交接 9.7 | 归档、冻结 | 全量覆盖，必须合并旧值 |
| RRP 审核记录 | 以原始文档正式 path 为准 | 读 | `ccc736...txt` | 归档 | Webhook 失败详情补偿 |

没有准确财务金额字段时，经营页不推算销售金额。

## 8. 库存写入、采购、发货与退货

这些能力已归档，但不属于 V2 前六阶段的前端范围。

| 领域 | 关键接口 | 类型/限额 | 来源与状态 | 上线要求 |
| --- | --- | --- | --- | --- |
| 全托管库存更新 | `/open-api/goods/stock-update` | 业务写 | `1c13e685-...txt`；冻结 | 按店铺模式选接口，记录前后数量和幂等键 |
| 采购单 | `/open-api/order/purchase-order-infos` | 读 | `e5d91a39-...txt`；归档 | 独立同步投影 |
| JIT 母子单 | `GET /open-api/order/get-mothe-child-orders` | 读；200 单号、40 QPS | 字段交接 11.2；归档 | 实测查询方向与空数组语义 |
| 发货基础 | `/open-api/shipping/basic` | 读 | `e4ff6fd9-...txt`；归档 | 保存平台原始 ID |
| 物流产品 | `POST /open-api/shipping/express-company-list-v2` | 读；50 QPS | 字段交接 11.4；归档 | 不采用示例多余字段 |
| 预估运费 | `/open-api/openapi-business-backend/purchase-estimated-fee` | 读；50 QPS | 字段交接 11.5；归档 | 兼容字段名冲突 |
| 货代 | `/open-api/pfmp/shipping/thirdPartyAndChannelList` | 读；50 QPS | 字段交接 11.6；归档 | 按场景建模 |
| 收货仓 | `GET /open-api/shipping/warehouse` | 读；20 QPS | 字段交接 11.7；归档 | 禁止依赖旧固定佛山仓接口 |
| 创建发货单 | `/open-api/shipping/orderToShipping` | 业务写 | `f5017403-...txt`；冻结 | 前置采购、拆包、物流和仓库校验 |
| 查询发货单 | `/open-api/shipping/delivery` | 读 | `8e9bc063-...txt`；归档 | Webhook 后回查 |
| 修改/取消发货单 | `/open-api/shipping/modify-delivery-order-info` | 业务写；100 QPS | 字段交接 11.10；冻结 | 同一发货单串行 |
| 智能拆包 | `/open-api/purchase/intelligent-packing-result` | 读；30 QPS | 字段交接 11.12；归档 | 输入格式需实测 |
| 退货申请与单据 | `/open-api/purchase/*` 系列 | 读/业务写；20-50 QPS | 字段交接 12；部分路径/方法冲突 | 单条真实闭环前不启用 |

## 9. 财务

| 能力 | 方法与路径 | 类型/限额 | 来源 | 当前状态 |
| --- | --- | --- | --- | --- |
| 报账单列表 | `/open-api/finance/report-list` | 读 | `ad351e4f-...txt` | 归档 |
| 销售款收支明细 | `POST /open-api/finance/report-sales-detail` | 读；200/页；50 QPS | 字段交接 13.2 | 归档 |
| 补扣款明细 | `/open-api/finance/report-adjustment-detail` | 读 | `990cb115-...txt` | 归档 |
| 其他对账入口 | `report-order-list`、`get-check-order-list/detail` | 读 | 字段交接 13.4 | 待补文档 |

财务页面未进入当前 V2 页面地图。补齐字段和产品目标前不创建空页面。

## 10. Webhook

接收链路已完成验签、解密、幂等、原始/标准化载荷保存和 BullMQ 入队；云端 Webhook 与 Worker 已部署。已订阅事件中的已知字段目前只做安全只读投影，未完备字段只保存事件并标记，不触发外部写入。

| 事件 | 当前字段状态 | 业务动作 |
| --- | --- | --- |
| `/product_document_receive_status_notice` | 已归档 | 更新平台接收回执 |
| `/product_document_audit_status_notice` | 已归档，已有安全投影测试 | 更新审核状态；撤回主动查询补偿 |
| `/product_price_audit_status_notice` | 已归档 | 价格审核投影 |
| `/product_prices_abnormal_notice` | 已归档 | 价格异常提醒 |
| `/product_rrp_review_status_changed` | 已归档 | 回查 SKU/站点失败详情 |
| `/product_rrp_validity_changed` | 已归档 | 更新有效期 |
| `/product_quota_change_notice` | 已归档；已接入经营快照额度投影 | 供应商级额度变更写入本地 `productQuota` |
| `/product_delete_audit` | 已归档，接收测试覆盖 | 更新删除审核 |
| `/purchase_order_notice` | 已归档 | 增量拉取采购单 |
| `/delivery_modify_notice` | 已归档 | 按发货单号回查 |
| `/logistics_forecast_result_notice` | 已归档 | 更新合作物流状态 |
| `/purchase_order_return_application_notice` | 已归档 | 回查退货申请 |
| `/purchase_order_return_notice` | 已归档 | 回查退货/报废单 |
| `/out_of_stock_notice` | 已归档 | 生成缺货需求预警，不当实际库存 |
| `/product_compliance_change_notice` | 已归档；已接入本地 SKC 风险投影 | `isMiss=1` 时标记 SKC `需修正`，不自动提交 |
| `/authorization_change_notice` | 已归档；已接入店铺状态投影 | 按供应商将店铺置为 `reauthorization_required` |
| `/product_document_audit_status_notice_all_channels` | 仅有事件名称；当前安全存储、不猜字段 | 待补官方字段后再建业务投影 |

只有事件名称、缺完整字段的其余 6 个事件必须保持“未支持”：商品上下架、订单推送、物流下单结果、退货订单推送、发票状态、库存预警。全渠道商品审核虽然字段仍不完整，但已采用只存储、不解释的安全处理。

## 11. 限流与任务策略

- 文档 QPS 不是前端并发数；应用、接口和店铺三层限流。
- 默认速率取文档上限的 50%-70%，根据真实 429 和耗时调整。
- 同店铺同同步类型只允许一个 `queued/running` 任务；重复刷新返回现有任务。
- 网络、429 和明确 5xx 才自动重试，使用指数退避和抖动。
- 字段、权限和业务状态错误进入人工处理，不自动重试。
- 写操作按业务主键串行，保存幂等键、请求摘要、响应、TraceId 和写后读取结果。

## 12. 首个垂直切片允许使用的能力

阶段 2-5 只开放以下链路：

1. V2 登录与会话。
2. 成员可访问店铺列表和店铺改名。
3. PostgreSQL 缓存中的商品、销量、库存和预警读取。
4. 明确“立即刷新”后创建/复用只读同步任务。
5. 类目、属性和发布规范只读缓存，为阶段 6 模板中心准备。

不开放商品发布、库存更新、上下架、价格、证书绑定、合规提交、采购、发货或退货写入。

## 13. 上线前待确认

- 当前授权店铺对所有计划读取接口的权限和真实响应 schema。
- 商品同步采用 `searchProduct` 还是商品列表作为主分页源。
- GCC、产品标识的完整契约；实拍图历史图片读取、覆盖和删除语义。
- 更新商品售价和其他待补文档接口。
- 7 个缺载荷 Webhook 的官方字段、成功响应和消息 ID。
- 所有文档冲突接口的正式方法、path 和条件必填规则。
