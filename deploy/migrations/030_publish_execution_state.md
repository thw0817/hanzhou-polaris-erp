# 030 发布执行状态迁移

日期：2026-08-06

第 030 号迁移把一次性执行协议从 `publish_batches.preflight` 的 JSONB 快照拆出数据库事实源，
但仍不启用真实 SHEIN 发布。

## 新增对象

- `publish_execution_runs`：一次批次级授权协议的生命周期、指纹、失效时间和消费状态。
- `publish_jobs`：每个冻结远程请求一行，保存请求摘要、平台标识、领取租约、结果和回读摘要。
- `publish_receipts`：发布回执、Webhook 通知、商品文档状态查询、关系回读和 SKC 合规复验的追加记录。

`publish_jobs.request_summary` 只能保存脱敏摘要、数量、编码和指纹；不得保存完整发布报文、图片 URL、店铺
密钥或签名。三个表均保留 `tenant_id` 与 `store_id` 作为运行时范围条件。

## 预检

在维护窗口、备份和停止长期写入服务后执行：

```bash
psql "$SHEIN_MIGRATION_DATABASE_URL" \
  -f deploy/migrations/030_publish_execution_state_preflight.sql
```

预检必须确认第 030 号迁移未记录且三个目标表不存在。预检失败时停止，不执行迁移。

## 执行与验证

迁移由项目现有 migration service 执行：

```bash
npm run db:migrate
psql "$SHEIN_MIGRATION_DATABASE_URL" \
  -f deploy/migrations/030_publish_execution_state_verify.sql
```

验证必须确认三个表、领取租约字段、发布关闭约束和三个关键索引存在。随后运行
`npm run db:audit:v2-readiness`，再运行完整 runtime role 审计。

## 原子领取规则

仓储的领取语句必须保持以下边界：

- 只领取当前租户、店铺和执行 run 下的 `authorized` 或 `failed_retryable`。
- 使用 `FOR UPDATE SKIP LOCKED`，同一请求只能由一个 worker 获得领取记录。
- 执行 run 必须为 `running`，未过期，且数据库约束仍固定 `execution_enabled=false`、
  `authorizes_publishing=false`。
- 领取租约为 120 秒；租约过期后只转 `result_unknown`，不能自动重新领取。
- `result_unknown` 只能由 Webhook 或商品文档状态查询关联回执后恢复。

## 回滚

默认不回滚数据库，只回滚应用版本并保留空表和迁移记录。只有三个新增表均为空时，且经过独立审批，才允许
执行 `030_publish_execution_state_rollback_empty.sql`。该回滚会删除迁移记录，不得用于包含任何生产执行或
回执历史的数据库。
