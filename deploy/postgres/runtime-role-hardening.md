# PostgreSQL 运行时角色加固

日期：2026-08-05

## 当前风险

当前 Compose 默认配置使用 `POSTGRES_USER=shein` 初始化数据库，并曾把同一个 `shein` 连接交给 control、
worker 和迁移命令。PostgreSQL 官方镜像创建的初始用户拥有高权限，因此当前 Compose 默认配置在没有独立
角色和授权调整时不能通过运行时角色审计。

仓库现在只提供连接配置拆分和只读审计，不创建角色、不生成密码，也不调整任何已有对象所有权。
不得自动修改生产数据库角色、密码或所有权。

## 目标边界

- `SHEIN_MIGRATION_DATABASE_URL` 只提供给一次性 `migration` 服务，对应可执行版本化迁移的所有者角色。
- `SHEIN_RUNTIME_DATABASE_URL` 提供给 control 与所有长期运行 worker，对应非超级用户、非数据库、
  Schema 或审计对象所有者的最小权限角色。
- runtime role 对两张合规审计表只拥有 `SELECT` 和 `INSERT`，不得拥有 `UPDATE`、`DELETE`、`TRUNCATE`
  或 `TRIGGER`。
- runtime role 不得写入 `schema_migrations`，也不得继承 migration owner 或受保护对象 owner。

## 人工准备

1. 先记录数据库备份点、当前角色、对象 owner、活动连接和现有 `.env`。
2. 由数据库管理员在维护窗口建立独立 runtime 登录角色，并使用独立随机密码。
3. 逐表授予应用实际需要的最小权限；对两张合规审计表严格限制为读取和追加。
4. 撤销 runtime role 在 `public` Schema 上的对象创建能力，确认它不继承 migration owner。
5. 不改变受保护审计表、共享触发器函数和 `schema_migrations` 的所有者。
6. 把两条连接 URL 写入服务器受保护的 `/opt/shein-console/shared/.env`，文件权限保持 `600`。

仓库不提供自动角色创建或批量授权脚本，因为现有数据库中的表、序列、函数 owner 和历史授权必须由数据库
管理员先核对，不能从代码仓库猜测后直接改生产权限。

维护窗口使用 `deploy/postgres/runtime-role-acceptance-record.md` 记录备份点、静态基线、人工准备、
只读审计、失败修正、上线与回滚决策。先把空白模板复制到受控变更系统再填写；填好的记录不得提交回
代码仓库，也不得包含凭证、连接地址、ACL 明细或可执行权限变更语句。

## 应用能力矩阵

`deploy/postgres/runtime-role-capabilities.md` 是从八个长期运行服务入口的本地递归 import graph
静态生成的审阅清单。它只统计迁移中真实创建的表，以及运行时代码字符串中的
`SELECT`、`INSERT`、`UPDATE`、`DELETE` 和 `serial`/`bigserial` 序列 `USAGE` 需求。
SQL 的 `RETURNING` 会同时计入目标表的读取需求。

更新命令：

```bash
npm run db:capabilities:write
node --test server/cloud/runtime-database-capabilities.test.js
```

同一命令还生成 `deploy/postgres/audit-runtime-capabilities.sql`。生成器排除 migration、rehearsal、
audit、provision 和 demo 等管理入口；仓库测试要求矩阵和审计 SQL 都与当前代码逐字一致，并禁止出现
`GRANT` 或 `REVOKE`。这些文件不能代替 DBA 审阅。DBA 必须把静态模型与目标数据库的真实 Schema、
对象 owner、默认权限、RLS、函数执行权限及历史授权逐项核对，再人工制定变更和回滚方案。

## 只读验证

使用只接收 runtime URL 的一次性审计服务执行：

```bash
sudo docker compose \
  --env-file /opt/shein-console/shared/.env \
  -f deploy/docker-compose.cloud.yml \
  run --rm --build runtime-database-audit
```

执行器通过容器网络使用 `SHEIN_RUNTIME_DATABASE_URL`，不依赖宿主机 `psql` 或宿主机解析 `postgres`
服务名。它先运行角色边界审计，再运行生成的能力覆盖审计；两份 SQL 都必须至少返回一项命名检查，且所有
`passed` 必须为 `t`。缺少检查、`false` 或 `null` 都会使命令失败。

能力覆盖审计要求 `public` Schema 可用但不可创建对象；矩阵内每张表的
`SELECT/INSERT/UPDATE/DELETE` 必须与静态模型精确一致，并一律拒绝额外的
`TRUNCATE/REFERENCES/TRIGGER`。序列权限同样精确核对 `USAGE/SELECT/UPDATE`。对象缺失、对象类型错误或
额外权限都会失败。底层 SQL 只读取 PostgreSQL 系统目录和权限函数，不修改角色、权限、对象或数据。
任一检查失败时保持旧应用停止切换状态，先修正角色方案；不得为了通过检查而移除第 029 号触发器。

失败输出只使用仓库定义的静态检查名，并分为“角色边界”和“能力覆盖”两组。能力项只显示
`table:<对象名>` 或 `sequence:<对象名>`；不会打印连接串、ACL、owner、角色成员列表或查询结果行。
两份只读审计都会执行，以便一次看到完整失败集合；任一 SQL 文件没有返回命名检查时仍立即失败。

## 迁移与启动

先用一次性 migration 服务执行迁移：

```bash
sudo docker compose \
  --env-file /opt/shein-console/shared/.env \
  -f deploy/docker-compose.cloud.yml \
  run --rm --build migration
```

迁移和只读验证完成后，才允许启动 control 与所需 worker。长期运行服务不会收到
`SHEIN_MIGRATION_DATABASE_URL`。

## 回滚

应用回滚继续使用同一个 runtime role，不恢复超级用户连接。若最小权限遗漏导致旧应用无法运行，应先根据
明确的失败 SQL 补充该应用真正需要的权限；不得把 runtime URL 临时改回 migration owner 或初始超级用户。
