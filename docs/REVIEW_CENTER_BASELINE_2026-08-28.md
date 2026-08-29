# 商品审核中心同步/发布基线

采集时间：2026-08-28 14:50:10 CST

本文件是审核中心同步与发布架构重整的第 1 步基线。采集过程只读：没有修改代码、数据库、Redis 队列或云端配置；没有重启服务；没有调用 SHEIN 商品或合规写接口；没有消费发布授权。

## 1. 工作树基线

- 工作目录：`/Users/tianhanwen/Documents/SHEIN爆单了`
- `git rev-parse --show-toplevel` 返回当前工作目录。
- 当前 `git status` 将项目文件和历史部署包报告为未跟踪文件；不能执行 `clean`、`reset` 或删除操作。后续所有改动必须保留现有工作树内容。
- 当前审核中心主要入口：
  - `src-v2/features/publishing/PublishBatchesPage.tsx`
  - `src-v2/lib/api.ts`
  - `server/cloud/product-review-service.js`
  - `server/cloud/publish-batch-service.js`
  - `server/cloud/publish-execution-repository.js`
  - `server/cloud/control-server.js`

## 2. 本地代码与静态资源指纹

以下 SHA-256 用于后续候选 release 比对：

| 文件 | SHA-256 |
| --- | --- |
| `src-v2/features/publishing/PublishBatchesPage.tsx` | `52476e5fa4c369d0accf301b946dfd375e2e44ad51c64aa8f849a0817b21457f` |
| `server/cloud/product-review-service.js` | `7af3cabb3bc0567a0d6eb707e05ae311b5e29124903ee000461b25faa0ba596b` |
| `server/cloud/publish-batch-service.js` | `09899942f773ae44f46465ad98f2f2447c34016369c730a59fde392fa1a27ddc` |
| `server/cloud/publish-execution-repository.js` | `803ad74d1a2223ddf0d034ee396bba0256f010a124ce7089fa134eba072b0ed4` |
| `src-v2/lib/api.ts` | `28518dbe79b6f5c7b953cd826d51d37c965d6d36e0ac06c0c9940b5f4bc0ea9a` |
| `dist-v2/index.html` | `15d04a65f2ecf2f80084f62b7e996c2d9a32c387bc88b5fc3c27e28c64457109` |
| `dist-web/index.html` | `15d04a65f2ecf2f80084f62b7e996c2d9a32c387bc88b5fc3c27e28c64457109` |

项目依赖当前已经包含 `@tanstack/react-query` 和 `bullmq`；尚未发现 XState、Zod、OpenTelemetry、Playwright、Bull Board 或 Temporal 依赖。

## 3. 公网只读基线

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| `https://api.hanzhou.icu/health` | HTTP 200 | 返回 `{"ok":true,"service":"shein-cloud-control"}` |
| `https://api.hanzhou.icu/ready` | HTTP 404 | 公网 Nginx 未暴露内部 ready 路由；符合交接文档的内部访问边界，不能据此判断 control 不健康 |
| `https://app.hanzhou.icu/` | HTTP 200 | 首页可读取 |
| 公网首页 SHA-256 | `15d04a65f2ecf2f80084f62b7e996c2d9a32c387bc88b5fc3c27e28c64457109` | 与本地 `dist-v2/index.html`、`dist-web/index.html` 一致 |
| 公网入口资源 | `assets/index-BmIs-m1Q.js` 等 | 只能确认静态入口可达，不能替代认证后的审核中心 API/数据库核验 |

## 4. 云端状态核验边界

本轮未取得可用的源站 SSH 主机/端口/账号，因此以下项目暂时不能从当前环境直接核实：

- `/opt/shein-console/current` 的真实 release
- control、商品发布 Worker 及其他 Worker 的实际容器/镜像 ID、创建时间和运行状态
- Redis 发布队列的 wait、active、delayed、failed 数量
- Postgres 中 `publish_jobs`、`publish_batch_items`、`publish_batches`、`publish_execution_runs` 的当前聚合
- 云端 control/Worker 文件 SHA 与本地候选 SHA 的一致性
- 当前云端 `SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED` 实际值

旧交接记录中的 release、容器和数据库数字只作为历史资料，不能作为本轮当前线上事实。取得受控源站通道后，必须先完成上述只读核验，再进入任何修复或部署。

## 5. 现象基线

用户截图及源码对照记录的当前现象：

- 审核中心顶部统计、tab 分类和列表可能互相不一致。
- `需处理` 全选后，若选中项没有可重发的本地草稿，发布按钮可能只呈 disabled 而没有原因提示。
- 驳回重发成功后，审核记录查询没有在发布 mutation 成功路径统一失效，旧驳回可能继续留在当前列表。
- 手动刷新同时运行多组独立查询和官方回读，可能出现部分成功、部分失败及旧 mutation 错误叠加。
- 本地发布回读、Webhook/审核状态表、SHEIN 文档状态和经营统计尚未由一个审核中心快照统一输出。

以上是代码与截图可解释的风险基线，不把它们冒充为某一个具体商品本次线上请求的最终根因；具体商品仍需使用其批次、任务、SKC/SPU、版本和 trace 做认证后只读核对。

## 6. 第 1 步结论

1. 公网首页和 API health 当前可达。
2. 公网静态首页与本地当前构建指纹一致。
3. 当前工作树必须视为用户资产，禁止清理或 reset。
4. 云端 release、容器、队列和数据库基线尚未完成，因为缺少受控源站通道；不得猜测。
5. 后续第 2 步应继续只读绘制完整同步链路；在第 14 步历史数据核对前，不得修改历史任务、回执或审核状态。
