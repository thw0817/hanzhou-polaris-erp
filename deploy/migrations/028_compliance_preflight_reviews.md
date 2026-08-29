# 028 合规预检审阅迁移 Runbook

适用迁移：`028_compliance_preflight_reviews.sql`

日期：2026-08-04

## 边界

本步骤只创建 dry-run 审阅审计表，不启用发布、SHEIN 写入或执行队列。迁移必须先于包含审阅功能的新应用
版本启动，因为新版本的合规详情会读取该表。

## 部署前

1. 记录当前 release 路径、容器版本和数据库备份点。
2. 确认新 release 同时包含迁移、服务端代码和 V2 静态文件。
3. 真实环境部署前，先在空的一次性本机数据库执行自动演练：

```bash
DATABASE_URL=postgres://shein:change-me@127.0.0.1:5432/shein_console_rehearsal \
SHEIN_MIGRATION_REHEARSAL_CONFIRM=REHEARSE_028_ON_EMPTY_LOCAL_DATABASE \
npm run db:rehearse:028
```

演练入口拒绝远程主机、默认 `shein_console` 数据库、名称不含 `test/rehearsal/scratch` 的数据库和非空数据库。
4. 使用只读账号执行真实环境预检：

```bash
psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f deploy/migrations/028_compliance_preflight_reviews_preflight.sql
```

所有 `passed` 必须为 `t`。`migration:028_pending` 为 `f` 时说明迁移已经登记，不得重复部署或修改已登记的
迁移文件；应先核对 `schema_migrations.checksum` 和当前 release。

## 执行顺序

1. 保持旧应用版本运行，暂不启动包含审阅读取的新版本。
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
  -f deploy/migrations/028_compliance_preflight_reviews_verify.sql
```

所有 `passed` 必须为 `t`。首次启动新版本前，`review_count` 应为 `0`。
4. 验证完成后再切换或重启云端 control 服务。
5. 只检查合规详情读取和管理员审阅接口，不开启任何 SHEIN 写入开关。

## 回滚

### 应用回滚

这是默认方案。停止新版本并切回上一 release。上一版本不会读取新表，因此应保留表和迁移记录，不需要修改
数据库。

如果表中存在任何审阅记录，只回滚应用版本，保留表和迁移记录；不得删除表或删除迁移登记。

### Schema 回滚

仅在新版本尚未启动、审阅表确认为空、且必须撤销本次 Schema 时使用。先停止所有可能写入审阅表的应用实例，
再由数据库管理员人工执行
`deploy/migrations/028_compliance_preflight_reviews_rollback_empty.sql`。脚本内容如下：

```sql
BEGIN;

LOCK TABLE compliance_preflight_reviews IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM compliance_preflight_reviews) THEN
    RAISE EXCEPTION 'compliance_preflight_reviews is not empty';
  END IF;
END
$$;

DROP TABLE compliance_preflight_reviews;

DELETE FROM schema_migrations
WHERE filename = '028_compliance_preflight_reviews.sql';

COMMIT;
```

禁止添加 `CASCADE`。任一步失败都应执行 `ROLLBACK`，重新检查表内记录和活动应用实例，不得强行删除数据。

## 验收

- 普通合规详情读取正常。
- owner/admin 可以对最新 dry-run 记录一次“已审阅”。
- operator/viewer 返回 403。
- 重复审阅或审阅历史 dry-run 返回 409。
- 审阅后 `releaseGate.publishingEnabled` 仍为 `false`。
- SHEIN 写请求、发布任务和执行队列数量没有变化。
