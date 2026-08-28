import { ExpoConfig, ConfigContext } from 'expo/config';

// 自托管 OTA 与业务 API 默认共用国内云服务器；有 HTTPS/CDN 域名后可单独覆盖更新源。
// 该 URL 会写进原生 APK，修改后必须重新打一次基座包。
const backendBaseUrl = (
  process.env.EXPO_PUBLIC_BACKEND_BASE_URL || 'http://localhost:9091'
).replace(/\/+$/, '');
const otaUpdateUrl = (
  process.env.EXPO_PUBLIC_OTA_UPDATE_URL || `${backendBaseUrl}/api/v1/updates/manifest`
).replace(/\/+$/, '');

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    updates: {
      enabled: true,
      url: otaUpdateUrl,
      // 正常检查由 useOtaUpdate 负责并显示“立即重启”；崩溃恢复仍交给原生层兜底。
      checkAutomatically: 'ON_ERROR_RECOVERY',
      fallbackToCacheTimeout: 0,
      // 私钥只放在发布机和云服务器；APK 只内置公钥证书来拒绝被篡改的更新。
      codeSigningCertificate: './certs/certificate.pem',
      codeSigningMetadata: {
        keyid: 'main',
        alg: 'rsa-v1_5-sha256',
      },
    },
    // 每次原生层改动（原生依赖、权限、Gradle、SDK）必须递增 version，隔离不兼容 OTA。
    runtimeVersion: { policy: 'appVersion' },
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
      "expo-updates",
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
