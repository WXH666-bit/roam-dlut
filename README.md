# 此地有话 · roam-dlut

> 把留言藏在校园的真实地理位置上。没有地图，没有提示——只有走到那条留言 50 米以内，它才会浮现。

「此地有话」是一款面向大连理工大学学生的校园地理留言 App（Android）。任何人都可以在某个位置藏下一句话、一张照片或一段视频；每条留言存活 30 天，或被读满 99 人，任一条件到达即永久消散。它是写给陌生人的信、藏在校园里的彩蛋、稍纵即逝的偶遇——机不可失。

## 核心玩法

- **守候**：主界面只显示"此刻，校园里有 N 条留言正在等待"，没有任何位置信息
- **偶遇**：走到某条未读留言 50m 内，手机震动，屏幕浮现一枚发光光点，点开即读
- **藏言**：在某个有感触的地方，写下 140 字以内的话，可配手绘贴纸、1 张照片或 1 段视频
- **消散**：存活满 30 天或被读满 99 人（按设备去重），留言永久消散——错过就是错过

## 技术栈

| 端 | 技术 |
|---|---|
| App（`client/`） | Expo 54 · React Native · Expo Router · Uniwind(Tailwind v4) · Reanimated |
| Mock 后端（`server/`） | Express · tsx · 内存数据 + JSON 持久化（替代开发期的团队 MySQL 服务） |
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
   - **方向按钮**：按步长微调经纬度（步长档位约 11m / 55m / 111m）
   - **「跳到留言旁」列表**：一键把模拟位置设到某条存活留言的 50m 范围内——立即触发震动 + 光点 + 开信全流程
5. 面板内可随时**关闭演示模式**，恢复真实 GPS

## 常用命令

```bash
pnpm dev            # 同时起后端(9091) + Expo
pnpm validate       # 前后端 TypeScript + ESLint 全量检查
pnpm lint:client    # 仅 App 端检查
pnpm lint:server    # 仅后端检查
```

## 后端配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `MESSAGE_READ_LIMIT` | `99` | 读满人数上限，达到即消散（验收时可调小，如 `3`） |
| `MESSAGE_TTL_DAYS` | `30` | 存活天数，到期消散 |
| `MESSAGE_DAILY_LIMIT` | `3` | 每设备每日发布上限 |
| `PORT` | `9091` | 后端监听端口 |

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
| POST | `/upload` | 图片/视频上传（multipart），返回存储 key 与访问 URL |

## 目录结构

```
client/                 # Expo App
├── app/                # 路由（index=守候主界面, compose=写留言, profile=我的）
├── screens/            # 页面实现（与路由一一对应）
├── components/         # 光点/开信动画/贴纸/夜空背景/演示面板等
├── contexts/           # 全局状态（设备、位置、留言缓存）
├── utils/              # API 封装、Haversine、贴纸注册表
server/                 # Mock 后端
├── src/routes/         # users / messages / upload
├── src/seeds.ts        # 40 条种子留言
└── src/store.ts        # 数据存储与消散判定
```

## 设计文档

视觉基调、配色、动效规范见 [DESIGN.md](./DESIGN.md)。
