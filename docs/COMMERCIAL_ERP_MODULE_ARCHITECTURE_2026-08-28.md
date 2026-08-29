# SHEIN 商业 ERP 分板块架构决策记录

版本：2026-08-29-v19
方案名称：**涵舟 Polaris（北极星）商业 ERP 重构计划（HANZHOU-POLARIS）**  
状态：17 个板块最新产品目标已完整记录；尚未作为整体实施完成  
适用项目：SHEIN 超级运营中心 / SHEIN 涵舟工作室  
主执行计划：[COMMERCIAL_ERP_MASTER_EXECUTION_PLAN_2026-08-28.md](./COMMERCIAL_ERP_MASTER_EXECUTION_PLAN_2026-08-28.md)

## 0. 文档用途

本文件记录商业 ERP 每一个业务板块经过讨论后确认的产品边界、目标架构、风险、实施顺序和验收标准，避免后续工作依赖聊天记忆。

> **身份校正：** 本文件回答“网站最终应该建成什么样”，是 2026-08-28 深夜至 2026-08-29 凌晨讨论形成的最新 17 板块方案。它不是旧“第 1～20 步”的执行记录，也不是 ERP-00～ERP-23 的完成清单。关联 ERP 编号只表示由哪些工程阶段承接，实际执行状态以执行台账为准；当前 ERP-00～ERP-05 已完成范围收口，ERP-06 正在进行非生产模型设计。新对话请先读 [HANZHOU_POLARIS_REBUILD_HANDOFF_V2_2026-08-29.md](./HANZHOU_POLARIS_REBUILD_HANDOFF_V2_2026-08-29.md)。

约束：

1. 本文件是架构与产品决策记录，不授权修改业务代码、数据库、云端配置或 SHEIN 数据。
2. 实施仍必须进入主执行计划中的正式 ERP-XX 步骤，并在执行台账建立 Run。
3. 后续板块若与已确认决策冲突，必须显式修订决策，不能通过代码补丁暗中改变。
4. 所有权限、安全、状态和数据结论必须以服务端和数据库为准；前端隐藏按钮不构成安全边界。

---

## 板块 01：账号、成员、角色与店铺权限

讨论日期：2026-08-28  
方案状态：方向已确认，待正式实施步骤补充迁移设计与行为规格  
关联执行步骤：ERP-03、ERP-06、ERP-17、ERP-19、ERP-21  
关联问题：BUG-AUTH-001 至 BUG-AUTH-005

### 01.1 结论

现有 `tenant → membership → user → store`、不透明浏览器会话和普通成员店铺白名单方向正确，不做全量重写。商业化升级的核心是补齐统一动作权限门禁、成员生命周期、店铺授权治理、权限缓存失效和账号安全。

成熟度判断：

- 租户与店铺数据隔离：已有可复用基础。
- 登录与基础会话：已有可复用基础。
- 成员店铺白名单：基本成型。
- 业务动作授权：不完整，属于 P0。
- 多工作空间、团队和权限运营：尚未成型。
- 商业级账号安全：需要补强。

### 01.2 当前源码事实

可复用能力：

1. `tenants`、`users`、`memberships`、`stores` 已形成基础租户关系。
2. `membership_store_access` 为 operator/viewer 提供店铺白名单。
3. `web_sessions` 只持久化会话令牌哈希，Cookie 使用 HttpOnly、SameSite=Strict，生产可启用 Secure。
4. 登录鉴权会校验用户、租户、成员关系、会话撤销和过期状态。
5. `requireStoreAccess` 同时匹配 `tenant_id + store_id`，普通成员还需匹配自身白名单。
6. SHEIN 店铺凭证加密保存且不返回浏览器。
7. 邀请和密码重置令牌为一次性哈希令牌。
8. 成员角色或状态变更会撤销该租户中的活动会话。
9. 前端登录失效时清理查询缓存，店铺和成员缓存已包含租户/用户作用域。
10. 账号权限相关定向测试当前 82/82 通过，证明基础能力可继续使用。

已确认缺口：

1. 多个草稿、发布、归档、核价和媒体写路由只有 `authenticate + requireStoreAccess`，没有统一动作级权限检查；viewer 只读未形成完整服务端边界。
2. 所有已登录角色目前都能发起网页 SHEIN 店铺授权；授权成功还会把新店铺授予发起人。
3. 普通成员重命名店铺会修改全局 `stores.label`，并非个人显示偏好。
4. 公开注册接口可把新用户加入运营工作空间，不符合内部商业 ERP 默认邀请制。
5. 登录未指定工作空间时会优先选择角色最高的成员关系，没有明确的工作空间选择。
6. 已存在邮箱无法接受第二个工作空间邀请；全局 `users.status` 也无法正确表达只停用某个工作空间成员。
7. owner/admin 业务能力基本相同，没有所有权转让、最后所有者保护和高风险动作边界。
8. 角色判断散落在页面、路由和服务中；AI 标题又使用单独功能授权表，继续扩展会产生碎片化权限模型。
9. 权限测试覆盖登录、店铺范围、管理员入口和缓存隔离，但缺少 viewer/operator 对每个业务写动作的负向矩阵。
10. 店铺白名单和部分业务表缺少完整的 `(tenant_id, store_id)` 数据库复合约束。

### 01.3 目标授权架构

```text
Browser
  → Session Gateway
  → PrincipalContext
      tenantId
      userId
      membershipId
      membershipStatus
      capabilities
      storeScopes / storeGroupScopes
      authorizationVersion
      authenticationStrength
  → PolicyEnforcer.authorize(action, resource)
  → Domain Service
  → Repository（强制 tenant_id + store_id）
  → Database（复合约束，RLS 后置）
```

授权规则分为三层：

1. 角色/能力回答“可以做什么”。
2. 店铺或店铺组范围回答“可以在哪些店做”。
3. 资源和安全条件回答“当前状态下是否允许做”，例如店铺授权是否正常、发布门禁是否开启、是否需要 MFA 或二次确认。

所有业务接口必须调用同一个授权入口：

```text
authorize(context, action, resource)
```

前端 capability 只负责导航、按钮和解释性 UI；服务端是最终裁决者。

### 01.4 账号与成员数据模型

目标语义：

```text
users.status
  active | globally_locked

memberships.status
  invited | active | suspended | removed
```

原则：

1. `users` 表示全局登录身份。
2. `memberships` 表示用户在某个工作空间的成员关系、状态和角色。
3. 停用某个工作空间成员不能影响该用户在其他工作空间的身份。
4. 同一邮箱可接受多个工作空间邀请。
5. 登录后显式选择或切换工作空间，不再按最高角色静默选取。
6. 移除成员不删除历史审计中的操作人。
7. 至少保留一个活动 Owner；Owner 转让是独立高风险流程。

建议为 `memberships` 增加或等价表达：

- `id`
- `status`
- `role_id` 或预置角色代码
- `authorization_version`
- `updated_at`
- `updated_by`
- `suspended_at`
- `removed_at`

### 01.5 角色预置方案

首期使用预置角色，不开放任意自定义权限 DSL：

| 角色 | 核心职责 |
| --- | --- |
| Owner | 工作空间所有权、管理员任命、安全策略和最高风险动作 |
| Admin | 成员、店铺、集成、系统配置与全局模板管理 |
| Operations Manager | 指定店铺组运营、任务分配、发布、核价与流程管理 |
| Operator | 指定店铺的草稿、模板和被单独授予的运营动作 |
| Reviewer | 指定店铺的审核、合规、寄样或核价流程 |
| Viewer | 指定店铺只读，禁止所有业务写入 |

角色不是唯一授权来源。真实发布必须检查 `product.publish.execute`，不能只因用户名称为 operator/admin 就默认开放。

### 01.6 首期能力词典

```text
member.invite
member.update
member.assign_store
member.assign_role

store.read
store.authorize
store.reauthorize
store.revoke
store.rename

product.draft.read
product.draft.write
product.draft.archive
product.publish.prepare
product.publish.execute
product.publish.retry

review.read
review.refresh
review.archive

price.read
price.accept
price.reject

compliance.read
compliance.write
compliance.submit

ai_title.use
ai_title.configure

audit.read
security.session.manage
```

正式实施前必须从所有 Web API、后台任务入口和 Worker 命令入口生成完整动作清单，不能只采用以上示例。

### 01.7 店铺范围、店铺组和名称

权限范围：

1. Owner 默认拥有整个工作空间范围。
2. Admin 的默认范围和是否自动拥有真实发布能力分开配置。
3. Manager、Operator、Reviewer、Viewer 使用店铺组和单店补充分配。
4. 跨店聚合读取与跨店批量写是不同能力；跨店写必须单独授权。
5. 店铺权限变化后后端下一次请求立即生效。

店铺身份字段建议：

```text
official_name       SHEIN 返回，不允许人工修改
tenant_display_name 管理员设置，工作空间统一
personal_alias      后置能力，仅影响当前成员
```

普通成员不得修改全局店铺名称，也不得新增、重新授权或删除 SHEIN 店铺授权。

### 01.8 权限版本与缓存失效

每次角色、成员状态、店铺范围、店铺组或能力变化时：

1. 增加 `authorization_version`。
2. 服务端每次敏感请求使用当前成员权限，不信任旧前端状态。
3. Session 响应返回权限版本和有效 capabilities。
4. 前端发现版本变化后清理旧作用域查询、选择状态、活动任务和当前无权访问的路由。
5. 403 与 401 分开处理：401 清除登录态；403 清除对应受保护数据并展示权限已变化。
6. Query key 统一通过工厂生成，并包含 tenant/user/authzVersion/store/filter/snapshot 中适用的范围。

### 01.9 页面信息架构

设置中心拆分为：

1. 账号与安全：个人资料、密码、MFA、登录设备和会话。
2. 成员管理：成员状态、角色、团队、店铺范围、最后登录和安全状态。
3. 角色与权限：预置角色的有效能力和变更说明。
4. 团队与店铺组：批量管理十余用户和几十店铺。
5. 店铺与授权：官方身份、连接状态、授权人、授权时间、最近同步和负责人。
6. 集成与功能：AI 标题、邮件、SHEIN 应用和对象存储等系统级配置。
7. 安全与审计：敏感操作、登录风险、权限变更和活动会话。

AI 服务地址、模型和密钥不得继续放在“成员与店铺权限”页面。

成员管理页必须支持：

- 搜索、角色/状态/团队筛选。
- 待邀请、活动、暂停、已移除成员区分。
- 店铺组批量分配和差异预览。
- 撤销、重新生成邀请。
- 有效权限解释，而不只显示角色名称。
- 权限变更人、变更时间和审计时间线。

### 01.10 商业级安全要求

1. 公开注册默认关闭，默认邀请制。
2. Owner/Admin 强制 MFA；其他角色由工作空间策略决定。
3. 登录限流使用 Redis 或数据库共享状态，同时按 IP、规范化邮箱和工作空间限制。
4. 记录登录失败、异常授权、角色/范围变更和会话撤销事件。
5. 支持查看登录设备、撤销单个会话和全部退出。
6. 区分绝对会话过期与闲置超时。
7. Owner 转让、店铺删除授权等高风险动作需要密码/MFA 二次验证。
8. 浏览器写请求执行严格 Origin/Host/Sec-Fetch-Site 策略。
9. 密钥和令牌永不返回前端、日志或审计元数据。

### 01.11 数据库防御

增量加强，不立即重写或启用 RLS：

1. 先只读检查历史数据是否存在跨租户组合。
2. 为关键父表建立可引用的 `UNIQUE (tenant_id, id)`。
3. 为成员店铺授权和业务表补 `(tenant_id, store_id)`、`(tenant_id, resource_id)` 复合外键。
4. Session 可改为引用 membership，或通过复合外键保证用户确实属于会话租户。
5. RLS 只有在连接池能可靠设置并清理请求级租户上下文后才评估启用。

### 01.12 实施顺序

| 子步骤 | 名称 | 核心交付物 |
| --- | --- | --- |
| IAM-01 | 权限动作清单 | 全部路由、Worker 命令和高风险动作清单 |
| IAM-02 | 越权失败基线 | viewer/operator/admin 正负权限矩阵与失败回归 |
| IAM-03 | 统一动作门禁 | 单一 `authorize()` 入口和服务端 fail-closed |
| IAM-04 | 店铺授权治理 | 授权、重新授权、撤销和命名权限收口 |
| IAM-05 | 邀请制入口 | 关闭公开注册，补邀请状态与撤销流程 |
| IAM-06 | 成员生命周期迁移 | membership status、多工作空间和 Owner 保护 |
| IAM-07 | 角色与能力 | 预置角色、能力词典和真实发布独立能力 |
| IAM-08 | 团队与店铺组 | 批量店铺范围、主管角色和差异审计 |
| IAM-09 | 权限版本与缓存 | authzVersion、403 失效和 Query key 工厂 |
| IAM-10 | 设置中心重构 | 账号、成员、角色、店铺、集成、安全页面 |
| IAM-11 | 安全强化 | MFA、会话管理、共享限流和异常登录审计 |
| IAM-12 | 数据库复合约束 | 数据审计、增量迁移、验证和回滚脚本 |
| IAM-13 | 全链路权限验收 | API、浏览器、切账号、切工作空间、切店、多标签页 E2E |

执行归属：

- IAM-01 至 IAM-05 属于 P0 地基，必须在 ERP-03/ERP-06 中完成，不能等到 ERP-17。
- IAM-06 至 IAM-10 主要属于 ERP-06/ERP-17。
- IAM-11 至 IAM-12 属于 ERP-19，但涉及 P0 的部分应提前建立最低安全线。
- IAM-13 属于 ERP-21，并在 ERP-22 金丝雀阶段再次验证。

### 01.13 验收标准

1. Viewer 对全部写接口直接调用均返回统一 403，不发生任何业务写入。
2. Operator 只能在被授权店铺执行被授予的动作，猜测其他店铺或资源 ID 不泄露数据。
3. 普通成员不能新增、重新授权、撤销或全局重命名 SHEIN 店铺。
4. 真实发布必须具有 `product.publish.execute`，且请求、队列和 Worker 三层一致验证。
5. 权限变更后下一次服务端请求立即生效，前端旧缓存和旧选择不会继续暴露数据。
6. 同一用户可属于多个工作空间，并明确选择当前工作空间。
7. 停用某个成员关系不影响该用户在其他工作空间的账号。
8. 最后一个 Owner 不能被移除或降级，Owner 转让有完整审计。
9. 公开注册默认不可用，邀请可撤销、过期且只能使用一次。
10. 所有成员、角色、店铺范围、店铺授权和安全动作都有操作者、时间、结果和脱敏审计。
11. 切账号、切工作空间、切店铺、浏览器回退、多标签页和会话过期均不串数据。
12. 权限矩阵 API 测试、浏览器 E2E、数据库约束验证和部署门禁全部通过。

### 01.14 明确不做

1. 不推倒现有认证和租户基础表重写。
2. 首期不引入任意自定义角色 DSL。
3. 暂不因“看起来更企业级”引入 Keycloak/Auth0 等外部身份平台；只有明确出现企业 SSO/SCIM 客户需求时再评估。
4. 不把前端隐藏按钮当成权限实现。
5. 不在生产数据一致性检查前直接增加复合外键或 RLS。
6. 不把高级多店群功能推迟 P0 动作授权门禁的修复。

### 01.15 已确认决策

1. 现有身份骨架增量升级，不全站重写。
2. 默认邀请制，公开注册关闭。
3. Owner 与 Admin 正式分离。
4. 普通成员不能管理 SHEIN 店铺授权。
5. Operator 的真实发布使用独立能力授权。
6. 引入 Operations Manager、Reviewer、团队和店铺组。
7. 首期采用预置角色，不开放任意自定义角色。
8. 统一服务端动作门禁是所有后续业务板块的前置地基。

### 01.16 后续仍可讨论但不阻塞方向的事项

1. 运营成员默认是否拥有真实发布能力，还是由主管逐人授予。
2. 是否为新品、批量发布和高风险类目增加内部审批策略。
3. 是否需要个人店铺别名；首期默认不做。
4. 企业 SSO、SCIM 和无密码登录的实际商业需求时间点。
5. MFA 对 Operator/Reviewer 是默认强制还是由租户策略配置。

---

## 板块 02：店铺接入、SHEIN 授权、店铺生命周期、多店群组织与切店体验

讨论日期：2026-08-28  
方案状态：方向已确认，待按正式 ERP 步骤完成只读盘点、迁移设计和行为规格  
关联执行步骤：ERP-03、ERP-06、ERP-07、ERP-17、ERP-18、ERP-19、ERP-21、ERP-22  
关联问题：BUG-STORE-001 至 BUG-STORE-010  
关联决策：ADR-019 至 ADR-032

### 02.1 总体结论

现有系统已经具备可复用的店铺接入基础：一次性授权 `state`、服务端临时令牌交换、凭证加密保存、租户/店铺访问校验、按店铺作用域组织部分查询，以及默认关闭业务自动同步。当前问题不是“完全没有架构”，而是店铺身份、授权连接、生命周期、健康状态、数据新鲜度和前端当前店铺被压缩在少数通用字段与页面逻辑中，导致授权、重授权、断开、历史读取、切店和多店管理互相干扰。

本板块采用增量重构，不重做全站。目标是把“店铺”建设成稳定业务实体，把 SHEIN 授权建设成可替换的连接，把切店建设成受控的上下文切换，把同步建设成有证据、有新鲜度、由用户触发的任务。

成熟度判断：

- 授权安全基础：可复用，但动作权限、原子性和错误暴露仍需补齐。
- 店铺稳定身份：尚未正式建模，存在凭证身份与业务身份耦合风险。
- 重授权：当前与新增授权混用，属于 P0。
- 生命周期：当前状态维度过载，属于 P0。
- 历史可读性：断开授权后可能被访问门禁和列表过滤一并隐藏，属于 P0。
- 多店群组织：只有平铺店铺列表，尚未形成商业级组织能力。
- 切店体验：可以工作，但缺少脏表单、并发请求、失效 URL 和多标签页保护。
- 同步策略：坚持手动刷新；需要统一任务 owner、快照和新鲜度表达。

### 02.2 当前代码与接口事实基线

以下结论是本轮只读审查形成的实施基线；正式实施时仍需在对应 Run 中重新取证：

#### 可保留能力

1. 授权 `state` 使用哈希、一次消费和有效期控制，当前有效期约十分钟。
2. 临时令牌交换发生在服务端，SHEIN 密钥不返回浏览器。
3. 店铺凭证加密保存，浏览器接口不直接返回原始凭证。
4. 当前存在全局 `openKeyId` 冲突保护，可阻止同一授权被两个租户直接占用。
5. `requireStoreAccess` 已具备租户、用户、店铺和普通成员白名单基础。
6. 部分 Query Key、路由和组件已按 tenant/user/store 作用域组织。
7. 当前业务定时同步默认关闭，符合“手动刷新为主”的产品决定。

#### 已确认的结构性问题

1. 任意已登录角色都可能发起 SHEIN 授权；前端显示和服务端 API 均未完整使用 `store.connection.manage` 能力门禁。
2. 授权完成不是一个数据库原子事务：店铺、凭证、成员授权和授权尝试可能分阶段落库，失败时会留下半完成店铺。
3. 新增店铺和指定店铺重授权共用泛化流程，没有可靠绑定 `targetStoreId` 和预期平台身份。
4. 店铺稳定身份过度依赖 `openKeyId`。本地 SHEIN 文档将其描述为私域数据权限唯一标识，但它是否能作为永久业务店铺主键仍需用当前官方接口和存量数据验证。
5. 单一 `stores.status` 同时承担店铺生命周期、连接有效性、远端操作能力、调度资格和 UI 可见性，语义冲突。
6. 店铺非 active 时，当前访问门禁可能连历史数据也一起阻断。
7. 撤销授权会清凭证、供应商身份或成员店铺关系，导致“数据仍在”但用户无法从产品界面访问历史。
8. 存在仅按 `supplierId` 标记重授权、未同时限定 tenant/store 的潜在跨租户风险方法；即使当前安全 Webhook 路径已做作用域约束，也必须消除或封死旁路。
9. 授权回调可能把原始错误文本放入 URL；浏览器历史、代理日志和截图可能暴露内部信息。
10. 撤销/断开前只检查部分发布任务，没有统一检查全部进行中的写任务、同步任务和上传任务。
11. 当前店铺本地持久化键是全局键，没有按 tenant/user/workspace 隔离。
12. URL 中店铺无权限或不存在时可能静默回落到第一家可访问店铺，这会把用户带入错误写入上下文。
13. 切店没有统一处理未保存表单、进行中的前端写请求、旧查询取消、选择清理和多标签页变化。
14. 店铺列表缺少店铺组、标签、负责人、收藏、最近使用、连接状态和历史店铺分区。
15. Store API 返回模型不足以支持正式店铺管理台、健康诊断和授权时间线。
16. 当前管理页把新增授权、重授权、撤销等动作混为通用入口，缺少状态解释、影响预览和恢复路径。
17. 普通成员可能修改全局店铺名称；正式模型需要区分平台官方名称、租户显示别名和未来可选的个人别名。
18. IP 白名单、网络、限流、接口下线和签名/凭证失效尚未形成稳定错误分类，容易错误地全部标为“需要重授权”。

#### SHEIN 边界事实

1. 店铺是否关闭，必须以 SHEIN 店铺状态接口和 `/authorization_change_notice` Webhook 等官方证据为准，不能仅凭一次网络错误推断。
2. 发布权限、发布额度、类目权限、保证金和商品业务拒绝属于“业务能力”，不等于店铺连接失效。
3. 所有 SHEIN 字段、状态和身份假设在正式迁移前必须对照当前官方文档、当前只读响应和存量店铺做碰撞审计。

### 02.3 设计原则与责任边界

1. **店铺身份稳定**：授权到期、凭证轮换、暂停运营或断开连接都不能改变内部 `storeId`。
2. **连接可替换**：SHEIN 授权是 Store 的连接，不是 Store 本身。
3. **状态正交**：生命周期、连接、可运营性和数据新鲜度分别建模，禁止继续共用一个万能状态。
4. **历史可读、远端写入受限**：断开连接不删除历史，也不自动取消原有查看权限；远端读取和写入由连接/能力单独阻断。
5. **重授权必须定向**：只能对明确 `targetStoreId` 重授权，身份不一致时绝不覆盖。
6. **授权完成必须原子化**：外部令牌交换之后，本地业务实体、连接、凭证版本、默认分组、尝试和审计在同一事务提交。
7. **切店是上下文事务**：切店前处理未保存内容，切店后清理旧状态并重新校验，不允许静默回落。
8. **后台任务绑定原店铺**：切店不会取消、转移或重绑已经提交到服务端的任务。
9. **手动同步优先**：切店不自动访问 SHEIN，不引入全站轮询；仅活动命令可短轮询或使用 SSE。
10. **默认最小权限**：店铺连接管理、跨店写入和危险生命周期动作使用独立能力授权。
11. **先证明再迁移**：先做只读身份碰撞审计和兼容设计，再增加唯一约束或迁移主键语义。
12. **不引入无必要基础设施**：现阶段使用 PostgreSQL、现有队列和 outbox/inbox 完成可靠流程，不因追求形式引入新的重型平台。

### 02.4 目标领域模型

```text
Workspace / Tenant
├── StoreGroup
│   └── StoreGroupMembership
└── Store                         稳定业务身份和历史归属
    ├── PlatformIdentity          SHEIN 官方/供应商身份映射
    ├── StoreConnection           当前连接及连接状态
    │   └── CredentialVersion     加密、可轮换的凭证版本
    ├── StoreHealth               技术连通性和业务能力探测
    ├── StoreLifecycle            暂停、归档等本地生命周期
    ├── StoreAccess               用户/团队/店铺组访问范围
    ├── StoreSnapshot             最近一次业务数据快照与新鲜度
    ├── AuthorizationAttempt      新增/重授权的一次性状态机
    └── StoreEvent                追加式授权、切换、同步和生命周期审计
```

核心对象职责：

| 对象 | 唯一职责 | 不得承担 |
| --- | --- | --- |
| `Store` | 内部稳定 ID、租户归属、官方名称、租户别名、历史归属 | 直接保存可轮换密钥；用连接状态决定历史是否存在 |
| `PlatformIdentity` | 保存经验证的平台、业务模式、supplier/platform identity | 直接承担用户权限 |
| `StoreConnection` | 表示当前 SHEIN 连接及其状态 | 代替 Store 生命周期 |
| `CredentialVersion` | 版本化保存加密凭证、创建/失效时间和指纹 | 明文回传；覆盖后丢失轮换审计 |
| `StoreHealth` | 保存连接探测、能力探测、错误类别和最后成功时间 | 用一次技术失败永久改变店铺身份 |
| `StoreLifecycle` | 表示 active/suspended/archived 及原因 | 表示 API 是否可用或数据是否新鲜 |
| `StoreSnapshot` | 表示某类业务数据的版本、来源、时间和覆盖率 | 作为授权凭证或业务主数据唯一来源 |
| `AuthorizationAttempt` | 一次新增/重授权流程及幂等、过期、结果 | 作为永久凭证容器 |
| `StoreEvent` | 追加式记录操作者、动作、前后状态和 operationId | 被更新覆盖成为当前状态表 |

### 02.5 四维状态模型

#### 02.5.1 生命周期 `lifecycle_status`

- `active`：纳入日常运营。
- `suspended`：本地暂停，不接受新的远端业务任务，但保留历史、连接和权限。
- `archived`：退出日常经营视图，仅管理员或获授权人员可从历史店铺入口查看。

#### 02.5.2 连接状态 `connection_status`

- `authorizing`：授权流程尚未完成。
- `connected`：存在可使用凭证，最近连接验证通过。
- `reauthorization_required`：凭证/签名身份类证据明确要求重授权。
- `disconnected`：本地已主动断开，不再持有可用凭证。
- `revoked`：SHEIN 官方回调或官方查询确认撤销。

#### 02.5.3 可运营状态 `operational_status`

- `ready`：允许当前已授权能力。
- `degraded`：连接仍有效，但部分读取、限流、IP 白名单、额度或某项能力异常。
- `blocked`：当前不能发起远端业务动作；必须同时给出稳定原因码。

#### 02.5.4 数据新鲜度 `freshness_status`

- `never_synced`：从未获得该数据集快照。
- `syncing`：存在当前同步任务。
- `fresh`：在该数据集的 SLA 内。
- `stale`：有旧快照但已过 SLA，仍可显示且必须标注时间。
- `failed`：最近同步失败；旧成功快照不能被清空。

状态组合示例：

- IP 白名单配置错误：`connected + degraded`，不能误标为重授权。
- 官方签名/凭证失效：`reauthorization_required + blocked`。
- 主动断开后查看历史：`disconnected`，本地历史仍可读取，远端动作拒绝。
- 库存快照过期：只改变库存数据集的 `freshness_status`，不改变店铺身份和连接。

### 02.6 稳定身份与凭证策略

1. 内部 `storeId` 一旦创建永久稳定，草稿、商品、发布、审核、合规、库存、任务和审计全部引用它。
2. `openKeyId` 作为授权/权限身份保存，不直接等同于永久内部店铺主键。
3. 候选平台稳定身份可以是经验证的 supplier/platform identity 组合，但正式采用前必须完成：
   - 当前所有店铺只读身份回读；
   - 重复、缺失、历史变化和业务模式碰撞报告；
   - SHEIN 当前官方字段语义核对；
   - migration preflight 和唯一约束演练。
4. 凭证使用 `CredentialVersion` 追加版本；新版本激活后旧版本失效并保留脱敏审计，不覆盖历史。
5. 凭证加密、密钥轮换、读取权限和日志脱敏沿用现有安全基础，未经独立安全 Run 不重写加密实现。
6. 官方名称只由平台身份同步；租户管理员可改租户显示别名；普通成员不能改全局名称。

### 02.7 新增店铺授权状态机

1. 用户必须通过 `store.connection.manage` 服务端能力校验。
2. 创建 `AuthorizationAttempt`，固定 `tenantId`、`actorUserId`、`purpose=connect_new`、过期时间、一次性哈希和 operationId。
3. 浏览器跳转 SHEIN；浏览器只持有不透明 state，不持有业务密钥。
4. 回调先原子 claim 尝试，拒绝重放、过期、租户错配和已完成尝试。
5. 服务端交换临时令牌，获取并校验平台身份、业务模式和必要连接信息。
6. 检查同工作空间重复店铺、跨工作空间授权冲突和身份碰撞。
7. 在一个数据库事务中写入/确认 `Store`、`PlatformIdentity`、`StoreConnection`、新 `CredentialVersion`、默认店铺组成员、授权尝试结果和审计事件。
8. 事务失败必须完整回滚；不得留下 active 空店铺、孤儿凭证或已完成但不可用的 attempt。
9. 事务后执行只读健康探测；探测失败可以进入 `degraded`，不能回滚已经有效的身份事实。
10. 回到浏览器时只携带 `attemptId` 和稳定结果码；详细错误、trace 和敏感上下文保留在服务端。
11. 页面通过结果查询接口展示“已连接 / 已连接但需配置 / 失败可重试”，不依据 URL 文本猜测。

### 02.8 指定店铺重授权状态机

1. 重授权只能从具体店铺详情发起，使用 `purpose=reauthorize`、`targetStoreId` 和 `expectedPlatformIdentity`。
2. 发起人必须同时具备该店铺范围和 `store.connection.manage` 能力。
3. 回调获得的平台身份必须与目标店铺的已验证身份匹配。
4. 身份不匹配时立即停止，不覆盖原店铺；页面只提供“取消”或经过明确确认后“作为新店铺接入”。
5. 重授权成功只替换连接/凭证版本，必须保留原 `storeId`、历史商品、草稿、发布记录、审核记录、成员权限、店铺组和别名。
6. 并发重授权按 store/attempt 幂等；较旧结果不能覆盖较新的有效连接。
7. 重授权成功后运行只读健康探测，并记录前后凭证版本指纹和操作者，不记录密钥。

### 02.9 店铺生命周期动作

| 动作 | 凭证 | 历史 | 成员/团队访问 | 新远端任务 | 日常切店器 | 恢复方式 |
| --- | --- | --- | --- | --- | --- | --- |
| 暂停运营 | 保留 | 可读 | 保留 | 阻断 | 显示“已暂停” | 管理员恢复 |
| 断开连接 | 清除/失效 | 可读 | 保留 | 阻断 | 历史分区显示 | 指定店铺重授权 |
| 官方撤销 | 标记失效 | 可读 | 保留 | 阻断 | 历史/需重授权分区 | 身份匹配重授权 |
| 归档 | 按策略保留或已失效 | 管理入口可读 | 保留审计 | 阻断 | 默认隐藏 | 管理员取消归档 |
| 永久删除 | 非普通产品动作 | 不适用 | 不适用 | 不适用 | 不提供 | 仅独立合规流程 |

生命周期动作必须先：

1. 查询所有进行中的发布、上传、同步、回读、AI/媒体和迁移任务，而不只是发布任务。
2. 展示影响预览，明确哪些任务继续、哪些必须等待或取消。
3. 对断开、归档等高风险动作进行 step-up/MFA（在账号安全能力具备后启用）。
4. 生成 operationId 和追加式审计事件。
5. 使用幂等命令，重复点击不产生第二次破坏性动作。

### 02.10 健康、能力与错误分类

Store Health 至少分三层：

1. **连接健康**：签名、凭证、网络、DNS、TLS、IP 白名单、限流。
2. **平台状态**：店铺 active/closed/revoked 等官方状态。
3. **业务能力**：发布权限、额度、保证金、类目、商品读回等独立能力。

错误分类必须使用稳定代码：

- `AUTH_CREDENTIAL_INVALID`
- `AUTH_REVOKED_BY_PLATFORM`
- `NETWORK_UNAVAILABLE`
- `IP_NOT_ALLOWED`
- `RATE_LIMITED`
- `PLATFORM_SERVICE_UNAVAILABLE`
- `STORE_CLOSED`
- `CAPABILITY_PUBLISH_DENIED`
- `CAPABILITY_QUOTA_EXHAUSTED`
- `IDENTITY_MISMATCH`
- `RESULT_UNKNOWN`

规则：

1. 只有身份/凭证证据可以进入 `reauthorization_required`。
2. 网络、限流和 SHEIN 5xx 只能进入暂时 degraded/unknown，不清凭证、不自动重授权。
3. 发布额度为 0 不代表店铺断开，也不影响查看其他历史数据。
4. UI 给运营人员显示可执行说明，详细原始错误、traceId 和 endpoint 信息留在诊断台。

### 02.11 多店群组织与访问模型

第一阶段采用“一家店一个主店铺组 + 多个标签”，不做无限层级组织树：

1. `StoreGroup` 属于工作空间，可表示事业部、国家站、品牌线、负责人小组或业务批次。
2. 一家店首期只有一个 primary group，避免统计和授权继承歧义。
3. 一家店可以有多个 tags，用于国家、品类、业务模式、优先级等轻量分类。
4. 用户/团队可获得店铺组访问或单店直接访问，两者取并集。
5. 首期不设计显式 deny；复杂冲突在未来有真实客户需求时再升级。
6. “全部店铺”默认是只读聚合上下文，不是一个可直接执行写操作的虚拟店铺。
7. 跨店写入必须使用独立能力、明确目标店铺清单、执行前预览和二次确认。
8. 店铺记录区分负责人、协作团队和授权范围；负责人不自动等于 Owner/Admin。
9. 店铺组、标签、负责人和访问变更全部审计，并触发 authorizationVersion 失效。

### 02.12 商业级切店协调器

切店不再只是修改 URL 或 React state，而是执行以下固定顺序：

1. 识别当前页面是否存在未保存草稿、表单或尚未提交的编辑。
2. 识别浏览器内尚未完成的写请求；向用户提供保存、放弃或取消切换。
3. 停止旧店铺的前端只读轮询、订阅和请求；已进入服务端的任务不取消。
4. 清除旧店铺的复选、筛选、详情抽屉、临时表单和乐观 UI。
5. 导航到包含明确 `storeId` 的目标 URL。
6. 服务端重新校验 tenant、user、store access、连接和动作能力。
7. 先展示目标店铺最近可信快照及新鲜度，不因切店自动请求 SHEIN。
8. 明确提示“已切换至 ××店”；活动任务通过全局任务中心继续通知，并标明原店铺。

必须处理：

- A→B 快速切换和 A→B→A。
- 多标签页中账号、工作空间或店铺权限变化。
- 浏览器回退/前进和深层链接。
- 无权限、不存在、已归档、已断开或 URL 被篡改的店铺。
- 旧 A 请求晚于 B 请求返回时，A 的响应不得写入 B 的界面。

禁止静默回落到第一家店。失效 URL 必须展示明确状态和可选择的安全入口，不自动替用户选择写入目标。

当前店铺持久化键至少按 `tenantId:userId:workspaceId` 隔离；服务端 URL 和权限校验是最终事实，localStorage 仅用于体验恢复。

切店器应支持：

- 按店铺组、连接状态和生命周期分区。
- 最近使用、收藏和负责人。
- 搜索租户别名、官方名称、supplier ID、标签和负责人。
- “需重授权 / 已断开 / 已暂停 / 已归档”历史入口。
- 清晰显示当前上下文，避免同名店铺误选。

### 02.13 同步与数据新鲜度

1. 不增加全站 30 秒自动同步。
2. 切店只读取数据库快照，不自动调用 SHEIN。
3. 用户点击“手动刷新”时创建或复用该 `tenant/store/dataset` 的单一活动任务。
4. Webhook 作为官方事件增量更新投影，但不取代定期人工核验和手动全量刷新。
5. 发布、重授权或刷新后的 2–3 秒反馈窗口可以使用 SSE 或有上限短轮询；任务结束、超时或离页后停止。
6. 规则、类目、属性 schema 等低频平台资料维护与店铺业务数据刷新分开，不显示为店铺自动同步。
7. 每个数据集独立保存 `snapshotVersion`、`source`、`lastAttemptAt`、`lastSuccessAt`、`coverage`、`freshness` 和最近错误。
8. 单个数据集失败不清空其他成功数据，也不把旧成功快照改成 0。
9. 部署门禁检查业务调度器仍为关闭状态；未来要启用必须另立 ADR 和容量验证。

### 02.14 店铺管理信息架构

#### 店铺列表

至少展示：

- 租户别名和 SHEIN 官方身份。
- supplier/platform identity 的脱敏摘要。
- 主店铺组、标签、负责人和协作团队。
- 生命周期、连接状态、可运营状态和数据新鲜度。
- 最近成功同步、最近授权、授权操作者和异常原因。
- 可执行动作；按钮必须依据服务端 capability matrix，而不是仅按角色名判断。

#### 店铺详情

使用以下页签：

1. **概览**：身份、状态、能力、新鲜度和近期异常。
2. **SHEIN 连接**：连接版本、授权时间线、健康探测、重授权。
3. **成员与团队**：负责人、组继承和直接访问。
4. **同步与新鲜度**：按数据集显示快照、任务和手动刷新。
5. **事件与审计**：授权、重授权、Webhook、切换、生命周期和危险动作。
6. **危险操作**：暂停、断开、归档；展示影响预览并要求高权限确认。

“新增授权”“重授权”“断开连接”“暂停运营”“归档店铺”必须是不同动作和文案，不能继续全部叫“授权/删除授权”。

### 02.15 安全、审计与可观测性

1. 新增、重授权、断开、恢复、暂停、归档和跨店写入全部生成 operationId。
2. 审计 actor、tenant、store、attempt、前后状态、凭证版本指纹、结果码、时间和 releaseId。
3. URL、日志、分析平台和前端 toast 不出现 token、secret、完整回调错误或原始敏感响应。
4. 回调重放、跨租户 state、过期 state、错误 target store 和身份不匹配必须有结构化安全事件。
5. 授权/撤销接口执行 CSRF、Trusted Origin、速率限制和服务端 capability 校验。
6. 断开、归档和 Owner 级授权管理在 MFA 能力完成后使用 step-up 验证。
7. 诊断台能够从 attemptId/operationId 追踪浏览器、API、数据库事务、SHEIN 请求和最终 StoreEvent。
8. 健康检查和告警使用脱敏状态，不允许为了诊断泄露凭证。

### 02.16 数据迁移与向后兼容

实施只能采用 additive migration：

1. 先只读盘点 store、openKey、supplier、membership access、draft、publish、review 和 job 引用关系。
2. 输出身份碰撞、缺失身份、重复授权、无访问路径历史店铺和半完成授权清单。
3. 新增结构先允许旧代码继续读写；通过双读比对证明新投影正确。
4. 只有身份映射 100% 可解释后，才回填稳定关系和增加唯一约束。
5. 迁移不删除旧列、旧凭证审计、历史访问关系或店铺记录。
6. disconnected/revoked 历史店铺先恢复安全只读入口，再迁移 UI 列表过滤。
7. 在 staging 复制真实规模脱敏数据，演练前滚、旧应用回退和新应用重启。
8. 生产迁移必须单独获得批准，并具有 before/after 报告、备份和明确回滚边界。

### 02.17 分步实施顺序

以下编号是板块内建设项，不替代 ERP-XX；开始实施时必须映射到正式 Run：

| 编号 | 名称 | 必须完成的范围 | 主归属步骤 |
| --- | --- | --- | --- |
| STORE-01 | 当前事实与身份碰撞审计 | 只读盘点身份、连接、历史引用、孤儿记录和旁路方法 | ERP-03、ERP-05 |
| STORE-02 | 状态词典与 API 契约 | 定稿四维状态、错误码、Store DTO 和动作矩阵 | ERP-04、ERP-07 |
| STORE-03 | P0 授权能力门禁 | 新增/重授权/撤销/改名 API 与 UI 全部接入统一 capability | ERP-03、ERP-06 |
| STORE-04 | 授权尝试与原子完成 | 一次性 attempt、回放保护、单事务提交和失败回归 | ERP-06、ERP-07 |
| STORE-05 | 稳定 Store/Connection/Credential 模型 | additive schema、双读和迁移演练 | ERP-06 |
| STORE-06 | 指定店铺重授权 | target store、身份匹配、凭证轮换、历史保持 | ERP-06、ERP-07 |
| STORE-07 | 健康与业务能力分类 | 连接、平台状态、业务能力和错误分类 | ERP-07、ERP-18 |
| STORE-08 | 生命周期与任务排空 | 暂停、断开、撤销、归档及全部活动任务检查 | ERP-06、ERP-17 |
| STORE-09 | 历史读写门禁分离 | 断开历史可读、远端动作阻断、访问关系保留 | ERP-06、ERP-17 |
| STORE-10 | 店铺组、标签与负责人 | 主店铺组、多标签、团队/直接访问并集 | ERP-17 |
| STORE-11 | 切店上下文协调器 | 脏表单、请求取消、选中清理、无静默回落、多标签页 | ERP-17、ERP-21 |
| STORE-12 | 商业级店铺管理台 | 店铺列表、详情六页签、状态说明和危险操作 | ERP-17、ERP-21 |
| STORE-13 | 手动刷新与新鲜度统一 | 单 owner、快照元数据、Webhook、活动命令短轮询 | ERP-10、ERP-17 |
| STORE-14 | 审计与运营诊断 | operationId、授权时间线、结构化错误和安全告警 | ERP-18、ERP-19 |
| STORE-15 | 迁移、E2E 与金丝雀 | staging 迁移、全链路 E2E、故障演练、受控 canary | ERP-19、ERP-21、ERP-22 |

执行约束：STORE-01 至 STORE-06 是 P0 地基，不能被视觉改版、店铺组或经营分析提前绕过。每项都必须先有失败证据或现状报告，再做最小可验证变更。

### 02.18 验收标准

#### 权限与授权

1. 普通成员不能新增、重授权、断开、撤销或修改全局店铺身份，API 和 UI 均 fail closed。
2. 授权事务任一数据库写失败时，不留下可见 active 店铺、孤儿凭证、错误成员授权或假完成 attempt。
3. 回调重放、过期、跨租户、错误目的、错误目标店铺和身份不匹配全部被拒绝并审计。
4. 指定店铺重授权后 `storeId`、历史、成员权限、店铺组和所有业务引用保持不变。

#### 生命周期与历史

5. 断开/官方撤销后，获授权用户仍可读取本地历史；所有 SHEIN 远端动作明确阻断。
6. 暂停、断开、撤销和归档在列表、详情、切店器和 API 中语义一致。
7. 任一生命周期动作会检查所有活动任务；重复命令幂等，不产生第二次副作用。
8. IP 白名单、限流、网络和 SHEIN 5xx 不会错误清凭证或标记重授权。

#### 店群与切店

9. 店铺组继承和单店直接授权的并集有服务端测试；无权限店铺不会出现在聚合结果。
10. A→B、A→B→A、多标签页、浏览器回退、失效 URL 和会话变化均不串数据。
11. 未保存内容切店前明确提示；服务端进行中的发布仍绑定原店铺并在全局任务中心通知。
12. 旧 A 请求晚到时不会覆盖 B 页面；复选、筛选、抽屉和乐观数据不会跨店保留。
13. 无权限或不存在店铺不静默回落到第一家店。

#### 同步、界面与发布门禁

14. 切店不发起 SHEIN 请求；业务数据仅手动刷新，且同一数据集重复点击复用同一任务。
15. 每个列表和汇总显示数据截止时间、覆盖率和 unknown 数量；失败不清空旧成功快照。
16. 授权、重授权、断开、暂停、归档在 UI 中具有独立文案、影响预览和恢复路径。
17. Playwright 行为 E2E、API 契约、数据库事务失败注入、迁移演练、安全负向测试和视觉回归全部通过。
18. release manifest 能证明业务定时同步仍关闭，Control/Worker/前端运行同一批准版本。

### 02.19 明确不做

1. 不因本板块重做全站 UI、导航、品牌或稳定业务页面。
2. 不立即部署 Keycloak、OpenFGA、Temporal 等新基础设施。
3. 不继续把凭证标识当作唯一永久店铺业务身份。
4. 首期不做无限嵌套店铺组、显式 deny 或任意策略 DSL。
5. 不允许“全部店铺”上下文直接执行未预览的跨店写入。
6. 不在切店时自动同步 SHEIN，也不增加全站定时轮询。
7. 不把断开授权实现成删除店铺、删除访问关系或隐藏全部历史。
8. 不在身份碰撞审计和 staging 演练前修改生产唯一约束或批量合并店铺。
9. 不向普通用户提供永久删除店铺及历史的按钮。
10. 不用一次网络异常、限流或业务拒绝推断凭证失效。

### 02.20 开源项目借鉴边界

1. [Keycloak](https://github.com/keycloak/keycloak)：借鉴强认证、会话、MFA 和高风险动作 step-up 模式；当前不替换现有身份系统。
2. [OpenFGA](https://github.com/openfga/openfga)：借鉴“主体—关系—资源—动作”表达；首期继续使用数据库模型和统一 `authorize()` 服务实现。
3. [Temporal](https://github.com/temporalio/temporal)：借鉴持久状态机、幂等和补偿语义；当前使用 PostgreSQL 事务、outbox/inbox 和现有队列落地。
4. [Saleor](https://github.com/saleor/saleor)：借鉴多渠道作用域显式化、上下文 URL 和跨渠道聚合边界；不把 Saleor channel 机械等同于本项目 tenant/store。

开源项目只提供设计参照。引入依赖前必须证明解决了当前不可替代的问题，并通过资源、维护、安全、迁移和回滚评审。

### 02.21 已确认决策

1. Store 是稳定业务实体，SHEIN 授权是可替换连接。
2. 生命周期、连接、可运营性和数据新鲜度使用四个独立状态维度。
3. 新增授权与指定店铺重授权是两套目的明确的流程，身份不匹配绝不覆盖。
4. 授权完成在外部令牌交换后使用一个本地数据库事务提交，不保留半完成 active 店铺。
5. 断开连接保留店铺身份、历史和访问关系，只阻断远端动作；归档是独立动作。
6. 第一阶段采用一个主店铺组和多个标签，不做深层组织树。
7. 全店聚合默认只读；跨店写入必须独立能力、明确目标和二次确认。
8. 切店是受保护的上下文切换，不允许静默回落到第一家店。
9. 当前店铺本地持久化按 tenant/user/workspace 隔离。
10. 服务端活动任务始终绑定原店铺，切店不取消、不转移。
11. 业务数据以手动刷新为主；切店不调用 SHEIN；Webhook 和活动命令有界反馈是明确例外。
12. 平台稳定身份和唯一约束只在官方字段与存量数据只读验证后确定。
13. 当前阶段借鉴 Keycloak/OpenFGA/Temporal/Saleor 的成熟模式，不直接部署重型替代平台。
14. disconnected/reauthorization_required 店铺在原访问权限仍有效时可读取本地缓存历史，远端读写单独受限。

### 02.22 后续仍可讨论但不阻塞方向的事项

1. 个人店铺别名是否有真实协作价值；首期只做官方名称和租户别名。
2. 归档店铺在日常管理台保留多久后进入冷历史入口。
3. 默认店铺组命名规则，以及现有店铺如何自动分入初始组。
4. 不同业务数据集的 fresh/stale SLA，应在真实 API 限流和运营频率测试后确定。
5. 哪些只读 SHEIN endpoint 组成最低成本健康探测，必须在 ERP-07 对照当前官方文档确认。
6. Operator 是否默认可查看 disconnected 历史；推荐在原 StoreAccess 未撤销时继续只读。
7. 店铺组负责人是否可被委派 `store.connection.manage`；首期默认不自动授予。

---

## 板块 03：商品主数据、SPU/SKC/SKU、草稿版本与商品生命周期

讨论日期：2026-08-28  
方案状态：核心领域模型已确认，待 ERP-04/05 完成状态词典与存量关系审计后实施  
关联执行步骤：ERP-03、ERP-04、ERP-05、ERP-06、ERP-09、ERP-10、ERP-11、ERP-12、ERP-13、ERP-14、ERP-15、ERP-20、ERP-21、ERP-22  
关联问题：BUG-PROD-001 至 BUG-PROD-011  
关联决策：ADR-033 至 ADR-050

### 03.1 总体结论

现有系统已经具备草稿、发布批次、执行任务、回执、审核投影以及 SHEIN SPU/SKC/SKU 只读投影，不能推倒重来。真正的结构性问题是：`product_drafts` 同时被当作可编辑工作副本、商品身份、发布来源和生命周期载体；发布后又依靠是否存在 `publish_job`、最新时间、SHEIN version/document/SKC 等启发式逻辑恢复“当前商品”和“当前尝试”。

商业级方案必须把五件事彻底分开：

1. 稳定的内部商品是谁。
2. 用户当前正在编辑什么。
3. 本次提交冻结了哪一个版本。
4. 本次向 SHEIN 发起了哪一次尝试。
5. SHEIN 最终给出了哪些 SPU/SKC/SKU 身份和官方状态。

本板块采用增量领域建模：保留现有灵活 JSONB 内容和可靠发布基础，新增稳定商品身份、不可变版本、明确尝试关系和平台身份映射。草稿只负责编辑，不再承载“已发布”“已驳回”“已上架”等平台生命周期。

成熟度判断：

- 草稿编辑与预检：功能较丰富，可保留；并发和版本边界不完整。
- 发布批次、Job、Receipt：已有可靠管线基础，可增量关联 ProductVersion。
- SHEIN SPU/SKC/SKU 投影：已有基础表，可继续作为官方只读投影。
- 稳定内部商品身份：尚未建立，属于 P0。
- 不可变商品版本：尚未建立，属于 P0。
- 当前发布尝试关系：主要依靠推断，属于 P0。
- 草稿/发布/审核页面归属：已有补丁式过滤，缺少规范读模型。
- 历史可重现性：只有 fingerprint 和部分摘要，素材/规则/版本归属需要加强。

### 03.2 当前代码事实基线

以下事实来自本轮只读审查，正式实施时仍必须在对应 Run 中重新取证：

#### 可保留能力

1. `product_drafts` 已按 tenant/store 隔离，保存类目、商品类型、草稿 JSON、预检 JSON 和编辑状态。
2. `publish_batches`、`publish_batch_items`、`publish_execution_runs`、`publish_jobs` 和 `publish_receipts` 已分层保存批次、执行、幂等和官方回执。
3. Publish Job 已保存候选 fingerprint、request summary、SHEIN document/version、trace 和 result_unknown 等关键证据。
4. `product_review_states`、Webhook 和 readback 服务已尝试把官方审核结果投影到统一审核中心。
5. `spus`、`skcs`、`skus` 已存在，可作为当前店铺的 SHEIN 官方商品只读投影。
6. 草稿服务端会重新执行预检，而不是完全信任浏览器传入的 ready 状态。
7. 发布完成、媒体引用和审核重发已经有定向测试基础，可用于建立失败回归。

#### 已确认的结构性问题

1. `product_drafts.status` 同时包含 `draft/blocked/ready/published/archived`，混合了编辑状态、远端结果和本地归档。
2. 默认草稿查询通过“是否存在任意 `publish_job`”排除已交接记录，而不是读取明确的 `handed_off` 事实；意图正确但归属不稳定。
3. Publish Job 直接引用 mutable `product_draft_id`，没有引用提交时冻结的 `product_version_id`。
4. 已驳回重发允许复用 `published/archived` 草稿，导致旧发布证据与新的可编辑内容缺少不可变边界。
5. 草稿保存使用 upsert 和 `updated_at`，没有服务端 `lock_version/ETag` 条件；两个编辑者可能后保存覆盖先保存。
6. 前端虽然在部分批量操作中比较 `updatedAt`，但这不是数据库级并发控制，无法覆盖所有保存入口。
7. 草稿页首次加载会自动重校验一部分 blocked 草稿，重校验会再次保存草稿；只读打开页面可能产生隐藏写入和状态变化。
8. 审核中心通过 version、document、SKC、job 和时间顺序推断当前尝试，并用复杂规则压制旧驳回；缺少明确 `current_attempt_id` 关系。
9. SHEIN 官方 SPU/SKC/SKU 投影与本地草稿/商品/版本之间没有一套稳定、可审计的平台身份映射。
10. 发布完成后会把草稿标为 `published` 并释放部分 `product_draft` 媒体引用，但没有显式 ProductVersion 作为不可变素材所有者，历史版本可重现性需要证明。
11. 草稿内容和预检主要保存在 JSONB 中，缺少顶层 `schema_version`、`revision_no`、`base_version_id` 和并发版本。
12. 草稿默认查询硬限制 100 条，缺少正式分页、总数和稳定游标。
13. UI 中“删除草稿”实际上执行归档，产品语义、恢复入口和保留策略不清晰。

### 03.3 统一业务词典

| 术语 | 定义 | 生命周期 |
| --- | --- | --- |
| `ProductFamily` | 可选的商品家族，用于表达多个本地商品计划归入同一 SPU 的业务意图 | 稳定，可调整成员，不等于 SHEIN 官方 SPU |
| `CatalogProduct` | 稳定内部商品身份；地毯业务默认代表一个设计/颜色、一个计划中的 SKC | 长期存在，不随草稿、重发或凭证变化 |
| `CatalogSku` | 稳定内部 SKU 身份；地毯业务默认代表 Product 下的一个尺寸/规格 | 长期存在，可停用，不因版本变化换主键 |
| `ProductDraft` | 当前可编辑工作副本，只存在于编辑阶段 | mutable，可 handoff、归档或从历史版本派生 |
| `ProductVersion` | 一次 handoff 时冻结的完整业务版本 | immutable，只追加新版本，不原地修改 |
| `PublishAttempt` | 对某个 ProductVersion 的一次远端发布/重发尝试 | immutable 证据 + 可推进状态机 |
| `PlatformProductLink` | 本地 Product/Sku 与 SHEIN SPU/SKC/SKU/document/version 的经验证映射 | 追加/失效可审计，不覆盖历史 |
| `OfficialProductProjection` | 从 SHEIN 回读得到的 SPU/SKC/SKU 当前事实 | 可刷新投影，不作为本地编辑源 |
| `ProductEvent` | 商品、草稿、版本、尝试和平台身份的追加式业务事件 | append-only |

### 03.4 目标领域模型

```text
Store
├── ProductFamily                         可选，本地 SPU 组织意图
│   └── CatalogProduct                    稳定本地商品，地毯默认一商品一 SKC
│       ├── CatalogSku                    稳定本地尺寸 SKU
│       ├── ProductDraft                  当前 mutable 工作副本
│       ├── ProductVersion                handoff 冻结版本
│       │   ├── ProductVersionSku         冻结 SKU 内容
│       │   ├── ProductVersionMedia       冻结素材引用/顺序/用途
│       │   └── ProductVersionSnapshot    类目、规则、模板和字段快照
│       ├── PublishAttempt                某一版本的一次发布尝试
│       │   ├── PublishReceipt            SHEIN 回执
│       │   └── ReviewTimeline            官方审核时间线
│       ├── PlatformProductLink           SPU/SKC/SKU/document/version 映射
│       └── ProductEvent                  追加式业务历史
└── OfficialProductProjection             现有 spus/skcs/skus 只读投影
```

对象所有权：

| 事实 | 唯一 owner |
| --- | --- |
| 商品长期内部身份 | `CatalogProduct` |
| SKU 长期内部身份 | `CatalogSku` |
| 当前可编辑内容 | `ProductDraft` |
| 某次正式提交内容 | `ProductVersion` |
| 远端命令、幂等和结果未知 | `PublishAttempt` / 现有 Job 管线 |
| SHEIN 官方身份 | `PlatformProductLink` + 官方投影 |
| 官方审核/上架/合规状态 | 官方 projection/reducer |
| 当前页面归类 | 基于以上事实生成的规范 read model |

### 03.5 地毯品类的 SPU/SKC/SKU 映射

首期采用以下默认业务模型：

1. 一个 `CatalogProduct` 表示一个独立设计/图案/颜色商品，默认计划对应一个 SHEIN SKC。
2. 同一商品的不同尺寸、规格和包装组合表示多个 `CatalogSku`，默认计划对应 SHEIN SKU。
3. 多个设计/颜色 SKC 需要归入同一 SPU 时，使用可选 `ProductFamily` 表示本地分组意图。
4. SHEIN 是否实际创建/关联到同一 SPU，必须以官方返回的 SPU/SKC/SKU 关系为准；本地 ProductFamily 不能伪造官方身份。
5. 对未来确实需要“一次请求包含多个 SKC”的接口能力，使用 batch/attempt item 映射多个 ProductVersion，不改变“一件 CatalogProduct 一个业务 SKC”的内部边界。
6. supplier code、supplier SKU、标题和文件夹名都是业务属性或业务键，不作为数据库主身份。
7. supplier code 在 store 作用域内执行唯一性校验；首次 handoff 后的修改必须产生新版本，并按 SHEIN 当前接口能力决定是更新、重发还是新商品。

### 03.6 草稿、修订与不可变版本

#### ProductDraft

只包含编辑所需信息：

- `catalog_product_id`
- `base_version_id`（从历史版本修正时存在）
- `revision_no`
- `lock_version`
- `schema_version`
- `editing_status`
- flexible `draft_data`
- 当前预检结果和更新时间
- 当前媒体引用

草稿状态只允许：

- `editing`
- `blocked`
- `ready`
- `handed_off`
- `archived`

草稿不得保存 pending_review、rejected、approved、listed 或“published”等官方状态。

#### ProductVersion

handoff 时生成并永久冻结：

- 内容、类目、商品类型、SPU/SKC/SKU 业务结构。
- 每个 SKU 的供应商编码、价格、库存、重量和包装。
- 媒体 asset ID、内容 hash、用途、顺序和上传映射。
- 类目 schema、销售属性、发布规范、关联规则、模板和合规规则 fingerprint。
- 预检 blockers/warnings、候选 fingerprint 和生成时间。
- 创建人、来源草稿、基准版本和版本号。

任何正式提交后的修改都创建新的 Draft/Version，不允许 UPDATE 旧 ProductVersion。

### 03.7 商品生命周期的正交状态

延续 ERP-04 的六维状态，禁止重新混合：

1. **本地编辑**：editing / blocked / ready / handed_off / archived。
2. **传输执行**：not_started / queued / claimed / submitting / accepted / known_failed / result_unknown。
3. **官方审核**：not_received / pending_review / pricing / sample / design_review / sample_review / final_review / approved / rejected / withdrawn / unknown。
4. **上架**：not_listed / listed / off_shelf / deleted / unknown。
5. **合规**：not_checked / pending / needs_action / passed / unsupported/manual / unknown。
6. **系统健康**：fresh / stale / partial / service_unavailable / permission_denied。

另有 `CatalogProduct.lifecycle_status`：active / retired / archived，仅表示本地商品主数据生命周期，不覆盖以上六维状态。

### 03.8 草稿箱的唯一职责

草稿箱只展示仍需编辑或等待 handoff 的 `ProductDraft`：

- editing：尚未完成。
- blocked：预检存在阻断。
- ready：当前规则快照下可 handoff。

以下对象不得出现在默认草稿箱：

- handed_off 草稿。
- 已创建 PublishAttempt 的版本。
- result_unknown、审核中、已驳回、已通过或已上架商品。
- archived 草稿。

草稿箱页面加载只读，不自动调用会保存草稿的 revalidation。规则可能过期时显示“规则已更新，需要重新预检”；用户显式点击或正式 handoff 前再执行服务端强制预检。

归档草稿进入独立“草稿回收站/历史草稿”，普通操作叫“归档”而不是“删除”。永久删除属于后续合规数据生命周期，不是草稿列表动作。

### 03.9 原子 handoff 与版本冻结

用户点击“提交并前往商品审核中心”时执行：

1. 服务端重新加载 tenant/store/user/draft，并校验动作能力和 `lock_version`。
2. 使用当前已批准的 SHEIN schema/rule snapshots 强制预检。
3. 若预检失败，只更新可解释的预检结果，草稿保留 blocked，不创建版本或命令。
4. 若通过，在一个数据库事务中：
   - 创建不可变 ProductVersion 和 VersionSku/Media/Snapshot；
   - 计算并保存版本 fingerprint；
   - 创建 PublishAttempt/command/batch item/outbox；
   - 将草稿标记 handed_off；
   - 更新 CatalogProduct 当前版本/当前尝试指针；
   - 写 ProductEvent 和审计。
5. 事务任一步失败全部回滚，草稿仍可编辑。
6. 事务成功后草稿立即退出默认草稿箱，发布中心显示 queued/待执行，而不是等待 Job、审核或合规完成后再隐藏。
7. 前端刷新、重新登录和切店后仍由服务端 read model 得到同一归属。

### 03.10 发布失败、结果未知、驳回与重发

#### preflight known failure

- 尚未 handoff：留在原草稿并精确标记字段。
- 已 handoff 后远端预检失败：PublishAttempt 留发布中心；用户显式选择“返回编辑”时，从冻结版本派生新 Draft revision。

#### result_unknown

- 保留在发布/审核中心。
- 禁止自动重发、禁止把原草稿重新开放为可直接发布。
- 可以查看冻结版本，但任何新 revision 在该尝试恢复为 known result 前不得再次提交同一业务键。

#### official rejected

- 当前 Attempt 进入审核中心已驳回。
- 旧 ProductVersion 和所有回执永久保留。
- 用户点击“修正并重发”后，基于被驳回版本创建新 Draft revision。
- 修正完成后创建新 ProductVersion 和新 PublishAttempt，并显式记录 `parent_attempt_id/supersedes_attempt_id/reason`。
- 如果 SHEIN 驳回语义要求“换款/新品”，用户选择“作为新商品创建”，系统 fork 新 CatalogProduct，不把两个商品历史混在一起。

#### approved/listed 后编辑

- 不修改已发布版本。
- 创建新 Draft revision；根据 SHEIN 当前已验证 API 能力，进入更新命令、重发命令或新商品流程。
- 产品页面必须清楚区分“当前线上版本”“正在编辑版本”“正在审核版本”。

### 03.11 平台身份与官方商品投影

1. `spus/skcs/skus` 继续保存 SHEIN 当前只读事实，不成为本地编辑表。
2. 新增 `PlatformProductLink`，至少记录 store、platform、object_type、platform_id、catalog_product/catalog_sku、product_version、publish_attempt、first_seen、last_verified 和状态。
3. SHEIN document_sn、version、SPU、SKC 和 SKU 均在 store 作用域建立经验证映射。
4. 同一平台身份映射冲突时 fail closed，进入人工对账，不按标题、supplier code 或“最新时间”自动合并。
5. `CatalogProduct.current_attempt_id` 或等价规范投影由事务/reducer 明确推进；审核中心不再通过“哪个 Job 更新时间更晚”猜当前尝试。
6. 旧尝试保留在 timeline；当前页签只读取 current attempt。
7. 官方回读无法关联时显示 `unmatched` 并进入诊断台，不能制造本地商品或覆盖其他商品。

### 03.12 并发、幂等与状态转换

1. ProductDraft 保存使用 `lock_version` 或 ETag；更新条件必须包含当前版本。
2. 版本冲突返回 409、当前服务器版本和安全 diff 摘要，用户选择重新加载或显式合并。
3. handoff idempotency 至少绑定 tenant/store/draft/lock_version/version fingerprint。
4. 同一 Draft revision 只能成功 handoff 一次；重复请求返回原 ProductVersion/Attempt。
5. 同一 ProductVersion 可有多个明确的 PublishAttempt，但每次都有独立 request key、原因和父尝试。
6. 所有状态转换通过领域服务和 outbox/reducer，页面、Worker 和 Webhook 不直接各自写万能状态。
7. current_version/current_attempt 指针更新与事件追加使用同一事务或可证明幂等的 reducer。

### 03.13 JSONB、Schema 与模板策略

不把动态类目全部拆成固定列。采用“核心身份关系规范化 + 动态内容版本化 JSONB”：

1. tenant、store、product、sku、draft、version、attempt、platform link、状态和唯一键使用关系字段。
2. 类目动态属性、模板展开内容和 SHEIN 特定字段继续使用有 `schema_version` 的 JSONB。
3. Draft 保存当前编辑内容；ProductVersion 保存冻结后的规范化 JSON 快照和 fingerprint。
4. 模板只保留引用来源不够，Version 必须保存实际展开结果、模板版本和 fingerprint。
5. SHEIN 规则更新不反向修改旧 Version，只影响新的显式 revalidation 和未来 Version。
6. 兼容适配器负责读取旧 JSON 结构；缺失字段标为 legacy/unknown，不静默填伪值。

### 03.14 素材所有权与历史可重现

1. Draft 媒体引用属于 ProductDraft，可随编辑增删。
2. handoff 时为 ProductVersion 建立独立不可变媒体引用，保存 asset ID、内容 hash、用途、顺序和当时的 SHEIN 上传映射。
3. 只有 ProductVersion 已取得独立引用后，才能释放 ProductDraft 引用。
4. 任何 still-referenced asset 不得因草稿 published/archived 被清理。
5. 历史版本可查看缩略图、用途和 hash；原始媒体保留期限由媒体/合规板块另行定义。
6. 重发默认复用被驳回 Version 的素材快照；用户修改后产生新 VersionMedia，不覆盖旧顺序和 hash。

### 03.15 页面与读模型归属

| 页面 | 只展示 | 不展示 |
| --- | --- | --- |
| 草稿箱 | editing/blocked/ready Draft | handed_off、attempt、官方审核状态 |
| 发布中心 | PublishAttempt 的传输和远端预检状态 | 可编辑草稿 |
| 商品审核中心 | current PublishAttempt 的官方审核/流程状态 | 被 supersede 的旧尝试 |
| 商品经营 | SHEIN 官方 SPU/SKC/SKU 投影和上架状态 | 本地未 handoff 草稿 |
| 商品详情 | CatalogProduct 总览、线上版本、编辑版本、尝试时间线、官方链接 | 拼接出的无来源万能状态 |
| 历史/审计 | 全部 Version、Attempt、Receipt、Event | 可执行写操作的隐式入口 |

每个 read model 必须返回稳定 identity、snapshot/version、事实时间、来源和可执行动作；顶部计数和列表来自同一快照。

### 03.16 数据迁移与兼容策略

1. ERP-05 只读盘点所有 draft→batch item→job→receipt→review→SPU/SKC/SKU 关系。
2. 对每个历史 draft 分类：仅编辑、已 handoff 无 Job、已有 Job、result_unknown、已审核、已上架、孤儿/冲突。
3. 新表和新列 additive 创建；旧应用在迁移后仍可读取必要字段。
4. 现有 draft 可一对一创建 CatalogProduct，但不按名称自动合并。
5. 已有可靠 SHEIN SKC/Version/Receipt 证据时建立 PlatformProductLink；证据不足标为 unmatched/legacy_unversioned。
6. 历史 Publish Job 只有在冻结候选和 fingerprint 足以证明来源时回填 ProductVersion；否则建立只读 legacy version shell，不伪造内容。
7. supplier code 只作为辅助匹配证据，不能单独决定合并。
8. 双读阶段对比旧审核中心与新 current-attempt projection，差异全部进入报告。
9. 迁移前验证素材引用；任何历史版本无法重现时停止清理。
10. ERP-20 才允许依据显式 ID 修复历史读模型，不自动重发或改官方结论。

### 03.17 商品工作台信息架构边界

本板块只确定对象和页面归属，不在本步骤重做具体视觉。商品详情未来至少需要：

1. 身份概览：内部商品 ID、店铺、ProductFamily、supplier code、官方 SPU/SKC。
2. 版本：当前线上版本、当前编辑草稿、当前审核版本和历史版本 diff。
3. SKU：稳定本地 SKU 与 SHEIN SKU 映射、有效/停用状态。
4. 发布尝试：每次原因、版本、时间、执行状态、官方 document/version 和 operationId。
5. 审核时间线：官方状态、驳回原因、核价/寄样/审版等节点。
6. 素材与合规：该版本实际使用的媒体、报告和规则快照。
7. 审计：创建、编辑、handoff、重发、fork、归档和映射冲突。

具体批量建品、编辑器布局、模板复用和操作效率归板块 04 讨论。

### 03.18 安全与审计

1. 所有 Product/CatalogSku/Draft/Version/Attempt/Link 查询包含 tenant/store。
2. 编辑、handoff、返回编辑、重发、fork、归档和平台映射修复使用独立 capability。
3. ProductVersion、Receipt 和 ProductEvent 普通业务 API 不提供 UPDATE/DELETE。
4. 审计 actor、store、product、draft revision、version、attempt、operationId、前后状态和原因。
5. 版本快照不保存 token、secret 或不必要的完整 SHEIN 敏感响应。
6. 手工修复 PlatformProductLink 必须双人/高权限确认、预览影响并保留 before/after。

### 03.19 分步实施顺序

以下编号是板块内建设项，不替代 ERP-XX：

| 编号 | 名称 | 必须完成的范围 | 主归属步骤 |
| --- | --- | --- | --- |
| PROD-01 | 商品关系事实审计 | draft/batch/job/receipt/review/SPU/SKC/SKU/素材只读关联报告 | ERP-05 |
| PROD-02 | 业务词典与状态矩阵 | Product、Draft、Version、Attempt、Link 和六维状态定稿 | ERP-04 |
| PROD-03 | 稳定商品与 SKU 身份 | additive CatalogProduct/CatalogSku/ProductFamily 模型 | ERP-06 |
| PROD-04 | 草稿修订与并发控制 | revision、schemaVersion、lockVersion/ETag 和冲突行为 | ERP-06、ERP-14 |
| PROD-05 | 纯读草稿箱 | 明确 editing read model、服务端分页、移除页面加载隐藏写入 | ERP-12、ERP-13 |
| PROD-06 | 不可变 ProductVersion | 冻结内容、SKU、schema、模板、预检和 fingerprint | ERP-06、ERP-12 |
| PROD-07 | 原子 handoff | 版本、attempt、outbox、handed_off 和事件单事务 | ERP-09、ERP-12 |
| PROD-08 | Attempt 绑定版本 | Job/BatchItem additive 关联 product/version/parent attempt | ERP-06、ERP-09 |
| PROD-09 | 平台商品身份映射 | document/version/SPU/SKC/SKU 与本地身份的证据链接 | ERP-06、ERP-10 |
| PROD-10 | 当前尝试规范投影 | 显式 current attempt、旧尝试 timeline、无时间启发式 | ERP-10、ERP-11 |
| PROD-11 | 驳回修订与新商品 fork | 返回编辑、修正重发、换款新品和 result_unknown 阻断 | ERP-09、ERP-12、ERP-13 |
| PROD-12 | 素材与规则版本所有权 | VersionMedia、规则/模板快照和安全引用释放 | ERP-06、ERP-15 |
| PROD-13 | 跨页面商品读模型 | 草稿、发布、审核、经营、详情和历史的唯一归属 | ERP-11、ERP-13 |
| PROD-14 | 存量兼容与双读 | legacy 分类、证据回填、unmatched 和差异报告 | ERP-05、ERP-20 |
| PROD-15 | 性能与分页 | 稳定游标、总数、搜索、索引和目标规模负载 | ERP-13、ERP-19 |
| PROD-16 | 事务/并发/行为 E2E | 冲突、回滚、刷新、切店、多标签页和历史重现 | ERP-03、ERP-21 |
| PROD-17 | Staging 迁移与金丝雀 | 脱敏数据演练、只读对账、受控发布和回滚 | ERP-21、ERP-22 |

PROD-01 至 PROD-10 是商品主数据和发布链的 P0 地基；未完成前不得通过 UI 补丁继续增加新的状态推断。

### 03.20 验收标准

#### 身份与版本

1. 每个本地商品和 SKU 有稳定内部 ID，重发、重授权、改标题和 SHEIN version 变化不改变内部身份。
2. 一次 handoff 对应一个可校验 fingerprint 的不可变 ProductVersion。
3. PublishAttempt 必须引用准确 ProductVersion；旧 Version 无任何普通更新路径。
4. supplier code、标题或时间相同不会导致两个商品自动合并。

#### 草稿与 handoff

5. 页面加载草稿箱不产生草稿写入或 SHEIN 请求。
6. 两个编辑者并发保存时，旧 lockVersion 收到 409，不发生静默覆盖。
7. handoff 事务失败时 Draft、Version、Attempt、Outbox 和页面归属全部回滚。
8. handoff 成功后草稿立即且持久地退出默认草稿箱，发布中心出现对应 Attempt。
9. 预检失败保留 Draft；result_unknown 不返回可重复提交草稿入口。

#### 驳回与当前尝试

10. 驳回后只有用户显式“修正并重发”才创建新 Draft revision。
11. 新 Attempt 明确关联父尝试和新 Version，旧驳回仅在 timeline，不占当前页签。
12. 需要换款时 fork 新 CatalogProduct，原商品历史不混入新商品。
13. 审核中心当前尝试由显式关系/reducer 决定，不依赖更新时间猜测。

#### 平台身份、素材与迁移

14. 每个 SHEIN SPU/SKC/SKU/document/version 映射有证据来源和 store 作用域；冲突 fail closed。
15. 任一历史 Version 能列出当时内容、SKU、素材 hash/顺序、规则/模板 fingerprint 和 Attempt。
16. Draft 引用释放不会删除仍被 Version/合规/模板引用的素材。
17. 旧数据全部分类为 mapped、legacy_unversioned、unmatched 或 conflict，不制造伪映射。
18. 草稿、发布、审核、经营和详情页在刷新、切店、登录和多标签页下归属一致。
19. 数据库约束、事务失败注入、API 契约、Playwright、视觉回归、负载和迁移演练全部通过。

### 03.21 明确不做

1. 不把整个 SHEIN 动态类目字段拆成数百个固定数据库列。
2. 不引入全量事件溯源框架；采用规范 current projection + append-only events。
3. 不用商品名称、图片相似度或 supplier code 单独自动合并历史商品。
4. 不修改已执行迁移，不直接覆盖生产历史状态。
5. 不让 ProductVersion 可编辑，不删除旧 Attempt/Receipt 以“清理页面”。
6. 不把本地 ProductFamily 当作 SHEIN 已确认 SPU。
7. 不在 result_unknown 时自动创建可发布 revision 或自动重试。
8. 不在读取草稿列表时自动保存、自动同步 SHEIN 或自动改变业务归属。
9. 不因商品模型建设同时重做全站 UI、AI、媒体、合规或库存模块。
10. 不在证据审计前释放历史素材或建立生产唯一映射。

### 03.22 开源项目借鉴边界

1. [Saleor](https://github.com/saleor/saleor)：借鉴 Product/Variant、channel assignment 和不可把可售状态混入编辑对象的边界。
2. [Medusa](https://github.com/medusajs/medusa)：借鉴模块化 Product/Variant、库存与销售上下文分离；不引入其完整平台替换现有服务。
3. [Akeneo PIM Community Edition](https://github.com/akeneo/pim-community-dev)：借鉴动态属性、family、版本化和数据质量思路；不照搬其重量级 PIM 工作流。
4. [Vendure](https://github.com/vendure-ecommerce/vendure)：借鉴 Product/ProductVariant、channel scope 和后台任务边界；不把 channel 机械等同于本项目 Store。

开源项目只提供成熟领域语言和不变量。实现仍以 SHEIN 当前 API、地毯业务和本项目已有可靠发布管线为准。

### 03.23 已确认决策

1. 建立稳定 `CatalogProduct` 和 `CatalogSku`，草稿 ID、supplier code、SHEIN SKC 都不再充当内部主身份。
2. 地毯业务默认一个 CatalogProduct 对应一个计划中的 SKC，不同尺寸对应 CatalogSku/SHEIN SKU。
3. 多个 SKC 的本地 SPU 分组意图使用可选 ProductFamily，官方 SPU 以 SHEIN 回读为准。
4. ProductDraft 只是 mutable 工作副本，ProductVersion 是 handoff 时生成的 immutable 事实。
5. 每个 PublishAttempt 必须引用准确 ProductVersion，并保留父尝试、原因和 supersede 关系。
6. handoff 成功后草稿按明确 handed_off 事实立即退出默认草稿箱，不再依赖是否已有 Job 或是否完成合规。
7. preflight 失败留草稿；handoff 后失败留发布中心；只有显式返回编辑才派生新 revision。
8. result_unknown 不自动重试、不自动重新开放发布入口。
9. 官方审核、上架和合规状态不写入 ProductDraft 万能状态。
10. 现有 SPU/SKC/SKU 表作为 SHEIN 官方只读投影，使用 PlatformProductLink 与本地身份连接。
11. supplier code/supplier SKU 是 store 作用域业务键，不是数据库主身份。
12. 草稿保存使用 lockVersion/ETag 服务端乐观并发控制。
13. 页面读取不产生草稿写入；规则重校验只在用户显式触发或 handoff 前执行。
14. ProductVersion 保留展开后的内容、SKU、素材和规则/模板 fingerprint，旧规则不反向修改旧版本。
15. 动态类目继续使用版本化 JSONB，只规范化核心身份、关系、状态和唯一键。
16. 不引入全量事件溯源；使用 current projection、ProductEvent 和 outbox/inbox。
17. 普通“删除草稿”改为归档/回收站语义，永久删除走独立数据治理流程。
18. 当前发布尝试由显式关系或规范 reducer 推进，不再以最新时间启发式判断。

### 03.24 后续仍可讨论但不阻塞方向的事项

1. 哪些设计/颜色必须归入同一 ProductFamily，以及是否允许用户在发布前调整。
2. 已上架商品修改标题、价格、图片或 SKU 时，分别走 SHEIN 更新命令还是新 ProductVersion + 新商品；需逐 endpoint 验证。
3. 归档草稿和 legacy version shell 的保留年限。
4. CatalogSku 被移除尺寸后的 retired/restore 规则。
5. 是否在后续增加商品内部评审、评论和版本审批；首期不阻塞基础模型。

---

## 板块 04：商品建档、批量建品、编辑器、类目属性与模板复用

讨论日期：2026-08-28  
方案状态：方向已确认；本轮只记录方案，不授权改代码、改库、部署或调用 SHEIN  
主要承接步骤：ERP-02、ERP-03、ERP-04、ERP-06、ERP-07、ERP-12、ERP-14、ERP-15、ERP-16、ERP-18、ERP-19、ERP-21、ERP-22、ERP-23

### 04.1 总体结论

当前项目已经具备单品建档、批量建品、文件夹导入、草稿保存、SKU 规则、图片用途、类目快照、模板和服务端预检等可复用基础，但还不是商业级商品工作台。核心问题不是某一个表单控件，而是同一件商品在多个页面拥有多套组装、模板应用和验证路径：

1. 单品编辑器、批量建品页和草稿批量操作分别组装商品数据，责任重叠。
2. 页面组件同时承担数据加载、领域计算、模板覆盖、媒体、AI、保存和预检，改动半径过大。
3. 浏览器快速验证、服务端规则重算和 SHEIN schema 快照的权威边界尚未形成一个正式契约。
4. 模板已有快照，但版本、兼容范围、字段来源、覆盖优先级和差异预览未成为全局一致规则。
5. 旧入口、V2 入口和文件夹导入路径的生产归属必须先取证，不能凭文件名判断后删除。

目标不是推倒重做编辑器，也不是为了减少文件行数机械拆组件，而是建立一个统一 `ProductWorkbench` 领域内核：单品、批量和草稿批处理只是不同视图，全部共享同一 `ProductFormModel`、字段 schema、模板应用引擎、验证引擎、保存命令和服务端预检。

商业级目标：

- 任一字段只有一个当前事实来源，不因入口不同产生不同 payload。
- 用户始终知道字段来自手工、导入、模板、AI 还是 SHEIN schema。
- 模板默认只补空，不静默覆盖；任何覆盖可预览、可定位、可撤销。
- 单个商品失败不拖垮整批，整批操作有进度、有逐项结果、有安全重试。
- 自动保存只保存本地草稿，不触发 SHEIN、发布 handoff 或审核状态迁移。
- 服务端预检是发布前最终权威；浏览器校验用于即时反馈，不能伪造“可发布”。
- 旧草稿和旧模板通过版本适配器读取，迁移过程不静默丢字段。

### 04.2 当前源码事实基线

#### 可保留能力

1. V2 已有独立路由承载 `NewProductPage`、`BatchProductCreatePage` 和 `ProductDraftsPage`。
2. 内容、SKU、图片和发布设置已有独立 contract：
   - `product-content-contract.js`
   - `product-sku-contract.js`
   - `product-image-contract.js`
   - `product-publish-settings-contract.js`
3. 草稿已经保存 `salesSchemaSnapshot` 和 `publishStandardSnapshot`，具备冻结类目/发布规范输入的基础。
4. 已存在标题规则、属性、尺寸、包装、尾图、合规和发布设置等模板能力。
5. 服务端 `product-draft-service.js` 会重新构建候选并执行预检，浏览器不是唯一发布门禁。
6. 单品、批量、文件夹分组、草稿批量模板和发布候选已有测试基础，可用于建立黄金回归。
7. V2 Query key 大体已包含 tenant/user/store 作用域，可在统一 owner 时继续硬化。

#### 已确认的结构性问题

1. `NewProductPage.tsx` 当前约 3464 行，静态扫描约有 86 次 React hook 调用，混合了加载、表单、模板、图片、AI、保存和预检职责。
2. `BatchProductCreatePage.tsx` 当前约 1090 行，静态扫描约有 47 次 hook 调用，并独立构造批量商品 payload。
3. `ProductDraftsPage.tsx` 约 702 行，另有一套草稿批量模板转换路径。
4. `ProductFolderImport.tsx` 约 602 行；批量页同时直接调用文件夹分组 contract，说明文件导入存在组件能力与页面内能力并存，生产调用关系需在 ERP-01/02 取证。
5. `product-sku-contract.js` 已达约 831 行，说明 SKU 规则复杂度是真实领域复杂度，不能继续散回页面，也不能只按行数拆散。
6. `product-draft-service.js` 约 1069 行，保存、重算、预检和兼容职责需要按命令边界梳理。
7. 单品、批量和草稿批处理对模板、快照和默认值的组装存在多个 owner，输出漂移风险已确认。
8. 部分 UI 测试只读取源码并匹配字符串，不能代替真实表单行为、网络副作用和字段保真 E2E。
9. legacy `src/App.jsx`、`src/WebApp.jsx` 与 V2 编辑入口并存；是否运行、是否构建、是否可删除尚未完成 release 证据闭环。
10. 页面加载隐藏写入问题已由板块 03 归入草稿职责；本板块只定义编辑器不得重新引入该行为。

### 04.3 责任边界与唯一 owner

目标边界：

```text
SHEIN schema / publish standard snapshot
                 │
                 ▼
        SchemaRegistry（只读、版本化）
                 │
                 ▼
ProductWorkbench Domain Kernel
├── ProductFormModel
├── ProductFormController / Commands
├── ProductValidationEngine
├── TemplateApplicationEngine
├── MediaAssignmentModel
├── Draft Hydration / Serialization Adapter
└── Preflight Client Contract
                 │
      ┌──────────┼──────────┐
      ▼          ▼          ▼
单品编辑视图   批量协调视图   草稿批处理视图
                 │
                 ▼
      Draft API / Server Preflight
                 │
                 ▼
    ProductVersion + Publish handoff
```

唯一 owner 规则：

1. `ProductFormModel` 是浏览器内商品编辑状态的唯一 owner。
2. `SchemaRegistry` 是类目字段定义、必填、枚举、单位和 schema fingerprint 的唯一 owner。
3. `TemplateApplicationEngine` 是所有模板引用、重引、覆盖、差异和来源记录的唯一 owner。
4. `ProductValidationEngine` 是浏览器即时校验的唯一 owner；不得在各组件复制规则。
5. 服务端 Preflight 是 handoff 前最终门禁 owner，并以同一 schema/version 重新计算。
6. Draft Repository/API 是草稿持久化 owner；页面不得直接拼数据库形状。
7. ProductVersion 和 PublishAttempt 仍按板块 03、后续板块 05 管理，编辑器不得写官方审核状态。

### 04.4 `ProductWorkbench` 目标组成

```text
ProductWorkbench
├── domain/
│   ├── product-form-model
│   ├── product-form-schema
│   ├── product-form-commands
│   ├── validation-engine
│   ├── template-application-engine
│   ├── field-provenance
│   └── diff-and-patch
├── adapters/
│   ├── draft-hydrator
│   ├── draft-serializer
│   ├── legacy-draft-adapter
│   ├── shein-schema-adapter
│   └── preflight-adapter
├── sections/
│   ├── content-and-title
│   ├── category-and-attributes
│   ├── sales-attributes
│   ├── sku-grid
│   ├── pricing-and-inventory
│   ├── packaging-and-weight
│   ├── media
│   ├── compliance
│   └── publish-settings
└── views/
    ├── SingleProductEditor
    ├── BatchProductCoordinator
    └── DraftBulkWorkbench
```

这是一条目标责任图，不授权现在创建这些目录。正式实现必须先以现有行为 fixture 证明边界，再按垂直切片迁移。

### 04.5 统一 `ProductFormModel`

每个编辑中的商品使用同一逻辑模型，至少包含：

| 区域 | 关键内容 | 约束 |
| --- | --- | --- |
| identity | tenantId、storeId、catalogProductId、draftId、revisionNo、baseVersionId、lockVersion | 内部 ID 稳定，业务编码不充当主键 |
| schema | schemaVersion、schemaFingerprint、categoryId、productTypeId、snapshotAt | 与 SHEIN schema 快照可追溯 |
| content | 标题、描述、关键词、语言/站点 | AI 只是来源之一 |
| classification | 类目、商品类型、普通属性 | 只接受 SchemaRegistry 定义 |
| sales attributes | 颜色、尺寸等销售属性 | 与 SKU 组合稳定对应 |
| skus | 稳定 localRowId、supplierSku、属性组合、价格、库存、图片 | 排序不改变行身份 |
| packaging | 单件/包装尺寸、重量、数量、单位、计算来源 | unknown 不写 0，不伪造体积 |
| media | assetId、role、sortOrder、SKU 关联、来源 | 不存 Base64，不靠数组位置猜用途 |
| compliance | 当前要求、文件/报告引用、警示和缺口 | 与普通属性分离 |
| publish settings | 币种、站点、库存/价格策略和当前发布规范快照 | 不承担发布状态 |
| templates | templateId、version、fingerprint、应用模式、兼容结果 | 旧版本可重现 |
| provenance | 字段/区段来源、时间、操作者 | 手工、导入、模板、AI、SHEIN 快照可区分 |
| ui state | dirty、touched、pendingUpload、errors、warnings | 不持久化为业务状态 |

约束：

1. 每个字段只能存在一个规范路径，section 不维护第二份业务值。
2. 所有更新通过明确 command/patch 进入模型，不允许组件直接相互改 state。
3. 旧草稿由 adapter 转成当前 FormModel；序列化时不得丢弃无法识别字段，应保留兼容扩展区并告警。
4. 动态字段继续使用版本化 JSONB；只有身份、关系、并发、检索和高价值约束进入结构化列。
5. UI 临时状态与持久化数据严格分离，避免 loading/selected/error 被保存成业务事实。

### 04.6 编辑器分区与交互责任

每个 section 只负责渲染、局部可访问性和派发领域命令：

1. **内容与标题**：人工标题、标题规则和 AI 建议；AI 结果必须显式接受。
2. **类目与普通属性**：类目选择、动态字段、单位和枚举；类目变化先展示影响 diff。
3. **销售属性**：颜色、尺寸及组合规则；不直接生成官方身份。
4. **SKU 表格**：SKU 行、批量填充、图片关联、校验摘要和稳定排序。
5. **价格与库存**：数值、币种、策略和 unknown；不把未同步值显示为 0。
6. **包装与重量**：来源、单位、换算、舍入和缺口；不生成伪默认值。
7. **媒体**：asset 引用、用途、排序、放大、上传状态；不承载 AI/provider 逻辑。
8. **合规**：官方要求和报告状态；可选或发布后要求不应错误阻断普通草稿保存。
9. **发布设置**：当前 SHEIN 发布规范相关输入；不执行发布、不显示官方审核状态。

页面 shell 负责导航、错误摘要、保存状态、离开保护和 section 编排，不再承担各领域计算。

### 04.7 SHEIN 类目、属性与 schema 快照

1. 类目、属性、枚举、单位、必填和依赖关系只来自当前店铺可用的 SHEIN schema/publish standard 快照。
2. 快照必须有 `schemaVersion`、`fingerprint`、`fetchedAt`、`source`、store 作用域和覆盖范围。
3. 打开草稿优先用其绑定快照解释旧值，同时对比当前 schema，显示 `compatible`、`deprecated`、`missing`、`changed`。
4. 当前 schema 变化不静默重写草稿，更不反向修改 ProductVersion。
5. 用户显式“升级到当前规则”时先生成字段级 diff，说明新增必填、枚举失效、单位变化和被保留的未知字段。
6. schema 不可用时允许打开和保存现有草稿，但不得把它标记为已通过当前预检。
7. 类目切换属于高影响命令：先预览将失效的属性、SKU 组合、模板和合规要求，再由用户确认。
8. 前端缓存按 tenant/store/schema fingerprint 隔离；旧请求晚到不得覆盖当前店铺 schema。

### 04.8 模板领域模型

统一模板至少支持：

- `title_rule`
- `attribute`
- `size`
- `packaging`
- `tail_image`
- `compliance`
- `publish_settings`

每个模板必须包含：

| 字段 | 作用 |
| --- | --- |
| templateId / version | 稳定身份和不可变版本 |
| tenantId / storeScope | 隔离和可见范围 |
| type | 模板类型 |
| status | draft、active、retired |
| compatibility | category/productType/schema 范围 |
| schemaFingerprint | 适用规则证据 |
| payload | 版本化模板内容 |
| source | 手工、官方快照、导入等 |
| createdBy/updatedBy/approvedBy | 审计 |
| createdAt/publishedAt/retiredAt | 生命周期 |

模板发布新版本不自动改变已有草稿或历史 ProductVersion。草稿记录实际应用的模板版本和展开结果，发布版本记录 fingerprint。

### 04.9 模板应用、优先级、差异和来源

统一应用模式：

1. `fill_empty`：默认模式，只填真正为空的兼容字段。
2. `overwrite_selected_fields`：用户明确选择字段后覆盖。
3. `replace_section`：替换整个区段，属于高风险动作，必须二次确认。

应用前统一输出：

- 将新增什么；
- 将覆盖什么；
- 将保留什么；
- 因 schema/类目/权限不兼容阻断什么；
- 哪些值无法解释但会安全保留。

优先级和来源规则：

1. 用户手工修改后的字段优先于已应用模板，直到用户显式重引该字段。
2. AI 建议不自动覆盖手工或模板值，必须显式接受才成为当前值。
3. 导入值保留其来源；模板默认只补空。
4. 重新引用某一模板不得清空其他区段。
5. 批量模板使用同一引擎逐商品应用，返回逐项 diff/阻断，不用另一套 map 逻辑。
6. 每个 patch 可逆；应用后至少允许本会话撤销，保存后通过 revision diff 恢复。
7. 缺少包装/重量等关键数据时保持 unknown/blocked，禁止模板凭空补 0。

### 04.10 单品建档流程

1. **进入**：校验 tenant/user/store、路由和草稿访问权限。
2. **加载**：并行读取草稿、绑定 schema、当前 schema、可用模板和素材引用；只读加载不写草稿、不调用 SHEIN 写接口。
3. **适配**：Draft Hydrator 将当前或 legacy 数据转成 ProductFormModel，生成兼容告警。
4. **编辑**：section 只派发模型命令；浏览器即时校验。
5. **安全自动保存**：防抖保存当前 mutable Draft，携带 lockVersion；不触发 handoff、SHEIN、审核或模板升级。
6. **显式保存**：立即 flush 上传和合法 patch，给出“已保存草稿”而非“已发布”。
7. **显式预检**：服务端按当前候选和快照重算，返回 blockers、warnings、fingerprint 和字段定位。
8. **修正**：错误摘要可跳转至 section、字段、SKU 或图片。
9. **提交发布**：进入板块 03 的原子 handoff，冻结 ProductVersion；编辑器不直接调用 SHEIN 发布 endpoint。
10. **离开**：存在未保存修改、冲突或上传中任务时明确提示，不能静默丢失。

### 04.11 批量建品是协调器，不是第二套编辑器

批量页面只负责批次级编排：

1. 接收文件/目录和公共默认项。
2. 将导入结果确定性分组为 N 个候选商品。
3. 为每件商品创建独立 ProductFormModel，不共享可变数组或图片引用。
4. 公共编辑被编译成统一 template patch，再由同一 TemplateApplicationEngine 逐件执行。
5. 打开某一 SKC 时复用与单品相同的 section、validation 和 commands。
6. 保存采用服务端有界并发和逐项幂等键；单项失败不回滚已成功的无关项。
7. UI 展示总数、等待、处理中、已保存、已阻断、失败和可重试数量。
8. 重试只重试确定失败且未成功的项；网络结果未知不得盲目重复创建。
9. 大批量必须服务端分页/分片，浏览器列表虚拟化，不能一次重算全部 SKU 和图片。
10. 批次完成只代表草稿保存结果，不得显示成 SHEIN 已接收或已发布。

### 04.12 文件夹导入与文件归组

1. 文件名规范、允许后缀、大小、Unicode/大小写、隐藏文件、重复文件和系统文件必须形成正式 contract。
2. 主图、详情图、SKU 图和合规文件的角色匹配必须显式且可预览。
3. 一对多、多对一、重复编号或无法识别的映射必须阻断对应项，禁止“选第一张”猜测。
4. 文件夹名称只用于导入分组提示，不作为 CatalogProduct、SKC 或 supplier code 的稳定身份。
5. 用户在真正上传/保存前看到商品分组、图片用途、SKU 映射、冲突和将创建的草稿数。
6. 上传使用 asset ticket/对象存储路径和稳定 assetId；图片字节不持久化进 Draft JSON，不经 control Base64 中转。
7. 取消、失败和重试必须能区分未上传、上传中、已上传未引用、已引用；孤儿 asset 走可审计清理。
8. `ProductFolderImport` 组件、批量页内导入和 legacy 导入的真实引用必须在 ERP-01/02 建图后收敛，不能提前删除。

### 04.13 SKU、批量填充与表格规则

1. 每个 SKU 行有稳定 `localRowId`，排序、筛选和模板应用不改变身份。
2. SKU 组合由销售属性的规范值生成；显示名称改变不破坏组合键。
3. supplier SKU 在当前 store/batch 的唯一性由服务端最终验证，浏览器只做快速提示。
4. 批量填价格、库存、重量、包装或图片使用 patch command，先预览影响行数和值，再执行并可撤销。
5. 空值、unknown 和数值 0 分离；不得把无法读取的库存或重量填为 0。
6. 一张通用 SKU 图或每 SKU 精确图片都必须通过明确模式表达；数量/映射歧义时阻断。
7. 计算字段展示输入来源、公式、单位、舍入规则和最终提交值。
8. 删除 SKU 是显式命令；如果基于历史 Version 返回编辑，应显示 retired/removed 差异而非静默丢行。
9. SKU 错误必须定位到具体行和字段，不能只有页面顶部通用红条。
10. 大表格按行/列依赖增量计算，禁止每个输入都重算整件商品全部媒体和规则。

### 04.14 媒体、AI 与合规的隔离边界

1. 媒体、AI 标题和合规是可组合能力，不是编辑器主状态机。
2. AI provider 失败时保留人工标题、模板标题和草稿保存能力；失败不得污染其他商品。
3. AI 输出为带 trace/source 的 suggestion；用户接受后才通过普通字段命令进入 FormModel。
4. 媒体以 assetId、role、sortOrder 和 SKU 关系进入模型；上传状态单独管理。
5. 图片用途修改不重新下载或复制同一资产；预览 URL 失败不删除 asset 事实。
6. 合规只阻断当前 schema/当前发布动作确认为必填的内容；未来阶段或可选要求显示 warning。
7. 合规报告、报告类型、图片和警示语分别建模，不因 UI 方便混入普通属性。
8. 任一可选能力熔断后，单品和批量编辑器仍可安全人工操作。

### 04.15 保存、自动保存、预检与 handoff 边界

| 动作 | 允许写入 | 禁止副作用 | 用户文案 |
| --- | --- | --- | --- |
| 页面加载 | 无业务写入 | SHEIN、规则升级、状态迁移 | 已载入/数据时间 |
| 自动保存 | mutable Draft + lockVersion | SHEIN、handoff、审核、模板自动重引 | 正在保存/草稿已保存 |
| 显式保存 | mutable Draft +审计 | SHEIN、发布成功文案 | 草稿已保存 |
| 显式预检 | 预检结果/快照（按正式设计） | 创建 Attempt、调用真实发布 | 可提交/有阻断/有警告 |
| 提交发布 | ProductVersion、Attempt、Outbox 原子 handoff | 浏览器直调 SHEIN、伪成功 | 已进入发布流程 |

具体规则：

1. 所有保存携带 lockVersion/ETag；409 时保留本地修改，显示服务器版本 diff，不自动覆盖。
2. 自动保存采用单商品串行队列或 latest-wins 合并，但每次仍带基版本；离开前 flush 有上限。
3. 上传中资产、未完成解析和致命 schema 冲突不得被序列化成看似完整数据。
4. 浏览器 validation 与服务端 preflight 使用同一错误码、字段路径和 schema version，但服务端为最终权威。
5. handoff 后默认草稿箱归属按板块 03 立即更新；编辑器不能等待 SHEIN 回执才决定是否退出。

### 04.16 legacy 草稿、数据保真与兼容适配

1. 先建立旧草稿字段清单、样本和字段覆盖率，禁止边写 adapter 边猜历史结构。
2. 每个 adapter 有 `fromVersion -> toVersion`、输入 fixture、输出 fixture、无法解释字段和降级策略。
3. 不认识的旧字段进入受控 extension/legacy 区，不静默丢弃，也不自动提交给 SHEIN。
4. 读取旧草稿不立即写回新格式；只有用户显式保存或受控迁移才持久化升级。
5. 升级前后生成内容、SKU、媒体、模板和 schema 差异，关键字段数量必须守恒。
6. legacy 数据缺少可靠快照时显示 `legacy_unversioned`，预检前要求绑定当前 schema，而不是伪造旧 fingerprint。
7. 迁移必须 dry-run、可恢复、可重复执行，并在 ERP-20 处理生产历史；本板块不直接改生产数据。

### 04.17 商业级页面信息架构

单品编辑页建议保持用户熟悉的商品工作流，不整体改品牌 UI：

1. 顶部：店铺、商品/草稿身份、保存状态、schema 版本、最后保存时间、预检和提交动作。
2. 左侧/顶部目录：各 section 的完成、错误和 warning 数量。
3. 主区：当前 section 表单；不把所有动态字段永久展开在一个超长页面。
4. 右侧或抽屉：错误摘要、模板 diff、字段来源和版本差异，按任务出现。
5. 底部/固定动作区：保存草稿、预检、提交，文案严格区分。

批量页建议：

1. 批次概览：总商品、文件、阻断、保存进度和公共模板。
2. 商品列表：稳定行、缩略图、SKC/supplier code、完成度和具体错误。
3. 单项编辑抽屉/详情页：复用单品 section，不创造简化版第二套规则。
4. 批量动作：先显示目标范围与 diff，不允许隐藏选择跨筛选残留。
5. 失败结果：逐项原因和安全重试，不用一条“请求失败”覆盖全部。

所有视觉变更先在 ERP-14 输出低保真、现状截图基线和受影响路由，经确认后实施；不得借架构重构再次整体换前端。

### 04.18 性能、可访问性与容量目标

1. 先测量再拆分：记录首次可交互、输入延迟、保存耗时、预检耗时、批量 15/50/100 商品的内存和请求数。
2. 规则计算按字段依赖增量执行；稳定 selector 避免一个 SKU 输入重渲染全部 section。
3. schema、模板元数据和同一 asset 预览可缓存，但 key 必须包含 tenant/store/fingerprint，且有 TTL/容量上限。
4. 图片原字节不进入 React state、Query cache 或 Draft JSON。
5. 大 SKU/商品列表采用虚拟化或服务端分页；批量保存有界并发和背压。
6. 路由级拆包和 section 懒加载以真实 bundle/交互指标决定，不做无测量的碎片化。
7. 所有输入有 label、错误关联、键盘可达和清晰 focus；表格批量操作可不用鼠标完成。
8. 错误颜色之外必须有文字/图标；保存、上传和预检状态由屏幕阅读器可感知。

首期目标值在 ERP-19 以生产容量测量后定稿；本板块先要求“不退化”和可测量。

### 04.19 权限、安全、审计与可观测性

1. 草稿读、建、改、归档、模板管理、AI 配置、预检和发布 handoff 使用独立 capability。
2. 所有服务端写入重新验证 tenant/user/store 和目标 draft/template/asset 归属。
3. 批量操作审计记录 operationId、操作者、目标集合、模板版本、patch 摘要、成功/失败数量。
4. 敏感 AI key、SHEIN token、对象存储签名不进入 Draft、浏览器日志或错误文案。
5. 前端 traceId、saveOperationId、preflightId 可与服务端日志关联，但不把原始敏感响应暴露给用户。
6. 指标至少包括：草稿保存成功率/409、预检耗时/阻断分布、模板覆盖次数、批量逐项失败、上传失败和页面错误率。
7. 可观测性不得记录完整标题、描述、图片 URL 或个人数据；使用 ID、hash 和脱敏摘要。
8. 切店时终止或隔离旧店铺浏览器请求；已进入服务端的保存命令仍绑定原 storeId，不重绑。

### 04.20 渐进式迁移原则

1. 先冻结现有行为和视觉基线，再抽领域纯函数，最后换视图 owner。
2. 不进行整页一次性重写；按“模型 + adapter + 一个 section + 单品 + 批量”的垂直切片迁移。
3. 每个切片同时覆盖单品、批量和草稿批处理输出一致性，否则不能宣布完成。
4. 新旧实现并存期间只允许一个生产入口和一个写 owner；影子计算只能只读比对。
5. 任何行为差异必须先被 fixture 解释：是修复、兼容差异还是回归，不能以“新架构如此”为理由。
6. 旧组件在 ERP-23 经零运行时引用、观察期和可恢复归档后退役，不在迁移中随手删除。
7. 模型抽取和 UI 视觉调整分开 Run，避免无法判断回归来自业务还是样式。

### 04.21 分步实施顺序

| 编号 | 名称 | 必做交付 | 对应 ERP |
| --- | --- | --- | --- |
| BUILD-01 | 生产入口与 owner 取证 | 单品/批量/草稿/导入路由、构建和运行时引用图 | ERP-01、ERP-02 |
| BUILD-02 | 黄金行为与视觉基线 | 现有字段、模板、图片、SKU、保存、预检、网络副作用 fixture/E2E | ERP-03、ERP-14 |
| BUILD-03 | 统一 ProductFormSchema | 规范字段路径、类型、unknown、schemaVersion 和错误路径 | ERP-06、ERP-14 |
| BUILD-04 | Draft Hydration/Serialization Adapter | current/legacy 双向 fixture、字段保真和未知字段策略 | ERP-06、ERP-14、ERP-20 |
| BUILD-05 | 单一 ProductFormModel 与命令 | 稳定 SKU 行、patch、dirty/touched 与唯一 owner | ERP-14 |
| BUILD-06 | TemplateApplicationEngine | 版本、兼容、fill-empty、显式覆盖、section replace | ERP-14、ERP-15 |
| BUILD-07 | Diff、来源与撤销 | 字段/区段 provenance、预览、撤销和 revision diff | ERP-14、ERP-15 |
| BUILD-08 | 客户端验证与服务端预检契约 | 同一 code/path/schemaVersion，服务端最终权威 | ERP-07、ERP-14 |
| BUILD-09 | 内容、类目和普通属性切片 | 单品先迁移，批量/草稿同引擎对比输出 | ERP-14 |
| BUILD-10 | 销售属性、SKU、价格、库存和包装切片 | 稳定组合、批量 patch、unknown、公式与定位 | ERP-14 |
| BUILD-11 | 媒体、合规和发布设置切片 | asset 引用、可选能力隔离、准确 blocker | ERP-14、ERP-15、ERP-16 |
| BUILD-12 | 单品编辑器 shell 切换 | 保存状态、错误导航、离开保护、无隐藏写入 | ERP-14 |
| BUILD-13 | 批量协调器切换 | 同一 FormModel/section/template engine、逐项结果和有界并发 | ERP-14、ERP-19 |
| BUILD-14 | 草稿批处理收敛 | 同一模板 patch、目标集合、无隐藏选择和逐项审计 | ERP-12、ERP-14、ERP-15 |
| BUILD-15 | 自动保存、冲突和恢复 | lockVersion、409 diff、flush、断网/刷新/多标签页恢复 | ERP-14、ERP-21 |
| BUILD-16 | 性能、可访问性和可观测性 | 容量测量、预算、键盘/错误关联、指标和 trace | ERP-18、ERP-19、ERP-21 |
| BUILD-17 | Staging 对等、金丝雀与旧入口退役准备 | 新旧输出 diff、受控 canary、回滚、零引用报告 | ERP-21、ERP-22、ERP-23 |

BUILD-01 至 BUILD-08 是 P0 前置地基。未完成前不得直接把批量页“复制一份单品逻辑”或通过 UI 条件继续修补模板/预检漂移。

### 04.22 验收标准

#### 模型和数据保真

1. 同一输入经单品、批量和草稿批处理生成的规范 Draft payload 一致。
2. 每个业务字段只有一个 FormModel 路径，section 内无第二份 source of truth。
3. current 和代表性 legacy 草稿打开、保存、重开后关键字段、SKU、媒体和模板引用无丢失。
4. schema 变化、类目变化和旧枚举均有明确兼容/阻断/diff，不静默修正。
5. unknown 与 0、空字符串与未填写、删除与未加载均能区分。

#### 模板和批量

6. 所有模板入口共用一个应用引擎，默认 fill-empty。
7. 显式覆盖和 replace-section 在执行前显示准确目标和差异，可撤销。
8. 手工修改不会被模板更新或页面重开静默覆盖。
9. 批量 15/50/100 商品逐项隔离；单项失败不污染其他商品或清空已成功结果。
10. 可见/选中/目标集合一致，筛选、翻页和切店后不存在隐藏选择。

#### 保存、预检和发布边界

11. 页面加载不写 Draft、不调用 SHEIN 写接口、不触发规则升级。
12. 自动保存只写 mutable Draft，并发旧版本返回 409，不静默覆盖。
13. 客户端和服务端错误码/路径一致；服务端 preflight 可否决浏览器结果。
14. 预检失败保留草稿；handoff 成功后草稿按板块 03 规则退出，不等待 SHEIN 审核。
15. 页面不把保存、预检通过、进入队列称为 SHEIN 发布成功。

#### 媒体、AI、合规和运行质量

16. AI、图片预览或可选合规服务失败时，人工编辑和安全保存仍可用。
17. 图片 asset、用途、排序和 SKU 映射在单品/批量/发布候选一致，无 Base64 入 Draft。
18. 关键表单全键盘可用，错误与字段关联，焦点和状态通知符合可访问性要求。
19. 性能测试、网络副作用断言、权限负向测试、视觉回归和 Playwright 全链路通过。
20. staging 新旧 payload diff 为已解释的零差异或批准差异，production canary 可回滚。

### 04.23 明确不做

1. 不在本板块重做全站导航、品牌、登录、审核中心或经营分析 UI。
2. 不因组件过大就一次性重写 NewProductPage 或 BatchProductCreatePage。
3. 不引入大型表单/工作流平台替换整个项目，除非 BUILD-03～08 证明现有基础无法满足。
4. 不把 SHEIN 动态 schema 全拆成固定数据库列。
5. 不让浏览器校验成为正式发布唯一门禁。
6. 不在自动保存、切店、页面加载或模板更新时调用 SHEIN。
7. 不让 AI 自动写标题并跳过用户确认。
8. 不为填满字段伪造包装、重量、库存或类目默认值。
9. 不在未建立运行时引用图前删除 ProductFolderImport、legacy 编辑器或旧 contract。
10. 不把批量保存成功称为批量发布成功。

### 04.24 开源项目与成熟模式借鉴边界

1. [Saleor Dashboard](https://github.com/saleor/saleor-dashboard)：借鉴商品/变体编辑、批量操作、权限化动作和清晰错误反馈，不照搬其 GraphQL/domain。
2. [Medusa](https://github.com/medusajs/medusa)：借鉴管理端与商品模块边界、变体和销售上下文分离，不替换现有 SHEIN adapter。
3. [Akeneo PIM Community Edition](https://github.com/akeneo/pim-community-dev)：借鉴动态属性、family、数据质量和批量编辑任务，不引入其完整 PIM 平台。
4. [React Hook Form](https://github.com/react-hook-form/react-hook-form)：借鉴字段订阅、低重渲染和表单状态边界；是否引入依赖由 BUILD-03 性能/兼容原型决定。
5. [Formily](https://github.com/alibaba/formily)：借鉴 schema 驱动动态表单、effects 和字段联动；不直接把 SHEIN 规则变成不可审计的前端 DSL。
6. [JSON Forms](https://github.com/eclipsesource/jsonforms)：借鉴 data schema 与 UI schema 分离；不机械采用其渲染器覆盖现有商业交互。
7. [TanStack Query](https://github.com/TanStack/query)：继续借鉴服务端状态缓存、取消和失效边界；不得把可编辑 FormModel 存成多个 Query cache truth。

开源项目提供交互模式、性能手段和领域边界，不替代 SHEIN 官方 schema、当前地毯业务、权限模型和服务端 preflight。

### 04.25 已确认决策

1. 建立一个 `ProductWorkbench` 领域内核，单品、批量和草稿批处理共享同一模型与命令。
2. `ProductFormModel` 是浏览器编辑状态唯一 owner，section 不保留第二份业务值。
3. 单品和批量可以有不同布局，但不能有不同商品组装、模板或验证语义。
4. 批量页面是协调器，不是第二套商品编辑器。
5. 服务端 preflight 是 handoff 前最终权威；浏览器校验只提供即时反馈。
6. 自动保存只保存 mutable Draft，不调用 SHEIN、不 handoff、不改变审核/发布状态。
7. 模板必须版本化、带作用域和 schema 兼容信息；更新不反向改变已有草稿和 ProductVersion。
8. 模板默认 `fill_empty`；覆盖选中字段和替换区段必须显式、先 diff、可撤销。
9. 手工修改优先于已应用模板，直到用户显式重引。
10. 所有模板入口共用 `TemplateApplicationEngine`，批量按商品逐项返回结果。
11. 文件夹导入遇到歧义必须阻断，文件夹名不作为商品稳定身份。
12. SKU 行使用稳定本地 ID；批量修改是可预览、可撤销的 patch，unknown 不写 0。
13. AI、媒体和合规能力与编辑器主状态隔离，单项/可选服务失败不阻断人工安全编辑。
14. current/legacy 草稿通过版本 adapter 读取，未知字段保留并告警，不静默丢弃。
15. 采用黄金回归和垂直切片渐进迁移，不做整页一次性重写。
16. 领域重构与视觉改版分开执行；任何 UI 大改仍需低保真和视觉基线批准。
17. 生产始终只有一个写 owner 和一个批准的 V2 编辑入口；旧入口只在 ERP-23 零引用后退役。
18. 动态类目字段继续使用版本化 JSONB，核心身份、关系、并发和检索字段结构化。

### 04.26 后续仍可讨论但不阻塞方向的事项

1. `ProductFormModel` 最终采用现有 state/reducer、React Hook Form 或其他实现；先用性能与兼容原型决定。
2. 自动保存具体防抖时长、离开页面 flush 上限和离线草稿策略。
3. 批量 50/100/500 商品的产品上限、分片大小和并发值，需按真实服务器和 SHEIN 限流测量。
4. 模板是否需要独立审批/发布角色，以及跨店共享模板的复制或只读引用策略。
5. 类目 schema 升级是按草稿逐件确认还是允许管理员批量预览后执行。
6. SKU 表格在移动端是否只读；首期商业工作台优先桌面端完整能力。
7. 内部评论、复核、字段级审批是否放入编辑器；首期不阻塞建品主链。

---

## 板块 05：发布命令、批次、队列、Worker 与 SHEIN 回执闭环

讨论日期：2026-08-29  
方案状态：方向已确认；本轮只记录方案，不授权改发布代码、数据库、Redis、Worker、云端开关或真实 SHEIN 数据  
主要承接步骤：ERP-03、ERP-04、ERP-06、ERP-07、ERP-08、ERP-09、ERP-10、ERP-11、ERP-12、ERP-13、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23

### 05.1 总体结论

当前发布链已经具备商业系统需要的一部分重要地基：BullMQ、独立发布 Worker、一次性执行授权、候选指纹、数据库领取租约、`result_unknown`、追加式回执、SHEIN trace 和无未知结果自动重发。这些能力应保留并收敛，而不是推倒重写。

真正的结构问题集中在以下断点：

1. 发布 Job 仍引用 mutable Draft，而不是板块 03 定义的 immutable ProductVersion。
2. 数据库执行状态提交和 BullMQ 入队不是一个可靠交付闭环；进程在二者之间崩溃可能留下“已授权但未入队”的孤立命令。
3. 当前一个 BullMQ 批次任务在 Worker 内循环领取并执行整批数据库 Job，批次越大，公平性、逐项恢复和故障隔离越困难。
4. `publish_execution_runs`、`publish_jobs` 的关系型状态与 `publish_batches.preflight.executionProtocol` 中的可变状态并存，形成双重当前事实。
5. “直接发布”在一个 HTTP 请求内依次执行确认、计划、授权、执行和最长 8 秒快速轮询，异常时难以解释停在哪一步，也会占用 Control 请求资源。
6. 批次 `completed` 当前可同时表达发送执行结束、审核通过、SPU 回读和合规复验完成，执行状态与官方业务生命周期耦合。
7. 当前直接发布遇到任一本地阻断项时会把整批 item 统一投影为失败，无法自然支持“明确发布可发布项、阻断项留草稿”。
8. 发布 Executor 在接收商品回执后同步处理合规实拍图，附属动作与主商品接收路径耦合。

目标架构不是“保证外部接口绝对只执行一次”——在网络和外部平台条件下无法诚实承诺这一点；目标是：本地命令不丢、每次外部发送都有证据、已开始发送后绝不盲重试、未知结果只通过官方回执/只读查询恢复、页面绝不把本地成功冒充 SHEIN 成功。

商业级结果：

- 用户点击一次，只形成一个可审计用户意图和一组逐商品 PublishCommand。
- ProductVersion、Attempt、Command、Receipt、官方审核状态各司其职。
- Command 与 Outbox 在一个数据库事务中持久化，队列只是投递层，不是业务真相。
- 每个商品一条队列消息；单项失败、超时、重启不拖垮整批。
- Worker 是唯一真实 SHEIN 商品发布写 owner。
- 外部请求前持久化 `send_started`；其后任何崩溃都进入 `result_unknown`，禁止自动重发。
- 提交接口快速返回 durable handoff，页面通过当前操作专属 SSE 获得通常 2～3 秒内的反馈；不增加全站自动同步。

### 05.2 当前源码事实基线

#### 可保留能力

1. `publish-execution-protocol.js` 已定义一次性授权、领取、已提交、结果未知、可重试失败、终态失败和回读恢复。
2. `publish-execution-repository.js` 已使用 PostgreSQL 事务、`FOR UPDATE SKIP LOCKED`、claimId、claim expiry 和 tenant/store 作用域。
3. `product-publish-worker.js` 与 Control 分进程，Worker 并发受限为 1～2，并在执行前复核源候选和远程候选 fingerprint。
4. `product-publish-executor.js` 只在 execution flag、有效领取、店铺凭证和候选 fingerprint 同时满足时调用 `/open-api/goods/product/publishOrEdit`。
5. Executor 只有在回执含完整 version、SPU、SKC、SKU 证据时返回 `accepted`；成功码但身份不完整时进入 unknown。
6. 网络/无明确响应被保守投影为 unknown，当前未知结果不自动重发。
7. `publish_receipts` 已按 job/type/dedupe key 追加保存 submitted、received、audited、document_state、readback、compliance 等证据。
8. Webhook、商品文档查询、SPU 关系回读和合规复验已有分阶段回读基础。
9. 发布队列使用确定性 jobId，商品发布入队显式设置 `attempts: 1`。
10. V2 已能区分 queued、accepted、result_unknown、failed，并保留 code、message、traceId 的部分契约。

#### 已确认的结构性问题

1. `publish-batch-service.js` 约 2039 行，兼具批次、预检、确认、授权、执行、快速反馈和回读编排。
2. `publish-execution-repository.js` 约 1970 行，混合命令领取、回执、审核/SPU/合规推进、草稿状态、素材释放和批次完成。
3. `PublishBatchesPage.tsx` 约 1603 行，同时承担草稿、外部驳回、选择、发布、快回执、审核、核价、归档和错误反馈。
4. `publish_jobs.product_draft_id` 直接指向 mutable Draft；ProductVersion 尚未成为执行输入。
5. 执行协议当前同时投影在规范表和 `publish_batches.preflight` JSON，current state owner 不唯一。
6. 消费一次性授权后再调用 `executionQueue.add`；捕获到的入队失败可记录，但进程在提交与入队之间崩溃仍需要可靠补偿机制。
7. 队列消息是整个 `executionRunId`，Worker 收到后 `while` 循环领取所有可执行 Job；不是逐商品消息。
8. claim 过期统一转 `result_unknown`，尚未区分“外部请求前崩溃”和“请求已经发出后崩溃”。
9. 快速反馈在原 HTTP 请求内最多等待 8 秒，每 150ms 查询一次发布状态；并发批量时会增加 Control/DB 压力。
10. 通用 BullMQ Queue 默认 `attempts: 5`，商品发布调用虽覆盖为 1，但写队列的重试政策仍需从通用默认中完全隔离并由测试锁定。
11. 批次 pause/resume/retry 与逐项执行状态的关系复杂，需验证不会把已接收、unknown 或已失败项整体重置。
12. accepted 后同步提交合规照片，使附属失败写入主回执；主商品接收、合规照片和后续合规复验边界不够清晰。
13. accepted 时更新本地额度临时投影，是否在重复回执、部分成功和恢复路径下严格只增一次需要专门故障测试。
14. 当前源码具备真实发布开关，但本轮没有读取生产配置，不能据代码推断线上 Worker/开关/制品状态。

### 05.3 统一业务词典与禁止含糊词

| 名称 | 定义 | 不能被称为什么 |
| --- | --- | --- |
| 发布批次 `PublishBatch` | 用户一次选择并确认的商品集合与聚合读模型 | 不是一次 SHEIN 请求 |
| 发布尝试 `PublishAttempt` | 一个 ProductVersion 的一次明确用户发布意图 | 不是草稿，不是官方审核 |
| 发布命令 `PublishCommand` | Attempt 下唯一允许产生一次外部商品写入的命令 | 不是队列消息本身 |
| OutboxEvent | 与 Command 同事务保存的待投递事件 | 不是已入队证明 |
| Queue Job | 对 Command 的可重复投递提示 | 不是业务真相，不是发布成功 |
| 领取 `leased` | Worker 暂时取得命令执行权 | 不是已发送 |
| 开始发送 `send_started` | 已进入可能触达 SHEIN 的不可逆边界 | 不是 SHEIN 已接收 |
| SHEIN 接收 `accepted` | 官方同步响应提供完整平台身份和成功证据 | 不是审核通过或上架 |
| 已知失败 `known_failed` | 官方明确拒绝或已证明未接收 | 不是结果未知 |
| 结果未知 `result_unknown` | 可能已发送但无足够证据判断结果 | 不是失败，也不可直接重试 |
| 回读确认 | Webhook/只读查询确认接收、未接收或审核状态 | 不等于本地推断 |
| 官方审核/上架 | SHEIN 后续业务生命周期 | 不属于 PublishCommand 执行状态 |

页面禁用“已发布”作为万能文案。只允许显示证据对应的：

- 已保存草稿；
- 已进入发布流程；
- 等待 Worker；
- 正在发送；
- SHEIN 已接收；
- SHEIN 明确未接收/拒绝；
- 结果待确认；
- 官方待审核/驳回/核价/寄样/通过/上架。

### 05.4 目标发布拓扑

```text
Browser
  │ POST publish intent（idempotencyKey + selected ProductVersion）
  ▼
Control / PublishCommandService
  │ transaction
  ├── PublishBatch
  ├── PublishAttempt × N
  ├── PublishCommand × N
  ├── PublishCommandEvent(created) × N
  ├── OutboxEvent(command.requested) × N
  └── Draft handed_off / current pointers
  │ commit
  ▼
Outbox Dispatcher
  │ deterministic queue jobId = commandId
  ▼
BullMQ（每个 Command 一条消息）
  ▼
Product Publish Worker
  ├── lease/CAS
  ├── load immutable ProductVersion
  ├── verify fingerprint/store/credential/capability
  ├── persist send_started
  ├── SHEIN Adapter write
  └── receipt + command event transaction
            │
            ├── accepted ──> official readback workflow
            ├── known_failed ──> explicit user correction/new attempt
            └── result_unknown ──> reconciliation workflow（read-only）

Publish event stream（DB truth；Redis 只作唤醒优化）
  └── SSE / manual refresh ──> Browser
```

### 05.5 目标领域模型

#### PublishBatch

批次只负责用户意图分组和聚合，不直接拥有每个商品的真相：

- id、tenantId、storeId；
- idempotencyKey、selectionFingerprint；
- createdBy、confirmedBy、createdAt；
- total/eligible/blocked/handedOff/accepted/knownFailed/unknown counts；
- aggregateState（由 Attempt 计算）；
- source：drafts、relaunch、mixed；
- policySnapshot：发布可发布项/全部阻断等明确策略。

#### PublishAttempt

每个 Attempt 必须关联：

- catalogProductId；
- productVersionId；
- batchId；
- parentAttemptId / supersedesAttemptId；
- reason：initial、corrected_republish、explicit_retry_after_known_failure；
- requestedBy / confirmedBy；
- current commandId；
- executionState、reconciliationState；
- 不承载官方审核万能状态。

#### PublishCommand

- commandId、attemptId、tenantId、storeId；
- productVersionId 和 frozen candidate fingerprint；
- idempotencyKey / requestKey；
- executionState；
- lease owner/expiry/heartbeat；
- sendStartedAt；
- acceptedAt / failedAt / unknownAt；
- lastError code/message/traceId；
- releaseId、adapterContractVersion；
- 不保存秘密或完整图片字节。

#### PublishCommandEvent / PublishReceipt

CommandEvent 记录本地状态转换；Receipt 记录平台/回读证据。两者 append-only，不能为了修 UI 覆盖历史。

#### OutboxEvent

- eventId、aggregateType、aggregateId、eventType；
- payload 只含 commandId/tenantId/storeId，不含完整商品 payload；
- createdAt、availableAt、dispatchAttempts、dispatchedAt、lastError；
- 确定性 dedupe key。

### 05.6 三个正交状态机

#### 05.6.1 命令执行状态 `execution_state`

```text
created
  -> dispatch_pending
  -> queued
  -> leased
  -> send_started
      -> accepted
      -> known_failed
      -> result_unknown

created/dispatch_pending/queued/leased(before send)
  -> canceled_before_send
```

规则：

1. `send_started` 之前的基础设施失败可以安全重新投递同一 Command。
2. `send_started` 之后无明确结果只能进入 `result_unknown`。
3. `accepted`、`known_failed`、`result_unknown`、`canceled_before_send` 不允许回退到 queued。
4. 已知失败后的再次发布创建新 Attempt/Command，不复活旧 Command。

#### 05.6.2 结果核对状态 `reconciliation_state`

```text
not_required
pending
platform_received
platform_not_found_provisional
platform_not_received_confirmed
manual_review
resolved
```

- accepted 与 result_unknown 均可进入 pending；
- 单次空查询只允许 provisional，不能证明未接收；
- 只有满足官方证据规则后才能 confirmed；
- reconciliation 只调用官方只读接口或消费 Webhook，绝不调用发布写接口。

#### 05.6.3 官方业务状态

待审核、核价、寄样、审版、核样、终审、驳回、通过、上架等属于板块 06，不写回 Command execution state。命令 accepted 后即结束“是否发送成功”的判断，后续审核可持续数小时或数天。

### 05.7 原子 handoff 与事务 Outbox

用户确认发布时，在一个 PostgreSQL 事务中完成：

1. 重新校验 tenant/user/store 和 `product.publish.execute` capability。
2. 锁定目标 Draft/ProductVersion 和期望 lockVersion。
3. 验证服务端 preflight、schema、template/media fingerprint 未过期。
4. 创建或幂等读取 PublishBatch。
5. 为每个明确 eligible 的 ProductVersion 创建 PublishAttempt 与 PublishCommand。
6. 写 `PublishCommandCreated` 事件。
7. 写 `PublishCommandRequested` OutboxEvent。
8. 将相应 Draft 持久化为 handed_off 并推进 current pointer。
9. 写审计记录和 operationId。

任一步失败全部回滚：草稿仍在草稿箱，不出现 Attempt，不出现队列任务，不显示“已进入发布流程”。

Outbox Dispatcher 独立运行：

- 使用 `FOR UPDATE SKIP LOCKED` 小批领取；
- 用 `commandId` 作为 BullMQ jobId；
- Queue add 成功后标记 dispatched；
- 在“已入队但未标记”时崩溃可重复 add，确定性 jobId 去重；
- Redis 丢失或队列被清空时，未完成 Command 可从 Outbox/DB 重建投递；
- Outbox 积压影响发送速度，但不丢用户意图。

当前规模先使用 PostgreSQL Outbox Dispatcher，不部署 Debezium/Kafka。

### 05.8 幂等、不重复与指纹

幂等分四层：

1. **用户请求幂等**：tenant/store/userIntentKey 唯一，重复点击返回同一 Batch。
2. **商品意图幂等**：同一 batch + productVersion 只能有一个 Attempt。
3. **命令幂等**：tenant/store/commandId/requestKey 唯一，Queue jobId = commandId。
4. **回执幂等**：commandId + receiptType + sourceEventId/contentFingerprint 唯一。

`selectionFingerprint` 至少包含有序 ProductVersionId、candidate fingerprint、storeId、schema/template fingerprint。重复 idempotencyKey 但指纹不同必须 409，不得复用旧批次。

本地幂等不能假装 SHEIN 支持外部幂等键。若官方 endpoint 没有可验证的幂等能力，系统唯一安全策略仍是：`send_started` 后未知不自动重发。

### 05.9 队列模型：一条命令一条消息

1. 每个 PublishCommand 对应一条轻量 BullMQ Job，payload 只包含 commandId、tenantId、storeId 和 contractVersion。
2. Worker 不再收到 executionRun 后循环抽干整个批次。
3. Batch 只是 UI/统计聚合；一个 100 商品批次不会长期占有一个 Worker 调用。
4. Queue delivery 可以重复，Command CAS/lease 保证同一时刻一个执行者。
5. 商品发布队列显式 `attempts: 1`，不得继承通用 Queue 的 attempts=5。
6. 安全基础设施重投由 Outbox/Command 状态控制，不使用 BullMQ 对外部写的自动 retry。
7. Dead letter 保存 queue/dispatch 故障诊断，但不能把 result_unknown 放入可自动重发队列。
8. Queue completed/failed 只反映投递处理函数，不直接更新业务“发布成功”。

### 05.10 Worker 领取、发送边界与崩溃恢复

单命令 Worker 顺序：

1. 读取 Command，验证 tenant/store/state/release/contract。
2. CAS 从 queued/dispatch_pending 领取为 leased，生成 leaseId，设置短租约和 heartbeat。
3. 加载 immutable ProductVersion 与 frozen remote candidate；重新计算 fingerprint。
4. 获取当前店铺凭证、连接状态和执行 capability；不从 Queue payload 取秘密。
5. 通过共享店铺限流器取得发送许可。
6. 在外部请求前事务写入 `send_started` 事件和时间。
7. 调用唯一 SHEIN Adapter。
8. 在一个事务中追加 normalized receipt、CommandEvent 并推进 accepted/known_failed/result_unknown。
9. 发出只读回读/附属任务的 OutboxEvent。
10. 释放 lease，更新指标。

恢复规则：

- leased 过期但无 `send_started`：同一 Command 可安全重新排队。
- `send_started` 后 Worker 崩溃、超时或无法落库：转 `result_unknown`，只允许核对。
- accepted response 已写 Receipt、业务状态更新失败：由投影修复器从 Receipt 重放，不重新调用 SHEIN。
- graceful shutdown：先停止领取，等待当前命令到安全检查点；已过 send_started 的未完成项转 unknown。
- Worker heartbeat 带 releaseId、queue、currentCommandId 和最后成功时间；Control readiness 不代替 Worker readiness。

### 05.11 SHEIN Adapter 与结果分类

Adapter 是唯一 transport/签名/结果分类 owner：

#### accepted

只有当前 endpoint 契约明确成功，且同步响应包含本地可验证的 version、SPU、预期数量的 SKC/SKU 标识，才记录 accepted。数量、关联或关键身份不完整即 unknown。

#### known_failed

官方明确业务拒绝且契约证明请求未被接受，例如字段校验、SKU 重复、额度/保证金/权限等明确错误。完整保留：

- platform code；
- message；
- traceId；
- 逐 SKC/SKU details；
- HTTP status；
- adapter contract version；
- occurredAt。

是否允许再次提交由错误分类表决定，但再次提交仍需显式用户动作、新 Attempt 和重新预检。

#### result_unknown

包括：

- 请求可能已发出后的超时/连接断开；
- 无法解析或缺少完整身份的成功响应；
- 无契约保证“未执行”的 5xx/网关异常；
- Worker 在 `send_started` 后崩溃；
- 接收到互相矛盾的回执。

未经官方 endpoint 语义证明，不能因为“有 HTTP 错误响应”就一律归 known_failed。

### 05.12 回执账本与证据等级

Receipt 类型建议规范为：

| 类型 | 来源 | 证明内容 |
| --- | --- | --- |
| transport_response | 发布接口同步响应 | 接收标识或明确拒绝 |
| receive_notice | SHEIN Webhook | 商品文档接收结果 |
| audit_notice | SHEIN Webhook | 审核业务结果 |
| document_state | 官方只读查询 | 文档状态补偿 |
| product_relationship | SPU/SKC/SKU 只读回读 | 平台身份关系 |
| compliance_submission | 独立合规写命令 | 附属资料提交结果 |
| compliance_readback | 官方合规只读回读 | 合规完成/缺口 |

每条 Receipt：

- append-only；
- tenant/store/command/attempt 作用域完整；
- sourceEventId/dedupeKey 唯一；
- normalized summary 与原始证据 hash 分离；
- 原始 payload 若需保留，进入受限加密存储并按保留策略清理；
- 不在浏览器返回完整原始报文、图片 URL、签名或密钥；
- 允许从 Receipt 重建 current projection，不允许从 UI 状态反写 Receipt。

证据优先级：当前官方只读回读/有效 Webhook > 完整同步接收回执 > 本地执行事件 > Queue/HTTP 状态 > 页面状态。

### 05.13 `result_unknown` 核对闭环

1. 进入 unknown 后立即写 `ReconciliationRequested` OutboxEvent，不写 PublishCommandRequested。
2. 优先等待已认证 Webhook；其次执行有界、只读 document-state 查询。
3. 当前活动命令可以在用户页面停留时短期核对；离开页面不影响服务端 Case，但不启用全站高频轮询。
4. 手动刷新只创建/复用同一 Reconciliation Job，不创建新 PublishAttempt。
5. 单次 not_found/空结果只记录 provisional，不释放重发入口。
6. 达到 endpoint 定义的时间窗、次数和证据组合后，才能标记 `platform_not_received_confirmed`。
7. 确认未接收后，用户可显式创建新 Attempt；原 unknown Attempt 保留完整时间线。
8. 超过业务阈值仍无法判断，进入 manual_review，运营台展示 commandId、version、supplier code、traceId 和检查步骤。
9. 核对恢复为 accepted 时，只推进投影和后续回读，不再次扣减本地额度或释放第二次素材。

### 05.14 重试、重发、暂停与取消

#### 可以自动进行

- Outbox Dispatcher 入队失败重试；
- Queue 消息丢失后的同 commandId 重投；
- Worker 在 `send_started` 前崩溃后的同 Command 重新领取；
- 官方只读核对任务按限流政策重试。

#### 禁止自动进行

- 任何 `send_started` 后的 PublishCommand 重发；
- result_unknown 自动重新发布；
- accepted 因后续审核/合规失败重新发布；
- 批次级 retry 把成功/unknown 项一起重置。

#### 用户动作

- known_failed：修正草稿或确认错误已消除，重新预检，创建 child Attempt。
- result_unknown：只能“核对结果”，在 confirmed not received 前无“重新发布”。
- pause：只阻止未领取命令继续发送。
- cancel：只对 `send_started` 前 Command 生效，逐项返回成功/太迟/不可取消。
- accepted：不能取消发布命令；平台撤回是另一个经官方契约验证的独立命令。

### 05.15 批次、阻断项与部分成功

发布前：

1. 服务端返回 eligible、blocked、stale、conflict 四类。
2. 默认不静默丢弃 blocked；页面明确显示“可发布 12，阻断 3”。
3. 用户可修正全部后再提交，或明确选择“仅发布当前可发布 12 个”。
4. 被阻断商品留在草稿箱，未创建 Attempt/Command。
5. 对明确选中的 eligible 集合，handoff 事务必须全成或全回滚。

发布后：

1. 每个 Attempt 独立 accepted/known_failed/result_unknown。
2. Batch aggregate 只计算数量，不覆盖 item 状态。
3. UI 显示“已接收 8、失败 2、待确认 2”，不把部分成功压成一条通用失败。
4. 重试只以明确失败 item 生成新 Attempt，旧 accepted/unknown 不进入目标集合。
5. 大批次服务端分页；选择绑定 batch snapshot，禁止隐藏选择和跨店残留。

### 05.16 2～3 秒快速反馈：202 + 当前操作 SSE

推荐交互：

1. `POST /publish-intents` 在 handoff/outbox 事务提交后立即返回 `202 Accepted`，包含 operationId、batchId、attemptIds、commandIds 和当前 durable state。
2. 页面立即把 handed-off 商品从草稿默认列表移出，进入发布中心“等待发送”；此时不能显示 SHEIN 已接收。
3. 页面仅针对该 operation 打开 SSE：`GET /publish-operations/{operationId}/events`。
4. Worker/Receipt 事件提交后，SSE 推送 queued、leased、send_started、accepted、known_failed、result_unknown 和批次计数。
5. 正常情况下可在 2～3 秒看到 SHEIN 接收结果；该时间是体验目标，不是成功判定条件。
6. SSE 有短时上限、心跳和 `Last-Event-ID` 续传；终态、用户离开或超时后停止。
7. SSE 断开不改变命令状态；页面保留旧数据和“手动刷新”。
8. Redis Pub/Sub 只作低延迟唤醒，事件真相仍在 PostgreSQL；Redis 丢失后可从 eventId 续读。
9. 不再在创建发布的 HTTP 请求内每 150ms 轮询数据库最长 8 秒。
10. 不增加每 30 秒或切店自动同步。

### 05.17 发布中心信息架构

#### 顶部批次摘要

- 批次名称、店铺、创建人、创建时间；
- 总数、等待发送、正在发送、SHEIN 已接收、明确失败、结果待确认；
- 当前数据截止时间和 operationId；
- 手动刷新/核对，不提供“全部重新发布”万能按钮。

#### 每行

- CatalogProduct/ProductVersion、supplier code、缩略图；
- execution state 与发生时间；
- SHEIN version/SPU/SKC（有证据才显示）；
- code/message/traceId；
- 当前允许动作和禁止原因；
- Attempt timeline。

#### 文案与动态移行

- durable handoff 后退出草稿箱；
- accepted 后从“等待发送”进入“SHEIN 已接收/待审核”；
- known_failed 进入“发布失败”，若需编辑提供“返回编辑”；
- unknown 进入“结果待确认”，仅显示“核对结果”；
- UI 不用假 optimistic success 移行；每次移行由服务端事件版本驱动。

### 05.18 限流、公平性与背压

1. 同一店铺默认最多 1 个外部商品发布请求在飞；最终值以 SHEIN 限流和压测为准。
2. 全局 Worker 并发继续适配 2 核 4GB，首期不超过 2；图片字节不经 Worker 常驻内存堆积。
3. Dispatcher/Worker 在多个店铺间公平轮转，禁止一个大批次长期抽干 Worker。
4. tenant/store 级 token bucket/nextAvailableAt 由共享存储协调，不能只靠单进程 sleep。
5. 429、官方限流与本地队列拥塞分开记录；限流不使店铺失效。
6. 队列深度、最老等待时间、Outbox lag、每店在飞数达到阈值时拒绝新大批或进入明确排队。
7. 优先级只允许运营紧急级别和系统恢复使用，普通用户不能无限插队。
8. 批次上限、单店 QPS 和全局并发通过 ERP-19 实测定稿，不在页面硬编码散落。

### 05.19 故障与恢复矩阵

| 故障点 | 规范状态 | 是否可自动重投发布 | 恢复动作 |
| --- | --- | --- | --- |
| handoff 事务失败 | 无 Batch/Attempt/Command | 不适用 | 草稿保留，用户可重新提交 |
| Outbox 未派发 | dispatch_pending | 是，同 Command | Dispatcher 重试 |
| Redis/Queue 不可用 | dispatch_pending/queued 未确认 | 是，同 Command | Outbox 重建投递 |
| Worker 领取前崩溃 | queued | 是，同 Command | Queue/Dispatcher 恢复 |
| leased、未 send_started 崩溃 | lease expired | 是，同 Command | CAS 重新领取 |
| send_started 后崩溃 | result_unknown | 否 | Webhook/只读核对 |
| SHEIN 明确拒绝 | known_failed | 否 | 用户修正/新 Attempt |
| SHEIN 接收、DB 落库失败 | result_unknown/receipt recovery | 否 | 根据原始响应/回读补写 Receipt |
| Receipt 已写、投影失败 | accepted + stale projection | 否 | 投影重放，不调 SHEIN |
| SSE 断开 | 命令状态不变 | 否 | Last-Event-ID/手动刷新 |
| Worker 新旧版本漂移 | readiness blocked | 否 | 停止领取，部署一致 release |

### 05.20 权限、安全与审计

1. 创建草稿、预检、确认发布、执行发布、核对结果、返回编辑和撤回平台商品使用独立 capability。
2. `product.publish.execute` 在 handoff 和 Worker 执行前均验证；Worker 使用系统身份但重新校验 tenant/store/command 授权快照。
3. 用户确认页面显示目标店铺、商品数、ProductVersion 和风险；不能只靠前端 confirmation 字符串。
4. Queue payload、Outbox 和日志不含 secretKey、完整 request body、图片 URL 或用户 session。
5. Worker 运行数据库账户只拥有领取、写事件/回执和必要只读权限；迁移角色分离。
6. SSE 必须校验用户对 operation/store 的访问权，断开权限后 authorizationVersion 立即失效。
7. 所有高风险动作写 AuditEvent：who、tenant/store、target versions、operationId、理由、前后状态和 releaseId。
8. feature flag fail closed；若某 release 声明“发布产品可用”，readiness 必须同时验证 Control 开关、Worker heartbeat、Queue、DB migration 和 adapter contract，不能页面显示可发布而 Worker 缺失。

### 05.21 可观测性、SLO 与运营诊断

链路 ID：

```text
operationId
  -> batchId
  -> attemptId
  -> commandId
  -> outboxEventId
  -> queueJobId
  -> leaseId / workerId
  -> SHEIN traceId / version / SPU / SKC
  -> receiptId / reconciliationCaseId
```

初始 SLO（需 ERP-19 以真实负载校准）：

1. handoff/outbox 事务 p95 < 1 秒。
2. 正常负载队列领取 p95 < 1 秒。
3. SHEIN 正常快速响应时，用户通常 2～3 秒看到 accepted/known_failed；超时只转等待/unknown，不伪成功。
4. DB event 到在线页面反馈 p95 < 500ms。
5. 100% Command 可追到 ProductVersion、操作者、release、发送边界和 Receipt。
6. 0 个 `send_started` 后自动发布重试。
7. 0 个已提交 Command 因 Redis/Worker 重启永久丢失。

指标：Outbox lag、queue wait、lease age、send latency、SHEIN code/timeout/429、accepted/failed/unknown、reconciliation age、投影 lag、SSE connections/errors、每店并发和 Worker heartbeat。

运营诊断台提供只读“为什么停在这里”和下一安全动作，不提供绕过状态机的任意重放按钮。

### 05.22 数据迁移与向后兼容

1. 不修改迁移 010/030/034/045 等已执行文件；新增 additive migration。
2. 为现有 publish_jobs 增加 productVersionId/attemptId/commandId 关联，先 nullable、回填分类、再建立约束。
3. 建立 Outbox、CommandEvent 和必要 reconciliation 表/列；优先复用板块 03 的通用 outbox/inbox/event 基础。
4. `publish_batches.preflight` 保留 immutable preflight/plan snapshot，不再作为 mutable execution current state。
5. legacy Job 分类为 versioned、legacy_draft_bound、result_unknown、unmatched、conflict；不制造 ProductVersion 证据。
6. 新写路径只写规范 Command/Receipt/Event，旧读路径通过 adapter 兼容；禁止长期双写两个 current owner。
7. 现有 accepted/Receipt 先只读对账，再回填 Attempt/Version 关系；任何不确定记录进入人工核对。
8. 本地额度临时投影按唯一 accepted Receipt/Event 重建，验证恰好一次，不直接批量加减生产数字。
9. staging 进行 Worker 崩溃、DB/Redis 断开、Outbox 重投、Webhook 重复、SSE 断线和旧数据回放演练。
10. production 先影子对账、再单店单商品 canary；旧 Worker 在新 Worker 开始领取前停止，不能并行执行同一命令。

### 05.23 分步实施顺序

| 编号 | 名称 | 必做交付 | 对应 ERP |
| --- | --- | --- | --- |
| PUB-01 | 生产发布拓扑与开关基线 | Control/Worker/Queue/DB/release/flag/真实入口只读证据 | ERP-00、ERP-01、ERP-08 |
| PUB-02 | 发布黄金回归与故障 fixture | accepted/known failure/unknown/超时/崩溃/重复点击/部分成功 | ERP-03、ERP-07、ERP-21 |
| PUB-03 | 统一词典与三状态机 | execution/reconciliation/official review 分离和合法转换 | ERP-04、ERP-09、ERP-10 |
| PUB-04 | ProductVersion/Attempt/Command 模型 | additive schema、稳定 ID、parent/supersedes 和约束 | ERP-06、ERP-09 |
| PUB-05 | 原子 handoff + Outbox | Batch/Attempt/Command/Event/Outbox/Draft 单事务和失败回滚 | ERP-06、ERP-09、ERP-12 |
| PUB-06 | Outbox Dispatcher | SKIP LOCKED、确定性 jobId、重投、lag、dead-letter 诊断 | ERP-08、ERP-09、ERP-18 |
| PUB-07 | 逐命令 Queue 契约 | 每 Command 一 Job、attempts=1、payload 最小化和 dedupe | ERP-08、ERP-09 |
| PUB-08 | Worker lease 与 send_started | CAS、heartbeat、发送边界、graceful shutdown 和恢复 | ERP-08、ERP-09、ERP-19 |
| PUB-09 | SHEIN 结果分类器 | endpoint fixture、accepted/known_failed/unknown、原始错误保真 | ERP-07、ERP-09 |
| PUB-10 | Receipt/Event 账本 | append-only、dedupe、证据等级、projection replay | ERP-06、ERP-09、ERP-10 |
| PUB-11 | unknown 核对器 | Webhook/只读查询、provisional、confirmed 和 manual review | ERP-09、ERP-10、ERP-18 |
| PUB-12 | 重试/暂停/取消规则 | pre-send 安全重投、known failure 新 Attempt、unknown 禁重发 | ERP-09、ERP-13 |
| PUB-13 | 批次部分成功策略 | eligible/blocked 显式选择、逐项状态和聚合计数 | ERP-09、ERP-12、ERP-13 |
| PUB-14 | 202 + SSE 快速反馈 | operation event stream、续传、权限、超时和手动刷新 fallback | ERP-09、ERP-13、ERP-18 |
| PUB-15 | 发布中心交互收敛 | 状态文案、动态移行、timeline、允许动作和错误证据 | ERP-13 |
| PUB-16 | 店铺限流、公平与背压 | per-store in-flight、共享 limiter、批次公平和拥塞门禁 | ERP-08、ERP-09、ERP-19 |
| PUB-17 | 附属合规命令拆分 | 商品 accepted 后独立合规 submission/revalidation，不反写主结果 | ERP-09、ERP-16 |
| PUB-18 | 可观测性与运营诊断 | 全链 ID、SLO、告警、readiness 和安全 runbook | ERP-18、ERP-19 |
| PUB-19 | legacy 迁移与 staging 演练 | 分类、只读对账、故障注入、双读和回滚 | ERP-05、ERP-20、ERP-21 |
| PUB-20 | 单商品金丝雀与稳定退役 | manifest 一致、真实证据、逐级放量、旧 Worker 零领取 | ERP-22、ERP-23 |

PUB-01 至 PUB-11 是 P0 地基。未完成前不得通过页面文案、额外轮询、整批 retry 或直接重启 Worker 掩盖命令丢失、双重事实和 unknown 重发风险。

### 05.24 验收标准

#### 原子性与不丢命令

1. handoff 任意一步失败时 Draft、Version、Attempt、Command、Outbox 和页面归属全部回滚。
2. 事务成功后即使 Control 立刻崩溃、Redis 清空或 Dispatcher 重启，Command 最终仍能被同 ID 投递。
3. 每个 Command 精确引用 ProductVersion；Worker 不从 mutable Draft 构造现场 payload。
4. Queue 重复投递、Webhook 重复和 Receipt 重放不产生第二次业务状态或额度扣减。
5. `publish_batches.preflight` 不再充当可变 current execution owner。

#### 执行、unknown 与重试

6. Worker 崩溃前/后 `send_started` 的两类场景分别安全重投与 result_unknown。
7. 所有 result_unknown 均无自动 PublishCommand 重发路径。
8. known_failed 再次发布产生 child Attempt/Command，旧历史不被覆盖。
9. pause/cancel 只影响未发送命令；accepted/unknown 返回“太迟/不可取消”。
10. 明确业务拒绝、成功缺身份、超时、5xx、限流和网络中断均按 fixture 分类并保留 trace。

#### 批次与用户反馈

11. 一个阻断项不会把其他 eligible 项静默标失败；用户明确选择发布范围。
12. 批次 15/50/100 商品逐项隔离，accepted/failed/unknown 数量与 Command 真相一致。
13. POST 在 durable handoff 后返回 202；页面显示“已进入发布流程”而非“SHEIN 已接收”。
14. SSE 只推送当前 operation，支持断线续传；断开不改变业务状态。
15. 常规 SHEIN 快速响应在体验测试中通常 2～3 秒可见；超过阈值诚实显示等待/未知。
16. 切店、切账号、页签切换和多标签页无事件串店或隐藏选择。

#### 恢复、运行与安全

17. Outbox/Redis/Worker/Control/PostgreSQL/SSE 故障注入和恢复全部通过。
18. Worker releaseId、contract version、migration、Control 和 feature flag readiness 一致。
19. 同店并发、跨店公平、429 和大批次背压达到 ERP-19 预算。
20. 任何页面状态可追溯到 operationId→commandId→send event→SHEIN trace/receipt。
21. 普通成员、跨租户、跨店、过期授权和伪造 Queue 消息均无法调用 SHEIN。
22. 单商品 production canary 的页面、数据库、队列、Worker、日志和 SHEIN 后台证据一致，且回滚已验证。

### 05.25 明确不做

1. 不承诺分布式外部写“绝对 exactly once”；承诺可证明、可核对和未知不盲重试。
2. 当前阶段不部署 Kafka、Debezium、Temporal 或新的队列平台。
3. 不把 Redis/BullMQ 状态当业务真相，也不把 Queue completed 当 SHEIN 接收。
4. 不在页面或 Control 直接调用 SHEIN 商品发布接口。
5. 不在同一 Queue Job 内循环执行整个大批次。
6. 不把审核、SPU 回读、合规复验完成写成 PublishCommand 的一个万能 completed。
7. 不因用户离开页面取消已提交命令，也不因切店重绑任务。
8. 不增加全站定时同步或常驻高频轮询。
9. 不让 BullMQ 自动 attempts 重试可能已经触达 SHEIN 的命令。
10. 不把合规照片、AI 或其他附属动作失败改写为“商品未被 SHEIN 接收”。
11. 不直接清理 legacy jobs/receipts 或批量改写为成功/失败。
12. 不在本板块重做全站 UI、审核分类或经营数据。

### 05.26 开源项目与成熟模式借鉴边界

1. [BullMQ Idempotent Jobs](https://docs.bullmq.io/patterns/idempotent-jobs)：借鉴 Job 原子、简单和幂等设计；继续使用现有 BullMQ，但不依赖自动 retry 解决外部写 unknown。
2. [BullMQ Deduplication](https://docs.bullmq.io/guide/jobs/deduplication)：借鉴确定性去重和单一未完成 Job；业务 Command 真相仍在 PostgreSQL。
3. [Debezium Outbox Event Router](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html)：借鉴数据库事实与事件投递一致的 Outbox 模式；当前规模只实现轻量 PostgreSQL Dispatcher，不部署 Kafka/Debezium。
4. [pg-boss](https://github.com/timgit/pg-boss)：借鉴 PostgreSQL 事务内创建任务、`SKIP LOCKED`、心跳和恢复；当前不替换 BullMQ，先补齐已有架构断点。
5. [Temporal Durable Execution](https://docs.temporal.io/temporal)：借鉴事件历史、崩溃恢复、Activity 与 Workflow 状态分离；当前业务规模不引入 Temporal 服务。

开源方案只提供可靠交付和恢复模式。本项目的结果分类、外部重试边界、平台身份和回执证据必须以 SHEIN 当前官方 endpoint 契约为准。

### 05.27 已确认决策

1. Worker 是唯一真实 SHEIN 商品发布写 owner；Browser、Control controller 和页面不得直写。
2. PublishCommand 必须绑定 immutable ProductVersion，不从 mutable Draft 构造执行 payload。
3. Batch、Attempt、Command、Receipt、reconciliation 和 official review 分离建模。
4. Command/Event/Outbox/Draft handoff 在一个数据库事务中提交。
5. PostgreSQL 是命令真相；BullMQ 只负责投递和唤醒。
6. 每个 PublishCommand 一条 Queue Job，不再以一个执行 Run 循环抽干整批。
7. 商品发布 Queue 显式 attempts=1；安全重投由 Outbox/Command 状态控制。
8. 在调用 SHEIN 前持久化 `send_started`；之后无明确结果一律 unknown。
9. result_unknown 永不自动发布重试，只通过 Webhook/只读查询核对。
10. known_failed 再次发布创建新 child Attempt/Command，并重新预检/确认。
11. accepted 需要完整官方同步响应身份；成功码但 version/SPU/SKC/SKU 证据不完整为 unknown。
12. Receipt 和 CommandEvent append-only、幂等，current projection 可从证据重建。
13. 一次空回读不能证明未接收；达到正式证据规则后才开放新 Attempt。
14. 阻断项留草稿；只在用户明确确认后发布 eligible 子集。
15. 批次部分成功逐项展示，批次 aggregate 不覆盖单项状态。
16. pause/cancel 仅作用于 `send_started` 前命令；accepted/unknown 不可取消。
17. 发布提交使用快速 202 + 当前 operation 专属 SSE，不在创建请求内长轮询。
18. SSE/Redis 只是反馈优化，事件真相在 PostgreSQL；断线可续读并保留手动刷新。
19. 不增加每 30 秒自动同步或切店自动 SHEIN 调用。
20. 每店默认一个在飞发布请求，多店公平和全局并发以压测定稿。
21. 商品 accepted 与合规照片/复验拆为独立命令和状态，附属失败不改写主接收结果。
22. 当前继续使用 PostgreSQL + Redis + BullMQ；先修现有架构，不引入 Kafka/Debezium/Temporal/新队列。

### 05.28 后续仍可讨论但不阻塞方向的事项

1. SSE 连接上限、保持时间、心跳和历史事件保留时长。
2. `platform_not_received_confirmed` 所需的具体查询次数、时间窗和官方字段证据。
3. SHEIN 各发布错误码哪些允许同 ProductVersion 新 Attempt，哪些必须返回编辑或更换商品。
4. 每店并发、全局并发、批次上限和公平调度权重。
5. accepted 后合规照片是独立 Command 还是独立 Workflow Step；无论实现如何都不得反写主接收结果。
6. 是否在未来容量增长后采用 pg-boss、Debezium/Kafka 或 Temporal；必须以可量化瓶颈和迁移收益重新评审。
7. 发布批次保留年限、原始 SHEIN 响应加密存放时长和运营导出范围。

## 板块 06：官方回读、Webhook、审核状态投影与商品审核中心

本板块承接板块 05 的 PublishAttempt、PublishCommand、Receipt 和 `result_unknown` 边界，负责把 SHEIN 官方接收、审核、流程阶段、SPU/SKC/SKU 回读与本地执行证据归并为唯一、可解释、可重建的审核读模型。它不重新定义发布写入，不增加自动同步，也不允许前端通过字符串和临时数组推导商业真相。

### 06.1 总体结论

当前系统已经具备 Webhook 原始事件、document-state 只读查询、发布回执、`product_review_states`、状态分类器和 review-center snapshot 的基础，不应推倒重来。但现有实现仍不是商业级“单一审核真相”，主要断点是：

1. Webhook、document-state、发布批次回读、草稿、经营快照和价格讨论仍由不同读取路径进入页面。
2. 当前 snapshot 是一次 Control 请求内的多源 `Promise.allSettled` 聚合，不是数据库同一一致性快照。
3. 前端继续根据中文标签、Draft、Batch、Readback、Review 和 Price Discussion 二次分类、计数和选择。
4. 当前 Attempt 和同 SKC 当前行仍存在按 `updated_at`、官方时间和 version 比较选择的启发式路径。
5. document-state 会并行写 `publish_receipts` 与 `product_review_states`，其中一个失败时形成部分投影。
6. 数据源失败时 snapshot 使用空默认值，若页面没有上一份可信快照，容易把“读取失败”误看成 0 条。
7. 手动刷新由浏览器编排多轮本地 refetch、逐批次回读、逐 version SHEIN 查询和经营刷新，调用范围、版本和失败边界不统一。

目标不是增加更多刷新和过滤补丁，而是建立：

> 一个官方事件入口、一个标准化回执模型、一个 Attempt Resolver、一个确定性 Reducer、一个当前投影、一个 Snapshot API、一个受控手动刷新 Operation。

### 06.2 当前源码事实基线

只读核对确认：

- `server/cloud/webhook-production-projections.js` 已解析商品接收与审核 Webhook，并可向发布回执仓储追加回执。
- `server/cloud/document-state-projections.js` 已规范化 `/open-api/goods/query-document-state`。
- `server/cloud/publish-execution-repository.js` 已支持 Webhook、document-state、SPU readback 与合规回执。
- `server/cloud/migrations/039_product_review_states.sql` 建立了 store-scoped 审核当前投影；`043_product_review_workflow.sql` 增加 workflow stage。
- `server/cloud/review-center-status.js` 已有纯状态分类器，并尝试让官方终态优先于本地执行状态。
- `server/cloud/review-center-snapshot-service.js` 已提供 `review-center-snapshot-v1` 和 source partial 状态。
- `server/cloud/product-review-service.js` 同时读取 Webhook、review projection、官方商品、归档状态和 publish jobs，再在服务层归并。
- `src-v2/features/publishing/PublishBatchesPage.tsx` 仍在浏览器内维护第二套标签映射、计数、选择和手动刷新 orchestration。
- `review-center-attempts.js` 仍按 job 更新时间选择同 SKC 当前 Attempt；`product-review-service.js` 仍以时间/version 作为 current row 的兜底。
- `queryDocumentState()` 当前把 receipt 与 review state 作为两个并行持久化任务，允许返回 partial persistence。

这些事实说明已有组件可作为迁移来源，但 current projection、snapshot 与 browser reducer 必须收敛。

### 06.3 责任边界

| Owner | 唯一职责 | 明确禁止 |
| --- | --- | --- |
| Webhook Ingress | 验签、解密、tenant/store 解析、原始事件幂等入 Inbox | 直接改审核页签或发布状态 |
| Manual Refresh Service | 创建/复用只读刷新 Operation，受控调用 SHEIN 查询 | 由浏览器逐 version 扇出请求 |
| Review Normalizer | 把不同官方来源变成统一 OfficialReviewReceipt | 用中文文案猜官方状态 |
| Attempt Resolver | 将回执唯一关联 Store/ProductVersion/PublishAttempt/PlatformLink | 按标题、最新时间或模糊 SKC 猜测 |
| Review Reducer | 依据事件顺序和状态规则推进 projection | 调用 SHEIN 或读取浏览器状态 |
| Snapshot Query | 在同一数据库快照返回 counts/rows/eligibility/freshness | 调 SHEIN、执行补偿写或二次分类 |
| V2 Review Center | 渲染 snapshot、选择可操作行、监听当前 Operation | 自己计算当前 Attempt、页签和官方状态 |

板块 05 的 Publish Worker 仍是唯一商品发布写 owner；本板块所有 SHEIN 调用默认只读。

### 06.4 目标拓扑

```text
SHEIN Webhook ─────────────┐
                           │
Manual Refresh Operation ──┼─> OfficialEventInbox
                           │        │ verify / dedupe
Compensation Readback ─────┘        ▼
                              ReviewNormalizer
                                     │
                                     ▼
                          OfficialReviewReceipt
                                     │
                                     ▼
                              AttemptResolver
                         matched / unmatched / conflict
                                     │
                                     ▼
                               ReviewReducer
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
        AttemptReviewProjection                  ProjectionEvent/Outbox
                 │                                       │
                 └───────────────┬───────────────────────┘
                                 ▼
                      ReviewCenterSnapshot API
                                 │
                         Browser + Operation SSE
```

Webhook 与手动查询只是不同 transport；进入 Normalizer 后必须使用同一语义。

### 06.5 目标领域模型

| 实体 | 作用 | 关键约束 |
| --- | --- | --- |
| `OfficialEventInbox` | 保存验签后的原始 SHEIN 事件/查询响应引用 | append-only、sourceEventId/bodyHash 幂等、tenant/store scope |
| `OfficialReviewReceipt` | 标准化官方接收、审核、流程阶段和标识 | append-only、保留 source/path/trace/occurredAt/receivedAt/rawRef |
| `ReceiptMatch` | 记录回执与 Attempt 的匹配结论 | matched/unmatched/conflict/manual_linked，保留候选与依据 |
| `AttemptReviewProjection` | 某一 PublishAttempt 的当前官方审核读模型 | 一 Attempt 一行、revision/lastReceiptId 单调推进、可重建 |
| `CurrentReviewPointer` | 某 CatalogProduct/SKC 当前 Attempt 的显式指针 | 由 Attempt parent/supersedes 和正式 handoff 推进，不按时间猜 |
| `ReviewRefreshOperation` | 一次用户手动刷新 | tenant/store/dataset/idempotency、逐目标结果、可观察、只读 SHEIN |
| `ReviewCenterPreference` | 本地归档/静音/列设置等体验偏好 | 不修改官方事实，不参与 reducer |
| `ReviewCenterSnapshot` | 一次一致性页面读取 | snapshotId/version、counts、rows、eligibility、freshness、sourceHealth |

不得继续让 `product_review_states` 同时承担原始证据、当前官方状态、当前 Attempt 选择和本地归档四种职责。

### 06.6 统一官方回执 Envelope

每条标准化回执至少包含：

```text
receiptId
tenantId / storeId
source = webhook | document_state | spu_readback | manual_reconcile
eventFamily / endpoint
sourceEventId / dedupeKey
traceId
documentSn / sheinVersion / spuName / skcName / skuCodes
officialAuditState / officialWorkflowStage / receiveState
failedReasons[]
occurredAt / receivedAt
rawInboxId / normalizerVersion
```

规则：

1. `occurredAt` 是官方业务时间；`receivedAt` 只是本系统收件时间。
2. 缺少官方业务时间时必须标记 `timeConfidence=received_only`，不能伪造 occurredAt。
3. 未识别 audit/workflow 值保存原值并进入 `official_state_unknown`，不得强行映射“待审核”。
4. 中文显示文案由 UI label dictionary 生成，不进入官方状态判定。
5. 原始响应以受控引用保存；公开 API 只返回脱敏摘要。

### 06.7 Inbox、幂等与重复/乱序事件

1. Webhook 验签成功后先 append Inbox，再返回可接受响应；业务 reducer 失败不能丢原始事件。
2. 手动查询结果也生成 Inbox/Receipt，不能绕过事件账本直接 UPDATE 当前状态。
3. 同一 sourceEventId 或标准化内容指纹重复到达时只追加一次 Receipt，重复次数可记指标。
4. Receipt 写入、Match、Projection 更新和 ProjectionEvent 在一个数据库事务中完成。
5. reducer 必须支持同一事件重放，结果不变。
6. 旧事件晚到不能回退较新的同 Attempt 状态；拒绝、撤回等终态只能被更晚的正式官方事件或新 Attempt 取代。

### 06.8 Attempt Resolver

匹配优先级固定为：

1. `tenantId + storeId + sheinVersion` 唯一匹配。
2. `tenantId + storeId + documentSn` 唯一匹配。
3. 已建立的 store-scoped PlatformProductLink + 明确 Attempt 关系。
4. 受控 legacy 映射表中的人工确认关系。

禁止：

- 只按 SPU/SKC/SKU 名称自动合并。
- 只按标题、供应商编码或更新时间匹配。
- 多个候选时选“最新一个”。
- 回执缺少 store identity 时跨店搜索后猜测。

结果必须是：`matched`、`unmatched`、`conflict` 或 `manual_linked`。后两类进入诊断队列，不进入正常页签计数。

### 06.9 三个正交状态维度

审核中心每行同时保留：

1. `executionState`：来自 PublishCommand，回答是否排队、发送、accepted、known_failed、result_unknown。
2. `reconciliationState`：回答结果是否已由官方回执核对、暂未找到、冲突或需人工处理。
3. `officialReviewState`：回答 SHEIN 当前审核/流程阶段。

它们不能合并为 `completed`、`flowStatus` 或一个万能中文标签。展示主标签可由服务端 resolution 生成，但原始三个维度必须同时返回。

### 06.10 官方审核状态字典

规范状态固定为：

```text
not_received
received_waiting_review
awaiting_review
awaiting_price
awaiting_sample
awaiting_version_review
awaiting_sample_review
awaiting_final_review
approved
rejected
withdrawn
unknown
```

每个状态必须记录：官方原始值、来源 endpoint/event、映射版本、进入时间、最后证据、允许动作和 UI 文案。新增官方值先进入 unknown 并告警，不能仅增加一个前端字符串数组。

### 06.11 事件优先级与单调 Reducer

优先级不是“Webhook 永远高于手动刷新”或“最后收到的永远正确”，而是：

1. 先限定同一 Attempt/official version。
2. 官方明确 audit terminal 证据优先于本地 execution 提示。
3. 更高官方 sequence/revision 优先；没有 sequence 时比较可信 occurredAt。
4. 只有 receivedAt 的事件不能覆盖已有更高置信 occurredAt 事件。
5. 同一官方时间冲突进入 `projection_conflict`，不按渠道或字符串猜测。
6. 新 Attempt 通过显式 current pointer 成为当前；旧 Attempt 的终态留 timeline，不覆盖新 Attempt。

### 06.12 “需处理”只能是运营视图

`needs_action` 不是 SHEIN 官方审核状态，而是服务端基于原因生成的运营聚合。至少分为：

| 原因组 | 示例 | 允许动作 |
| --- | --- | --- |
| authoring | 草稿/预检字段阻断 | 返回编辑 |
| publish_failure | 明确发布业务失败 | 查看错误、修正后新 Attempt |
| result_unknown | 发送后结果不确定 | 只读核对，禁止重发 |
| receive_failure | 官方明确接收失败 | 查看证据，按规则新 Attempt |
| withdrawn | 官方撤回 | 查看原因、修正/重发 |
| projection_conflict | 回执匹配或乱序冲突 | 人工诊断，不允许直接发布 |

“已驳回”必须保持独立页签；待核价、寄样、审版、核样和终审也不得并入需处理。

### 06.13 Current Attempt 与历史 Timeline

1. handoff 创建新 Attempt 时在同一事务推进 `CurrentReviewPointer`。
2. parent/supersedes 形成明确链路；旧 Attempt 永远留历史。
3. 当前列表只展示 current Attempt；详情页显示完整 timeline。
4. 旧驳回晚到时只更新旧 Attempt timeline，不把新 Attempt 拉回“已驳回”。
5. 无法建立 current pointer 的 legacy 记录进入 `legacy_unresolved`，不按更新时间自动选中。
6. approved/listed 的 Attempt 退出活动审核队列，但历史可检索。

### 06.14 Projection 写入原则

1. 原始 Receipt append-only，Projection 可更新但必须携带 `projectionRevision` 和 `lastReceiptId`。
2. Projection UPDATE 使用 compare-and-set，拒绝较旧 revision。
3. 每次 reducer 结果保存 before/after 状态摘要和 ruleVersion。
4. Receipt 写成功但 Projection 失败时由 Outbox/repair worker 重放同一 Receipt，不让页面自行补写。
5. 投影重建可按 tenant/store/attempt 范围执行，默认只读 dry-run；生产重建需正式 ERP Run。
6. 本地归档/偏好不得 UPDATE 官方 Projection 的 archived 字段。

### 06.15 Review Center Snapshot API

Snapshot API 必须在一个 PostgreSQL `REPEATABLE READ` 或等价一致性快照内返回：

```text
snapshotId / snapshotVersion / projectionRevision
generatedAt
storeId
countsByOfficialState
needsActionCountsByReason
rows[]
row.eligibility / allowedActions / reasonCodes
sourceFreshness / lastSuccessfulRefreshAt
activeRefreshOperation
unmatchedCount / conflictCount
pagination / total
```

硬约束：

1. counts、rows、eligibility、search/filter total 使用同一 snapshot。
2. 一个 current Attempt 在互斥官方页签中最多出现一次。
3. `needs_action` 是可与官方状态并列展示的运营过滤器，不重写 officialReviewState。
4. Snapshot 只读 PostgreSQL，不在页面 GET 内调用 SHEIN 或启动刷新。
5. 服务端分页、筛选和排序；稳定 rowId 使用 currentAttemptId，不用数组位置或标题。
6. snapshot source failure 不返回伪 0；必须返回上一份可信覆盖、stale/partial 状态或明确不可用。

### 06.16 手动刷新 Operation

浏览器只提交一次：

```text
POST /review-center/refresh
{ storeId, scope, visibleSnapshotId, optionalAttemptIds }
```

服务端行为：

1. 按 `tenant/store/dataset` 创建或复用一个活动 Operation。
2. 先从数据库解析当前 Attempt 和可查询官方标识，浏览器不提交 version/SPU 列表作为权威目标。
3. 按 SHEIN 批量上限、每店限流和全局并发分组查询。
4. 每个官方结果进入同一 Inbox/Normalizer/Resolver/Reducer。
5. 空回读记录为 `no_record_observed`，保留查询覆盖和时间，不改写为 not_received confirmed。
6. 逐目标保存 succeeded/empty/failed/unmatched/conflict；Operation 可 partial。
7. 返回 `202 + operationId`，页面只监听该次 Operation。
8. 重复点击复用活动 Operation；Operation 结束后不继续轮询。

不增加每 30 秒自动同步，不因切店、页面进入、窗口聚焦或网络恢复自动调用 SHEIN。

### 06.17 Webhook 处理

1. 验签、解密、重放保护和 store resolver 保留现有稳定实现。
2. Ingress 只负责 durable Inbox，不直接调用页面 query cache 或同步多张业务表。
3. Worker 对同一 Inbox 事件可安全重放；失败进入可诊断重试/死信，不删除原始事件。
4. 无店铺、身份冲突或未匹配事件保留到 unmatched queue，不跨租户猜测。
5. Webhook 更新 Projection 后发布内部 ProjectionEvent；页面是否在线不影响事实落库。
6. Webhook 与手动回读使用同一 normalizer fixture，预期输出必须相同。

### 06.18 部分失败与降级策略

| 场景 | 页面行为 | 数据行为 |
| --- | --- | --- |
| 一个 version 查询失败 | 显示该目标失败，其他结果继续 | 保留该 Attempt 上次可信 Projection |
| SHEIN 限流 | Operation partial/rate_limited，给出 retryAfter | 不清凭证、不清列表、不自动重试写入 |
| 权限/签名失败 | 明确重授权或权限错误 | 旧快照保留并标 stale |
| Receipt 成功、Projection 暂失败 | 显示投影延迟/降级 | 后台重放 Receipt，不要求用户再发布 |
| Snapshot 某来源不可用 | 保留上一份可信值和 source health | 禁止用空默认值覆盖真实计数 |
| 返回空记录 | 显示“本次未查询到记录”与覆盖时间 | 不证明平台未接收，不开放自动重发 |
| 未知官方状态 | 显示“官方状态待识别” | 原值入账、告警、禁止猜测分类 |

页面不得同时出现“刷新成功”和无归属的红色“请求失败”。所有错误必须绑定 source/target/operationId。

### 06.19 动态移行与实时反馈

1. Webhook 或手动刷新导致 Projection revision 增长时，当前 Operation SSE 发送 `projection_changed`。
2. 浏览器收到事件后重新读取 Snapshot；不直接在本地把行改成某页签。
3. 一件商品只有在新 Snapshot 证明其 current Attempt 已变化时，才从旧页签移出。
4. 驳回重发后，新 Attempt durable handoff 可使旧驳回退出当前页签；旧驳回仍在 timeline。
5. SSE 断线后通过 operation snapshot/Last-Event-ID 恢复；SSE 不可用时手动刷新仍完整工作。
6. 页面离开或 Operation 终止后停止监听，不建立全站常驻同步。

### 06.20 选择与批量操作

1. 选择作用域固定为 `tenant/user/store/snapshotId/tab/filter/page`。
2. 默认全选只选择当前可见页且 `eligible=true` 的行。
3. “选择全部 N 条结果”必须由服务端 selection token 明确表达，并二次确认。
4. snapshotId、店铺、页签、筛选、用户或权限变化立即清理选择。
5. 按钮数量由服务端允许集合与当前选择交集计算，不能包含隐藏 ID。
6. 服务端再次验证 currentAttemptId、snapshot/version 和 allowedAction；旧选择返回 409，不作用于新状态。
7. archive、relaunch、return-to-edit 等动作分别使用独立 capability 和确认文案。

### 06.21 归档、隐藏与历史

1. “归档”只是当前用户/工作空间的阅读偏好，不改变 SHEIN 官方状态。
2. 官方 current Projection 不能通过 archive UPDATE 被覆盖或删除。
3. 默认活动列表可以隐藏已上架/已关闭工作项，但全量时间线仍可查询。
4. 归档已驳回前必须明确它只是隐藏工作项，不是撤回或删除商品。
5. 当前 Attempt 发生新官方事件时，是否恢复显示由产品规则决定并记录，不静默永久隐藏。
6. 批量归档使用精确 currentAttemptId 和 snapshotId，不用 reviewKey 字符串猜对象。

### 06.22 权限、安全与隔离

1. Inbox、Receipt、Match、Projection、Operation、Snapshot 和 SSE 全链路包含 tenant/store。
2. StoreAccess 只决定可见店铺；refresh、archive、relaunch、manual-link 使用独立 capability。
3. SSE 连接校验 tenant/user/store/operation，事件 key 不含可猜测的跨店公共频道。
4. 浏览器不能提交 raw SHEIN payload、内部 jobId 或任意 official status 作为写入事实。
5. unmatched/manual-link 仅高权限管理员可处理，必须双人审阅或至少追加完整审计。
6. 日志保留 code、traceId、sourceEventId 和 operationId，但脱敏凭证、完整 payload 和敏感商品资料。

### 06.23 可观测性与 SLO

关键指标：

- Webhook ingress/normalize/match/reduce 延迟与失败率。
- duplicate、unmatched、conflict、unknown official value 数量。
- Projection lag、revision 冲突和重放次数。
- 手动刷新 p50/p95/p99、目标数、成功/空/失败/限流分布。
- Snapshot p50/p95、rows/count 对账失败、stale/partial 店铺数。
- 当前 Attempt 无显式 pointer、同 SKC 多 current、跨页签重复数。
- SSE 连接、断线恢复、事件积压和 fallback 使用率。

初始 SLO：

- 已接收 Webhook 的 99% 在 10 秒内进入可查询 Projection。
- Snapshot 本地读取 p95 小于 800ms（目标规模下）。
- counts/rows/互斥页签对账错误为 0。
- 未匹配和冲突绝不静默进入正常页签。
- 手动刷新 API 创建 Operation p95 小于 500ms；远端完成时间单独展示。

### 06.24 数据迁移与兼容

1. 先只读盘点 `webhook_events`、`publish_receipts`、`product_review_states`、publish jobs 与页面 current row 的关系。
2. 为已有 Receipt 补 `normalizerVersion`、match 状态和 projection replay dry-run，不修改原始回执。
3. 新增表/字段采用 additive migration；现有 `product_review_states` 在双读期保留。
4. 新 Reducer 对历史事件影子重放，与旧页面逐店、逐状态、逐 Attempt diff。
5. 无法唯一匹配的 legacy 记录进入 unmatched/legacy_unresolved，不制造 current pointer。
6. Snapshot v2 先只读影子运行；counts/rows/eligibility 对账通过后再切 V2 UI。
7. 切换后旧前端分类器、旧手动刷新 fan-out 和旧 archive 写路径停止新调用，但 ERP-23 前不删除。
8. 历史数据修正不自动重发 SHEIN、不把 unknown 改成功、不删除回执。

### 06.25 分步实施顺序

| 编号 | 名称 | 交付物 | ERP 映射 |
| --- | --- | --- | --- |
| REV-01 | 回读/审核生产事实基线 | Webhook、readback、projection、snapshot、UI 网络图和 store 样本 | ERP-00、ERP-05、ERP-18 |
| REV-02 | 官方状态词典与 fixture | audit/workflow 原值、规范值、unknown 和合法转换 | ERP-04、ERP-07 |
| REV-03 | OfficialEventInbox 契约 | 原始事件、查询响应、dedupe、rawRef 和保留策略 | ERP-06、ERP-10 |
| REV-04 | ReviewNormalizer | Webhook/document-state 同输入同输出 fixture | ERP-07、ERP-10 |
| REV-05 | Attempt Resolver | version/document/PlatformLink 匹配、unmatched/conflict | ERP-06、ERP-10 |
| REV-06 | Receipt/Match 账本 | append-only、幂等、来源/时间/证据等级 | ERP-06、ERP-10 |
| REV-07 | 单调 Review Reducer | 乱序、重复、终态、新 Attempt 和未知状态 | ERP-04、ERP-10 |
| REV-08 | 显式 CurrentReviewPointer | parent/supersedes、legacy unresolved 和 timeline | ERP-06、ERP-10 |
| REV-09 | AttemptReviewProjection | CAS revision、lastReceipt、可重建和影子 replay | ERP-06、ERP-10 |
| REV-10 | needs_action 原因模型 | 官方状态与运营原因分离、allowed actions | ERP-04、ERP-11 |
| REV-11 | Snapshot v2 查询 | 同事务 counts/rows/eligibility/freshness/paging | ERP-11 |
| REV-12 | 手动 Refresh Operation | 202、去重、服务端目标解析、限流和逐项结果 | ERP-10、ERP-18 |
| REV-13 | Webhook 统一接入 | Inbox 后 reducer、失败重放、unmatched 诊断 | ERP-10、ERP-18 |
| REV-14 | partial/stale 降级 | last-known-good、source health、空回读语义 | ERP-10、ERP-11 |
| REV-15 | Review Center V2 adapter | 页面只消费 Snapshot，不二次分类 | ERP-11、ERP-13 |
| REV-16 | 动态移行/SSE | projection_changed、断线续读、手动 fallback | ERP-13、ERP-18 |
| REV-17 | 选择与批量动作 | snapshot-scoped selection、409、服务端 eligibility | ERP-11、ERP-13 |
| REV-18 | 归档/历史偏好拆分 | Preference、timeline、官方 Projection 不可归档 | ERP-06、ERP-13 |
| REV-19 | 故障与规模验收 | 乱序/重复/部分失败/限流/1000+ 行/多店测试 | ERP-19、ERP-21 |
| REV-20 | 金丝雀与旧路径退役 | 单店影子 diff、逐级切换、旧 reducer 零调用 | ERP-22、ERP-23 |

REV-01 至 REV-11 是 P0 地基。未完成前不得继续给前端增加字符串分类、页面 fan-out 刷新或隐藏选择补丁。

### 06.26 验收标准

#### 状态正确性

- Webhook 与 document-state 对同一官方记录产生相同标准化 Receipt 和 Projection。
- 乱序、重复、延迟事件不会使同 Attempt 状态倒退。
- 新 Attempt 建立后，旧驳回只留 timeline，不占当前已驳回页。
- 未识别官方值显示 unknown 并告警，不进入普通待审核。

#### Snapshot 一致性

- 任一筛选下 counts、rows、total 和 eligibility 在同一 snapshot 对账。
- 同一 current Attempt 不同时出现在两个互斥官方页签。
- 数据源失败时保留 last-known-good 与错误状态，不显示伪 0。
- 1000+ 行使用服务端分页，稳定游标、搜索和排序无重复/漏行。

#### 手动刷新

- 重复点击复用一个 Operation，浏览器不逐 version 扇出请求。
- 单项失败不清空其他成功结果；空回读不自动开放重发。
- 不增加 30 秒自动同步，切店/进页/聚焦不调用 SHEIN。
- SSE 断线和 Redis 丢失可由 PostgreSQL operation snapshot 恢复。

#### 交互

- 已驳回重发后，仅在新 Snapshot 证明 current Attempt 变化时动态移出。
- 可见 4 条时选择和按钮数量只能是 0～4，除非用户明确选择全部搜索结果。
- 切页签、筛选、店铺、账号或 snapshot 后无隐藏选择。
- 页面不再出现“刷新成功”与无归属“请求失败”同时展示。

#### 安全与证据

- 跨 tenant/store Receipt、Snapshot、SSE 和 action 全部被拒绝且零副作用。
- unmatched/conflict 不自动关联，不进入正常页签。
- 每个页面状态能追溯到 currentAttemptId、receiptId、source、occurredAt、ruleVersion 和 operationId。
- 本板块任何失败都不能触发商品发布写接口。

### 06.27 已确认决策

1. Webhook、手动刷新和补偿查询进入同一 Inbox/Normalizer/Resolver/Reducer。
2. 原始官方事件与标准化 Receipt append-only；当前 Projection 可重建。
3. Attempt 只按 store-scoped 官方身份和显式关系匹配，多候选不猜测。
4. current Attempt 由 handoff/parent/supersedes 显式推进，不按最新时间选择。
5. execution、reconciliation、official review 三状态分离。
6. 官方状态使用稳定代码和映射版本；中文文案不参与判定。
7. `needs_action` 是运营原因聚合，不是官方状态；已驳回和各审核阶段独立。
8. Receipt/Match/Projection/ProjectionEvent 在一个数据库事务中推进。
9. Snapshot counts/rows/eligibility/freshness 来自同一数据库一致性快照。
10. 浏览器只渲染 Snapshot，不维护第二套状态 reducer。
11. 手动刷新由服务端 Operation 统一编排，重复点击复用任务。
12. 不增加 30 秒自动同步、切店同步、进页同步或窗口聚焦同步。
13. 空回读只表示本次未观察到记录，不能证明平台未接收。
14. 部分失败保留 last-known-good，并精确显示 source/target 错误。
15. 动态移行由 Projection revision + Snapshot 驱动，不做伪 optimistic official state。
16. SSE 只服务当前活动 Operation，PostgreSQL 是恢复真相。
17. 归档是本地阅读偏好，不修改官方 Projection 或 SHEIN 商品。
18. unmatched/conflict 进入诊断队列，未经审计的人工关联不得进入正常流程。

### 06.28 明确不做及后续讨论项

本板块明确不做：

- 不引入新的消息队列、Kafka、全量 Event Sourcing 或第二套前端状态库。
- 不用页面刷新修复数据库投影。
- 不因一次空查询把 result_unknown 改为未接收。
- 不把所有异常合并为“需处理”。
- 不删除历史 Webhook、Receipt、Attempt 或旧 Projection。
- 不在本板块调用 `publishOrEdit`、库存写入、价格写入或其他 SHEIN 商品写接口。

后续仍需结合真实官方 fixture 定稿：

1. 各 workflow stage 的官方原始字段、值和是否存在 sequence/revision。
2. Snapshot 分页大小、缓存时长和 last-known-good 保留周期。
3. unmatched/conflict 的管理员人工关联审批流程。
4. 本地归档在新事件到达后是否自动恢复显示。
5. Manual Refresh 默认范围是当前页、全部活动 Attempt，还是按数据新鲜度分层。
6. Webhook 到 Projection、手动刷新和 Snapshot 的正式 SLO 数值。

---

## 板块 07：素材资产、商品图片、上传处理、用途映射与对象存储生命周期

讨论日期：2026-08-29  
方案状态：方向已确认，待正式实施步骤补充迁移脚本、SHEIN 图片 fixture 与交互稿  
关联执行步骤：ERP-03、ERP-05、ERP-06、ERP-07、ERP-09、ERP-12、ERP-14、ERP-15、ERP-16、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23  
关联问题：BUG-MEDIA-001 至 BUG-MEDIA-015

### 07.1 总体结论

商业 ERP 中的图片不能继续只是草稿 JSON、模板 JSON 或页面数组中的 URL。素材必须成为独立、不可变、可授权、可复用、可追溯和可回收的领域资产。

本板块采用以下主链：

```text
UploadSession
  -> MediaAsset（不可变原始内容）
      -> MediaVariant（不可变派生内容）
          -> MediaReference（业务对象、用途、顺序、来源）
              -> PlatformMediaReceipt（SHEIN 上传/绑定证据）
```

目标不是增加一个“图片管理页面”，而是建立统一媒体底座，使商品编辑、批量建品、模板、AI、合规、发布和历史版本都引用同一套事实。

### 07.2 当前源码事实基线

已经存在、应保留并硬化的基础：

1. `media_assets` 保存对象存储元数据，图片字节不进入 PostgreSQL。
2. 浏览器先申请预签名 PUT，再直传对象存储，Control 不转发上传字节。
3. 完成上传时服务端执行对象存储 HEAD，核对大小和 Content-Type。
4. `media_asset_references` 已能保护草稿、模板、发布任务、SKC、SPU、合规和生成任务引用。
5. 对象存储默认私有，下载使用短时签名 URL。
6. 商品图片已有 main/detail/square/swatch/description/tail 的页面契约，并映射 SHEIN image type。
7. 尾图模板保存 assetId 和顺序，不保存 Base64，且固定追加到主图末尾。
8. 合规证据已经与普通商品图分开校验 MIME、大小和尺寸。
9. 清理 Worker、待删除状态、上传超时和恢复窗口已有初步实现。
10. 发布远端预检会按 `assetId + imageType` 尝试复用本次候选中的 SHEIN 图片结果。

当前结构性缺口：

1. `media_assets.purpose` 同时承担上传来源、生命周期和业务用途；一个文件被多个角色复用时语义冲突。
2. `media_asset_references` 只有 type/key，没有 role、slot、order、owner version、provenance 和 lockVersion。
3. 没有 `MediaVariant`，裁剪、压缩、水印、缩略图和发布版本的派生关系无法审计。
4. 没有独立 `PlatformMediaReceipt`；SHEIN URL、imageType、MD5、traceId 和有效性散落在预检候选或回执 JSON。
5. 浏览器提交 SHA-256，但服务端只以 HEAD 核对大小/类型，没有独立证明对象真实内容 hash。
6. SHA-256 只有普通索引，没有内容寻址的去重决策、冲突处理或复用授权。
7. 浏览器上传后再次 `file.arrayBuffer()` 计算 hash，大文件和批量图片会增加内存峰值和主线程压力。
8. 普通 PUT 上传没有统一上传队列、逐项状态、取消、断线恢复或后台继续机制。
9. 媒体列表最多返回 100 条，没有稳定分页、检索、标签、来源、引用详情或回收站，因此尚不是素材中心。
10. `reusable_source` 在迁移 014 被声明为永不按时间清理，迁移 015 又统一改为 3 天，保留策略相互矛盾。
11. 清理仓储候选 SQL 当前存在 SELECT 尾随逗号，且上传超时分支与主 WHERE 的括号边界需要独立回归证明。
12. `reference_count` 是可漂移缓存；清理安全依赖引用表、缓存状态和 Worker 多处同步。
13. 发布完成会释放部分 Draft 引用，但当前模型不能证明不可变 ProductVersion 已先拥有独立媒体引用。
14. 跨店模板媒体通过专项“可见媒体”解析实现，尚未形成统一 AssetScope/ShareGrant。
15. 素材上传、模板、商品编辑、批量导入、合规和 AI 各自有局部交互，没有统一素材选择与使用证据。

### 07.3 责任边界

- `MediaAssetService`：上传会话、资产身份、完整性校验、作用域和元数据。
- `MediaVariantService`：裁剪、缩放、压缩、水印、缩略图及变换指纹。
- `MediaReferenceService`：业务 owner、role、slot、order、provenance、版本冻结和引用事务。
- `PlatformMediaService`：SHEIN 图片上传、回执复用、有效性和 imageType 契约。
- `MediaRetentionService`：保留规则、hold、回收站、对象删除和审计。
- `MediaLibraryService`：素材中心检索、分页、标签、引用详情和批量操作。
- Product/Template/Compliance/AI 领域：只能创建/读取规范 Reference，不拥有底层对象删除权。
- Browser：负责选择文件、可选本地预览和直传；不决定资产可信状态、跨店权限或 SHEIN 上传成功。

### 07.4 目标拓扑

```text
Browser / Embedded Picker / Material Center
  -> POST UploadSession
  -> presigned PUT -> Private Object Storage
  -> POST Complete
  -> Integrity Verifier
  -> MediaAsset ready

Crop / Compress / Watermark Command
  -> MediaProcessingJob
  -> Private Object Storage
  -> MediaVariant ready

Draft / ProductVersion / Template / Compliance
  -> MediaReference transaction

Publish Worker
  -> MediaReference + Variant
  -> SHEIN upload endpoint
  -> PlatformMediaReceipt
  -> immutable ProductVersion / PublishAttempt evidence

Retention Worker
  -> references + holds + policy
  -> recycle bin
  -> object tombstone/delete
  -> MediaDeletionEvent
```

PostgreSQL 保存元数据、关系、回执和审计；对象存储保存字节；Redis/BullMQ 只负责任务传输，不是媒体所有权真相。

### 07.5 目标领域模型

| 对象 | 唯一职责 | 关键字段 |
| --- | --- | --- |
| MediaUploadSession | 一次可过期上传意图 | tenant/store/user、expected bytes/type/checksum、object key、expiresAt、state |
| MediaAsset | 不可变原始内容与安全元数据 | assetId、tenantId、scope、sha256、mime、bytes、dimensions、provider/bucket/key、integrityState |
| MediaVariant | 由一个资产派生的不可变内容 | variantId、assetId、parentVariantId、kind、transformSpec/version、sha256、dimensions、object key |
| MediaReference | 业务对象对资产/变体的有序用途引用 | ownerType/ownerId/ownerVersion、role、slot、sortKey、provenance、createdBy |
| MediaShareGrant | 同租户内跨店/成员复用授权 | assetId、sourceScope、targetScope、capability、expires/revokedAt |
| PlatformMediaReceipt | 平台上传/绑定证据 | storeId、variantId、platform、imageType、URL/MD5、traceId、contractVersion、state、observedAt |
| MediaRetentionHold | 阻止回收的显式依据 | asset/variant、holdType、ownerId、reason、releaseAt |
| MediaDeletionEvent | 回收与对象删除审计 | target、from/to state、reason、object result、operationId、occurredAt |

`MediaAsset`、`MediaVariant` 和 `PlatformMediaReceipt` 都不可原地改写内容。替换图片意味着创建新资产/变体并修改未来 Draft Reference，不覆盖历史版本证据。

### 07.6 素材身份与内容寻址

1. 资产 ID 是系统身份，SHA-256 是内容身份，原文件名只用于展示。
2. 完成上传前状态为 `uploading/verifying`，只有服务端完整性验证通过才是 `ready`。
3. Asset 内容、provider/bucket/objectKey、hash、bytes 和 MIME 一旦 ready 后不可修改。
4. 同一 tenant 内相同可信 hash 可建议复用已有 Asset；是否复用还要校验 scope、保留类别和敏感等级。
5. 不做跨 tenant 逻辑去重或可见性共享；底层存储即使未来物理去重，也不能暴露存在性、hash、URL 或元数据。
6. 同 hash 但 MIME/bytes/解码结果冲突时 fail closed，进入 integrity conflict。
7. 文件名、目录名、图片 OCR 文本和 SHEIN URL 都不能作为资产身份。

### 07.7 作用域与共享

资产作用域固定为：

- `tenant_shared`：租户素材库，经权限允许可被多个店铺引用。
- `store_private`：仅来源店铺可用，商品图片默认采用该范围。
- `user_private`：个人创作中间件，未显式入库前仅创建者可见。
- `compliance_locked`：店铺和合规对象双重锁定，禁止普通跨店复用。

跨店复用必须通过 `MediaShareGrant` 或明确的 tenant_shared 资产；不能仅凭知道 assetId、对象 URL、模板 ID 或相同 hash 读取。跨店复制默认创建新的 Reference，不复制字节；合规证据、报告和平台回执默认不可跨店。

### 07.8 上传会话与状态机

```text
created -> uploading -> uploaded -> verifying -> ready
                    \-> expired
                    \-> failed
ready -> quarantined（安全问题）
ready -> recycle_pending -> deleted（仅无引用/无 hold）
```

要求：

1. `POST upload-sessions` 只创建短期、单用途、单对象上传会话。
2. 预签名 URL 绑定 objectKey、Content-Type、大小/校验头和 5～10 分钟有效期。
3. 直传失败只影响该文件，可安全重新创建会话，不复用不确定会话。
4. Complete 幂等；重复 complete 返回原 Asset 状态，不创建第二个资产。
5. `ready` 前不能创建业务 Reference、进入模板、AI、预检或 SHEIN 上传。
6. 页面关闭不取消已提交字节；未完成会话由超时清理，不显示成可用素材。
7. 普通商品图优先简单预签名 PUT；只有真实超大文件/弱网指标证明需要时才引入 multipart/tus。

### 07.9 完整性、安全与文件检查

1. 客户端 hash 只用于上传体验和早期去重提示，不是最终可信证据。
2. 对象存储支持 checksum header 时，将 checksum 纳入预签名；否则由受控 Verifier 流式读取并计算服务端 SHA-256。
3. 服务端验证实际字节数、MIME sniff、解码尺寸、像素上限、文件头和允许格式，不只信扩展名/Content-Type。
4. 图片防止解压炸弹、超大像素、伪装 PDF/图片和畸形元数据；证书文件使用独立规则。
5. EXIF/GPS 等敏感元数据是否剥离由变体策略决定，原始文件仍受严格权限保护。
6. 可疑文件进入 `quarantined`，不向浏览器下发内容票据，不进入任何发布候选。
7. 完整性校验产生 verifierVersion 和 operationId，便于规则升级后重检。

### 07.10 MediaVariant 与派生链

固定变体类型：

- `original`：原始可信字节。
- `preview` / `thumbnail`：页面浏览用途。
- `cropped`：用户确认裁剪结果。
- `resized` / `compressed`：满足页面或 SHEIN 限制的结果。
- `watermarked`：有明确水印模板和变换版本。
- `normalized`：颜色空间、方向和元数据标准化。

每个 Variant 保存 `parentVariantId + transformSpec + transformEngineVersion + output hash`。相同输入和相同变换指纹可幂等复用；不同参数必须生成新 Variant。预览缩略图不能被误用为 SHEIN 发布原图。

### 07.11 业务用途字典

业务用途属于 `MediaReference.role`，不属于 Asset 本体。第一阶段固定：

| 领域 | Role |
| --- | --- |
| 商品图库 | `product_gallery_main`、`product_gallery_detail`、`product_square`、`product_swatch`、`site_detail` |
| SKU | `sku_preview`、`sku_swatch` |
| 模板 | `tail_template_item`、`product_template_media` |
| 合规 | `compliance_body_photo`、`compliance_package_photo`、`certificate_file`、`report_file`、`agency_evidence` |
| AI | `ai_input`、`ai_reference`、`ai_output_unselected`、`ai_output_selected` |
| 系统 | `thumbnail`、`diagnostic_attachment` |

SHEIN `image_type` 是平台契约字段，由 Platform Adapter 根据 role、类目规则和目标层级映射，不能直接写入 Asset purpose。未知 role 或未知 image type 必须在预检阻断。

### 07.12 MediaReference 规则

1. Reference 必须包含 tenant、业务 owner、owner version、role、slot 和稳定排序键。
2. 同一 owner/version/role/slot 的唯一性由数据库约束保证。
3. 排序使用稀疏 sortKey 或原子重排 command，不按 React 数组位置作为长期身份。
4. provenance 记录 manual_upload、folder_import、template、copy_from_version、AI、batch_patch 等来源。
5. 修改 Draft 图片只变更 Draft Reference；不能影响 Template、ProductVersion、Compliance 或其他 Draft。
6. 删除 Reference 与删除 Asset 是两个动作。普通页面只能解除自己 owner 的引用。
7. Reference 创建、删除、重排和替换都写追加式 MediaReferenceEvent。

### 07.13 Draft、ProductVersion 与发布所有权

1. mutable Draft 拥有可变 Draft References。
2. handoff 时在同一事务内为 immutable ProductVersion 复制并冻结 VersionMedia References，包括 role、slot、顺序、variant、规则版本和 hash。
3. 只有 Version References 全部建立并通过断言后，才能释放 Draft References。
4. PublishCommand/Attempt 只读取 ProductVersion References，不从当前 Draft 或模板现场重组图片。
5. 重发若图片变化，必须创建新 Draft revision、ProductVersion 和 Attempt；旧版本素材永久保持原证据。
6. 已通过/已上架商品的媒体证据按商业与审计政策保留，不能因草稿箱清理而删除。
7. 历史 ProductVersion 必须能还原“当时使用哪张图、哪个变体、哪个顺序、哪个 SHEIN image type 和回执”。

### 07.14 SHEIN PlatformMediaReceipt

平台回执键至少包含：

```text
tenantId + storeId + variantHash + imageType + adapterContractVersion
```

规则：

1. 只有 Publish/Media Worker 可以调用 SHEIN 图片上传接口，Browser 和 Control 路由不得旁路直写。
2. 保存 image URL、MD5（接口返回时）、traceId、原始响应摘要、imageType、contractVersion、createdAt 和 validity state。
3. 相同资产作为不同 imageType 使用时不能错误复用回执。
4. 跨店不复用 SHEIN 回执；同店复用也必须检查合同版本、URL/回执有效性和平台限制。
5. HTTP 成功但缺少当前接口要求的 URL/MD5/标识时进入 `result_unknown`，不能写 success。
6. 平台 URL 不是本地素材 URL，不写回 Asset，不作为长期资产身份。
7. ProductVersion/Attempt 通过 receiptId 留证；发布候选 JSON 只是缓存，不是唯一账本。

### 07.15 素材中心产品设计

建立独立“素材中心”，但不强迫用户离开业务页面。素材中心负责治理，各页面保留嵌入式 Picker。

素材中心第一阶段提供：

1. 当前店铺/租户素材分区、搜索、来源、类型、尺寸、创建者、标签和时间筛选。
2. 稳定游标分页、批量选择、引用次数和“被哪些对象使用”详情。
3. 原图/变体预览、尺寸/大小/hash 摘要、上传与处理状态。
4. 上传队列、失败单项重试、取消未开始项和完成结果。
5. 加入素材库、移动到回收站、恢复和安全永久删除资格说明。
6. 店铺私有、租户共享、个人创作、合规锁定的显式标签。
7. 重复内容提示和安全复用，不自动替换已有业务引用。
8. 权限不足、过期票据、对象缺失、处理中、隔离和部分失败的独立状态。

不在素材中心直接修改已冻结 ProductVersion 或已发布商品。用户必须回到商品编辑/修正流程创建新版本。

### 07.16 嵌入式 Picker 与商品编辑体验

1. 商品编辑器、批量建品、模板和合规使用同一个 MediaPicker/UploadQueue 契约。
2. Picker 只返回 assetId/variantId，业务页面再创建带 role/slot 的 Reference command。
3. 支持上传、本店素材、租户共享素材和最近使用；合规模块只显示合规允许范围。
4. 每张图片显示用途、顺序、尺寸、处理状态和错误，不只显示缩略图。
5. 替换先展示 diff；提交后只替换目标 slot，可撤销，其他用途不受影响。
6. 拖拽排序使用键盘可访问的 dnd-kit/等价能力，并有上移/下移按钮 fallback。
7. 大图预览按需加载短时 URL；离开视口释放 object URL，不把原字节放进 React Query。
8. 未完成上传、处理中或隔离的图片不能让保存流程假成功；安全 Draft 保存可记录待处理意图，但 handoff 必须阻断。

### 07.17 批量上传、文件夹导入与失败隔离

1. 批量导入先解析为 manifest，用户确认商品分组和用途后才上传/建 Draft Reference。
2. 文件名、目录名和 OCR 只产生 suggestion；歧义必须逐项确认，不猜第一张。
3. 上传使用全局有界并发和每文件状态，单项失败不清空已成功 Asset。
4. 重复文件按 hash 提示复用；用户可选择复用、保留独立业务引用或跳过。
5. 导入 operation 保存 itemId、assetId、目标 Draft、role、结果和错误，刷新页面后可恢复进度。
6. 取消只取消未开始/未完成上传，不删除已经被其他对象引用的 Asset。
7. 15/50/100/500 张图片必须有 CPU、内存、网络和对象存储请求预算。

### 07.18 裁剪、压缩、水印与性能

1. 裁剪结果是新 Variant；不覆盖 original。
2. 小型交互裁剪可在浏览器 Worker 中完成；批量或高成本处理交给服务端 MediaProcessingJob。
3. 处理过程不阻塞输入主线程，不把多张原图同时解码驻留内存。
4. 每种目标规则保存明确尺寸、比例、格式、质量和 engineVersion。
5. 主图水印只生成发布 Variant，原图和其他用途不受影响。
6. 已生成 Variant 按变换指纹复用；失败不缓存成成功，可单项重试。
7. 页面只加载合适尺寸的 preview/thumbnail，不用 10MB 原图渲染列表。

### 07.19 合规媒体特殊边界

1. 商品本体图、包装图、证书、检测报告和代理资料使用不同 role、MIME、大小、尺寸和保留规则。
2. 合规媒体默认 store-private/compliance-locked，不能因同 hash、模板或素材中心选择跨店复用。
3. 1630/1631 等每商品报告不进入通用图片模板。
4. SHEIN 合规图片上传回执与普通商品图片回执分表或用 receiptKind 严格区分。
5. 合规 preflight/audit run 创建 RetentionHold；历史审计、审核和争议期结束前不得回收。
6. 本体图与包装图的 label group/slot 不得互换；Reference role 是服务端最终判断输入。
7. 平台不支持的证书/标识符仍走人工流程，不能通过上传一个 Asset 伪装已完成。

### 07.20 AI 与创作素材隔离

1. AI 输入、参考图、未选结果和已选结果使用不同 role/status，不与商品已发布证据混用。
2. Provider 只能读取当前 operation 明确授权的短时对象，不取得长期 bucket 权限。
3. AI 输出先进入 user-private/temporary，用户明确选择后才创建业务 Reference。
4. AI 失败、超时或删除中间结果不影响原始 Asset、人工编辑或普通发布。
5. AI 缓存键包含 tenant/store/variantHash/provider/model/promptVersion，跨租户绝不命中。
6. 中间素材保留期可以短，但被 ProductVersion、Template 或合规引用后必须由新 hold/reference 保护。

### 07.21 保留、回收站与物理删除

保留决策不能只看 `purpose` 或缓存 `reference_count`。删除资格由以下事实共同决定：

```text
不存在有效 MediaReference
AND 不存在 MediaRetentionHold
AND 不存在进行中的 Upload/Processing/Publish/Compliance operation
AND 已超过对应 retention policy
AND 已经过 recycle grace period
```

规则：

1. `reference_count` 只作投影/指标，删除前必须用引用表和 hold 做事务性反查。
2. 普通“删除素材”先进入回收站，不立刻删除对象；显示受保护原因和最早可删时间。
3. ProductVersion、PlatformReceipt、合规审计、法律保留和争议资料建立显式 hold。
4. 对象删除采用 claim/tombstone；404 视为幂等已删除，其他失败释放 claim 并重试。
5. 对象删除成功后保留最小 metadata/tombstone/DeletionEvent，不物理抹掉审计关系。
6. 孤儿对象与孤儿数据库行使用独立只读扫描和 dry-run，不以目录遍历结果直接删除。
7. 保留策略版本化；策略变化只影响未来资格计算，不直接批量删历史对象。
8. `reusable_source`、published evidence、AI temporary、thumbnail 和 compliance 必须有互不冲突的唯一政策定义。

### 07.22 配额与容量治理

1. 配额分别统计 tenant logical bytes、store logical bytes、physical bytes、asset count、variant count 和 pending upload。
2. 同内容复用不重复计算 physical bytes，但业务配额是否计费按明确政策展示。
3. 上传申请预占额度，完成/失败/过期后结算，避免并发超额。
4. 配额达到 80/90/100% 分级提醒；100% 阻断新增，不阻断读取、下载或删除。
5. 回收站、受 hold 保护和可立即释放空间分别展示，不能承诺删除后立刻释放。
6. 对象存储账单、出网、SHEIN 重复上传率和缩略图命中率进入运营指标。

### 07.23 安全、授权与隐私

1. 所有 Asset/Variant/Reference/Receipt API 强制 tenant/user/store/capability。
2. 预签名 URL 最短有效、单对象、单方法、HTTPS；不在日志、错误、审计或 Query Cache 保存完整 URL。
3. 下载/预览票据不得因 Referer、assetId 猜测或模板可见性绕过 store 权限。
4. Object key 不含用户文件名、商品标题、SKC、邮箱或其他敏感业务信息。
5. SVG、HTML 和可执行内容默认不作为商品图片上传；PDF 只走合规证据规则。
6. 服务端日志记录 assetId/operationId/bytes/type/result，不记录图片字节或完整平台 URL。
7. 跨店共享、回收、恢复、永久删除和下载原图写审计事件。

### 07.24 可观测性与 SLO

关键关联 ID：

```text
uploadOperationId -> uploadSessionId -> assetId -> variantId
-> referenceId -> productVersionId -> publishAttemptId
-> platformReceiptId -> SHEIN traceId
```

最低指标：

- upload ticket/PUT/complete/verify 各阶段成功率与 p50/p95/p99。
- 上传中断、过期会话、完整性冲突、隔离文件和重复内容命中率。
- Variant 队列等待、处理耗时、失败率、缓存命中和输出字节。
- Asset/Variant/Reference/hold 数、孤儿候选、回收站、删除失败和最老待删年龄。
- SHEIN 图片上传按 imageType 的成功、复用、unknown、trace 缺失和平均延迟。
- 列表缩略图流量、原图误加载、浏览器内存和上传队列并发。

SLO 数值由 ERP-19 在 2 核 4GB 和目标对象存储环境压测后定稿，不能凭感觉写死。

### 07.25 数据迁移与兼容

1. 先只读盘点 `media_assets`、references、Draft JSON、Template JSON、Publish 候选/回执和对象存储。
2. 将历史行分类为 verified、unverified_hash、missing_object、orphan_object、referenced_unknown_role、retention_conflict、platform_receipt_embedded。
3. 新表/列仅 additive；旧 purpose/status 通过 adapter 映射，不改已执行迁移。
4. 先影子生成新 Reference role/order/ownerVersion，对照旧 payload，不直接切写 owner。
5. ProductVersion 媒体证据无法证明时标 legacy_unversioned，不伪造 hash/variant/receipt。
6. 迁移前冻结清理 Worker 或让其只报告，避免盘点期间删除候选证据。
7. `reusable_source` 冲突策略先出 dry-run 影响报告，明确保留后再迁移 expiresAt/hold。
8. 只有新旧引用数量、对象存在、hash、角色、顺序和发布 payload 对账后才切换读写。
9. 旧专项媒体可见路由、Draft 内嵌数组和缓存回执待两个稳定 release 后才退役。

#### COS-first 历史边界（2026-08-29 用户批准）

1. 新系统以 COS 作为媒体文件本体的唯一主存储；PostgreSQL 只保存 Asset 元数据、hash/完整性、业务引用、版本所有权、保留策略和审计事件。
2. 当前已核验的 633 个 COS 对象作为可复用远端资产；187 条没有远端对象且没有业务引用的历史 `media_assets` 记录冻结为只读 legacy，不迁移、不恢复、不删除、不自动重试。
3. 历史 ProductVersion/PublishAttempt/PlatformProductLink 映射不作为新媒体链路的前置条件；无法安全映射的旧记录必须保持 `legacy_unversioned`/`UNKNOWN`，不得伪造新身份。
4. 新上传必须先完成 COS 直传、服务端完整性核验和对象存在性确认，再登记数据库元数据与引用；任何只写数据库不写 COS 的路径都不得进入新链路。
5. 该边界不授权清理旧表、修改旧状态、删除对象或跳过新模型的版本/引用/审计设计；历史处置如未来需要，另行走 ERP-20/ERP-23 的批准流程。

### 07.26 分步实施顺序

| 编号 | 交付 | 核心内容 | 承接 ERP |
| --- | --- | --- | --- |
| MEDIA-01 | 媒体事实基线 | DB/对象/引用/迁移/路由/页面/清理 Worker 全图 | ERP-00、ERP-05 |
| MEDIA-02 | 角色与保留字典 | role、scope、retention、hold、SHEIN imageType 映射 | ERP-04、ERP-07 |
| MEDIA-03 | 失败回归地基 | 清理 SQL、Draft 释放、跨店读取、hash 验证、批量内存 | ERP-03、ERP-19 |
| MEDIA-04 | MediaAsset 契约 | immutable identity、integrityState、scope 和内容 hash | ERP-06 |
| MEDIA-05 | UploadSession | 预占配额、短时票据、幂等 complete、过期与恢复 | ERP-06、ERP-15 |
| MEDIA-06 | Integrity Verifier | checksum/MIME sniff/尺寸/像素/隔离与 verifierVersion | ERP-15、ERP-19 |
| MEDIA-07 | MediaVariant | transform spec/version、派生对象和幂等处理 Job | ERP-06、ERP-15 |
| MEDIA-08 | MediaReference | ownerVersion、role、slot、order、provenance 和事件 | ERP-06、ERP-14 |
| MEDIA-09 | VersionMedia handoff | 同事务冻结 Version 引用后释放 Draft 引用 | ERP-09、ERP-12 |
| MEDIA-10 | PlatformMediaReceipt | store/imageType/variant/contractVersion/trace 账本 | ERP-06、ERP-07、ERP-09 |
| MEDIA-11 | 共享授权 | tenant/store/user/compliance scope 与 ShareGrant | ERP-06、ERP-17 |
| MEDIA-12 | 素材中心 API | 游标分页、搜索、标签、引用详情、回收站和资格 | ERP-11、ERP-15 |
| MEDIA-13 | 统一 UploadQueue/Picker | 嵌入式上传、选择、进度、错误、取消和恢复 | ERP-13、ERP-14、ERP-15 |
| MEDIA-14 | 商品与模板迁移 | main/detail/SKU/tail/site-detail 统一 Reference | ERP-14、ERP-15 |
| MEDIA-15 | 合规媒体迁移 | body/package/certificate/report 独立 role/hold/receipt | ERP-16 |
| MEDIA-16 | AI 隔离 | input/reference/output 作用域、保留和可选能力降级 | ERP-15 |
| MEDIA-17 | Retention Worker v2 | policy/hold/recycle/tombstone/DeletionEvent 和恢复 | ERP-15、ERP-19 |
| MEDIA-18 | 历史媒体 dry-run | legacy role、missing/orphan、冲突保留和平台回执提取 | ERP-20 |
| MEDIA-19 | 规模与故障验收 | 15/50/100/500 图、断网、对象故障、Worker 重启 | ERP-19、ERP-21 |
| MEDIA-20 | 金丝雀与旧路径退役 | 单店影子、发布证据核对、零引用证明与清理 | ERP-22、ERP-23 |

MEDIA-01 至 MEDIA-10 是 P0 地基。未完成前不得继续通过修改 Draft JSON、延长临时保留期或新增页面级图片缓存掩盖所有权问题。

### 07.27 验收标准

#### 资产与完整性

- 相同文件上传、重复 complete 和网络重放不会创建不受控重复资产。
- 只有服务端验证 hash/MIME/bytes/dimensions 后 Asset 才能 ready。
- Asset 和 Variant 内容不可变，任何裁剪/水印/替换均产生可追溯新对象。
- 跨 tenant/store/user 的负向访问全部拒绝且不泄露资产是否存在。

#### 商品链路

- Draft handoff 后 VersionMedia 100% 还原 role、slot、顺序、variant 和 hash。
- Draft 引用释放不会删除 ProductVersion、Template、Compliance 或其他 Draft 正在使用的素材。
- Publish Worker 只从 ProductVersion Reference 生成图片 payload。
- 每个 SHEIN 图片 URL/MD5/imageType/traceId 可追溯到 PlatformMediaReceipt 和 Variant。

#### 用户体验与性能

- 单图和 15/50/100/500 图上传逐项显示进度/失败，刷新后可恢复结果。
- 单项失败不清空成功项；重试不重复创建业务引用。
- 图片列表加载 thumbnail，不把原图字节放入 React State/Query Cache/Draft JSON。
- 1280px、窄屏、键盘排序和大图预览无冻结、无页面级横向溢出。

#### 生命周期

- referenced/held/active operation 的对象在任何清理故障注入下都不会被删除。
- 无引用对象按唯一政策进入回收站、可恢复、到期后幂等删除并留审计。
- `reusable_source` 保留策略只有一个权威定义，不再互相矛盾。
- 清理 Worker SQL、重启、对象 404/5xx、数据库失败和重复执行均有确定结果。

#### 合规与安全

- 本体、包装、证书、报告和普通商品图不能串槽或跨店复用。
- 预签名 URL 过期、越权、方法错误和 object key 猜测全部失败。
- 日志、错误、快照和浏览器缓存不出现密钥、完整签名 URL 或图片字节。
- AI/处理/对象存储失败不阻断人工编辑和已有安全草稿读取。

### 07.28 已确认决策

1. 建立独立素材中心，同时在商品、模板、合规和 AI 页面提供统一嵌入式 Picker。
2. MediaAsset 表示不可变原始内容；业务用途、顺序和所有权放在 MediaReference。
3. 裁剪、压缩、水印和缩略图是不可变 MediaVariant，不覆盖原图。
4. 浏览器使用预签名 URL 直传对象存储，API 不转发上传字节。
5. 客户端 hash 不是最终证据；服务端/对象存储必须完成可信完整性验证。
6. 不进行跨 tenant 去重或共享；同 tenant 复用仍需 scope/capability。
7. 商品图默认 store-private，合规证据默认 compliance-locked。
8. Draft handoff 必须先原子冻结 VersionMedia，再释放 Draft Reference。
9. Publish Worker 只读取 ProductVersion 媒体，不从 mutable Draft 或当前模板现场组装。
10. SHEIN 上传结果进入 store-scoped PlatformMediaReceipt，不能只留在候选 JSON。
11. Receipt 复用键包含 variantHash、imageType 和 adapter contract version。
12. 业务 role 与 SHEIN imageType 分离，由服务端适配器映射。
13. Reference/hold 是删除安全真相，reference_count 只作投影。
14. 普通删除进入回收站；物理对象删除保留 tombstone 和追加式事件。
15. published ProductVersion、官方回执和合规审计建立显式保留 hold。
16. 普通商品图先用简单预签名 PUT；没有容量证据不引入 tus/multipart 新复杂度。
17. 原图字节不进入 Draft JSON、React State 或 TanStack Query Cache。
18. AI 与媒体处理是可选派生能力，失败不改变原始素材和人工流程。
19. 跨店模板素材通过规范 ShareGrant/Reference 访问，不保留专项旁路。
20. 历史媒体只做证据驱动迁移，unknown/missing/conflict 不伪造为完整资产。
21. 经用户批准采用 COS-first：新媒体以 COS 为文件主存储，数据库保留元数据与业务引用；历史媒体映射冻结为只读 legacy，不阻断新链路。

### 07.29 明确不做及后续讨论项

本板块明确不做：

- 不把对象存储改成公开 bucket，不使用永久公共 URL。
- 不把图片字节或 Base64 写进 PostgreSQL、草稿、模板或浏览器服务器缓存。
- 不因 hash 相同跨租户、跨合规范围自动共享。
- 不在素材中心原地修改已冻结 ProductVersion 或 SHEIN 官方商品。
- 不先引入独立 DAM 商业产品、CDN 图片处理平台、tus 或复杂工作流引擎。
- 不在本板块设计 AI 标题提示词、模型选择或计费逻辑。
- 不直接清理历史对象、重写已执行迁移或运行生产 Media Worker。

后续实施前仍需定稿：

1. SHEIN 各 imageType 的真实尺寸、数量、格式、URL/MD5 和回执有效性 fixture。
2. tenant_shared、store_private、user_private 的默认创建入口和管理员共享权限。
3. published evidence、合规、AI 中间件和回收站的正式保留年限。
4. checksum 能力由当前 COS/S3 兼容实现直接提供，还是需要异步 Verifier 流式读取。
5. 素材标签第一阶段只用手工标签，还是允许从商品/目录自动派生只读标签。
6. 物理去重、逻辑配额和计费展示的具体口径。
7. 大文件 multipart/tus 的触发指标和是否确有业务需求。
8. 原图 EXIF/GPS 的保留、剥离和下载权限政策。

---

## 板块 08：标题规则、AI 标题、视觉识别与批量生成调度

讨论日期：2026-08-29  
方案状态：方向已确认，待正式实施步骤补充 Provider fixture、容量预算与迁移设计  
关联执行步骤：ERP-03、ERP-04、ERP-06、ERP-07、ERP-08、ERP-12、ERP-13、ERP-14、ERP-15、ERP-18、ERP-19、ERP-21、ERP-22、ERP-23  
关联问题：BUG-AI-001 至 BUG-AI-016

### 08.1 总体结论

AI 标题必须从“编辑页里的同步按钮”升级为一个**可选、可恢复、可审计、可控成本的标题辅助域**，但绝不能成为草稿保存、服务端预检、ProductVersion handoff 或 SHEIN 发布的必经依赖。

目标不是让模型直接替用户写入一个标题，而是建立四层明确边界：

1. **A0 确定性标题规则**：即使所有 AI Provider 不可用，人工标题仍能被规范化、校验、保存和发布。
2. **A1 单商品候选**：AI 只基于获准图片和商品事实生成 2～3 个候选，不直接覆盖字段。
3. **A2 图片复用与性能**：以不可变 `variantHash` 复用视觉识别，避免同图重复取图、Base64 编码和计费。
4. **A3 持久批量调度**：批量任务由服务端 durable operation/queue 推进，刷新、断线或进程重启后仍可恢复逐项结果。

标题是否合法由版本化 `TitlePolicyEngine` 决定，不由模型自评；标题是否采用由用户决定，不由系统自动接受。AI 失败只能影响本次建议，不能把普通编辑、保存或发布降级为不可用。

### 08.2 当前源码事实基线

当前已有可复用基础：

1. `tenant_ai_title_settings` 按 tenant 保存 Provider URL、模型和 AES-256-GCM 加密密钥；普通成员需 `ai_feature_grants`，Owner/Admin 可配置。
2. API URL 当前要求 HTTPS、无账号信息和控制字符，密钥不返回浏览器；服务端具有 `traceId`、阶段、取图/排队/Provider 耗时诊断。
3. 单进程内 Provider 并发、等待队列、结果缓存和图片字节缓存均有硬上限；错误不写成功缓存，设置变化会清结果缓存。
4. 相同请求有 in-flight 去重；图片读取按 tenant/store/asset 隔离，当前默认最多 2 个 Provider 并发。
5. 当前 Provider 提示词只要求识别地毯图案，不允许猜材质、尺寸、功能、品牌或营销词，方向正确。
6. 服务端实际返回 `patternName/confidence/warning`，完整标题由前端 `composeAiTitle` 使用标题规则重新拼接；当前缓存不会直接保存完整标题。
7. 标题模板支持 fullTitle/prefix/keywords/suffix，单品和批量页面可以引用模板并调用 AI。
8. 批量页当前由浏览器创建 2 个 Worker 循环逐项上传主图并调用同步 suggest API；进度只存在当前 React 页面。
9. 已有测试覆盖授权、密钥隐藏、Provider 失败 Trace、缓存命中/失效、图片缓存隔离、队列上限和部分 UI 入口。

当前结构性缺口：

1. Queue、in-flight、结果与图片缓存都在一个 Control 进程内存中；重启即丢，多副本各自拥有不同队列和缓存。
2. 没有持久化 `TitleGenerationRequest`、`AIGenerationAttempt`、批次逐项结果、候选、采用决定和用量账本。
3. 同步 HTTP 请求把 Provider 延迟直接传给页面；批量浏览器断线、刷新、切店或关闭页面后无法恢复。
4. 当前识别缓存键依赖可变 `assetId` 和请求字段，但没有 `variantHash/provider/model/promptVersion/outputSchemaVersion`；配置变更只能靠本进程 epoch 清理。
5. 识别缓存与最终标题组合缓存没有显式分层，未来扩展时容易错误复用；`currentTitle` 可以不属于识别缓存，但若缓存完整候选则必须进入键。
6. Provider URL 只做语法 HTTPS 检查，未形成批准域名、DNS/IP 私网阻断、重定向限制和出站网络政策，存在 SSRF/误配风险。
7. Provider 调用直接写在业务服务中，只兼容一类 OpenAI-style payload；缺少 Adapter 契约、健康状态、熔断、版本和受控切换。
8. Prompt 和返回 JSON schema 是代码内常量，结果没有保存 prompt/model/schema/policy 版本，无法准确重现历史建议。
9. 图片字节在服务端读入内存后 Base64 填入 JSON；批量并发会产生额外内存和复制开销。
10. 当前只得到一个图案名和一个拼接标题，没有多个候选、确定性评分、用户采用/编辑/拒绝记录。
11. `composeAiTitle` 只是 prefix + pattern + keywords/suffix 并按字符 `slice`，可能截断词组，且没有违禁词、事实一致性、重复词、语言、标点、关键词覆盖或虚假宣传检查。
12. `fullTitle` 和其他模板段仍是自由文本；没有版本化适用类目、字段来源和 TitlePolicy fingerprint。
13. Provider 配置为 tenant 单行可变设置，没有配置版本、审批/回滚、健康探测、预算、每日限额和变更审计账本。
14. 超时发生在请求已经发给 Provider 之后时，无法确认是否已计费；当前没有 `cost_unknown` 和禁止盲重试边界。
15. AI 结果被页面直接写进当前标题字段，缺少候选预览、差异确认、撤销和独立 Draft revision/provenance。

### 08.3 责任边界

- `TitlePolicyService`：版本化确定性规则、错误码、规范化、候选校验和评分。
- `TitleTemplateService`：模板身份、不可变版本、适用范围、片段 provenance 与 schema compatibility。
- `TitleGenerationService`：创建单项/批量请求、冻结输入快照、查询 operation，不直接调用 Provider。
- `AITitleScheduler/Worker`：公平调度、有界并发、lease、attempt、超时、取消和逐项结果。
- `AIProviderAdapter`：Provider 请求/响应契约、鉴权、网络策略、错误分类和用量提取。
- `VisualRecognitionService`：基于受控媒体 Variant 识别图案，并维护独立识别缓存。
- `TitleCandidateService`：规范化、确定性验证、排序、候选账本和用户决定。
- Product Workbench：提供事实快照、展示候选、由用户确认写入 Draft revision；不拥有 Provider 调度。
- Publish/Preflight：只读取已保存标题并执行确定性校验；不等待 AI、不自动触发 AI。
- Browser：只创建请求、订阅/刷新 operation、选择候选；不保留唯一任务真相，不直接调用第三方 Provider。

### 08.4 目标拓扑

```text
ProductDraft + TitleRuleTemplateVersion + TitlePolicyVersion
  + ProductFactSnapshot + MediaVariant(variantHash)
          |
          v
POST TitleGenerationRequest / Batch
  -> PostgreSQL request + item + event + outbox (same transaction)
  -> AI Outbox Dispatcher
  -> BullMQ jobId=requestItemId
  -> Fair AITitleScheduler / Worker
  -> AIProviderAdapter -> approved Provider
  -> AIGenerationAttempt + UsageEvent
  -> VisualRecognitionResult
  -> deterministic TitlePolicyEngine
  -> TitleCandidate[] + validation/rank
  -> Operation Snapshot / short-lived SSE
  -> user select/edit/reject
  -> new ProductDraft revision + TitleDecision/provenance

Manual title path
  -> TitlePolicyEngine -> Draft save/preflight/handoff
  (does not depend on AI queue, Redis or Provider)
```

PostgreSQL 保存请求、输入快照、attempt、候选、决定、用量和事件；BullMQ 只负责投递；Redis/SSE 只优化反馈；对象存储/MediaVariant 提供受控图片。任何一层缓存或实时通道丢失都不能丢候选账本或改变 Draft。

### 08.5 目标领域模型

| 对象 | 唯一职责 | 关键字段 |
| --- | --- | --- |
| TitlePolicyVersion | 一组不可变确定性标题规则 | scope、locale/category、length、required/prohibited、normalizerVersion、fingerprint、state |
| TitleRuleTemplateVersion | 不可变标题模板片段 | templateId/version、scope、applicable schema/category、segments、fingerprint |
| TitleInputSnapshot | 一次生成的可信输入 | tenant/store/user、draft/revision、category/attributes、locale、currentTitle、template/policy version、variantId/hash |
| TitleGenerationBatch | 一次批量用户意图 | batchId、idempotencyKey、requestedCount、state、createdBy、counts |
| TitleGenerationRequest | 单商品生成请求 | requestId、batchId、inputSnapshotId、state、deadline、cancel state、currentAttemptId |
| AIGenerationAttempt | 一次 Provider 调用证据 | attemptId、providerProfileVersion、model、prompt/schema version、send boundary、response class、usage/cost、trace |
| VisualRecognitionResult | 图片识别的规范结果 | variantHash、pattern、confidence、warning、provider/prompt version、validity |
| TitleCandidate | 一个不可变候选 | candidateId、requestId、text、source、rank、validation codes、score breakdown |
| TitleDecision | 用户采用、编辑或拒绝决定 | candidateId、decision、finalText、draftRevisionId、actor、reason、occurredAt |
| AIProviderProfileVersion | 不可变 Provider 配置版本 | adapter、endpoint policy、model、secretRef、timeout、limits、state、createdBy |
| AIUsageEvent | 用量与成本事实 | tenant/store/user/request/attempt、tokens/images、provider cost/currency、estimate/actual/unknown |

Request、Attempt、Candidate 和 Decision 都追加式保存。Draft 只保存用户最终确认的标题及 provenance 摘要，不内嵌 Provider 原始响应或图片字节。

### 08.6 A0～A3 能力分层

| 层级 | 能力 | 是否依赖 AI | 完成标准 |
| --- | --- | --- | --- |
| A0 | 手工标题、模板应用、规范化、确定性校验、diff/undo | 否 | Provider/Redis 全停仍可编辑、保存、预检、handoff |
| A1 | 单商品 2～3 个可解释候选 | 是 | 输入冻结、候选不自动写入、失败可人工继续 |
| A2 | 不可变图片复用、识别缓存、缩略输入、性能预算 | 是 | 相同 variant/prompt/model 精确复用，跨店/变更不误命中 |
| A3 | 批量 operation、服务端调度、逐项恢复、预算和公平性 | 是 | 刷新/断线/重启后继续，单项失败不清空成功项 |

上线顺序严格 A0 → A1 → A2 → A3。不能以批量“快”为理由跳过确定性规则、输入快照和持久 attempt。

### 08.7 确定性 TitlePolicyEngine

TitlePolicyEngine 是标题合法性的唯一 owner，至少包含：

1. Unicode/空白/不可见字符/控制字符规范化。
2. SHEIN 当前标题最小/最大长度和 locale 规则，长度以明确的 code point/平台口径实现。
3. 必填片段、类目词和允许关键词覆盖；模板片段按优先级保留。
4. 禁止品牌、平台禁词、夸大宣传、绝对化用语、材质/功能/尺寸等无事实来源声明。
5. 商品类目、结构化属性、SKU 范围和标题事实一致性。
6. 重复词、连续标点、异常符号、大小写、语言混杂和低信息密度检查。
7. 可选店内近重复标题提醒，但不以模糊相似度静默阻断合法商品。
8. 每条结果返回稳定 `code/path/severity/message/policyVersion`，UI 文案不参与业务判断。
9. `blocked` 只来自明确官方/业务硬规则；`warning` 允许用户确认继续。
10. 截断按 token/片段优先级删除低优先段，不能直接从字符串中间切断词组。

浏览器可运行同一纯函数规则作即时反馈，服务端在保存/preflight/handoff 时以当前批准 policy 重新执行并作为最终权威。

### 08.8 输入快照与事实边界

AI 只能看到当前请求明确冻结的最小输入：

- approved `MediaVariant` 和 `variantHash`；
- 类目、商品类型和允许用于标题的结构化属性；
- 当前人工标题；
- TitleRuleTemplateVersion 与 TitlePolicyVersion；
- locale、市场和字符上限；
- 明确允许的历史人工选择摘要（默认不传）。

未在快照中的材质、尺寸、功能、认证、品牌、销量、折扣和营销承诺禁止生成。字段 `unknown` 必须保持 unknown，不能让模型补全。快照创建后不可修改；Draft 后续变化必须创建新请求，新旧候选分别保留。

### 08.9 Provider Adapter 与网络安全

统一 Adapter 契约：

```text
validateProfile -> healthCheck -> buildRequest
-> markSendStarted -> invoke -> parseEnvelope
-> extractUsage -> normalizeError -> redactDiagnostic
```

要求：

1. 浏览器永远不知道 Provider API Key，不接收 Provider 原始 endpoint 或完整响应。
2. Profile 必须选择已注册 adapter；不能因“OpenAI 兼容”就把任意 JSON/错误语义视为相同。
3. Endpoint 使用 HTTPS、批准 hostname/port/path；DNS 解析和每次重定向都禁止 loopback、link-local、RFC1918、metadata 和内部网段。
4. 出站网络使用 allowlist/egress policy；禁止 URL userinfo、fragment、无界重定向和把密钥发送到新 host。
5. Provider 原始错误只保存脱敏摘要；页面展示稳定错误码、阶段、trace 和恢复建议。
6. 连接健康与业务生成分开；healthCheck 不发送用户图片，不计入正常成功率。
7. Adapter 必须声明能力：视觉输入方式、JSON schema、usage、幂等能力、最大图片/超时和数据保留政策。
8. 未经批准不做隐藏跨 Provider failover；任何切换必须记录新 ProfileVersion，并让候选 provenance 可见。

### 08.10 Prompt、输出 Schema 与版本

1. `promptVersion`、`outputSchemaVersion`、`adapterVersion` 和 `TitlePolicyVersion` 都是 request/attempt 的不可变字段。
2. Prompt 由代码/配置仓库版本化，经过 fixture、红队和人工评审后发布，不允许管理员在生产随意粘贴未知 system prompt。
3. 输出使用严格 JSON schema；多余字段、类型错误、超长文本、空候选和解析失败都返回稳定错误。
4. 视觉识别与标题候选生成可以是两个步骤/模型，但必须分别留 attempt、usage 和 cache key。
5. Prompt 明确要求只使用输入快照事实；模型自报“符合规则”不具有授权效力。
6. Prompt/Schema 升级不反向改写历史候选，只让新请求使用新版本。

### 08.11 持久请求与 Attempt 状态机

Request：

```text
created -> queued -> running -> completed
                 \-> failed
created/queued -> cancelled
running -> result_unknown（Provider 发送边界后超时/连接中断）
```

Attempt：

```text
prepared -> send_started -> response_received -> parsed -> accepted
                         \-> result_unknown
prepared -> known_failed（发送前）
response_received -> known_failed（明确 Provider 拒绝/Schema 无效）
```

规则：

1. Request、Event 和 Outbox 在一个 PostgreSQL 事务中提交；队列不可用不丢请求。
2. BullMQ `jobId=requestItemId`，Queue attempts 默认 1；安全重投由 DB 状态和 Outbox 控制。
3. 调用 Provider 前持久化 `send_started`；发送后超时不得自动再提交一次可能重复计费的调用。
4. `result_unknown` 允许人工“重新生成”，但必须新建 child Attempt 并提示可能重复计费，不覆盖原 attempt。
5. 已完成请求重复读取返回原候选；相同 idempotencyKey 不创建第二组请求。
6. 取消只对 queued/pre-send 生效；send_started 后只能停止等待/展示，不能声称撤回 Provider。

### 08.12 调度、公平性与背压

1. 以 tenant/store/user/providerProfile 为调度作用域，防止单个大批次长期占满全局并发。
2. 全局、每 tenant、每店、每 Provider 和每用户均有硬并发/队列上限；具体数值由 ERP-19 压测定稿。
3. 默认按轮转/加权公平领取，同一批次保持展示顺序但不要求串行执行。
4. 队列满返回稳定 `AI_QUEUE_CAPACITY` 和已有 operation 状态，不在浏览器无限重试。
5. deadline、最老排队年龄、lease/heartbeat 和 stuck recovery 均可观测。
6. Scheduler 不在 Control HTTP 请求内循环抽干批次；一 request item 一 Job。
7. Provider 429/配额不足进入明确 backoff/暂停状态；不扩大通用重试次数。
8. Circuit breaker 只暂停故障 Profile 的新领取，不影响 A0 人工标题和其他健康 Profile。

### 08.13 批量 Operation 与部分成功

1. 浏览器一次提交目标 Draft/revision 列表，服务端返回 `202 + batchId + snapshot`。
2. 每个 item 冻结自己的输入、请求和候选；一项失败不改变其他 item。
3. Operation Snapshot 返回 total/queued/running/completed/failed/unknown/cancelled、逐项错误码和版本。
4. 页面通过当前 operation SSE 获得短时进度；断线/刷新后按 batchId 读取数据库快照继续。
5. 批量结果保持原商品顺序，支持筛选失败、仅重建已知失败项和逐项人工处理。
6. 批量“应用候选”必须展示每件商品的候选和校验；不能一键无预览覆盖所有标题。
7. 切店只改变视图，不转移或取消已提交 batch；任务始终绑定原 storeId。
8. 页面离开、浏览器崩溃或 Control/Worker 重启不丢进度、不重复计费调用。

### 08.14 图片复用与性能（A2）

1. AI 输入固定使用符合策略的 `ai_input` MediaVariant，不从任意页面 URL 或 Draft 内嵌数组取图。
2. Variant 在进入 Provider 前完成方向、颜色空间、尺寸和格式标准化；视觉识别通常使用足够清晰的受控尺寸，不默认发送原图。
3. 同一 `variantHash + provider/model + prompt/schema version` 可复用视觉识别；图片或模型变化必须 miss。
4. Provider 支持短时签名 URL 时优先使用单对象、短 TTL、只读票据；否则 Worker 受控流式读取并限制单图字节，不长期缓存 Base64。
5. 图片缓存保存元数据/识别结果优先于原始字节；临时字节缓存有 TTL、条数、总字节和逐项大小硬上限。
6. 同一 variant 的 in-flight 识别去重在服务端共享，而不是只在单个浏览器或单进程 Map。
7. 跨 tenant 永不复用或泄露命中；跨店是否复用仍需 Media scope 与 Provider 数据政策允许。
8. 缓存命中、取图、解码、编码、Provider upload 和响应耗时分别度量。

### 08.15 缓存语义

明确分为两类：

1. `VisualRecognitionCache`：只保存图案等视觉事实，可不包含 `currentTitle`；键至少包含 tenant/store/scope、variantHash、providerProfileVersion、model、promptVersion、outputSchemaVersion、locale。
2. `FinalCandidateCache`：若未来启用，键必须额外包含 currentTitle hash、商品事实 snapshot fingerprint、TitleRuleTemplateVersion、TitlePolicyVersion 和候选生成 prompt/version。

共同规则：

- 只缓存成功且 schema/政策可验证的结果，错误、超时、unknown 不缓存为成功。
- 结果带 `createdAt/expiresAt/sourceRequestId`，不靠进程 epoch 作为唯一失效机制。
- Profile、模型、Prompt、Schema、Policy、模板、图片或商品事实变化自然形成新键，不依赖全量清空。
- Redis 可作短期分布式缓存，PostgreSQL request/candidate 账本才是恢复真相。
- LRU/TTL/字节/条数均有上限；cache hit 仍重新运行当前 TitlePolicyEngine，防止规则升级漏检。

### 08.16 候选生成、验证与排序

1. 每次 A1/A3 默认生成 2～3 个候选；若只有一个可靠候选，明确说明，不用同义改写凑数。
2. 候选先规范化，再逐条执行 TitlePolicyEngine；`blocked` 候选不进入默认可选列表，但保留诊断证据。
3. 排序采用可解释确定性评分：事实一致性、必填覆盖、关键词覆盖、长度利用、重复度、语言质量和风险扣分。
4. 模型置信度只作为辅助展示，不能覆盖确定性 blocker。
5. 每个候选展示主要差异、长度、警告、来源模型/模板/规则版本和为什么排序靠前。
6. 店内重复检测只提示近似商品/标题，不把相似度当作商品身份，也不泄露无权限店铺数据。
7. 任何候选都不能包含输入快照没有证据的品牌、材质、尺寸、认证、功能或销量承诺。

### 08.17 用户决定、Draft Revision 与 Provenance

1. AI 完成后只展示候选，不立即 `setTitle` 覆盖人工内容。
2. 用户可以采用、编辑后采用、拒绝或保留原标题；默认选项是“不改变当前标题”。
3. 采用前展示 current → candidate diff、TitlePolicy 结果和被替换的模板片段。
4. 采用/编辑后创建新的 Draft revision 或受控 patch，保存 candidateId、人工修改摘要、actor 和时间。
5. 手工编辑后的最终文本优先；后续 AI/模板运行不得静默覆盖。
6. 撤销恢复上一 Draft revision，不删除 Request/Attempt/Candidate/Decision 审计。
7. ProductVersion 只冻结最终已保存标题及 policy/template/candidate provenance；未采用候选不进入发布 payload。

### 08.18 页面交互设计

单品编辑器：

- “AI 标题建议”是标题字段旁的辅助抽屉/面板，不跳转到新页面，不改变整体前端导航。
- 展示当前标题、输入来源、2～3 个候选、长度、风险和采用按钮；错误提供人工继续与复制 Trace。
- 生成中不锁定整个表单，用户可继续编辑其他区域；当前标题变化后旧候选标记“基于旧 revision”。

批量建品：

- 顶部显示一次 operation 摘要，每行显示 queued/running/completed/failed/unknown。
- 支持查看候选、逐项采用、批量采用“每项首选”前的完整预览和失败筛选。
- 页面刷新后通过 batchId 恢复，不显示“并行识别中”但实际任务已经丢失。

审核/发布中心：

- AI 标题按钮只能派生新 Draft revision，不能直接修改已冻结 ProductVersion 或当前官方商品。
- 已提交/驳回商品使用“返回编辑并生成建议”，明确这会创建修正版本，不改官方审核事实。

### 08.19 Provider 故障与降级

| 故障 | 页面表现 | 系统动作 |
| --- | --- | --- |
| 未授权/未配置 | 隐藏或禁用 AI，说明管理员配置 | A0 完全可用，不创建任务 |
| Queue 满 | 展示容量错误和稍后重试 | 不无限排队，不浏览器自动重试 |
| 取图/媒体失败 | 定位到具体 asset/variant | 不改标题，不把媒体故障升级为 Draft blocker |
| Provider 4xx/5xx/429 | 稳定 code、trace、Profile 健康 | 记录 attempt/usage，按策略暂停或退避 |
| 超时/断线（发送前） | known_failed，可安全重建 | 不计已发送，不创建候选 |
| 超时/断线（发送后） | result_unknown/可能计费 | 不自动重发；人工新 attempt |
| Schema/事实违规 | 候选 blocked 或请求失败 | 保存脱敏诊断，不写 Draft |
| SSE/Redis 故障 | 降级 operation snapshot/手动刷新 | DB/Worker 正常推进，不创建第二任务 |

Provider 全面不可用时，页面只失去建议能力；人工标题、模板、TitlePolicy、保存、预检和发布继续工作。

### 08.20 权限、配置与变更治理

建议能力词：

- `ai.title.use`：创建请求和查看自己可访问 Draft 的候选。
- `ai.title.batch`：创建批量请求。
- `ai.title.provider.manage`：创建/停用 Provider ProfileVersion 和轮换密钥。
- `ai.title.policy.manage`：起草标题 Policy/Prompt 版本。
- `ai.title.policy.approve`：批准并发布版本，与起草能力分离。
- `ai.title.usage.read`：查看用量与成本。

所有 API 服务端同时校验 tenant、store、Draft/revision、Media scope 和 capability。Provider 配置变更创建新 Version，不原地覆盖；启用/停用、密钥轮换、模型切换、Policy/Prompt 发布和预算修改全部写 AuditEvent。普通运营成员不能看到 endpoint、key hint 之外的秘密或其他成员无权 Draft 的候选。

### 08.21 预算、配额与用量

1. 设置 tenant 月预算、日预算、每用户/每店请求上限、单批上限和并发上限。
2. 创建 batch 前给出请求数量与预估成本；超出硬预算直接阻断 AI，不阻断人工编辑。
3. Provider 返回 usage 时保存实际值；未返回时保存可解释估算并标 `estimated`。
4. 发送后超时无法确认计费时标 `cost_unknown`，财务统计不得当作 0。
5. 预算告警、队列拒绝、缓存节省量、重复识别节省量和失败成本进入运营面板。
6. 不以隐藏降低图片质量、偷偷换模型或无提示 failover 控制成本。

### 08.22 数据安全、隐私与保留

1. 只向 Provider 发送最小化商品事实和明确授权 Variant，不发送会员信息、内部备注、供应商密钥或完整商品 payload。
2. Provider Profile 记录数据地域、保留、训练使用政策和合同状态；不满足政策的 Profile 不得 active。
3. 图片票据单对象、短时、只读，Provider 无长期 bucket 权限。
4. API Key 使用 scoped encryption/secretRef，日志、AuditEvent、错误和前端均不出现明文。
5. Provider 原始响应按最小保留策略加密/脱敏；长期保存规范候选、错误码、版本和 usage 即可。
6. 未采用候选、失败响应和临时 AI 图片按政策到期；已采用 provenance 随 ProductVersion 审计保留。
7. 数据删除遵守 tenant/workspace 保留和法律 hold，不通过普通 UI 直接硬删 attempt/usage。

### 08.23 可观测性、SLO 与诊断

关联链：

```text
batchId -> requestId -> inputSnapshotId -> outboxId -> jobId
-> attemptId -> providerTraceId -> recognitionId -> candidateId
-> decisionId -> draftRevisionId -> productVersionId
```

最低指标：

- 请求创建、Outbox 延迟、Queue wait、运行、完成、失败、unknown 和取消。
- Provider/Profile/model/prompt/schema 维度成功率、429/4xx/5xx、熔断、超时和解析失败。
- 视觉缓存/最终候选缓存/in-flight dedupe 命中、取图/编码字节和节省调用次数。
- 单项与 15/50/100 商品批量 p50/p95/p99、最老等待、每店公平性、CPU/内存/网络。
- 候选 blocked/warning、事实违规、采用/编辑/拒绝、人工修改率和重复标题提醒。
- token/image/请求用量、actual/estimated/unknown 成本、预算利用和失败成本。

诊断台展示脱敏输入 fingerprint、阶段、版本和稳定错误；不展示图片字节、完整 Prompt、API Key、完整 Provider 响应或无权限商品内容。正式 SLO 数值由 ERP-19 压测后定稿。

### 08.24 保留、删除与质量反馈

1. Request/Attempt/Usage 作为商业与成本证据，按租户政策保留；不能因用户删除候选就抹掉计费事实。
2. 未采用 Candidate 可短期保留并到期脱敏/删除文本，但保留最小统计和 tombstone。
3. 已采用 Candidate/Decision 与 Draft revision/ProductVersion provenance 同期保留。
4. 用户“拒绝/编辑”可形成结构化质量反馈，但默认不自动用于训练，也不跨租户汇总原文。
5. 任何未来训练/评测数据集必须单独授权、脱敏、可退出并记录来源；不在本模块暗中收集。
6. Provider 原始响应保留期短于规范 Candidate，删除由独立 Retention Worker 执行并留事件。

### 08.25 迁移与兼容策略

1. 先盘点现有 `tenant_ai_title_settings`、feature grants、标题模板、Draft 中 AI 字段、日志和缓存，不读取/输出明文密钥。
2. 新表 additive 建立；现有单行 Provider 设置映射为首个 `legacy_imported` ProfileVersion，启用前经过 URL/模型/密钥健康验证。
3. 现有标题规则模板冻结为版本 1；缺少适用 schema/category 的标 `scope_unverified`，不伪造兼容范围。
4. 先让现有同步 suggest 路由通过兼容 adapter 创建/等待单项 operation，再切换 UI；行为对等后才移除旧直调。
5. 批量页先影子创建 operation 与旧浏览器 Worker 对比结果，不同时执行两次真实 Provider 调用。
6. 历史 `aiTitlePatternName/titleRuleBaseTitle` 只标记 legacy provenance，不回填不存在的 attempt、prompt 或 usage。
7. 新候选面板先对单商品小范围启用；视觉/UI 基线确认后再进入批量。
8. 两个稳定 release、零旧路由真实调用和用量对账后，旧内存队列/结果缓存/浏览器 Worker 才在 ERP-23 退役。

### 08.26 分步实施顺序

| 编号 | 交付 | 核心内容 | 承接 ERP |
| --- | --- | --- | --- |
| AI-01 | AI/标题事实基线 | 路由、表、模板、Provider、Prompt、页面、日志、运行版本全图 | ERP-00、ERP-05 |
| AI-02 | A0 TitlePolicy 字典 | 官方长度、事实/禁词/语言/重复/严重级别和稳定 code | ERP-04、ERP-07 |
| AI-03 | 失败回归地基 | Provider 故障、人工 fallback、缓存隔离、SSRF、断线/重启 fixture | ERP-03、ERP-19 |
| AI-04 | 版本化 Policy/Template | immutable version、scope、fingerprint、审批和兼容 | ERP-06、ERP-15 |
| AI-05 | Provider Profile/Adapter | 加密 secretRef、版本、egress、健康、错误和 usage 契约 | ERP-06、ERP-07 |
| AI-06 | TitleInputSnapshot | Draft revision、事实、模板/Policy、variantHash 最小冻结输入 | ERP-06、ERP-14 |
| AI-07 | Request/Attempt/Event | durable state、send boundary、unknown、idempotency 和审计 | ERP-06、ERP-15 |
| AI-08 | Outbox/Worker | 一 item 一 Job、lease/heartbeat、重启恢复和 DB 真相 | ERP-08、ERP-15 |
| AI-09 | A1 候选管线 | 2～3 候选、严格 schema、确定性校验/排序与 ledger | ERP-15 |
| AI-10 | 决定与 Draft revision | diff、采用/编辑/拒绝、undo、provenance 和手工优先 | ERP-12、ERP-14 |
| AI-11 | A2 MediaVariant 输入 | ai_input Variant、短时票据/流式读取和字节预算 | ERP-15 |
| AI-12 | 两级缓存 | recognition/candidate 精确键、分布式去重、TTL/预算 | ERP-15、ERP-19 |
| AI-13 | A3 Batch Operation | 批量 request items、snapshot、partial success 和恢复 | ERP-13、ERP-15 |
| AI-14 | 公平调度与熔断 | tenant/store/provider 公平、配额、背压、Profile breaker | ERP-15、ERP-19 |
| AI-15 | 单品候选 UI | 不覆盖、diff、风险、Trace、旧 revision 提醒与可访问性 | ERP-13、ERP-14 |
| AI-16 | 批量候选 UI | operation 进度、逐项候选/失败、预览采用和刷新恢复 | ERP-13 |
| AI-17 | 用量与预算 | usage/cost ledger、预估、unknown、限额和运营面板 | ERP-17、ERP-18 |
| AI-18 | 历史兼容与影子对账 | legacy Provider/模板/字段映射，新旧结果与调用数核对 | ERP-20 |
| AI-19 | 规模/安全/恢复验收 | 1/15/50/100、重启、Redis/Provider 故障、SSRF 和成本 | ERP-19、ERP-21 |
| AI-20 | 金丝雀与旧路径退役 | 单店/用户灰度、版本/成本核对、零调用证明和清理 | ERP-22、ERP-23 |

AI-01 至 AI-10 是 P0 地基。未完成前不得继续在浏览器增加 Promise 并发、页面级缓存、自动覆盖标题或 Provider 失败后的通用重试。

### 08.27 验收标准

#### A0 与安全编辑

- Provider、Redis、AI Worker 全停时，人工标题、模板、Draft 保存、服务端 preflight 和 handoff 仍正常。
- TitlePolicy 同输入/版本输出完全确定，浏览器与服务端稳定 code 对等，服务端为最终权威。
- AI 不自动修改 Draft/ProductVersion，不触发 SHEIN，不改变审核或发布状态。

#### 输入、候选与缓存

- 每个候选可追溯到 Draft revision、事实、variantHash、模板、Policy、Provider/model/prompt/schema 版本。
- 2～3 候选均经过确定性事实/禁词/长度检查；无证据属性不会进入可选候选。
- 同 variant 精确命中识别缓存；图片/模型/Prompt/Schema/Policy/模板/事实变化按语义正确 miss/重验。
- 跨 tenant/store/user/media scope 的负向测试全部失败且不泄露 cache hit/候选存在。

#### 批量、恢复与性能

- 1/15/50/100 商品逐项进度、部分成功、原顺序和失败重建均可解释。
- 浏览器刷新/关闭、Control/Worker 重启、Redis 丢失和 SSE 断线后从 PostgreSQL 恢复，不重复 Provider 调用。
- 并发/队列/字节/成本有硬上限，大批次不能饿死其他店；2 核 4GB 目标环境通过预算。
- 发送后超时进入 result_unknown/cost_unknown，不盲重试、不静默算 0 成本。

#### Provider、安全与运营

- API Key 不出服务端；SSRF、DNS rebinding、重定向换 host、私网/metadata 地址和越权配置全部阻断。
- Profile/Prompt/Policy 变更版本化、可审计、可回滚，历史候选不漂移。
- 诊断能按 request/attempt/trace 定位失败阶段，不暴露秘密、图片字节或完整敏感响应。
- 用量、实际/估算/unknown 成本、预算、缓存节省和质量反馈可对账。

#### 用户体验

- 单品生成不锁整页；候选默认不改变标题，采用前有 diff，采用后可撤销。
- 旧 revision 候选不会覆盖新手工标题；批量应用前逐项预览，单项失败不清空成功项。
- 1280px、窄屏、键盘和读屏操作可用；本板块实施不改变已批准的全站导航和品牌视觉。

### 08.28 已确认决策

1. AI 标题是可选辅助能力，不是保存、预检、handoff 或发布依赖。
2. A0 确定性 TitlePolicy 先于 A1/A2/A3，标题合法性不交给模型自评。
3. AI 只生成候选，不直接写 Draft；默认不改变当前人工标题。
4. 每次请求冻结 Draft revision、事实、模板/Policy 和 MediaVariant 输入。
5. Request、Attempt、Candidate、Decision 和 Usage 建立持久追加式账本。
6. PostgreSQL 是任务真相，BullMQ 负责投递，Redis/SSE 只优化反馈。
7. 一 request item 一 Queue Job；批量不由浏览器 Promise Worker 作为唯一 owner。
8. Provider 调用前持久化 send boundary；发送后超时不自动重试，标 result/cost unknown。
9. 视觉识别缓存与最终候选缓存分离，使用语义完整的版本化键。
10. 图片输入使用受控不可变 MediaVariant/variantHash，不使用任意 URL 或长期 Base64 缓存。
11. Provider 通过版本化 Adapter/Profile 接入，密钥加密，出站网络 fail closed。
12. Prompt、输出 Schema、Adapter、模型和 TitlePolicy 都必须版本化并写入 Attempt。
13. 默认生成 2～3 个候选，先确定性验证和可解释排序，再交用户选择。
14. 用户采用/编辑/拒绝形成 TitleDecision；采用创建 Draft revision/patch 并可撤销。
15. 手工值优先，后续 AI 或模板不静默覆盖。
16. 批量任务支持 partial success、刷新/断线/重启恢复和跨店公平调度。
17. 不做隐藏 Provider failover；切换必须显式版本化并展示 provenance。
18. 用量与成本区分 actual/estimated/unknown，预算超限只阻断 AI。
19. AI 输入最小化，未在事实快照中的属性禁止生成；反馈默认不用于训练。
20. 本板块 UI 采用增量候选面板，不重做全站前端或改变已批准导航。

### 08.29 明确不做及后续讨论项

本板块明确不做：

- 不让 AI 自动发布、自动保存、自动改 ProductVersion 或自动修改 SHEIN 官方商品。
- 不在页面加载、切店、定时器或普通保存时自动触发生成。
- 不用模型输出替代 SHEIN 官方规则、类目属性或服务端 preflight。
- 不把 Provider 原始图片/响应、完整 Prompt 或密钥写进 Draft、日志或浏览器缓存。
- 不先引入 Kafka、Temporal、向量数据库、训练平台或独立 ML 微服务；现有 PostgreSQL + BullMQ 足够承接当前阶段。
- 不跨租户训练、检索、缓存或复用候选/图片。
- 不因 AI 方案实施重做全站 UI，也不顺手删除 legacy 路径。
- 不在未取得数据政策和用户授权时把拒绝/编辑内容发送给外部训练服务。

正式实施前仍需定稿：

1. 当前 SHEIN 标题在各市场/类目的官方长度、禁词、语言和关键词 fixture。
2. 首批批准 Provider/模型、数据地域/保留条款、域名 allowlist 和实际 usage 字段。
3. 目标日请求量、批次规模、预算币种、软/硬限额和每角色默认权限。
4. 默认候选数量是 2 还是 3，以及允许用户选择的质量阈值。
5. 视觉识别是否继续单独模型，还是由同一多模态模型一次产生结构化候选；无论选择哪种都必须保留两个逻辑边界。
6. 未采用候选、Provider 原始响应、Usage 和已采用 provenance 的正式保留年限。
7. 是否需要店内近重复标题检测及其性能/误报阈值。
8. 目标 Provider 是否支持短时图片 URL；不支持时 Worker 流式/内存预算的具体数值。

---

## 板块 09：商品合规、资质证书、1630/1631、实拍图、警示语与发布阻断

讨论日期：2026-08-29  
方案状态：方向已确认，待 ERP-07 与 ERP-16 以当前 SHEIN 官方文档、测试店铺真实响应和契约 fixture 定稿字段  
实施归属：ERP-03、ERP-04、ERP-05、ERP-06、ERP-07、ERP-09、ERP-10、ERP-12、ERP-13、ERP-14、ERP-15、ERP-16、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23  
本轮边界：只记录方案，不修改业务代码、数据库、云端配置或 SHEIN 数据

### 09.1 总体结论

合规不能继续被设计成商品表上的一个“合规状态”、一组 JSON 表单和若干同步提交按钮。商业级目标是建立独立但与商品版本、平台 SKC 和发布 Attempt 精确关联的合规领域：

`OfficialRequirementSnapshot → ComplianceCase → EvidenceBinding → DeterministicPreflight → Review/Approval → ComplianceCommand / ManualComplianceTask → SHEIN Adapter → Receipt / Readback → ComplianceProjection`

核心原则：

1. SHEIN 当前官方要求是“要求什么”的唯一权威；本地规则只做规范化、风险解释和流程编排。
2. 合规要求、证据完整性、外部执行结果和 SHEIN 审核结果是四类独立事实，不再塞进一个万能状态。
3. 商品发布 accepted、商品官方审核和合规处理互不改写结论；合规附属流程失败不能把已被 SHEIN 接收的商品改成“发布失败”。
4. 1630/1631 类型只能来自当前 SKC 的 SHEIN 官方要求回读；本地尺寸、SKU 尺寸、包装尺寸和历史商品不得替代官方判断。
5. 本体图、包装图、证书、检测报告、代理资料和警示语是不同证据角色；相同文件字节不代表可以互换或复用。
6. 模板只提供候选资料、填写策略和槽位映射，不复制其他 SKC 的审核结论、平台绑定或“已通过”状态。
7. SHEIN API 不支持的动作必须转为可追踪的人工任务，不能伪造为已提交、已绑定或已完成。
8. 合规写入必须使用持久命令、发送边界、回执账本和结果未知状态；同步 HTTP 返回 200 不能作为平台完成证据。
9. 当前阶段保持用户确认的手动刷新策略，不增加 30 秒、进页、切店或窗口聚焦自动同步。
10. 采用渐进式迁移和影子对账，不因本板块修复重做全站导航、品牌视觉或删除仍可能被生产引用的旧路径。

### 09.2 当前源码与接口事实基线

以下是 2026-08-29 对当前工作区的只读核对结果，不代表生产环境一定运行同一版本：

1. `server/shein-compliance.js` 已按每批 20 个 SKC 读取官方合规要求与实拍图要求，并区分 `ZSZZL`、`GSL`、手动 `HGXXL`、`labelGroup=1/2` 和未支持类型。
2. `server/compliance-rules.js` 已读取证书 schema、有效证书池、代理公司库和警示语规则，但这些来源仍主要汇总进快照 JSON。
3. `server/cloud/compliance-sync-service.js` 已有持久同步任务、冷却、无目标拒绝、部分失败和 24 小时快照有效期；列表状态仍主要落为“未同步、需修正、待补充、审核中、待同步、通过”等中文聚合值。
4. 迁移 008、024～029 已建立 `compliance_drafts`、`compliance_templates`、追加式预检与审阅记录、规则库快照和不可变审计触发器，说明现有系统具备可保留的草稿/预检地基。
5. `WebComplianceWorkspaceService` 已在服务端重新读取当前草稿、规则快照和受保护媒体，计算 input/rule/media fingerprint，并能判断预检是否仍对应当前草稿、规则和媒体。
6. 当前媒体校验仍依赖 `media_assets.purpose='compliance_evidence'`，不足以表达本体图、包装图、证书、报告和代理资料的不同角色、适用范围及保留策略；该问题由板块 07 的规范 MediaReference 承接。
7. `WebComplianceWriteService` 的实拍图与 1630/1631 报告提交是单个 HTTP 请求内串行执行上传、保存、绑定和启动回读；确认令牌消费记录保存在 Control 进程内存 `Set`，进程重启、多副本和发送后断线时缺少持久恢复边界。
8. 合规写入当前主要由 `SHEIN_COMPLIANCE_WRITES_ENABLED` 总开关控制；照片与报告能力未按动作、店铺、Adapter contract 和金丝雀范围独立授权。
9. 当前商品发布 Worker 还存在合规照片附属提交路径，主商品执行与合规命令的唯一 owner、失败隔离和完成语义需要按板块 05 的独立命令原则重整。
10. 当前 V2 合规工作台支持手动同步、逐 SKC 详情、批量保存草稿、模板引用、官方报告等待态和单 SKC 提交；批量操作仍以页面选择和草稿保存为主，真实写入不应由浏览器循环承担。
11. `SHEIN_INTEGRATION_BLUEPRINT.md` 记录了证书、代理、警示语和实拍图接口族，但它引用的 `SHEIN_API_SOURCE_INDEX.md`、`SHEIN_API_FIELD_HANDOFF.md`、`SHEIN_PRODUCT_PUBLISH_CONTRACT.md` 与 `CLOUD_DEPLOYMENT_ARCHITECTURE.md` 当前工作区缺失；在 ERP-07 恢复正式来源索引前，不得把历史蓝图当作完整的当前官方合同。
12. 历史交接曾先后出现本地 1630/1631 推导、官方类型唯一、实拍图不可复用和店铺素材可复用等阶段性结论。目标模型必须保存规则来源与版本，以当前官方响应和已批准业务合同裁决，不能用最新补丁覆盖历史语义。

### 09.3 责任边界

| 组件 | 唯一职责 | 明确不负责 |
| --- | --- | --- |
| Requirement Sync | 读取、原样留存、规范化 SHEIN 当前要求和来源健康 | 不决定用户材料，不执行写入 |
| Compliance Case Service | 为准确目标和要求建立案件、责任人、截止时间与当前事实 | 不调用 SHEIN，不解析文件字节 |
| Evidence Service | 管理合规材料、MediaReference、有效期、适用范围与绑定 | 不把本地文件称为平台材料 |
| Compliance Policy Engine | 基于冻结输入执行确定性预检，输出稳定 code/path/severity/action | 不调用 Provider，不修改 Draft |
| Action Planner | 将可执行项和人工项拆成明确计划 | 不发送外部请求 |
| Compliance Command Service | 事务持久化 Command/Event/Outbox 和授权快照 | 不在 HTTP 请求内执行完整外部流程 |
| Compliance Worker | 领取一个 Command、记录发送边界、调用 Adapter、保存 Attempt/Receipt | 不修改商品发布结论，不猜测审核状态 |
| SHEIN Compliance Adapter | 实现版本化 endpoint、字段、限制、错误与响应解析 | 不包含页面状态或业务文案 |
| Readback / Projection | 处理回执、Webhook、官方状态查询并生成当前投影 | 不重放写请求，不从空响应推断“无需” |
| Compliance Workbench | 渲染案件、证据、动作、来源、历史和批量进度 | 不维护第二套状态机，不把 HTTP 200 称为通过 |

### 09.4 目标拓扑

```text
SHEIN requirement/readback APIs
              │
              ▼
 OfficialRequirementInbox ──► RequirementNormalizer(mapVersion)
              │                         │
              ▼                         ▼
 RawRequirementEvent          OfficialRequirementSnapshot
                                           │
 ProductVersion / PlatformSkcLink ─────────┤
                                           ▼
                                   ComplianceCase
                                           │
 MediaAsset/Variant ─► ComplianceMaterial ─► EvidenceBinding
                                           │
                                           ▼
                              DeterministicPreflightRun
                                           │
                          ┌────────────────┴──────────────┐
                          ▼                               ▼
                 ComplianceCommand              ManualComplianceTask
                          │
                    Outbox / BullMQ
                          │
                          ▼
                  Compliance Worker
                          │
                          ▼
               Versioned SHEIN Adapter
                          │
                          ▼
            Attempt / Receipt / Readback / Inbox
                          │
                          ▼
             ComplianceProjection + Timeline
```

PostgreSQL 是案件、命令、Attempt、回执和投影的事实源；BullMQ 只投递；Redis/SSE 只优化活跃操作的反馈。

### 09.5 目标领域模型

| 对象 | 作用 | 关键不变量 |
| --- | --- | --- |
| `OfficialRequirementRawEvent` | 保存官方原始响应、endpoint、trace、店铺、目标和时间 | 追加式、脱敏、不可原地改写 |
| `OfficialRequirementSnapshot` | 规范化某店铺某目标在某时点的要求全集 | 含 coverage/sourceHealth/mapVersion/fingerprint；部分失败不等于空 |
| `RequirementItem` | 一个证书、代理、警示语、照片或平台人工要求 | 有稳定 identity、required/applicability、reviewState、capability |
| `ComplianceCase` | 某目标某要求的运营案件 | 精确作用域；一个案件不承载多种要求的万能状态 |
| `ComplianceDraftRevision` | 用户准备中的结构化资料版本 | immutable revision；保存不等于预检或提交 |
| `ComplianceMaterial` | 证书、报告、机构、警示语选择或媒体证据的业务对象 | 与普通商品图片分离；有类型、有效期和适用范围 |
| `MaterialApplicability` | 说明材料可用于哪些店铺、市场、类目、产品、SKC 和时间 | 复用由它和官方要求共同决定，不由模板或 hash 决定 |
| `EvidenceBinding` | 将材料绑定到 RequirementItem/Case | role、slot、target、source revision 和状态明确 |
| `CompliancePreflightRun` | 对冻结案件/草稿/规则/媒体执行的服务端结果 | 追加式；输入、规则、媒体、能力均有 fingerprint |
| `ComplianceReview` | 审阅者对一份预检快照的确认 | 不授权发布；输入变化自动失效 |
| `ComplianceActionPlan` | 可执行动作与人工动作的冻结计划 | 一动作一目标一契约；不保存第二份可漂移报文 |
| `ComplianceCommand` | 一个真实外部写意图 | immutable、幂等、store-scoped、一命令一队列 Job |
| `ComplianceAttempt` | 一次领取和发送尝试 | 有 send boundary、lease、adapterVersion 和结果分类 |
| `ComplianceReceipt` | 上传、保存、绑定、审核和回读证据 | 追加式；本地 mediaId 不能替代平台回执 |
| `ManualComplianceTask` | API 不支持或需商家后台操作的任务 | 有 owner、步骤、截止时间、证据和官方复核，不伪造外部成功 |
| `ComplianceProjection` | 当前可展示的案件/要求/证据/执行/审核投影 | 可由事件重建；中文仅展示 |
| `ComplianceExpiryEvent` | 证书/代理/报告临期、失效或平台变更事件 | 不自动向 SHEIN 写；只产生提醒或新案件 |

目标在 SKC 生成前后必须分开：

- 发布前只允许绑定 `ProductVersion` 和官方明确可在发布前确定的要求；不得预造平台 SKC。
- SHEIN 返回真实 SKC 后，通过 `PlatformProductLink` 建立 SKC 级案件；需要 SKC 后才能确定的报告、实拍图或人工项在此时展开。
- 后置案件失败不会撤销商品已 accepted 的事实，但会阻断对应的合规动作、市场资格或后续运营动作。

### 09.6 五个正交状态维度

#### 09.6.1 Requirement Applicability

`unknown | pending_rule | not_applicable | optional | required`

- `unknown`：来源失败、字段未知或无法映射。
- `pending_rule`：SHEIN 明确仍在判定/确认中。
- `not_applicable`：只有当前官方响应可证明无需。
- `optional`：不形成当前发布 blocker，但可以提示风险。
- `required`：当前动作和目标必须满足。

#### 09.6.2 Evidence State

`missing | draft | valid_local | staged | expired | rejected | superseded | unknown`

`valid_local` 只证明本地材料通过当前校验；不等于已上传、已绑定或 SHEIN 已通过。

#### 09.6.3 Execution State

`not_planned | ready | queued | leased | send_started | accepted | known_failed | result_unknown | manual_required | cancelled`

`accepted` 只表示对应写 endpoint 返回可验证接收证据；不能直接映射成官方审核通过。

#### 09.6.4 Platform Review State

`not_submitted | pending | passed | rejected | withdrawn | unknown`

#### 09.6.5 Source Health

`fresh | stale | partial | unavailable | conflict`

页面上的“需处理、处理中、已通过”只能是以上维度的运营投影，必须携带 reasonCode、allowedActions 和 evidenceLevel，不能成为写入源。

### 09.7 官方要求快照与来源健康

1. 每次读取保存 endpoint、requestTarget、raw payload hash、traceId、fetchedAt、expiresAt、adapter/mapVersion。
2. 快照必须记录 `requirementsReturned`、`photoRequirementsReturned`、各规则库成功/失败和覆盖目标；不能只保存一个 `fresh=true`。
3. 某一来源失败时保留 last-known-good，当前视图标 `partial/stale`；不得用空数组清空旧要求或显示“无需”。
4. 真正的官方空结果必须由成功响应、准确目标和当前契约证明，并记录 `confirmedEmpty=true`。
5. `complianceGroupCode`、`certificateTypeId/code`、`labelId/group`、`isRequired`、`reviewState` 和手动警示能力均由 Adapter 版本化映射。
6. 未识别的新 group/code 进入 `unknown/unsupported` 案件并 fail closed；不自动塞进最近的已知类型。
7. 手动刷新创建服务端 Operation，店铺内去重、限流、逐来源进度和部分失败；页面不 fan-out SHEIN 请求。
8. 不增加定时 30 秒同步。平台失效 Webhook 可进入 Inbox 并标风险，但用户页面仍以手动刷新/活动操作为主。

### 09.8 ComplianceCase 与精确作用域

案件唯一键至少包含：

`tenantId + storeId + targetKind + targetId + requirementIdentity + requirementContractVersion`

规则：

1. `targetKind` 只允许 `product_version`、`platform_skc`、`store_qualification` 等批准类型。
2. SKC 级报告和实拍要求不能因为 supplier code、类目或文件 hash 相同而合并案件。
3. 店铺级资质若官方允许覆盖多个 SKC，仍为独立 store qualification，并通过显式 binding 关联每个目标。
4. 新官方快照改变 required、scope 或 schema 时，旧案件保留历史，新建/升级当前 CaseRevision，不覆盖旧审计。
5. `needs_action` 由案件当前维度派生；Case 需要显示 owner、dueAt、blockingAction 和 nextAction。

### 09.9 证据角色、复用与 Media 边界

首期合规证据角色固定为：

- `compliance_body_photo`
- `compliance_package_photo`
- `compliance_certificate_file`
- `compliance_report_1630`
- `compliance_report_1631`
- `compliance_agency_evidence`
- `compliance_manual_evidence`

规则：

1. 角色属于 `MediaReference/EvidenceBinding`，不再由 Asset 的单个 purpose 决定。
2. 相同字节可产生多个角色引用，但每个引用都必须独立通过作用域、规则、有效期和目标适用性检查。
3. 合规媒体默认 `compliance_locked`，短期预签名访问，下载和引用均审计；普通素材 Picker 不展示。
4. 模板保存 `MaterialCandidateRef + applicability snapshot`，应用时重新读取目标要求并创建新 Binding；不复制平台 Receipt。
5. 跨店默认禁止。只有明确的 tenant 共享资质、当前官方范围允许且经 `MediaShareGrant/MaterialApplicability` 证明时才可候选引用。
6. 已发布 ProductVersion、合规 Attempt、平台 Receipt 和人工完成证明建立 `RetentionHold`；草稿删除不能释放正式证据。

### 09.10 1630/1631 专项闭环

1. 报告类型仅接受当前 SKC 官方 RequirementItem 明确返回的 `1630` 或 `1631`。
2. 官方未返回、同时返回两种、来源过期或映射冲突时状态为 `pending_rule/unknown/conflict`，不开放类型选择和提交。
3. 本地尺寸可作为商品数据质量检查或运营提示，但不能决定报告类型、覆盖官方类型或生成“已满足”。
4. 每个 SKC 使用自己的报告 EvidenceBinding；除非新官方合同明确证明可共享，否则不得从其他 SKC、模板或证书池直接继承通过结论。
5. 报告文件、报告日期、证书 schema 字段、检测机构和平台文件回执分别保存；本地 PDF/图片不等于 `fileUrl/fileMd5`。
6. 外部流程拆成：上传文件 → 保存证书/报告 → 绑定准确 SKC → 官方状态回读。每一步有独立 Attempt/Receipt 和结果未知处理。
7. `certificateDimension`、日期字段、文件类型/大小、批量上限等全部来自当前 Adapter/Schema fixture，不写死在页面业务判断中。
8. 已通过报告不允许无意义重复提交；驳回后创建新 DraftRevision/Command，旧报告和原因保留在 timeline。

### 09.11 商品本体图与包装图

1. `labelGroup=1` 和 `labelGroup=2` 是独立 RequirementItem、EvidenceBinding、PlatformReceipt 和审核状态。
2. 页面文案分别使用“商品本体实拍图”和“商品包装实拍图”，不得统称为“合规图片”后混填。
3. 当前 SKC 每次应用素材时重新读取 `labelId + labelGroup + required + reviewState`；参照 SKC 的 labelId 不直接复制。
4. 店铺素材是否可复用不写死为“永远可复用/永远不可复用”。只有当前官方要求、目标范围和 `MaterialApplicability` 都允许时才创建候选 Binding。
5. 上传返回 `imageUrl/imageMd5` 只形成平台媒体 Receipt；随后绑定结果和官方审核结果另行记录。
6. 若官方未提供删除/覆盖旧图片的明确字段，UI 必须显示“历史变更语义未知”，不能承诺旧图已删除。
7. 批量提交按目标 SKC 独立 Command；一项失败不清空成功项，也不把整批标成全部成功或全部失败。

### 09.12 资质证书

1. 证书 schema、证书池、状态、有效期、适用市场、类目、主体和 `certificateDimension` 均版本化保存。
2. 证书池中的 active 只表示候选可用；绑定准确目标并回读通过后才满足对应 Case。
3. 新建证书流程固定拆为文件上传、字段保存、证书创建、目标绑定和官方回读，不允许一个 HTTP 200 把全部阶段折叠为完成。
4. 到期、临期、撤销或适用范围变化产生 Expiry/Invalidation Event，自动打开受影响案件；不自动向 SHEIN 重提。
5. 证书字段只允许当前 schema 启用的 preset/option；未知字段和值 fail closed，不能保存浏览器自造 ID。
6. 一个证书可覆盖多个目标时必须显示受影响 SKC 清单、适用性证据和撤销影响，禁止“全店默认”黑箱。

### 09.13 代理公司与制造商资料

1. 代理公司库与 SKC 绑定是两个对象；`agencyStatus/applyStatus/type/subType/start/end/coveredProductRange` 分开保存。
2. 只有当前要求所需 agency type、有效状态和适用范围匹配时可进入 ActionPlan。
3. 店铺级常用代理可作为候选默认值，但每个 SKC 的绑定和官方回读必须留证据。
4. 代理资料中的联系人、地址、证件和其他敏感信息按最小展示、字段级脱敏和下载审计处理。
5. API 不支持的新增/修改动作生成 ManualComplianceTask，不通过数据库手工改成“已绑定”。

### 09.14 警示语

1. 只有当前官方要求明确 `isManualProductWarning=true` 且 Adapter 宣布可写时，才生成 `warning.update` Command。
2. 警示语 schema、字段、可选值、互斥关系、mappingPaths、语言/站点/市场和版本均冻结到 PreflightRun。
3. 自动映射值与用户显式选择值分开记录，采用前展示 diff；规则变更后旧选择进入 stale，必须重验。
4. 互斥值、禁用值、未知值和不完整规则形成稳定 blocker；页面不能通过字符串拼接绕过。
5. 非手动警示或官方未开放写入的要求进入人工任务，展示后台操作路径和回读确认条件。

### 09.15 GCC、产品标识符和其他未开放能力

`GCC`、产品标识符以及其他官方 API 不支持的类型统一进入 `ManualComplianceTask`：

- `taskType`
- `targetStore/targetSkc`
- `requirementSnapshotId`
- `reasonCode`
- `instructionsVersion`
- `owner/dueAt`
- `evidenceReferences`
- `attestedBy/attestedAt`
- `officialRecheckStatus`

人工勾选“已处理”只能形成完成声明；只有后续官方回读证明 passed/not_required，ComplianceProjection 才能显示平台已满足。人工任务不能调用虚构 endpoint，也不能返回 `externalWrite=true`。

### 09.16 确定性预检与发布阻断

服务端预检冻结：

- ProductVersion / Platform SKC identity
- RequirementSnapshot 及每个来源健康
- ComplianceDraftRevision
- EvidenceBinding 与 verified variant hash
- certificate/agency/warning schema version
- Adapter capability/contract version
- 操作人、权限和目标动作

输出统一为：

- `blockers[] { code, path, messageKey, requirementId, allowedActions }`
- `warnings[]`
- `waiting[]`
- `actions[]`
- `manualTasks[]`
- `input/rule/media/capability fingerprint`

阻断规则：

1. 只有“当前官方要求 + 当前目标动作 + 当前目标”明确 required 的未满足项形成 blocker。
2. optional、未来阶段和纯运营建议只形成 warning。
3. 来源 partial/unknown 不得假装通过；只阻断依赖该来源且不可安全继续的动作，其他安全编辑/保存仍可用。
4. 预检通过只说明当前冻结输入可形成 ActionPlan，不说明 SHEIN 已接收或审核通过。
5. 草稿、规则、媒体、能力、权限、目标或时间有效性任一变化，旧预检/审阅失效。
6. 浏览器可做即时提示，但服务端预检是唯一 handoff/Command 授权依据。

### 09.17 与商品发布链的关系

1. 发布前已知且 SHEIN 明确要求随商品提交的合规项，作为 ProductVersion preflight blocker。
2. 必须等待 SKC 生成后才能判断/绑定的项目，不伪装为发布前已完成；商品 accepted 后创建 post-SKC ComplianceCase。
3. ProductPublishCommand 与 ComplianceCommand 使用不同类型、队列策略、状态机和完成条件，可以在同一 Operation 视图聚合。
4. 商品 accepted 一经可靠回执确认，不被合规上传失败、回读失败或人工任务改写。
5. 合规 Case 可以影响“可进入市场、可继续运营、需补件”等资格投影，但不得反向伪造商品发布失败。
6. 重发商品创建新的 ProductVersion/PublishAttempt；合规材料是否沿用必须按新 RequirementSnapshot 和 applicability 重验。

### 09.18 合规真实写入管线

每个动作独立命令，例如：

- `certificate_file.upload`
- `certificate.create`
- `certificate.bind`
- `agency.bind`
- `warning.update`
- `photo.upload`
- `photo.bind`

执行约束：

1. Command、初始 Event 和 Outbox 在同一 PostgreSQL 事务提交，HTTP 返回 `202 + operationId/commandId`。
2. 一 Command 对应一 BullMQ Job；批量只共享 batch/operationId，不由一个 Worker 循环抽干整批。
3. Worker 领取前记录 lease；外部调用前持久化 `send_started`。
4. 发送前崩溃可安全恢复同一 Command；发送后超时/断线进入 `result_unknown`，禁止自动重发。
5. 上传、保存、绑定分别持久化 Attempt/Receipt；前一步结果是下一步输入，但不折叠历史。
6. 写能力按 action + adapterVersion + store + canary policy 独立启用，不使用一个总开关证明所有动作可用。
7. 确认授权持久化、短时、单次消费且与 ActionPlan fingerprint 绑定；不能保存在单进程内存。
8. 同一业务键重复点击返回原 Operation；明确失败重试创建 child Attempt，不覆盖旧 Attempt。

### 09.19 官方回读、Webhook 与状态归并

1. `/product_compliance_change_notice`、写接口回执、主动查询和人工复核统一进入 OfficialEventInbox。
2. Raw、normalized receipt、匹配结果、Projection 和 current pointer 在同一事务或可重放的事件边界内更新。
3. 匹配只接受 tenant/store/target/requirement exact evidence；歧义进入 conflict，不猜测最近 SKC。
4. 上传成功、保存成功、绑定 accepted 和平台 review passed 是不同证据等级。
5. 空响应不自动等于无需、未提交或失败；保留 last-known-good 和 source health。
6. 重复、迟到、乱序事件不能让 passed 倒退到 pending；新的明确驳回/失效事件通过新 revision 打开案件并保留历史。
7. 当前 Projection 必须可从 Receipt/Event 重建，页面不得通过草稿和回执临时拼装第二套结果。

### 09.20 批量、部分成功与选择语义

1. 批量预览必须显示目标 SKC、要求类型、材料、将执行动作、人工项和 blocker。
2. 只能批量处理相同 action contract、相同材料适用范围且当前允许的目标；混合 1630/1631、不同 labelGroup 或不同 schema 自动分组。
3. “全选”默认只选当前查询/当前页可操作行；跨页全选必须是显式服务器 SelectionSnapshot，不保留隐藏 ID。
4. 批量保存草稿、批量预检和批量真实提交是三个动作，按钮和结果分开。
5. 每个目标有 `saved/blocked/queued/accepted/known_failed/result_unknown/manual_required` 结果，成功项不会被失败项清空。
6. 刷新、关闭页面或 Control/Worker 重启后，从 Operation/Command 恢复；不依赖 React state。

### 09.21 合规工作台信息架构

#### 总览

- 全部案件、需材料、待提交、提交中、结果待确认、平台审核中、已通过、已驳回、即将过期、人工处理。
- 每个数字来自同一 `ComplianceWorkbenchSnapshot`，返回 `snapshotRevision/sourceHealth/freshness`。
- “全部”与分类必须使用同一谓词对账；unknown/stale 单独显示，不计为通过或 0。

#### 列表

- 主图、店铺、SPU/SKC、商品标题、要求类型、必填性、证据状态、执行状态、平台审核、负责人、截止时间、来源时间和下一步动作。
- 支持按店铺组、店铺、市场、类目、要求、状态、负责人、到期日和 trace 搜索筛选。
- 行展开显示 RequirementSnapshot、EvidenceBinding、Preflight、Command/Attempt/Receipt timeline。

#### 详情

- 左侧商品身份与官方要求；中间动态资料编辑和证据；右侧阻断、下一步、来源健康和时间线。
- 默认只展示当前 required/attention 项；已通过内容可展开查看，不从 DOM 删除。
- 每个外部动作显示目标店铺/SKC、endpoint 类型、材料数量、是否真实写、确认和回滚边界。

#### 商品编辑器内嵌面板

- 只展示当前 ProductVersion 已知的 pre-publish 要求和 post-SKC 待办预期。
- 合规能力故障不锁死普通标题、属性、图片编辑和草稿保存；只有当前动作真实 blocker 阻断 handoff。

本板块不重做全站壳层、品牌和导航；使用既有 Operations primitives、Table/Virtual、MediaPicker 和状态组件增量实现。

### 09.22 权限、审批与高风险动作

首期能力词典：

- `compliance.read`
- `compliance.refresh`
- `compliance.draft.edit`
- `compliance.evidence.manage`
- `compliance.preflight.run`
- `compliance.review`
- `compliance.execute.photo`
- `compliance.execute.certificate`
- `compliance.execute.agency`
- `compliance.execute.warning`
- `compliance.manual.attest`
- `compliance.policy.manage`

规则：

1. viewer 永远只读；普通 operator 不能因“不是 viewer”自动获得全部 SHEIN 合规写权限。
2. 真实提交按 action capability 校验，并可要求二次验证、短时 step-up 和双人审阅。
3. 批量跨店合规写首期禁用；每次 Command 只属于一个准确店铺。
4. 服务端在创建 Command 和 Worker 执行前都重验 tenant/store/target/permission/capability。
5. 审阅预检不等于授权执行；两者使用不同对象和审计事件。

### 09.23 安全、隐私与保留

1. 证书、报告、代理资料和联系人按敏感业务文件处理，私有存储、短时 URL、下载审计和最小字段展示。
2. API 密钥、secret、原始签名、完整敏感响应和本地文件字节不进入浏览器缓存、Draft JSON 或普通日志。
3. 文件进入 ready 前执行可信 checksum、MIME sniff、解码/页数/像素/大小限制和恶意文件隔离。
4. RetentionPolicy 区分草稿材料、已提交证据、已通过资质、被驳回报告和人工证明；法律/审计 hold 优先于普通清理。
5. 普通删除进入回收站；有 Receipt、Case、Attempt 或 Hold 的材料禁止直接物理删除。
6. 跨租户 hash、文件存在性、证书池和代理资料均不得泄露。

### 09.24 可观测性、SLO 与运营诊断

Trace 链：

`requirementEventId → snapshotId → caseId → draftRevisionId → evidenceBindingId → preflightRunId → actionPlanId → commandId → jobId → attemptId → platformTraceId → receiptId → projectionRevision`

首期目标：

- 工作台缓存读取 P95 ≤ 500ms；不在列表请求内调用 SHEIN。
- 单 SKC 手动刷新在 SHEIN 正常时 2～5 秒给出活动 Operation 反馈，超时转可恢复后台任务。
- 同一 store/action 默认单在飞，跨店公平，全局并发按 2 核 4GB 压测定稿。
- `result_unknown`、stale requirement、即将过期、manual overdue、unmatched receipt 和最老队列年龄有告警。
- 诊断页按 command/attempt/trace 展示脱敏阶段、来源、错误分类和建议动作，不暴露文件或密钥。

### 09.25 故障与恢复矩阵

| 故障 | 正确结果 | 禁止行为 |
| --- | --- | --- |
| 官方要求某来源失败 | 保留 LKG，标 partial/stale，阻断依赖动作 | 清空成“无需/通过” |
| 上传前 Worker 崩溃 | 同 Command 安全恢复 | 新建重复业务命令 |
| 上传后响应丢失 | `result_unknown`，先核对 | 自动再次上传并绑定 |
| 证书保存成功、绑定失败 | 保存两步 Receipt，仅重试明确安全绑定步骤 | 把整条历史改成失败或重新创建证书 |
| 商品 accepted、合规失败 | 商品保持 accepted，合规 Case 显示失败 | 把商品改成发布失败 |
| Webhook 重复/乱序 | 幂等、单调投影 | 迟到 pending 覆盖 passed |
| 规则或材料过期 | 旧预检失效，生成新 revision | 沿用旧确认令牌 |
| 人工任务勾选完成但未回读 | 显示“人工已声明，待官方确认” | 显示“SHEIN 已通过” |
| Redis/队列不可用 | Command/Outbox 保留，可恢复投递 | 丢任务或浏览器重建请求 |
| 页面刷新/切店 | 从 scoped Snapshot 恢复，清除不适用选择 | 跨店复用旧列表、文件或 selected IDs |

### 09.26 历史数据迁移与兼容策略

1. ERP-05 先对 `skcs.compliance_status/summary`、`skc_compliance_records`、`compliance_drafts/templates`、规则快照、预检、审阅和历史写回执做只读盘点。
2. 中文汇总状态只能映射为 legacy projection hint，不能反推官方 Requirement、Receipt 或 Review passed。
3. 历史文件缺少可信 hash、role、目标或平台回执时标 `legacy_unverified`，不得自动升级为可提交 Evidence。
4. 现有草稿和预检保留只读兼容 Adapter；新 Case/Command 模型影子写入并做逐 SKC 对账。
5. 旧同步 HTTP 写、单进程确认令牌、商品发布内附属合规写和旧模板复用路径，只有零真实调用证明、回执对账及两个稳定 release 后才退役。
6. 不物理删除历史驳回、证书、报告、图片、人工声明或原始事件；清理必须进入 ERP-23 并取得具体授权。
7. 缺失的正式 SHEIN 来源索引和字段合同在 ERP-07 恢复，标明文档版本、测试日期、响应差异和 trace fixture。

### 09.27 分步实施顺序

| 编号 | 交付 | 核心内容 | 承接 ERP |
| --- | --- | --- | --- |
| COMPLY-01 | 合规事实基线 | 接口、路由、表、Worker、开关、素材、状态、生产版本和缺失文档全图 | ERP-00、ERP-05、ERP-16 |
| COMPLY-02 | 官方合同与 fixture | requirement/certificate/agency/warning/photo endpoint、字段、错误、限制和 mapVersion | ERP-07、ERP-16 |
| COMPLY-03 | 失败回归地基 | partial/empty、1630/31、角色混用、同步写崩溃、unknown、跨店和历史回归 | ERP-03、ERP-16、ERP-19 |
| COMPLY-04 | Requirement Inbox/Snapshot | raw、normalizer、coverage、source health、LKG 和 stable identity | ERP-06、ERP-10、ERP-16 |
| COMPLY-05 | ComplianceCase | 精确 target/requirement、owner、dueAt、revision 和正交状态 | ERP-04、ERP-06、ERP-16 |
| COMPLY-06 | Material/Applicability | 证书、报告、代理、警示语与 MediaReference 角色/范围/有效期 | ERP-06、ERP-15、ERP-16 |
| COMPLY-07 | 1630/1631 闭环 | 官方类型唯一、逐 SKC 报告、日期/schema、上传/保存/绑定/回读分步 | ERP-07、ERP-16 |
| COMPLY-08 | 本体/包装实拍闭环 | labelGroup 分离、素材适用性、逐目标绑定、Receipt 和历史语义 | ERP-07、ERP-15、ERP-16 |
| COMPLY-09 | 证书生命周期 | schema、证书池、有效期、适用范围、多步创建绑定和失效事件 | ERP-07、ERP-16 |
| COMPLY-10 | 代理与警示语 | agency 生命周期、手动 warning 规则、互斥/映射、敏感字段和回读 | ERP-07、ERP-16 |
| COMPLY-11 | 人工任务 | GCC/产品标识符/unsupported 的 owner、证明、截止日和官方复核 | ERP-06、ERP-13、ERP-16 |
| COMPLY-12 | 确定性预检 | 冻结输入、稳定 code/path/severity/action、当前动作 blocker 边界 | ERP-14、ERP-16 |
| COMPLY-13 | Command/Outbox | 一动作一 Command、一 Job、持久授权、send boundary、unknown | ERP-06、ERP-08、ERP-16 |
| COMPLY-14 | Adapter 与 Worker | 分动作 capability、限流、公平、lease、错误分类和安全重试 | ERP-07、ERP-08、ERP-16 |
| COMPLY-15 | Receipt/Projection | 写回执、Webhook、主动回读、单调投影、Case timeline 和 LKG | ERP-10、ERP-16 |
| COMPLY-16 | 发布链集成 | pre/post-SKC gate、商品 accepted 隔离、重发与合规复验 | ERP-09、ERP-12、ERP-16 |
| COMPLY-17 | 工作台与嵌入面板 | 一致 Snapshot、案件列表/详情、批量预览、部分成功和无全站改版 | ERP-13、ERP-14、ERP-16 |
| COMPLY-18 | 历史迁移与影子对账 | legacy 分类、草稿/模板兼容、旧写 owner 零调用证明 | ERP-05、ERP-20、ERP-23 |
| COMPLY-19 | 安全/规模/恢复验收 | 1/15/50/100、重启、超时、过期、PII、跨店和 2 核 4GB 预算 | ERP-19、ERP-21 |
| COMPLY-20 | 金丝雀与退役 | 单店单动作放量、平台后台核对、回滚、稳定期和旧路径归档 | ERP-22、ERP-23 |

COMPLY-01 至 COMPLY-06 是 P0 数据与证据地基；COMPLY-13 至 COMPLY-15 是任何真实合规写入的 P0 执行地基。未完成前不得继续增加同步 HTTP 写、页面 Promise 批量、内存确认令牌或以总开关开启全部合规动作。

### 09.28 验收标准

#### 官方要求与状态

- 相同官方输入和 mapVersion 产生相同 RequirementSnapshot；partial/empty/unknown 有独立 fixture。
- 每个 Case 可追溯官方原始响应、目标、要求、草稿、证据、预检、命令和回执。
- 列表、详情、顶部计数和批量资格来自同一 Snapshot revision，unknown/stale 不计为通过或 0。

#### 1630/1631 与实拍图

- 官方未返回报告类型时 UI 不展示本地类型、不开放错误类型提交。
- 1630 与 1631 文件、日期、schema 和目标 SKC 分离；跨 SKC/跨类型复用负向测试全部阻断。
- 本体图/包装图角色、labelGroup、上传回执和绑定结果逐项对等；混填、换组和旧 labelId 复用全部失败。

#### 证书、代理、警示语与人工项

- 证书上传/创建/绑定/回读各阶段可恢复，部分成功可解释，过期后自动打开案件但不自动写 SHEIN。
- 代理 type/range/date 和警示语 schema/mapping/exclusion 均由当前官方快照校验。
- unsupported 动作只产生人工任务；人工声明未获官方回读前不显示平台通过。

#### 命令、失败恢复与发布隔离

- 浏览器刷新、Control/Worker 重启、Redis 故障后 Command/Attempt 可恢复，不重复外部调用。
- 发送后超时进入 result_unknown，普通重试按钮不能盲重发。
- 商品 accepted 后合规失败不改变商品发布结论；新 Case 和操作建议准确可见。
- 1/15/50/100 SKC 批量逐项 partial success、原顺序、隐藏选择清理和跨店隔离通过。

#### 安全与上线

- 跨 tenant/store、伪造 mediaId、过期 schema、错误 role、无权限和敏感下载负向测试全部无副作用。
- 正式文件来源索引、Adapter contract、release manifest、Worker/Control 版本、迁移与运行权限全部可核验。
- 金丝雀逐动作与 SHEIN 后台人工核对；页面只在官方证据支持时显示已绑定/审核中/已通过。
- 回滚不删除历史事件、Attempt、Receipt、案件或已接受商品事实。

### 09.29 已确认决策

1. 合规是独立领域，不是商品表上的万能状态或通用表单 section。
2. 当前 SHEIN 官方 RequirementSnapshot 是要求权威，历史交接和本地算法只作参考。
3. 1630/1631 仅使用当前 SKC 官方返回类型，不做本地覆盖判断。
4. 报告、证书、本体图、包装图、代理资料和警示语使用不同角色与回执。
5. 复用由 MaterialApplicability + 当前官方要求决定，不由模板、同 hash 或历史通过决定。
6. 模板只提供候选材料和槽位，不复制平台审核/绑定结果。
7. Requirement、Evidence、Execution、Platform Review 和 Source Health 使用正交状态。
8. `needs_action` 只作运营投影，必须带 reasonCode 和 allowedActions。
9. pre-SKC 与 post-SKC 合规门禁分开，不能预造 SKC 或假完成后置要求。
10. 商品 accepted 与合规结果独立；合规失败不能改写发布为失败。
11. 服务端确定性预检是 Command/handoff 权威，浏览器提示不授权外部写。
12. 合规真实写入使用持久 Command/Event/Outbox，一动作一 Job。
13. 外部调用前持久化 send_started；发送后未知不自动重试。
14. 上传、保存、绑定、审核和回读使用独立 Attempt/Receipt。
15. 写能力按 action/adapter/store/canary 独立启用，不以单总开关证明完整可用。
16. API 不支持的 GCC、产品标识符等进入 ManualComplianceTask，不伪造完成。
17. 当前继续手动刷新，不增加 30 秒、进页或切店自动同步。
18. 工作台采用一致 Snapshot，批量操作逐项 partial success，不保留隐藏选择。
19. 合规材料按敏感文件和 RetentionHold 治理，跨店默认禁止。
20. 渐进迁移、影子对账和金丝雀，不因本板块重做全站 UI 或提前删除 legacy。

### 09.30 明确不做及后续讨论项

本板块明确不做：

- 不用本地尺寸、SKU 规格、包装尺寸、AI 或历史商品决定 1630/1631。
- 不把 HTTP 200、上传成功、草稿保存、预检通过或人工勾选称为 SHEIN 已通过。
- 不把商品发布、商品审核和合规审核重新合成一个状态。
- 不在页面加载、切店、窗口聚焦或 30 秒定时器中自动同步 SHEIN。
- 不让浏览器循环执行批量真实合规写。
- 不用一个 `SHEIN_COMPLIANCE_WRITES_ENABLED` 总开关作为全部动作上线证明。
- 不跨店默认复用证书、报告或实拍图，不以相同 hash 作为授权。
- 不在本板块重做全站前端，也不先引入 Kafka、Temporal 或新微服务集群。
- 不在缺少正式官方来源索引和真实 fixture 时猜 endpoint、字段或删除语义。
- 不物理删除历史合规证据、驳回、回执、人工声明或审计。

正式实施前仍需定稿：

1. 生产当前 SHEIN 官方接口文档版本、各 endpoint 批量/QPS/错误和测试店铺 fixture。
2. 本体图、包装图、证书和代理资料在目标市场/类目下的正式复用范围及平台删除/覆盖语义。
3. 各类证书 `certificateDimension`、有效期和临期提醒阈值。
4. 首批允许金丝雀的动作顺序：建议先单 SKC 实拍图，再单 SKC 报告，最后评审其他写能力。
5. 合规审阅与真实执行是否要求双人审批，以及各角色默认 capability。
6. ManualComplianceTask 的后台操作指引、SLA、负责人和官方复核频率。
7. 敏感材料、原始响应、驳回记录和平台回执的正式保留年限与法律 hold。
8. 合规失效 Webhook 到达后的本地提醒 SLA，以及是否需要邮件/站内通知；该通知不等于自动同步或自动写入。

---

## 板块 10：销量、库存、在途、备货、经营预警与多店经营分析

讨论日期：2026-08-29  
方案状态：方向已确认，待正式实施步骤核准官方合同、数据迁移和行为规格  
关联执行步骤：ERP-03、ERP-04、ERP-05、ERP-06、ERP-07、ERP-08、ERP-10、ERP-11、ERP-13、ERP-17、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23  
关联问题：BUG-INV-001 至 BUG-INV-015

### 10.1 结论

该板块不能继续定位为“经营看板”。商业级目标是建立一个只读、可解释、可追溯的经营决策域：准确保存 SHEIN 官方销量、库存、在途和上下架事实，明确每个数字的来源、截止时间、覆盖率和证据等级，再基于版本化规则生成可售天数、备货建议和经营预警。

核心边界：

1. SHEIN 官方事实、本地衍生指标、人工经营参数和运营结论四层分离。
2. `unknown`、`partial`、`stale`、`not_applicable` 与数值 `0` 分离；没有覆盖率证明不得汇总成完整数字。
3. 全托管当前可用事实以 SKU 销量、库存查询、商品/上架状态和已核准 Webhook 为准；曝光、点击、加购、转化率、销售额等 API 未提供的数据不推造。
4. 备货建议是本地可解释建议，不是 SHEIN 官方建议、采购单或库存写入；本板块默认无 SHEIN 业务写。
5. 页面进入、切店、窗口聚焦和 30 秒定时器均不自动刷新；用户手动刷新由服务端单一 Operation owner 执行。
6. 当前页面、路由和视觉可渐进增强，不因数据治理重做全站前端。

成熟度判断：

- 手动只读刷新、单店任务去重、冷却、限流退避：已有可复用基础。
- 官方销量/库存/在途/上架字段读取：已有可复用基础，但合同、覆盖率和部分结果语义仍需硬化。
- 未知库存保护：SKU 可用库存已有测试；销量缺行、在途部分覆盖和跨店聚合仍不完整。
- 结构化历史事实：表结构部分存在，但经营刷新主要保存最新 JSONB；尚未形成可靠 SKU 日历史和库存时间序列。
- 备货分析：仅有简单缺口提示，不足以作为采购/生产决策。
- 经营预警：有即时规则和页面，没有持久案件、负责人、处理过程、抑制和复盘。
- 多店经营分析：有跨店摘要基础，缺少统一截止、覆盖率、指标版本和可比性门禁。

### 10.2 当前源码与官方资料事实

可保留能力：

1. `server/store-data-sync.js` 统一读取：
   - `POST /open-api/goods/searchProduct`
   - `POST /open-api/goods/query-sku-sales`
   - `POST /open-api/stock/stock-query`
   - `POST /open-api/goods-compliance/skc-label-list`
   - `POST /open-api/goods/spu-info`
2. SKU 销量按最多 100 SKU 分批，经营刷新通过串行请求节流并对 SHEIN `832213`/HTTP 429 有界退避。
3. `stock-query` 已分别读取总库存、可用库存、正式锁、临时锁和在途库存；缺失可用库存保留 `null`，测试证明不会因此制造假缺货预警。
4. 平台上下架状态只在 `statusSource=shein_skc_label_list` 且枚举有效时展示；否则为“待同步”。
5. `WebStoreBusinessService`、`sync_jobs`、BullMQ Worker、单店 claim、60 秒手动冷却和十分钟僵死任务回收形成了可恢复刷新基础。
6. 刷新失败会保留已有快照和错误，不因一次失败删除 last-known-good。
7. V2 总览、商品经营、销量库存、商品详情和经营预警共享 `business-dashboard` 查询 owner；Query key 已包含 tenant/user/store，关闭窗口聚焦、重连和挂载自动刷新。
8. 定时刷新 Scheduler 代码存在，但配置默认关闭；当前用户决策是继续保持关闭。
9. 官方库存文档明确：`invType=PI` 表示 SHEIN 仓实物库存；`warehouseType` 将于 2026-12-31 废弃，应迁移到 `invType` 合同。
10. 官方全托管资料明确未开放曝光、访客、点击率、加购率、支付率等流量分析 API；全托管经营分析当前以 SKU 销量接口辅助补货决策。

当前结构性缺口：

1. `store_business_snapshots.snapshot` 是商品、销量、库存、在途、预警和诊断的最新 JSONB 总包；不同数据源的 cutoff、覆盖率和失败状态没有成为一等事实。
2. `sku_sales_daily` 和 `inventory_snapshots` 已建表，但当前经营刷新只写 `store_sales_daily` 店铺聚合，不写 SKU 日销量和库存历史；连续趋势尚无可靠来源。
3. `sumSales()` 将缺失字段和缺失 SKU 行归零；如果接口成功但只返回部分 SKU，页面可能把未覆盖 SKU 当成零销量。
4. 商品实际库存要求全部 SKU 已知才汇总，方向正确；但商品与店铺在途库存会把已知子集直接求和，未标记 partial，可能低报却看似完整。
5. 销量、库存、上架状态和详情的采集时间不同，却共用一个 `dataDate/syncedAt`；页面无法准确解释单个指标何时、从哪个 endpoint 截止。
6. `store_sales_daily` 使用 `Number(value || 0)` 保存，若上游销量覆盖状态未知，可能把 unknown 固化成正式 0。
7. 现有 `replenishmentGap = max(0, sales7 - actualInventory)` 未考虑在途可信度、供应/生产周期、安全库存、起订量、包装倍数、库存锁定、断货损失、季节性、增长趋势和商品生命周期。
8. 可售天数只按 `sales7 / 7` 估算；无销量时返回 unknown，但没有说明零销量、数据缺失、断货抑制销量和新品样本不足的区别。
9. `sales_drop` 使用当前 7 日与 30 日减 7 日的近似比较，不是真正持久化、非重叠的日序列。
10. 预警每次由快照数组重算，只包含类型/严重度/文案；没有规则版本、案件状态、负责人、确认、稍后处理、解决、复发和证据时间线。
11. `inventory_warning_notice`、`out_of_stock_notice` 等平台事件尚未统一为经营事件与案件；Webhook 更新快照不应替代正式库存读回。
12. 官方返回的 `warehouseInventoryList` 当前未结构化保留，无法按仓库解释可用、锁定、临时锁和在途构成。
13. 跨店总览可能聚合不同截止日期、不同覆盖率和不同指标版本的快照；虽然缺失值显示 `--`，仍缺少可比性门禁。
14. 当前页面部分以 `Number(value || 0)` 判断建议备货是否显示；虽不一定改变数据，但会把 unknown 和 0 在交互层混成同一个 `--`。
15. 正式 API 来源索引和字段交接文件此前在工作区缺失；实施前必须从原始官方资料恢复当前合同，不能只靠历史验收报告。

### 10.3 产品责任边界

本板块负责：

- SHEIN 商品、SKU 销量、库存、在途、仓库明细、上架状态和相关经营 Webhook 的只读采集。
- 原始响应、source receipt、覆盖率、截止时间、数据质量和 last-known-good。
- SKU/SKC/SPU/店铺级规范事实、历史快照、指标计算和一致读模型。
- 可售天数、库存位置、基础补货缺口、策略化备货建议及其解释。
- 缺货、低库存、新品起量、滞销、下架有库存、销量异常、数据过期等经营预警案件。
- 单店与多店只读分析、筛选、导出、任务和预警处理协作。

本板块不负责：

- 商品库存更新、上下架、采购单、备货单、发货单、生产排程或自动补货执行。
- 曝光、访客、点击率、加购率、转化率等官方未开放数据的推算。
- 没有真实价格、结算、成本和退货数据时推算 GMV、利润或 ROI。
- 以 AI 黑盒取代可解释的库存和备货规则。
- 自动定时刷新、页面轮询 SHEIN 或跨店默认批量写。
- 在该板块重做订单、采购、仓储、财务或全站 UI。

### 10.4 目标数据流

```text
SHEIN Read API / verified Webhook
  -> BusinessSourceInbox（raw、trace、contract、target、receivedAt）
  -> BusinessSyncOperation / SourceAttempt（手动刷新 owner、分源进度）
  -> Versioned Normalizer + Coverage Validator
  -> Official Facts
       ProductShelfFact
       SkuSalesWindowFact
       SkuInventorySnapshot
       WarehouseInventorySnapshot
       BusinessEventFact
  -> Metric Engine（版本化、确定性）
       SkuMetricSnapshot
       StoreMetricSnapshot
       FleetMetricSnapshot
  -> Replenishment Policy / Recommendation
  -> BusinessAlertCase / AlertEvent
  -> Consistent Dashboard Snapshot + history API
  -> Overview / Sales & Inventory / Alerts / Product Detail
```

首期继续使用 PostgreSQL、现有 Worker/BullMQ 和 V2 页面，不为该板块先引入 Kafka、ClickHouse、数据湖或新微服务。只有实际规模与查询证据证明 PostgreSQL 不够时再评审分析存储。

### 10.5 四层事实模型

#### 10.5.1 官方事实 Official Fact

由当前 SHEIN 合同和可验证响应直接产生：

- `salesToday`、`salesYesterday`、`sales7`、`sales30`、`salesCutoffDate`
- `totalInventory`、`availableInventory`、`lockedInventory`、`tempLockedInventory`
- `transitInventory`、`outOfStockDemand`
- 仓库级 `warehouseCode` 与对应库存构成
- `shelfStatusCode`、`firstShelfTime`
- 官方 Webhook 的事件类型、数量、业务标识与发生时间

官方事实必须携带 `sourceReceiptId`、contractVersion、fetchedAt、sourceCutoff、target、coverage 和 evidenceLevel，不能被本地建议覆盖。

#### 10.5.2 本地衍生指标 Derived Metric

例如：

- 7 日平均销量
- 可售天数
- 库存风险等级
- 销量趋势信号
- 库存位置和备货缺口

每个指标必须记录 `metricDefinitionVersion`、输入 fact IDs、算法、参数、计算时间和 qualityStatus；UI 明确标“本地分析”。

#### 10.5.3 人工经营参数 Planning Input

例如：生产/采购提前期、安全天数、最小起订量、包装倍数、目标库存天数、季节标签、停产/清仓标记。人工值必须有作用域、版本、操作者、生效时间和审计，不伪装成 SHEIN 数据。

#### 10.5.4 运营结论 Operational Decision

包括采纳/忽略备货建议、分派预警、稍后处理、解决原因和备注。结论不修改历史事实；所有决定可追踪到当时的快照和规则版本。

### 10.6 数据质量与单元格状态

每个可聚合指标至少具有：

`value | qualityStatus | source | cutoffAt | capturedAt | coverageNumerator | coverageDenominator | contractVersion`

`qualityStatus` 首期固定为：

`known | confirmed_zero | partial | unknown | stale | conflict | not_applicable`

规则：

1. `0` 只有在成功响应、目标被覆盖、字段有效且平台明确返回 0 时成立。
2. 缺 SKU 行、缺字段、分页不完整、批次失败、未识别响应和 endpoint 失败均不能转为 0。
3. 部分 SKU 有值时，商品/店铺汇总默认 `partial`；可以展示“已知合计”，但必须同时显示覆盖率，不能称为完整总量。
4. `stale` 保留最后可信值和原截止时间；不能刷新失败后清空，也不能把旧值标成最新。
5. 不适用于当前经营模式/仓库类型的字段使用 `not_applicable`，不是 `0` 或 `unknown`。
6. 冲突值保留各 source receipt，进入 `conflict` 并阻断依赖该指标的建议。

### 10.7 BusinessSourceInbox 与来源合同

每次官方读取或 Webhook 先落原始证据：

- tenant/store/operation/attempt
- endpoint 或 eventType
- target kind/IDs 与请求批次
- request dimensions（`invType`、SKU 列表、页码等）
- contractVersion/normalizerVersion
- raw payload hash、traceId、HTTP/SHEIN code
- requested/returned/missing/unexpected target 数量
- fetchedAt/sourceCutoff/receivedAt
- success/partial/empty/failed/unknown

库存查询实施时只依赖 `invType=PI` 表达 SHEIN 仓实物库存；`warehouseType=1` 进入兼容期并在 2026-12-31 前完成零运行时依赖证明。不能为了兼容同时长期维护两套互相漂移的库存语义。

### 10.8 手动刷新 Operation

1. 页面点击“手动刷新”创建或复用 `BusinessSyncOperation`，返回 `202 + operationId + currentSnapshot`。
2. 同一 tenant/store/dataset 同时只允许一个活动 Operation；60 秒冷却可以保留，但必须返回明确 retryAfter 和现有 operation。
3. Operation 拆分 product、sales、inventory、shelf、detail、webhook-reconcile 等 SourceAttempt，逐项记录批次和覆盖率。
4. 必须数据源失败时 Operation 可 `failed`；可选数据源失败时可 `completed_with_errors`，但对应指标保持 LKG + partial/stale。
5. 页面只轮询/SSE 当前 operation 的有界状态，完成后读取新 Snapshot；不 fan-out SHEIN endpoint。
6. 切店不转移 operation；任务继续绑定原店铺并可在全局任务中心查看。
7. 默认 Scheduler 持续关闭。Webhook 只落事件、标记 dataset dirty 或打开 AlertCase，不自动发起全量 SHEIN 刷新。

### 10.9 商品与 SKU 身份

1. 所有销量、库存和仓库事实使用稳定 `storeId + platformSkuCode` 作为平台目标，并关联规范 `skuId/skcId/spuId`。
2. `supplierSku` 只作可搜索业务标识，不替代 SHEIN `skuCode`；映射来自当前商品详情/规范商品投影。
3. SKU 映射缺失或一对多冲突时，事实保留为 orphan target 并开数据质量事件，不猜归属。
4. 商品聚合只有在其 SKU 集合和覆盖率明确时生成；SKU 列表变化创建新集合版本，不重写历史快照。
5. 已下架、售罄、删除和审核中的 SKU 仍保留历史，是否进入当前经营集合由版本化 inclusion policy 决定。

### 10.10 SKU 销量事实

`SkuSalesWindowFact` 首期保存 SHEIN 已提供的窗口值，而不是把窗口值伪造成逐日销量：

- today
- yesterday
- rolling7
- rolling30
- platformCutoffDate
- fetchedAt
- target coverage

规则：

1. 当前接口每批最多 100 SKU，按当前官方限流配置；请求与返回 target 必须逐项对账。
2. 返回缺少某 SKU 时，该 SKU 销量为 `unknown/partial`，不是四个 0。
3. 单个窗口字段缺失只影响该窗口；不能用其他窗口倒推缺值。
4. 店铺总量只聚合 `known/confirmed_zero`；同时返回 coveredSku/totalSku 和 excludedUnknown。
5. 只有连续保存的有效日快照才能形成历史曲线；今日、7 日、30 日三个聚合值不能画成日趋势。
6. `store_sales_daily`、`sku_sales_daily` 后续保存时必须同时保留质量和来源；现有 NOT NULL DEFAULT 0 表结构需先迁移，禁止直接把 unknown 写 0。

### 10.11 库存、锁定、在途与仓库事实

SKU 库存维度至少分为：

- `totalInventory`
- `availableInventory`
- `lockedInventory`
- `tempLockedInventory`
- `transitInventory`
- `outOfStockDemand`
- `warehouseInventory[]`

规则：

1. 页面“实际可用库存”对应 `totalUsableInventory`；不得混用总库存、虚拟库存或草稿统一库存。
2. 正式锁和临时锁由 SHEIN 消费者/订单行为产生，本板块只读，不提供修改入口。
3. 在途库存没有 ETA 或确认到仓时间时，只显示官方在途数量，不承诺可在补货窗口内使用。
4. 商品/店铺聚合要求所有纳入目标都有质量状态。部分已知时返回 knownSubtotal + coverage，不能把子集和称为完整在途。
5. 保留 `warehouseInventoryList`，以 warehouseCode 解释库存构成；不同仓库、invType 或经营模式不得直接混加。
6. `inventory_snapshots` 需扩展质量、总量/锁定/临时锁/在途/source receipt 后才能成为规范历史表；现有仅 `available_quantity DEFAULT 0` 的结构不能直接承载 unknown。

### 10.12 上下架状态与上架天数

1. 上下架状态只接受当前批准的 SHEIN 精确来源和合法枚举；失败时保留 last-known-good + stale 或显示 unknown，不按销量/库存推断。
2. `firstShelfTime` 与状态分别保存来源和 cutoff；商品详情复用旧时间必须明确标 LKG，不伪装本次读取。
3. `listingDays` 由有效 `firstShelfTime` 与统一业务时区确定性计算，记录算法版本；未知时间不显示 0 天。
4. 状态变化形成历史 fact，预警和生命周期分析引用当时状态，不覆盖旧状态。

### 10.13 历史事实与连续趋势

首期历史层使用 PostgreSQL 分区表：

- `sku_sales_window_facts`
- `sku_inventory_snapshots`
- `warehouse_inventory_snapshots`
- `sku_shelf_status_facts`
- `store_metric_snapshots`

原则：

1. 原始窗口事实 append-only；同一 target/cutoff/contract 的重复响应幂等去重。
2. 每日历史只从真实当日采集生成；漏采日期保留缺口，不插值、不补零。
3. 7/30 日窗口可用于当期运营，不用来伪造过去每天的销量。
4. 库存快照是时点值，不与销量流量值混用。
5. Retention/分区归档按查询和审计需要确定，物理删除必须有汇总保留、hold 和恢复策略。

### 10.14 指标字典与 Metric Engine

建立版本化 `MetricDefinition`：

- metricCode/name/description
- grain（SKU/SKC/SPU/store/fleet）
- unit/currency/timezone
- input facts/quality requirements
- formula/version/rounding
- aggregation rule
- freshness SLA
- unsupported conditions

首期指标：

1. `avg_daily_sales_7 = rolling7 / 7`
2. `days_of_cover_7 = availableInventory / avg_daily_sales_7`
3. `known_inventory_subtotal` 与 `inventory_coverage`
4. `sales_velocity_change`：仅在真实非重叠历史窗口可用
5. `stock_position`：可用库存与官方在途分别展示；是否纳入由策略版本决定
6. `active_sku_count`、`stockout_sku_count`、`low_cover_sku_count`

任何指标输入为 partial/unknown/conflict 时，结果必须继承质量，不得为了显示卡片强制计算。

### 10.15 可售天数

`daysOfCover` 只能作为估算指标：

1. 默认基于近 7 日销量和可用库存，明确显示公式、窗口、截止日和未含因素。
2. `rolling7=0` 时区分：确认零销量、销量 unknown、新品样本不足、断货抑制销量，不统一显示“无限可售”。
3. 当前库存为 0 且销量为正时可售天数为 0；库存 unknown 时结果 unknown。
4. 在途库存默认不进入基础可售天数；可另显示“含在途库存位置”，避免 ETA 不明导致错误安全感。
5. 新品、季节品、活动期和曾断货商品可使用不同策略，但必须版本化且可解释。

### 10.16 备货策略与建议

将当前 `max(0, sales7 - availableInventory)` 改名为“7 日基础缺口”，保留兼容展示但不再称为完整备货建议。

商业级 `ReplenishmentPolicy` 输入：

- demand window/velocity method
- supply or production lead time
- safety days/safety stock
- target cover days
- MOQ
- packaging/carton multiple
- usable stock
- locked/temp locked reference
- official transit quantity and inclusion policy
- product lifecycle（test/scale/stable/clearance/stop）
- manual hold/season/activity factor

建议输出至少包含：

- `baseDemand`
- `leadTimeDemand`
- `safetyStock`
- `availableInventory`
- `transitConsidered`
- `rawGap`
- `roundedRecommendation`
- `confidence/qualityStatus`
- `policyVersion`
- `reasonCodes`

公式必须确定性、可重算、可对比。没有 lead time、MOQ 或库存覆盖时显示“缺少规划参数/数据不足”，不输出貌似精确的建议数量。

### 10.17 地毯类目备货特性

地毯需要 SKU/尺寸级决策，不能只按 SKC 合计：

1. 同一图案不同尺寸的销量速度、成本、包装体积、生产周期和缺货损失不同。
2. 大尺寸库存占用、包装和退货风险高，默认安全库存不能照搬小门垫。
3. 新品起量先小批测试；只有销量、库存周转、毛利和售后风险满足条件才扩大。
4. 节日/季节款需要生命周期和售罄窗口，不能按常青品持续补货。
5. 异形、特殊锁边和定制包装可配置更长 lead time 与包装倍数。
6. 当前板块没有可靠成本/退货事实时，不以“销量高”直接建议大规模备货；相关风险进入建议说明。

### 10.18 经营预警规则

预警分为：

- 库存：缺货、低可售天数、锁定异常、在途长期未变化、下架仍有库存。
- 销量：新品起量、销量下降、持续零销量、异常跳变。
- 数据质量：来源失败、覆盖率不足、快照过期、SKU 映射冲突。
- 平台事件：缺货需求、库存预警 Webhook、上架状态变化。
- 策略：备货参数缺失、建议量超过风险阈值、季节品临近截止。

每条 `AlertRuleVersion` 必须定义 grain、输入、质量门、阈值、严重度、去重窗口、自动解决条件和推荐动作。数据 unknown 不得触发“销量为 0/库存为 0”业务预警，而应触发数据质量预警。

### 10.19 BusinessAlertCase 生命周期

状态：

`open | acknowledged | in_progress | snoozed | resolved | invalidated`

案件至少保存：

- tenant/store/target/ruleVersion
- openedAt/lastObservedAt/dueAt
- severity/priority/owner
- triggering fact/metric/recommendation IDs
- current reasonCodes 和 evidence snapshot
- acknowledge/assign/snooze/resolve/reopen events
- resolution reason、备注和复发次数

规则：

1. 同一 target/rule 的重复命中更新当前案件，不每天生成重复卡片。
2. 指标恢复可自动标“待确认解决”或按规则自动解决，但保留历史。
3. 用户忽略/稍后处理不修改事实，不永久关闭未来复发。
4. 数据质量恢复不能自动证明库存业务风险已解除，二者是不同案件。
5. 预警不能直接修改 SHEIN 商品、库存、上下架或采购状态。

### 10.20 Webhook 与经营事件

1. `out_of_stock_notice`、`inventory_warning_notice` 等只有在正式来源、签名和字段合同核准后进入 `BusinessSourceInbox`。
2. 接收器先验签、幂等落库并快速 2xx；异步 normalizer 创建 `BusinessEventFact`。
3. Webhook 数量可打开 AlertCase 或标记相应 dataset dirty，但不自动调用全量查询，也不直接覆盖最新库存事实。
4. 事件与后续 `stock-query` 可能暂时不一致时显示 conflict/待核对，并保留两类证据。
5. Webhook 重放按 event identity 幂等，不重复增加数量或重复开案件。

### 10.21 单店经营工作台

保留现有路由并升级职责：

1. 总览：核心指标、数据质量、当前风险和待处理任务，不伪造趋势。
2. 商品经营：SKC 列表、状态、销量、库存风险和进入 SKU 详情。
3. 销量与库存：SKU 粒度表、仓库展开、窗口销量、库存构成、可售天数和建议解释。
4. 经营预警：案件列表、负责人、状态、优先级、截止日和处理时间线。
5. 商品详情：同一商品的事实、指标、建议、预警和历史变化，不新增第二套事实拼装。

所有页面顶部统一展示 snapshot revision、各数据源健康、截止日期、覆盖率和手动刷新状态。

### 10.22 多店经营分析

1. 多店汇总默认只读，按用户可访问店铺计算，不因无权限/未授权店铺补 0。
2. 只有 metricDefinitionVersion、单位、经营模式、时间窗口和 cutoff 可比时才直接合计/排序。
3. 每个跨店数字显示覆盖店铺数/目标店铺数、unknown 数、最旧/最新 cutoff 和过期店铺数。
4. 不同 cutoff 的快照默认标“非同一时点”；用户可选择最近共同截止或查看当前最新，但不能隐藏差异。
5. 支持店铺组、标签、市场、商品、SKC/SKU 和风险维度筛选；选择与导出按 tenant/user/store scope 隔离。
6. 跨店备货建议只用于对比和汇总，不直接创建跨店采购/库存写。
7. 同款跨店识别必须使用显式 ProductFamily/商品映射；不能凭标题、图片或 supplierSku 模糊合并。

### 10.23 API 与一致 Snapshot

目标内部 API 使用一致读模型：

```text
GET  /business/snapshots/current
POST /business/refresh-operations
GET  /business/refresh-operations/:id
GET  /business/products
GET  /business/skus/:skuCode/history
GET  /business/metrics
GET  /business/alerts
POST /business/alerts/:id/acknowledge
POST /business/alerts/:id/assign
POST /business/alerts/:id/snooze
POST /business/alerts/:id/resolve
GET  /business/replenishment-recommendations
```

正式 path 在 ERP-07/17 定稿；语义约束为：列表、计数、筛选、分页、导出资格和批量操作全部携带同一 `snapshotRevision/asOf`。前端不得再读取多个 endpoint 后按中文字符串重算总数。

### 10.24 权限、导出与审计

首期 capability：

- `business.read`
- `business.refresh`
- `business.export`
- `replenishment.policy.manage`
- `replenishment.decision.record`
- `alert.acknowledge`
- `alert.assign`
- `alert.resolve`

规则：

1. Viewer 可读；Operator 可按授权处理预警；策略管理仅负责人/经理；跨店导出单独授权。
2. 手动刷新和导出均记录 tenant、user、store scope、筛选、snapshot revision 和结果。
3. CSV/XLSX 导出异步生成、有过期时间和短时下载票据，防止大查询拖垮 Control。
4. 日志不记录店铺 secret、完整原始 payload 或不必要的个人信息。
5. 经营数据跨租户禁止共享；跨店比较只限当前用户可访问范围。

### 10.25 性能与容量

针对当前 2 核 4GB 环境：

1. SHEIN 请求按 endpoint/store 令牌桶和批次限制，Worker 有界并发、公平领取；不要叠加页面并发。
2. 结构化事实表按 tenant/store/target/time 建索引和分区；最新投影与历史查询分离。
3. Dashboard 使用预计算 Snapshot，列表采用游标分页；超过 100 行继续虚拟化，不一次向浏览器返回全部历史。
4. 原始 payload 压缩/归档并设置 retention；高频重复响应以 hash 幂等，不能只增长 JSONB。
5. 跨店汇总从规范 projection 计算并缓存短期结果，cache key 包含 tenant/user/storeSet/metricVersion/asOf。
6. 设立刷新时长、请求数、批次缺失率、快照大小、查询 P95、队列等待和内存峰值预算。

### 10.26 可观测性与运营诊断

Trace 链：

`manualRefresh -> SyncOperation -> SourceAttempt -> SHEIN traceId -> SourceReceipt -> Fact -> Metric -> Recommendation -> AlertCase -> UI snapshot`

关键指标：

- 每店/endpoint 请求数、限流率、失败率和 P95
- requested/returned/missing target 覆盖率
- known/partial/unknown/stale 指标数量
- snapshot age、source cutoff skew、LKG age
- SKU 映射冲突与 orphan facts
- 建议生成率、数据不足率、采纳/忽略率
- 预警打开、确认、解决、复发和超时数量
- 多店汇总覆盖率与不同 cutoff 差值

页面只展示稳定错误码、受影响数据源、旧快照时间和下一步，不泄露上游内部响应或凭证。

### 10.27 迁移与兼容策略

阶段 A：只读基线

- 盘点生产快照、structured tables、Worker/调度开关、页面消费者和真实官方响应。
- 为 sales partial、transit partial、unknown persistence、跨店 cutoff 和预警重复建立失败 fixture。

阶段 B：双写结构化事实

- 现有 JSONB 继续服务页面；同一成功 Operation 在事务内写 SourceReceipt、SKU 销量窗口和库存/仓库事实。
- 影子计算覆盖率、指标和预警，与旧快照逐 SKU 对账，不改变 UI。

阶段 C：一致 projection

- 新 Snapshot API 从结构化事实生成；旧 JSONB 只作兼容和回滚。
- 修正 `sku_sales_daily`、`inventory_snapshots` 的 unknown/quality/source schema 后再启用历史写。

阶段 D：策略与预警案件

- 将旧 `replenishmentGap` 标记为 7 日基础缺口；引入 Policy/Recommendation 和 AlertCase。
- 现有预警页面渐进增加负责人/状态/证据，不改变导航。

阶段 E：多店与退役

- 跨店汇总切换到版本化指标与覆盖率。
- 两个稳定 release、零旧读写引用、回滚演练完成后，旧 warning 数组/快照拼装 owner 才可归档。

迁移期间禁止自动补零、自动生成历史日数据、自动创建 SHEIN 备货单或批量改预警为已解决。

### 10.28 实施交付拆分

| 编号 | 名称 | 核心交付 | 对应 ERP 步骤 |
| --- | --- | --- | --- |
| BIZ-01 | 经营事实基线 | endpoint、原始文档、表、Worker、开关、页面、快照、生产版本和数据质量全图 | ERP-00、ERP-05、ERP-17 |
| BIZ-02 | 官方合同与 fixture | 销量、库存、仓库、上架、Webhook 的字段、限制、错误、退役字段和真实脱敏响应 | ERP-07、ERP-17 |
| BIZ-03 | 失败回归地基 | 销量缺行、库存/在途 partial、unknown、限流、跨店 cutoff、预警重复和重启恢复 | ERP-03、ERP-17、ERP-19 |
| BIZ-04 | Source Inbox/Receipt | raw、trace、target coverage、cutoff、contract/normalizer version 和 LKG | ERP-06、ERP-10、ERP-17 |
| BIZ-05 | 手动刷新 Operation | 单 owner、逐来源进度、去重/冷却、部分失败、任务中心和默认无 Scheduler | ERP-08、ERP-17 |
| BIZ-06 | 商品/SKU 身份 | platformSkuCode 映射、SKU 集合版本、orphan/conflict 和历史保留 | ERP-04、ERP-06、ERP-17 |
| BIZ-07 | 销量窗口事实 | SKU 目标对账、窗口质量、cutoff、结构化历史和 unknown-safe 聚合 | ERP-06、ERP-17 |
| BIZ-08 | 库存/仓库事实 | 可用/总量/锁定/临时锁/在途/缺货需求、warehouse 和 partial-safe 聚合 | ERP-06、ERP-17 |
| BIZ-09 | 上架状态事实 | 精确来源、firstShelfTime、状态历史、listingDays 和 stale 语义 | ERP-06、ERP-10、ERP-17 |
| BIZ-10 | 指标字典/Engine | grain、unit、formula、quality propagation、version 和一致 Snapshot | ERP-04、ERP-06、ERP-17 |
| BIZ-11 | 历史与趋势 | SKU 日事实、库存时点、真实缺口、分区/retention 和趋势 API | ERP-06、ERP-17、ERP-19 |
| BIZ-12 | 备货策略 | lead time、安全库存、MOQ、包装倍数、生命周期和人工参数治理 | ERP-06、ERP-17 |
| BIZ-13 | Recommendation | 输入证据、公式分解、置信度、policy version、采纳/忽略记录 | ERP-13、ERP-17 |
| BIZ-14 | AlertRule/Case | 版本规则、去重、owner/SLA、确认/稍后/解决/复发和证据时间线 | ERP-06、ERP-13、ERP-17 |
| BIZ-15 | Webhook 经营事件 | 验签/幂等、缺货/库存预警事件、conflict 和不自动外部刷新 | ERP-10、ERP-17 |
| BIZ-16 | 单店工作台 | 总览、SKU 表、仓库构成、历史、建议解释和预警协作渐进升级 | ERP-13、ERP-17 |
| BIZ-17 | 多店分析 | 同版本/单位/cutoff 可比性、覆盖率、店组/标签和只读汇总 | ERP-17 |
| BIZ-18 | 权限/导出/安全 | capability、异步导出、短时票据、审计和跨租户/店铺负向测试 | ERP-17、ERP-19、ERP-21 |
| BIZ-19 | 性能/恢复验收 | 10/50/100 店、100/1k/10k SKU、限流、断线、Redis/Worker/DB 故障和 2 核 4GB 预算 | ERP-19、ERP-21 |
| BIZ-20 | 金丝雀与遗留退役 | 单店影子、跨店放量、指标对账、回滚、稳定期和旧 JSON owner 归档 | ERP-20、ERP-22、ERP-23 |

BIZ-01 至 BIZ-10 是任何经营数字进入页面和聚合的 P0 数据地基；BIZ-12 至 BIZ-14 在给出商业备货建议和可协作预警前必须完成。未完成前只能保留现有只读基础缺口和即时提示，不得升级成“智能补货”或自动执行。

### 10.29 验收标准

#### 官方事实与数据质量

- 相同官方响应和 normalizerVersion 产生相同事实；requested/returned/missing/unexpected target 可逐项对账。
- 销量缺行、库存字段缺失、部分 SKU 在途、分页不完整、接口 partial 和冲突不会被写成 0 或完整汇总。
- 每个页面数字可追溯 source receipt、cutoff、capturedAt、coverage 和 metricDefinitionVersion。
- `warehouseType` 退役前完成 `invType=PI` 金丝雀和零旧依赖证明。

#### 历史、指标与建议

- 连续趋势只使用真实保存的日/时点事实；缺口可见，不插值、不由 7/30 日窗口反推。
- 可售天数在零销量、未知销量、未知库存、库存 0、新品和断货抑制场景结果正确且可解释。
- 基础缺口与策略化建议分开；缺 lead time/MOQ/包装倍数/覆盖率时不输出伪精确建议。
- 地毯 SKU/尺寸级建议可追溯策略、输入、取整和在途是否计入。

#### 预警与协作

- unknown 只触发数据质量预警，不触发“库存为 0/销量为 0”。
- 同一目标同一规则不重复开卡；确认、分派、稍后、解决、复发和规则升级保留完整时间线。
- Webhook 重放幂等，事件不直接覆盖库存快照，也不自动触发全量 SHEIN 查询。
- 预警处理不修改商品、库存、上下架、采购或 SHEIN 数据。

#### 手动刷新与多店

- 进页、切店、聚焦和 30 秒定时器不调用 SHEIN；手动刷新复用单一 Operation，部分失败保留 LKG 和分源错误。
- 10/50/100 店与 100/1k/10k SKU 场景下限流、公平、刷新恢复、分页和内存预算通过。
- 跨店汇总展示覆盖店铺、unknown、cutoff skew 和过期数；不可比指标不强制合计。
- 切账号、切店、多标签页、旧请求晚到和导出任务均不串 scope。

#### 安全与上线

- 跨 tenant/store、无 capability、伪造 snapshotRevision、导出越权和缓存污染负向测试全部零副作用。
- Worker/Control/migration/normalizer/metric definition 版本在 release manifest 可核验。
- 金丝雀逐店与 SHEIN 后台库存/销量人工抽样核对；回滚不删除原始响应、事实、建议、预警或运营决定。

### 10.30 已确认决策、明确不做及后续讨论项

已确认决策：

1. 该板块是经营事实与决策域，不只是 Dashboard UI。
2. 官方事实、本地指标、人工参数和运营决定四层分离。
3. unknown/partial/stale/not_applicable 与 0 分离，覆盖率是一等数据。
4. SKU 是销量和库存最小经营粒度；SKC/SPU/店铺只做有覆盖证明的聚合。
5. 当前销量窗口不伪造成日趋势；未来趋势只用持久真实日快照。
6. 可用、总量、正式锁、临时锁、在途和仓库库存分开。
7. 在途无 ETA 时不默认计入基础可售天数。
8. 当前简单公式改称 7 日基础缺口，不冒充完整备货建议。
9. 商业备货建议必须版本化、可解释，并纳入 lead time、安全库存、MOQ、包装倍数和生命周期。
10. 地毯按尺寸 SKU 决策，大尺寸、季节款和新品使用不同策略。
11. 预警使用持久 AlertCase，不再只是一组每次重算的卡片。
12. 数据质量预警与库存/销量业务预警分离。
13. Webhook 只落事件/开案件/标 dirty，不直接覆盖库存，也不自动发起全量刷新。
14. 当前继续手动刷新，不增加 Scheduler、30 秒或页面事件自动同步。
15. 多店只聚合可比指标，并展示覆盖率、cutoff 和 unknown。
16. 官方未开放的流量、转化和全托管订单分析数据不推造。
17. 没有准确价格、成本、结算和退货数据时不计算 GMV、利润或 ROI。
18. 本板块无库存、上下架、采购、备货单或其他 SHEIN 业务写。
19. 渐进结构化双写与影子对账，不推倒现有页面和 Worker 基础。
20. 旧 JSON 快照和即时 warning 只有零消费者、两个稳定 release 和可回滚证明后才退役。

明确不做：

- 不把缺行、空响应、接口失败、无权限、未同步或 stale 数据显示为 0。
- 不把部分 SKU 在途之和称为商品/店铺完整在途。
- 不把 7 日销量减库存称为智能补货。
- 不用标题、图片或 supplierSku 猜同款跨店关系。
- 不由销量/库存推断 SHEIN 上下架或商品审核状态。
- 不把当前 7/30 日聚合值画成连续历史曲线。
- 不因 Webhook 到达立即自动刷新所有店铺。
- 不让浏览器直接并发调用 SHEIN 或运行备货算法唯一真相。
- 不在该板块启用库存更新、上下架、采购、备货单或自动执行。
- 不在该板块重做全站 UI 或提前引入重型分析基础设施。

正式实施前仍需定稿：

1. 当前生产店铺 `query-sku-sales` 对缺 SKU、零销量、`dt` 和重复 SKU 的真实响应 fixture。
2. `stock-query` 在全托管 PI 模式下各字段、仓库列表、在途和缺货需求的真实覆盖及 `invType` 切换金丝雀。
3. `inventory_warning_notice`、`out_of_stock_notice` 的当前正式事件合同、订阅状态和业务含义。
4. 地毯各产品线/尺寸的生产或采购 lead time、MOQ、包装倍数、安全天数和季节生命周期默认值。
5. 在途库存何时允许计入建议、是否有 ETA/采购单事实可交叉证明。
6. 预警 owner、SLA、稍后处理上限、自动解决和升级通知规则。
7. SKU 销量/库存原始事实、日汇总、指标、建议和预警的保留年限。
8. 多店分析首期是否只比较当前最新，还是增加用户选择的共同截止日；默认建议先显示最新并明确 cutoff skew。
9. 下一板块的采购/备货单/发货履约域如何消费 Recommendation，而不让经营分析直接执行平台写。

## 板块 11：采购、备货、仓库、发运物流与履约闭环

### 11.1 结论

该板块不是“做几个采购单和发货单页面”，而是建立从需求决定到 SHEIN 到仓结果的商业履约域。完整链路必须是：

`经营建议/平台需求 → 内部备货计划 → 审批 → SHEIN 采购单或手工备货单 → 发货资格 → 发货计划 → 包裹/标签 → 平台发货单 → 取件/运输 → 到仓/质检/入库 → 数量对账 → 异常案件 → 关闭`

商业级目标：

1. 支持两种来源不同但最终汇合的履约模式：SHEIN 下发急采/备货/JIT 采购单，以及内部 Recommendation 转成的人工作业计划、经授权后创建平台备货单。
2. Recommendation、内部计划、平台采购单、平台发货单和实际到仓结果相互关联但绝不合并为一个万能 `order/status`。
3. 从 `needQuantity` 到 `storageQuantity/defectiveQuantity` 的每个 SKU 数量有来源、单位、时点和不可变变动记录。
4. 页面只在平台 Receipt 或官方回读证明后显示“已创建发货单、已送货、已收货、已入库”；HTTP 200、按钮完成或打印成功不是履约成功。
5. 所有 SHEIN 业务写进入持久 Command/Event/Outbox/Worker，具备幂等、发送边界、`result_unknown`、官方回读、权限、审批和金丝雀。
6. 地毯按尺寸 SKU 管理备货、箱规、重量、体积、折叠/压缩和质检风险，避免大尺寸资金占用、体积重和到仓差异被 SKC 汇总掩盖。
7. 当前不增加 30 秒、进页、切店、聚焦或 Scheduler 自动同步；Webhook 只落事件并标记待刷新，用户通过单一服务端手动刷新 Operation 获取官方新状态。

### 11.2 当前源码与官方资料事实

当前事实：

1. V2 目前没有完整采购/发货/履约工作台，也没有规范的采购单、发货单、包裹、数量账本和履约案件服务。
2. 当前“建议备货”只读取经营快照中的 `replenishmentGap`，属于 7 日基础缺口，不是采购或履约单据。
3. `server/webhook-ingress.js` 已登记 `/purchase_order_notice`、`/delivery_modify_notice`、`/logistics_forecast_result_notice`、采购退货事件，但现阶段不能证明已形成完整规范投影和页面闭环。
4. 官方能力矩阵将采购、发货和退货列为已归档、未进入当前 V2 前端范围；写能力保持冻结。
5. 当前本地原始官方文档可核验：
   - `GET /open-api/order/purchase-order-infos`：最多 200 单号、分页最大 200、时间范围不超过 60 天，返回急采/备货/JIT 和 SKU 数量链。
   - `GET /open-api/shipping/basic`：发货地址、发货方式、物流/车队、打包类型、发货路径和供应商仓库。
   - `POST /open-api/shipping/orderToShipping`：由采购单生成发货单，涉及全部 SKU、实际发货量、地址、仓库、包裹、装箱、物流、预约和尺寸重量。
   - `GET /open-api/shipping/delivery`：按发货单或时间查询发货单、SKU 数量、运单、包裹、取件与到货信息。
6. 能力矩阵还记录 JIT 母子单、物流产品、预估运费、货代、收货仓、修改/取消发货单、打印面单/条码、手工下备货单、备货审核和智能拆包；这些接口在正式实施前仍需恢复当前官方原文、方法、字段、错误码、权限和真实脱敏 fixture。
7. `purchase-order-infos` 的全托管状态明确为 2 已下单、3 发货中、4 已送货、5 已收货、7 已退货、8 已完成、10 已作废；中文 `statusName` 仅展示，不能参与业务状态判断。
8. 采购单数量不是一个数字：`needQuantity/orderQuantity/deliveryQuantity/receiptQuantity/storageQuantity/defectiveQuantity` 必须分别保留。
9. 平台合单存在严格约束，包括采购单类型、收货大仓、预估收货仓、备货类型、国家市场、安检标签、品类和订单状态；不能由前端随意勾选后直接尝试。
10. 创建发货单官方文档包含按物流产品变化的包裹重量/尺寸、预约取件、装箱明细和数量规则；示例字段与文档字段有差异时必须以当前正式合同和真实 fixture 为准，不猜字段。

### 11.3 产品责任边界

本板块负责：

- SHEIN 采购单、JIT 母子单、备货审核、发货基础、物流产品、收货仓、发货单和履约 Webhook 的只读采集与官方投影。
- 内部备货计划、审批、SKU 数量调整、仓库/物流/包裹规划和执行交接。
- 已核准的手工备货单创建、发货单创建、修改/取消和打印类 SHEIN 命令。
- 从采购需求、计划量、发货量、收货量、入库量、次品量到剩余量的数量账本和差异案件。
- 发货标签、箱唛、条码、物流面单的生成、访问、打印审计和版本绑定。
- 多店、多采购单、多仓库、多包裹、多运单、拆单/合单和 JIT 母子关系。
- 到期、缺货、少发/多发、未取件、运输超时、到仓差异、次品和作废等履约异常。

本板块不负责：

- 自动采用经营 Recommendation、自动创建 SHEIN 备货单或自动发货。
- 供应商原材料采购、工厂排产和生产制造的完整 MES；首期只保留外部引用、预计完成和人工证明。
- 将 SHEIN 采购单当作消费者订单或推造终端买家数据。
- 退货退款、报废、索赔、售后责任和财务结算的完整闭环；这些进入板块 12。
- 用发货或入库数量直接覆盖板块 10 的官方库存快照。
- 在履约功能实施时重做全站导航、品牌视觉、商品编辑器或审核中心。

### 11.4 目标领域拓扑

目标拓扑分为六层：

1. 官方来源层：Webhook Inbox、采购单读取、JIT 关系、发货基础、物流产品、仓库和发货单读取。
2. 官方事实层：PurchaseOrder、PurchaseOrderLine、DeliveryOrder、DeliveryLine、OfficialWarehouse/LogisticsOption 与不可变 Receipt。
3. 内部决策层：FulfillmentDemand、ReplenishmentPlan、Approval、ShippingPlan 和 PackagePlan。
4. 执行层：FulfillmentCommand、Event、Outbox、Dispatcher、Action Worker、Attempt 和 PlatformReceipt。
5. 对账层：QuantityLedger、Reconciliation、FulfillmentExceptionCase、SLA 和时间线。
6. 体验层：履约工作台、一致 Snapshot API、任务中心、诊断台、打印中心和导出。

禁止浏览器直接调用 SHEIN、直接计算最终可发资格或成为任务唯一 owner。

### 11.5 双履约模式

模式 A：平台需求驱动

1. SHEIN 下发急采、普通备货或 JIT 子单。
2. 系统保存官方采购单/行和截止时间。
3. 运营确认产能、可发量、仓库、包装和物流。
4. 形成内部 ShippingPlan，经预检和授权后创建平台发货单。
5. 官方发货单、取件、到仓、质检和入库回读推进履约。

模式 B：内部计划驱动

1. BIZ Recommendation 或人工需求创建 ReplenishmentPlan 草案。
2. 运营调整 SKU 数量、计划完成日和原因；审批后形成明确平台动作候选。
3. 只有当前合同支持、店铺具备 capability 且用户再次确认时，创建 SHEIN 手工备货单。
4. 平台返回/审核后形成正式采购单，再进入与模式 A 相同的发货链。

两种模式共用商品/SKU 身份、数量账本、权限、命令、回读和异常系统，但不得把内部计划编号冒充平台采购单号。

### 11.6 真相层级

从高到低：

1. SHEIN 官方主动查询和签名 Webhook 的不可变原始回执。
2. 由当前 Adapter/Normalizer 生成的规范 PurchaseOrder/Delivery Projection。
3. 内部已批准的 Plan/Command 与操作人决定。
4. 本地衍生的剩余量、逾期、装箱建议和风险标签。
5. 页面临时输入、筛选、选中和草稿。

低层不得覆盖高层。Webhook 事件名称、HTTP 成功、队列完成、打印成功、人工勾选或本地推断均不能单独证明平台状态。

### 11.7 目标领域对象

核心对象：

- `FulfillmentDemand`：需求来源、目标 SKU、建议量/平台需求量、原因、证据和状态。
- `ReplenishmentPlan` / `ReplenishmentPlanLine`：内部草案、版本、SKU 数量、交期、来源 Recommendation 和审批。
- `OfficialPurchaseOrder` / `PurchaseOrderLine`：平台采购单号、类型、JIT、标签、仓、时限、状态和全部官方数量。
- `JitOrderRelation`：母单、子单、数量和官方关系 Receipt。
- `ShippingEligibilitySnapshot`：某一组采购单在当前 revision 可否合单、阻断原因和允许动作。
- `ShippingPlan` / `ShippingPlanLine`：内部发货方案、采购行分配、实际发货量、仓库、方式和 revision。
- `PackagePlan` / `PackageItem`：包裹/箱唛、序号、长宽高、实重、体积重、SKU 装箱明细和标签版本。
- `OfficialDeliveryOrder` / `DeliveryLine`：平台发货单号、运单、包裹、取件/预计到货/实际到货和 SKU 数量。
- `WarehouseOptionSnapshot` / `LogisticsOptionSnapshot`：由当前平台返回、带 scope/有效期/来源的可选项。
- `FulfillmentCommand` / `Attempt` / `Receipt`：平台写入的唯一执行事实。
- `QuantityLedgerEntry`：每个 SKU、采购行、发货行和对账阶段的不可变数量变化。
- `FulfillmentExceptionCase`：可分派、可解决、可复发的异常案件。

所有对象必须含 tenantId、storeId、稳定内部 ID、平台 ID、source/contractVersion、createdAt/updatedAt 和审计主体；平台 ID 只能在对应店铺作用域内唯一。

### 11.8 正交状态机

至少分开：

1. 需求状态：draft、proposed、approved、rejected、converted、expired、cancelled。
2. 官方采购状态：official code + unknown，不复用内部状态。
3. 发货计划状态：draft、preflight_blocked、ready、authorized、handed_off、cancelled。
4. 命令执行状态：created、queued、claimed、send_started、accepted、known_failed、result_unknown、reconciled。
5. 官方发货状态：由发货单和采购单官方 Receipt 规范化，不从本地命令推断。
6. 包裹/标签状态：planned、generated、printed、voided；打印不代表已发货。
7. 对账状态：pending、matched、quantity_mismatch、identity_conflict、source_stale。
8. 异常案件状态：open、acknowledged、assigned、snoozed、resolved、reopened、cancelled。

UI 可以聚合成“待处理、待发货、运输中、到仓异常”等运营分区，但必须返回稳定 reasonCode、allowedActions 和底层状态证据。

### 11.9 SKU 数量账本与守恒关系

每个 PurchaseOrderLine 分别保存：

- 平台需求量 `needQuantity`。
- 下单量 `orderQuantity`。
- 已创建发货量/平台累计送货量 `deliveryQuantity`。
- 当前 ShippingPlan 拟发量。
- 官方收货量 `receiptQuantity`。
- 官方入库量 `storageQuantity`。
- 官方次品量 `defectiveQuantity`。
- JIT 母单已转子单、未转子单和子单已发量。

规则：

1. 所有数量必须是整数、SKU 粒度、来源明确；缺失保持 unknown，不能 `|| 0`。
2. 本地“剩余可发”是带公式版本和 source cutoff 的衍生值，不覆盖官方数量。
3. 部分发货、拆单、合单和取消通过追加式 Ledger Entry 表达，不修改历史记录伪造当前结果。
4. 收货、入库、次品可能不同；差异必须开 Case，不自动用其中一个覆盖另一个。
5. 跨采购单/跨 SKU 汇总必须带覆盖率和单位；unknown 行存在时只展示已知小计。
6. 每个计划确认前展示本次发货量、累计发货量、平台待发量和超发/少发风险。

### 11.10 官方采购单采集与投影

1. 手动刷新创建单一 `FulfillmentRefreshOperation`，按更新时间增量窗口和稳定分页读取；不由页面并发 fan-out。
2. 保存 raw response、traceId、请求时间范围、页码、requested/returned 和 contract/normalizer version。
3. 同一事务提交 Receipt、PurchaseOrder、Lines、JIT Relation、current pointer 和 Outbox。
4. 60 天查询窗口拆分后必须检测重叠、遗漏和分页漂移；结果按 storeId + orderNo 幂等。
5. `status` 官方 code 是状态权威；`statusName/typeName` 只本地化展示。
6. `1970-01-01` 等平台占位时间规范为 unknown/absent，并保留 raw，不显示为真实业务时间。
7. 空列表只有在请求成功、分页完整、范围明确时才是 confirmed empty；失败保留 last-known-good。
8. Webhook 仅落 Inbox、关联候选 orderNo 并标记 source dirty；当前仍由用户手动刷新完成官方核对。

### 11.11 内部备货计划与审批

1. BIZ Recommendation 只能创建预填 Plan Draft，必须冻结 recommendationId、policyVersion、inputSnapshot 和建议解释。
2. 人工可调整 SKU 数量、原因、计划完成日、供应来源、MOQ/包装倍数和备注，任何调整形成 Plan Revision。
3. 审批至少核对需求证据、库存/在途质量、SKU 尺寸、产能、交期、包装、资金占用和目标店铺。
4. 缺少必要参数、Recommendation 已过期、SKU 下架/冲突或店铺未授权时不得进入平台命令。
5. 驳回、撤销和过期保留审计；不删除 Recommendation，也不改写经营事实。
6. 首期默认一人提交、一名有 capability 的负责人确认；双人审批按数量/金额/高风险规则启用，不设计任意工作流 DSL。

### 11.12 手工备货单创建边界

`/open-api/idms/create-order` 等能力只有完成当前官方合同恢复和单店只读验证后才能进入写入评审。

执行前必须：

- 明确店铺、经营模式、SKU、数量、仓、场景和平台资格。
- 通过服务端确定性 Preflight，输出字段级 blocker/warning 和影响预览。
- 使用 `fulfillment.replenishment.create` 独立 capability、动作级开关、一次性授权和金丝雀。
- 冻结 Plan Revision 与 Payload Fingerprint，创建持久 Command；页面不得现场重建 payload。
- 平台未返回正式单号时只显示“已提交，待核对”或 `result_unknown`，不得生成本地假采购单。
- 平台审核、下发或拒绝通过官方读取/Webhook 形成新 Receipt，不由命令 accepted 直接推断。

### 11.13 发货资格与合单规则

ShippingEligibilityEngine 是确定性服务端规则，至少检查：

1. 同 tenant、store 和经营模式。
2. 当前官方采购单状态允许发货，且不在作废/退货冲突中。
3. 急采与备货类型相容；JIT 母单不能直接当普通子单发货。
4. `storageId`、`recommendedSubWarehouseId`、`prepareTypeId`、`countryMarket` 等当前官方合单条件相容。
5. 安检等 OrderLabel、成衣/非成衣等品类限制相容。
6. 每个采购单要求的 SKU 集合完整，数量满足平台和首单规则。
7. 发货基础、地址、供应商仓、物流产品和收货仓快照仍有效。
8. 同一采购单/发货单没有另一活动 Command 或冲突锁。
9. 选中集合绑定同一 eligibilityRevision；任一行变更使旧选择失效。

规则版本、输入 Receipt、每个 blocker 和 allowedAction 必须可追溯。不得依赖中文错误消息或失败后试错来决定合单。

### 11.14 发货计划与包裹模型

1. ShippingPlan 从 eligible 采购行创建，逐 SKU 指定实际发货量。
2. 一个 Plan 可包含多个采购单，但必须属于同一合单组；一个采购单可分多次发货，保留分配历史。
3. `packageType`、`shippingRoute`、`deliveryType`、地址、供应商仓、子仓、物流产品/货代和预约时间均来自当前 Option Snapshot。
4. 直送且要求装箱明细时，每个 PackageItem 的 SKU 数量之和必须等于对应计划行数量。
5. 包裹序号稳定，从平台合同要求的基数生成；包裹数、总重量和逐包重量/尺寸一致性由服务端校验。
6. 体积、重量、箱规和包装图属于 Plan Revision，不写回 ProductVersion 或平台库存事实。
7. 修改计划产生新 revision；已 handoff 的 revision 不可覆盖，只能创建修改/取消 Command。

### 11.15 仓库、地址、物流与预约选项

1. Official Warehouse、Supplier Warehouse、Shipping Address、Delivery Type、Carrier、Fleet、Freight Forwarder、Channel 和 Logistics Product 分别建模。
2. 每个 Option 保存官方 ID、名称、scope、支持场景、限制、capturedAt、expiresAt 和 Receipt；名称不能替代 ID。
3. `/shipping/basic` 的地址与可用物流有关，变更地址后必须重新计算选项和 eligibility。
4. 禁止依赖旧固定佛山仓、硬编码物流公司、缓存中文名称或示例值。
5. 预估运费只作为带来源/币种/时效的估算，不等于最终结算；字段冲突未核准时保持 unsupported。
6. 预约取件/到仓时间统一以明确时区保存和展示，过期、平台工作日规则和最小提前量由版本化规则校验。
7. Option Source 失败保留 last-known-good 但标 stale；stale 选项不能授权新的平台写。

### 11.16 持久命令管线

适用动作：创建手工备货单、创建发货单、修改/取消发货单、请求平台标签/面单以及未来核准写动作。

统一流程：

1. 服务端验证 capability、店铺连接、Plan Revision、Eligibility Revision 和动作级开关。
2. 在同一数据库事务创建 Command/Event/Outbox/Audit。
3. Dispatcher 以确定性 jobId 投递；一 Command 一 Queue Job。
4. Worker 领取 lease，重新验证当前 store credential、合同版本和冲突锁。
5. 写 `send_started` 后才调用 SHEIN Adapter，并保存 trace、HTTP/平台 code 和脱敏 Receipt。
6. 明确失败写 `known_failed`；平台接受写 `accepted_pending_readback`；发送后超时写 `result_unknown`。
7. 官方只读回查/Webhook 归并为 reconciled 或 conflict，不由队列完成直接改官方状态。

浏览器只创建/确认命令并订阅 Operation Snapshot；断线、刷新或切店不影响服务端任务，也不转移 storeId。

### 11.17 幂等、发送边界与结果未知

1. Command identity 至少包括 tenant/store/action/business target/planRevision/payloadFingerprint。
2. 重复点击复用活动 Command，不创建第二次平台写。
3. 通用队列 retry 只允许发生在 `send_started` 前；发送后自动尝试次数为 0。
4. `result_unknown` 锁定采购单/发货单业务键的新同类写，只允许只读回查、后台人工核验或经批准的新 child Attempt。
5. Adapter 若有可验证平台幂等键，必须显式记录其作用域、有效期和当前合同；不能凭相同请求体假定幂等。
6. 修改/取消同一发货单严格串行，晚到回执不得覆盖更新的官方 revision。
7. accepted 只证明平台接收当前动作，不证明已取件、已到仓、已质检或已入库。

### 11.18 官方回读、Webhook 与状态归并

1. PurchaseOrder、DeliveryOrder 和 Logistics 各有独立 SourceReceipt、健康、cutoff 和 LKG。
2. Webhook、主动查询和命令 Receipt 统一进入 Inbox/Normalizer，但保持来源证据和优先级。
3. 归并使用 storeId + 精确平台 ID + source revision/updateTime；歧义进入 unmatched/conflict，不按“最新一条”猜。
4. Receipt、match、projection、current pointer 和对账事件单事务提交，可从 raw Inbox 重放。
5. 采购状态与发货状态分别单调归并；作废、退货等分支以新官方事实表达，不覆写历史。
6. 列表、计数、详情、数量、allowedActions 和异常来自同一 fulfillmentSnapshotRevision。
7. 手动刷新 partial failure 逐 source 表达；旧可信数据保留并显示 stale，不弹一个覆盖全部结果的通用失败。

### 11.19 标签、条码、箱唛与打印中心

1. 商品条码、箱唛/包裹面单、发货单面单和物流商面单是不同 ArtifactType，不能混用。
2. 每次生成保存 action、target、packageRevision、platform receipt、文件 hash/MIME/页数、生成时间和有效期。
3. 文件进入私有对象存储，使用短时下载票据；浏览器不长期缓存完整 PDF/标签字节。
4. 打印动作记录 user/device 可用摘要、份数和时间；“已打印”是本地操作事实，不是平台发货状态。
5. Plan/Package 修改后旧标签进入 superseded/voided，不允许无提示继续打印。
6. 批量打印按目标逐项返回 partial success；失败项可重新生成，成功项不重复请求平台。
7. 打印服务故障不得改写发货单或数量账本。

### 11.20 地毯品类包装与物流约束

地毯按尺寸 SKU 和包装方案管理：

1. 大尺寸、长条、浴室垫、小门垫和不规则地毯分别维护折叠/卷装/压缩策略与默认箱规，不用 SKC 平均值。
2. 保存净重、包装后实重、长宽高、体积重算法/除数、包材和单包件数；缺实测时标 unknown，不生成精确物流承诺。
3. 防水袋、压缩袋、纸箱、护角、标签和说明卡等包材作为 Plan 输入，未来财务模块计算成本。
4. 控制折痕、卷边、受潮、异味、锁边挤压、图案污染和包装破损风险；高风险方案必须人工确认。
5. 物流产品的单包重量/尺寸限制以当前官方 Option 为准，不把某一承运商示例当全局规则。
6. 首单、安检、每尺码至少发 1 件等平台要求作为 eligibility 规则，不由运营口头绕过。
7. 到仓次品或数量差异保留对应 size SKU、Package、Delivery 和包装方案，用于板块 12 的质量/索赔复盘。

### 11.21 履约异常案件

首期案件类型：

- 采购单临近/超过要求发货或收货时间。
- 平台需求量与人工计划量冲突。
- SKU 身份冲突、JIT 母子单异常或采购单状态不可发。
- 合单条件冲突、仓/地址/物流选项 stale。
- 发货数量不足、超发、平台拒绝或发送后未知。
- 标签生成失败、包裹数量/重量/尺寸不一致。
- 未按预约取件、物流长时间无进展、预计到仓超时。
- 发货量、收货量、入库量、次品量不一致。
- 采购单作废、退货分支或发货单修改冲突。

Case 包含 owner、priority、SLA、source receipt、影响 SKU/数量、允许动作、确认/分派/稍后/解决/复发和完整时间线。系统不得自动把“来源恢复”当业务异常解决，也不得自动创建补发/退货命令。

### 11.22 多店、多仓与团队协作

1. 所有列表默认单店；跨店总览只显示数量、逾期和风险汇总，不提供跨店一键发货。
2. 采购单、计划、仓库、物流、包裹、命令、标签和案件全链路带 storeId；切店清空当前 selection/eligibility token。
3. 供应商仓库属于店铺授权返回的官方选项，不因同名自动跨店合并。
4. 内部工厂/仓库可作为 tenant-scoped 参考实体，但必须通过明确 Mapping 关联平台 supplierWarehouseId。
5. 任务分配可按店铺组、仓库、商品线和角色；权限始终取店铺/动作交集，不因被分派而获得未授权数据。
6. 多店任务中心显示原店铺、单据、截止时间和状态；切店不取消已交接任务。
7. 跨店导出异步生成、短时下载、按授权过滤并记录 snapshotRevision。

### 11.23 权限、审批与危险动作

建议能力词典：

- `fulfillment.read`
- `fulfillment.refresh`
- `fulfillment.plan.create/edit/submit`
- `fulfillment.plan.approve/reject`
- `fulfillment.replenishment.create`
- `fulfillment.shipping.create`
- `fulfillment.shipping.modify`
- `fulfillment.shipping.cancel`
- `fulfillment.label.generate/print`
- `fulfillment.exception.manage`
- `fulfillment.export`
- `fulfillment.diagnostics.read`

规则：

1. read、plan、approve、execute、cancel、print 和 diagnose 分开授权。
2. 创建/修改/取消平台单据是高风险动作，必须服务端 capability、CSRF/Trusted Origin、速率限制、目标确认和完整审计。
3. 计划提交人与审批人默认可相同，但高数量、高体积/金额、急采超时或跨多单合并可要求第二人。
4. Viewer/Reviewer 无平台写；Operator 不能管理 capability 或动作开关。
5. 失效权限立即阻断新命令；已 `send_started` 的命令不假装撤回，按原授权事实继续记录和回读。
6. 任何“批量取消、批量修改、批量创建发货单”首期默认不存在，真实需求和风险评审后逐动作开放。

### 11.24 履约工作台信息架构

保留现有全站壳和品牌，新增渐进式“采购与履约”工作台：

1. 总览：待确认采购、临期、待发货、运输中、到仓差异、异常和数据新鲜度。
2. 采购单：急采/备货/JIT、官方状态、截止时间、SKU 数量链和标签。
3. 备货计划：Recommendation 来源、人工计划、审批、版本和平台转换状态。
4. 发货计划：eligible 分组、数量、仓库/物流/预约、包裹和预检。
5. 发货单：平台单号、运单、包裹、取件、预计/实际到仓和数量对账。
6. 包裹与打印：箱规、装箱明细、标签版本、打印和失效状态。
7. 异常中心：owner/SLA、影响数量、证据、允许动作和时间线。
8. 单据详情：官方 raw 摘要、内部 Revision、Command/Attempt/Receipt、Quantity Ledger 和 Audit。

高风险按钮使用明确动词和目标，例如“确认并创建 1 张 SHEIN 发货单”，不能写成泛化“提交/完成”。

### 11.25 一致 Snapshot、筛选与选择语义

1. 页签计数、列表行、数量、详情摘要、selection eligibility 和 allowedActions 来自同一数据库 Snapshot。
2. selection 绑定 tenant/user/store/tab/filter/snapshotRevision/eligibilityRevision，只保留当前可见 eligible 行。
3. 切页签、切店、改筛选、刷新、权限变化或 revision 变化时清理失效选择并说明原因。
4. 全选默认只选当前已加载可见页；跨页全选必须显式显示目标总数、查询条件和影响预览。
5. 发货计划不是把勾选 ID 直接发给 SHEIN；服务端按当前 revision 重新解析并生成冻结候选。
6. 大列表使用稳定 cursor、确定性排序和服务端筛选；不得一次加载全部采购/发货历史到浏览器。
7. 搜索 orderNo、deliveryCode、SKC、SKU、supplierCode 和运单时保持字段语义，不做模糊自动合并。

### 11.26 可观测性、SLO 与容量

追踪链：

`refreshOperationId/sourceReceiptId/purchaseOrderId/planId/revision/eligibilityId/commandId/outboxId/jobId/attemptId/SHEIN traceId/deliveryId/packageId/reconciliationId/caseId/releaseId`

必须监控：

- 采购/发货来源 freshness、分页覆盖、Webhook 积压和 unmatched/conflict。
- 临期/逾期采购单、待发数量、发货创建成功/明确失败/未知和官方回读延迟。
- Outbox 最老年龄、每店在飞命令、同单冲突锁、队列公平和 Adapter 429/错误码。
- 发货量到收货/入库/次品差异，未取件、物流停滞和案件 SLA。
- 标签生成/下载/打印失败、对象存储大小和短时票据访问。
- 2 核 4GB 下 10/50/100 店、1k/10k 采购行、1/15/50 单计划和大标签 PDF 的 CPU/内存/DB/Redis/网络预算。

创建命令 HTTP 应快速返回 202 和 Operation；页面可对当前用户触发的有限活动 Operation 使用 SSE/有界状态查询，不启用全站常驻轮询。

### 11.27 安全、隐私与审计

1. 发货地址、联系人、电话、仓库、物流单号属于业务敏感数据，按最小权限展示并在日志脱敏。
2. Raw Receipt 与标签文件加密/私有存储、分级保留、短时下载和访问审计。
3. SHEIN 凭证只在服务端 Adapter 使用；Command/Payload/日志不保存 Secret。
4. 防止跨 tenant/store 读取单据、伪造 platform ID、篡改数量、复用 eligibility token、下载他店标签和重放取消请求。
5. 发送前保存操作者、授权版本、目标店铺、动作、Plan/Eligibility Revision、Payload Fingerprint 和风险确认。
6. 修改/取消、批量标签和异常人工关闭保留 before/after、理由和 proof；审计事件不可由普通运营删除。
7. 导出默认最小字段，不包含不必要联系人信息；下载链接短时、单用户并可撤销。

### 11.28 迁移与兼容策略

阶段 A：只读资产与合同基线

- 盘点全部历史接口文档、Webhook、代码、表、开关、生产版本和真实使用痕迹。
- 恢复当前正式合同并建立采购、发货、包裹、错误和乱序 fixture。

阶段 B：官方事实只读投影

- 建 Inbox/Receipt/PurchaseOrder/Delivery/Quantity Ledger；手动刷新与旧能力并行影子对账。
- 不上线平台写，不增加新导航入口或自动同步。

阶段 C：内部计划与工作台

- Recommendation → Plan Draft、审批、Eligibility、包裹计划和异常案件先在本地闭环。
- UI 渐进上线，只读官方单据与内部计划严格区分。

阶段 D：单动作金丝雀

- 先单店只读发货基础和 Eligibility；再对用户指定的一个采购单启用一次创建发货单。
- 完成创建、官方回读、标签、取件/到仓和数量对账后，才评审手工备货、修改/取消和批量。

阶段 E：稳定放量与遗留退役

- 按店铺、动作和角色放量；两个稳定 release、零旧写 owner、回滚演练和用户验收后才退役旧兼容。

迁移禁止自动补历史数量、批量生成假平台单号、自动重放未知命令、自动刷新全部店铺或清理旧回执。

### 11.29 实施交付拆分

| 编号 | 名称 | 核心交付 | 对应 ERP 步骤 |
| --- | --- | --- | --- |
| FUL-01 | 履约资产基线 | 接口、Webhook、代码、表、开关、页面、生产版本和真实使用图 | ERP-00、ERP-05、ERP-17 |
| FUL-02 | 官方合同与 fixture | 采购/JIT/发货基础/物流/仓/发货单/标签/备货单当前合同、错误与脱敏响应 | ERP-07、ERP-17 |
| FUL-03 | 失败回归地基 | 分页遗漏、状态乱序、数量 unknown、合单冲突、发送未知、到仓差异和跨店负向测试 | ERP-03、ERP-17、ERP-19 |
| FUL-04 | Inbox/Receipt | Webhook/主动读统一入口、raw、trace、contract/normalizer version、LKG | ERP-06、ERP-10、ERP-17 |
| FUL-05 | Purchase Order Fact | 采购单/行、JIT 母子、标签、仓、截止时间和官方状态投影 | ERP-04、ERP-06、ERP-17 |
| FUL-06 | Quantity Ledger | need/order/plan/delivery/receipt/storage/defective 与 unknown-safe 对账 | ERP-06、ERP-17 |
| FUL-07 | Replenishment Plan | Recommendation 交接、人工 revision、审批、过期和审计 | ERP-06、ERP-13、ERP-17 |
| FUL-08 | Option Snapshot | 地址、仓、发货方式、物流产品、货代、收货仓、预约和 freshness | ERP-06、ERP-07、ERP-17 |
| FUL-09 | Eligibility Engine | 合单组、状态/仓/类型/标签/市场/SKU/数量规则和稳定 reasonCode | ERP-04、ERP-07、ERP-17 |
| FUL-10 | Shipping/Package Plan | SKU 分配、部分发货、包裹、装箱、重量尺寸、预约和 revision | ERP-06、ERP-13、ERP-17 |
| FUL-11 | Durable Command | plan/authorize/Command/Event/Outbox/一命令一 Job/lease | ERP-06、ERP-08、ERP-17 |
| FUL-12 | SHEIN Action Adapter | 手工备货、创建/修改/取消发货、动作级 capability/限流/contract | ERP-07、ERP-17 |
| FUL-13 | Send Boundary | 幂等、send_started、known_failed/result_unknown、业务键锁和人工收敛 | ERP-04、ERP-08、ERP-17 |
| FUL-14 | Official Readback | Purchase/Delivery/Logistics reducer、单调 current pointer 和一致 Snapshot | ERP-10、ERP-11、ERP-17 |
| FUL-15 | Label/Print Center | 条码、箱唛、包裹/物流面单、私有文件、版本失效和打印审计 | ERP-13、ERP-15、ERP-17 |
| FUL-16 | Exception Case | 临期、数量/身份/包裹/物流/到仓差异、owner/SLA 和时间线 | ERP-06、ERP-13、ERP-17、ERP-18 |
| FUL-17 | Fulfillment Workbench | 总览、采购、计划、发货、包裹、异常和详情渐进 UI | ERP-13、ERP-17 |
| FUL-18 | 权限/安全/导出 | capability、审批、敏感数据、短时票据、审计和跨域负向测试 | ERP-17、ERP-19、ERP-21 |
| FUL-19 | 性能/恢复验收 | 多店大列表、限流、断线、Worker/Redis/DB、标签文件和数量重放 | ERP-19、ERP-21 |
| FUL-20 | 金丝雀与退役 | 单店单动作、后台核对、逐动作放量、回滚和旧 owner 零引用 | ERP-20、ERP-22、ERP-23 |

FUL-01 至 FUL-10 是任何履约写入前的 P0 地基；FUL-11 至 FUL-14 是创建发货单前的 P0 可靠性门。未完成时只能提供只读官方单据和内部计划草案，不得启用平台写。

### 11.30 验收标准、已确认决策与后续讨论项

官方事实与数量：

- 采购/发货分页、时间窗口、重复/乱序和 source failure 可重放；confirmed empty、stale、partial、unknown 不混淆。
- 每个 SKU 的需求、下单、计划、发货、收货、入库和次品量可追溯 Receipt/Ledger；unknown 不写 0。
- JIT 母子单、部分发货、拆单/合单、作废和到仓差异不丢历史，不靠中文状态分类。
- 列表、计数、详情、数量和 allowedActions 来自同一 fulfillmentSnapshotRevision。

计划与执行：

- Recommendation 只能生成 Plan Draft；未经人工审批和执行确认不会调用 SHEIN。
- 合单规则对类型、仓、预估仓、备货类型、市场、标签、品类、状态、SKU 集合和数量给出稳定 blocker。
- 重复点击、断线、刷新、切店、Worker/Redis/DB 崩溃不会丢命令、跨店或重复调用。
- `send_started` 后超时进入 `result_unknown` 并锁定业务键；没有官方证据不显示已创建平台单据。
- 创建、修改、取消和打印逐动作 capability/开关/金丝雀；一个动作开放不代表全部履约写已启用。

包裹、物流与地毯：

- 包裹数、装箱 SKU 数量、总量、重量、尺寸、预约和物流产品规则一致；旧 revision 标签不可误用。
- 大/小尺寸地毯按 SKU 和包装方案计算，体积重/实重/包材未知时不输出伪精确承诺。
- 发货量、收货量、入库量、次品量差异自动开 Case，但不自动补发、退货或覆盖库存。

体验、安全与上线：

- 切页签、筛选、切店、权限变更和 snapshot 更新后无隐藏选择；请求体、UI 数量和服务端 eligible 数量一致。
- 手动刷新只有一个服务端 owner；Scheduler、进页、切店、聚焦和 30 秒自动同步关闭。
- 跨 tenant/store、伪造单号/数量/revision/token、越权下载标签和重放取消请求均零副作用。
- 单店单采购单完整 canary 与 SHEIN 后台五方核对通过，再按动作和店铺放量；回滚不删除官方回执、计划、数量账本、标签或案件。

已确认决策：

1. 双履约模式共存，但内部 Plan 与平台采购单绝不混为一体。
2. Recommendation 不直接执行，必须经过人工计划、审批和独立平台命令。
3. 平台采购单、内部计划、发货计划、平台发货单、包裹、标签和异常分别建模。
4. SKU 是数量账本最小粒度；SKC/单据/店铺聚合必须带覆盖证明。
5. need/order/delivery/receipt/storage/defective 分开，缺失不补 0。
6. 合单资格由版本化服务端 Engine 决定，不靠失败试错或中文消息。
7. 仓库、地址、物流和预约使用当前官方 Option Snapshot，不硬编码。
8. 所有 SHEIN 写使用持久命令、事务 Outbox、一命令一 Job、send boundary 和官方回读。
9. `result_unknown` 不自动重试，同单修改/取消严格串行。
10. 打印成功不等于发货成功，命令 accepted 不等于到仓/入库。
11. 地毯按尺寸 SKU 管包装、重量、体积和风险，大尺寸不使用平均参数。
12. 数量/物流/到仓异常使用持久 Case，不自动创建补发或退货。
13. 当前继续手动刷新；Webhook 只落事件/标 dirty，不自动读取全部店铺。
14. 首期不提供跨店一键发货或大范围批量修改/取消。
15. 工作台渐进加入现有 V2，不因履约模块重做全站 UI。

明确不做：

- 不把 Recommendation、基础缺口或人工计划显示成 SHEIN 已下单。
- 不让浏览器直接调用 SHEIN、现场组装最终 payload 或独占任务状态。
- 不以 HTTP 200、队列完成、打印成功或人工勾选宣称官方履约完成。
- 不把 unknown 数量、缺页或失败来源写为 0/空单据。
- 不硬编码佛山仓、物流公司、地址、包裹限制、中文状态或示例字段。
- 不在来源 stale、资格 revision 失效或有冲突锁时发起平台写。
- 不自动补发、自动取消、自动退货、自动更新库存或自动关闭异常。
- 不在本板块实现完整 MES、财务结算或售后退款。

板块 12 继续讨论：退货、报废、退款/索赔、质量缺陷、售后责任、平台处罚与财务对账如何形成独立闭环，并消费本板块的到仓差异、次品和履约证据，而不反向改写采购/发货历史。

## 板块 12：退货、报废、质量缺陷、索赔申诉、平台处罚与财务对账

关联执行步骤：ERP-03、ERP-04、ERP-05、ERP-06、ERP-07、ERP-08、ERP-10、ERP-11、ERP-13、ERP-15、ERP-17、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23  
状态：方案已确认，尚未授权实施

### 12.1 结论：建立“逆向履约与损失闭环”，不是增加一张售后列表

本板块必须把平台退货/报废、消费者售后、质量缺陷、责任认定、申诉处罚和财务影响组织为一条可追溯但彼此正交的链：

`履约差异 / 平台退货或报废 / 消费者投诉 / 财务调整 → Case → Evidence → Responsibility → Return/Scrap/Appeal Command → Official Readback → Financial Impact → CAPA`

核心原则：

1. 退货/报废是新的官方业务事实，不反向修改采购单、发货单、到仓、入库或次品历史。
2. 质量原因、责任归属、处理动作、平台状态、申诉状态和财务状态分别建模，不建立万能 `afterSaleStatus`。
3. 页面不得把“已登记、已提交、待平台确认、平台已接受、已退回、已报废、已扣款、申诉成功”合并为一个“处理成功”。
4. 所有数量以 SKU 为最小粒度；所有金额保留原币种、方向、来源、账单和明细，不用标题、图片或当前 supplierSku 猜归属。
5. SHEIN 官方回执是平台事实权威；内部责任判断、预计损失和改善建议不能覆盖官方字段。
6. 当前官方合同不完整的消费者售后、退款、申诉和主动退货能力保持 unsupported 或人工导入，不伪造自动同步。
7. 当前继续手动刷新；Webhook 只验签落 Inbox、匹配候选并标 dirty，不自动全店回读或执行外部写。
8. 首期默认只读与案件协作；退货确认、报废、申诉、退款或库存写必须逐动作恢复合同并单独金丝雀。

### 12.2 当前事实与缺口

已核验的项目事实：

1. V2 尚无规范的逆向履约、质量、申诉或财务对账领域服务和完整工作台。
2. 现有能力矩阵登记了 `/open-api/purchase/*` 退货申请/退货单系列，但只恢复了部分正式原文，写接口存在字段交接和路径/方法冲突，不能直接开放。
3. 已确认可读合同包括退货申请明细、退货/报废单列表、商品明细、包裹明细和退货地址；列表单次查询窗口最多 60 天，指定退货单号最多 200 个。
4. 退货单事实包含 `returnOrderNo`、`returnPlanNo`、`purchaseOrderNo`、平台 SKU、预计退货/报废量、实际退货量、实际报废量、承运与签收等字段。
5. 官方退货状态至少包含平台确认中、待退货、部分出库、全部出库、已取消、已报废、待报废、退货中；处理类型至少区分退货与报废。
6. 归档示例存在 `/open-api/open-api/purchase/return-list` 重复路径，而正文为 `/open-api/purchase/return-list`，必须以当前官方合同和真实脱敏响应消除冲突。
7. 退货申请列表、处置方式、取件方式、承运商、可退库存、创建申请、确认申请和更新取件方式等能力只有目录/权限线索或摘要，当前一律 unsupported。
8. 财务已确认 `/open-api/finance/report-list` 和 `report-adjustment-detail` 等只读事实；报告查询时间窗口最多 7 天，同一业务单号/SKU 可出现在多张报告和多个费用明细中。
9. 财务调整的 `replenishCategory` 是庞大且可能变化的平台分类文本，包含质量、售后、包装、物流、处罚、退款和申诉补款等语义，不能当稳定主键。
10. 财务明细可能返回“当前 supplierSku”而不是账单生成时的 supplierSku，必须优先按官方单号/平台 SKU/报告明细身份匹配。
11. 当前没有一套已核验的消费者退货退款正式接口合同；只看到解决方案目录线索，不能据此承诺自动获取消费者售后、退款、投诉或 PII。
12. 板块 11 已能提供采购、发货、收货、入库、次品、包裹、物流和异常证据；本板块消费这些事实，但不得重写它们。

### 12.3 产品责任边界

本板块负责：

- SHEIN 平台退货/报废单只读同步、状态、数量、包裹、物流和签收。
- 质量案件、证据、责任评估、处理决定、SLA、复发和改善行动。
- 已核准动作的持久命令、发送边界、回执、未知收敛和人工复核。
- 平台处罚/补款/扣款/调账事实和与案件、商品、采购、履约的可解释关联。
- 多店问题聚类、损失分布、供应商/商品/包装改善，但只能使用证据充分的数据。

本板块不负责：

- 替代 SHEIN 客诉后台、客服会话、消费者退款支付或平台仲裁系统。
- 反向修改商品发布、采购、发货、库存、入库和官方财务历史。
- 在缺少合同或正式数据时推造退货率、退款率、赔付率、利润或责任结论。
- 自动退货、自动报废、自动退款、自动申诉、自动改库存或自动扣供应商款。
- 完整总账、税务、发票、应收应付和资金核算；这些属于下一财务板块。

### 12.4 四个独立但可关联的子域

1. **平台退货/报废域**：ReturnApplication、OfficialReturnOrder、ReturnLine、ReturnPackage、ReturnLogistics。
2. **质量与消费者售后域**：QualityCase、ComplaintFact、InspectionFact、EvidenceBundle、ResponsibilityAssessment。
3. **索赔、申诉与处罚域**：PenaltyFact、ClaimCase、AppealCase、AppealCommand、DecisionReceipt。
4. **财务影响与对账域**：FinanceReport、FinanceEntry、ReconciliationLink、LossAssessment。

四个子域通过稳定引用关联，不共享状态列；一个质量案件可以关联多个退货单和多条财务调整，一条财务明细也可能暂时无法唯一归属。

### 12.5 事实层级与禁止推断

事实优先级：

1. 当前官方 API/回执和带身份的 SHEIN 后台导出。
2. 本系统保存的不可变 Raw Receipt、Webhook Inbox 和历史官方快照。
3. 已验证的采购、履约、商品版本、媒体和合规事实。
4. 带来源、操作者和附件的人工事实。
5. 本地规则推导、聚类和预计损失。

禁止：

- 从红色文案推断平台状态 code。
- 从退货原因直接推断供应商责任。
- 从次品量推断已报废或已扣款。
- 从财务分类文本推断具体退货单或消费者订单。
- 把空结果写成“无退货/无处罚/无损失”。
- 把预计损失与官方已结算金额相加后称为实际损失。

### 12.6 目标领域拓扑

```text
SHEIN Return API / Finance API / Webhook / Verified Import
                         │
                         ▼
               ReverseSourceInbox
                         │
                 Raw Receipt + Coverage
                         │
                         ▼
              Match / Normalize / Project
                  │              │
                  ▼              ▼
        OfficialReturnFact   OfficialFinanceFact
                  │              │
                  └──────┬───────┘
                         ▼
        QualityCase / AppealCase / ReconciliationLink
                         │
                  Evidence + Decision
                         │
                         ▼
                  Approved Command
                         │
           Outbox → Worker → SHEIN Adapter
                         │
                         ▼
               Official Readback / CAPA
```

任何 UI、Webhook 或导入任务都不能绕过 Inbox/Receipt、匹配、权限、命令和官方回读边界。

### 12.7 规范对象与不可变身份

核心对象：

- `ReverseSourceInboxEvent`：来源、tenant/store、eventId、receivedAt、raw hash、验签、处理状态。
- `ReverseSourceReceipt`：endpoint/import、request target、returned/missing、page/window、trace、contract/normalizer version、quality。
- `ReturnApplication` / `ReturnApplicationLine`：官方申请号、采购单、SKU、申请数量和当前状态投影。
- `OfficialReturnOrder` / `ReturnLine`：退货单号、处理类型、原因、预计/实际退货或报废量、官方状态。
- `ReturnPackage` / `ReturnPackageItem`：包裹/箱、SKU 数量、承运、运单、出库和签收。
- `QualityCase`：来源、范围、严重度、owner、SLA、状态、复发键和影响对象。
- `EvidenceBundle` / `EvidenceItem`：证据角色、文件、来源、采集时间、hash、访问级别和保留策略。
- `ResponsibilityAssessment`：候选责任方、证据、置信度、决定者、决定时间和可复核状态。
- `PenaltyFact` / `ClaimCase` / `AppealCase`：处罚事实、索赔诉求、截止日、证据、申诉阶段和平台决定。
- `ReverseCommand` / `ReverseAttempt` / `ReverseReceipt`：动作、目标、revision、授权、发送边界和官方结果。
- `FinanceReport` / `FinanceEntry`：报告身份、账期、状态、业务单号、平台 SKU、金额、币种、数量、原始分类。
- `ReconciliationLink`：财务明细与退货/质量/履约/商品的匹配状态、证据和算法版本。
- `LossAssessment`：官方已确认金额、内部预计金额、币种、口径、覆盖率和版本。
- `CorrectiveAction`：纠正预防行动、owner、截止日、验证指标、结果和复发。

规范身份优先使用 `storeId + official document/line id`；没有官方行 ID 时使用经合同确认的稳定业务组合键和 payload fingerprint，不使用标题或当前 supplierSku 作为唯一身份。

### 12.8 正交状态机

至少独立维护：

1. Source Receipt：`received → normalized → matched/unmatched/conflict → projected/failed`。
2. Return Order：只投影官方 code，不自行设计可覆盖官方状态的本地枚举。
3. Quality Case：`open → triaged → investigating → decision_pending → action_in_progress → resolved → reopened`。
4. Responsibility：`unassessed → evidence_insufficient → proposed → confirmed/disputed → superseded`。
5. Appeal：`draft → approved → queued → send_started → submitted/result_unknown/known_failed → decided`。
6. Finance Report：官方待确认、待结算、已结算与本地同步质量分离。
7. Reconciliation：`unmatched → candidate → matched/ambiguous → reviewed → superseded`。
8. CAPA：`draft → approved → executing → verification_due → effective/ineffective → closed`。

一个对象状态变化只能追加事件并更新自己的 current pointer，不能顺手改写其他对象的历史。

### 12.9 跨域关联与来源证明

优先关联键：

- tenantId、storeId、supplierId。
- returnPlanNo、returnOrderNo、purchaseOrderNo、deliveryCode、package/waybill。
- platformSkuCode、商品版本、SKU 尺寸、供应商 SKU 历史映射。
- finance report/entry ID、businessOrderNo、账期、币种和金额。
- official trace/event/receipt ID。

匹配规则：

1. 精确官方 ID 匹配优先，组合键匹配必须版本化并保存候选。
2. supplierSku 改名时读取历史身份映射，不用当前值覆盖账单生成时事实。
3. 多候选、金额拆分、同 SKU 多报告或跨账期冲销进入 ambiguous，禁止自动认领。
4. unmatched 是一等状态，进入数据质量队列，不为让页面“完整”而猜归属。
5. 人工认领必须记录操作者、理由、附件和 before/after，且可 supersede 不可删除。

### 12.10 退货/报废数量账本

在板块 11 Quantity Ledger 之后追加独立事件：

- expectedReturnQty。
- expectedScrapQty。
- actualOutboundReturnQty。
- actualReturnedQty。
- actualScrapQty。
- signedReturnQty。
- lost/damaged-in-reverse Qty（只有正式证据时）。

规则：

1. 预计退货、实际出库、平台签收、实际报废分别保存，不能相互覆盖。
2. 退货与报废是处理类型，不将 `actualScrapQty` 算作已退回。
3. 数量缺失、部分包裹或部分 SKU 只显示 known subtotal + coverage。
4. 采购/发货/入库/次品量作为只读上游证据；不因退货发生而回写历史数量。
5. 所有差异生成可解释 Reconciliation 或 Case，不自动改库存。

### 12.11 官方退货申请与退货单读取

1. 以当前正式合同恢复退货申请明细、退货列表、商品明细、包裹明细和退货地址 Adapter。
2. 退货列表按不超过 60 天窗口切片，指定单号每批不超过 200；分页/时间边界重叠去重且保存 request coverage。
3. 列表、商品、包裹和申请明细分别形成 Receipt；列表成功不代表明细完整。
4. 路径重复、字段命名或状态解释冲突必须用当前官方原文、API Explorer 和真实脱敏 fixture 三方消除。
5. confirmed empty 需证明请求窗口、店铺、分页和 endpoint 均完整；否则保持 unknown/partial。
6. 手动刷新创建单一 `ReverseRefreshOperation`，逐来源展示进度、失败、LKG 和 cutoff。
7. Webhook 到达只登记事件、精确匹配或标 dirty；不自动启动全店 API 扫描。

### 12.12 主动退货/报废动作边界

退货申请列表、可退库存、处置方式、取件方式、承运商、创建/确认申请和更新取件方式在完整合同恢复前全部冻结。

未来开放时必须满足：

1. 每个 action 独立 capability、contractVersion、限流、开关和 canary。
2. `plan → preflight → authorize → ReverseCommand → Outbox → one Job → Attempt → Receipt → readback` 完整。
3. 外部调用前持久化 `send_started`；发送后未知进入 `result_unknown` 并锁定业务键。
4. 通用重试不允许重发创建、确认、改取件或报废动作；只能先官方回读/后台复核。
5. 本地 accepted/queued 不显示“退货成功/报废成功”，只有官方状态证据才改变平台事实投影。
6. 一次金丝雀只允许一个店铺、一个退货对象、一个动作，并预先明确不可自动回滚的后果。

### 12.13 退货选项、包裹与逆向物流

1. 退货地址、取件方式、承运商和处置方式形成带 store/scope/source/freshness 的 Option Snapshot。
2. 地址显示脱敏，提交时使用官方稳定 ID；禁止硬编码联系人、地址和示例 carrier。
3. ReturnPackage 与 ReturnLine 数量守恒；部分装箱、多个箱、部分出库和未装箱均可表示。
4. 包裹标签、运单、取件单和签收证明分 ArtifactType，版本、hash、有效期和访问审计独立。
5. 物流状态不等于平台退货单状态；签收也不等于财务已结算。
6. 地址或选项 stale、数量不守恒、包裹 revision 变化时 fail closed。

### 12.14 质量问题分类体系

质量分类使用版本化 `QualityTaxonomy`，至少分：

1. 商品实物缺陷。
2. 商品描述/图片/属性与实物预期不一致。
3. 包装方案或包材问题。
4. 正向/逆向物流破损、受潮、污染或丢失。
5. 仓库收货、抽检、入库和作业异常。
6. 合规、安全、标签或平台规则问题。
7. 消费者主观预期或使用场景问题。
8. 数据质量/身份匹配问题。
9. 原因未知或证据不足。

保存平台原始 reason code/text、内部分类 revision 和映射依据；分类更新不改写历史案件。

### 12.15 地毯品类质量字典

地毯/地垫首期至少覆盖：

- 尺寸、形状、厚度、克重与允许公差。
- 颜色/色差、印花偏位、图案裁切、批次差异。
- 锁边、脱线、毛边、表面破损、掉毛和起球。
- 气味、污渍、霉变、受潮和异物。
- 折痕、卷曲、回弹、压缩包装后恢复。
- 防滑底、背胶、底材脱落和地面适配。
- 包装破损、标签错误、SKU/尺寸错装和数量差异。
- 实拍图、详情图和实物预期不一致。

每类问题定义检测方法、证据角色、严重度、抽检标准、可接受公差和可能责任候选。没有测量/图片/检验依据时保持“待核实”，不能自动归责。

### 12.16 证据包与保留

证据角色包括实物全景、缺陷近照、尺寸/重量测量、包装六面、标签/SKU、开箱视频、检验报告、物流轨迹、签收证明、平台通知、后台截图和沟通记录。

规则：

1. 证据保存原文件 hash、采集时间、来源、操作者、关联对象、脱敏状态和 chain of custody。
2. 图片/视频复用板块 07 资产能力，但 EvidenceReference 与商品媒体用途独立，不能自动发布为商品图片。
3. 消费者姓名、电话、地址、聊天和面单按敏感/个人数据分级、最小展示、短时下载和访问审计。
4. 处罚、申诉、争议或法律 hold 中的证据不进入普通生命周期清理。
5. 删除采用保留策略和可审计 tombstone；普通运营不得永久删除案件关键证据。

### 12.17 责任评估与协作

候选责任方至少包括供应商/工厂、内部选品/建品、包装、仓库、正向物流、逆向物流、SHEIN 平台/仓、消费者使用/预期和 unknown。

1. 系统可基于规则给出“候选责任”和证据缺口，不能自动定责或自动扣款。
2. 责任评估保存事实、反证、置信度、影响数量/金额、决定者和审批。
3. 供应商责任必须关联采购批次、SKU、质检/样品标准和证据；同款历史问题只能辅助，不能替代当前案件证据。
4. 争议状态允许多方意见并存；最终决定可 supersede，原记录不删除。
5. 批量问题聚类可开父 Case，但每个退货单、SKU 和财务条目保持独立处置结果。

### 12.18 消费者售后边界

在当前消费者售后正式合同未恢复前：

1. 页面明确标注“消费者售后接口未接入”，不显示自动同步或伪 0。
2. 只允许经过权限控制的人工登记或带来源的官方导入；每条记录必须有 `sourceKind/importReceipt/manualEvidence`。
3. 不从采购退货、财务调整或红色原因文本反推消费者订单、退款状态或投诉详情。
4. 不保存非必要消费者 PII；导入前定义字段最小集、用途、保留期和删除/hold 规则。
5. 未来 API 接入必须重新完成合同、身份、分页、状态、Webhook、速率、隐私和 canary 评审。

### 12.19 平台处罚、索赔与申诉

1. `PenaltyFact` 保存平台原始分类、业务单号、SKU、数量、金额、币种、账期、来源和证据，不先归入内部原因。
2. `ClaimCase` 表示我方向责任方提出的赔偿诉求；`AppealCase` 表示对平台决定/扣款的申诉，两者不能混用。
3. 每个案件记录可申诉截止日、所需材料、owner、SLA、当前阶段、平台决定和实际财务结果。
4. 申诉草稿、批准、提交、平台接收、补件、决定和补款分别记录。
5. 没有已核准申诉 API 时生成 `ManualAppealTask` 和证据清单，不声称系统已提交。
6. 未来自动提交使用 action-specific Durable Command；发送未知不自动重提，防止重复申诉或覆盖材料。
7. 申诉成功不直接改写原处罚事实，只追加 Decision Receipt 和正向调整财务条目。

### 12.20 财务报告与调整明细事实

1. 财务报告读取按正式 7 天最大窗口切片，保存 page/window/coverage、生成/更新时间和 LKG。
2. 报告状态沿用官方 code；账单同步质量与结算状态分离。
3. 每条 FinanceEntry 保存 report/entry identity、businessOrderNo、platformSku、quantity、amount、currency、direction、原始 `replenishCategory` 和 raw hash。
4. 同一业务单号/SKU/费用在不同报告或账期出现时全部保留，不做覆盖式 upsert。
5. 调整类别保存 `rawCategory + normalizedCategoryVersion + mappingConfidence`；未知新分类进入待映射，不落“其他=无影响”。
6. 负数/正数、扣款/补款以官方合同定义，不按中文词语或金额符号自行猜方向。
7. 货款、服务费、质量扣款、物流扣款、处罚、退款、申诉补款分别展示；不能只给一个“损失总额”。

### 12.21 财务关联与对账

ReconciliationLink 输出 `matched/ambiguous/unmatched/reviewed/superseded`，并保存匹配依据：

1. 精确 report/entry/businessOrder/return/purchase/delivery/platformSku ID。
2. 金额、币种、数量、账期和时间窗口只能作为辅助约束，不能单独认领。
3. 一条财务明细可分摊到多个案件时使用显式 Allocation，分配和 rounding 可审计。
4. 一项案件可能跨多个账期产生扣款和后续补款，净影响由明细聚合，不覆盖旧扣款。
5. 自动匹配只在唯一且规则证据充分时进入 candidate；最终财务关闭可要求人工复核。
6. unmatched/ambiguous 的金额和数量单独展示，不藏进已对账总额。

### 12.22 损失口径与多币种约束

损失至少分层：

- 官方已结算净影响。
- 官方待结算/待确认影响。
- 已发生但尚未出账的可证实成本。
- 内部预计损失。
- 无法量化/数据不足。

规则：

1. 只有官方金额和币种齐全时可称“平台已确认金额”。
2. 内部预计值保存模型、输入、时间、版本和置信度，不能混入官方账单。
3. 不同币种不直接相加；需要汇率时保存来源、时点和 conversion version。
4. 缺采购成本、物流、包材、税费或结算数据时不计算净利润或 ROI。
5. 财务显示必须同时给口径、账期、覆盖率、unknown 和 unmatched 金额。

### 12.23 CAPA、商品与供应商改善闭环

1. 重复质量问题按 product/SKU/batch/supplier/packaging/reason 聚类并给出复发率，但必须显示数据覆盖。
2. CorrectiveAction 可要求更新质检标准、包装方案、商品属性/图片、供应商工艺、抽检比例或停售建议。
3. CAPA 只创建新版本/新任务，不改写已发布商品版本、历史采购单或历史包装事实。
4. 上线前定义验证样本、观察窗口、成功指标和 owner；完成任务不等于改善有效。
5. 高严重度安全/合规问题可联动板块 09 开 Case 和发布阻断，但必须通过独立规则和权限。
6. 系统提供建议与影响面，不自动停售、换供应商、索赔、扣款或删除素材。

### 12.24 SLA、预警与升级

至少监控：

- 待退/待报废临期和逾期。
- 包裹未出库、物流停滞、未签收和数量差异。
- 质量案件待分诊、证据不足、责任待定和重复复发。
- 申诉截止临近、补件待办、result_unknown 和平台决定待回读。
- 财务报告 stale、未匹配/歧义金额、跨账期未收敛和待结算异常。

预警形成持久 Case/Task，支持 owner、SLA、确认、转派、稍后、解决和复发；Webhook、刷新失败和 source stale 属于数据质量，不冒充业务异常。

### 12.25 多店、权限与审批

建议 capability：

- `reverse.read` / `reverse.refresh` / `reverse.export`。
- `quality.case.manage` / `quality.evidence.manage` / `quality.responsibility.decide`。
- `return.plan` / `return.execute` / `return.confirm`。
- `appeal.plan` / `appeal.approve` / `appeal.execute`。
- `finance.read` / `finance.reconcile` / `loss.estimate`。
- `reverse.diagnostics.read`。

规则：

1. read、refresh、case、evidence、decide、execute、finance 和 diagnose 分开授权。
2. 跨店只读汇总按店铺访问范围裁剪；跨店批量退货/报废/申诉首期不存在。
3. 高金额、高数量、临近截止或责任争议动作可要求第二人审批。
4. 权限撤销立即阻断新命令；已 `send_started` 动作按历史授权继续审计和回读。
5. 导出最小字段、异步生成、短时票据；敏感证据默认不进入批量导出。

### 12.26 工作台信息架构

在现有 V2 壳内渐进增加“逆向与质量”工作台，不重做全站 UI：

1. 总览：待退/报废、质量案件、申诉截止、处罚/扣款、未对账和新鲜度。
2. 退货/报废：申请、退货单、SKU 数量、包裹、物流、签收和 allowedActions。
3. 质量中心：问题分类、严重度、证据、责任、关联批次/商品和复发。
4. 索赔申诉：草稿、审批、补件、截止日、提交证据和平台决定。
5. 财务影响：报告、调整明细、matched/ambiguous/unmatched、币种和口径。
6. 改善任务：CAPA、供应商/商品/包装动作、验证和复发。
7. 详情时间线：上游履约证据、官方 raw 摘要、Case/Event/Command/Attempt/Receipt/Reconciliation。

按钮使用准确动词，如“创建申诉草稿”“确认并提交 1 个退货申请”，不使用泛化“处理/完成”。

### 12.27 Snapshot、搜索与选择语义

1. 页签计数、列表、金额/数量、allowedActions 和详情摘要来自同一 `reverseSnapshotRevision/asOf`。
2. selection 绑定 tenant/user/store/tab/filter/snapshot/eligibility，只保留当前可见 eligible 行。
3. 切页签、切店、刷新、改筛选、权限/revision 变化时清理失效选择并说明。
4. 全选默认当前可见页；跨页必须显式展示目标总数、金额/数量影响、query token 和逐项预检。
5. 搜索官方退货号、申请号、采购单、平台 SKU、报告号和 Case ID；禁止标题模糊匹配后直接执行。
6. 大列表使用 cursor、确定排序、服务端筛选；财务汇总不在浏览器基于当前页计算。

### 12.28 安全、性能与可观测性

全链追踪：

`refreshOperationId/sourceReceiptId/returnOrderId/qualityCaseId/evidenceId/appealId/commandId/outboxId/jobId/attemptId/SHEIN traceId/financeEntryId/reconciliationId/capaId/releaseId`

必须证明：

1. 10/50/100 店、1k/10k 退货行、财务 7 天切片、60 天退货窗口、证据大文件在 2 核 4GB 下有界分页、并发和内存。
2. 重复/乱序 Webhook、分页边界、429、部分失败、Redis/Worker/DB 崩溃和 result_unknown 可恢复。
3. 诊断台能回答是否调用过 SHEIN、命令发送边界、官方证据、当前案件/退货/财务状态及匹配依据。
4. Raw Receipt、证据、地址、运单、消费者数据和财务导出分级存储、脱敏、短时访问并审计。
5. 跨 tenant/store、伪造单号/SKU/金额/revision/token、越权证据下载、重放命令和手工篡改匹配均零外部副作用。
6. Scheduler、进页、切店、聚焦和 30 秒自动同步关闭；当前活动命令可使用有界 SSE/状态查询。

### 12.29 实施交付拆分

| 编号 | 名称 | 核心交付 | 对应 ERP 步骤 |
| --- | --- | --- | --- |
| RET-01 | 逆向资产基线 | API、Webhook、归档原文、代码、表、页面、开关、生产版本和 unsupported 图 | ERP-00、ERP-05、ERP-17 |
| RET-02 | 官方合同与 fixture | 退货申请/单/商品/包裹/地址、财务报告/调整、错误、限制和脱敏响应 | ERP-07、ERP-17 |
| RET-03 | 失败回归地基 | 60/7 天窗口、分页、重复/乱序、partial/unknown、重复路径、跨店和金额歧义 | ERP-03、ERP-17、ERP-19 |
| RET-04 | Inbox/Receipt | API/Webhook/导入统一入口、raw、coverage、trace、contract/normalizer version 和 LKG | ERP-06、ERP-10、ERP-17 |
| RET-05 | Return Fact | 申请、退货/报废单、行、官方状态、原因和稳定身份 | ERP-04、ERP-06、ERP-17 |
| RET-06 | Reverse Quantity Ledger | expected/actual return、scrap、package、signed 和 unknown-safe 对账 | ERP-06、ERP-17 |
| RET-07 | Return Package/Logistics | 地址/取件/承运 Option、包裹、Artifact、运单、签收和 freshness | ERP-06、ERP-07、ERP-15、ERP-17 |
| RET-08 | Quality Taxonomy | 平台原始原因、内部版本分类、地毯缺陷字典、严重度和检测标准 | ERP-04、ERP-06、ERP-17 |
| RET-09 | Quality Case | owner/SLA、影响范围、证据缺口、责任、解决与复发 | ERP-06、ERP-13、ERP-17 |
| RET-10 | Evidence Bundle | 图片/视频/测量/报告/物流/通知的角色、hash、隐私、hold 和审计 | ERP-06、ERP-15、ERP-17、ERP-19 |
| RET-11 | Responsibility/Claim | 候选责任、证据、争议、索赔诉求、审批和供应商协作 | ERP-06、ERP-13、ERP-17 |
| RET-12 | Appeal Case | 截止、材料、草稿、审批、人工任务/命令、决定和补款关联 | ERP-06、ERP-13、ERP-17 |
| RET-13 | Durable Reverse Command | action capability、Outbox、一命令一 Job、send boundary 和 unknown 收敛 | ERP-06、ERP-08、ERP-17 |
| RET-14 | Finance Fact | 报告/调整明细、原始分类、币种、金额、数量、状态和多账期保留 | ERP-06、ERP-10、ERP-17 |
| RET-15 | Reconciliation Engine | 精确/候选/歧义/未匹配、Allocation、规则版本和人工复核 | ERP-04、ERP-06、ERP-17 |
| RET-16 | Loss Model/CAPA | 官方/待结算/预计损失分层、多币种约束和改善验证 | ERP-04、ERP-13、ERP-17 |
| RET-17 | Reverse Workbench | 总览、退货、质量、申诉、财务、改善和详情渐进 UI | ERP-13、ERP-17 |
| RET-18 | 权限/安全/导出 | capability、审批、PII/证据/财务数据、短时票据和跨域负向测试 | ERP-17、ERP-19、ERP-21 |
| RET-19 | 性能/恢复验收 | 多店大列表、时间切片、限流、故障、重放、证据文件和 2 核 4GB | ERP-19、ERP-21 |
| RET-20 | 金丝雀与退役 | 单店只读、单动作/单报告核对、逐动作放量、回滚和旧 owner 零引用 | ERP-20、ERP-22、ERP-23 |

RET-01 至 RET-10 是案件与对账可信的 P0 地基；RET-13 未通过前不得开放任何退货/报废/申诉平台写；消费者售后合同未验证前保持人工/导入边界。

### 12.30 验收标准、已确认决策与后续讨论项

官方事实与数量：

- 退货 60 天和财务 7 天窗口、分页、指定单号、重复/乱序和 partial failure 可重放；空结果不自动当 0。
- 退货申请、退货/报废单、SKU、包裹、物流、签收和数量链可追溯 Receipt；预计/实际退货/报废不互相覆盖。
- 采购、发货、到仓、入库和次品历史不因逆向流程被改写。
- 列表、计数、详情、金额/数量和 allowedActions 来自同一 Snapshot。

质量、责任与证据：

- 平台原始原因与内部版本化分类并存；地毯尺寸、色差、锁边、气味、折痕、防滑、包装等有检测和证据标准。
- 责任候选与最终决定分离，证据不足、争议和 unknown 可表达，不自动扣供应商款。
- 消费者售后未接入时明确 unsupported，不推造订单、退款、退货率或 PII。
- 证据 hash、来源、角色、隐私、保留和 hold 可审计，越权读取零泄漏。

申诉、财务与损失：

- 申诉草稿/提交/平台接收/补件/决定/补款分离；人工任务不显示为平台已提交。
- 同一单号/SKU 多报告、多费用、跨账期扣款/补款全部保留；raw category 不作为稳定 ID。
- matched/ambiguous/unmatched 金额均可见；人工匹配和分摊可追溯。
- 官方已结算、待结算和内部预计损失分层；不同币种无来源汇率时不汇总，不伪造利润。

可靠性与上线：

- 重复点击、断线、切店和 Worker/Redis/DB 崩溃不丢命令、不跨店、不重复调用；`result_unknown` 不自动重试。
- Scheduler、进页、切店、聚焦和 30 秒自动同步关闭；手动刷新单 owner，Webhook 只落事件/标 dirty。
- 选择只覆盖当前可见 eligible 集合；UI 数量、请求体和服务端目标一致。
- 未恢复正式合同的写接口均 fail closed；首个动作金丝雀与 SHEIN 后台、数据库、队列、日志和页面核对。
- CAPA 只创建新版本和任务，不改写历史商品、包装、采购或履约事实。

已确认决策：

1. 逆向履约、质量、责任、申诉和财务状态正交建模。
2. 退货/报废是新事实，不回写正向履约历史。
3. SKU 是逆向数量最小粒度，预计/实际退货、报废、包裹和签收分别记录。
4. 平台原始原因/财务分类永久保留，内部映射版本化且允许 unknown。
5. 消费者售后接口未核准前仅人工/导入，不声称自动同步。
6. 所有平台写逐 action 启用，使用 Durable Command、send boundary 和官方回读。
7. 发送未知不自动重试；申诉成功追加补款事实，不改写原处罚。
8. 财务同单同 SKU 多明细/多账期不合并覆盖，歧义和未匹配必须可见。
9. 责任评估不自动定责、扣款或关闭案件。
10. 不同币种、官方金额和预计损失严格分层。
11. 当前继续手动刷新，无 30 秒/进页/切店/聚焦自动同步。
12. 工作台渐进加入现有 V2，不借本板块重做全站 UI。

明确不做：

- 不自动退货、报废、退款、申诉、改库存、停售、换供应商或扣供应商款。
- 不从次品、退货原因或财务分类反推消费者售后事实。
- 不用当前 supplierSku、标题、图片或金额近似匹配财务明细。
- 不把本地登记、排队、HTTP 200、人工勾选或导入称为平台处理成功。
- 不把 unknown/partial/stale 写成 0、无损失或已对账。
- 不在本板块建设完整会计总账、税务、发票和资金系统。

板块 13 继续讨论：财务、成本、利润、结算、发票、资金与多币种经营核算如何区分官方结算事实、内部成本事实、计算利润和现金流，并在数据不完整时保持可信而非输出伪精确数字。

## 板块 13：财务、成本、利润、结算、发票、资金与多币种经营核算

关联执行步骤：ERP-03、ERP-04、ERP-05、ERP-06、ERP-07、ERP-08、ERP-10、ERP-11、ERP-13、ERP-15、ERP-17、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23  
状态：方案已确认，尚未授权实施

### 13.1 结论：先建设可信经营财务，再考虑法定会计

本板块不是给现有页面加几个“销售额、利润、回款”数字，而是建立四类不能混淆的事实：

`SHEIN 官方结算事实 + 内部成本事实 + 资金/票据事实 → 版本化核算引擎 → 利润、应收应付、现金和经营决策`

第一阶段定位为**经营管理会计与平台结算控制台**，服务店铺经营、产品利润、供应商付款、现金安排和异常对账；不自称法定总账、税务申报或审计系统。

不可退让的原则：

1. `costPrice`/供货价是向 SHEIN 报价或平台认可的供货价格，不等于工厂采购成本。
2. 官方结算、内部成本、预计值、实际付款和发票分别建模，不能用一个 amount/status 覆盖。
3. 所有金额保存原始币种、方向、粒度、账期、来源和证据；不同币种没有可审计汇率时不相加。
4. 收入、成本和利润都必须带 coverage、quality、cutoff 和 calculationVersion；数据缺失时显示 unknown/partial，不显示 0。
5. 财务明细采用追加式事实和冲销/更正，不覆盖历史账单或悄悄改旧利润。
6. 页面不得把报账单“已结算”等同银行已到账，也不得把已开票等同已收款。
7. 首期全部平台财务读取由用户手动刷新；Webhook 只落事件/标 dirty，不增加 30 秒、进页、切店或聚焦自动同步。
8. 自动付款、自动开票、自动调账、自动改价和自动扣供应商款均不在首期。

### 13.2 当前代码、数据与官方能力事实

已核验：

1. 能力矩阵登记 `/open-api/finance/report-list`、`report-sales-detail` 和 `report-adjustment-detail` 三类只读接口，财务页面尚未进入 V2 页面地图。
2. 报账单列表以北京时间生成/更新时间查询，单次范围最多 7 天，官方状态至少为待确认、待结算、已结算。
3. 销售款明细摘要标注最多 200 条/页、50 QPS，但当前仓库缺少可完整核验的独立原文和真实 fixture，必须恢复合同后再实现。
4. 补扣款明细有原文；同一 `bzOrderNo + skuCode` 可在不同报账单中以不同费用明细出现。
5. `report-order-list`、`get-check-order-list/detail` 只有目录线索，字段和语义不完整，当前 unsupported。
6. Webhook 名称表有 `invoice_status_notice`，但没有已核验事件合同、身份和字段，不能据此建立发票自动状态。
7. 商品发布与商品详情存在平台 `costPrice/currency`，语义是供货价；模板迁移也明确只保存每平方米供货价默认值，不保存零售价或内部成本。
8. 项目没有 FinanceReport、CostLedger、FX、Profit、Receivable、Payable、Invoice、Payment 或 CashAccount 规范表和 V2 工作台。
9. 现有图片生成用量台账只属于创作服务成本，不能当作统一费用账本；AI 标题成本仍有 actual/estimated/unknown 边界。
10. 当前没有核准的银行流水、支付渠道、发票平台、会计软件或供应商账单自动接入合同。

### 13.3 产品责任边界

本板块负责：

- SHEIN 报账单、销售款、补扣款和后续核准结算接口的可信只读事实。
- 工厂采购、包装、物流、仓储、AI、质量/退货和其他经营成本的版本化成本账本。
- 原币种、多币种换算、利润口径、应收应付、实际收付款和发票状态的经营视图。
- 店铺、商品、SKU、采购批次、履约、售后和财务之间的可解释对账。
- 月结/重开、异常案件、预算和现金预测，但必须保留事实/估计边界。

本板块不负责：

- 中国或海外法定总账、凭证、科目余额表、税务申报、纳税判断或审计报告。
- 替代银行、支付机构、电子发票平台、会计软件或 SHEIN 财务后台。
- 在缺销售款、成本、汇率、退货或结算覆盖时推造利润、ROI、回款或税额。
- 自动向 SHEIN 调价、确认账单、开票、付款、扣款或写回库存。
- 用经营分类冒充会计科目；未来会计集成必须单独设计映射和控制。

### 13.4 六层财务真相

1. **官方平台层**：SHEIN 报账单、销售款、补扣款、结算状态和官方业务单据。
2. **内部成本层**：采购、包材、加工、物流、仓储、AI、售后和其他费用事实。
3. **商业承诺层**：向 SHEIN 的供货价、平台核价/议价、供应商报价和合同价；不是实际收入/成本。
4. **票据与资金层**：发票、收款、付款、银行/支付流水和核销。
5. **计算层**：版本化汇率、分摊、毛利、贡献利润、现金预测和预算差异。
6. **运营决定层**：调价建议、付款审批、供应商索赔、预算调整和改善任务。

任何上层都不能覆盖下层事实；计算和决定必须引用输入快照与版本。

### 13.5 目标拓扑

```text
SHEIN Finance API / Verified Import / Internal Cost Sources / Bank & Invoice Import
                                  │
                                  ▼
                          FinanceSourceInbox
                                  │
                       Raw Receipt + Coverage
                                  │
                    Normalize / Match / Append Facts
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
             SettlementFact   CostLedger    Cash/InvoiceFact
                    └─────────────┼─────────────┘
                                  ▼
                 Allocation / FX / Reconciliation Engine
                                  │
                                  ▼
              ProfitSnapshot / AR-AP / Close / Forecast
                                  │
                                  ▼
                     Review / Approval / Audit / Export
```

浏览器、Excel 导入、Webhook 和 Worker 都必须经过 Inbox/Receipt、身份匹配、权限、幂等和审计。

### 13.6 规范对象

- `FinanceSourceInboxEvent` / `FinanceSourceReceipt`：来源、范围、窗口、分页、raw hash、trace、coverage、contract/normalizer version 和 quality。
- `SettlementReport` / `SettlementEntry`：官方报账单、销售款/服务费/补扣款明细、状态、金额和业务身份。
- `CommercialPriceFact`：SHEIN 供货价、平台建议价、供应商报价等商业价格，明确 priceType/source/effective period。
- `CostLedgerEntry`：成本类型、金额、币种、数量、单位、归属粒度、发生/入账时间、来源和是否估计。
- `CostAllocationRule` / `CostAllocationRun`：分摊范围、driver、输入、结果、舍入和版本。
- `FXRateSnapshot` / `CurrencyConversion`：币种对、来源、时点、rate、用途和版本。
- `ProfitDefinition` / `ProfitSnapshot`：口径、输入快照、覆盖率、利润层级、粒度和 revision。
- `ReceivableItem` / `PayableItem`：应收/应付来源、到期、余额、状态和核销关系。
- `CashAccount` / `CashTransaction`：账户、原币种、交易、流水身份、对手方和敏感数据级别。
- `InvoiceDocument` / `InvoiceLine`：票据号、方向、主体、税额/币种、关联项目、状态和附件。
- `FinancialReconciliationCase`：未匹配、歧义、短款/长款、跨期、汇率、发票或支付异常。
- `AccountingPeriod` / `CloseRun`：期间、cutoff、检查、冻结、重开和审批。
- `BudgetVersion` / `CashForecastSnapshot`：预算/预测输入、假设、版本和偏差。

### 13.7 身份、粒度与时间轴

每条财务事实必须明确：

- tenant、workspace、legalEntity、store、businessMode。
- sourceSystem、sourceDocumentId、sourceLineId、reportOrderNo、businessOrderNo。
- product/SKC/SKU、purchase/delivery/return/quality/appeal 关联。
- amount、currency、direction、quantity、unit。
- occurredAt、documentDate、settlementPeriod、dueAt、paidAt、receivedAt、recordedAt。
- sourceReceiptId、raw hash、contract/normalizer version、quality。

时间轴规则：

1. 业务发生日、平台报账日、结算日、银行到账日和系统录入日分别保存。
2. 日/月归属必须由版本化 Period Policy 决定，不按 `created_at` 随意归期。
3. 后到明细通过新事件和重开/调整进入，不修改已关闭期间的原始事实。

### 13.8 正交状态机

1. Source Receipt：`received → normalized → matched/unmatched/conflict → projected/failed`。
2. SHEIN 报账单：沿用官方待确认/待结算/已结算 code；同步质量另存。
3. Receivable/Payable：`open → partially_settled → settled → disputed/written_off`，每次核销独立。
4. Invoice：`expected → requested → issued/received → verified → matched → cancelled/red`；具体状态以接入合同为准。
5. Payment：`draft → approved → initiated → result_unknown/known_failed → confirmed → reconciled`；首期仅人工记录/导入。
6. Period：`open → soft_closed → hard_closed → reopened`。
7. Reconciliation Case：`open → investigating → evidence_pending → resolved → reopened`。
8. Budget/Forecast：不可变 revision 和 supersedes 关系，不覆盖历史版本。

报账单已结算不自动把应收标记银行已收；发票已开不自动把应收标记已核销。

### 13.9 SHEIN 财务来源读取

1. `report-list` 按北京时间生成或更新时间、不超过 7 天窗口切片，稳定分页、重叠边界去重并保存 coverage。
2. 销售款和补扣款明细按每个 reportOrderNo 分别读取；报告列表成功不等于两类明细完整。
3. 销售明细在正式原文和真实 fixture 未恢复前保持 unsupported，不按摘要猜 payload。
4. 同一业务单号/SKU 多报告、多费用和跨账期全部追加保留，不做覆盖 upsert。
5. `report-order-list`、check-order 和发票事件在完整合同恢复前只登记 capability gap。
6. confirmed empty 必须证明店铺、窗口、分页、报告集合和明细 endpoint 完整，否则为 partial/unknown。
7. 手动刷新创建单一 FinanceRefreshOperation，逐来源显示进度、cutoff、LKG、失败和下一恢复动作。
8. Webhook 只验签落 Inbox、精确匹配或标 dataset dirty，不自动全店读取。

### 13.10 官方收入与结算事实

1. 商品销售款、服务费和补扣款按官方 fee/detail type 分开，原始 code/text 永久保留。
2. `settlementStatus` 是平台报告状态；银行到账和内部核销使用独立对象。
3. 同一订单/SKU 的多次收入、扣款、冲销和补款形成多条 Entry，通过 relation 关联，不覆盖净额。
4. 退款、质量扣款、物流扣款、处罚和申诉补款消费板块 12 关联，但不自动定责。
5. 报账单总额、明细合计和已匹配合计分别展示；差额开 Case，不在浏览器修正。
6. 原币种金额是事实；经营本位币金额是版本化换算结果。

### 13.11 商业价格与财务金额分离

至少区分：

- SHEIN 发布/核准供货价。
- 平台建议成本价/核价。
- 内部目标供货价。
- 工厂报价/合同采购价。
- 实际采购入账成本。
- 消费者零售价（只有正式数据时）。
- 活动价/促销价（只有正式数据时）。

规则：

1. 现有 `costPrice` 字段在新模型中必须映射为明确 `shein_supply_price`，禁止命名为 factoryCost。
2. 每个 PriceFact 保存 SKU、币种、含税口径、生效区间、来源、审批和 revision。
3. 商业价格可作为预计收入/计划输入，但不能冒充报账单收入或实际成本。
4. 历史价格不覆盖；后续定价板块负责议价、活动和利润保护动作。

### 13.12 内部成本账本

CostLedgerEntry 至少支持：

1. 工厂采购/加工成本。
2. 包材：袋、压缩袋、纸箱、护角、标签、说明卡。
3. 正向/逆向物流和运费。
4. 仓储、装卸、质检、打包和操作费。
5. 图片、AI、设计、打样和合规检测成本。
6. 退货、报废、赔偿、质量和处罚损失。
7. 供应商补偿、保险或平台补款等抵减成本。
8. 可配置但受控的其他经营费用。

每条记录明确 actual/estimated/accrual、direct/allocated、source、quantity/unit、taxIncluded、effective/occurred date 和 revision。人工录入、Excel 导入和未来 API 都保存 provenance；未知不补 0。

### 13.13 成本版本、批次与分摊

1. 直接 SKU/采购批次成本优先，不用 SKC 平均成本覆盖尺寸差异。
2. 合同价、标准成本、最新报价和实际入账成本分别保存。
3. 成本生效使用 effectiveFrom/effectiveTo；修改创建新版本，不回写历史利润。
4. 共用费用通过版本化 AllocationRule 分摊，driver 可为数量、面积、重量、体积、箱数、金额或人工批准基准。
5. 每次 AllocationRun 保存输入集合、driver 总量、逐项结果、舍入差额和操作者。
6. 没有合理 driver 时保持未分摊，不强行均摊以凑齐利润。
7. 分摊规则变更生成新 ProfitSnapshot；旧报表仍可重现。

### 13.14 地毯单位经济模型

地毯 SKU 成本必须按尺寸和包装计算：

`材料/加工 + 包材 + 体积/重量敏感物流 + 仓储操作 + 质量/退货风险 + 其他可证实费用`

规则：

1. 长×宽面积、圆形口径、克重和材料单价使用版本化产品事实，不从标题解析。
2. 大尺寸卷装/折叠/压缩、体积重、纸箱/护角和破损风险单独建模，不能套用小地垫平均成本。
3. 每平方米供货价只是商业报价输入；每平方米工厂成本、包材和物流需要独立来源。
4. 预计退货/质量风险可用于情景分析，不计入实际成本；实际损失来自板块 12/财务事实。
5. 缺尺寸、重量、包装或成本时输出“单位经济不完整”，不判定 Push。

### 13.15 多币种与汇率

1. 所有事实永久保留原币种金额，换算金额不能替代原值。
2. FXRateSnapshot 保存 base/quote、rate、provider/source、effectiveAt、fetchedAt、用途和 version。
3. 结算、发生、付款和报表展示可能使用不同汇率政策，必须由 `FXPolicyVersion` 明确。
4. 手工汇率需要权限、理由、附件和有效期，不允许静默覆盖官方/系统汇率。
5. 缺汇率或币种不支持时该聚合为 partial/unknown；不使用“最近一次”无限期回填。
6. 汇兑差异是独立 FinancialEntry，不塞入商品毛利或修改原收入。
7. 本轮不联网自动选汇率源；选择数据源属于后续正式实施决策。

### 13.16 利润定义与计算引擎

至少提供可配置但受治理的层级：

- 官方结算收入。
- 减：平台服务费/补扣款/退款/处罚。
- 得：平台净结算收入。
- 减：直接商品/采购成本。
- 得：商品毛利。
- 减：包装、物流、仓储、AI/设计、售后和可分摊经营成本。
- 得：贡献利润。

ProfitDefinition 保存公式、允许输入、符号、粒度、成本政策、FX policy 和版本。ProfitSnapshot 保存 input receipt/revision、coverage、unknown items、计算时间和结果。首期不输出税后净利润、法定利润或公司整体 EBITDA。

### 13.17 数据质量与利润资格门

利润质量至少为：

- `complete_actual`：收入、成本、汇率和调整均为已确认事实。
- `actual_partial`：有正式事实但覆盖不全。
- `estimated`：包含明确估计/分摊。
- `stale`：来源超过 freshness policy。
- `conflict`：报告/明细/身份或币种冲突。
- `unknown`：无法计算。

每个利润数字显示收入覆盖、成本覆盖、售后覆盖、汇率版本、最旧/最新 cutoff 和未匹配金额。排序/预警必须允许只看特定质量等级，不能把 unknown 排在 0 利润末尾。

### 13.18 应收管理

1. ReceivableItem 来源可以是 SHEIN 报账单、其他核准平台事实或人工合同，但 provenance 必填。
2. 平台待确认、待结算、已结算和银行待收分开；dueAt/expectedAt 无来源时保持 unknown。
3. 部分收款、跨单合并收款、短款/长款和手续费通过 SettlementAllocation 处理。
4. 应收账龄按业务/结算政策和可靠 due date 计算；没有 due date 不伪造逾期。
5. 争议、冻结和申诉关联板块 12 Case；解决不删除应收历史。

### 13.19 应付与供应商结算

1. PayableItem 可来源采购收货、质检通过、供应商账单或合同里程碑，必须明确触发政策。
2. 采购计划、采购单、收货、入库、供应商发票和实际付款分别建模。
3. 供应商报价/供货价不是自动应付；退货、次品、索赔和补偿形成独立争议/调整。
4. 同一供应商不同主体、币种、账期和结算方式不得混付。
5. 首期只生成应付建议、到期提醒和审批任务，不自动付款或扣款。
6. 付款审批前展示来源单据、数量、成本版本、争议、已付/未付和收款账户变更风险。

### 13.20 资金账户与收付款

1. CashAccount 区分银行、第三方支付和内部虚拟账户；账户号只显示脱敏尾号。
2. CashTransaction 通过核准导入/人工登记进入，保存银行流水唯一键、原文、金额、币种、方向和 value date。
3. 收付款和应收应付通过可撤销的 Match/Allocation 关联；流水事实不被业务核销覆盖。
4. 重复导入按 source identity/hash 幂等；字段冲突进入 Case。
5. 未来付款执行必须独立 PaymentCommand、双人审批、step-up/MFA、收款账户白名单和 send boundary；当前冻结。
6. 现金余额、可用余额和预测余额分开；缺 opening balance 或流水覆盖不显示精确余额。

### 13.21 发票与税务边界

1. InvoiceDocument 区分进项/销项、预期/申请/开具/收到/验真/核销/红冲，具体状态以接入合同为准。
2. 发票主体、抬头、税号、币种、含税/未税、税额、行项目和附件保存原始来源。
3. `invoice_status_notice` 在正式事件合同恢复前只属于 capability gap，不能自动投影发票状态。
4. 发票与报账单、应收应付、付款分别关联，不因开票自动确认收入/成本或现金。
5. 本系统首期做票据归档、到期提醒、匹配与导出，不计算应纳税额或自动申报。
6. 税务规则和法定凭证由会计/税务系统负责；未来集成需要受控 mapping 和审计。

### 13.22 期间关闭与重开

Soft Close 前检查：

- SHEIN 报告/明细窗口和 coverage。
- 未匹配/歧义金额。
- 未入账/预计成本和分摊。
- 应收应付、收付款和发票差异。
- 汇率缺失/冲突。
- 退货、申诉和跨期调整。

规则：

1. 关闭只冻结计算版本和普通编辑，不删除/改变源事实。
2. 后到官方明细或更正进入 Adjustment Period 或受控 Reopen。
3. Reopen 需要权限、理由、影响预览和审批；重新计算生成新 Snapshot。
4. 历史关闭版本永久可重现，当前版本通过 pointer 指向，不覆盖旧结果。

### 13.23 对账与异常案件

必须支持：

- 报账单总额与销售/补扣款明细。
- SHEIN 已结算与应收。
- 银行收款与应收核销。
- 采购/收货/入库与供应商应付。
- 供应商发票与应付/付款。
- 退货/处罚/申诉与财务调整。
- 成本分摊与利润输入。

匹配状态为 matched/candidate/ambiguous/unmatched/reviewed/superseded；任何人工认领、拆分、合并和 write-off 保存 before/after、理由、证据和审批。Case 解决不改原始金额，只追加核销/更正关系。

### 13.24 预算与现金预测

1. BudgetVersion 按组织、店铺、品类、商品组、成本类型、币种和月份设置，但首期避免复杂任意维度 DSL。
2. 预测区分合同/已知应收应付、统计预测和人工计划，显示置信度与假设。
3. 采购/备货计划可产生预计现金流，但 Recommendation/Plan 不算实际应付。
4. 退货率、处罚率和汇率情景只做 scenario，不改事实利润。
5. 预算超限开预警/审批任务，不自动停止采购、发布或付款。
6. 无可靠历史时不输出精确现金日期，只给范围和数据缺口。

### 13.25 多店、多主体与组织核算

1. 店铺、店铺组、legalEntity、businessMode 和 settlement currency 是独立维度。
2. 单店事实先核准，再进行多店聚合；跨店报表显示覆盖店铺、cutoff skew、币种和质量。
3. 只有同 ProfitDefinition/FX Policy/Period/质量门的数据可排名。
4. 主体间成本转移、代付或内部结算单独建模，不把跨主体款项当普通费用。
5. 店铺切换取消旧请求和选择；多标签页/导出/缓存按 tenant/user/store/storeSet 隔离。
6. 历史店铺断开后在原权限关系有效时仍可读本地财务历史，远端刷新和动作 fail closed。

### 13.26 权限、审批与审计

建议 capability：

- `finance.read` / `finance.refresh` / `finance.export` / `finance.diagnostics.read`。
- `cost.read` / `cost.manage` / `cost.import` / `cost.allocate`。
- `profit.read` / `profit.definition.manage`。
- `receivable.manage` / `payable.manage` / `reconciliation.manage`。
- `invoice.read` / `invoice.manage`。
- `cash.read` / `cash.import` / `payment.plan` / `payment.approve` / `payment.execute`。
- `period.close` / `period.reopen` / `finance.admin`。

规则：

1. Viewer/Operator 默认看不到供应商账户、银行流水、全租户利润和成本明细。
2. 成本修改、汇率手工覆盖、write-off、期间重开、付款和账户变更分别授权。
3. 高金额付款、收款账户变更、write-off 和期间重开默认双人审批；执行人与审批人分离。
4. 所有导入、匹配、分摊、修改、导出、关闭和重开保留 before/after、授权版本和 operationId。
5. 已进入 send boundary 的未来付款命令不因切店或权限撤销假装取消，按历史授权追踪并立即升级。

### 13.27 财务工作台信息架构

在现有 V2 壳渐进增加“经营财务”，不重做全站 UI：

1. 财务总览：平台待确认/待结算、应收应付、现金缺口、未对账、数据质量和期间状态。
2. SHEIN 结算：报告、销售款、服务费、补扣款、状态和官方 raw 摘要。
3. 成本中心：SKU/批次成本、包材/物流/仓储/AI/售后费用、版本和导入。
4. 利润分析：商品/SKU/店铺/品类、利润层级、coverage、FX 和口径解释。
5. 应收应付：到期、部分核销、争议、供应商和账龄。
6. 发票票据：进销项、附件、匹配、缺票/待处理和敏感访问。
7. 资金：账户、收付款、核销、余额质量和现金预测。
8. 月结与异常：close checklist、未匹配/歧义、重开和审计时间线。

任何卡片都必须显示 asOf、币种/本位币、口径和覆盖；不能只有醒目的大数字。

### 13.28 Snapshot、安全、性能与可观测性

财务列表、计数、总额、利润、allowedActions 和导出绑定同一 `financeSnapshotRevision/asOf/period/fxVersion/profitDefinitionVersion`。

全链追踪：

`refreshOperationId/sourceReceiptId/reportId/entryId/costEntryId/allocationRunId/fxSnapshotId/profitSnapshotId/receivableId/payableId/invoiceId/cashTransactionId/reconciliationCaseId/closeRunId/releaseId`

必须证明：

1. 10/50/100 店、数十万明细、7 天切片、多币种、跨期重算和大导出在 2 核 4GB 下服务端分页、有界内存和后台任务化。
2. 金额使用 decimal/最小货币单位，不使用 JS 浮点直接累计；舍入规则按币种/政策版本化。
3. 银行账户、税号、发票、成本和利润为高敏数据，字段级权限、加密/私有对象、日志脱敏、短时票据和访问审计。
4. 重复导入、分页边界、429、partial、Redis/Worker/DB 崩溃、跨期晚到和汇率缺失可恢复且不重账。
5. 跨 tenant/store、伪造 report/entry/SKU/amount/revision/token、越权导出/下载和重放关闭/付款均零副作用。
6. Scheduler、进页、切店、聚焦和 30 秒自动同步关闭；手动刷新单 owner，当前活动导入/重算可有界查询。

### 13.29 实施交付拆分

| 编号 | 名称 | 核心交付 | 对应 ERP 步骤 |
| --- | --- | --- | --- |
| FIN-01 | 财务资产基线 | API、Webhook、代码、表、页面、成本字段、导入、开关、生产版本和 unsupported 图 | ERP-00、ERP-05、ERP-17 |
| FIN-02 | SHEIN 财务合同与 fixture | report list/sales/adjustment、窗口、分页、状态、错误和脱敏响应 | ERP-07、ERP-17 |
| FIN-03 | 失败回归地基 | 7 天边界、分页、重复、partial/unknown、多报告、币种、跨店和大数精度 | ERP-03、ERP-17、ERP-19 |
| FIN-04 | Finance Inbox/Receipt | API/Webhook/导入统一入口、raw、coverage、trace、contract/normalizer version 和 LKG | ERP-06、ERP-10、ERP-17 |
| FIN-05 | Settlement Fact | 报账单、销售款、服务费、补扣款、官方状态和不可变身份 | ERP-04、ERP-06、ERP-17 |
| FIN-06 | Commercial Price Fact | SHEIN 供货价、核价、工厂报价/合同价的明确语义和版本 | ERP-04、ERP-06、ERP-17 |
| FIN-07 | Cost Ledger | 工厂、包材、物流、仓储、AI、售后等 actual/estimate/accrual 成本事实 | ERP-06、ERP-17 |
| FIN-08 | Cost Import/Version | 人工/Excel provenance、批次、effective period、历史保留和校验 | ERP-06、ERP-13、ERP-17 |
| FIN-09 | Allocation Engine | driver、范围、输入、结果、舍入、版本和未分摊边界 | ERP-04、ERP-06、ERP-17 |
| FIN-10 | FX Engine | 原币种、Rate Snapshot、Policy、conversion、汇兑差异和 unknown | ERP-04、ERP-06、ERP-17 |
| FIN-11 | Profit Engine | Definition/Snapshot、利润层级、输入快照、coverage、quality 和重算 | ERP-04、ERP-06、ERP-17 |
| FIN-12 | Receivable | 平台结算到应收、账龄、部分核销、争议和收款匹配 | ERP-06、ERP-13、ERP-17 |
| FIN-13 | Payable/Supplier | 采购/收货/发票/应付/争议、付款建议和供应商对账 | ERP-06、ERP-13、ERP-17 |
| FIN-14 | Invoice/Document | 进销项、附件、主体、状态、匹配、隐私和会计边界 | ERP-06、ERP-15、ERP-17 |
| FIN-15 | Cash/Payment | 账户/流水导入、收付款、核销、余额质量和付款冻结边界 | ERP-06、ERP-08、ERP-17 |
| FIN-16 | Reconciliation/Close | 多链对账、Case、期间检查、soft/hard close、重开和审计 | ERP-06、ERP-13、ERP-17 |
| FIN-17 | Budget/Forecast | 不可变预算、现金预测、情景、coverage 和偏差 | ERP-04、ERP-13、ERP-17 |
| FIN-18 | Finance Workbench/Access | 八页签渐进 UI、capability、审批、敏感字段和导出 | ERP-13、ERP-17、ERP-21 |
| FIN-19 | 性能/安全/恢复验收 | 多店大明细、decimal、切片、导入、故障、重算、私密文件和 2 核 4GB | ERP-19、ERP-21 |
| FIN-20 | 金丝雀与退役 | 单店只读报告、成本导入影子利润、核销/月结 canary、回滚和旧 owner 零引用 | ERP-20、ERP-22、ERP-23 |

FIN-01 至 FIN-11 是任何利润结论的 P0 地基；FIN-12 至 FIN-16 未通过前不得声称应收、应付、到账、发票或月结完整。Payment execute 当前保持冻结，不因工作台上线开放。

### 13.30 验收标准、已确认决策与后续讨论项

官方结算与成本：

- 7 天窗口、分页、列表/销售/补扣款明细、重复/乱序/partial 可重放；空/缺页不写 0。
- 同一业务单号/SKU 的多报告、多费用、跨账期冲销/补款全部保留；总额与明细差异可见。
- SHEIN 供货价、工厂报价、实际采购成本和平台结算金额语义完全分离。
- SKU/采购批次成本、包材、物流、仓储、AI、售后和其他费用均有来源、币种、日期、版本和质量。

汇率与利润：

- 原币种金额永久保留；每次换算可追溯 FX source/time/policy/version，缺汇率不汇总。
- 大数/小数/正负/舍入由 decimal 与币种规则控制，前后端不使用浮点累计产生分钱差。
- 毛收入、平台净收入、毛利和贡献利润分层，显示收入/成本/售后/汇率覆盖和未匹配金额。
- 数据 partial/estimated/stale/conflict/unknown 时不输出 complete_actual，不排序成确定利润。

应收应付、票据与资金：

- SHEIN 已结算、应收、银行到账和核销分别建模；供应商报价、应付、发票和付款分别建模。
- 部分核销、合并收付款、短长款、争议和 write-off 都有 Allocation/Event/Audit。
- `invoice_status_notice` 未核准前不自动投影；发票不改变收入/成本/现金事实。
- 缺 opening balance/流水 coverage 不显示精确现金余额，首期无自动付款/开票。

月结、安全与上线：

- Close checklist 能阻断未匹配、缺汇率、缺成本或来源 stale；重开生成新版本并保留历史关闭快照。
- 财务列表、计数、总额、利润和导出来自同一 Snapshot/Period/FX/Definition revision。
- 跨 tenant/store、伪造金额/identity/revision、越权看成本/银行/票据、重复导入和重放动作均零副作用。
- 当前继续手动刷新，无 Scheduler、30 秒、进页、切店或聚焦自动同步。
- 先单店只读结算，再导入一小批真实脱敏成本做影子利润；人工与系统对账通过后才扩店/关账，不开放付款执行。

已确认决策：

1. 第一阶段是经营财务/管理会计，不冒充法定总账、税务或审计系统。
2. SHEIN `costPrice` 明确定义为供货价，不作为工厂成本。
3. 官方结算、商业价格、内部成本、票据、资金和计算结果分层。
4. 金额事实追加保存，冲销/更正通过新 Entry，不覆盖历史。
5. 原币种永久保留，不同币种无正式 FX 证据不汇总。
6. 成本按 SKU/采购批次优先，地毯大尺寸不使用 SKC 平均成本。
7. 共用成本分摊规则版本化，缺合理 driver 时保持未分摊。
8. ProfitDefinition 与 Snapshot 不可变，所有利润显示覆盖率和质量。
9. 平台已结算、应收、银行到账和核销不是同一个状态。
10. 供应商报价、应付、发票和付款不是同一个状态。
11. 发票事件合同未核准前不自动同步或显示伪状态。
12. 月结冻结计算版本而非源事实；晚到明细走调整/重开。
13. 高敏财务数据字段级授权，高风险动作双人审批。
14. 当前继续手动刷新；Webhook 只落 Inbox/标 dirty。
15. 工作台渐进加入 V2，不借财务板块重做全站 UI。

明确不做：

- 不把供货价、报价或建议价当收入或工厂成本。
- 不把 SHEIN 报账单已结算显示成银行已到账。
- 不把发票已开/已收显示成应收应付已核销。
- 不把缺失成本、退货、汇率、流水或明细补 0 后计算利润。
- 不跨币种直接相加，不用长期过期的最近汇率静默回填。
- 不自动付款、开票、调价、扣供应商款、write-off 或关闭期间。
- 不提供无来源的税额、税后净利润或法定会计报表。

板块 14 继续讨论：供货价、平台核价/议价、建议零售价、活动价、价格证明、成本变更与利润保护如何形成独立价格生命周期，确保任何调价先经过利润底线、权限、材料、平台命令和官方回读。

## 板块 14：价格生命周期、平台核价/议价、建议零售价、活动价与利润保护

关联执行步骤：ERP-03、ERP-04、ERP-05、ERP-06、ERP-07、ERP-08、ERP-09、ERP-10、ERP-11、ERP-13、ERP-15、ERP-17、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23  
状态：方案已确认，尚未授权实施

### 14.1 结论：价格是独立业务生命周期，不是商品表上的一个输入框

目标模型是：

`官方/内部价格事实 + 成本与利润快照 + 平台规则/议价任务 + 权限与审批 → 不可变价格决定 → 持久命令 → 官方回读 → 生效价格事实`

不可退让的原则：

1. SHEIN 供货价、平台建议价、议价报价、建议零售价、活动价、内部目标价、工厂成本和结算收入是不同 PriceType，永不互相覆盖。
2. 商品发布/审核阶段、价格议价状态、建议零售价审核状态、命令执行状态和价格生效状态正交存在。
3. 浏览器不能直接拥有 SHEIN 改价执行权；HTTP 200、本地保存、材料上传或平台受理都不等于价格已生效。
4. 所有价格决定必须引用明确 SKU/site/currency/effective interval、当前官方 revision、成本/利润 revision、规则 revision 和证据。
5. 利润数据不完整时只能显示“数据不足”，不得把 unknown 当安全、把供货价当工厂成本或静默放行。
6. 低于利润底线默认阻断；Owner/Admin 只能通过双人例外审批、影响预览、理由和有效期申请放行，不能静默覆盖。
7. 接受、拒绝、重新报价、修改供货价和提交建议零售价是不同动作合同、权限、开关和金丝雀。
8. 当前继续用户手动刷新；Webhook 只落 Inbox/标 dirty，不增加 Scheduler、30 秒、进页、切店或聚焦自动同步。
9. 价格工作台渐进加入现有 V2，不借本板块重做全站前端。

### 14.2 当前代码、文档与能力事实

已核验：

1. 当前审核中心页面直接展示核价卡片，并可同步调用接受/拒绝接口；服务端在 HTTP 请求内直接请求 SHEIN，缺少 PriceCommand、事务 Outbox、`send_started`、`result_unknown` 和官方生效回读。
2. 当前接受提示会改变平台建议成本价；拒绝后商品不能上架且不能再次报价，属于不可逆高风险决定，但现有流程缺少利润门、影响范围和双人例外控制。
3. 当前 V2 只覆盖接受/拒绝，未完整支持重新报价；不得用同一 payload 或失败试错猜测动作。
4. SHEIN 议价列表区分新商品议价、老商品议价和新商品核价复议，并有待商家确认、平台审核、接受、不接受及议价终止等独立状态。
5. 剩余议价次数有限；为 0 时不能继续报价。重新报价需要当前 discussSn、讨论步骤、最新历史价格、原因、材料及完整 SKU 报价集合。
6. 供货价更新接口适用于全托管/半托管，最多按合同限制提交 SKC/SKU 集合；自 2026-07-01 起调价原因必填，原因选项按商家动态读取，待审核中的价格不能重复变更。
7. 供货价金额必须大于 0、小于平台上限，并按币种动态精度处理；不能在代码中固定两位小数或复制示例币种规则。
8. 价格证明上传仅返回 objectKey；上传成功不代表价格申请、议价或建议零售价已提交。
9. 建议零售价当前值可按最多 100 SKC 读取；提交最多 10 SKC/次，并采用全量替换语义，遗漏现有值会被清空。
10. 建议零售价审核至少存在审核中、部分抽检不通过、部分审核不通过、生效、将过期、已过期和部分过期，且可能按 SKU/site 部分失败。
11. 发布阶段只有动态发布标准出现 `suggest_price` 且规则要求时，SKU 建议零售价才可见/必填；不能全类目硬编码。
12. 现有 `server/shein-upload.js` 支持议价、建议零售价和供货价涨价证明类型，但文件上传与业务提交未形成统一证据链。
13. 商品售价修改 `/openapi-business-backend/product/price/save` 当前合同字段不完整且未进入 V2，不得纳入首期执行。
14. 尚未核准活动/促销报名和活动价的正式 SHEIN 合同；该能力保持人工/导入/unsupported，禁止伪造平台活动状态。

### 14.3 产品责任边界

本板块负责：

- SHEIN 供货价、价格议价、建议零售价及未来核准活动价格的事实、规则、决定、命令和回读。
- 价格证明材料、调价原因、利润底线、例外审批和审计。
- 按店铺/SKC/SKU/site/currency/effective interval 的价格历史、当前值和差异。
- 价格工作台、待办、批量资格、风险预览、操作结果和诊断。

本板块不负责：

- 替代板块 13 的成本、结算、汇率、利润或资金事实。
- 把消费者零售价、活动价或 GMV 当成已获得的官方事实。
- 自动接受核价、自动拒绝、自动重新报价、自动改供货价、自动报活动或自动跟价。
- 用价格动作改写商品审核、发布执行、合规、库存、履约或财务状态。
- 在未恢复完整合同和金丝雀前开放商品售价、活动报名或批量不可逆写入。

### 14.4 价格类型与层级

至少建立以下强类型：

- `shein_supply_price`：向 SHEIN 的供货价/平台认可成本价。
- `platform_suggested_supply_price`：平台在议价中给出的建议供货价。
- `merchant_discussion_quote`：商家本轮重新报价。
- `merchant_target_supply_price`：内部目标供货价，不代表已提交或生效。
- `recommended_retail_price`：SKU/site 建议零售价。
- `platform_retail_price`：只有正式只读来源时保存的平台消费者售价。
- `promotion_price`：只有正式合同/核准导入时保存的活动价。
- `factory_quote`、`purchase_contract_cost`、`actual_procurement_cost`：来自板块 13 的内部成本事实。
- `settlement_revenue`：来自板块 13 的实际结算事实，不属于可编辑价格。

PriceType 决定粒度、来源、可执行动作和精度；界面不得只显示“价格”而隐去类型和币种。

### 14.5 目标拓扑

```text
SHEIN Price/Discussion/RRP API + Verified Import + Internal Targets
                              │
                              ▼
                    PriceSourceInbox / Receipt
                              │
                    Normalize + Identity Match
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   PriceFact/Revision   PriceDiscussion       RRP Snapshot
          └───────────────────┼───────────────────┘
                              ▼
            ProfitSnapshot + PriceRule + Proof Bundle
                              │
                    Plan / Preflight / Approval
                              │
             PriceDecision / PriceCommand / Outbox
                              │
                    Action-specific Worker
                              │
                SHEIN Receipt + Official Readback
                              │
                      Effective Price Fact
```

### 14.6 规范对象

- `PriceSourceInboxEvent` / `PriceSourceReceipt`：来源、目标、分页、raw hash、trace、contract/normalizer version、coverage、cutoff 和 quality。
- `PriceFact` / `PriceRevision`：priceType、对象粒度、金额、币种、含税口径、来源、生效区间、状态和 supersedes。
- `PriceDiscussion` / `PriceDiscussionLine` / `PriceDiscussionHistory`：discussSn、类型、状态、轮次、剩余次数、平台建议、商家报价、SKU 行和官方历史。
- `PriceProposal`：目标动作、目标价格集合、原因、输入 revision、创建人和到期时间。
- `PriceProofBundle` / `PriceProofItem`：业务用途、适用 SKC/SKU/site/round、文件 hash、objectKey、来源、隐私和保留策略。
- `RRPPolicy` / `RRPSnapshot` / `RRPSubmission` / `RRPAuditResult`：规则、当前完整集合、提交、逐 SKU/site 审核和过期状态。
- `PriceFloorPolicy`：最低金额、最低毛利额/率、贡献利润、质量要求、币种与适用范围。
- `PriceDecision` / `PriceExceptionApproval`：决定、风险快照、审批人、理由、预计损失、数量、有效期和 supersedes。
- `PriceCommand` / `PriceCommandAttempt` / `PriceCommandReceipt`：不可变 payload、动作合同、发送边界、结果、官方 trace 和回读证据。
- `PromotionPriceCandidate`：活动候选或人工事实；未核准合同前不生成平台命令。

### 14.7 身份、粒度、币种与时间

1. 每个价格保存 tenant/store/businessMode、platform SPU/SKC/SKU、site、currency 和 priceType。
2. 供货价通常以 SKU 为执行行；建议零售价以 SKU/site 组合为独立组，不用 SKC 平均值覆盖。
3. `amount + currency + precisionRuleVersion` 是不可拆分事实；币种来自当前平台商品/规则，不由页面默认。
4. observedAt、submittedAt、acceptedAt、effectiveFrom/effectiveTo、expiredAt 和 recordedAt 分开。
5. 当前值使用显式 currentRevisionId；历史查询按 effective interval，不用更新时间猜最新。
6. 同一 SKU 的跨站点、跨币种、部分生效和部分审核必须保留，不压成商品级一个状态。

### 14.8 五套正交状态机

1. 商品工作流：待发布/平台审核/核价/寄样/驳回等，由板块 05/06 管理。
2. 议价：待商家确认/平台审核/已接受/未接受/终止成功/终止失败，沿用官方 code。
3. 建议零售价：审核中/部分失败/生效/将过期/过期/部分过期，逐 SKU/site 投影。
4. 命令：planned/authorized/queued/claimed/send_started/result_unknown/known_failed/accepted/readback_confirmed。
5. 价格生效：proposed/submitted/approved/effective/superseded/expired/unknown。

一个商品处于“待核价”不等于议价命令失败；议价被接受也不等于价格已官方回读生效；任何本地价格状态不得改写官方商品审核阶段。

### 14.9 来源读取与手动刷新

1. 议价列表、当前建议零售价、规则、审核记录和后续核准价格来源统一进入 PriceSourceInbox/Receipt。
2. 请求目标、页码、SKC/SKU/site、requested/returned/missing、官方 trace 和 raw 永久可重放。
3. `confirmed_empty` 必须证明完整店铺、筛选、分页和目标覆盖；失败/缺页保留 LKG，并标 partial/unknown。
4. 用户点击手动刷新创建或复用单一 PriceRefreshOperation，按来源显示进度和部分失败。
5. Webhook 只落 Inbox、精确关联或标 dataset dirty；不自动刷新整店、不自动执行价格动作。

### 14.10 供货价更新

1. 更新前读取当前商品/SKU 价格、币种、平台 SKU/SKC/SPU、待审状态和当前 change reason options。
2. proposal 按 SKC 组织完整 SKU 行，逐行校验 >0、平台上限、币种精度、未变价格和待审冲突。
3. 接口限制按当前合同版本执行；任何超限由服务端确定性分块，不由浏览器切片。
4. 涨价证明、原因和备注绑定 proposal revision；备注按官方长度限制校验。
5. 提交 accepted 后仍处于“待官方确认”，只有官方价格回读匹配才成为 effective。
6. 部分成功逐 SKC/SKU 保存，不把整批显示为成功或失败。

### 14.11 调价原因治理

1. 原因选项按店铺/业务模式/contractVersion 读取并缓存为带过期时间的 Option Snapshot。
2. 2026-07-01 起需要原因的合同规则作为版本化资格条件，不在 UI 写死一个通用原因。
3. stale/unknown 原因快照阻断新命令；已创建 proposal 保留当时 label/code，但授权时必须重验当前 code。
4. 人工备注补充原因但不能替代官方 reason code；所有变化进入审计。

### 14.12 平台议价读取与历史

1. 保存讨论类型、状态、discussSn、当前轮次、剩余次数、同价标志和所有 SKU 历史。
2. 平台最新建议、商家上轮报价和当前有效供货价分别保存，不能只保留最后一个金额。
3. 列表、计数、详情和 allowedActions 来自同一 priceSnapshotRevision。
4. 状态只有待商家确认时才可执行当前轮次动作；剩余次数为 0 时不显示重新报价资格。
5. 官方历史乱序或重复通过 Receipt + reducer 幂等归并，不删除旧轮次。

### 14.13 接受、拒绝与重新报价

1. 接受：使用平台当前建议价格；展示逐 SKU 新旧价、利润影响、币种和生效不确定性。
2. 拒绝：明确“商品不能上架且不能再次报价”的不可逆影响，采用动作级强确认、影响预览和更高权限。
3. 重新报价：单独合同，必须引用当前 discussSn/discussStep、latest lastCost/lastCurrency、原因、材料和完整 SKU 新报价。
4. 接受/拒绝的 `confirmInfos` 与重新报价的 `createCostDiscusses` 不能混合到同一命令。
5. 每个讨论同时只允许一个活动 PriceCommand；命令创建后锁定当前 discussion revision，状态变化则授权失败。
6. 首期不提供“全选全部接受/拒绝”；批量只支持逐项影响预览、逐项资格和逐项结果。

### 14.14 价格证明材料

1. 文件上传、病毒/类型/大小校验、SHEIN objectKey 和业务提交分成独立阶段。
2. ProofItem 明确 type、适用 SKC/SKU/site/discussion round/price revision，不能因同一文件而复制适用性。
3. 议价、建议零售价和供货价涨价材料用途分开；当前平台数量/格式限制按合同版本校验。
4. 上传成功只显示“材料可用”，不得显示“调价已提交”或改变价格状态。
5. 文件私有保存、短时下载、hash、访问审计、retention hold 和失败重传均沿用板块 07。

### 14.15 建议零售价规则与当前值

1. 发布标准仅在 `suggest_price` 可见/必填时要求该字段；按当前类目、店铺和 SKU 标准快照预检。
2. 当前值读取按合同最大 SKC 数确定性切片并逐 target 对账。
3. 一个 SKU 可同时存在站点特定与非站点 RRP 组；currency、值、生效时间和状态逐组保存。
4. 规则中的价格范围、证明要求、币种、有效期和站点范围进入 RRPPolicy revision。
5. 将过期/部分过期形成明确待办，不自动续期或复制历史材料。

### 14.16 建议零售价全量替换与审核

1. 提交前必须读取并冻结当前完整 RRP 集合，执行 `read → merge → preview → authorize → submit`。
2. 用户修改的是 patch intent；服务端基于冻结 revision 生成完整 replacement payload，遗漏值不得被意外清空。
3. 提交最多按当前合同允许的 SKC 数分块；一个块失败不覆盖其他块结果。
4. 官方抽检/审核结果按 SKU/site 记录修改前后值、失败原因和审核时间。
5. partial fail/partial expired 不得压成商品级“全部失败/全部过期”；修正动作只作用失败且当前 eligible 行。

### 14.17 消费者售价与活动价格边界

1. `/openapi-business-backend/product/price/save` 合同不完整，首期仅列 capability gap，不从页面开放。
2. 活动报名、活动价格和促销状态未核准正式合同前，允许人工登记/核准导入活动事实，但 UI 必须标“人工来源”或 unsupported。
3. 不从建议零售价、供货价、销量或后台截图推造消费者成交价、折扣率、GMV、活动成功或活动库存。
4. 未来每类活动 action 单独恢复合同、adapter、权限、限流、命令、官方回读和金丝雀，不复用通用改价动作。

### 14.18 利润底线与数据资格

PriceFloorPolicy 可按租户/店铺组/店铺/类目/SKC/SKU/尺寸定义：

- 最低供货价、最低毛利额、最低毛利率或最低贡献利润。
- 允许使用的 ProfitDefinition、FX Policy、成本版本和质量等级。
- 最低覆盖率、最大 stale 时长、风险缓冲和有效期。

规则：

1. 价格决定必须引用板块 13 的 ProfitSnapshot，不复制或修改财务事实。
2. `complete_actual` 或批准允许的 `estimated` 才可自动判定通过；partial/conflict/unknown 默认数据不足。
3. 地毯按尺寸 SKU 计算，包含面积、克重、包材、体积重、仓储、质量/退货风险，不按 SKC 平均利润放行大尺寸。
4. 平台建议价低于底线时展示金额/百分比差、预计销量区间和预计损失，不自动接受。
5. 汇率、成本或售后数据变化只使旧 proposal stale；不静默改写已批准决定或历史快照。

### 14.19 例外审批

1. Owner/Admin 可发起低于底线例外，但发起人与最终批准人必须是不同活动成员。
2. 例外记录逐 SKU 价格、预计单位/总损失、影响数量、商业理由、证据、有效期和最大执行次数。
3. Reviewer 可复核但不能代替所需财务/经营权限；审批人在批准时看到与申请时的差异。
4. 任一价格、成本、FX、平台状态、数量范围或合同 revision 变化使 approval 失效，必须重新申请。
5. 例外只授权指定 command/action，不永久降低 PriceFloorPolicy。
6. 平台动作本身 unsupported、合同未核准或金丝雀关闭时，即使审批通过也不能执行。

### 14.20 地毯价格梯度与商品族

1. 价格梯度以尺寸 SKU、面积、克重、材料、工艺、包装和体积重为基础，不按标题或图片猜规格。
2. 同图案/同 SKC 的尺寸梯度提供异常检测：单位面积供货价、绝对毛利、毛利率和大尺寸物流跳变。
3. 建议价格只生成 Proposal，不直接写平台；异常梯度需人工确认是否为商业策略、成本变化或数据错误。
4. 商品族模板可复用规则，不复用价格事实、审批、证明材料适用性或平台回执。

### 14.21 持久命令与发送边界

1. 页面只提交 plan/preflight intent；服务端冻结 proposal、当前官方 revision、profit/floor/proof revision 和目标集合。
2. authorize 复核权限、双人审批、合同/开关、资格、额度/QPS、币种精度和 stale 状态。
3. PriceCommand/Event/Outbox 在一个数据库事务提交；Dispatcher 一 Command 一确定性 Job。
4. Worker 外部调用前持久化 `send_started`；发送前崩溃可安全恢复，发送后超时进入 `result_unknown` 并锁定业务键。
5. `result_unknown` 不允许通用 BullMQ 自动重试；必须只读回查或人工平台核验后收敛。
6. 接受、拒绝、重报价、供货价更新、RRP 提交分别配置 attempts、限流、熔断、capability 和 canary。

### 14.22 官方回读与生效证据

1. HTTP 200/accepted 只证明平台受理；页面显示“已提交，待确认”。
2. 官方议价列表、当前供货价或 RRP 当前值与目标 revision 匹配，才能形成 `readback_confirmed/effective`。
3. 价格值、币种、SKU/site、讨论轮次和提交时间共同参与匹配，不能只看状态中文或最新一行。
4. 回读与提交冲突时保留两套证据，开 PriceReconciliationCase，不覆盖目标或官方值。
5. 回读超时显示最后成功时间、来源健康和人工后台核对入口，不伪造失败或成功。

### 14.23 批量、选择与并发

1. selection 绑定 tenant/user/store/tab/filter/priceSnapshotRevision/eligibilityRevision，只包含当前可见 eligible 行。
2. 切 tab、筛选、搜索、店铺、刷新或 revision 变化后，隐藏选择必须清理或显式重新确认。
3. 跨页全选显示实际目标数、SKC/SKU/site 数、动作、预计利润影响和不可逆项；默认不跨店。
4. 提交前服务端逐项重验并返回 eligible/blocked/stale；blocked 不影响其他 eligible 项。
5. 每店/endpoint 公平有界并发，遵守当前 QPS/批量限制；2 核 4GB 不允许全量同时重算利润和上传材料。

### 14.24 待办、预警与 SLA

建立独立 PriceTask/Case：

- 待商家确认议价、剩余次数临界、材料缺失。
- 建议零售价将过期/部分过期/部分审核失败。
- 价格低于底线、成本上涨后 margin erosion、币种/精度冲突。
- submitted 超时未回读、result_unknown、官方值与目标不一致。
- 原因选项/规则/ProfitSnapshot stale 或数据质量不足。

支持 owner、优先级、截止时间、确认、分派、解决、复发和证据时间线；预警不自动执行调价。

### 14.25 权限与高风险动作

建议 capability：

- `price.read`、`price.refresh`、`price.propose`、`price.proof.upload`。
- `price.supply.submit`、`price.discussion.accept`、`price.discussion.reject`、`price.discussion.requote`。
- `price.rrp.submit`、`price.exception.request`、`price.exception.approve`、`price.policy.manage`。
- `price.export`、`price.diagnostics`。

拒绝议价、低于底线例外和大范围批量写使用 step-up、强确认或双人审批；所有检查由服务端执行，按钮可见性不是安全边界。

### 14.26 价格工作台

渐进加入现有 V2，建议页签：

1. 总览：待办、利润风险、数据新鲜度和动作健康。
2. 平台议价：逐讨论历史、剩余轮次、建议/报价和 allowedActions。
3. 供货价：当前值、历史、proposal、待审和官方回读。
4. 建议零售价：SKU/site 当前完整集合、审核、过期和材料。
5. 活动价格：首期只读人工事实/unsupported 说明。
6. 利润保护：底线政策、例外申请、预计影响和历史决定。
7. 命令与异常：accepted、result_unknown、冲突、人工核对和恢复动作。

审核中心只显示与商品工作流相关的“待核价”摘要和跳转，不再直接承载全部价格业务或自己执行 SHEIN 调价。

### 14.27 一致快照、搜索与导出

1. 列表、tab 计数、详情、allowedActions、利润影响和批量目标来自同一 priceSnapshotRevision。
2. 搜索支持 SKC/SKU/SPU、discussSn、标题和命令 ID；服务端分页，不下载全量到浏览器筛选。
3. 导出包含 priceType、SKU/site/currency、当前/建议/目标值、状态、cutoff、quality、profit revision 和来源。
4. 导出异步生成、短时下载、最小字段、权限裁剪和审计；未授权用户看不到工厂成本或利润底线。

### 14.28 安全、性能与可观测性

1. trace 贯穿 refresh/source/discussion/proposal/proof/profit/approval/command/outbox/job/attempt/SHEIN trace/readback/case/release。
2. 监控待确认数量、议价 SLA、RRP 过期、底线阻断、例外金额、result_unknown、回读延迟、partial 和 stale。
3. 日志只记录脱敏 identity、金额摘要、版本和错误码，不记录密钥、完整材料、完整 payload 或敏感成本明细。
4. 10/50/100 店、1k/10k SKU、多币种、分块提交、材料文件、限流、断线、Redis/Worker/DB 崩溃和 2 核 4GB 均有预算与恢复测试。
5. 任何价格高风险告警均可定位“是否调用 SHEIN、在哪个发送边界、目标值、官方证据和为何当前不可继续”。

### 14.29 实施顺序

| 顺序 | 工作包 | 主要内容 | 归属步骤 |
| --- | --- | --- | --- |
| PRICE-01 | 价格资产基线 | endpoint、原文、表、代码、页面、开关、生产版本和真实 owner 全图 | ERP-00、ERP-05、ERP-17 |
| PRICE-02 | 官方合同与 fixture | 供货价、原因、议价、材料、RRP 的字段/状态/限制/错误和真实脱敏响应 | ERP-07、ERP-17 |
| PRICE-03 | 失败回归地基 | 直接调用、隐藏选择、全量替换清空、精度、partial、unknown、不可逆拒绝和跨店负向测试 | ERP-03、ERP-17、ERP-19 |
| PRICE-04 | 价格类型与状态字典 | PriceType、五套状态机、identity、币种和 effective interval | ERP-04、ERP-06 |
| PRICE-05 | Source Inbox/Receipt | 议价、供货价、RRP、规则、审核 raw/coverage/LKG | ERP-06、ERP-10 |
| PRICE-06 | PriceFact/Revision | 不可变当前/历史事实、显式 pointer 和来源 | ERP-06 |
| PRICE-07 | Discussion 模型 | 讨论、轮次、剩余次数、SKU 行、历史和 allowedActions | ERP-06、ERP-10 |
| PRICE-08 | RRP 模型 | 规则、完整集合、site/SKU 状态、提交和审核 | ERP-06、ERP-10 |
| PRICE-09 | Proof Bundle | 上传、objectKey、用途、适用范围、隐私和保留 | ERP-06、ERP-15 |
| PRICE-10 | 利润底线 | ProfitSnapshot 资格、PriceFloorPolicy、地毯尺寸单位经济和 stale 门 | ERP-06、ERP-17 |
| PRICE-11 | Proposal/Preflight | 当前值、目标值、原因、材料、利润、规则和影响预览 | ERP-07、ERP-17 |
| PRICE-12 | 例外审批 | 双人审批、预计损失、数量、理由、有效期和 revision 失效 | ERP-06、ERP-17 |
| PRICE-13 | 持久命令 | PriceCommand/Event/Outbox、单 Job、send_started、result_unknown | ERP-06、ERP-08、ERP-17 |
| PRICE-14 | 动作适配器 | 接受/拒绝/重报价/供货价/RRP 独立 contract/capability/canary | ERP-07、ERP-17 |
| PRICE-15 | 官方回读 | 目标匹配、生效事实、冲突 Case 和超时恢复 | ERP-10、ERP-17 |
| PRICE-16 | 快照 API | tab/计数/列表/详情/allowedActions/利润影响同 revision | ERP-11 |
| PRICE-17 | 商业工作台 | 议价、供货价、RRP、利润保护、命令异常渐进 UI | ERP-13、ERP-17 |
| PRICE-18 | 权限/批量/诊断 | capability、selection scope、审计、指标和短时导出 | ERP-17、ERP-18、ERP-19 |
| PRICE-19 | 迁移与金丝雀 | 只读影子 → 单动作单商品 → 单店小批 → 多店 | ERP-20、ERP-21、ERP-22 |
| PRICE-20 | 稳定与退役 | 两个 release、零旧 owner、回滚演练后退役直接调用和兼容字段 | ERP-23 |

PRICE-01 至 PRICE-10 是价格真相、合同、状态、利润和材料的 P0 地基；PRICE-11 至 PRICE-15 未完成前，不允许任何新的 SHEIN 价格写入。当前审核中心同步接受/拒绝路径应先由 action capability 冻结，再在 PRICE-13～15 完整替代后按动作金丝雀恢复。

### 14.30 验收标准、已确认决策与后续讨论项

验收标准：

- 所有价格类型在 API、数据库、UI、导出和测试中语义分离；`costPrice` 不再被解释为工厂成本。
- 商品审核、议价、RRP、命令和价格生效五类状态互不改写，逐 SKU/site partial 可见。
- 当前价格、讨论历史、剩余轮次、规则和材料可由 raw Receipt 重放；缺页/失败不显示伪 0 或空。
- 接受、拒绝、重报价、供货价和 RRP 的 contract/payload/权限/开关/限流/回读完全独立。
- 低于底线、利润数据不足、原因/规则 stale、币种精度错误或待审冲突均 fail closed；例外双人审批可追溯。
- RRP 全量替换通过 read-merge-freeze 测试，遗漏值不被清空，部分审核/过期不被压平。
- 1/15/50 个目标在筛选、切 tab、切店、刷新和旧响应晚到后无隐藏选择、跨店或整批误判。
- 重复点击、断线和 Worker/Redis/DB 崩溃不丢命令、不重复调用；`send_started` 后 unknown 不自动重试。
- 页面只有官方值/状态回读匹配才显示已生效；上传材料、HTTP 200 和本地 accepted 不产生伪成功。
- 手动刷新单 owner，无 Scheduler、30 秒、进页、切店或聚焦自动同步。
- 工作台渐进上线且非目标路由视觉基线无变化；回滚不删除 PriceFact、Discussion、Decision、Command、Receipt 或审批历史。

已确认决策：

1. 建立独立价格领域，不继续把核价塞在审核中心页面逻辑中。
2. 价格类型强类型化，商业价格、内部成本和结算收入不互相覆盖。
3. 商品审核状态与价格状态完全正交。
4. 所有价格事实不可变，当前值使用显式 revision pointer。
5. 接受、拒绝和重新报价是三种动作；拒绝按不可逆高风险动作治理。
6. RRP 使用逐 SKU/site 模型，全量替换必须先冻结当前完整集合。
7. 材料上传不等于业务提交，objectKey 必须绑定明确用途和 revision。
8. 利润底线引用板块 13 的 ProfitSnapshot；unknown/partial 不代表安全。
9. Owner/Admin 可申请低于底线例外，但必须双人审批、预计损失、影响数量和有效期。
10. 浏览器不直接调用 SHEIN 价格写；统一持久 Command/Outbox/Worker/send boundary。
11. accepted 不等于 effective，官方回读匹配是生效证据。
12. 消费者售价和活动能力未核准合同前保持 unsupported/人工事实，不推造平台状态。
13. 首期不自动跟价、接受、拒绝、重报价、改价或报活动。
14. 当前继续手动刷新；Webhook 只落事件/标 dirty。
15. 价格工作台渐进加入 V2，不重做全站 UI。

明确不做：

- 不按中文状态、更新时间或页面当前 tab 猜价格结果。
- 不因同一 SKC 平均利润为正而放行亏损大尺寸 SKU。
- 不把平台建议价自动视为可接受，也不把低于底线例外永久改成新底线。
- 不用材料上传成功、队列完成或 HTTP 200 表示调价成功。
- 不在未知合同上试错，不开放通用“改价”接口包住所有动作。
- 不跨店一键接受/拒绝/改价，不保留隐藏选择。
- 不自动报名活动、自动跟竞品价或自动支付任何价格相关费用。

板块 15 继续讨论：运营活动、商品推广、选品测款、商品分层与生命周期增长如何在缺少部分 SHEIN 官方流量/活动合同的现实下，区分平台事实、人工运营计划、实验与决策，并把新品、潜力款、成长款、爆款、稳定款、滞销款和退出款形成可解释、可执行且不伪造数据的增长闭环。

## 板块 15：运营活动、商品推广、选品测款、商品分层与生命周期增长

关联执行步骤：ERP-03、ERP-04、ERP-05、ERP-06、ERP-07、ERP-08、ERP-10、ERP-11、ERP-13、ERP-14、ERP-15、ERP-16、ERP-17、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23  
状态：方案已确认，尚未授权实施

### 15.1 结论：增长是证据驱动的决策闭环，不是给商品贴“爆款”标签

目标模型是：

`官方经营事实 + 商品/价格/库存/利润/质量事实 + 人工市场证据 → 机会与实验 → 人工决定 → 跨领域运营计划 → 结果评估 → 生命周期迁移`

不可退让的原则：

1. 商品商业生命周期、经营表现分层、平台活动状态、内部运营计划和风险/阻断状态必须正交。
2. 没有官方曝光、点击、访客、加购、支付人数或转化数据时，这些指标就是 unknown，不允许推算、补 0 或借销量反推。
3. “新品、潜力款、成长款、爆款、稳定款、衰退款、滞销款、清仓款”必须引用规则版本、时间窗、数据覆盖和决定人，不能是页面临时字符串。
4. 生命周期粒度至少为 `store × product/SKC × site × productVersion`；同一图案在不同店铺/站点可以处于不同阶段。
5. 测款先冻结假设、商品版本、价格、标题/素材、库存、时间窗和成功/停止条件；数据出来后不能回改标准。
6. 运营建议只生成 Plan/Task，不直接改标题、图片、价格、库存、上下架、活动或发布状态；执行交给对应领域。
7. 活动报名 API 当前不支持，平台活动事实只能来自未来核准只读合同、Webhook 或带来源的人工/导入记录，不得显示伪“已报名/已通过”。
8. 放量必须同时通过利润、库存/履约、质量/售后、合规、图片/尺寸预期和供应稳定性门，不以销量单指标决定。
9. AI 只提供可解释候选、证据摘要和诊断建议，不自动晋级、淘汰、报名活动、改价或补货。
10. 当前仍只允许手动刷新；活动中的本地任务可有界读取自身进度，但不恢复普通页面定时同步。

### 15.2 当前代码、数据与官方能力事实

已核验：

1. SHEIN 官方 FAQ 明确：流量概览暂未开放 API；曝光/曝光人数、详情访客、加购访客、支付人数、点击率、加购率和支付率均无法通过 API 获取。
2. 全托管商家是平台供货商，不能从开放平台获得站点销售订单；当前可用经营来源是 `/open-api/goods/query-sku-sales` 的 SKU 销量窗口，以及商品、上架和库存事实。
3. SKU 销量接口当前归档能力为 100 SKU/次、40 QPS；返回 today/yesterday/7/30 日窗口，不等于真实逐日序列。
4. SHEIN 官方 FAQ 明确目前不支持通过接口创建商品促销活动；首期不存在自动报名、自动推广或活动状态写入。
5. 官方说明消费者站点展示价可能受平台活动和规则影响，不一定等于商家设置价；不能由供货价/RRP 推造成交价或折扣。
6. 商品参加营销活动时可能禁止下架；任何未来退出/清仓计划必须先核验活动占用，不能直接发送上下架动作。
7. 当前 V2 经营页只读 `store_business_snapshots` 与商品投影，页面按 30 日销量排序，并展示 today/7/30 日销量、库存、可售天数和简单备货缺口。
8. 当前 `buildStoreBusinessWarnings` 以固定阈值生成新品起量、缺货、低库存、滞销、下架有库存和销量下降提示；这些是即时计算数组，不是持久生命周期、实验或协作 Case。
9. “新品起量”目前使用上架不超过 7 天且 7 日销量大于 3；“滞销”使用库存不少于 20 且 30 日销量为 0；规则未包含覆盖率、利润、质量、合规、断货抑制、商品版本或站点差异。
10. 当前销售下降用 7 日日均与前 23 日平均比较，但 7/30 日聚合窗口不能证明某次主图、标题、价格或活动造成了变化。
11. 当前经营快照主体仍为每店一行 JSONB 最新快照；没有 GrowthPortfolio、LifecycleStageHistory、Experiment、CampaignFact、GrowthDecision 或 PostMortem 规范对象。
12. 当前不存在消费者商品详情链接 API，无法依赖开放平台自动跳转并抓取前台排名、竞品或评论。

### 15.3 产品责任边界

本板块负责：

- 选品机会池、商品组合、测款实验、生命周期、经营分层、活动计划、增长建议和复盘。
- 把销量、库存、价格、利润、质量、售后、合规、履约和市场证据组合成可解释决定。
- 将决定安全交接给商品、媒体、标题、价格、备货、活动和下架领域，并跟踪结果。
- 单店与多店商品组合视图、阶段迁移、负责人、观察窗口、预警和效果评估。

本板块不负责：

- 创造 SHEIN 未开放的流量、转化、订单、活动报名或前台售价数据。
- 替代商品发布、价格、库存、履约、合规、财务或质量领域执行外部写入。
- 自动抓取或宣称实时竞品销量、排名、广告数据、评论或搜索热度。
- 用算法自动决定上新、放量、清仓、下架、换图、改价、备货或供应商处置。
- 将内部生命周期标签回写为 SHEIN 官方商品状态。

### 15.4 五层语义与禁止混用

1. **平台事实**：官方上架/审核、SKU 销量、库存、价格、活动占用和未来核准活动状态。
2. **经营事实**：利润、售后、质量、合规、履约、备货、内容版本和供应稳定性。
3. **内部分类**：生命周期阶段、经营分层、机会类型和风险标签。
4. **运营决定**：测试、继续观察、优化、放量、守成、降量、清仓或退出。
5. **执行结果**：对应领域 Plan/Task/Command 的本地、平台受理和官方回读。

内部“爆款”不等于平台活动款；“清仓”不等于已下架；“待优化”不等于审核驳回；“销量为 0”不等于没有需求。

### 15.5 目标拓扑

```text
SHEIN Facts + ERP Facts + Verified Manual Market Evidence
                           │
                           ▼
                 GrowthInputSnapshot / Quality
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   Opportunity Pool   Portfolio Engine   Alert/Case
          │                │
          └────────────┬───┘
                       ▼
          Experiment / Campaign / Action Plan
                       │
                  Human Decision
                       │
        Domain Tasks: Content / Price / Stock / ...
                       │
                       ▼
                Result Observation
                       │
                       ▼
       Lifecycle Transition / Evaluation / PostMortem
```

### 15.6 规范对象

- `GrowthInputSnapshot`：来源、窗口、cutoff、coverage、quality、商品/价格/利润/库存/质量/内容 revision。
- `GrowthPortfolioItem`：store/product/SKC/site/productVersion、当前生命周期、负责人、策略和 current revision。
- `LifecyclePolicy` / `LifecycleStageHistory`：阶段、准入/退出规则、最短/最长停留、决定、证据和 supersedes。
- `SegmentDefinition` / `SegmentSnapshot`：需求、利润、库存/履约、质量/售后、合规、内容和供应维度的版本化分层。
- `GrowthOpportunity`：来源、场景/风格/功能/价格带、证据、置信度、风险、失效时间和决定。
- `GrowthExperiment` / `ExperimentCohort` / `ExperimentObservation`：假设、变量、版本、范围、基线、窗口、样本、结果和局限。
- `CampaignFact` / `CampaignPlan`：平台事实或人工来源、活动窗口、对象、价格、资格、状态、证据和交接任务。
- `GrowthActionPlan` / `GrowthActionItem`：目标、动作域、优先级、owner、输入 revision、验收、依赖和执行回执引用。
- `GrowthRecommendation` / `GrowthDecision`：建议、原因分解、数据缺口、人工采纳/编辑/拒绝和有效期。
- `GrowthAlertCase`：阶段超时、数据不足、断货抑制、利润侵蚀、质量恶化、活动占用和结果异常。
- `GrowthEvaluation` / `GrowthPostMortem`：预期与实际、可比性、已知限制、结论、后续动作和知识沉淀。

### 15.7 身份、粒度与时间

1. 规范身份为 tenant/workspace/store/businessMode/productId/SKC/SKU/site/productVersionId。
2. 生命周期通常在 store + SKC + site + version 粒度；SKU 尺寸用于销量、利润、库存和质量证据，不强制每个 SKU 一套商业阶段。
3. 同图案或商品族通过 `ProductFamily` 关联，只共享研究与模板，不共享阶段、销量、审批或平台事实。
4. observedWindow、decisionAt、effectiveFrom、reviewAt、endedAt、recordedAt 分开保存。
5. 上架日来自官方 firstShelfTime；下架期间、断货期间和数据缺口单列，不能算成有效测试天数。
6. 阶段 current pointer 显式指向 LifecycleStageHistory；不按最近标签或更新时间推断。

### 15.8 七套正交状态机

1. 商品官方工作流：发布/审核/核价/寄样/驳回/上架。
2. 商业生命周期：候选/准备/测款/验证/成长/规模/稳定/衰退/清仓/退出。
3. 实验：draft/approved/running/paused/completed/inconclusive/cancelled。
4. 活动：candidate/planned/manual_submission_recorded/official_pending/approved/active/ended/rejected/unknown。
5. 内部计划：draft/review/approved/in_progress/blocked/completed/cancelled。
6. 领域执行：沿用标题、媒体、价格、库存、发布等各自 Command 状态。
7. 风险 Case：open/investigating/action_pending/resolved/reopened。

缺货、合规阻断、活动占用、审核驳回和质量风险是正交 blocker，不通过把生命周期改成“失败”来表达。

### 15.9 数据来源与手动刷新

1. 增长引擎只读取板块 03～14 的规范 Snapshot/Fact，不直接请求 SHEIN 或读取页面临时状态。
2. 销量、库存、上架、价格、利润、质量、合规、履约各自保留独立 cutoff、coverage、quality 和 revision。
3. 人工市场证据必须保存来源类型、链接/截图/导入批次、采集人、时间、市场/关键词和有效期。
4. 用户手动刷新增长输入时，复用对应领域的单一 RefreshOperation；不创建第二套 SHEIN fan-out。
5. Webhook 只更新事实/标 dirty；增长 recompute 消费已落库版本，不因事件直接执行运营动作。
6. 无官方来源的曝光/点击/转化字段在 schema 中为 unsupported/unknown，不以 nullable 0 代替。

### 15.10 商品生命周期

建议主链：

`candidate → launch_ready → testing → validated → growth → scale → stable → decline → clearance → retired`

阶段含义：

- `candidate`：有机会证据，尚未完成建品/风险/利润门。
- `launch_ready`：商品版本、合规、价格底线、素材、供应与首批库存计划完整。
- `testing`：已上架并进入冻结观察窗口；允许收集数据，不随意改多个关键变量。
- `validated`：达到预先定义的最低证据，可进入增长计划；不等于爆款。
- `growth`：销量/利润/履约等持续满足扩大条件，正在受控增加库存/内容/站点或活动机会。
- `scale`：经过多个窗口验证、供应和质量稳定，可提高资源优先级。
- `stable`：成熟经营，重点是利润、库存和质量防守。
- `decline`：可比窗口持续下降或风险恶化，等待诊断/优化决定。
- `clearance`：已批准退出策略，处理库存与活动约束；不代表已下架。
- `retired`：停止新增运营投入，保留全部历史；官方上/下架仍独立。

任何迁移都保存 policyVersion、inputSnapshot、系统建议、人工决定和下一 reviewAt。`blocked/paused` 作为修饰状态，不新增旁路阶段。

### 15.11 生命周期迁移治理

1. 自动规则只能生成候选迁移，不直接改变 current stage；负责人确认后产生 Decision。
2. 每个阶段定义最低/建议停留、数据完整性、准入、退出、回退和强制复核条件。
3. testing 期间关键商品版本、价格、主图、标题、库存计划变化会结束旧实验或生成新 revision，不继续混算。
4. 断货、下架、平台审核、数据 stale 等无效天数从观察窗口剔除并显示 coverage。
5. 同一商品允许从 decline 回到 growth，但必须通过新决定，不覆盖旧衰退历史。
6. retired 只停止内部投入，不删除商品、素材、财务、售后或平台历史。

### 15.12 多维商品分层

不用单一黑盒分数决定“爆款”，至少并列显示：

- 需求：销量水平、速度变化、有效上架天数、窗口覆盖。
- 利润：单位/总贡献利润、质量和价格底线距离。
- 库存/履约：可售天数、在途、补货周期、缺货抑制和交付稳定性。
- 质量/售后：缺陷、退货、处罚、申诉、证据质量和趋势。
- 合规/内容：要求覆盖、素材真实性、尺寸/场景清晰度、标题/属性完整性。
- 供应：MOQ、交期、产能、成本波动、尺寸/包装稳定性。

SegmentDefinition 保存 grain、窗口、阈值、权重、质量要求和版本。可以提供 A/B/C 或“增长/防守/观察”组合标签，但页面必须展开原因，不隐藏维度冲突。

### 15.13 选品机会池

机会来源：

1. 内部原创图案/商品族与历史变体表现。
2. 人工 SHEIN 前台关键词、竞品、价格带、评价痛点和买家图研究。
3. 当前店铺的真实销量、尺寸结构、库存和售后缺口。
4. 季节、节日、场景、功能、市场和供应商提案。
5. AI 根据已授权证据生成的候选，不作为事实。

每个 GrowthOpportunity 保存场景、风格、功能、材质、尺寸梯度、目标价格带、差异点、证据、新鲜度、风险和“进入/小测/暂缓/拒绝”决定。实时热度、竞品销量和排名没有证据时不填数值。

### 15.14 测款计划

GrowthExperiment 在开始前冻结：

- 单一主假设和决策问题。
- 店铺、站点、SKC/SKU、ProductVersion、商品族和 cohort。
- 标题、主图/详情图、属性、供货价/RRP、库存/补货、合规和供应快照。
- 开始/结束、有效观察天数、最低数据覆盖、成功/失败/停止/无结论标准。
- 主要指标、护栏指标和不可观测指标。
- 允许变更与变更后如何分段/终止。

首期以单商品前后观察或人工对照为主，明确标注 observational，不把相关性写成因果 A/B 结论。

### 15.15 数据资格与“零销量”诊断

销量为 0 可能来自：

- 无曝光或曝光不足（当前 API 不可观测）。
- 有曝光无点击（不可观测）。
- 有访问无购买（不可观测）。
- 未上架、站点不可售、价格/库存缺失、审核/活动/合规阻断。
- SKU 映射、窗口、分页或刷新失败。
- 确有需求不足。

因此系统只能在官方上架、库存/价格可售、销量 coverage 完整且窗口有效时称“确认零销量”；诊断仍需人工后台流量截图才能判断曝光/点击/转化。页面禁止把 0 销量直接建议换图、降价或淘汰。

### 15.16 地毯测款与放量门

地毯测试必须覆盖：

1. 场景：客厅、卧室、浴室、厨房、玄关、走廊、儿童、宠物和节日装饰。
2. 风格/图案：原创性、颜色、构图、不同站点审美和图案族差异。
3. 功能与证据：可洗、防滑、吸水、柔软、低掉毛等声明只有材料/测试支持时使用。
4. 尺寸梯度：小地垫、runner、区域毯和大尺寸分别检查销量、利润、库存和售后；不能以小尺寸起量证明整组可放量。
5. 预期管理：房间比例、实际厚度、颜色、折痕、气味、锁边、掉毛和防滑底。
6. 包装/履约：折叠/卷装/压缩、实重/体积重、箱规、回弹和破损。

放量前必须证明目标尺寸 SKU 的利润、包装、供应、履约、质量和售后风险，而不是只证明图案卖得动。

### 15.17 实验评价与因果边界

1. GrowthEvaluation 引用开始前冻结标准和所有中途变更事件。
2. 结果至少区分 pass/fail/inconclusive/data_invalid；数据不足不能写失败。
3. 7/30 日聚合窗口只能比较同口径窗口，不生成伪逐日曲线或精确变点。
4. 同期价格、库存、活动、标题、素材、站点、上架状态和季节变化作为 confounder 显示。
5. 没有平台随机分流或可靠对照时只陈述关联，不声称某张主图“提升了转化率”。
6. PostMortem 保存保留/扩大/再次测试/暂停/退出决定和下一验证问题。

### 15.18 平台活动与促销边界

1. 当前官方能力明确不支持通过 API 创建商品促销活动，首期 CampaignPlan 只生成后台人工任务。
2. 人工记录“已在后台提交”必须附操作者、时间、截图/导出和目标；它不是官方已通过事实。
3. 未来若获得活动只读合同，CampaignFact 经 Inbox/Receipt 保存官方活动 ID、窗口、状态、对象和规则。
4. 活动候选、人工已提交、官方待审、已通过、活动中和已结束分别建模。
5. 活动中可能禁止下架；清仓、退役、换价、下架前必须检查当前活动占用和官方规则。
6. 站点售价可能受平台活动改变；效果评价没有官方实际活动价/销量归因时不得算活动 ROI。

### 15.19 活动资格与风险预检

CampaignPlan 至少检查：

- 商品审核/上架/站点可售和活动规则来源。
- 价格底线、RRP/活动价格证据和 ProfitSnapshot 质量。
- SKU 库存、在途、补货周期、活动窗口和履约能力。
- 合规、图片/文案声明、质量/退货、处罚和未决申诉。
- 供应产能、MOQ、包材、尺寸结构和预计损失上限。

任何来源 unknown/stale、利润底线失败、关键尺寸缺货或质量严重风险都形成 blocker。例外沿用对应领域审批，增长模块不得自建旁路。

### 15.20 运营动作编排

可生成的 GrowthActionItem 包括：

- 新建/调整商品版本、补属性或新增尺寸。
- 创建标题候选、媒体变体或场景图任务。
- 创建供货价/RRP/议价 proposal。
- 创建备货计划、质量改进、合规补件或供应商任务。
- 创建人工活动报名/后台核对任务。
- 创建暂停投入、清仓评审或下架候选。

每项引用输入 revision、目标、owner、验收和依赖；只有对应领域完成并回传结果，增长计划才能标 completed。增长页面不能直接拼 payload 调用多个外部接口。

### 15.21 放量、守成、衰退与退出

放量条件至少包括：

- 连续多个有效窗口而非单日峰值。
- 目标 SKU/尺寸利润合格且质量不为 unknown。
- 库存、在途、交期、产能和包装可支撑。
- 质量/售后/合规/处罚无不可接受风险。
- 商品内容真实且尺寸/厚度/颜色预期清晰。

衰退诊断先区分断货抑制、活动结束、季节变化、价格变化、内容版本、质量问题、平台状态和真实需求下降。清仓/退出要同时处理库存、活动占用、应付/结算、素材保留和历史数据，不自动下架或删除商品。

### 15.22 多店群与商品族

1. 每店/站点独立生命周期与实验；同一 SKC 或 ProductFamily 不复制销量、利润、活动或阶段。
2. 跨店只输出可比 Snapshot 的分布和建议，如“该图案在 3/5 店验证通过”，不建立一个全局 current stage。
3. 店铺组策略可定义首发店、验证店、跟进店和禁止店，但实际发布/价格/库存仍逐店审批。
4. 从 A 店复制到 B 店只复制用户批准的商品模板/素材引用，并重新经过 B 店规则、价格、合规和供应预检。
5. 切店清理当前机会、实验、筛选、选择和活动任务；旧请求晚到不得覆盖新店。

### 15.23 AI 推荐边界

1. AI 输入只使用有权限、带来源和 revision 的 GrowthInputSnapshot；不得自行抓取未知平台数据。
2. 输出必须分解为证据、规则命中、数据缺口、风险、候选动作和置信度，不能只有一个“爆款分”。
3. AI 建议保存 model/prompt/policy/input fingerprint、候选和用户决定，沿用板块 08 成本与失败治理。
4. AI 不自动改变生命周期、实验结果、活动事实、价格、库存、标题、图片或上下架状态。
5. Provider 失败不阻断人工运营；页面保留已有事实与人工计划。

### 15.24 预警、SLA 与复盘

建立持久 GrowthAlertCase：

- testing 超过最大有效窗口仍无结论。
- 候选进入 launch_ready 但合规/价格/素材/供应长期缺失。
- growth/scale 断货、利润侵蚀、质量恶化或交期失稳。
- stable 商品连续可比窗口下降。
- clearance 有库存、活动占用或财务/售后未闭环。
- 实验数据 invalid、关键 revision 变化或人工证据过期。

支持 owner、SLA、确认、分派、稍后、解决和复发；结案必须引用行动结果或明确“接受风险”。

### 15.25 权限与审批

建议 capability：

- `growth.read`、`growth.refresh`、`growth.opportunity.manage`。
- `growth.experiment.create`、`growth.experiment.approve`、`growth.experiment.evaluate`。
- `growth.lifecycle.propose`、`growth.lifecycle.decide`、`growth.segment.policy.manage`。
- `growth.campaign.plan`、`growth.campaign.record_manual`、`growth.action.create`。
- `growth.export`、`growth.diagnostics`。

跨店策略、scale/clearance/retired 决定、大额活动/库存计划和低利润例外需要更高权限或双人审批；普通 Operator 可提交建议和执行已分配任务，不能修改规则历史。

### 15.26 增长运营工作台

渐进加入现有 V2，建议页签：

1. 组合总览：各阶段数量、数据质量、利润/库存/质量风险和 reviewAt。
2. 机会池：场景/风格/功能/价格带证据、风险和决定。
3. 测款中心：实验卡、冻结版本、有效天数、观察和结论。
4. 生命周期：按阶段/负责人/店铺/商品族查看迁移与停留。
5. 活动计划：人工后台任务、平台事实边界、资格和占用。
6. 增长动作：内容、价格、备货、质量、合规等跨域任务进度。
7. 复盘库：成功、失败、无结论、数据无效和可复用知识。

现有商品经营页保留真实销量/库存详情，只增加进入增长记录的链接或摘要；不借本板块重做经营中心。

### 15.27 一致快照、筛选与批量

1. 阶段计数、列表、详情、维度分数、allowedActions 和批量候选来自同一 growthSnapshotRevision。
2. selection 绑定 tenant/user/store/tab/filter/snapshot/policyRevision，只包含当前可见 eligible 行。
3. 批量阶段建议只生成逐项 Proposal；服务端逐项重验，不把整批直接迁移或执行外部动作。
4. 跨页/跨店操作必须显式展示目标、阶段前后、利润/库存/质量缺口和受影响任务。
5. 导出带口径、窗口、coverage、quality、cutoff、policy/input revision 和人工来源标识，不输出伪流量指标。

### 15.28 安全、性能与可观测性

1. trace 贯穿 input snapshot/opportunity/segment/experiment/decision/action/domain task/result/lifecycle/postmortem/release。
2. 监控阶段分布、超时复核、数据质量、建议采纳、实验无结论、放量后断货/利润/质量恶化和人工活动待办。
3. 10/50/100 店、1k/10k 商品、多窗口重算、商品族聚合、大导出和 2 核 4GB 有明确资源预算。
4. 规则计算服务端分页/增量、可重放，不由浏览器加载全量 JSONB 后排序和打标签。
5. 竞品截图、评论摘录、供应商资料和利润数据按权限、私有对象、短时票据和审计治理。
6. 诊断台能回答某商品为何处于该阶段、用了哪些事实/版本、谁决定、执行了什么、哪些指标不可观测。

### 15.29 实施顺序

| 顺序 | 工作包 | 主要内容 | 归属步骤 |
| --- | --- | --- | --- |
| GROW-01 | 增长资产基线 | 当前快照、阈值预警、页面、规则、活动线索、手工表和生产 owner 全图 | ERP-00、ERP-05、ERP-17 |
| GROW-02 | 官方能力边界 | 销量/上架/库存/活动占用合同，流量/促销 unsupported 证据和真实 fixture | ERP-07、ERP-17 |
| GROW-03 | 失败回归地基 | 伪流量、0 销量误判、全局阶段、版本混算、隐藏选择、自动动作和跨店负向测试 | ERP-03、ERP-17、ERP-19 |
| GROW-04 | 生命周期字典 | 十阶段主链、正交 blocker、合法迁移、停留和回退规则 | ERP-04、ERP-06 |
| GROW-05 | GrowthInputSnapshot | 多领域 revision/cutoff/coverage/quality 与人工证据 provenance | ERP-06、ERP-10 |
| GROW-06 | Portfolio/Stage History | store/SKC/site/version current pointer、历史与负责人 | ERP-06 |
| GROW-07 | Segment Engine | 需求/利润/库存/质量/合规/内容/供应多维分层和解释 | ERP-06、ERP-17 |
| GROW-08 | Opportunity Pool | 选品来源、商品族、市场证据、风险、有效期和决定 | ERP-06、ERP-17 |
| GROW-09 | Experiment Model | 假设、cohort、冻结变量、窗口、标准、观察和局限 | ERP-06、ERP-17 |
| GROW-10 | Rug Growth Policy | 场景/风格/尺寸梯度、包装、售后、利润与放量门 | ERP-16、ERP-17 |
| GROW-11 | Campaign Boundary | 人工计划/提交记录与未来官方 Fact 分层、活动占用和资格 | ERP-07、ERP-17 |
| GROW-12 | Action Plan | 跨域任务、依赖、输入 revision、验收和结果引用 | ERP-06、ERP-17 |
| GROW-13 | Decision/Approval | 阶段迁移、放量/清仓、例外、审批和过期 | ERP-06、ERP-17 |
| GROW-14 | Evaluation/PostMortem | 可比窗口、confounder、pass/fail/inconclusive/invalid 和知识库 | ERP-06、ERP-17 |
| GROW-15 | AlertCase | 阶段超时、数据不足、断货/利润/质量恶化、活动占用和复发 | ERP-06、ERP-17 |
| GROW-16 | 一致快照 API | 阶段/分层/实验/活动/任务/计数/allowedActions 同 revision | ERP-11 |
| GROW-17 | 增长工作台 | 组合、机会、测款、生命周期、活动、动作和复盘渐进 UI | ERP-13、ERP-17 |
| GROW-18 | 权限/AI/诊断 | capability、解释性推荐、选择、导出、指标和审计 | ERP-17、ERP-18、ERP-19 |
| GROW-19 | 迁移与影子验证 | 旧预警对照、人工运营表对账、单店 shadow、浏览器验收 | ERP-20、ERP-21、ERP-22 |
| GROW-20 | 稳定与退役 | 两个 release、规则/阶段回放、零旧 owner 后退役临时标签 | ERP-23 |

GROW-01 至 GROW-10 是增长事实、生命周期、分层和实验的 P0 地基；GROW-11 至 GROW-15 未完成前，活动、放量、清仓或跨域动作只能作为明确人工任务，不得称为系统自动增长闭环。

### 15.30 验收标准、已确认决策与后续讨论项

验收标准：

- 生命周期、分层、平台活动、内部计划、领域执行和风险 Case 在 API/数据库/UI 中完全正交。
- 每次阶段迁移可追溯 store/SKC/site/version、policy、input snapshot、coverage、决定人和 reviewAt。
- 暂无流量 API 时曝光/点击/转化始终 unknown；0 销量按可售/覆盖/断货/下架等证据解释，不推造原因。
- 测款冻结假设、版本、价格/内容/库存、窗口和标准；中途变更分段或结束旧实验，不回改基线。
- 多维分层能解释需求、利润、库存、质量、合规、内容和供应冲突，不用单一黑盒“爆款分”。
- 地毯按尺寸 SKU、包装、物流、质量和售后门放量，小尺寸成功不自动放大整组。
- 活动 API unsupported 时只产生人工后台任务；人工已提交、官方待审/通过和活动中不混淆。
- GrowthActionPlan 只交接对应领域任务，不直接调用标题/媒体/价格/库存/上下架/发布接口。
- 同商品跨店/站点阶段独立；切店、筛选、刷新和旧响应晚到后无串店或隐藏选择。
- 现有 7/30 日窗口不生成伪逐日曲线或因果结论；实验可明确 inconclusive/data_invalid。
- 手动刷新单 owner，无 Scheduler、30 秒、进页、切店或聚焦自动同步。
- 工作台渐进上线、非目标页面视觉无变化，回滚不删除阶段、实验、决定、任务或复盘历史。

已确认决策：

1. 建立独立增长运营域，不继续靠最新快照中的临时 warning 数组表达商业生命周期。
2. 生命周期、经营分层、平台活动、人工计划和异常状态正交。
3. 生命周期粒度至少为 store × SKC × site × productVersion，不设一个跨店全局阶段。
4. 阶段迁移由系统建议、人工决定和版本化历史组成，不自动晋级/淘汰。
5. 流量、点击和转化 API 未开放时保持 unsupported/unknown，不推算。
6. today/7/30 日窗口不冒充逐日历史，也不用于无对照因果结论。
7. 测款开始前冻结假设、版本、变量、窗口和标准；数据不足为 inconclusive，不是失败。
8. 爆款判断采用需求、利润、库存/履约、质量/售后、合规/内容和供应多维门。
9. 地毯按尺寸 SKU 和包装/售后风险放量，不以图案或 SKC 平均值替代。
10. 促销活动 API 当前不支持，首期只建立人工任务与来源清晰的记录。
11. 活动计划引用板块 14 价格底线和板块 10/11 库存履约，不自建例外旁路。
12. GrowthActionPlan 只编排跨域任务，不直接拥有外部写接口。
13. AI 只生成可解释建议，不自动改阶段或执行运营动作。
14. 当前继续手动刷新；Webhook 只更新事实/标 dirty。
15. 增长工作台渐进加入 V2，不重做现有经营中心。

明确不做：

- 不用销量推造曝光、CTR、转化率、加购率、支付率或活动流量。
- 不把近 30 日销量排序直接命名为商品生命周期或爆款榜。
- 不将库存 20 且 30 日销量 0 的临时阈值直接作为淘汰决定。
- 不自动报名活动、改价、换图、改标题、补货、上下架、清仓或删除商品。
- 不将人工后台提交记录称为 SHEIN 已通过或活动中。
- 不跨店复制阶段、实验结果、价格、销量、利润或平台活动事实。
- 不在没有可比窗口和版本冻结时声称某次优化提升了转化。

板块 16 继续讨论：团队任务、审批流、消息通知、SLA、运营日历、评论与跨板块协同如何形成统一工作系统，使发布、审核、合规、价格、备货、质量、财务和增长产生的待办都有明确负责人、期限、权限、证据和闭环，同时避免各页面自建任务、通知轰炸或审批被绕过。

## 板块 16：团队任务、审批、通知、SLA 与协同工作流

关联执行步骤：ERP-03、ERP-04、ERP-05、ERP-06、ERP-08、ERP-09、ERP-10、ERP-11、ERP-13、ERP-15、ERP-17、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23  
状态：方案已确认，尚未授权实施

### 16.1 结论：协同层是工作控制面，不是新的业务真相或万能状态机

目标模型是：

`业务事实/异常/决定需求 → WorkSignal → WorkItem/Approval → 分派与 SLA → 评论/材料 → 领域动作 → 结果证据 → 验证关闭/复发`

不可退让的原则：

1. `WorkItem` 只协调“谁在何时基于什么证据完成什么工作”，不能覆盖商品、发布、审核、价格、履约、财务或增长领域的真实状态。
2. 人工业务任务、审批请求、系统同步 Job、外部 SHEIN Command、通知投递和日历事件必须是不同对象与状态机。
3. “任务已完成”不等于“发布成功”“价格已生效”“平台已审核”或“资金已到账”；平台结果仍由对应领域 Receipt/Readback 证明。
4. 每项工作必须绑定 tenant/workspace/store、业务对象、不可变 subjectRevision、来源、责任人、期限、权限和完成证据。
5. 审批只能授权指定动作和 revision；审批后业务内容变化时自动失效，不能用旧批准执行新内容。
6. 通知只是提醒和入口，不是业务事实、权限边界或审批凭据；通知丢失不能改变任务和业务状态。
7. SLA 到期只触发本地升级、提醒或管理视图，不自动调用 SHEIN、重试高风险外部动作或改变官方状态。
8. “今日工作”升级为真实个人工作台；现有同步“任务中心”明确更名为系统/同步任务，不能混成一个列表。
9. 当前继续手动刷新；协同定时器只处理本地期限与消息，不恢复进页、切店、30 秒或常驻 SHEIN 同步。
10. 本板块渐进接入现有 V2，不借协同建设重做全站导航、品牌、业务页面或领域状态机。

### 16.2 当前代码与产品事实

已核验：

1. 当前 `/jobs` 页面名为“任务中心”，实际对象只有店铺经营刷新、商品增量、销量、库存、合规、规则和 Webhook reconcile 等同步 Job。
2. 同步 Job 的 queued/running/succeeded/completed_with_errors/failed/cancelled 是系统执行状态，不含业务负责人、人工期限、评论、审批和验收。
3. 当前“今日工作”由发布任务、价格接受/拒绝审计、审核驳回和寄样 Webhook 聚合生成，只读展示指标与动态，不是可分派、可关闭的工作项。
4. `today-work-service` 只对部分价格动作记录活动；发布、合规、质量、履约、财务和增长没有统一工作对象。
5. 合规预审已有 reviewer/status 等局部字段，价格、增长、采购、申诉等也各自需要审批，但没有统一 ApprovalRequest/Step/Decision 契约。
6. 当前不存在统一 assignee、team queue、dueAt、response SLA、resolution SLA、blocked reason、handoff、delegation、orphan detection 或 escalation。
7. 当前不存在统一评论、@成员、附件证据、编辑历史、订阅偏好、通知去重、摘要、免打扰和投递回执。
8. 当前没有运营日历、工作日/节假日、店铺/成员时区或期限口径；跨站点与跨团队任务容易错过截止。
9. 现有业务 Case、Plan、Recommendation、Command 和 Job 已有各自 owner；协同层必须引用它们，不能再复制一份可漂移业务状态。
10. 当前活动中的同步任务可有界轮询，但普通页面和跨域任务不应借协同层恢复自动 SHEIN 请求。

### 16.3 产品责任边界

本板块负责：

- 统一工作类型注册、任务生成/去重、分派、SLA、评论、材料、审批、通知、运营日历、个人与团队工作台。
- 将发布、审核、合规、价格、库存、履约、质量、财务和增长产生的待办送达正确成员，并跟踪人工工作结果。
- 为高风险领域动作提供不可变审批、职责分离、一次性授权和完整审计。
- 处理人员离岗、转交、代理、逾期、阻塞、复发、批量分派和跨店汇总。

本板块不负责：

- 替代领域 Fact、Case、Plan、Command、Receipt、Readback、Projection 或 current pointer。
- 以关闭任务代替 SHEIN 官方成功、结算完成、合规通过或库存变化。
- 自建发布、价格、库存、发货、申诉、付款等通用外部执行器。
- 因通知、日历或 SLA 到期自动执行 SHEIN 写入、自动刷新或通用重试。
- 将个人待办系统扩展成无限层级 BPMN、低代码平台、聊天系统或外部 SaaS 项目管理器。

### 16.4 六类对象必须分离

1. **Business Fact/Case**：对应领域的事实、异常和 current 状态。
2. **WorkItem**：需要人处理、确认或补充的工作合同。
3. **ApprovalRequest**：对指定高风险动作与 revision 的授权流程。
4. **SystemJob**：同步、投影、导出、清理、重算等机器执行。
5. **ExternalCommand**：向 SHEIN 或其他外部系统发送的持久动作。
6. **NotificationEvent/Delivery**：提醒事件和各渠道投递尝试。

UI 可以聚合展示关联关系，但 API、数据库、权限、状态和完成语义不得合并。

### 16.5 目标拓扑

```text
Domain Fact / Case / Plan / Exception
                 │ WorkSignal
                 ▼
       Work Type Registry + Dedup
                 │
        ┌────────┴────────┐
        ▼                 ▼
    WorkItem        ApprovalRequest
        │                 │
 Assignment/SLA      Steps/Decisions
        │                 │
 Comments/Evidence  One-time ApprovalGrant
        └────────┬────────┘
                 ▼
          Domain Authorization
                 │
        Domain Plan/Command/Job
                 │
          Receipt / Readback
                 │
                 ▼
    Work Verification / Close / Reopen

All state changes → Collaboration Event → Outbox
                                      ├─ In-app Inbox
                                      ├─ Optional Digest
                                      └─ Audit/Observability
```

### 16.6 规范对象

- `WorkTypeDefinition`：类型、领域 owner、默认优先级、候选角色、SLA、完成证据、去重键、允许动作和版本。
- `WorkSignal`：来源领域、原因、subjectRef/revision、严重度、建议期限、dedupKey 和 provenance。
- `WorkItem` / `WorkItemRevision`：标题、说明、scope、subject、owner/assignee、状态、优先级、期限、blocker、完成/验证证据和 lockVersion。
- `AssignmentHistory` / `DelegationGrant`：团队队列、直接分派、转交、代理范围、起止时间、原因和操作者。
- `ApprovalPolicy` / `ApprovalRequest`：动作、subjectRevision、风险/影响快照、步骤、申请人、有效期和状态。
- `ApprovalStep` / `ApprovalDecision` / `ApprovalGrant`：顺序/并行/法定人数、资格、决定、理由、一次性授权和消费状态。
- `CommentThread` / `CommentRevision` / `Mention`：正文、作者、编辑/删除痕迹、可见范围、@成员和业务引用。
- `WorkAttachment`：私有媒体、角色、hash、来源、扫描状态、retention 和短时访问票据。
- `SlaPolicy` / `SlaClock` / `EscalationEvent`：响应/解决目标、工作日历、暂停、升级层级和事件。
- `NotificationEvent` / `NotificationDelivery` / `NotificationPreference`：事件、接收者、去重/聚合、渠道、投递结果、已读/确认和偏好。
- `OperationsCalendarEvent`：来源任务/领域、展示窗口、时区、负责人和只读/可编辑边界。
- `WorkSnapshot`：列表、计数、详情、权限、SLA 和批量资格的一致 revision。

### 16.7 身份、作用域与时间

1. 每个对象必须含 tenantId、workspaceId；店铺工作含 storeId，跨店工作含显式 storeSetId/目标清单。
2. subject 使用 `domain + objectType + objectId + subjectRevision`，不能靠标题、SKC 文本或 URL 猜关联。
3. taskId、approvalId、commentId、notificationId、systemJobId 和 commandId 各自稳定，不复用业务 ID。
4. createdAt、assignedAt、firstRespondedAt、dueAt、resolvedAt、verifiedAt、closedAt 和 reopenedAt 分开。
5. dueAt 以 UTC 保存，同时保留计算时区、BusinessCalendarVersion 和政策版本；UI 按用户时区展示。
6. 平台官方截止时间保持原时区/原值和来源，运营日历不得通过拖拽静默修改官方事实。

### 16.8 正交状态机

WorkItem 主链：

`open → assigned → in_progress → blocked → resolved → verified → closed`

补充规则：

- cancelled 为独立终态；reopen 创建事件并回到 assigned/open，不覆盖旧关闭证据。
- blocked 必须有 reasonCode、责任边界、预计恢复或依赖对象；不能用 blocked 暂停所有 SLA。
- resolved 表示执行者提交完成证据；verified 表示业务 owner/系统规则核验；closed 才是协同闭环。

ApprovalRequest：

`draft → submitted → in_review → approved/rejected/expired/cancelled/invalidated → consumed`

Assignment、NotificationDelivery、SystemJob 和 ExternalCommand 沿用各自独立状态；不得映射成 WorkItem 状态。

### 16.9 WorkSignal、创建与去重

1. 领域服务通过版本化 `WorkSignal` 声明需要人工工作；前端不能直接插入任意业务真相。
2. dedupKey 至少包含 tenant/store/workType/subject/reason/policyVersion；同一未关闭工作优先追加事件或升级，不重复轰炸。
3. 事实恢复时不静默删除任务；按 WorkType 进入 auto_resolve_candidate，验证后关闭或由人确认。
4. 复发在旧任务时间线记录并创建新 occurrence；必要时 reopen，保留首次响应和历史 SLA。
5. 人工创建任务必须选择受控 WorkType 或明确 general 类型，仍需 scope、负责人、期限和可见性。
6. bulk create 在服务端逐项做权限、重复、subjectRevision 和目标数预览，禁止隐藏目标。

### 16.10 WorkType 注册与领域适配

WorkTypeDefinition 至少定义：

- 发布预检补件、发布结果未知、审核驳回、核价决定、寄样截止。
- 合规材料缺失/过期、质量缺陷/CAPA、退货/申诉、履约临期/差异。
- 价格例外/议价、备货计划、利润/对账异常、月结检查、增长实验/活动后台任务。
- 系统故障人工处置，但不把每个普通同步 Job 自动变成人工任务。

每种类型只有一个领域 owner；类型变更产生新 version，不在 UI 中随意改完成条件。

### 16.11 分派、团队队列、转交与代理

1. 工作可先进入角色/团队队列，再由系统建议或负责人分派到成员；建议不等于授权。
2. assignee 与 accountableOwner 分离：执行人可以转交，责任 owner 对 SLA 和验收负责。
3. 转交必须记录 from/to、原因、未完成材料、期限变化和操作者，禁止静默覆盖 assignee。
4. 临时代理通过 DelegationGrant 限定工作类型、店铺、权限、起止时间；代理不能扩大原用户 capability。
5. 成员停用/离职前检查未完成任务、审批、代理和关注；产生 orphan queue，由管理员重新分配。
6. 工作量视图只用于分派，不用任务数量直接评价绩效；隐藏敏感财务/合规内容时仍可显示最小队列元数据。

### 16.12 SLA、工作日历与升级

1. response SLA 与 resolution SLA 分离；紧急程度、业务影响和官方截止共同决定目标。
2. BusinessCalendar 按租户/团队配置工作日、节假日、每日时段和时区，并版本化。
3. 官方申诉、寄样、发货或月结截止不因内部节假日自动顺延；内部 SLA 可按政策提前预警。
4. SLA pause 仅允许 waiting_external、waiting_requester、approved_exception 等受控原因，保存开始/结束和批准人。
5. EscalationEvent 可通知负责人、团队经理和管理员，或提高优先级；不能自动执行领域动作。
6. 逾期、即将到期、长期阻塞和反复 reopen 分开统计；通知失败不暂停 SLA。

### 16.13 不可变审批请求

ApprovalRequest 冻结：

- actionType、subjectRef/revision、目标店铺/商品/SKU、拟执行变化。
- 风险、数量、金额、币种、利润/损失、数据质量和关键规则 revision。
- 请求人、理由、附件、有效期、所需审批策略和影响预览 hash。

任一授权相关输入变化时，旧请求变为 invalidated，重新预检并新建 revision；不能“更新已批准申请”。

### 16.14 多步骤、并行与法定人数

1. ApprovalPolicy 支持 sequential、parallel、quorum，但首期只实现已证明需要的模板，不建设通用 BPMN。
2. 每一步定义候选角色/capability、最少人数、是否必须不同团队、超时和拒绝语义。
3. 任一 reject 默认拒绝该 revision；允许重提但必须新请求，不覆盖原决定。
4. 部分批准只能在动作合同明确支持拆分目标时使用，并产生新的批准范围与 hash。
5. 审批意见、附件和业务证据永久引用原 revision；删除成员不删除其历史署名。

### 16.15 职责分离与禁止自审

1. 高风险发布开关、低于利润底线价格、拒绝平台议价、付款/核销、申诉发送、批量外部写和权限变更采用申请人与最终审批人分离。
2. Owner/Admin 也不能在要求双人的流程中同时满足两席；紧急 break-glass 另走事件、时限、复核和通知。
3. 审批资格在提交决定时服务端重新计算，不能依赖页面加载时角色。
4. 被代理人和代理人不能被计为两个独立审批人；同一主体多个角色只算一次。
5. 利益冲突、范围越权、成员停用或 capability 失效时拒绝决定并保留审计。

### 16.16 ApprovalGrant 与领域执行交接

1. approved 只产生绑定 action/subjectRevision/scope/expiresAt 的一次性 ApprovalGrant，不直接发送平台请求。
2. 对应领域在创建 Command 时原子消费 Grant，并重新验证 capability、subjectRevision、eligibility 和业务锁。
3. Grant 已消费、过期、撤销或输入变化时 fail closed；不能由前端重放 token。
4. Command 进入 sent/result_unknown/accepted/effective 后仍按领域规则回读；ApprovalRequest 不伪装执行结果。
5. 外部动作失败不自动把审批改为 rejected；保留批准事实和失败 Command，是否重试必须新预检或新授权。

### 16.17 评论、@成员与附件证据

1. 评论属于 subject/WorkItem/Approval 的 Thread；普通编辑创建 revision，删除使用 tombstone，不物理抹去审计历史。
2. @成员只能选择对当前 scope 有访问权的人；发送通知时再次检查权限，防止借 mention 泄露跨店内容。
3. 评论不解析成业务字段、批准或命令；“同意”“已发布”文字不能改变状态。
4. 附件走板块 07 私有媒体与短时票据，保存 role/hash/scan/retention；敏感财务、身份、合规和消费者材料按字段级权限。
5. 完成证据必须结构化引用领域 Receipt、截图、文件、字段或验证结果，不能只靠自由文本“已处理”。

### 16.18 通知事件、Outbox 与投递

1. 状态变化在同一数据库事务写 `NotificationEvent/Outbox`，异步生成接收者和投递，不阻塞业务提交。
2. 首期以应用内 Inbox 为唯一强制渠道；邮件、短信、企业微信等必须在提供商、隐私、退订、成本和失败契约核准后逐一接入。
3. NotificationDelivery 保存 channel、attempt、providerRef、sent/delivered/failed/unknown 和错误分类；失败不回滚业务状态。
4. dedup/groupKey 按 subject/type/recipient/window 聚合重复变化；批量结果发摘要，不为每个 SKU 轰炸一条。
5. 安全事件、P0 事故、审批到期和高风险命令结果保留强制应用内通知，普通成员偏好不能完全关闭。
6. 通知正文只含最小必要信息，链接到服务端鉴权详情；不在邮件/推送泄露密钥、价格底线、PII 或完整附件。

### 16.19 Inbox、已读、确认、稍后与偏好

1. read 表示用户看过通知，acknowledged 表示确认知晓，二者都不等于完成 WorkItem。
2. snooze 只延后个人提醒，不修改 dueAt、SLA、任务状态或其他接收者。
3. 偏好按事件类别、渠道、摘要频率和免打扰时段配置；权限/安全强制消息不可被普通偏好绕过。
4. 未读数、列表和详情来自同一通知 snapshot；切店不丢失全局 Inbox，但每条明确店铺/范围。
5. 通知过期可归档，相关 WorkItem/Approval/业务历史继续保留。

### 16.20 “今日工作”升级为个人工作台

建议分区：

1. 我的任务：今天到期、即将到期、逾期、阻塞、等待验收。
2. 待我审批：风险、影响、剩余时间和 subjectRevision。
3. 团队待领取：用户有资格领取的队列，不跨权限展示内容。
4. 我关注的异常：发布未知、审核驳回、库存/履约、合规、质量、财务和增长 Case。
5. 今日完成与动态：保留现有 activity 聚合，但明确是活动流，不是任务真相。

页面只读本地 WorkSnapshot；不会因打开、切店、聚焦或 30 秒计时自动刷新 SHEIN。

### 16.21 团队队列与管理视图

1. 按工作类型、团队、店铺组、负责人、优先级、SLA、阻塞和风险查看队列。
2. 展示 workload、即将逾期、孤儿任务和审批瓶颈，不公开无权限的财务/合规/PII 内容。
3. 批量分派只作用当前可见 eligible；显示目标数、店铺数、期限变化和冲突，服务端逐项重验。
4. 经理可调整责任人/优先级/内部期限，但不能改官方截止、业务状态、审批决定或平台事实。
5. 跨店队列使用显式 storeSet scope；任务详情进入后保持原店铺上下文，不把当前切店器默认为目标。

### 16.22 运营日历

日历可聚合：

- 任务 dueAt、审批到期、活动窗口、测款复核、寄样/发货/申诉截止。
- 合规证书/材料过期、价格/RRP 有效期、备货/到仓计划、月结/付款和增长复盘。

规则：

1. 每个 CalendarEvent 引用来源，不复制可漂移日期。
2. 官方只读截止和系统生成事件不可通过拖拽修改；内部计划调整走来源对象 revision。
3. 月/周/日视图按用户时区展示原时区提示；跨午夜、夏令时和节假日有测试。
4. 日历订阅/导出只包含授权范围和最小信息，token 可撤销、过期并审计。

### 16.23 系统/同步任务中心分离

1. 当前“任务中心”更名为“系统任务”或“同步任务”，保留 Job 类型、进度、错误、trace、重试资格和详情。
2. SystemJob 不设置人工 assignee/完成按钮；需要人处理时由失败分类生成单独 WorkItem 并关联 jobId。
3. Job succeeded 只表示系统任务合同成功；例如发布 Command 仍需官方回读才能称平台生效。
4. Job 重试按动作合同与幂等规则；WorkItem 重新打开不能自动重试 Job/Command。
5. 个人工作台和系统任务可以互相跳转，但计数、筛选、状态和 SLA 独立。

### 16.24 周期任务与模板

1. 首期仅允许内部检查/提醒类 recurrence，如每周质量复盘、月结检查、证书复核；不自动调用 SHEIN。
2. RecurrenceDefinition 保存 scope、owner、calendar、开始/结束、去重和模板版本；每次 occurrence 生成独立 WorkItem。
3. 上一周期未关闭时按政策合并/升级或新建，不无限堆积重复任务。
4. 模板变更不回写历史 occurrence；停用模板不删除已生成工作。
5. 所有平台状态仍由用户手动刷新或核准 Webhook 更新，周期任务只提醒人执行。

### 16.25 跨店、店铺组与全局工作

1. 单店任务必须绑定 storeId；店铺组工作保存显式目标集合 revision，不随组成员变化静默扩张。
2. 全局政策/权限/安全任务可以 storeId 为空，但必须有 workspace scope 和专用 capability。
3. 一项跨店计划应拆为父协调项 + 每店子项；每店独立负责人、状态、证据和失败，不用一个布尔值压平。
4. 店铺断开/归档后历史任务可读；涉及远端动作的未完成项进入 blocked/cancel review，不自动迁移到其他店。
5. 切店不会取消或转移任务；全局 Inbox 清楚显示原店铺，进入详情后权限重验。

### 16.26 权限、可见性与敏感信息

建议 capability：

- `work.read/create/assign/transition/verify/cancel/export`。
- `approval.request/review/administer`，以及按动作域的批准 capability。
- `comment.create/edit/moderate`、`attachment.upload/download`。
- `notification.read/preference.manage`、`sla.policy.manage`、`calendar.manage`。
- `system_job.read/diagnostics/retry` 与业务任务完全分开。

每次读、搜索、未读计数、通知收件人计算、mention、导出和动作都重验 tenant/store/capability；标题和摘要本身也可能敏感，不能先查全量后由前端过滤。

### 16.27 一致快照、搜索、选择与批量

1. 计数、列表、详情、SLA、allowedActions 和批量候选来自同一 WorkSnapshotRevision。
2. selection 绑定 tenant/user/store/storeSet/tab/filter/snapshot/workType/eligibility；切店、切页签和过滤后清除或显式重算。
3. 全选默认只选当前可见 eligible；跨页必须单独确认并展示完整目标、店铺和风险。
4. 批量分派、延期、关闭和取消服务端逐项校验 lockVersion、权限、状态和完成证据，不整批一刀切。
5. 搜索索引只写授权所需字段；权限变化后及时撤销缓存/索引可见性。

### 16.28 安全、性能、可观测性与保留

1. trace 贯穿 WorkSignal/WorkItem/Approval/Grant/Domain Command/SystemJob/Receipt/Notification/Release。
2. 监控创建率、去重率、孤儿任务、SLA、阻塞、审批耗时、通知积压/失败、重开率和各 WorkType 完成证据质量。
3. SLA/notification worker 使用 DB claim/lease、有界批次、公平队列和 backoff；2 核 4GB 下不能全表扫描、每秒 tick 或每任务独立定时器。
4. WorkItem/Comment/Approval/Event 采用 append-oriented 审计；大附件在私有对象存储，列表不携带完整历史和附件元数据。
5. 敏感评论、通知、附件和导出执行 retention/hold/删除政策；审计保留 tombstone 与最小证明。
6. 诊断台能回答：任务为何产生、谁被通知、SLA 如何算、审批为何有效/失效、Grant 谁消费、领域结果为何仍未成功。

### 16.29 实施顺序

| 顺序 | 工作包 | 主要内容 | 归属步骤 |
| --- | --- | --- | --- |
| WORK-01 | 协同资产基线 | TodayWork、同步任务、局部审批/owner、活动流、页面、表、生产 owner 全图 | ERP-00、ERP-05、ERP-17 |
| WORK-02 | 边界与状态字典 | WorkItem/Approval/SystemJob/Command/Notification 正交合同、状态和完成语义 | ERP-04、ERP-06 |
| WORK-03 | 失败回归地基 | 伪完成、旧审批、自审、通知丢失、孤儿、时区、隐藏选择和跨店负向测试 | ERP-03、ERP-19 |
| WORK-04 | WorkType Registry | 领域 owner、默认角色、SLA、证据、dedupKey、动作与版本 | ERP-06、ERP-17 |
| WORK-05 | WorkSignal/WorkItem | 创建、去重、revision、状态事件、复发、完成与验证证据 | ERP-06 |
| WORK-06 | 分派与代理 | team queue、assignee/owner、转交、delegation、离岗和 orphan queue | ERP-06、ERP-17 |
| WORK-07 | SLA/BusinessCalendar | 响应/解决、时区/节假日、暂停、升级和官方截止保护 | ERP-06、ERP-17 |
| WORK-08 | Approval Policy | 不可变请求、步骤、并行/顺序/quorum、职责分离和失效 | ERP-06、ERP-17 |
| WORK-09 | ApprovalGrant | 一次性授权、领域原子消费、过期/撤销和 Command 关联 | ERP-06、ERP-08、ERP-09 |
| WORK-10 | 评论与证据 | Thread、revision、mention、私有附件、结构化完成材料和审计 | ERP-06、ERP-15 |
| WORK-11 | Notification Outbox | 事件、接收者、去重/摘要、应用内投递、失败和偏好 | ERP-06、ERP-08 |
| WORK-12 | 个人工作台 | 我的任务、待审批、队列、关注异常、今日完成和活动流 | ERP-13、ERP-17 |
| WORK-13 | 团队队列 | 工作量、SLA、孤儿、批量分派、敏感摘要和跨店父子项 | ERP-13、ERP-17 |
| WORK-14 | 运营日历 | 来源事件、官方/内部边界、时区、周月视图和安全订阅 | ERP-13、ERP-17 |
| WORK-15 | 系统任务分离 | 当前任务中心更名、Job/人工任务关联、重试边界和诊断 | ERP-13、ERP-18 |
| WORK-16 | 一致快照 API | 列表/计数/详情/SLA/权限/批量资格同 revision，服务端搜索 | ERP-11 |
| WORK-17 | 权限与安全 | capability、职责分离、敏感字段、导出、mention/通知负向测试 | ERP-17、ERP-19 |
| WORK-18 | 迁移与影子运行 | 现有 TodayWork/局部审批/业务 owner 映射、双读对账和单团队 shadow | ERP-20、ERP-21、ERP-22 |
| WORK-19 | 浏览器与故障验收 | 多用户/多店/时区、旧响应、通知失败、Worker 重启、审批消费 E2E | ERP-21、ERP-22 |
| WORK-20 | 稳定与退役 | 两个稳定 release、零旧 owner、回滚/重放/保留证明后退役临时活动聚合 | ERP-23 |

WORK-01 至 WORK-09 是统一协同与审批安全的 P0 地基；WORK-11 至 WORK-15 未完成前，不得把现有“今日工作”或同步“任务中心”包装成完整商业协同系统。

### 16.30 验收标准、已确认决策与后续讨论项

验收标准：

- WorkItem、Approval、SystemJob、ExternalCommand、Notification 和领域 Fact/Case 在 API/数据库/UI 中完全正交。
- 任何任务关闭都不能使发布、价格、审核、履约、财务或 SHEIN 结果变成伪成功。
- 每项任务可追溯来源、subjectRevision、owner/assignee、SLA、评论/材料、完成证据、验证人和复发。
- 审批冻结动作、范围、风险和影响；revision 变化立即失效；双人流程不能自审或用代理凑人数。
- ApprovalGrant 只能由对应领域服务端原子消费一次，不能由浏览器重放或越权扩大范围。
- 通知丢失、重复、延迟或 provider 失败不改变业务/任务状态；批量事件有去重和摘要。
- TodayWork 成为真实个人队列；旧活动流保留但明确为动态，系统同步任务独立展示。
- 离岗、停用、代理到期和店铺断开后无孤儿高风险任务、幽灵审批或跨店泄露。
- SLA 对时区、节假日、暂停、官方截止和升级可解释；到期不触发 SHEIN 自动动作。
- 列表、计数、选择和批量作用域一致；可见 4 项不会执行 15 项，切店不保留隐藏选择。
- 当前保持手动刷新；页面 load、切店、聚焦、30 秒和周期任务不调用 SHEIN。
- 协同 UI 渐进上线，非目标业务页面、导航、品牌和领域状态无意外变化。

已确认决策：

1. 建立统一 Collaboration/Work Management 领域，但它只做控制面，不拥有业务真相。
2. 人工任务、审批、系统 Job、外部 Command、通知和业务状态彻底分离。
3. WorkItem 完成必须有领域证据；关闭任务不等于 SHEIN 成功。
4. WorkItem 绑定不可变 subjectRevision、tenant/workspace/store 和来源。
5. assignee 与 accountable owner 分开，所有分派、转交和代理可审计。
6. response/resolution SLA 分离，使用版本化工作日历和明确暂停原因。
7. 高风险审批冻结影响快照，revision 变化失效，并强制职责分离。
8. 批准只产生一次性 ApprovalGrant，由对应领域服务端原子消费。
9. 评论、mention 和附件只提供协作/证据，不解析为批准或业务状态。
10. 应用内 Inbox 为首期强制渠道；通知通过 Outbox 异步、去重、聚合并独立失败。
11. TodayWork 升级为个人工作台；现有 activity 聚合降为动态流。
12. 当前“任务中心”明确为系统/同步任务，不再冒充人工任务中心。
13. 运营日历引用来源日期，不能拖拽修改官方截止或业务事实。
14. 周期任务只生成内部 WorkItem，不自动刷新或调用 SHEIN。
15. 本板块渐进接入 V2，不重做全站 UI，不引入通用 BPMN/低代码平台。

明确不做：

- 不创建一个万能 task/status 表替代所有领域对象。
- 不用任务完成、评论“已处理”、通知已读或审批通过证明平台执行成功。
- 不允许旧 subjectRevision 的批准执行新 payload、价格、商品版本或目标集合。
- 不因 SLA 到期、日历提醒、周期任务、页面进入或通知点击自动调用 SHEIN。
- 不把同步 Job 的成功/失败直接映射成人员绩效或业务成功/失败。
- 不让邮件、推送、URL 参数或前端按钮单独构成审批和权限凭据。
- 不建立默认跨店全选、隐藏目标、跨权限 mention 或敏感通知正文。
- 不借协同模块重做导航、首页品牌、商品审核中心或其他稳定页面。

板块 17 继续讨论：数据分析、报表中心、指标治理、管理驾驶舱、导出订阅和数据质量如何建立统一语义层，使单店、店群、商品、库存、履约、售后、财务和增长报表口径一致、可下钻、可复现且不伪造 SHEIN 未开放指标，同时避免各页面重复计算、Excel 口径漂移和大查询拖垮生产系统。

## 板块 17：数据分析、报表中心、指标治理与管理驾驶舱

关联执行步骤：ERP-03、ERP-04、ERP-05、ERP-06、ERP-07、ERP-08、ERP-10、ERP-11、ERP-13、ERP-17、ERP-18、ERP-19、ERP-20、ERP-21、ERP-22、ERP-23  
状态：封版审计补齐，尚未授权实施

### 17.1 结论：报表是可复现的事实解释层，不是第二套业务数据库

目标模型是：

`官方/内部规范事实 → 质量与覆盖率 → 版本化指标语义 → 一致分析快照 → 报表/驾驶舱 → 下钻/导出/订阅 → 决策引用`

不可退让的原则：

1. 报表、图表和 KPI 不拥有商品、发布、审核、库存、财务或增长真相，只消费板块 01～16 的规范 Fact/Snapshot。
2. 每个指标必须定义业务含义、grain、单位、公式、来源、时间窗口、cutoff、质量传播和版本；同名不同口径不得混用。
3. `known/confirmed_zero/partial/unknown/stale/conflict/unsupported/not_applicable` 是报表一等状态，unknown 不补 0，unsupported 不生成图表。
4. SHEIN 未开放曝光、点击、访客、加购、支付人数、转化率、全托管订单和消费者成交价时，不推算、不抓取冒充官方、不用销量反推。
5. 单店、店组和全租户汇总只有在经营模式、指标版本、单位、币种、时区、cutoff 和覆盖率可比时才排序或合计。
6. 管理驾驶舱使用冻结 `AnalyticsSnapshot`；同一次查看的卡片、图表、列表和下钻必须对得上。
7. 浏览器不读取全量原始表后计算 KPI；大查询、导出和历史重算走服务端有界任务，不拖垮 2 核 4GB。
8. 订阅报表只发送已落库快照，不以定时发送为由自动刷新 SHEIN；当前继续手动刷新。
9. 自定义报表只允许受控维度/指标组合，不开放任意 SQL、任意跨租户 join 或业务写回。
10. 报表渐进加入现有 V2，不借驾驶舱建设重做全站 UI，也不把漂亮图表置于数据可信度之上。

### 17.2 当前代码、数据与产品事实

已核验：

1. 当前 V2 有 `OverviewPage`、商品经营、销量库存、经营预警和 TodayWork 等局部总览，没有独立报表中心路由。
2. `OverviewPage` 与经营页面复用 `useBusinessDashboard`，这是正确的刷新 owner 收敛基础，但数据仍以单店最新经营快照和固定摘要为主。
3. 当前 `store_business_snapshots` 保存每店最新 JSONB 经营快照；页面展示商品数、销量/库存摘要和即时 warning，尚不是版本化指标仓或历史语义层。
4. today/yesterday/rolling7/rolling30 是 SHEIN 返回的聚合窗口事实，不是可恢复的真实逐日序列。
5. 当前没有统一 `MetricDefinition`、`DimensionDefinition`、`AnalyticsSnapshot`、`ReportDefinition`、`ReportRun`、`SavedView`、`ExportJob` 或 `ReportSubscription` 规范对象。
6. 商品、审核、合规、发布、价格、质量、履约、财务和增长各自会产生计数/摘要，尚无统一指标目录防止页面重复计算或中文状态二次归类。
7. 当前 API client 和 control server 已较大，不能继续把跨域报表 SQL、公式和导出逻辑堆入页面或万能控制器。
8. 当前依赖中没有必须沿用的 BI 平台；不需要为了“商业化”引入第二套路由、鉴权、数据模型或低代码报表系统。
9. 现有云端是 PostgreSQL + Redis + Node Control/Workers 的 2 核 4GB 单机部署，大范围明细扫描和浏览器全量计算风险较高。
10. 用户已明确拒绝普通页面自动同步；报表刷新必须消费已有事实或复用领域手动 RefreshOperation。

### 17.3 产品责任边界

本板块负责：

- 指标/维度语义、分析快照、报表定义、查询、下钻、保存视图、管理驾驶舱、导出、订阅和数据质量视图。
- 单店、店铺组、商品族、SKC/SKU、库存、履约、质量、财务、价格、增长和团队效率的可信分析。
- 数据血缘、口径版本、覆盖率、可比性、权限裁剪、性能预算和报表复现。

本板块不负责：

- 直接调用或修改 SHEIN 商品、价格、库存、发货、合规、财务和活动接口。
- 替代领域刷新、事件归并、财务关账、增长决定或协同任务。
- 创造 SHEIN 未开放的指标、实时竞品数据、消费者订单、广告或活动 ROI。
- 建立通用数据仓库产品、任意 SQL 控制台、外部客户 SaaS BI 或无限自定义仪表盘。
- 从报表卡片直接执行批量业务写入；需要行动时只创建受控 WorkItem/Plan 并进入对应领域。

### 17.4 六层分析语义

1. **Source Fact**：SHEIN Receipt、Webhook、人工导入和内部规范事实。
2. **Quality Envelope**：coverage、cutoff、freshness、missing/conflict 和 provenance。
3. **Semantic Metric**：版本化公式、grain、单位、窗口和质量传播。
4. **Analytics Snapshot**：指定范围和 asOf 的不可变指标/维度结果。
5. **Report/View**：字段、筛选、分组、排序、图表和权限表达。
6. **Decision Reference**：任务、审批、计划、复盘引用的报表快照，不反向改写报表历史。

### 17.5 目标拓扑

```text
Domain Facts / Source Receipts / Manual Imports
                    │
                    ▼
        Quality + Lineage Normalization
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
 Metric/Dimension Registry   Data Quality Cases
        │
        ▼
 Analytics Compute / Snapshot Builder
        │
        ├─ Report Query / Drilldown
        ├─ Management Cockpit
        ├─ Saved View
        └─ Export/Subscription Jobs
                    │
                    ▼
         WorkItem / Decision Reference
```

### 17.6 规范对象

- `MetricDefinition` / `MetricVersion`：key、名称、含义、grain、unit、formula、inputs、quality policy、owner 和版本。
- `DimensionDefinition` / `DimensionMember`：店铺、组、商品、SKC、SKU、站点、状态、时间、币种等稳定维度。
- `AnalyticsDatasetDefinition`：允许的事实、join、时间字段、partition、默认 cutoff 和访问策略。
- `AnalyticsSnapshot` / `MetricObservation`：scope、asOf、window、metricVersion、value、quality、coverage、lineage 和 hash。
- `ReportDefinition` / `ReportVersion`：指标、维度、筛选、分组、排序、可视化、权限和 owner。
- `ReportRun`：definitionVersion、snapshot、参数、结果摘要、耗时、状态、错误和 trace。
- `SavedView`：用户/团队视图、筛选、列、排序和可见范围，不复制事实。
- `DashboardDefinition` / `DashboardSnapshot`：卡片/图表布局、共享 filter context 和一致 snapshot。
- `DrilldownContract`：从指标到允许的明细 grain、过滤继承和总计对账。
- `ExportJob` / `ExportArtifact`：字段、scope、快照、格式、行数/字节、hash、过期和下载审计。
- `ReportSubscription` / `DeliveryRun`：报表版本、参数、频率、接收人、快照策略和投递结果。
- `DataQualityRule` / `DataQualityIssue`：缺失、过期、重复、冲突、不可比、修复责任和状态。

### 17.7 身份、粒度与时间

1. 规范分析身份为 tenant/workspace/store/storeSet/businessMode/site/product/productVersion/SKC/SKU/warehouse/currency/timeBucket。
2. grain 是指标合同的一部分；SKU 销量不能与 SKC 库存、店铺利润或月度任务数在无聚合规则时直接 join。
3. eventTime、businessDate、sourceCutoff、snapshotAsOf、computedAt、closedPeriod 和 displayedTimeZone 分开。
4. rolling7/rolling30 保存窗口开始/结束和来源，不标记成 daily；真实日事实另建数据集。
5. 财务按原币种和会计期间；库存按时点；销量按窗口/业务日；审核与发布按事件/Attempt。
6. current dashboard pointer 显式指向 DashboardSnapshot，不以页面打开时各自查询的最新值拼接。

### 17.8 指标值与质量状态

每个 MetricObservation 至少包含：

- `value` 或空值、unit、grain、metricVersion。
- expected/returned target、coverageRatio、sourceCutoff、freshness。
- quality：known/confirmed_zero/partial/unknown/stale/conflict/unsupported/not_applicable。
- sourceReceipt/inputSnapshot、formulaHash、computedAt 和 lineageId。

`confirmed_zero` 只有在来源完整覆盖且明确返回 0 时成立；partial 可以展示已知小计但不能参与完整排名、利润率或目标达成率。

### 17.9 来源与血缘

1. 所有指标从板块 03～16 的规范表、Snapshot/Fact/Receipt 读取，不直接请求 SHEIN。
2. lineage 记录 source table/object、source revision、normalizer/metric version、filter、join、aggregation 和 exclusion。
3. 人工/Excel 数据保存 uploader、batch、文件 hash、列映射、业务期间、校验和 supersedes，不冒充官方来源。
4. 报表可下钻“这个数用了哪些输入、排除了哪些对象、为何是 partial/stale”。
5. late-arriving 数据创建新 Snapshot/ReportRun；已引用或已发送报表不静默改写。

### 17.10 指标注册与治理

MetricDefinition 必须定义：

- 唯一 key、中文名、英文名、业务说明、owner 和使用场景。
- base/derived 类型、grain、unit、precision、aggregation、time semantics。
- 允许维度、过滤、分母、零值、unknown、partial 和 stale 传播。
- input contract、formula、metricVersion、effectiveFrom/To 和兼容策略。
- 数据质量门、是否允许排名/目标/同比和不可使用场景。

指标变更必须新版本并提供影响分析；不能只改卡片文案或 SQL 让历史数字含义变化。

### 17.11 维度注册与层级

1. 店铺、店铺组、标签、负责人、经营模式、站点使用稳定 ID；显示名变化不改变历史归属。
2. ProductFamily/Product/SKC/SKU/尺寸形成显式层级，不能以标题、图片或 supplierSku 模糊归组。
3. 类目使用 SHEIN category ID + rule snapshot；类目名称更新保留历史标签。
4. 时间支持业务日/周/月/季度、自然与财务期间，不混用滚动窗口。
5. 币种、重量、长度、面积、体积和数量单位标准化并保留原值/换算版本。
6. 层级变更使用 effective-dated member；历史报表可选择“按当时归属”或“按当前组织重述”，默认不静默重述。

### 17.12 一致分析快照

1. AnalyticsSnapshot 冻结 storeSet、filters、metric/dimension versions、source cutoffs 和 quality policy。
2. 同一 DashboardSnapshot 下所有卡片、图表、排名和下钻共享 snapshotId。
3. source cutoff skew 超阈值时标不可比或拆开显示，不把不同更新时间的数据硬拼成同一“当前”。
4. 部分来源失败保留 last-known-good 并清楚标 stale/partial；不能回退后仍显示“刚更新”。
5. 重算生成新 revision/current pointer，旧快照继续支持审计、导出和决策复现。

### 17.13 数据质量体系

质量规则至少覆盖：

- expected/returned/missing target、分页完整性、重复、乱序和字段缺失。
- SKU/商品/店铺/币种/期间身份冲突和 orphan。
- source freshness、cutoff skew、窗口重叠/缺口和 LKG 年龄。
- 数量守恒、金额平衡、状态合法迁移、下钻总计和维度孤儿。
- 人工导入 schema、类型、公式/CSV 注入、重复批次和篡改。

DataQualityIssue 与业务 AlertCase 分离；数据问题修复不自动关闭缺货、亏损或质量风险。

### 17.14 指标计算与存储策略

1. 高频基础指标优先结构化事实 + SQL/物化聚合；复杂快照用有界 Worker，不在 React render 中计算。
2. decimal 用于金额/汇率；时间、数量和单位转换遵循确定性函数与版本。
3. 计算必须幂等、可重放、分页稳定和有资源预算；同 scope/version/asOf 可复用结果。
4. 首期不建设重型独立数仓；PostgreSQL 采用事实表、汇总表、索引、分区/retention 和后台任务满足当前规模。
5. 达到经测量的容量阈值后再评估只读副本、列式分析库或 CDC，不提前增加双写真相。

### 17.15 报表定义与版本

ReportDefinition 保存：

- 数据集、指标、维度、filter schema、默认窗口、排序和 top/bottom 规则。
- 表格/图表表达、总计/小计、质量展示、下钻合同和空状态。
- owner、共享范围、capability、PII/财务级别、有效期和版本。

官方报表只由管理员/领域 owner 发布版本；用户 SavedView 只能调整允许的筛选、列和排序，不能改指标公式。

### 17.16 下钻、对账与解释

1. 每个 KPI 定义允许下钻链，例如店组→店铺→SKC→SKU→来源 Receipt。
2. 下钻继承 snapshotId、时间、范围、质量和过滤；不能跳到“当前最新”导致总计不同。
3. 列表总计由服务端同口径返回，不由当前页相加。
4. explain 面板显示公式、窗口、单位、coverage、cutoff、版本、输入缺口和不适用说明。
5. 需要运营动作时创建引用 snapshotId/observationId 的 WorkItem，不从报表直接批量写 SHEIN。

### 17.17 角色化报表中心

建议分区：

1. 我的报表：最近使用、收藏、SavedView 和待下载导出。
2. 经营：商品、销量、库存、在途、可售天数和备货证据。
3. 发布与审核：草稿、批次、Attempt、平台回读、驳回和处理时长。
4. 合规与质量：要求覆盖、材料、缺陷、退货、处罚、申诉和 CAPA。
5. 履约：采购、计划、发货、包裹、到仓、数量差异和 SLA。
6. 财务与价格：结算、成本、利润、应收应付、现金、议价和价格底线。
7. 增长：机会、实验、生命周期、活动计划和复盘。
8. 团队：任务、审批、SLA 和工作分布；不把任务数简单等同绩效。

### 17.18 管理驾驶舱

管理驾驶舱只保留需要跨域判断的少数指标：

- 数据新鲜度/覆盖率和异常店铺。
- 商品组合、审核/合规风险、销量库存、履约、质量/售后和利润健康。
- 即将到期的高风险任务/审批、重大 result_unknown 和平台能力异常。
- 增长组合与资源占用，但不展示伪曝光/转化/ROI。

每张卡片必须可解释、可下钻、有 owner、有阈值版本；红色只用于明确需行动的风险，不把 unknown 染成安全绿色。

### 17.19 多店群比较与排名

1. storeSet 使用显式 revision；店铺加入/移出不改历史报表目标。
2. 仅比较同 businessMode、metricVersion、currency/FX policy、window 和可接受 cutoff skew 的店铺。
3. 排名显示 included/expected stores、unknown/stale/partial 数和最旧/最新 cutoff。
4. 不完整店铺默认进入“数据不足”而非榜尾；confirmed zero 才可参与零值排序。
5. 商品族跨店分析只聚合可比事实，不复制生命周期、价格、利润、实验或活动状态。

### 17.20 财务、利润与多币种分析

1. 利润报表只消费板块 13 的 ProfitSnapshot，不由页面以供货价减成本临时计算。
2. 原币种始终保留；汇总引用 FX source/time/policy/version，缺汇率不跨币种合计。
3. settled/accrual/estimated、direct/allocated、official/manual 分层，coverage 不合格不显示完整利润率。
4. 关账期间报表冻结；晚到数据进入调整/重开流程，不静默重写已发送月报。
5. 工厂成本、利润、银行、发票和供应商维度按字段级 capability 裁剪。

### 17.21 经营、履约、质量与合规报表

1. 销量/库存按 SKU、尺寸、仓库和真实窗口；unknown 库存不算 0，不用 SKC 平均掩盖大尺寸地毯风险。
2. 备货建议展示 lead time、MOQ、包装倍数、在途、policy 和置信度，不只展示最终数量。
3. 履约数量按 need/order/plan/delivery/receipt/storage/defective 对账，打印不算发货，到仓不算入库。
4. 质量按缺陷 taxonomy version、严重度、商品/尺寸/供应商/批次和复发；责任未定不自动归供应商。
5. 合规按官方要求、材料覆盖、状态、失效和证据；unsupported 上传能力不显示 0 或“无需处理”。

### 17.22 增长分析与不可观测指标

1. 生命周期、分层、实验和活动计划读取板块 15 的冻结 Snapshot/Decision，不按报表阈值自动改阶段。
2. SKU 销量窗口、利润、库存、履约、质量和合规可用于可解释增长评估。
3. 曝光、点击、访客、加购、支付人数、CTR、转化率和消费者活动价在无官方合同/人工证据时为 unsupported/unknown。
4. 人工后台截图/导入与官方 API 指标分层，并显示来源、采集人、时间和有效期。
5. 无可靠对照时不声称标题、主图、价格或活动“提升了转化”；结果可为 inconclusive/data_invalid。

### 17.23 异步导出与文件安全

1. ExportJob 绑定 reportVersion、snapshotId、scope、columns、filters、requestedBy 和 lockVersion。
2. 大导出后台分页/流式生成 CSV/XLSX，设置行数、字节、并发、超时和保留期限。
3. 导出文件存私有对象、短时一次性/可撤销票据、hash、水印和下载审计；不经 URL 暴露长期凭证。
4. CSV 防公式注入，XLSX 类型/精度/时区明确；金额使用文本/decimal 安全表达。
5. 导出包含口径、metricVersion、snapshotId、cutoff、coverage、quality 和生成时间，不只输出裸数字。

### 17.24 报表订阅与定期发送

1. Subscription 绑定固定 ReportVersion/SavedView、scope、接收人、频率、时区和允许渠道。
2. DeliveryRun 使用最近满足 freshness policy 的已落库 Snapshot；不因定时发送自动请求 SHEIN。
3. 数据过期/partial 时发送明确质量警告或跳过，不发送伪“最新完整报表”。
4. 接收人在每次发送前重验权限；成员停用、店铺权限撤销或敏感级别变化立即停止。
5. 首期应用内通知/下载为主；邮件附件需独立隐私、大小、加密和 provider 合同。

### 17.25 受控自定义分析

1. 用户只能从允许的数据集、指标、维度、操作符和时间窗口组合 SavedView/CustomReport Draft。
2. 服务端编译查询并做 tenant/store/capability、join path、cost、row/byte 和时间窗口限制。
3. 不接受原始 SQL、JavaScript 公式、任意 URL 数据源或跨租户标识。
4. 自定义公式首期只支持经批准的安全表达式；成为正式 KPI 前必须进入 MetricDefinition 治理。
5. 超预算查询拒绝或转后台，不允许浏览器无限刷新。

### 17.26 权限、共享与敏感指标

建议 capability：

- `analytics.read`、`analytics.drilldown`、`analytics.saved_view.manage`。
- `report.manage/publish/share/export/subscribe`。
- `metric.read/manage`、`quality.read/manage`、`analytics.diagnostics`。
- 财务、成本、利润、PII、供应商、权限/安全指标另设字段/数据集 capability。

共享对象保存 tenant/store/storeSet/team/user scope；未读计数、搜索、图表数据、下钻、导出和订阅接收者均由服务端裁剪，不能先查全量后前端隐藏。

### 17.27 缓存、刷新与失效

1. 报表读缓存按 tenant/user/capability/storeSet/reportVersion/snapshot/filter 隔离。
2. 页面进入、切店、聚焦和 30 秒计时不调用 SHEIN；“刷新报表”只重算已落库事实。
3. 需要更新源数据时明确跳转/创建对应领域手动 RefreshOperation，报表显示其进度但不自建第二 owner。
4. 领域事实提交后标相关 dataset dirty；后台有界构建新 Snapshot，不让 Webhook fan-out 触发全租户重算。
5. 当前活动 ReportRun 可有界轮询/SSE；终态后停止，断线可用 snapshotId 恢复。

### 17.28 性能、可观测性、保留与恢复

1. trace 贯穿 SourceReceipt/MetricVersion/AnalyticsSnapshot/ReportRun/ExportJob/DeliveryRun/WorkItem/Release。
2. 监控报表 p50/p95/p99、扫描行/字节、缓存命中、快照延迟、质量问题、导出积压/失败、订阅失败和慢查询。
3. 对 10/50/100 店、1k/10k SKU、数十万财务/履约行、多币种、月报和大导出建立 2 核 4GB 预算。
4. 数据库使用服务端分页、稳定游标、索引、statement timeout、并发上限和只读事务；拒绝 N+1 与无界 join。
5. 快照、报表定义、决策引用和审计按政策保留；可重建缓存/临时 Artifact 可清理，不删除已引用证据。
6. 演练 DB/Redis/Worker 重启、导出中断、投递失败、旧 Snapshot 回退和 late data 重算，证明不伪造新鲜度或修改历史。

### 17.29 实施顺序

| 顺序 | 工作包 | 主要内容 | 归属步骤 |
| --- | --- | --- | --- |
| BI-01 | 分析资产基线 | 页面 KPI、SQL/JSONB、Excel、导出、阈值、owner、生产使用和口径冲突全图 | ERP-00、ERP-05、ERP-17 |
| BI-02 | 官方指标边界 | SHEIN 可用/unsupported 指标、窗口、限制、fixture 和来源优先级 | ERP-07、ERP-17 |
| BI-03 | 失败回归地基 | unknown 补零、口径漂移、跨店不可比、下钻不对账、隐藏导出和大查询测试 | ERP-03、ERP-19 |
| BI-04 | Metric Registry | grain/unit/formula/window/quality/owner/version 和变更治理 | ERP-04、ERP-06 |
| BI-05 | Dimension Registry | 店铺/商品/SKU/类目/时间/币种/单位层级和 effective history | ERP-04、ERP-06 |
| BI-06 | Quality/Lineage | coverage/cutoff/freshness/conflict、来源、公式和 DataQualityIssue | ERP-06、ERP-10 |
| BI-07 | Analytics Snapshot | scope/asOf/version/input/hash/current pointer 和不可变重算 | ERP-06、ERP-11 |
| BI-08 | Compute Engine | SQL/汇总/Worker、decimal、幂等、分页、预算和复用 | ERP-06、ERP-08、ERP-19 |
| BI-09 | Report Definition | 数据集、指标、维度、筛选、图表、权限、版本和 SavedView | ERP-06、ERP-17 |
| BI-10 | Drilldown/Explain | snapshot 继承、总计对账、公式/缺口解释和来源追踪 | ERP-11、ERP-13 |
| BI-11 | 经营/履约报表 | 商品、销量、库存、备货、采购、发货、到仓和数量对账 | ERP-13、ERP-17 |
| BI-12 | 质量/合规/售后报表 | 要求覆盖、缺陷、退货、处罚、申诉、证据和 CAPA | ERP-13、ERP-17 |
| BI-13 | 财务/价格报表 | 结算、成本、利润、FX、AR/AP、现金、议价和底线质量 | ERP-13、ERP-17 |
| BI-14 | 增长/团队报表 | 生命周期、实验、活动、复盘、任务、审批和 SLA，禁止伪流量 | ERP-13、ERP-17 |
| BI-15 | 管理驾驶舱 | 少量跨域 KPI、风险、质量、可下钻和角色化视图 | ERP-13、ERP-17 |
| BI-16 | Export/Artifact | 后台流式 CSV/XLSX、预算、私有对象、票据、hash 和审计 | ERP-08、ERP-15、ERP-17 |
| BI-17 | Subscription | 固定版本、权限重验、已有快照、质量警告和投递结果 | ERP-08、ERP-17 |
| BI-18 | 权限/安全/诊断 | dataset/field capability、自定义查询限制、慢查询和 trace | ERP-17、ERP-18、ERP-19 |
| BI-19 | 影子对账与验收 | 页面/Excel 旧口径对照、单店/店组、多时区/币种和浏览器 E2E | ERP-20、ERP-21、ERP-22 |
| BI-20 | 稳定与退役 | 两个稳定 release、零页面临时公式、回放/回滚后退役旧 KPI owner | ERP-23 |

BI-01 至 BI-08 是可信指标与快照的 P0 地基；BI-09 至 BI-15 未完成前，不得把当前总览扩展成“管理驾驶舱”或输出跨店利润/增长排名。

### 17.30 验收标准、已确认决策与封版结论

验收标准：

- 所有核心 KPI 在 Metric Registry 中有唯一 key、grain、unit、formula、window、quality 和 version。
- 同一次驾驶舱的卡片、图表、列表、总计和下钻共享 snapshotId 并完全对账。
- unknown/partial/stale/conflict/unsupported 不补 0、不参与完整率/排名，不显示伪绿色。
- SHEIN 未开放曝光/点击/转化/全托管订单时，所有页面、导出和订阅都不生成这些官方指标。
- 单店/店组比较展示经营模式、版本、币种、coverage、cutoff skew 和不可比原因。
- today/7/30 日窗口不生成伪逐日曲线；财务/库存/事件各按正确时间语义。
- 报表可解释每个数字的来源、公式、排除项、数据缺口和版本；历史报告可复现。
- 大报表、重算和导出在 2 核 4GB 预算内有界执行，浏览器不下载全量事实计算。
- 导出/订阅按服务端权限、私有 Artifact 和短时票据运行；权限撤销后不能继续访问或发送。
- 页面 load、切店、聚焦、30 秒和报表订阅不调用 SHEIN；源数据只由明确手动刷新或核准 Webhook 更新。
- 报表只能创建受控 WorkItem/Decision 引用，不能直接批量修改商品、价格、库存或平台状态。
- 渐进 UI 上线，非目标页面、现有品牌和稳定业务流程视觉/行为不变。

已确认决策：

1. 建立独立 Analytics/Reporting 语义层，但不建立第二套业务真相。
2. 指标和维度版本化；页面不得私自定义同名 KPI。
3. AnalyticsSnapshot 冻结 scope、asOf、版本、cutoff、quality 和 lineage。
4. unknown/partial/stale/conflict/unsupported 是一等状态，不补零、不伪完整。
5. 聚合窗口、真实日事实、库存时点、财务期间和事件时间严格分开。
6. 同一 DashboardSnapshot 保证卡片、列表、下钻和导出一致。
7. 当前规模先用 PostgreSQL 结构化事实/汇总/有界 Worker，不提前引入重型数仓。
8. 多店比较必须经过经营模式、版本、单位、币种、窗口和 cutoff 可比性门。
9. 财务利润只消费板块 13 的 ProfitSnapshot，增长只消费板块 15 的正式决定。
10. 报表中心按经营、发布审核、合规质量、履约、财务价格、增长和团队组织。
11. 自定义分析使用白名单语义编译，不开放原始 SQL 或任意公式。
12. 导出异步、私有、短时、带口径/质量/审计；不由前端拼 CSV。
13. 订阅发送已有快照，不自动刷新 SHEIN；数据过期时明确警告或跳过。
14. 报表动作只创建 WorkItem/Plan，不直接拥有外部写接口。
15. 报表/驾驶舱渐进加入 V2，不重做全站 UI。

明确不做：

- 不伪造曝光、访客、点击、加购、支付、转化、全托管订单、消费者售价或活动 ROI。
- 不把 rolling7/rolling30 拆成伪日数据，不对无对照变化声称因果。
- 不允许页面、Excel 或导出各自维护一套公式和状态映射。
- 不把 partial/unknown 店铺排在榜尾或算进完整平均值。
- 不开放任意 SQL、跨租户数据源、浏览器全量聚合或报表直接写 SHEIN。
- 不因报表订阅、页面进入、切店、聚焦或 30 秒定时器触发 SHEIN 刷新。
- 不为追求大屏效果引入第二套前端/鉴权/权限/数据模型。

封版结论：板块 01～17 已覆盖当前内部 SHEIN 全托管地毯店群 ERP 的完整业务产品架构；源码基线、CI/发布、可观测性、安全、性能、备份恢复、历史迁移、Staging、生产金丝雀和遗留退役由 ERP-00～23 的横向工程步骤覆盖。后续不再继续无边界增加板块，新增业务只能先通过范围变更 ADR，再进入正式 ERP Run。
