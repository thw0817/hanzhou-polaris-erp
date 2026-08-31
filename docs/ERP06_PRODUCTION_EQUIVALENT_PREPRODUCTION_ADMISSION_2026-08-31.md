# ERP-06 生产等价预发准入包（2026-08-31）

Run：`RUN-20260831-ERP06-PREPRODUCTION-PACKET-24`

状态：`PREPARATION COMPLETE / EXECUTION NOT AUTHORIZED`

本文件把 ERP-06 的生产等价预发准入条件固化为可核验的记录模板。它不是迁移命令、授权脚本或生产变更批准；不能据此修改现有 staging、生产数据库、角色、共享配置、服务或任何 SHEIN 业务数据。

## 1. 当前事实与边界

- 云端正式 schema 只到 `046_publish_outbox_events.sql`；`047_erp06_model_foundation.sql`、`048_erp06_publish_result_persistence.sql` 和对应 ERP-06 新表均未部署。
- 当前长期服务没有 `product-publish-worker` 或 `outbox-dispatcher`；发布执行、dispatcher、Webhook ingress、合规写入开关都为 `false`。
- 已有 `deploy/docker-compose.staging.yml` 只运行 PostgreSQL、Redis 和 MinIO；它没有候选 Control/Worker，也没有本 Run 所需的已批准备份还原点。因此不得把它当作可直接写入的 ERP-06 预发环境。
- 四项一次性本机容器演练均已通过，但只证明隔离代码路径可演练；不能替代生产等价预发、维护窗口或上线批准。

## 2. 不可跳过的前置记录

在创建任何预发环境、复制数据、运行 migration、授予权限或启动候选服务前，受控变更系统必须已有以下非敏感记录：

| 项目 | 必填内容 | 当前状态 |
| --- | --- | --- |
| 变更单 | 变更 owner、复核人、目标环境逻辑名称、维护窗口、停止条件 | 未提供 |
| 候选基线 | 提交 SHA、制品 SHA-256、Node/npm 版本、`047/048` 文件及专属 preflight/verify/rollback 文件 SHA-256 | 未提供 |
| 数据恢复 | 合法备份点标识、恢复演练负责人、恢复验证结果、恢复耗时上限 | 未提供 |
| 回退责任 | 应用回退负责人、数据库回退决策人、明确“不删除已有审计/迁移记录”的策略 | 未提供 |
| 权限验收 | migration owner 与 runtime role 的逻辑标识、最小权限审计结果与失败修正记录 | 未提供 |
| 发布关闭证明 | 四个业务写开关均为 `false`，且 Worker/Dispatcher/Webhook 未启动 | 未提供 |

任何一项缺失即为 `NO-GO`。不得用聊天授权、历史截图、容器健康状态或静态 `release:audit:v2` 通过替代这些记录。

## 3. 候选 release 准备门

1. 在**未激活、隔离的候选目录**构建 release；不得覆盖正式 `current`，不得修改现有 staging 卷。
2. 候选必须先经完整测试、V2 构建、密钥扫描、`git diff --check` 和静态 release audit 验证；静态审计 `READY` 仅允许进入评审。
3. `047/048` 必须先以经过代码评审的版本化 migration、专属只读 preflight/verify SQL、空数据或前向兼容 rollback 说明进入候选的**活动** migration 目录；禁止从草案目录、聊天文本或手工复制 SQL 执行。
4. 当前正式 release 的活动迁移目录没有 `047/048`，故本门目前不能通过，也不得试图在数据库中手工补登记。

## 4. 生产等价预发数据库门

目标只能是新建的隔离环境，或从获准备份恢复出来的隔离副本；不得连接或写入当前正式库和既有 staging。

1. 记录恢复前空环境标识、备份点标识和恢复后的基础核验；不记录连接串、地址、密码、ACL 或业务行。
2. 在停止所有长期写入服务后，先以 migration owner 运行 047 的只读 preflight，再运行 migration 与 verify；每步都记录退出状态、对象计数摘要和耗时。
3. 使用同样顺序完成 048。任何锁等待超出变更单阈值、对象定义漂移、校验和不符或 verify 失败，立刻停止，不继续下一项。
4. 回滚演练优先回退候选应用并保留前向兼容 schema。只有专属 rollback 文档明确允许、目标满足空数据条件且变更单明确批准时，才可做受保护数据库 rollback；禁止 `CASCADE`、删除审计记录或删除 `schema_migrations` 历史来制造“通过”。
5. 记录从备份恢复到可读核验的实际耗时，并确认回退不会要求将 runtime 连接改用 migration owner。

## 5. 最小权限与候选服务门

1. migration owner 仅提供给一次性迁移服务；runtime role 仅提供给候选 Control 与未来长期 Worker。两者不得混用。
2. 在候选 schema 存在后，更新并评审静态能力矩阵，使其覆盖 ERP-06 新表、所需序列和触发器；不能用现有 51 项审计结果证明未来对象已获授权。
3. 以 runtime role 运行只读角色边界与能力覆盖审计。缺表、缺序列、过大权限、写 `schema_migrations` 权限或任一 `passed != true` 都是 `NO-GO`。
4. 候选 Control/Worker 必须来自同一候选 SHA。仅允许启动 Control 做隔离健康与只读界面验收；`product-publish-worker`、`outbox-dispatcher`、Webhook ingress 与任何真实 SHEIN 写调用都不得启动。
5. 以下开关在候选的整个观察窗口必须是 `false`：
   - `SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED`
   - `SHEIN_OUTBOX_DISPATCHER_ENABLED`
   - `SHEIN_WEBHOOK_INGRESS_ENABLED`
   - `SHEIN_COMPLIANCE_WRITES_ENABLED`

## 6. 观察、回滚与准入结论

候选环境至少应完成 `/health`、`/ready`、登录、店铺范围、草稿、合规工作区和发布中心的**只读**验收；结果只能证明候选服务可用，不能证明可发品。观察期间记录容器状态、错误计数摘要、候选 SHA 和回滚演练结果，但不记录凭证或原始业务载荷。

出现任何 schema/权限审计失败、服务不健康、跨版本、开关非 false、意外 Worker 启动、SHEIN 网络调用、备份恢复失败或回滚无法验证时，结论必须为 `NO-GO`，并保持正式 `current`、正式数据库和正式开关不变。

只有第 2～5 节的每项都由责任人签字、预发观察完成、回滚可复核，才可以召开**单独**的生产金丝雀评审。该评审仍不自动批准 047/048 生产迁移、发布链路、任何写开关或 ERP-08；它们各自需要新的受控变更记录。

## 7. 需要归档的无敏感证据

- 变更单编号与 GO/NO-GO 决议；
- 候选 SHA、制品 SHA-256、迁移及验证文件 SHA-256；
- 备份/恢复演练标识和耗时摘要；
- migration preflight/verify 与 runtime 审计的通过数量或静态失败检查名；
- 候选 Control 与依赖健康摘要、关闭开关确认、观察起止时间；
- 回退演练结论与负责人。

填妥的记录必须进入受控变更系统，不得回填进仓库、聊天、截图或 `.env`。
