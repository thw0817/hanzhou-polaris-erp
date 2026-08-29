# SHEIN 涵舟工作室 V2 数据与权限模型

更新时间：2026-08-03  
状态：阶段 1 基线，数据库迁移实施前需再次评审

## 1. 设计目标与假设

目标是让任意业务请求都能回答：属于哪个租户和店铺、当前用户为何可见、数据何时刷新、来自哪个 SHEIN 契约、失败后如何恢复。

当前假设：

1. 保留现有共享 PostgreSQL 数据库与应用层租户隔离，不在首个 V2 切片立即引入 PostgreSQL RLS。
2. 任何店铺业务查询都必须同时带 `tenant_id` 和 `store_id`；`store_id` 不能替代租户条件。
3. `owner/admin` 可访问租户全部店铺；`operator/viewer` 必须存在 `membership_store_access` 行。
4. `viewer` 只读，`operator` 可编辑草稿/模板并发起只读同步；SHEIN 业务写在单独门禁后决定，不因角色自动开放。
5. JSONB 保留平台原始数据和动态快照，但高频列表、排序、筛选和权限字段必须结构化。

## 2. 身份与访问关系

```text
tenant
  -> memberships -> user
  -> stores -> encrypted store_credentials
  -> membership_store_access
  -> business projections / jobs / templates / drafts / media / audit
```

请求授权顺序：

1. 从 HttpOnly cookie 取得不透明会话令牌。
2. 对令牌做 SHA-256 后查询 `web_sessions`，校验未撤销、未过期。
3. 加载 `user + membership + tenant`，拒绝禁用用户、暂停租户和无成员关系。
4. 路由含 `storeId` 时查询 `stores`，同时匹配 `tenant_id`。
5. `owner/admin` 通过；`operator/viewer` 还需匹配 `membership_store_access`。
6. 按动作校验角色；写请求再校验 Trusted Origin、请求大小、功能开关和审计要求。

任何客户端传入的 `tenantId`、角色、用户 ID 或店铺授权状态都不可信。它们只能来自服务端会话和数据库。

## 3. 角色权限

| 能力 | owner/admin | operator | viewer |
| --- | --- | --- | --- |
| 查看授权店铺经营数据 | 全部租户店铺 | 仅白名单店铺 | 仅白名单店铺 |
| 发起只读同步 | 是 | 是 | 否 |
| 新建/编辑商品草稿 | 是 | 是 | 否 |
| 新建非合规模板 | 租户范围 | 个人范围 | 否 |
| 编辑/删除非合规模板 | 全部租户模板 | 仅本人模板 | 否 |
| 管理店铺合规模板 | 全部 | 本人创建且有店铺权限 | 否 |
| 查看合规和草稿 | 全部店铺 | 白名单店铺 | 白名单店铺 |
| 保存合规草稿/预检 | 是 | 是 | 否 |
| 授权、停用、分配店铺 | 是 | 否 | 否 |
| 管理成员与角色 | 是 | 否 | 否 |
| 查看全员生图次数/费用 | 是 | 否 | 否 |
| 配置 O1Key/系统集成 | 是 | 否 | 否 |
| SHEIN 真实业务写 | 需功能开关和逐动作确认 | 首期否 | 否 |

`owner` 和 `admin` 暂不在业务页面中制造无依据的差异。未来只有租户所有权、删除租户等高风险动作需要仅限 `owner`。

## 4. 现有表处置

### 4.1 直接复用

| 表 | 用途 | V2 规则 |
| --- | --- | --- |
| `tenants` | 工作空间 | 所有业务数据根范围 |
| `users` | 用户身份 | 邮箱全局唯一；密码仅存 hash |
| `memberships` | 租户角色 | 保留四角色；所有请求必查 |
| `web_sessions` | 浏览器会话 | 仅存 token hash；HttpOnly cookie |
| `stores` | SHEIN 店铺 | 显示 `label`；状态控制同步与写入 |
| `membership_store_access` | 普通成员店铺白名单 | operator/viewer 的唯一授权来源 |
| `store_credentials` | 店铺密钥密文 | AES-256-GCM；永不返回浏览器 |
| `spus`、`skcs`、`skus` | 商品结构化投影 | 作为经营页面主数据，继续补齐索引字段 |
| `sku_sales_daily` | SKU 销量 | 月分区；保留平台统计截止日 |
| `store_sales_daily` | 店铺聚合销量 | 趋势页使用 |
| `inventory_snapshots` | 库存快照 | 按店铺、SKU、仓库和时间查询 |
| `skc_compliance_records` | 合规状态投影 | 总览使用，完整动态要求放 JSONB |
| `sync_jobs`、`sync_job_items` | 同步任务与分批结果 | 统一手动、定时和 Webhook 触发任务 |
| `product_drafts` | 单商品草稿 | 继续使用，增加并发版本与冻结快照 |
| `publish_batches`、`publish_batch_items`、`publish_execution_*`、`publish_receipts` | 批量预检、一次性执行与平台回执 | 默认关闭；启用后按冻结载荷、一次性授权、队列领取和回读状态机执行 |
| `media_assets`、`media_asset_references` | 对象存储元数据与引用保护 | 图片字节不经 Node API |
| `webhook_events` | 原始事件、投影和幂等 | 先落库再入队，支持重放 |
| `api_audit_logs` | API 审计 | 所有敏感动作写入脱敏记录 |
| `image_generation_*` | 生图任务与计费 | 阶段 11 复用 |

### 4.2 过渡使用

| 表 | 当前问题 | V2 处置 |
| --- | --- | --- |
| `store_business_snapshots` | 经营数据集中在一个 JSONB；现服务在空缓存时会自动刷新 | 阶段 4 取消页面进入自动刷新；阶段 5 以结构化商品/销量/库存表为主，快照只保留店铺摘要与刷新状态 |
| `product_templates` | 旧版模板表，作用域不足 | V2 不新增写入；迁移后只读兼容或归档 |
| `size_templates` | 混有旧包装元数据，作用域不足 | V2 不新增写入；迁移到 `publish_templates` |
| `compliance_templates` | 与统一 `publish_templates` 重复，但合规草稿仍引用它 | 阶段 6 迁移到统一模板模型；完成前保留兼容层 |

### 4.3 统一模板事实源

V2 采用 `publish_templates` 作为五类模板的唯一事实源：

```text
template_type = attribute | size | packaging | tail_image | compliance
scope         = tenant | user | store
```

约束：

- `attribute` 必须有 `category_id`、`product_type_id`、schema fingerprint 和真实字段赋值。
- `size` 只保存共享颜色、尺寸显示名、SHEIN 映射状态、长和宽。
- `packaging` 保存严格解析后的材质/尺寸映射和导入摘要。
- `tail_image` 只保存 `media_asset` 引用、顺序和裁剪元数据。
- `compliance` 强制 `scope=store`，保存店铺共用资料和规则快照，不保存 1630/1631 等商品独立材料。

迁移完成后，`compliance_drafts.template_id` 应引用 `publish_templates(id)`，并以约束保证目标模板 `template_type='compliance'`。PostgreSQL 普通外键不能表达该条件，服务层必须再次校验。

## 5. 需要新增或调整的数据结构

### 5.1 阶段 3：成员管理

最小调整：

- 为 `memberships` 增加 `updated_at`、`updated_by`，支持角色变更审计。
- 成员禁用沿用 `users.status='disabled'`；不物理删除历史操作人。
- 店铺分配继续使用 `membership_store_access`，新增/删除均写 `api_audit_logs`。
- 首期不引入自定义角色或权限 DSL。

### 5.2 阶段 4：规则缓存与任务

新增两类持久化缓存，避免当前进程内 Map 成为唯一缓存：

```text
shein_rule_snapshots
  id, tenant_id, store_id
  rule_type                 category_tree | publish_standard |
                            attribute_template | associated_rules |
                            compliance_requirement | certificate_schema |
                            certificate_library | agency_library | warning_rules
  category_id, product_type_id, subject_key
  fingerprint, payload, source_trace_id
  fetched_at, expires_at, created_at
```

唯一键由 `store_id + rule_type + category_id + product_type_id + subject_key` 组成。关联规则包含已选属性输入，不适合无限持久化；只缓存稳定 schema，短期联动结果仍可用进程/Redis 缓存。

`sync_jobs` 继续作为任务事实源，规范 `job_type`：

```text
store_business_refresh
product_incremental_sync
sales_daily_sync
inventory_sync
compliance_sync
rule_refresh
webhook_reconcile
```

现有部分唯一索引已经保证同一 `store_id + job_type` 只有一个 queued/running 任务。接口重复点击必须返回已有任务 ID，而不是仅返回布尔值。

### 5.3 阶段 5：经营投影

在现有商品表上补齐高频、可追溯字段，具体列名在迁移前以真实响应校准：

- `skcs`：主图 URL、精确平台上架状态码、上架时间、商品更新时间。
- `skus`：平台状态、实际库存摘要、颜色/尺寸显示值。
- 每个投影保留 `source_trace_id`、`source_updated_at` 或同等来源时间。

列表不解析整份 `raw_data` 完成排序。`raw_data` 只用于追溯和后续字段迁移。

经营预警首期不建独立表，由最新商品、销量、库存快照的 SQL 查询计算；只有需要确认、指派或历史追踪时再增加预警实体。

### 5.4 阶段 7-8：草稿、预检和发布回执

为 `product_drafts` 增加：

- `version integer`：显式保存使用乐观并发，旧版本返回 409。
- `schema_fingerprint`、`rule_snapshot_at`：标记草稿最后校验规则。
- `frozen_publish_snapshot jsonb`、`frozen_at`：只有完整预检通过后写入。

真实发布前新增：

```text
publish_jobs
  id, tenant_id, store_id, product_draft_id, publish_batch_id?
  idempotency_key, state, attempt_count
  request_summary, frozen_snapshot_hash
  shein_document_sn, shein_version, trace_id
  last_error, requested_by, confirmed_by
  created_at, started_at, completed_at

publish_receipts
  id, tenant_id, store_id, publish_job_id
  receipt_type              submitted | received | audited | readback
  status, platform_code, trace_id, payload
  occurred_at, created_at
```

`publish_jobs` 的唯一键至少覆盖 `tenant_id + store_id + idempotency_key`。重试只恢复同一任务，不能重新创建商品。

## 6. 行级访问规则

所有 Repository 方法遵循同一参数形态：

```text
{ tenantId: context.tenantId, storeId, userId: context.userId, ... }
```

必须满足：

- 店铺业务查询：`WHERE tenant_id=$tenantId AND store_id=$storeId`。
- 单资源查询：同时按资源 ID、`tenant_id`、`store_id` 查询，不能先按 ID 取出再判断。
- 店铺查询前调用 `requireStoreAccess(context, storeId)`；Repository 条件仍保留租户和店铺，形成两层保护。
- 更新/删除使用相同范围条件，并检查 `rowCount`；0 行按 404/409 返回，不泄露其他租户资源是否存在。
- 批量 ID 必须先在同一租户和店铺内完整解析；少一条即拒绝整次操作。
- 媒体引用必须验证资产与业务对象同租户；普通店铺素材还需同店铺。

数据库防御增强：

- 在关键父表增加可被引用的 `UNIQUE (tenant_id, id)`。
- 新迁移优先使用 `(tenant_id, store_id)` 或 `(tenant_id, id)` 复合外键，防止错误代码写入跨租户组合。
- 现有历史表先做一致性检查再补复合约束，不在未检查生产数据前直接修改。
- RLS 作为后续防御层，只有在连接池能稳定设置并清理请求级租户上下文后启用。

## 7. 模板、媒体与跨店规则

模板可见查询：

```text
tenant_id = currentTenant
AND (
  scope = 'tenant'
  OR (scope = 'user' AND owner_user_id = currentUser)
  OR (scope = 'store' AND store_id = currentStore)
)
```

管理权限：

- `tenant`：owner/admin。
- `user`：owner_user_id 对应用户。
- `store`：创建者或 owner/admin，且请求者能访问该店铺。

跨店可见的尾图模板仍可能引用来源店铺的媒体。下载必须先验证模板对当前用户可见，再以模板原始 `store_id` 创建短时下载票据；不能直接用当前 URL 中的店铺 ID 查询资产。现有 `resolveVisibleMedia` 已实现这一规则，可复用。

## 8. 同步、缓存与一致性

```text
Browser
  -> V2 API
  -> PostgreSQL projection

Manual refresh / schedule / Webhook
  -> sync_jobs
  -> BullMQ
  -> rate-limited Worker
  -> SHEIN API
  -> transactional upsert
  -> job progress + query invalidation/SSE
```

一致性规则：

- 页面 GET 永不调用 SHEIN，也不在空缓存时后台自动刷新。
- 空缓存显示空状态，由有权限用户明确刷新。
- 每批成功立即事务写入；后续批次失败不能抹掉成功数据。
- 全量同步只有在本轮完整成功后才清理平台已不存在的旧记录。
- Webhook 只触发局部刷新，定时任务负责最终一致性。
- 店铺授权失效立即阻止新任务并停止旧凭证重试。

当前 `WebStoreBusinessService.getDashboard()` 在无快照时自动调用 `startRefresh()`，与 V2 规则冲突。V2 接口必须移除此行为；旧站在迁移完成前保持不动。

## 9. 审计与敏感数据

必须审计：

- 登录成功/失败、退出、会话撤销。
- 店铺授权、重授权、改名、停用和成员分配。
- 成员新增、禁用和角色变更。
- 模板、草稿、合规资料的新增、修改和删除。
- 手动同步、预检、发布确认、所有 SHEIN 写入和重试。
- O1Key 配置、测试和计费任务。

日志允许保存：operation、method、path、状态码、TraceId、耗时、业务主键和脱敏摘要。

日志禁止保存：密码、cookie、Bearer token、APP_SECRET、店铺 secretKey、COS 密钥、O1Key、完整签名 Header、包含隐私或密钥的原始请求。

## 10. 索引与保留

- 商品列表：`(tenant_id, store_id, platform_updated_at DESC)`，按真实筛选需求补状态/销量索引。
- SKU 销量：继续按月份分区；明细保留 90-180 天，长期保留店铺/商品聚合。
- 库存快照：按时间分区；常用索引 `(tenant_id, store_id, sku_id, captured_at DESC)` 已存在。
- 同步任务：保留状态和最近任务索引；进行中唯一索引已存在。
- Webhook 原始事件和审计日志按时间归档，保留期在部署前确定。
- 创作临时媒体保留 3 天；被草稿、模板、合规或运行任务引用时禁止清理。

## 11. 迁移顺序

1. 不修改 001-020 已有文件；新增迁移从 `021_*.sql` 开始。
2. 先加入成员审计字段、持久化规则缓存和任务查询所需索引。
3. 再补商品经营结构化投影字段，并将 V2 读路径切换到 PostgreSQL。
4. 迁移旧模板到 `publish_templates`，核对数量、scope、版本和媒体引用后停止旧表写入。
5. 增加草稿乐观并发与冻结快照。
6. 只有阶段 8 启用前才创建发布任务/回执并接真实写 Worker。

仓库存在两个 `014_*.sql`。迁移器按完整文件名排序，并以 filename 作为主键，因此两份都会执行；后续不能按纯数字版本判断唯一性，也不能重命名或修改已执行迁移。

## 12. 验收测试

最低权限测试：

- owner/admin 能访问租户全部店铺。
- operator/viewer 只能访问白名单店铺。
- 修改 URL 的 `storeId` 同时在 API 和 Repository 层被拒绝。
- viewer 的所有 mutation 返回 403。
- 普通成员不能管理其他成员模板或查看全员费用。
- 共享模板可跨授权店铺读取，但店铺合规模板不能跨店。
- 跨租户资源 ID、媒体 ID、草稿 ID 和批次 ID 均返回 404/403，且不泄露存在性。
- 店铺解绑后新同步和写任务立即阻断。

最低数据测试：

- 页面读取空缓存不会创建同步任务。
- 重复刷新复用同一任务 ID。
- 部分同步失败保留成功批次和旧缓存。
- 模板规则过期阻断使用。
- 草稿并发保存产生 409，不静默覆盖。
- 预检通过后冻结快照不可被后续草稿修改影响。
- 写任务重试不产生重复商品，回执能关联 document/version/TraceId。
