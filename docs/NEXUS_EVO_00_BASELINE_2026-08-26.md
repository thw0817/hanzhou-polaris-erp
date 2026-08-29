# NEXUS-EVO-00 基线冻结与回滚保护

日期：2026-08-26（Asia/Shanghai）  
方案：NEXUS-OPS-01-EVO：渐进式店群运营中台升级  
阶段：EVO-00

## 目标

本阶段只建立可追溯基线和回滚保护，不修改业务逻辑、不切换 SHEIN 写入接口、不执行数据库迁移、不部署新版本。

## 线上基线

- 当前 release：`/opt/shein-console/releases/shein-cloud-deploy-20260826-srf-01-manual-refresh-v2`
- `current`：`/opt/shein-console/current`（指向上述 release）
- 线上发布包：`shein-cloud-deploy-20260826-srf-01-manual-refresh-v2.tar.gz`
- 发布包 SHA-256：`87bc4ac963a610c3f73777ac4146a98f9572c16f7a839ea393803517297aa5a2`
- 线上 release 文件集 SHA-256：`d8eaf4b8b437f77087ec696246bab8daae9a7a0cf3031981ff00635660533e3b`
- 控制服务：`https://api.hanzhou.icu/health` 返回 `ok:true`
- 依赖就绪：`https://api.hanzhou.icu/ready` 返回 PostgreSQL、Redis 均为 `up`
- 当前未执行数据库迁移，未调用 SHEIN 商品或合规写接口。

## 数据库回滚基线

线上已存在每日 PostgreSQL 备份，本阶段确认最近可用备份：

- 文件：`/opt/shein-console/backups/postgres/shein_console_20260825T193517Z.dump`
- 大小：`53,145,904` bytes
- SHA-256：`12899519a6384192a104a87271a70ab7b180f82d1959f0a318ebf49f7e895144`
- 前一份备份：`shein_console_20260824T194046Z.dump`
- 前一份 SHA-256：`a16b69bd2df0a46e7772bd2f5d7fa71a3602729770914a5d596bf0b12e30ca43`

数据库没有在本阶段写入新数据，后续涉及迁移或数据结构修改时，必须在上线前重新生成维护窗口备份。

## 本地门禁基线

- `npm test`：1056/1056 通过
- `npm run build:v2`：通过
- `npm run release:audit:v2`：`READY`，14/14 contracts，无 blockers
- `dist-v2/index.html` SHA-256：`3dcb596ea32046485a675912ca9624851561d444189800ecf998318739c46967`
- `dist-web/index.html` SHA-256：`3dcb596ea32046485a675912ca9624851561d444189800ecf998318739c46967`
- package version：`0.1.0`

## 版本控制说明

当前工作区没有 Git 提交历史，且保留了历史部署包和用户已有改动；本阶段没有执行清理、reset 或覆盖操作。后续回滚以线上 release 路径、发布包 SHA-256 和数据库备份为准，不把未提交工作区当作可靠版本库。

## 后续变更硬门槛

进入 EVO-01 及以后阶段前，必须满足：

1. 新增回归测试先失败，再实现修复；
2. 全量测试、V2 构建和发布审计全部通过；
3. 涉及数据库时先完成备份和迁移回滚检查；
4. SHEIN 商品、合规、发布写入继续保持原有开关和权限保护；
5. 每个阶段单独生成 release、SHA-256 和部署记录；
6. 线上只允许原子切换 `current`，失败立即切回本阶段前 release。

## 阶段结论

EVO-00 已完成。当前线上版本、静态构建、数据库备份、健康检查和测试门禁均已记录；未修改业务代码，未部署新业务版本。
