# 034 商品发布执行门禁迁移

日期：2026-08-22

第 034 号迁移只修正第 030 号迁移中“数据库永远禁止真实执行”的占位约束，不会自动开启发布，也不会修改历史业务数据。

迁移后只有满足以下全部条件的执行批次才能把两个数据库执行标志置为 `true`：

- 状态由未消费的 `issued` 原子转换为 `running`；
- 一次性授权未过期，授权 ID、授权指纹和执行计划指纹全部一致；
- 应用层商品发布开关已显式开启；
- worker 领取到当前租户、店铺和批次的冻结请求。

Worker 完成一轮领取后，如没有待领取或明确可重试任务，两个标志必须立即恢复为 `false`，不能在平台回读和合规复验期间长期保留。迁移新增两个约束，保证标志始终一致，且只有 `running` 状态可以为真；`running` 状态允许在等待回读时保持两个标志均为 `false`。

执行前先运行 `034_publish_execution_enablement_preflight.sql`。它必须确认第 034 号迁移尚未执行、第 030 号旧约束存在，并且没有历史活动执行记录。随后运行 `npm run db:migrate` 和 `034_publish_execution_enablement_verify.sql`。

本迁移本身不授予 runtime role 新权限；部署发布 worker 前，必须重新生成并审核 runtime role capability matrix，再以现有能力脚本精确授予 `publish_execution_runs` 的 `UPDATE` 权限。

回滚只允许从未消费过任何授权的数据库执行。一旦存在 `running`、`completed` 或 `consumed_at` 记录，只允许回滚应用版本并保留数据库事实，不允许恢复永久关闭约束。
