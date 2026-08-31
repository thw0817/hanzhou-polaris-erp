# ERP-06 生产重新准入审计（2026-08-31）

Run：`RUN-20260831-ERP06-READMISSION-AUDIT-23`

结论：`BLOCKED / NO-GO`

范围：云端只读元数据核验，以及完全隔离的本机 PostgreSQL 演练。

## 审计边界

本 Run 没有执行生产数据库 migration、`GRANT`/角色修改、服务重启、release 切换、配置开关变更、Redis/COS 写入、真实 SHEIN HTTP 或商品发布。云端数据库查询使用 migration 连接的 `BEGIN READ ONLY` 事务，输出仅限迁移文件名和表名。

## 云端事实

- `deploy-control-1` 为 healthy；现有长期容器不包含 `product-publish-worker` 或 `outbox-dispatcher`。
- `schema_migrations` 中 ERP-06 相关项只有 `046_publish_outbox_events.sql`；`047_erp06_model_foundation.sql` 和 `048_erp06_publish_result_persistence.sql` 均未出现。
- 目标表集合中只存在旧 `publish_outbox_events`；`product_versions`、`publish_attempts`、`publish_commands`、`product_publish_outbox`、`product_publish_receipts`、`official_event_inbox`、`product_events` 均不存在。
- 当前 Control 环境中 `SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED`、`SHEIN_OUTBOX_DISPATCHER_ENABLED`、`SHEIN_WEBHOOK_INGRESS_ENABLED`、`SHEIN_COMPLIANCE_WRITES_ENABLED` 都为 `false`。
- 当前活动迁移目录不包含 047/048。因此没有任何证据支持“ERP-06 已上线”或“可以开始真实发品”。

## 隔离数据库演练

每项演练均在新的本机 `postgres:16-alpine` 容器中执行，数据库名含 `rehearsal`，连接地址限定为 `127.0.0.1`，并要求对应的精确确认值。容器在结束时自动停止删除，未触碰现有 staging 容器。

| 演练 | 结果 | 覆盖范围 |
| --- | --- | --- |
| `db:rehearse:erp06-foundation` | PASS | 001–046、047、preflight/verify、失败保护、空库 rollback、重新应用 |
| `db:rehearse:erp06-version` | PASS | ProductVersion 冻结、幂等、stale lock、跨店隔离、verified media 边界 |
| `db:rehearse:erp06-handoff` | PASS | PublishAttempt/Command/Outbox 原子交接、dry-run Worker、`result_unknown` 禁止重发 |
| `db:rehearse:erp06-results` | PASS | 001–046+047+048、048 preflight/verify、空时间戳 rollback、迁移记录复位后的重新应用 |

首次 handoff 演练揭示固定的历史调度时钟会早于真实 Outbox 的创建时间。已将演练改为从交接完成时刻导出的递增时间线，并增加窄回归；此修正只影响本机演练，不改变生产发布 Dispatcher。

## 代码验证

- `npm test`：`1408/1408` 通过。
- `npm run build:v2`：通过。
- `npm run release:audit:v2`：`READY`，且显示 `executionEnabled=false`、`authorizesPublishing=false`。
- `git diff --check`：通过。

## 仍未满足的生产门

1. 正式生产变更记录必须指定变更 owner、维护窗口与停止条件，并完成负责人的批准。
2. 需在生产等价预发环境验证 047/048 的实际锁影响、备份点、恢复步骤和回滚记录；不可在正式库首次尝试。
3. 迁移连接与未来 runtime 连接都需要针对新增表/序列/触发器的最小权限验收；当前运行时 `51` 项审计只能证明现有 schema 边界。
4. 预发候选必须保持所有真实 SHEIN 写入关闭，完成 schema、Control/Worker 版本一致性、观察与回滚演练后，才能重新讨论生产金丝雀。
5. 在这些门全部有可核验记录前，不得迁移 047/048、启动 ERP-06 发布链路、打开开关或开始 ERP-08。
