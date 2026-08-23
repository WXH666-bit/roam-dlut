# 此地有话 · roam-dlut

> 把留言藏在校园的真实地理位置上。没有地图，没有提示——只有走到那条留言 50 米以内，它才会浮现。

「此地有话」是一款面向大连理工大学学生的校园地理留言 App（Android）。任何人都可以在某个位置藏下一句话、一张照片或一段视频；每条留言存活 30 天，或被读满 99 人，任一条件到达即永久消散。它是写给陌生人的信、藏在校园里的彩蛋、稍纵即逝的偶遇——机不可失。

## 核心玩法

- **守候**：主界面只显示"此刻，校园里有 N 条留言正在等待"，没有任何位置信息
- **偶遇**：走到某条未读留言 50m 内，手机震动、风铃轻响（仅原生端），屏幕浮现一枚发光光点，点开即读
- **藏言**：在某个有感触的地方，写下 140 字以内的话，可配手绘贴纸、1 张照片或 1 段视频
- **消散**：存活满 30 天或被读满 99 人（按设备去重），留言永久消散——错过就是错过；读满瞬间，最后一位读者会看到金色光点随风散去的告别动画（仅原生端）

## 分享（藏话卡）

发布成功后（或在「我的 → 我藏下的」回看时）可点「分享这个秘密」：App 端把一张**藏话卡**（1080×1440 PNG，暗夜金光风）截图调起系统分享面板，可发到朋友圈/微信/任意目标。

卡片上只有悬念，没有剧透——**严格不出现留言正文、坐标与任何位置线索**，只有"我在大工的某个角落，藏了一句话 / 走近 50 米，才能遇见它"和花名落款。这是产品红线，改卡片文案时不得破坏。

Web 端降级：优先 `navigator.share`，不可用时展示预填文案 + 一键复制（卡片图仅 App 端生成）。分享取消/失败一律静默，不影响发布主流程。

## 技术栈

| 端 | 技术 |
|---|---|
| App（`client/`） | Expo 54 · React Native · Expo Router · Uniwind(Tailwind v4) · Reanimated |
| 后端（`server/`） | Express · tsx · 数据层可切换（默认内存 + JSON 持久化，设 `DATABASE_URL` 走 MySQL）· 存储层可切换（默认开发态对象存储，设 `STORAGE_PROVIDER=qiniu` 走七牛 Kodo） |
| 包管理 | pnpm workspace monorepo |

## 快速开始

```bash
# 1. 安装依赖（必须用 pnpm）
pnpm install

# 2. 配置 App 端后端地址
cp client/.env.example client/.env

# 3. 同时启动后端与 App（两个进程）
pnpm dev
```

- 后端：`http://localhost:9091`（健康检查 `GET /api/v1/health`）
- App：`http://localhost:8081`（Expo DevTools；手机装 Expo Go 扫码，或 `pnpm --filter=./client exec expo run:android` 真机运行）

> 后端首次启动会自动播种 40 条校园种子留言（分布在大连理工大学各真实地标附近，含图片与短视频样例）。

## 开发者模式（演示模式）

偶遇依赖真实 GPS，在模拟器、网页或答辩现场无法走动时，用演示模式虚拟定位：

1. 打开 App，点右上角进入「**我的**」
2. 滑到页面底部，找到版本号文字「**此地有话 v1.0.0 · 写给陌生人的信**」
3. **连续点击版本号 5 次**，开启演示模式
4. 屏幕右侧出现虚拟定位面板：
   - 顶部显示当前模拟坐标
   - **方向按钮**：按步长微调经纬度（单档步长 0.00025° ≈ 25–30 米，逐步逼近即可）
   - **「跳到留言旁」列表**：一键把模拟位置设到某条存活留言的 50m 范围内——走到留言 50 米内即偶遇浮现（震动 + 光点 + 开信全流程）
   - **「演示一次消散」**：不删任何数据，直接在主屏播一遍消散告别动画（答辩演示用）
5. 面板内可随时**关闭演示模式**，恢复真实 GPS

## 常用命令

```bash
pnpm dev            # 同时起后端(9091) + Expo
pnpm validate       # 前后端 TypeScript + ESLint 全量检查
pnpm lint:client    # 仅 App 端检查
pnpm lint:server    # 仅后端检查
```

## 后端配置（环境变量）

所有开关均可不设——不设时就是本地开发态行为（内存存储 + 开发态对象存储 + 免 token）。

| 变量 | 默认 | 说明 |
|---|---|---|
| `MESSAGE_READ_LIMIT` | `99` | 读满人数上限，达到即消散（验收时可调小，如 `3`） |
| `MESSAGE_TTL_DAYS` | `30` | 存活天数，到期消散 |
| `MESSAGE_DAILY_LIMIT` | `3` | 每设备每日发布上限 |
| `PORT` | `9091` | 后端监听端口 |
| `STORAGE_PROVIDER` | 开发态内置存储 | 设为 `qiniu` 时切换为七牛 Kodo（需同时设下方 4 个变量） |
| `QINIU_S3_ENDPOINT` | — | Kodo 的 S3 兼容端点，如 `s3.cn-east-1.qiniucs.com`（可不带 `https://`） |
| `QINIU_ACCESS_KEY` | — | 七牛账号 AK |
| `QINIU_SECRET_KEY` | — | 七牛账号 SK |
| `QINIU_BUCKET` | — | Kodo 空间名 |
| `DATABASE_URL` | 内存 + JSON | MySQL 连接串，如 `mysql://user:pass@host:3306/cidi`；设置后数据走 MySQL |
| `SERVER_SECRET` | 不校验 | 设置后注册接口签发设备 token，开信/点赞须带 `x-device-token` 头（轻量防刷） |

## 部署到七牛云

> 目标形态：后端跑在七牛云服务器（Node.js + MySQL + Kodo），App 构建 Release APK 指向公网后端。

**1. 建库建表**

```bash
mysql -h <mysql-host> -u <user> -p <database> < server/migrate.sql
```

`migrate.sql` 只做 `CREATE TABLE IF NOT EXISTS`（users / messages / message_readers / message_likes），重复执行安全；首次启动时后端也会自动建表，并**在空库时自动播种 40 条种子留言**。

**2. 配置环境变量并启动后端**

```bash
cd server
pnpm install
pnpm build   # 产出 dist/

# 必配（七牛三件套 + 数据库 + 防刷密钥）
export STORAGE_PROVIDER=qiniu
export QINIU_S3_ENDPOINT=s3.<区域>.qiniucs.com
export QINIU_ACCESS_KEY=<七牛AK>
export QINIU_SECRET_KEY=<七牛SK>
export QINIU_BUCKET=<空间名>
export DATABASE_URL=mysql://<user>:<pass>@<mysql-host>:3306/<database>
export SERVER_SECRET=<随机长字符串>   # 如 openssl rand -hex 32

# 可选调参（默认值见上表）
# export MESSAGE_READ_LIMIT=99 MESSAGE_TTL_DAYS=30 MESSAGE_DAILY_LIMIT=3

PORT=9091 pnpm start
```

注意：
- `STORAGE_PROVIDER=qiniu` 下后端完全不加载开发态 SDK，离开本开发环境也能跑
- 上传链路不变：App 仍 `POST /api/v1/upload`（multipart，单文件 ≤120MB，超限返回 413），由服务端中转写入 Kodo；读取时实时生成 7 天有效的签名 URL
- `SERVER_SECRET` 一旦上线就不要再改，否则所有已安装设备的 token 立即失效

**3. 构建 App（指向公网后端）**

```bash
cd client
EXPO_PUBLIC_BACKEND_BASE_URL=https://<你的后端域名> pnpm exec expo run:android --variant release
# 或用 EAS：EXPO_PUBLIC_BACKEND_BASE_URL=https://<你的后端域名> eas build -p android
```

本地开发不用管这一步——`client/.env` 里的 `http://localhost:9091` 就是默认值，代码里也内置了同样的兜底。

## CI 打包（GitHub Actions 自动出 APK）

仓库带 `.github/workflows/android.yml`：push 到 `main` 自动构建，也可在 Actions 页面手动触发（Run workflow），产物是可直接安装的 APK。

**1. 先配置后端地址变量（只配一次）**

仓库 **Settings → Secrets and variables → Actions → Variables → New repository variable**：

- Name：`BACKEND_BASE_URL`
- Value：后端公网地址，如 `http://<公网IP>:9091`

> 没配这个变量时 workflow 会**立即失败**并提示——这是故意的，防止打出指向 localhost 的废包。该变量在打包时编译期内联进 App，改地址后重新跑一次 workflow 即可。

**2. 取包**

push 或手动触发后，进 **Actions** 页面对应的运行记录，底部 Artifacts 下载 `cidi-apk-r<编号>`，解压即得 APK，直接安装到 Android 手机。

**3. 签名说明**

demo 期 APK 用 Expo 模板自带的 debug keystore 签名（能装能跑，应用商店不收）；决赛发布前再换正式签名（`client/android/app/build.gradle` 配 release signingConfig 或改走 EAS Build）。

## API 概览（前缀 `/api/v1`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/users` | 设备注册，返回匿名花名（幂等） |
| PATCH | `/users/me` | 修改花名（仅一次） |
| GET | `/users/me` | 我的发布（含已消散全文）+ 我的足迹（已消散仅留记录） |
| GET | `/messages` | 存活留言列表（仅 id/坐标/时间，总数即列表长度） |
| GET | `/messages/:id` | 开信读全文；服务端按 device_id 去重计数，读满即消散 |
| POST | `/messages` | 发布留言；服务端做敏感词校验 + 每日限额 |
| POST | `/messages/:id/like` | 点赞（解锁后可点一次，幂等） |
| POST | `/upload` | 图片/视频上传（multipart，≤120MB），返回存储 key 与访问 URL |

> 服务端设了 `SERVER_SECRET` 时：`POST /users` 响应会多一个 `token` 字段，之后开信与点赞须带请求头 `x-device-token: <token>`，否则 401。App 端已自动处理（注册时保存并回传）。

## 目录结构

```
client/                 # Expo App
├── app/                # 路由（index=守候主界面, compose=写留言, profile=我的）
├── screens/            # 页面实现（与路由一一对应）
├── components/         # 光点/开信动画/贴纸/夜空背景/演示面板等
├── contexts/           # 全局状态（设备、位置、留言缓存）
├── utils/              # API 封装、Haversine、贴纸注册表
server/                 # 后端
├── src/routes/         # users / messages / upload
├── src/seeds.ts        # 40 条种子留言
├── src/store/          # 数据层（index=接口与切换, memoryStore, mysqlStore）
├── src/storage/        # 存储层（index=接口与切换, cozeProvider, qiniuProvider）
├── src/auth.ts         # 设备 token 签发与校验（SERVER_SECRET 开关）
└── migrate.sql         # MySQL 建表脚本（部署七牛时执行）
```

## 设计文档

视觉基调、配色、动效规范见 [DESIGN.md](./DESIGN.md)。
