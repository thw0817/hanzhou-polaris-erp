# SHEIN 全托运营助手

面向 SHEIN 全托管商家的本地浏览器版本。当前界面已移除业务演示数据：尚未接入真实接口的模块统一显示空状态。

商品模板按授权店铺隔离保存到 `.data/shein-templates.v1.json`。模板只记录用户选择的真实 SHEIN 属性值、单品填写策略、发布字段规则和图片规则，不会在保存模板时提交商品。

## 本地运行

```bash
npm install
npm run dev
```

浏览器访问：`http://127.0.0.1:5173/`

该命令会同时启动 Vite 网页和 `127.0.0.1:8787` 本地安全代理。

生产构建：

```bash
npm run build
```

## 真实连接

普通安装用户不需要在本机配置应用密钥：

1. 复制 `.env.example` 为 `.env`，确认 `SHEIN_CLOUD_API_BASE_URL` 指向云端。
2. 在“店铺与系统”中填写当前电脑名称。
3. 点击“授权店铺并连接当前电脑”。
4. 使用 SHEIN 商家主账号授权；平台回到本机 Node loopback 回调。
5. 云端自动创建或复用工作空间、店铺和设备会话。
6. 授权后点击“测试连接”，软件会调用只读接口
   `/open-api/goods/query-category-tree` 验证网关、签名、密钥和接口权限。

开发调试仍可在本机配置应用凭证或直接注入已解密的店铺凭证：

```bash
SHEIN_APP_ID="..." \
SHEIN_APP_SECRET="..." \
SHEIN_STORE_OPEN_KEY_ID="..." \
SHEIN_STORE_SECRET_KEY="..." \
npm run dev
```

需要在本地浏览器直接完成真实 SHEIN 授权和只读经营同步时，使用本机直连模式：

```bash
SHEIN_APP_ID="..." \
SHEIN_APP_SECRET="..." \
npm run dev:local:direct
```

授权回调会回到 `http://127.0.0.1:5173/`，由本机代理调用
`/api/shein/auth/exchange`，然后商品、销量、库存和合规读取均使用已授权店铺的
本机只读接口。该模式不需要 PostgreSQL、Redis 或云端设备会话；真实发布和
SHEIN 写接口仍保持关闭。

V2 本地页面的真实只读验收模式使用：

```bash
SHEIN_APP_ID="..." \
SHEIN_APP_SECRET="..." \
npm run dev:v2:real-local
```

浏览器地址为 `http://127.0.0.1:5174/`。该命令同时启动本地授权代理、V2
真实只读适配服务和 V2 页面；授权后的商品、销量、库存、货架状态和合规读取
均从 SHEIN 实际接口获取并保存在本机。默认的 `npm run dev:v2:local` 仍是空数据
演示模式，云端部署不受该模式影响。

本地真实模式需要保持该命令所在的终端持续运行；推荐在独立终端启动，避免关闭
当前开发终端后网页端口 `5174`、桥接端口 `8790` 和授权代理端口 `8787` 一起退出。

### 本地单 SKC 实拍图真实提交

实拍图真实提交默认关闭。只在本机 `.env` 中同时设置以下两项后，重启
`npm run dev:v2:real-local` 才会开放：

```dotenv
SHEIN_COMPLIANCE_WRITES_ENABLED=true
SHEIN_COMPLIANCE_CONFIRMATION_SECRET=<本机随机长字符串>
```

进入单个 SKC 合规页后，上传商品本体图或包装图并先保存资料；页面没有未保存修改时，点击“提交实拍图审核”并确认。程序会先调用官方实拍图上传接口，再把包装图写入 `packageLableList`、商品本体图写入 `bodyLableList`，绑定成功后启动当前 SKC 合规状态同步。

这条本地链路不会修改云端服务器。SHEIN 当前文档没有提供历史图片删除字段，也没有承诺重新绑定会覆盖原图，因此页面只报告“绑定请求已接收”，不宣称旧图已经删除或覆盖。

`.env` 和 `.data/` 已被 Git 忽略。浏览器不会收到 `APP_SECRET`、店铺
`secretKey` 或请求签名。每个店铺的独立凭证使用随机本地密钥和
AES-256-GCM 加密后持久化；旧版 APP_SECRET 派生保险库会自动迁移到 v2。

## 当前原型

- 真实授权店铺列表与多店铺切换
- 真实类目树、类目属性和发布字段规范读取
- 商品、销量、合规和任务模块的真实数据空状态
- 商品工作台：搜索、状态筛选、单个处理、批量处理入口
- SKC 智能识别接口编排入口，不生成模拟识别结果
- 商品模板库与合规模板库
- 从 SHEIN 当前店铺的末级类目、属性和发布字段自建商品模板
- 通过参照 SKC 读取当前合规要求并自建合规模板
- 使用商品文件夹进行单个发品，或按子文件夹批量发品
- 自动归类主图、详情图、色块图与 SKU 图，SKU 图缺失时可引用主图
- 本地读取图片尺寸和大小，按 SHEIN 图片类型规范阻断不合格商品
- 商品级图片映射编辑器，可修正图片槽位而不修改本地原文件
- 合规矩阵：证书、代理公司、警告语、包装实拍图、本体实拍图
- 批量识别、文件夹批量建品、批量合规任务框架
- 真实任务接入后的进度、失败项和重试入口
- 桌面、平板、手机响应式布局

明确不在范围内：条码、箱唛、物流面单及其他打印功能。

推荐图片命名前缀：`main_`、`detail_`、`square_`、`swatch_`、
`description_`、`sku_`。未命中的图片默认识别为主图，提交前仍需人工确认。

## 实现约束

- SHEIN 密钥不会写入浏览器包；本地联调通过 Git 忽略的环境变量注入代理进程。
- 所有提交前先查询店铺、类目、属性及合规动态规则。
- 批量任务按每个接口的单次上限和 QPS 独立拆分。
- Webhook 只作为增量触发，关键状态仍由查询接口对账。
- 实拍图在本地完成格式校验，正式架构中使用短时上传凭证直传 SHEIN。

详细设计见 [SHEIN_INTEGRATION_BLUEPRINT.md](./docs/SHEIN_INTEGRATION_BLUEPRINT.md)。

## 可选云端基础

项目已加入独立的 PostgreSQL、Redis/BullMQ 和 Webhook 基础模块，默认
`SHEIN_RUNTIME_MODE=local`，不会连接云端服务，也不会改变当前本地测试数据。

官方 Webhook 接收器支持：

- `POST /webhooks/shein`：正式回调。
- `POST /webhooks/shein/test`：测试回调。
- SHEIN `multipart/form-data` 的 `eventData`。
- 应用级 `APP_ID`/`APP_SECRET` 验签、5 分钟时间窗口和 Redis 防重放。
- AES-128-CBC 解密、店铺归属、幂等落库和 BullMQ 入队。

Webhook 服务默认仍不随 Compose 启动；部署时需显式启用 `webhook` profile。

云端部署示例与安全门说明见 [deploy/README.md](./deploy/README.md)，完整容量
与本地/云端职责边界见
[CLOUD_DEPLOYMENT_ARCHITECTURE.md](./docs/CLOUD_DEPLOYMENT_ARCHITECTURE.md)。
