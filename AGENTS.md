# 此地有话 · roam-dlut

## 项目概述

校园地理留言 App「此地有话」：用户把留言藏在真实 GPS 坐标上，App 不提供任何地图；只有走到留言 50m 内，留言才会浮现并可开信阅读。留言存活 30 天或被读满 99 人（可配）即永久消散。目标用户：大连理工大学学生。最终产物为 Android APK（Expo）。

设计基调与动效细节见 `DESIGN.md`（暖金 + 蓝紫夜空、手绘魔法贴纸、开信动画是产品灵魂，改动视觉前先读它）。

## 技术栈

- monorepo（pnpm workspace）：`client/` = Expo 54 + React Native + Expo Router + Uniwind(Tailwind v4) + Reanimated；`server/` = Express + tsx，内存数据 + `server/data/store.json` 持久化（mock 后端，替代团队未来的 MySQL 服务）
- 对象存储：平台 S3 兼容存储（`coze-coding-dev-sdk` 的 `S3Storage`），媒体存 key、按需生成签名 URL
- 包管理：client 用 `npx expo install`，server 用 `pnpm add`；**禁止 npm/yarn**

## 目录结构（业务代码）

```
client/
├── app/                    # 路由（仅 re-export）：index=home, compose, profile
├── screens/
│   ├── home/index.tsx      # 守候主界面：呼吸数字、氛围文案轮换、偶遇感应、光点、开信
│   ├── compose/index.tsx   # 写留言：140字、贴纸插入、图/视频上传、发布
│   └── profile/index.tsx   # 我的：花名(可改一次)、我的发布、足迹、版本号连击5次开演示模式
├── components/
│   ├── NightSky.tsx        # 夜空渐变 + 星星闪烁背景
│   ├── GlowDot.tsx         # 偶遇光点（漂浮+呼吸+星尘）
│   ├── LetterOverlay.tsx   # 开信动画与留言卡（阶段编排，产品灵魂，慎改）
│   ├── StickerIcon.tsx     # 18 枚手绘风 SVG 贴纸
│   ├── RichText.tsx        # [em:xx] 贴纸占位符内联渲染
│   └── DemoPanel.tsx       # 演示模式虚拟定位面板
├── contexts/AppContext.tsx # deviceId、花名、位置(真实/模拟)、存活列表、已读集合
├── utils/                  # api.ts(接口封装+注释)、haversine、device、stickers 注册表
server/src/
├── index.ts                # 入口与路由挂载（/api/v1）
├── routes/                 # users / messages / upload
├── store.ts                # 数据存储与消散判定（isAlive）
├── seeds.ts                # 40 条种子留言（大工坐标）；seedMedia.ts = 媒体对象存储 key
├── config.ts               # READ_LIMIT(99)、TTL_DAYS(30)、DAILY_LIMIT(3)、RADIUS(50) 环境变量可配
└── scripts/seed-media-*.ts # 一次性：AI 生成种子图/视频并上传对象存储
```

## 关键入口 / 核心模块

- **偶遇判定**：`screens/home` 内对 `aliveMessages` 做 Haversine ≤50m，最近未读留言触发震动 + GlowDot；已读集合持久化在 AsyncStorage（`cidi_read_ids`）
- **消散双条件**：`store.ts` 的 `isAlive()`；读按 device_id 去重，作者永远可回看
- **贴纸协议**：正文内 `[em:xx]` 占位符 → `RichText` 内联渲染；插入在光标处
- **上传链路**：picker → `createFormDataFile` → `POST /api/v1/upload`(multer) → S3 key → 发布时带 key；读取时服务端生成签名 URL（`mediaUrlOf`）
- **演示模式**：profile 页连击版本号 5 次 → DemoPanel：步进微调 + 跳到留言旁；AppContext 以 mockLocation 覆盖真实 GPS（web 预览必需）

## 运行与预览

- `coze dev` 启动前后端（热更新）；前端 5000（对外）、后端 9091
- 校验：`pnpm validate`（client tsc+eslint、server tsc）
- 后端冒烟：`curl localhost:9091/api/v1/health`、`curl localhost:9091/api/v1/messages`
- 部署：`.coze` 已配 `kind="android"` + `backend.enabled=true`（模板脚本 `.cozeproj/scripts/prod_*.sh`，端口 5000）
- **不进 Git 的东西**（用户明确要求）：`.coze`、`.cozeproj/`、`.preview`、`client/assets/`、`.codegraph/`、`logs/`、`server/data/` —— 已写入 `.gitignore` 并从 git 索引移除，新增平台/运行时文件也按此原则处理

## 用户偏好与长期约束

- 产品铁律：**永远不画地图、不给任何位置提示**；远距离零交互入口
- 明确不做：排行榜、私信、关注/好友、分享到微信、后台常驻定位
- 种子/文案质感：温柔、幽默、有校园集体记忆；禁鸡汤腔和网络烂梗
- 验收时需演示：消散阈值可调（`MESSAGE_READ_LIMIT` 环境变量）

## 常见问题和预防

- 模板自带 `heroui/` 与 `components/Screen.tsx` 有存量类型不兼容，已做最小类型断言修复（勿回退）
- `S3Storage` 无 `headObject` 方法；`uploadFile` 返回的 key 不含 folderName 前缀，直接用返回值
- web 端无 GPS/震动：代码已按 `Platform.OS !== 'web'` 守卫；验证偶遇请用演示模式
- 种子数据变更后需删除 `server/data/store.json` 并重启后端才会重新播种
- 改路由 name/文件名后必须跑 `app_check`；字体用 expo-google-fonts（马善政/Noto Serif SC）
