# V2 Release 只读就绪门禁

日期：2026-08-05

本门禁用于判断一个候选 release、目标 PostgreSQL Schema、`shein_runtime` 角色和 V2 静态构建是否具备
进入切换评审的条件。它不执行迁移、不创建角色、不修改权限、不启动长期服务，也不调用任何 SHEIN 接口。

无论门禁是否通过，商品发布能力都继续固定为
`executionEnabled=false`、`authorizesPublishing=false`。

## 检查范围

- 候选 release 是否包含迁移 `021–031`，且文件 SHA-256 与仓库冻结值一致。
- `schema_migrations` 是否记录同名迁移和相同校验和。
- 新表、索引、最终规则类型约束、不可变函数和四个 `ENABLE ALWAYS` 触发器是否完整。
- 第 030 号发布执行状态表、领取索引和两个发布关闭约束是否完整。
- release 服务端是否包含发布批次、执行计划、一次性授权协议和结果未知恢复边界。
- Webhook Worker 是否把商品接收/审核通知按租户、店铺和任务唯一匹配追加到
  `publish_receipts`，且不把模糊匹配强行归属。
- 指定静态目录是否包含发布中心、一次性授权、“执行发布（未启用）”以及全类目
  schema 覆盖和未同步类目阻断构建结果。
- `shein_runtime` 是否存在、非高权限、不可写 `schema_migrations`，且两张合规审计表保持只读加追加。
- 使用 runtime 连接执行既有角色边界和完整能力矩阵审计。
- 受影响表的 PostgreSQL 估算行数和占用空间，只作为维护窗口风险信号，不代替备份或精确预检。

## 本地验证

```bash
npm run db:audit:v2-readiness -- \
  --root "$PWD" \
  --web-root "$PWD/dist-v2"
```

检查另一个只读挂载的 release、同时复用容器内 Node 依赖时，可以额外传入：

```text
--module-root /app
```

命令需要一个只读可达的检查连接：

- `SHEIN_MIGRATION_DATABASE_URL`，优先使用；
- 未配置时回退到 `DATABASE_URL`；
- 完整 runtime 能力审计使用 `SHEIN_RUNTIME_DATABASE_URL`，未配置时回退到 `DATABASE_URL`。

连接串不得作为命令参数、日志或交接记录输出。审计进程所在网络必须能够解析连接串中的数据库主机名。

## 判定

只有输出首行为 `V2 release readiness: READY`、退出状态为 `0`、阻断项为 `none` 时，才允许进入切换评审。
缺文件、缺迁移、校验和变化、对象缺失、角色缺失、权限不精确、runtime 审计未执行或 V2 静态构建不完整，
均返回 `NOT READY` 和非零退出状态。

`READY` 不是迁移授权、上线授权或商品发布授权。仍需完成备份、维护窗口审批、迁移专属预检、角色人工准备、
候选服务验收、切换审批和写后观察。

## 维护顺序

1. 在未激活目录完整准备候选 release、`dist-v2`、迁移文件、审计 SQL 和回滚说明。
2. 记录当前 release、活动连接、容器状态、备份点和恢复验证记录；停止会产生数据库写入的长期服务。
3. 使用 migration owner 顺序执行 `021–027`；第 `022` 号普通索引必须结合 `sync_jobs` 数据量确定窗口。
4. 按 `deploy/migrations/028_compliance_preflight_reviews.md` 完成第 `028` 号专属预检、迁移和验证。
5. 按 `deploy/migrations/029_compliance_audit_immutability.md` 完成第 `029` 号专属预检、迁移和验证。
6. 按 `deploy/migrations/030_publish_execution_state.md` 完成第 `030` 号专属预检、迁移和验证。
7. 顺序完成第 `031–033` 号模板迁移；如本次计划启用商品真实发布，再单独按 `deploy/migrations/034_publish_execution_enablement.md` 完成第 `034` 号预检、迁移和验证。
8. 由 DBA 人工建立并加固 `shein_runtime`，逐项对照静态能力矩阵授予精确权限；第 034 号迁移后必须重新运行 runtime 权限审计。
9. 对候选 release 和候选 `dist-v2` 运行本门禁；随后以 runtime 连接启动候选控制服务做隔离验收。
10. 通过人工 GO 决策后再切换 release 和 Nginx 静态目录；切换后对实际活动目录重新运行本门禁。
11. 验证 `/health`、`/ready`、登录、店铺列表、商品草稿、合规工作区和发布中心只读流程。
12. 真实发布默认保持关闭。只有第 034 号迁移和权限审计通过，并且控制服务与 `product-publish-worker` 同时显式开启后，才可在单商品、小流量、人工逐项核对条件下验收；不得仅凭本门禁 `READY` 开启执行。

任一阶段失败时停止切换。应用回滚默认保留已经成功执行的向前兼容表和第 `029` 号不可变门禁及第 `030` 号空状态表；
不得通过删除
合规审计数据、恢复共用高权限连接或放宽 runtime 权限来消除门禁失败。
