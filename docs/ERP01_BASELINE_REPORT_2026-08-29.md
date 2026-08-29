# ERP-01 源码资产救援与版本控制报告

Run：`RUN-20260829-ERP01-ASSET-BASELINE-01`  
执行时间：2026-08-29 12:01:12～12:05:50 +0800  
状态：`COMPLETE`

## 1. 目标与边界

本步骤把当前约 1.3GB、无可信 HEAD 的工作区整理为可恢复、可审查、可比较的源码仓库。ERP-01 期间没有修改业务逻辑，没有删除、覆盖或移动用户文件，没有写入生产数据库、队列、配置或 SHEIN，也没有切换线上 release。

完整分类和忽略策略见 [ERP01_ASSET_BOUNDARIES_2026-08-29.md](./ERP01_ASSET_BOUNDARIES_2026-08-29.md)。历史部署包逐项索引见 [ERP01_RELEASE_ARCHIVE_INDEX_2026-08-29.md](./ERP01_RELEASE_ARCHIVE_INDEX_2026-08-29.md)。

## 2. 原始工作区保护

- 完整归档：`/private/tmp/HANZHOU_POLARIS_ERP01_WORKSPACE_20260829.tar`
- 大小：`1,404,899,328` bytes；权限：`600`
- SHA-256：`7545f0b032bf4b5a6d61b0cedc5c73704794bba877837acdf354591b374df352`
- 原 Git 在操作前没有可信提交历史；原有 `.git` 内部对象和 refs 未清理，原目录仍保留。
- 124 个历史发布包只读取元数据并计算 SHA-256，未解包、未删除、未移动。

## 3. Git 基线

- 首个提交：`321e7ca8a8f5a792fa7be0f36d56b06d9f77a9cc`
- 树哈希：`8d3e273e51664afb0f59cb4ed2fd6cafde6f3ebf`
- 基线 tag：`polaris-erp-baseline-20260829`
- tag 对象：`8260fb3e44bafb14dbd730ff7ae61743a56925d6`
- 受控文件：569 个
- 主工作区状态：`main...origin/main`，无未提交改动

提交内容包括源码、V2 源码、服务端、测试、46 个迁移 SQL、部署定义、静态源码资产、17 板块/ERP 方案/API 原始资料和交接文档；不包括 `.env`（安全模板除外）、`.data`、数据库、`node_modules`、`dist*`、coverage、历史发布包和异常空文件。

## 4. 私有远端与空目录复现

由于当前环境没有用户指定的外部 Git 服务 URL，本步骤建立了明确标注的本机私有 bare 镜像：

`/Users/tianhanwen/Documents/HANZHOU_POLARIS_ERP_PRIVATE.git`

该镜像已 push `main` 和 `polaris-erp-baseline-20260829`，并从空路径 `/private/tmp/HANZHOU_POLARIS_ERP01_CLONE_INSTALL_20260829` clone。clone 的 HEAD 与基线一致、受控文件数为 569、工作区干净。它验证了 Git 远端语义和可复现流程，但不是外部托管服务；取得真实 GitHub/GitLab 等私有仓库地址后，只需绑定该地址并重复本节验证，不得把本机镜像误称为外部备份。

## 5. 安装、测试与构建证据

在全新 clone 内执行：

- `npm ci --ignore-scripts`：通过；184 个包安装成功。
- `npm test`：1170 tests，1170 pass，0 fail，0 skipped。
- `npm run build:v2`：通过；TypeScript 检查和 Vite 构建成功，1952 modules transformed。
- `npm run build:web`：通过；Vite 构建成功，1641 modules transformed。
- `npm run release:audit:v2 -- --root "$PWD" --web-root "$PWD/dist-v2" --json`：`ready=true`，`blockers=[]`，且静态审计明确 `publishingEnabled=false`、`authorizesPublishing=false`。
- 构建产物只存在于临时 clone 的 `dist-v2/`、`dist-web/`，没有进入 Git。

首次安装曾误受系统 npm cache 的 root-owned 文件影响并返回 `EACCES`；该失败现场保留在 `/private/tmp/HANZHOU_POLARIS_ERP01_CLONE_20260829`，随后使用隔离 npm cache 正确完成安装。npm 审计报告现有 1 个 high severity 依赖项；ERP-01 不擅自升级依赖，留给后续安全步骤处理。

## 6. 安全与差异验证

- 暂存区高置信秘密扫描：通过；未发现私钥头、AWS access key、GitHub token 或 OpenAI 风格 key。
- 禁止资产检查：`.env`/本地数据/数据库/依赖/生成目录/发布包/异常文件均未进入提交；安全模板保留。
- 临时修改已被 clone 的 `git status` 和 `git diff` 精确捕获，撤销后 clone 恢复干净，证明后续源码差异可见。
- `git diff --cached --check` 有 5265 行历史 Markdown 尾随空格/EOF 空行告警，已记录为 `WARN`。没有对方案文档做批量格式化，以免改变历史资料；新增业务代码仍需通过正常清洁度检查。

## 7. 发布包保留策略

- 当前 124 个归档包继续原位保留，不删除、不移动、不解包；索引中的 SHA-256 是当前取证基准。
- 在 ERP-03 制品仓库和 CI 门禁确定前，任何发布包只能作为历史证据，不得直接当作源码或当前生产 release。
- 后续制品仓库必须保存 immutable artifact、构建 commit、构建时间、manifest、迁移 checksum 和部署审计；生产只允许从已审计制品发布。
- ERP-23 之前不得以“清理历史包”为由删除任何归档；如需退役，必须先完成零引用证据、独立备份和用户批准。

## 8. 完成门结论

ERP-01 的备份、分类、124 包审计、安全忽略、secret scan、基线 commit/tag、私有镜像、空目录 clone、安装、测试、双构建、静态 release readiness、差异可见性和原工作区保护均已完成。`RUN-20260829-ERP01-ASSET-BASELINE-01` 标记为 `COMPLETE`。

ERP-02 尚未开始。下一步只能依据 ERP-02 进入条件另建正式 Run；不得因为 ERP-01 的构建成功而直接切换生产前端或把本地构建物部署到线上。
