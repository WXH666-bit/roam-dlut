# Here · roam-dlut

> 把留言藏在校园的真实地理位置上。没有地图，没有提示——只有走到那条留言 50 米以内，它才会浮现。

「Here」是一款面向大连理工大学学生的校园地理留言 App（Android / iOS）。任何人都可以在某个位置藏下一句话、一张照片、一段两分钟以内的视频，或一段现场录音/已有音乐；每条留言存活 30 天，或被读满 99 人，任一条件到达即永久消散。它是写给陌生人的信、藏在校园里的彩蛋、稍纵即逝的偶遇——机不可失。

## 核心玩法

- **守候**：主界面只显示"此刻，校园里有 N 条留言正在等待"，没有任何位置信息
- **偶遇**：走到某条未读留言 50m 内，手机震动、风铃轻响（仅原生端），屏幕浮现一枚发光光点，点开即读
- **藏言**：在某个有感触的地方，写下 140 字以内的话，可配手绘贴纸、1 张照片、1 段两分钟以内的视频或 1 段录音/音乐
- **消散**：存活满 30 天或被读满 99 人（按设备去重），留言永久消散——错过就是错过；读满瞬间，最后一位读者会看到金色光点随风散去的告别动画（仅原生端）

## 后台守候与互动通知

- **Android（含荣耀 90 Pro）**：使用系统 `LocationManager` 的前台守候服务，不依赖 Google Play Services；通知栏会长期保留一条低优先级「正在守候」通知。App 不在前台时，每约 30 秒检查附近未读留言和新的点赞事件。
- **iOS**：申请「始终允许」定位，使用后台位置更新，并注册最多 20 个最近未读留言的地理围栏；点赞离线通知通过 Expo Push Service / APNs 发送。
- **隐私**：锁屏通知只携带事件类型和留言 ID，不展示留言正文、坐标或点赞者身份。
- **系统限制**：Android 被用户在系统设置中“强行停止”或手机重启后，服务必须再次打开 App 才能恢复；iOS 被用户明确强制退出后，系统也可能暂停后台唤醒，需再次打开 App 恢复。
- **坐标契约**：客户端、服务端存储和距离计算统一使用 WGS‑84。原生 GPS 坐标不做偏转；只有明确来自中国大陆地图的 GCJ‑02 数据才在进入系统的边界转换一次。旧版无坐标元数据的发布为滚动升级兼容而按隐含 WGS‑84 接收。
- **50 米精度门槛**：前台发布/偶遇仅使用 30 秒内且水平精度不超过 30 米的实时位置；Android/iOS 后台通知仅使用 60 秒内且精度不超过 30 米的位置。

荣耀 / MagicOS 真机首次安装后，建议在系统设置中确认：通知已开启、位置为「始终允许」，并在「应用启动管理 / 电池优化」中允许自启动、关联启动和后台活动。不同 MagicOS 版本的菜单名称可能略有差异。

## 分享（藏话卡）

发布成功后（或在「我的 → 我藏下的」回看时）可点「分享这个秘密」：App 端把一张**藏话卡**（1080×1440 PNG，暗夜金光风）截图调起系统分享面板，可发到朋友圈/微信/任意目标。

卡片上只有悬念，没有剧透——**严格不出现留言正文、坐标与任何位置线索**，只有"我在大工的某个角落，藏了一句话 / 走近 50 米，才能遇见它"和花名落款。这是产品红线，改卡片文案时不得破坏。

Web 端降级：优先 `navigator.share`，不可用时展示预填文案 + 一键复制（卡片图仅 App 端生成）。分享取消/失败一律静默，不影响发布主流程。

## 身份与暗号找回

「Here」没有账号系统——设备即身份。为了让换手机、清缓存的人不至于永远失去自己的花名，每个用户在注册时会得到一枚**三词暗号**，形如「银杏·晚风·天台·07」（三个校园意象词 + 两位数字，词库约 60 词，组合空间约两千万）。

设计动机：这是匿名信时代的**接头暗号**，不是账号密码。抄在本子上，就能在任何一台设备上把花名认领回来——除此之外没有任何绑定（不做手机号/微信/密码，这是「轻身份」设计哲学的红线）。

- 查看暗号：「我的 → 身份与找回」，暗号以手写体金字展示，提示抄写下来
- 找回：同处输入暗号 → 确认「将切换为『某某花名』」→ 本机身份即切换为原设备，「我藏下的」与足迹随之恢复
- 老用户兼容：存量无暗号的用户在下次打开 App 时会**惰性补发**一枚（双 store 实现行为一致）
- 防爆破：`POST /users/reclaim` 按 IP 限流，每小时最多 10 次失败，超出返回 429「试太多次了，喝口水想想再来」

## 内容安全与管理员复核

- 每条新留言都会先以**隐藏待审**状态写入数据库并立即向 App 返回 `202`，再由限并发后台队列调用 `step-3.7-flash`；进程意外退出后会恢复尚未得到模型结论的任务。普通留言列表、开信接口、作者的「我的发布」都不会返回待审内容。
- 模型明确判定安全才会公开；疑似违规、模型超时、返回格式异常或暂不支持自动识别的媒体格式都会保留在管理员暂存区，绝不因模型故障默认放行。
- 上传附件先登记为一小时临时资产，发布消息时由数据层原子认领且只能使用一次；未被认领的过期附件和被管理员拒绝的附件都会由后台定时清理，失败任务保留并自动重试。
- JPG/PNG/静态 GIF/WebP 与 MP4/MOV/MKV 可直接交给多模态模型；其他视觉格式会安全降级为人工复核。MP3/WAV 会先经 StepFun ASR 转写，再由 `step-3.7-flash` 判断，其他音频格式同样转人工复核。
- 发给 StepFun 的审核请求只包含留言正文和附件，不包含坐标、设备 ID、花名或找回暗号；内测用户仍应被告知其内容会交由第三方模型处理。
- 管理员在本机打开 `http://127.0.0.1:9091/admin/moderation`，或通过 HTTPS 打开 `https://<服务器>/admin/moderation`，输入独立的 `ADMIN_SECRET` 后，可以放行、彻底删除、禁言 1/7/30 天、永久封禁或解除封禁。拒绝操作会在数据库事务中先创建媒体清理任务；对象存储临时失败时会保留任务供启动时或管理员手动重试，成功后清除其媒体 key。
- 只有管理员确认「违规并删除」后才累计一次违规。自动规则为：第 1 次仅记录，第 2 次禁言 1 天，第 3 次 7 天，第 4 次 30 天，第 5 次永久封禁；管理员可按严重程度覆盖处罚。
- 当前“设备封禁”基于 App 的匿名安装身份。清除应用数据、卸载重装或修改客户端伪造新 ID 都可能绕过；朋友内测可接受，若未来公开运营，需要再接 Android Play Integrity / iOS App Attest 或账号体系。

## 技术栈

| 端 | 技术 |
|---|---|
| App（`client/`） | Expo 54 · React Native · Expo Router · Android LocationManager 守候 · iOS 后台定位 / APNs |
| 后端（`server/`） | Express · tsx · 数据层可切换（本地 JSON / MySQL）· 媒体存储可切换（本机磁盘 / 七牛 Kodo）· 自托管签名 Expo Updates |
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

> Expo Go 可调试普通前台页面，但不包含本项目的 Android `BackgroundGuardian` 原生模块；后台守候、常驻通知和完整通知链路必须使用重新构建的开发客户端或安装包验证。

> 后端首次启动会自动播种 40 条校园种子留言（分布在大连理工大学各真实地标附近，含图片与短视频样例）。

## 开发者模式（演示模式）

偶遇依赖真实 GPS，在模拟器、网页或答辩现场无法走动时，用演示模式虚拟定位：

1. 打开 App，点右上角进入「**我的**」
2. 滑到页面底部，找到版本号文字「**Here v1.2.0 · 写给陌生人的信**」
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
pnpm ota:export -- --message "更新说明"   # 导出 Android 热更新
pnpm ota:rollback -- --message "回滚说明" # 回滚到 APK 内置版本
```

## 后端配置（环境变量）

所有开关均可不设——不设时就是本地开发态行为（内存存储 + 开发态对象存储 + 免 token）。

| 变量 | 默认 | 说明 |
|---|---|---|
| `MESSAGE_READ_LIMIT` | `99` | 读满人数上限，达到即消散（验收时可调小，如 `3`） |
| `MESSAGE_TTL_DAYS` | `30` | 存活天数，到期消散 |
| `MESSAGE_DAILY_LIMIT` | `3` | 每设备每日发布上限 |
| `PORT` | `9091` | 后端监听端口 |
| `STORAGE_PROVIDER` | 开发态内置存储 | 设为 `qiniu` 时切换为七牛 Kodo（需同时设下方 4 个变量）；设为 `local` 时落盘 `data/uploads/` |
| `PUBLIC_BASE_URL` | `http://localhost:9091` | 仅 `local` 模式用：媒体 URL 前缀，部署时配 `http://<公网IP>:9091` |
| `LOCAL_MEDIA_SIGNING_SECRET` | 复用 `SERVER_SECRET` | 本地媒体短期访问 URL 的签名密钥；两者都未设置时进程启动随机生成 |
| `MEDIA_UPLOAD_TOKEN_SECRET` | 复用 `SERVER_SECRET` | 一小时上传票据的签名密钥，用于绑定媒体 key、类型与设备身份 |
| `OTA_PUBLIC_BASE_URL` | 跟随请求地址 | OTA manifest 中资源 URL 的公网前缀，当前部署填 `http://1.92.120.33:9091` |
| `OTA_UPDATES_DIR` | `data/updates` | Expo Updates 导出产物目录；生产机推荐使用绝对路径 |
| `OTA_PRIVATE_KEY_PATH` | — | OTA RSA 签名私钥绝对路径；启用代码签名的 APK 请求更新时必配，严禁提交 Git |
| `QINIU_S3_ENDPOINT` | — | Kodo 的 S3 兼容端点，如 `s3.cn-east-1.qiniucs.com`（可不带 `https://`） |
| `QINIU_ACCESS_KEY` | — | 七牛账号 AK |
| `QINIU_SECRET_KEY` | — | 七牛账号 SK |
| `QINIU_BUCKET` | — | Kodo 空间名 |
| `DATABASE_URL` | 内存 + JSON | MySQL 连接串，如 `mysql://user:pass@host:3306/cidi`；设置后数据走 MySQL |
| `SERVER_SECRET` | 不校验 | 设置后注册接口签发设备 token，开信/点赞须带 `x-device-token` 头（轻量防刷） |
| `STEPFUN_API_KEY` | — | StepFun 服务端 API 密钥；缺失或调用失败时内容只进入人工待审，不会公开 |
| `STEPFUN_MODEL` | `step-3.7-flash` | 内容安全初审模型 |
| `STEPFUN_BASE_URL` | `https://api.stepfun.com/v1` | StepFun 中国站 API 地址 |
| `STEPFUN_TIMEOUT_MS` | `60000` | 单次审核/转写超时；最高 120 秒 |
| `MODERATION_CONCURRENCY` | `2` | 后台模型审核最大并发（最高 `8`） |
| `MODERATION_IP_HOURLY_LIMIT` | `30` | 单 IP 每小时最多创建的付费审核任务 |
| `MODERATION_GLOBAL_DAILY_LIMIT` | `500` | 单进程每日付费审核任务硬上限，防止费用失控 |
| `REGISTRATION_IP_HOURLY_LIMIT` | `20` | 单 IP 每小时最多创建的新匿名身份；已存在身份的幂等注册不计入 |
| `UPLOAD_IP_HOURLY_LIMIT` / `UPLOAD_DEVICE_HOURLY_LIMIT` | `30` / `20` | 上传预检限额，发生在大文件进入内存之前 |
| `UPLOAD_MAX_CONCURRENCY` | `2` | 单进程同时缓冲的大文件上传数（最高 `8`） |
| `MEDIA_CLEANUP_INTERVAL_MS` | `900000` | 被拒媒体与过期临时上传的自动清理重试周期（最低 1 分钟） |
| `RATE_LIMIT_TRUST_PROXY` | `false` | 仅后端严格位于一层可信反向代理之后时开启，用于取得真实客户端 IP |
| `ADMIN_SECRET` | — | 管理后台独立密钥；缺失时所有管理员 API 关闭 |
| `ADMIN_TRUST_PROXY` | `false` | HTTPS 在可信反向代理终止时设为 `true`，允许读取代理写入的 `X-Forwarded-Proto` |
| `ADMIN_ALLOW_INSECURE_HTTP` | `false` | 仅封闭演示网络临时允许公网 HTTP 管理请求；正式环境不要开启 |
| `EXPO_ACCESS_TOKEN` | — | 可选；Expo Push Service 开启访问令牌保护后填写，供服务端发送 iOS 点赞通知 |

## 无对象存储的快速部署（过渡方案）

普通服务器上跑演示、还没有七牛账号时，两个环境变量即可：

```bash
STORAGE_PROVIDER=local PUBLIC_BASE_URL=http://<公网IP>:9091 pnpm dev
```

媒体文件落盘到 `server/data/uploads/`，由后端 `/media/<key>` 静态服务直接暴露（支持 Range，视频可拖进度条）。适用场景：过渡部署、线下演示、小流量内测——本地磁盘无冗余，不适合正式运营。

之后切七牛**只改环境变量**（`STORAGE_PROVIDER=qiniu` + 七牛四件套），代码零改动；已落盘的本地文件不会自动迁移。

## 部署到普通云服务器

> 当前目标形态：Node.js 后端、媒体文件和 OTA 更新都放在现有云服务器 `1.92.120.33`；不要求 EAS 或七牛云，国内用户不需要梯子。

**1. 可选：使用 MySQL 时建库建表**

```bash
mysql -h <mysql-host> -u <user> -p <database> < server/migrate.sql
```

`migrate.sql` 可创建当前完整表结构；存量库的缺失列由新版后端启动时按需补齐（数据库账号需要 `ALTER` 权限）。首次启动还会在**空库时自动播种 40 条种子留言**。

**2. 配置环境变量并启动后端**

```bash
cd server
pnpm install
pnpm build   # 产出 dist/

# 当前普通云服务器部署
export STORAGE_PROVIDER=local
export PUBLIC_BASE_URL=http://1.92.120.33:9091
export OTA_PUBLIC_BASE_URL=http://1.92.120.33:9091
export OTA_UPDATES_DIR=/opt/roam-dlut/server/data/updates
export OTA_PRIVATE_KEY_PATH=/opt/roam-dlut/server/data/ota/keys/private-key.pem
export SERVER_SECRET=<随机长字符串>   # 如 openssl rand -hex 32
export STEPFUN_API_KEY=<在服务器上配置的新密钥>
export STEPFUN_MODEL=step-3.7-flash
export ADMIN_SECRET=<另一个随机长字符串>
# 建议按比赛人数和账户预算收紧
export MODERATION_GLOBAL_DAILY_LIMIT=500

# 可选；不设时继续使用本地 JSON 持久化
# export DATABASE_URL=mysql://<user>:<pass>@<mysql-host>:3306/<database>

# 可选调参（默认值见上表）
# export MESSAGE_READ_LIMIT=99 MESSAGE_TTL_DAYS=30 MESSAGE_DAILY_LIMIT=3

PORT=9091 pnpm start
```

注意：
- `STORAGE_PROVIDER=local` 时上传文件落在 `server/data/uploads/`；以后需要时仍可只改环境变量切换七牛 Kodo
- OTA 文件落在 `server/data/updates/`，由 `/api/v1/updates/*` 提供；私钥只存在部署机和云服务器，APK 仅内置公钥证书
- `SERVER_SECRET` 一旦上线就不要再改，否则所有已安装设备的 token 立即失效
- `STEPFUN_API_KEY` 与 `ADMIN_SECRET` 只放服务器环境变量，不能放 App、Git、截图或聊天记录；公开过的密钥应先撤销再换新
- 管理密钥不能通过公网 HTTP 传输；默认只允许 localhost 或 HTTPS 管理请求
- 内容审核和音频转写是按量计费能力；默认另有单 IP 与单进程每日预算阈值。模型故障、余额不足或不支持的媒体格式会进入人工待审，不会直接公开
- 内置限额适合当前单实例朋友内测；若以后多实例公开运营，应把计数迁到 Redis/API 网关，并接入更强的设备证明
- 滚动更新时先发布客户端 OTA，再部署新版后端；新版上传接口会在读取大文件前强制要求 `x-device-id`，未取得热更新的旧客户端将无法上传
- 完整的首次部署、日常上传和回滚步骤见 [`docs/热更推送手册.md`](./docs/热更推送手册.md)

**3. 构建 App（指向公网后端）**

```bash
cd client
EXPO_PUBLIC_BACKEND_BASE_URL=http://1.92.120.33:9091 pnpm exec expo run:android --variant release
```

iOS 还需在 Expo/EAS 项目中配置 APNs 凭据，并在构建环境提供 `EXPO_PUBLIC_EAS_PROJECT_ID`。当前 HTTP/IP 演示后端会临时放宽 iOS ATS；正式上架前必须切换 HTTPS。

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
| POST | `/users/reclaim` | 凭三词暗号找回身份；按 IP 限流（1h/10 次失败 → 429） |
| GET | `/messages` | 存活留言列表（仅 id/坐标/时间，总数即列表长度） |
| GET | `/messages/:id` | 开信读全文；服务端按 device_id 去重计数，读满即消散 |
| POST | `/messages` | 发布留言；WGS‑84 校验后隐藏入队并立即返回 202，由后台模型初审 |
| GET | `/messages/:id/moderation-status` | 作者短轮询是否已自动公开，不返回模型原因或分类 |
| POST | `/messages/:id/like` | 点赞（解锁后可点一次，幂等） |
| GET | `/notifications` | 按单调游标拉取本身份的点赞事件（需设备 token） |
| PUT / DELETE | `/notifications/push-token` | 绑定或解绑 iOS Expo push token（需设备 token） |
| POST | `/upload` | 图片/视频/音频上传（multipart，≤120MB，需预检设备头），校验文件签名后返回设备绑定票据 |
| GET | `/admin/moderation/pending` | 管理员待审队列（需 `ADMIN_SECRET`） |
| POST | `/admin/moderation/:id/approve` | 管理员放行待审内容 |
| POST | `/admin/moderation/:id/reject` | 管理员删除并记录违规，可同时指定处罚 |
| GET / POST | `/admin/moderation/cleanup`、`/admin/moderation/cleanup/retry` | 查看并重试被拒媒体的持久化清理任务 |
| GET | `/admin/bans` | 查看违规次数和设备处罚 |
| POST / DELETE | `/admin/bans/:deviceId` | 设置或解除设备处罚 |
| GET | `/updates/manifest` | Expo Updates 协议 manifest（按平台/runtime 返回签名更新或回滚指令） |
| GET | `/updates/assets` | 下载 manifest 声明的 bundle、图片和字体资源 |
| GET | `/updates/health` | 查看 OTA 存储状态与已发布 runtime |

> 服务端设了 `SERVER_SECRET` 时：`POST /users` 响应会多一个 `token` 字段，之后开信、点赞、我的数据与通知接口须带请求头 `x-device-token: <token>`，否则 401。App 端已自动处理（注册时保存并回传）。

## 目录结构

```
client/                 # Expo App
├── app/                # 路由（index=守候主界面, compose=写留言, profile=我的）
├── screens/            # 页面实现（与路由一一对应）
├── components/         # 光点/开信动画/贴纸/夜空背景/演示面板等
├── contexts/           # 全局状态（设备、位置、留言缓存）
├── services/           # 通知、后台定位与 Android 守候编排
├── modules/            # 本地 Expo 原生模块（荣耀兼容 LocationManager 服务）
├── utils/              # API 封装、Haversine、贴纸注册表
server/                 # 后端
├── src/routes/         # users / messages / upload / updates
├── src/updates/        # 自托管 Expo Updates 协议、签名、资源校验与测试
├── src/seeds.ts        # 40 条种子留言
├── src/store/          # 数据层（index=接口与切换, memoryStore, mysqlStore）
├── src/storage/        # 存储层（index=接口与切换, cozeProvider, qiniuProvider）
├── src/auth.ts         # 设备 token 签发与校验（SERVER_SECRET 开关）
└── migrate.sql         # 可选 MySQL 建表脚本
scripts/                # OTA 导出、原子发布与回滚脚本
```

## 设计文档

视觉基调、配色、动效规范见 [DESIGN.md](./DESIGN.md)。
