# 029 合规审计不可变门禁 Runbook

适用迁移：`029_compliance_audit_immutability.sql`

日期：2026-08-04

## 边界

本步骤只为 `compliance_preflight_runs` 和 `compliance_preflight_reviews` 增加数据库级不可变门禁。
它阻止修改、删除和清空已有审计记录，不启用发布、SHEIN 写入或执行队列。

## 部署前

1. 记录当前 release 路径、容器版本和数据库备份点。
2. 确认第 028 号迁移已经完成，且新 release 同时包含第 029 号迁移与本 runbook。
3. 真实环境部署前，先在空的一次性本机数据库执行自动演练：

```bash
DATABASE_URL=postgres://shein:change-me@127.0.0.1:5432/shein_console_rehearsal \
SHEIN_MIGRATION_REHEARSAL_CONFIRM=REHEARSE_029_ON_EMPTY_LOCAL_DATABASE \
npm run db:rehearse:029
```

演练入口拒绝远程主机、默认 `shein_console` 数据库、名称不含 `test/rehearsal/scratch` 的数据库和非空数据库。
它会迁移到 028，执行 029 预检和迁移，在可整体回滚的样本事务中确认追加仍可用，并确认两张审计表的
修改、删除和清空均被数据库拒绝；随后回滚样本，完成空表回滚和重新迁移。
4. 使用只读账号执行真实环境预检：

```bash
psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f deploy/migrations/029_compliance_audit_immutability_preflight.sql
```

所有 `passed` 必须为 `t`。`migration:029_pending` 为 `f` 时说明迁移已经登记，不得重复部署或修改已登记的
迁移文件；函数或触发器未通过 absent 检查时，应先核对人工操作记录和当前数据库状态。

## 执行顺序

1. 保持旧应用版本运行；该迁移不改变审计记录的追加写入。
2. 从新 release 执行项目现有迁移命令：

```bash
sudo docker compose \
  --env-file /opt/shein-console/shared/.env \
  -f deploy/docker-compose.cloud.yml \
  run --rm --build migration
```

3. 立即使用只读账号执行验证：

```bash
psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f deploy/migrations/029_compliance_audit_immutability_verify.sql
```

所有 `passed` 必须为 `t`。验证会核对共享函数的返回类型和拒绝消息，并确认四个触发器绑定到正确表与
共享函数、处于 `ENABLE ALWAYS`、使用正确事件且分别为行级或语句级。同时记录 `run_count` 和
`review_count`，但不得根据数量修改或清理审计记录。
4. 验证完成后再切换或重启云端 control 服务。
5. 只检查 dry-run 追加和管理员审阅追加，不开启任何 SHEIN 写入开关。

## 回滚

### 应用回滚

这是默认方案。只回滚应用版本，保留第 029 号迁移及四个不可变触发器。旧应用仍可追加 dry-run 和审阅记录，
无需修改数据库。

任一审计表存在记录时，不得移除不可变触发器，也不得删除第 029 号迁移登记。已有记录属于审计证据，应继续
保持不可变。

### Schema 回滚

仅在第 029 号迁移刚完成、两个审计表均确认为空、且必须撤销本次 Schema 时使用。先停止所有可能追加审计
记录的应用实例，再由数据库管理员人工执行
`deploy/migrations/029_compliance_audit_immutability_rollback_empty.sql`。

脚本会在同一事务内排他锁定两张审计表，再次检查两表均为空，然后移除四个触发器、共享函数和迁移登记。
任一步失败都应执行 `ROLLBACK`，重新检查表内记录和活动应用实例。禁止添加 `CASCADE`，不得强行清理
审计数据以满足回滚条件。

## 验收

- 新 dry-run 和管理员审阅记录仍可正常追加。
- 修改或删除任一已有 dry-run、审阅记录都会被数据库拒绝。
- 清空任一审计表都会被数据库拒绝。
- 四个门禁均为 `ENABLE ALWAYS`，复制角色模式不会跳过它们。
- 外键级联删除触及审计记录时会被行级门禁拒绝。
- `publishingEnabled` 和 `authorizesPublishing` 仍为 `false`。
- SHEIN 写请求、发布任务和执行队列数量没有变化。
