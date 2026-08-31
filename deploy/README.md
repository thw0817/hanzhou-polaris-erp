# 云端控制服务部署说明

当前云端控制服务承载多租户、网页会话、结构化数据、加密凭证、任务状态和
经过官方验签的 Webhook 小消息。商品图片、合规实拍图、证明材料及模板图片
由浏览器使用短期签名直接上传私有对象存储；图片字节不经过 Node 控制服务。

## 1. 运行边界

- PostgreSQL、Redis、Node 控制服务和 Webhook 服务只监听服务器
  `127.0.0.1`。
- Nginx 是唯一公网入口。
- 公网开放 `/health`、设备会话接口以及 `/v1/shein/auth/start`、
  `/v1/shein/auth/complete`；启用 Webhook 后额外开放
  `/webhooks/shein` 和 `/webhooks/shein/test`。
- `/ready` 只供服务器本机和 Docker 健康检查使用。
- Webhook 独立监听 `127.0.0.1:8791`，只有显式启用 Compose
  `webhook` profile 后才启动。
- 浏览器不会获得云端访问令牌；令牌只由本机 Node 代理加密保存和发送。

## 2. 配置

生产配置保存在：

```text
/opt/shein-console/shared/.env
```

文件权限必须为 `600`。至少包含：

```text
POSTGRES_PASSWORD=<随机强密码>
SHEIN_RUNTIME_DATABASE_URL=postgres://<runtime用户>:<独立密码>@postgres:5432/shein_console
SHEIN_MIGRATION_DATABASE_URL=postgres://<migration owner>:<独立密码>@postgres:5432/shein_console
SHEIN_RUNTIME_MODE=cloud
SHEIN_APP_ID=<应用ID>
SHEIN_APP_SECRET=<应用密钥>
SHEIN_API_BASE_URL=https://openapi.sheincorp.cn
SHEIN_AUTHORIZATION_HOST=openapi-sem.sheincorp.com
SHEIN_DESKTOP_REDIRECT_URL=http://127.0.0.1:8787/api/shein/auth/callback
REDIS_URL=redis://127.0.0.1:6379
SHEIN_CLOUD_ENCRYPTION_KEY=<32字节随机密钥>
SHEIN_CLOUD_ALLOWED_ORIGINS=https://app.hanzhou.icu
SHEIN_WEB_COOKIE_NAME=shein_web_session
SHEIN_WEB_COOKIE_SECURE=true
SHEIN_MEDIA_STORAGE_PROVIDER=s3
SHEIN_MEDIA_S3_ENDPOINT=https://<存储桶域名>
SHEIN_MEDIA_S3_REGION=ap-hongkong
SHEIN_MEDIA_S3_BUCKET=<私有存储桶名称>
SHEIN_MEDIA_S3_ACCESS_KEY_ID=<仅服务器保存>
SHEIN_MEDIA_S3_SECRET_ACCESS_KEY=<仅服务器保存>
SHEIN_MEDIA_MAX_UPLOAD_BYTES=20971520
SHEIN_MEDIA_CLEANUP_INTERVAL_MS=900000
SHEIN_MEDIA_CLEANUP_BATCH_SIZE=100
SHEIN_STORE_BUSINESS_REFRESH_ENABLED=false
SHEIN_STORE_BUSINESS_REFRESH_CONCURRENCY=1
SHEIN_STORE_BUSINESS_SCHEDULER_ENABLED=false
SHEIN_STORE_BUSINESS_SCHEDULE_INTERVAL_MS=900000
SHEIN_RULE_REFRESH_ENABLED=false
SHEIN_RULE_REFRESH_CONCURRENCY=1
SHEIN_RULE_REFRESH_TARGET_CONCURRENCY=4
SHEIN_RULE_REFRESH_SCHEDULE_ENABLED=false
SHEIN_RULE_REFRESH_SCHEDULE_INTERVAL_MS=60000
SHEIN_RULE_REFRESH_SCHEDULE_DAY=1
SHEIN_RULE_REFRESH_SCHEDULE_START_HOUR=3
SHEIN_RULE_REFRESH_SCHEDULE_END_HOUR=4
SHEIN_RULE_REFRESH_SCHEDULE_TIME_ZONE=Asia/Shanghai
SHEIN_COMPLIANCE_SYNC_ENABLED=false
SHEIN_COMPLIANCE_SYNC_CONCURRENCY=1
SHEIN_WEBHOOK_INGRESS_ENABLED=false
SHEIN_WEBHOOK_VERIFICATION_MODE=shein-direct
SHEIN_WEBHOOK_MAX_CLOCK_SKEW_MS=300000
```

桌面端通过本地代理连接，不需要配置 CORS。生产密钥不得写入部署包或 Git。
两条 PostgreSQL URL 必须按 `deploy/postgres/runtime-role-hardening.md` 人工准备并通过只读角色审计；
不得把 migration owner URL 交给长期运行服务。
正式启用 Webhook 前把 `SHEIN_WEBHOOK_INGRESS_ENABLED` 改为 `true`。
经营数据刷新和定时调度也默认关闭；完成只读接口验收后，先启用刷新总开关，
再按需启用调度开关。
规则刷新同样默认关闭；执行 `023_shein_rule_snapshots.sql` 迁移并完成只读接口
验收后，才可设置 `SHEIN_RULE_REFRESH_ENABLED=true`。
如需每月自动全量刷新类目属性 Schema，另设置
`SHEIN_RULE_REFRESH_SCHEDULE_ENABLED=true`。调度默认在每月 1 日
Asia/Shanghai 03:00–04:00 扫描当前全部有效店铺；日期和时间窗口可配置，且同一月份
已经发起过的全量任务不会重复创建。
合规同步同样默认关闭；它只读取数据库已有 SKC，并在两个合规来源完整返回时
替换该 SKC 的旧记录。完成只读接口验收后，才可设置
`SHEIN_COMPLIANCE_SYNC_ENABLED=true`。

## 3. 首次启动或版本升级

进入当前版本：

```bash
cd /opt/shein-console/current
```

### 3.0.1 原子 release 切换的制品与权限门禁

完整 release 包必须在干净 revision 上生成，并先在独立候选目录审计；不要把仅含 `dist-v2` 的前端包当作控制服务升级包。

1. macOS 打包前必须禁用扩展属性：`COPYFILE_DISABLE=1 COPY_EXTENDED_ATTRIBUTES_DISABLE=true tar ...`。Linux 解包后必须确认 `find <candidate> -name '._*' -type f` 没有输出，否则拒绝该候选包。
2. 候选包不得包含真实 `.env`、`.git`、`node_modules`、数据库数据或运行时缓存；共享配置仍只从 `/opt/shein-console/shared/.env` 以只读方式加载。
3. 创建 release 根目录时使用 `install -d -m 755 <release>`；切换 `current` 软链接前复核该目录为 `755`。不要递归放宽文件权限，Nginx 只需要穿透 release 根目录并读取已审计的静态制品。
4. 在宿主机 Node 版本低于项目固定版本时，使用 `node:24.16.0-alpine` 隔离容器执行候选制品审计；不能用旧宿主机 Node 的失败结果绕过或伪造审计。
5. 只有候选完整 manifest、release audit、`/health`、`/ready`、公网网页 hash 与未登录网页会话边界全部通过后，才能保留切换；任一失败立即恢复旧 `current` 和旧控制服务镜像。

计划切换 V2 前，先按 `deploy/v2-release-readiness.md` 对候选 release、候选 `dist-v2`、目标数据库和
`shein_runtime` 执行只读门禁。门禁未返回 `READY` 时不得执行迁移或切换静态站点；门禁通过也不代表
迁移、上线或商品发布已经获得授权。

构建控制服务：

```bash
sudo docker compose \
  --env-file /opt/shein-console/shared/.env \
  -f deploy/docker-compose.cloud.yml \
  build control
```

先执行数据库迁移。迁移具有校验和且可重复运行：

涉及 `028_compliance_preflight_reviews.sql` 时，先按
`deploy/migrations/028_compliance_preflight_reviews.md` 执行专属预检、验证和回滚门禁。

涉及 `029_compliance_audit_immutability.sql` 时，先按
`deploy/migrations/029_compliance_audit_immutability.md` 执行专属预检、验证和空表回滚门禁。

```bash
sudo docker compose \
  --env-file /opt/shein-console/shared/.env \
  -f deploy/docker-compose.cloud.yml \
  run --rm --build migration
```

迁移完成后、启动任何长期服务前，按
`deploy/postgres/runtime-role-hardening.md` 执行只读 runtime role 审计。该命令同时验证角色边界和
静态能力矩阵中的表、序列权限覆盖：

维护窗口的备份点、静态基线、角色准备、审计结果和上线决策使用
`deploy/postgres/runtime-role-acceptance-record.md` 的副本记录；填写后的记录存入受控变更系统，
不得提交回代码仓库。

```bash
sudo docker compose \
  --env-file /opt/shein-console/shared/.env \
  -f deploy/docker-compose.cloud.yml \
  run --rm --build runtime-database-audit
```

再启动或更新服务：

```bash
sudo docker compose \
  --env-file /opt/shein-console/shared/.env \
  -f deploy/docker-compose.cloud.yml \
  up -d
```

对象存储配置和跨域规则验证完成后，启动图片清理任务：

```bash
sudo docker compose \
  --profile media \
  --env-file /opt/shein-console/shared/.env \
  -f deploy/docker-compose.cloud.yml \
  up -d
```

Webhook 代码和 HTTPS 路由验证完成后，再显式启动 Webhook 服务：

```bash
sudo docker compose \
  --profile webhook \
  --env-file /opt/shein-console/shared/.env \
  -f deploy/docker-compose.cloud.yml \
  up -d
```

只读经营数据刷新验收完成后，设置
`SHEIN_STORE_BUSINESS_REFRESH_ENABLED=true`，然后仅启动经营数据刷新 Worker：

```bash
sudo docker compose \
  --profile sync \
  --env-file /opt/shein-console/shared/.env \
  -f deploy/docker-compose.cloud.yml \
  build store-business-refresh-worker

sudo docker compose \
  --profile sync \
  --env-file /opt/shein-console/shared/.env \
  -f deploy/docker-compose.cloud.yml \
  up -d --no-deps store-business-refresh-worker
```

先保持 `SHEIN_STORE_BUSINESS_SCHEDULER_ENABLED=false`，由网页按钮按店铺手动创建只读刷新任务。
需要每15分钟自动刷新活跃授权店铺时，再设置
`SHEIN_STORE_BUSINESS_SCHEDULER_ENABLED=true`，并重启该 Worker：

```bash
sudo docker compose \
  --profile sync \
  --env-file /opt/shein-console/shared/.env \
  -f deploy/docker-compose.cloud.yml \
  up -d
```

如果要启用“商品属性规则同步”和“合规同步”按钮，还需在同一份 `.env` 中设置：

```text
SHEIN_RULE_REFRESH_ENABLED=true
SHEIN_COMPLIANCE_SYNC_ENABLED=true
```

然后启动三个只读同步 Worker（不要启动 `image` profile）：

```bash
sudo docker compose \
  --profile sync \
  --env-file /opt/shein-console/shared/.env \
  -f deploy/docker-compose.cloud.yml \
  up -d --no-deps \
  store-business-refresh-worker \
  rule-refresh-worker \
  compliance-sync-worker
```

这三个 Worker 只读取官方数据并保存本地快照、规则或合规缓存；它们不会执行商品发布。生图执行开关仍必须保持关闭。

### 3.1 商品真实发布 Worker（默认关闭）

商品发布不是 `sync` profile 的一部分。首次开放前必须先完成
`deploy/migrations/034_publish_execution_enablement.md` 的预检、迁移、验证和 runtime
权限审计，并完成单商品维护窗口审批。控制服务与发布 Worker 必须使用同一开关：

```text
SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED=true
SHEIN_PRODUCT_PUBLISH_CONCURRENCY=1
SHEIN_OUTBOX_DISPATCHER_ENABLED=true
```

随后重建控制服务，并仅启动独立的 `publish` profile：

```bash
sudo docker compose \
  --profile publish \
  --env-file /opt/shein-console/shared/.env \
  -f deploy/docker-compose.cloud.yml \
  up -d --no-deps --force-recreate \
  control outbox-dispatcher product-publish-worker
```

`outbox-dispatcher` 与 `product-publish-worker` 必须一起启动；只开启商品发布开关
或只启动其中一个服务都会被门禁拒绝。两项开关默认都为 `false`，在 ERP-06
完整生产门禁通过前不得修改为 `true`。

不要先开启控制服务后再等待 Worker，也不要把并发直接调高。网页只有在控制服务门禁开启时才显示最终提交能力；用户仍需核对冻结载荷并消费一次性授权。Worker 只接收租户、店铺和执行 ID，从数据库读取精确冻结候选；成功响应后仍须等待平台回执、商品状态回读和合规复验，不能把请求已接受当成最终完成。

停止新的真实发布时，先将开关恢复为 `false` 并重建控制服务，再等待正在运行的 Worker 完成或进入可审计状态，最后停止 `product-publish-worker`。不得删除 `result_unknown`、失败任务或发布回执来制造完成状态。

检查服务器内部状态：

```bash
curl -i http://127.0.0.1:8790/health
curl -i http://127.0.0.1:8790/ready
curl -i http://127.0.0.1:8791/health
```

三个地址都应返回 `200`。控制服务 `/ready` 会实际检查 PostgreSQL
与 Redis；Webhook `/health` 会显示 `verificationMode=shein-direct`。

对象存储桶必须保持私有，并允许 `https://app.hanzhou.icu`：

- `PUT`、`HEAD`
- 请求头 `Content-Type`
- 浏览器可读取响应头 `ETag`

不要给浏览器长期访问密钥。网页只会收到10分钟有效的单文件上传地址；
上传完成后控制服务会用服务器密钥执行 `HEAD` 校验。清理任务每15分钟扫描
一次，先进入7天恢复期，再删除对象存储中的文件。合规证据和已被商品、
模板、发布任务引用的图片不会自动删除。

## 4. Nginx 公网路由

将 [shein-api-secure-routes.conf.example](nginx/shein-api-secure-routes.conf.example)
中的 `location` 合并到 `api.hanzhou.icu` 的 HTTPS `server` 块。不要覆盖
Certbot 生成的证书路径，也不要修改服务器现有 `/wow/`、`/fangguo/` 服务。

所有代理路径必须设置：

```nginx
proxy_set_header X-Real-IP $remote_addr;
```

控制服务和 Webhook 服务分别只监听 `127.0.0.1:8790`、`127.0.0.1:8791`，
因此只有本机 Nginx 能转发公网请求。公网不得直接开放这两个端口。

公网验收：

```bash
curl -i https://api.hanzhou.icu/health
curl -i https://api.hanzhou.icu/ready
curl -i https://api.hanzhou.icu/v1/session
curl -i -X POST https://api.hanzhou.icu/v1/shein/auth/start \
  -H 'Content-Type: application/json' \
  --data '{"installationId":"","deviceName":""}'
curl -i https://api.hanzhou.icu/images
curl -i https://api.hanzhou.icu/webhooks/shein
curl -i https://api.hanzhou.icu/webhooks/shein/test
```

期望结果依次为：

- `/health`: `200`
- `/ready`: `404`
- 未带令牌的 `/v1/session`: `401`
- 空参数 `/v1/shein/auth/start`: `400`；若应用凭证未配置则 `503`
- `/images`: `404`
- 对两个 Webhook 地址发 GET：`404`，只允许 SHEIN 发来的签名 POST

## 5. 普通用户自动授权

普通用户不再输入设备连接码：

1. 本地 Node 请求 `/v1/shein/auth/start`。
2. 云端只保存 state 和安装 ID 的 SHA-256 哈希。
3. SHEIN 授权后回到本机
   `http://127.0.0.1:8787/api/shein/auth/callback`。
4. 本地 Node 请求 `/v1/shein/auth/complete`。
5. 云端换取店铺凭证、加密入库并签发设备会话。
6. 店铺凭证和设备令牌只通过 TLS 返回本地 Node，浏览器只收到公开状态。

首次授权创建工作空间；已连接设备再次授权新店时复用当前工作空间。

## 6. 创建一次性设备连接码

首次为一个客户/公司建立工作空间：

```bash
sudo docker compose \
  --env-file /opt/shein-console/shared/.env \
  -f /opt/shein-console/current/deploy/docker-compose.cloud.yml \
  run --rm control npm run cloud:provision-device -- \
  --tenant-name "测试工作空间" \
  --hours 24
```

终端只显示一次连接码。把连接码输入本地软件“店铺与系统 > 云端设备连接”，
不要截图、发群或写入配置文件。

同一工作空间增加第二台电脑时，必须复用第一次命令返回的租户 ID：

```bash
sudo docker compose \
  --env-file /opt/shein-console/shared/.env \
  -f /opt/shein-console/current/deploy/docker-compose.cloud.yml \
  run --rm control npm run cloud:provision-device -- \
  --tenant-id "<已有租户ID>" \
  --hours 24
```

连接码使用一次后立即失效。云端数据库只保存连接码和访问令牌的 SHA-256
哈希，不保存明文。

该方式只作为“管理员备用连接”。

## 7. Webhook 接收与启用

当前接收器已经实现：

- 正式地址：`https://api.hanzhou.icu/webhooks/shein`
- 测试地址：`https://api.hanzhou.icu/webhooks/shein/test`
- `multipart/form-data`、表单字段 `eventData`
- `x-lt-appid`、`x-lt-timestamp`、`x-lt-signature` 应用级验签
- 5 分钟时间窗口和 Redis 单次签名防重放
- `eventData` 使用应用密钥进行 AES-128-CBC 解密
- 按 `x-lt-openKeyId` 查找店铺和租户
- 生产/测试来源隔离去重、PostgreSQL 落库和 BullMQ 入队
- 解密后未标准化的原始 JSON 与标准化 JSON 分开保存
- 第一次 Redis 入队失败后，SHEIN 重试可恢复入队

multipart 密文、签名、店铺 openKeyId Header 和应用密钥不会写入 Webhook
事件记录。未知但合法的事件编码会先保存，避免平台新增事件时直接丢消息；
Worker 业务投影器仍需按事件逐类实现。

正确链路：

```text
SHEIN -> Nginx HTTPS -> 官方应用级验签/解密 -> 幂等落库 -> 队列 -> Worker
```

启用前：

1. 确认服务器时间同步正常。
2. 设置 `SHEIN_WEBHOOK_INGRESS_ENABLED=true` 和
   `SHEIN_WEBHOOK_VERIFICATION_MODE=shein-direct`。
3. 使用 `--profile webhook` 启动服务。
4. 合并两个 Nginx 精确路由并执行 `nginx -t`。
5. 先在 SHEIN 控制台保存测试地址并完成平台验证。
6. 只订阅一个低风险事件，确认落库与重复通知行为后再逐步增加订阅。

平台要求约 1.5 秒内返回，接收器只进行验签、解密、落库和入队，不在请求中
执行商品、采购或合规同步。

## 8. 4GB 单机边界

- PostgreSQL 内存上限约 1.2GB，Redis 256MB，控制服务 256MB，
  Webhook 服务 192MB。
- Redis 使用 `noeviction`，压力异常时显式失败，不能静默丢任务。
- 每日数据库备份保留 14 天，并定期做恢复演练。
- 图片不经过云服务器内存、磁盘或带宽。
- 活跃店铺接近 100 家、数据库接近 20GB、持续内存超过 75% 或接口 P95
  超过 1 秒时，迁移托管数据库或升级服务器。
