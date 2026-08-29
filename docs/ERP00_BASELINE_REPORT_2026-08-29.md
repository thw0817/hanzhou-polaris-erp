# HANZHOU-POLARIS ERP-00 基线报告

版本：2026-08-29  
Run：`RUN-20260829-ERP00-BASELINE-01`  
采集时间：本地与生产 `2026-08-29 11:07–11:14 +0800`  
当前结论：**COMPLETE；ERP-01 等待单独授权**

## 1. 本 Run 的范围和边界

本 Run 只执行 ERP-00“变更冻结与真相基线”允许的只读检查：本地文件、Git、依赖、构建入口、静态产物、部署拓扑、生产健康、容器、镜像、功能开关、数据库聚合、Redis 队列和备份目录清单。

本 Run 没有修改业务代码、数据库、队列、生产配置或 SHEIN 数据；没有重启服务、切换 release、清理文件、运行迁移或调用 SHEIN 写接口。执行过一次本地 `release:audit:v2 --static-only --json`，该命令只读取静态文件。

## 2. 结论摘要

1. 本地工作区没有可信 Git 基线：当前分支显示 `main`，但没有任何 commit，`HEAD` 无法解析；tracked 文件为 0，标准 untracked 文件为 701。
2. 本地同时存在 `src/`、`src-v2/`、`dist-v2/`、`dist-web/` 和 124 个历史部署压缩包；不能用普通 `git diff` 证明工作区没有改动。
3. 本地 `dist-v2` 与 `dist-web` 的入口哈希不同；生产 current 的两个入口哈希相同，但与本地不同。这是单一 V2 产物和生产版本可追溯性风险，属于后续 ERP-02/03 的重要证据。
4. 生产 current 已只读识别为 `/opt/shein-console/releases/shein-cloud-deploy-20260829-frontend-restore-v1`；Control、发布 Worker、其他同步 Worker、PostgreSQL、Redis 和 Webhook 服务均在运行。
5. 生产发布和合规写开关均为 `true`，但本次快照中发布队列各关键状态均为 0，近 30 分钟没有活跃发布 run；历史 `claimed=2`、`running=11` 仍需后续受控对账，不能清理或自动重试。
6. 已按用户明确授权创建生产 PostgreSQL custom-format 备份，并在无网络、临时、无持久化卷的 PostgreSQL 容器中完成恢复验证；备份文件权限、SHA-256、归档条目和关键表聚合均已核对。

## 3. 本地资产基线

### 3.1 Git 与文件规模

| 项目 | 结果 |
| --- | --- |
| 分支 | `main`，但无 commit |
| `HEAD` | 无法解析 |
| remote | 未发现可用 remote 输出 |
| tracked 文件 | `0` |
| 标准 untracked 文件 | `701` |
| `src/` 文件 | `26` |
| `src-v2/` 文件 | `130` |
| `server/` 文件 | `281` |
| 测试/规格文件 | `167` |
| 本地迁移文件 | `46` |
| 历史部署压缩包 | `124` |
| 依赖 | `node_modules` 存在 |
| 异常未跟踪文件 | 顶层存在空文件 `" .Destination}}{{end}}'`，不得擅自删除 |

当前不允许执行 `reset`、`clean`、批量删除、重命名迁移或整理历史压缩包。以上均属于后续 ERP-01 的受控资产救援范围。

### 3.2 构建入口与静态产物

`vite.config.js` 当前仍支持三类输出：普通 `dist`、`web` 模式输出 `dist-web`、`v2` 模式输出 `dist-v2`。Nginx 示例配置实际指向 `/opt/shein-console/current/dist-web`。本地关键哈希如下：

| 文件 | SHA-256 |
| --- | --- |
| `package.json` | `a6c9fae3c08e288e1139076b3d701fb8127340544eeb8e6c2bfd0fd8382b6b67` |
| `vite.config.js` | `397b89abb178b0f7f8f95806a7022a5df893b58bd5475167ad618db1a14e2820` |
| `deploy/docker-compose.cloud.yml` | `750ced570265c54cff02730e545a5f8a0058ae3d20a5d69915880dac7a4e423c` |
| `server/cloud/control-server.js` | `16ea6bcdab65effb4824d0a1e0c14419aab49ad132209235e830f3586ce4999a` |
| `server/cloud/product-publish-worker-server.js` | `ea9cd894ce841dbde0e43443603dde4ce924e5d771410da8ff8a7731a0150522` |
| `dist-v2/index.html` | `7df5835910e242444e9931d5b2e7709950620147cb4fa3216c1453cf5437a1aa` |
| `dist-web/index.html` | `2efc10eda3d3f96f0354d18dea5698965bcfe1774826bcfaed46f90bd99c95af` |

本地两个静态入口不同；本地静态审计结果为 `ready=true`、contracts `14/14`、无静态 blocker、发布开关静态值为 false。该审计不能证明生产版本、数据库或 SHEIN 状态正确。

### 3.3 本地环境边界

- `.env` 中观测到 `SHEIN_COMPLIANCE_WRITES_ENABLED=true`；没有输出任何秘密值。
- `.env.cloud.example` 中发布、合规、经营、规则、Webhook 等默认开关均按模板提供，不能当作当前运行环境事实。
- 本机没有运行项目 Control、Worker、PostgreSQL、Redis 或 Docker；本次未启动它们。
- 本地迁移文件存在重复 `014` 前缀；不可重命名已执行迁移。

## 4. 生产只读基线

### 4.1 Release、网页和服务

生产主机：`ubuntu@42.193.179.216`，受控密钥通道只读连接成功。采集时刻为 `2026-08-29T11:13:44+08:00`。

| 项目 | 当前只读结果 |
| --- | --- |
| `/opt/shein-console/current` | 指向 `/opt/shein-console/releases/shein-cloud-deploy-20260829-frontend-restore-v1` |
| `dist-v2/index.html` | `d38a976466c93b7f071eaab5d7bf96b52f2d5ecb711940cd6964d09feb5b6e3f` |
| `dist-web/index.html` | 与 `dist-v2` 相同，哈希为 `d38a976466c93b7f071eaab5d7bf96b52f2d5ecb711940cd6964d09feb5b6e3f` |
| 公网 API `/health` | HTTP 200，服务标识 `shein-cloud-control` |
| 公网网站 `/` | HTTP 200，标题为 `SHEIN超级运营中心` |
| Control | running，healthy，启动时间 `2026-08-28T13:17:16.149316554Z` |
| Product publish Worker | running，启动时间 `2026-08-28T13:17:16.152810039Z` |
| PostgreSQL | running，healthy，启动时间 `2026-08-02T14:29:09.456457054Z` |
| Redis | running，healthy，启动时间 `2026-07-30T06:33:59.989013674Z` |

生产 Control 与 Product publish Worker 的关键容器镜像 digest：

| 服务 | Image digest |
| --- | --- |
| Control | `sha256:f41e9a781cd049c810e9783cec5c1ad855fb7ea5ea604fd9b4be7bd605b58a85` |
| Product publish Worker | `sha256:e7f13b754c187eae49fda5ec8607cd8a2240b56ab3ce042a79d0ee183a658739` |
| Rule refresh Worker | `sha256:5f821bcc6707cabb66aa3b975b9b437392028891ccd60fdf5906fc955d01139d` |
| Store business refresh Worker | `sha256:3763df3f8ec5ab8b59dd20f46a839c30d90961d9107f798f91177ca1577086c2` |
| Compliance sync Worker | `sha256:07725c44fd196ac2af6cd87ffe306372b216308f2facb0f86df449e3502dbe4b` |
| Webhook / Webhook Worker | `sha256:718bfa4da01d14893cb8e5adfc18123eb639ef9dc1f7096d89a0ccc8907e1f7e` / `sha256:f993607c7c54e862b00e19bc950052cf7d5a4cebeefc2c5401d2da0bf3224020` |
| Media cleanup Worker | `sha256:5c4274deaf3c359d1e54f921d15f5c416cfbf7f4b809b0d6fae92fe97543218e` |

### 4.2 生产功能开关

只记录布尔状态，不记录秘密和完整环境文件：

| 服务/开关 | 状态 |
| --- | --- |
| Control：商品发布执行 | `true` |
| Product publish Worker：商品发布执行 | `true` |
| Control：合规写入 | `true` |
| Product publish Worker：合规写入 | `true` |
| Control：经营刷新 | `true` |
| Control：规则刷新 | `true` |
| Control：合规同步 | `true` |
| Store business scheduler | `false` |
| Webhook ingress | `true` |

开关为 `true` 不等于某个商品已经被 SHEIN 接收；本快照也没有调用 SHEIN 写接口。

### 4.3 Redis 与数据库

已知 BullMQ 队列在采集时的 `wait/active/delayed/failed/completed/prioritized` 均为 0：商品发布、规则刷新、经营刷新、合规同步、Webhook 和媒体清理队列均未发现积压。

PostgreSQL 只读聚合：

| 表 | 总数/状态聚合 |
| --- | --- |
| `publish_jobs` | `209`：`claimed=2`、`failed_terminal=127`、`submitted=80` |
| `publish_batch_items` | `240`：`failed=60`、`ready=180` |
| `publish_execution_runs` | `27`：`failed=16`、`running=11` |
| `product_review_states` | `151`：`audit_state=1:7`、`2:26`、`3:79`、空值 `39` |
| `product_drafts` | `93` |
| `stores` | `11` |
| `webhook_events` | `2884` |
| `tenants/users/memberships/store access` | `2 / 7 / 7 / 9` |
| `spus/skcs/skus` | `516 / 544 / 0` |

状态时间表明：`claimed=2` 的最后更新时间为 `2026-08-28 02:07:15.668+00`，`running=11` 的最后更新时间为 `2026-08-28 03:35:38.873+00`；采集时近 30 分钟活跃 run 为 0、近 30 分钟 claimed job 为 0。这些历史未收口记录不得在 ERP-00 清理、覆盖或自动重试。

生产 `schema_migrations` 已应用 46 条，最新为 `045_publish_lifecycle_indexes.sql`，最后应用时间 `2026-08-28 13:15:45.536205+00`。本地与生产均存在迁移编号治理风险，不能直接改名或补跑。

### 4.4 备份可恢复性

首次只读检查发现以下路径没有应用备份：

- `/opt/shein-console/backups`：目录存在，但没有发现数据库 dump、SQL 备份或快照文件；
- `/opt/shein-console/backup`：不存在；
- `/var/backups/shein-console`：不存在；
- `/var/backups`：仅发现系统包管理备份，没有应用 PostgreSQL 恢复点。

用户随后明确授权创建并验证生产 PostgreSQL 备份。本次动作记录如下：

| 项目 | 结果 |
| --- | --- |
| 备份动作 ID | `ERP00-20260829T114751+0800` |
| 备份文件 | `/opt/shein-console/backups/postgresql-20260829T114751+0800.dump` |
| 格式 | PostgreSQL custom format；未包含 owner/privilege 恢复要求 |
| 文件大小 | `56,607,733` bytes |
| 文件权限 | `600` |
| SHA-256 | `339b189da77dad7de0cd981088c8756d14d2ecd0f5c25f656fd4494b95b8d205` |
| 归档条目 | `469` |
| 恢复环境 | PostgreSQL 16 临时容器、`--network none`、tmpfs 数据目录、无持久化卷 |
| 恢复结果 | `PASS`；51 张 public 表成功恢复 |
| 关键恢复核对 | `schema_migrations=46`、`publish_jobs=209`、`publish_batch_items=240`、`publish_execution_runs=27`、`product_review_states=151`、`product_drafts=93`、`stores=11`、`webhook_events=2885` |
| 状态聚合核对 | `publish_jobs`: claimed 2 / failed_terminal 127 / submitted 80；`publish_execution_runs`: failed 16 / running 11 |
| 临时资源 | 恢复容器已清理；没有修改生产数据库、队列、配置或服务 |

备份及恢复门禁现已通过。生产快照查询与备份之间有一条 Webhook 事件进入，因此恢复快照为 2885 条；这属于采集时间差，不改变恢复成功结论。

## 5. 本地与生产差异

| 对象 | 本地 | 生产 | 判断 |
| --- | --- | --- | --- |
| V2 入口 | `7df583...` | `d38a976...` | 不一致 |
| Web 入口 | `2efc10...` | `d38a976...` | 不一致；生产两入口一致、本地两入口不一致 |
| Control 关键源码 | `16ea6b...` | `16ea6b...` | 该文件哈希一致，不代表全源码一致 |
| Product publish Worker 关键源码 | `ea9cd8...` | `ea9cd8...` | 该文件哈希一致，不代表镜像/全服务一致 |
| package / Vite / Compose | 关键哈希一致 | 关键哈希一致 | 仍需 ERP-01/02 完整文件清单与 manifest |
| Git 基线 | 无 HEAD | release 目录 | 无法建立可回滚源码提交对应关系 |
| 数据库状态 | 未连接本地运行库 | 有历史未收口状态 | 不得把历史数据直接当成已修复 |

## 6. 当前 P0/P1 问题证据索引

问题登记的权威入口仍是 [COMMERCIAL_ERP_EXECUTION_LEDGER_2026-08-28.md](./COMMERCIAL_ERP_EXECUTION_LEDGER_2026-08-28.md) 的 Issue 表；本 Run 不改变历史 Issue 的状态，也不把历史 `CONFIRMED` 误写成当前线上复现。

本次基线直接支持或重新暴露的重点证据：

- `BUG-REL-001`：本地 `dist-v2`、`dist-web` 与生产静态入口哈希不一致；
- `BUG-PUB-001/002/003`：生产发布开关为 true，Control/Worker 均运行，但历史发布状态和服务版本仍需按 command、receipt、readback 和镜像完整 manifest 对账；
- `BUG-PUB-004/005/006/012`：数据库中仍有历史 `claimed`、`running`、`ready`、`failed_terminal`，不能在没有规范 Command/Attempt 和备份的情况下修复；
- `BUG-REV-005/006/007/012/014`：审核状态、事件、回执和投影仍需通过统一 Snapshot、receipt 和 current pointer 重新验证；
- `BUG-BUILD-001/005/006`：本地存在 legacy/V2 双入口与多种构建输出；
- `RISK-001/002/004/011/012`：制品/Worker 漂移、历史状态误修、备份不可恢复和临时编号绕过风险均在当前基线中有效。

## 7. ERP-00 验收与停止结论

### 已通过

- 本地与生产的采集时间已记录；
- 生产 current、公共健康、容器、镜像 digest、静态 hash、数据库聚合和队列状态已取得只读证据；
- 报告不包含秘密值或完整环境文件；
- 本 Run 未进行超范围业务修改或外部写入；
- 未用 `git diff` 代替无 HEAD 仓库的完整资产核验。

### 后续仍需在 ERP-01/后续步骤处理的已知边界

- 本地没有可信 Git HEAD、remote 和回滚提交；
- 全量源码与生产 release 的完整 manifest 尚未形成；
- 生产关键历史任务仍存在，业务真相尚未完成受控对账。

### ERP-00 完成结论

备份/恢复门禁已通过，生产 current、Control、Worker、静态产物、迁移、队列、开关和数据库聚合均已有带时间的新鲜证据；未知项已显式列出，没有用推测补齐。因此 `RUN-20260829-ERP00-BASELINE-01` 可标记 `COMPLETE`。

ERP-01 已依据用户后续明确授权启动：创建首个 Git 基线提交、配置私有镜像、生成基线 tag 和验证空目录 clone。ERP-01 不得修改业务逻辑，不得提交 `.env`、`.data`、数据库、密钥、`node_modules` 或历史部署包。
