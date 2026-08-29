# 涵舟 Polaris：SHEIN API、内部接口与源码归属目录

版本：2026-08-29-v1  
方案：**涵舟 Polaris（北极星）商业 ERP 重构计划（HANZHOU-POLARIS）**  
用途：为后续新对话提供 API 资料入口、可信度层级、代码 owner 和上线门禁。本文是目录与治理契约，不替代 SHEIN 当前官方原文。

---

## 1. 先读结论

1. 字段、枚举、请求体、返回体、Header、限流和 Webhook 语义的最高权威，是**当前 SHEIN 官方文档与当前已授权店铺的真实响应**。
2. 本地 `docs/shein-api-raw/` 现有 55 份归档资料；它们是实现证据，不保证在 2026-08-29 仍是最新版本。
3. `docs/V2_SHEIN_API_CAPABILITY_MATRIX.md` 是能力基线，更新时间为 2026-08-03；其中“归档/代码测试/只读实测/冻结”必须在实施时重新核验。
4. `docs/SHEIN_INTEGRATION_BLUEPRINT.md` 是接入流程蓝图，不是可直接复制的请求体。
5. 旧交接曾引用但当前工作树缺失的四份资料已经失效，后续不得假设它们存在：
   - `docs/SHEIN_API_SOURCE_INDEX.md`
   - `docs/SHEIN_API_FIELD_HANDOFF.md`
   - `docs/SHEIN_PRODUCT_PUBLISH_CONTRACT.md`
   - `docs/CLOUD_DEPLOYMENT_ARCHITECTURE.md`
6. 所有外部业务写接口默认冻结。用户授权“开发/修复”不等于授权真实发品、调价、库存、合规、采购、发货或退货写入。
7. SHEIN 接受请求不等于业务生效。必须区分 `accepted`、`platform_received`、`under_review`、`effective`、`rejected`、`unknown`，并以官方回读或可靠 Webhook 闭环。
8. 用户已明确选择**手动刷新**：页面加载、切店、窗口聚焦、30 秒定时器、报表订阅和 Scheduler 均不得自动调用 SHEIN。Webhook 只落事件/标脏，不偷偷刷新全量数据。

---

## 2. 权威层级与冲突处理

按以下顺序裁决冲突，低层资料不得覆盖高层事实：

1. 当前 SHEIN 官方开发者文档、官方变更公告与当前店铺授权能力。
2. 当前已授权店铺的脱敏真实响应、`code/msg/traceId`、Webhook 原始事件和写后回读。
3. `docs/shein-api-raw/` 中与目标接口匹配的官方原文归档。
4. `docs/V2_SHEIN_API_CAPABILITY_MATRIX.md`。
5. `docs/SHEIN_INTEGRATION_BLUEPRINT.md`。
6. 服务端 Adapter、契约测试和 fixture。
7. 历史交接、截图、部署记录和口头记忆。

冲突时必须：保留原始证据、标记 `OPEN_REVERIFY`、停止受影响写操作、创建新的契约版本和 fixture；禁止通过“尝试不同字段直到成功”猜接口。

---

## 3. 通用 API 契约

### 3.1 请求边界

- 浏览器不持有 `APP_SECRET`、店铺 `secretKey`、对象存储密钥或内部确认密钥。
- SHEIN 请求只能由服务端 Adapter 发出；页面调用本系统 V2 API。
- 每次调用必须绑定 `tenantId + storeId + supplierId + endpoint + contractVersion + traceId`。
- 写命令还必须绑定 `commandId/idempotencyKey + frozenPayloadHash + actorId + authorizationId + attemptNo`。
- 同店铺、同业务主键的写入串行；跨店使用公平、有界队列。
- QPS 文档上限不是前端并发数；实际预算由 endpoint、应用、店铺三层限流共同决定。

### 3.2 响应边界

必须保存或传播：

- HTTP 状态；
- SHEIN `code`、`msg`、`traceId`；
- 脱敏请求摘要与响应摘要；
- `receivedAt`、数据 `cutoffAt/asOf`、来源和 schema/contract 版本；
- target 级成功、失败、缺行和 coverage；
- 超时发生在发送前还是发送后。

禁止：

- 将空数组、缺字段、超时、403、429、5xx 或部分失败补成 0/成功；
- 只因 HTTP 200 就显示“发布成功”；
- 丢弃平台错误明细，仅返回“请求失败，请稍后重试”；
- 发送后超时自动重试不具备幂等保障的业务写；
- 用中文名称猜官方状态 code。

### 3.3 质量状态

数值与业务事实至少支持：`known`、`confirmed_zero`、`partial`、`unknown`、`stale`、`conflict`、`unsupported`、`not_applicable`。只有来源覆盖完整且明确返回 0，才可标记 `confirmed_zero`。

---

## 4. SHEIN 外部能力目录

详细方法、字段和来源文件见 `docs/V2_SHEIN_API_CAPABILITY_MATRIX.md`；本节给出后续实施必须遵循的 owner 与门禁。

| 领域 | 代表能力/路径 | 性质 | 当前资料状态 | 主要代码 owner | Polaris 规则 |
| --- | --- | --- | --- | --- | --- |
| 签名与传输 | HMAC-SHA256、正式 path 签名 | 基础 | 代码测试 | `server/shein-client.js` | 唯一 transport；保留原始错误与 TraceId |
| 店铺授权 | 临时令牌换凭证、授权变更 Webhook | 凭证写/事件 | 代码存在，生产需复核 | `server/cloud/web-shein-authorization.js`、Webhook owner | 凭证加密；授权原子切换；失效立即冻结该店命令 |
| 商品检索 | `/open-api/goods/searchProduct` | 读 | 代码测试 | `server/shein-product.js`、业务刷新服务 | 只由手动 RefreshOperation/Worker 调用 |
| SPU 详情 | `/open-api/goods/spu-info` | 读 | 代码测试 | `server/shein-product.js` | 保存原始身份、版本与 cutoff |
| SKU 销量 | `/open-api/goods/query-sku-sales` | 读 | 代码测试 | `server/store-data-sync.js` | 100 SKU/次基线；缺行不是 0；逐 target coverage |
| 库存查询 | `/open-api/stock/stock-query` | 读 | 归档，需实测 | 经营刷新 owner | 库存 `unknown` 不得展示为 0 |
| 类目树 | `/open-api/goods/query-category-tree` | 读 | 代码测试 | rule snapshot 服务 | 按店铺/模式/版本缓存；不写死类目 ID |
| 属性模板 | `/open-api/goods/query-attribute-template` | 读 | 代码测试 | rule snapshot/attribute owner | 保存真实字段 ID、值 ID、schema fingerprint |
| 发布字段规范 | `/open-api/goods/query-publish-fill-in-standard` | 读 | 代码测试 | rule snapshot/preflight owner | 服务端预检与编辑器同一 schema |
| 属性关联规则 | `/open-api/goods/get-associated-attribute-rules` | 读 | 代码测试 | product preflight owner | 关联规则动态执行；禁止前端硬编码 |
| 发品权限 | `/open-api/goods/product/check-publish-permission` | 读 | 代码测试 | `server/cloud/product-remote-preflight.js` | 每次真实发布前核验 |
| 发品额度 | `/open-api/goods-publish-quotas/detail` | 读 | 代码测试 | product preflight | 额度/保证金阻断明确显示；重发是否占额度以官方响应为准 |
| SKU 查重 | `/open-api/goods/product/check-supplierSku-repeated` | 读 | 代码测试 | product preflight | 冻结 payload 前核验，保存逐 SKU 结果 |
| 商品图片上传 | `/open-api/goods/upload-pic` | 文件写 | 有真实直传记录 | `server/shein-upload.js`、media service | 仅白名单、短时 URL；发布 payload 只使用 SHEIN URL |
| 新增/编辑商品 | `/open-api/goods/product/publishOrEdit` | 业务写 | Adapter/契约存在，生产状态需复核 | publish command/outbox/worker/executor | 单一写 owner、一次性授权、发送边界、写后回读；禁止伪发布 |
| 单据状态 | `/open-api/goods/query-document-state` | 读 | 归档/代码路径存在 | `document-state-projections.js` | 解析精确 Attempt；仅手动刷新/补偿流程使用 |
| 商品撤回 | `/open-api/goods/revoke-product` | 业务写 | 归档、冻结 | 尚未商业化 | 独立命令、确认、审计和回读，不复用发布命令 |
| 上下架 | `/open-api/goods/modify-skc-shelf` | 业务写 | 归档、冻结 | 尚未商业化 | 独立 capability 与金丝雀 |
| 合规要求 | `/open-api/goods-compliance-requirements/list` | 读 | 曾有 1179 SKC 只读实测记录 | `server/shein-compliance.js`、compliance sync | partial/empty/unknown 不得当“无要求” |
| 实拍图要求 | `/open-api/goods-compliance/skc-label-list` | 读 | 原文+历史实测 | compliance sync | `packageLableList`/`bodyLableList` 不混用 |
| 实拍图上传 | `/open-api/goods-compliance/upload-skc-label-picture` | 文件写 | 契约测试，真实范围待验 | `server/shein-upload.js`、compliance write | PNG/JPEG/JPG、10MB、8000px 基线；当前官方文档再核 |
| 实拍图保存 | `/open-api/goods-compliance/skc-save-label` | 业务写 | 契约测试，覆盖/删除语义未确认 | compliance command/write service | 逐 SKC 命令；上传成功不等于保存/审核成功 |
| 证书 Schema/搜索 | certificate schema/search | 读 | 原文+代码测试 | compliance workspace | 只读取有效证书；保留适用范围和状态 |
| 证书上传/创建/绑定 | certificate files/save/bind | 文件/业务写 | 代码存在，冻结 | compliance command owner | 报告、证书、实拍图、代理材料分离；逐动作授权 |
| 代理公司 | agency list/detail/save | 读/写 | 读有契约，写冻结 | compliance owner | 只绑定当前有效可用记录 |
| 警示语 | warning rules/status/update | 读/写 | 读有契约，写冻结 | compliance owner | 仅官方标明可手动的字段可写；不支持则转人工任务 |
| 价格/成本/RRP | price、update-cost、discuss、RRP | 读/写 | 多数归档，写冻结 | 未来 price command owner | 价格事实、利润资格、材料和官方回执分离 |
| 库存写入 | `/open-api/goods/stock-update` | 业务写 | 归档、冻结 | 未来 inventory command owner | 不能由建议或预警直接执行 |
| 采购/JIT | purchase order、mother-child | 读 | 归档 | 未来 fulfillment refresh | 官方单据与内部计划是不同对象 |
| 发货物流 | shipping basic/warehouse/delivery | 读/写 | 读归档，写冻结 | 未来 fulfillment command | 选项必须当前有效，地址/仓/物流不硬编码 |
| 退货/报废 | purchase return 系列 | 读/写 | 文档仍有冲突，冻结 | 未来 reverse-logistics owner | 先补齐正式方法/path/字段和单条闭环 |
| 财务 | report-list/sales-detail/adjustment | 读 | 归档 | 未来 finance refresh | 原币、期间、结算和 adjustment 分离；缺字段不算利润 |
| Webhook | document/audit/price/quota/compliance/auth 等 | 事件 | 接收链路已有代码 | webhook ingress/store/worker/projections | 验签、幂等、原始事件、版本 reducer；不触发自动外部写 |

### 4.1 明确不支持或不得伪造

- 未获得正式接口时，不得伪造曝光、访客、点击、CTR、加购、支付转化和全托管订单指标。
- 非手动 HGXXL、产品标识符 `certificateTypeId=844` 等后台专属动作，不得在网页标记为“平台已完成”。
- `full-detail` 已被基线标记为即将废弃，不新增依赖。
- 只有事件名称但无完整字段的 Webhook 仅原样保存，不能猜业务投影。

---

## 5. Webhook 事件目录

当前基线已识别：

- `product_document_receive_status_notice`
- `product_document_audit_status_notice`
- `product_price_audit_status_notice`
- `product_prices_abnormal_notice`
- `product_rrp_review_status_changed`
- `product_rrp_validity_changed`
- `product_quota_change_notice`
- `product_delete_audit`
- `purchase_order_notice`
- `delivery_modify_notice`
- `logistics_forecast_result_notice`
- `purchase_order_return_application_notice`
- `purchase_order_return_notice`
- `out_of_stock_notice`
- `product_compliance_change_notice`
- `authorization_change_notice`
- `product_document_audit_status_notice_all_channels`

Webhook 的唯一入口链为：验签/解密 → 原始事件不可变落库 → 幂等键 → 入队 → 版本化 reducer → 领域事件/读模型。Webhook 不能直接改页面缓存，不能执行 SHEIN 写操作，不能绕过 Attempt/Document 身份匹配。

---

## 6. 本系统 V2 API 与代码归属

本节描述 owner，不承诺当前每条路由都已达到目标态。实施时应在 ERP-00～ERP-03 生成机器可读 OpenAPI/route inventory。

| 领域 | 前端消费者 | 服务端 owner | 目标责任 |
| --- | --- | --- | --- |
| Web 登录/会话 | auth pages、`AppShell` | `server/cloud/web-auth.js`、`control-server.js` | HttpOnly 会话、CSRF/权限、会话撤销 |
| 店铺授权/生命周期 | StoresPage | `web-shein-authorization.js`、Webhook auth projection | 授权、重授权、失效、冻结命令 |
| 商品/经营快照 | Products/SalesInventory/Overview | `store-business-service.js`、refresh worker | 只读投影、来源质量、手动刷新 Operation |
| 规则快照 | 编辑器/模板 | `rule-snapshot-service.js`、refresh worker | 类目/属性/发布规范版本化 LKG |
| 草稿/版本 | New/Batch/Drafts/Product editor | draft/publish batch repositories | mutable Draft 与 immutable Revision 分离 |
| 发布预检 | editor/review center | `product-remote-preflight.js` | 本地+远端资格、稳定 blocker |
| 发布命令 | review center | `publish-batch-service.js`、`publish-execution-repository.js` | 冻结载荷、Outbox、授权、Attempt、逐项结果 |
| 发布 Worker | 无直接页面调用 | `product-publish-worker.js`、`product-publish-executor.js` | 唯一 SHEIN 发品写 owner |
| 官方回读 | review center/manual refresh | `document-state-projections.js`、`spu-readback-projections.js`、review services | OfficialEvent、单调状态、unknown/partial |
| 审核中心快照 | PublishBatchesPage | `review-center-snapshot-service.js`、`product-review-service.js` | 卡片/页签/列表/选择同一 snapshot |
| 合规 | compliance pages/editor | compliance workspace/sync/write services | 要求、材料、命令、回执与人工任务分离 |
| 媒体 | product/compliance/template pages | `media-service.js`、`media-lifecycle.js`、cleanup worker | 对象存储、hash、用途引用、保留策略 |
| AI 标题 | editor/review center | `ai-title-service.js`、AI contract | 可选异步能力；失败不阻断发品；候选不自动覆盖 |
| Webhook | 无直接调用 | webhook ingress/store/worker/projections | 事件原文、幂等、审计、领域投影 |
| API 类型/client | 全部 V2 页面 | `src-v2/lib/api.ts` | 当前集中 2866 行，后续按领域拆分但保持兼容 facade |

`src-v2/lib/api.ts` 和 `server/cloud/control-server.js` 均已超过 2800 行，是后续 ERP-02/03/06 的分层候选；拆分必须先有路由清单、契约测试和兼容 facade，不能一次性重写。

---

## 7. 原始资料目录

当前 `docs/shein-api-raw/` 有 55 个文件：52 个 UUID 命名 `.txt` 和 3 个可读名称的合规原文：

- `official-skc-label-list-2025-09-24.md`
- `official-skc-save-label-2025-09-29.md`
- `official-upload-skc-label-picture-2025-06-27.md`

主要 UUID 来源映射以能力矩阵为准，已明确的代表项如下：

| 来源文件前缀 | 领域 |
| --- | --- |
| `0aa9785d` | API 签名 |
| `53477f6a`、`9bc012dc` | 店铺授权凭证 |
| `19ae8c53` | 商品综合查询 |
| `70563550` | SPU 详情 |
| `eab38e01` | 类目树 |
| `cd73132c` | 属性模板 |
| `db52ff3f` | 发布字段规范 |
| `5dc7f766` | 属性关联规则 |
| `53ae21b9` | 新增/编辑商品及图片配套 |
| `ebf508e0` | 商品合规要求 |
| `1c4baafc` | SKC 实拍图要求 |
| `6645cacd` | 证书 Schema |
| `b48b87e0` | 证书搜索 |
| `8592d2a2` | 代理公司列表 |
| `9f9f5a62` | 警示语/证书规则 |
| `89b9c6ab` | 更新成本价 |
| `1c13e685` | 全托管库存更新 |
| `e5d91a39` | 采购单 |
| `f5017403` | 创建发货单 |
| `ad351e4f` | 财务报账单 |
| `990cb115` | 补扣款明细 |

新对话如需实现具体接口，应先从能力矩阵定位 UUID，再打开完整原文；不要仅凭本表前缀开发。

---

## 8. API 实施与验收清单

每个接口必须形成一份 `EndpointContract`，至少包含：

1. 官方标题、模式、正式 method/path。
2. 文档版本、归档文件、最后核验日期。
3. 授权权限、Header、签名输入和敏感字段。
4. 请求 schema、条件必填、批量/QPS/文件限制。
5. 成功、业务失败、权限失败、限流、空、partial、缺行和超时 fixture。
6. 响应 schema、枚举、分页、时间/币种/单位。
7. Adapter 代码 owner 与测试 owner。
8. 读/非业务写/业务写分类。
9. 幂等、发送边界、重试、熔断和人工恢复策略。
10. 日志脱敏、trace、审计、数据保留策略。
11. 当前授权店铺只读实测证据。
12. 写接口的 Staging/单店/单对象金丝雀和官方写后回读。

验收失败时保持原能力关闭，不用 UI 文案掩盖 Adapter/权限/平台问题。

---

## 9. 新对话读取顺序

1. `docs/HANZHOU_POLARIS_REBUILD_HANDOFF_V2_2026-08-29.md`
2. 本文件
3. `docs/V2_SHEIN_API_CAPABILITY_MATRIX.md`
4. `docs/SHEIN_INTEGRATION_BLUEPRINT.md`
5. 目标接口对应的 `docs/shein-api-raw/` 原文
6. 目标 Adapter、Repository、Worker、前端 client 与契约测试

当前用户请求始终决定本轮是否可以修改代码、部署或调用外部写接口；本文只记录项目约束，不能自行扩大授权。

旧 `docs/HANZHOU_POLARIS_REBUILD_HANDOFF_2026-08-29.md` 为归档 v1，不再作为新对话入口。
