# ERP-01 资产边界与跟踪策略

Run：`RUN-20260829-ERP01-ASSET-BASELINE-01`  
采集时间：2026-08-29  
原则：保留原工作区全部用户文件；只把可审查的源码、文档、测试、迁移和部署定义纳入 Git；生成物、环境、数据、依赖和历史部署包不进入源码提交。

## 1. 分类

| 分类 | 当前路径/规则 | Git 策略 | 说明 |
| --- | --- | --- | --- |
| source | `src/`、`src-v2/`、`server/`、`package.json`、`package-lock.json`、`vite.config.js`、`tsconfig.v2.json`、`index.html` | 跟踪 | 业务源码、服务端、构建入口和依赖锁定 |
| docs | `docs/`、`README.md`、`ENGINEERING_RULES.md`、`.agents/` | 跟踪 | 方案、API 原始资料、交接和工程规则 |
| tests | `**/*.test.*`、`**/*.spec.*` 及测试夹具 | 跟踪 | 回归、契约和迁移测试 |
| migrations | `server/cloud/migrations/` | 跟踪 | 46 个 SQL 原样保留；重复 `014` 前缀不得重命名 |
| assets | `public/`、源码中受版本控制的静态资源 | 跟踪 | favicon 等源码资产；不包含本地产物 |
| deploy | `deploy/` | 跟踪 | Compose、Dockerfile、Nginx 示例、审计和迁移 runbook |
| generated | `dist/`、`dist-v2/`、`dist-web/`、coverage、Vite 缓存 | 忽略 | 可由源码重建，不作为源码事实 |
| local-data | `.env`、`.env.web`、`.data/`、本地数据库/SQLite 文件 | 忽略 | 可能含秘密或运行态数据；不复制到提交 |
| dependencies | `node_modules/` | 忽略 | 从 lockfile 安装 |
| release-archives | 顶层 `*.tar.gz`、`*.tgz`、`*.zip`、`*.7z` | 忽略，单独索引 | 当前 124 个历史部署包已逐一计算大小、时间、SHA 和文档证据 |
| quarantine | 顶层空文件 `" .Destination}}{{end}}'` | 忽略但保留 | 未删除、未移动；疑似历史命令模板产物，不属于源码 |

## 2. 已完成的资产保护

- 完整工作区归档：`/private/tmp/HANZHOU_POLARIS_ERP01_WORKSPACE_20260829.tar`。
- 归档大小：`1,404,899,328` bytes；权限：`600`。
- 归档 SHA-256：`7545f0b032bf4b5a6d61b0cedc5c73704794bba877837acdf354591b374df352`。
- 生产数据库备份另见 `ERP00_BASELINE_REPORT_2026-08-29.md`，不复制到工作区和 Git。
- 历史部署包索引：[ERP01_RELEASE_ARCHIVE_INDEX_2026-08-29.md](./ERP01_RELEASE_ARCHIVE_INDEX_2026-08-29.md)。

## 3. 忽略规则验证

以下内容均必须被忽略：`.env`、`.env.web`、`.data/`、`node_modules/`、`dist/`、`dist-v2/`、`dist-web/`、历史部署包和异常空文件。安全模板 `.env.example`、`.env.cloud.example` 保留跟踪。

忽略规则不得用于隐藏业务源码、测试、迁移、API 原始资料、交接文档或部署定义。

## 4. 秘密扫描

扫描范围：排除 `.git/`、`node_modules/`、生成目录、环境文件和部署归档后，检查私钥头、AWS access key、GitHub token、OpenAI 风格 key 等高置信模式。结果：未发现匹配文件；扫描不输出秘密值。

后续每次提交和 release 仍必须重复秘密扫描；如果发现秘密，停止提交和部署，先撤销/轮换并从制品边界隔离。

## 5. 不可逆操作边界

ERP-01 不删除、覆盖、移动用户文件，不修改业务逻辑，不重命名历史迁移，不解包或清理历史部署包。任何遗留退役必须延后至 ERP-23，并有零引用证据、备份和用户批准。

## 6. Git 基线清洁度说明

对首个基线暂存区执行 `git diff --cached --check` 时，发现历史 Markdown 文档中已有大量用于排版换行的尾随空格及少量 EOF 空行，结果记为 `WARN`。ERP-01 不对这些原始方案文档做批量空白格式化，以保持历史内容可追溯；业务源码、受禁资产和秘密扫描仍必须通过，后续新增代码按正常清洁度门禁处理。
