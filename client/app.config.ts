import { ExpoConfig, ConfigContext } from 'expo/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// EAS Update 热更新开关：唯一的 ID 维护点是 eas.json 的 projectId。
// 占位符未替换或读取失败时不注入 updates 配置，APK 行为与接入前完全一致（无热更）。
const easProjectId = ((): string | null => {
  try {
    const parsed = JSON.parse(readFileSync(join(__dirname, 'eas.json'), 'utf8')) as { projectId?: string };
    const id = parsed.projectId?.trim();
    return id && id !== 'TODO_EAS_PROJECT_ID' ? id : null;
  } catch {
    return null;
  }
})();

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    ...(easProjectId
      ? {
          updates: { url: `https://u.expo.dev/${easProjectId}` },
          // runtimeVersion 用 appVersion 策略，绑定本文件的 version 字段：
          // 每次原生层改动（新增/升级原生依赖、改权限、改 gradle）必须把 version 从 1.0.0 递增，
          // 否则热更会推到不兼容的原生层上。
          runtimeVersion: { policy: 'appVersion' },
        }
      : {}),
    "name": "此地有话",
    "slug": "roam-dlut",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "cidi",
    "userInterfaceStyle": "dark",
    "newArchEnabled": true,
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.roamdlut.cidi"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/adaptive-icon.png",
        "backgroundColor": "#0B0E23"
      },
      "package": "com.roamdlut.cidi",
      // 明文流量（usesCleartextTraffic）说明：后端当前为 http://<公网IP>:9091 直连，
      // SDK 54 已移除该 app config 字段的 prebuild 支持，改由 plugins/withCleartextTraffic.js 写入清单；
      // 决赛前若后端切 https，删除该插件即可。
      "permissions": ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "VIBRATE"]
    },
    "web": {
      "bundler": "metro",
      "output": "single",
      "favicon": "./assets/images/favicon.png"
    },
    "plugins": [
      "./plugins/withCleartextTraffic",
      process.env.EXPO_PUBLIC_BACKEND_BASE_URL ? [
        "expo-router",
        {
          "origin": process.env.EXPO_PUBLIC_BACKEND_BASE_URL
        }
      ] : 'expo-router',
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/splash-icon.png",
          "imageWidth": 200,
          "resizeMode": "contain",
          "backgroundColor": "#0B0E23"
        }
      ],
      [
        "expo-image-picker",
        {
          "photosPermission": "允许「此地有话」访问您的相册，以便您为留言配上照片。",
          "cameraPermission": "允许「此地有话」使用您的相机，以便您直接拍摄照片上传。",
          "microphonePermission": "允许「此地有话」访问您的麦克风，以便您拍摄带有声音的视频。"
        }
      ],
      [
        "expo-location",
        {
          "locationWhenInUsePermission": "「此地有话」需要访问您的位置，才能感知附近的留言。"
        }
      ],
      [
        "expo-camera",
        {
          "cameraPermission": "「此地有话」需要访问相机以拍摄照片和视频。",
          "microphonePermission": "「此地有话」需要访问麦克风以录制视频声音。",
          "recordAudioAndroid": true
        }
      ]
    ],
    "experiments": {
      "typedRoutes": true
    }
  }
}
