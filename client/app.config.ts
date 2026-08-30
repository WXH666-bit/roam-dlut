import { ExpoConfig, ConfigContext } from 'expo/config';

// 自托管 OTA 与业务 API 默认共用国内云服务器；有 HTTPS/CDN 域名后可单独覆盖更新源。
// 该 URL 会写进原生 APK，修改后必须重新打一次基座包。
const backendBaseUrl = (
  process.env.EXPO_PUBLIC_BACKEND_BASE_URL || 'http://localhost:9091'
).replace(/\/+$/, '');
const otaUpdateUrl = (
  process.env.EXPO_PUBLIC_OTA_UPDATE_URL || `${backendBaseUrl}/api/v1/updates/manifest`
).replace(/\/+$/, '');
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
const usesInsecureHttpBackend = backendBaseUrl.startsWith('http://');

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
    "name": "Here",
    "slug": "roam-dlut",
    "version": "1.4.1",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "cidi",
    "userInterfaceStyle": "dark",
    "newArchEnabled": true,
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.roamdlut.cidi",
      "buildNumber": "7",
      "infoPlist": {
        "NSLocationWhenInUseUsageDescription": "「Here」需要访问您的位置，才能感知附近的留言。",
        "NSLocationAlwaysAndWhenInUseUsageDescription": "允许「Here」始终访问位置，以便在应用不在前台时提醒您附近的留言。",
        "UIBackgroundModes": ["location"],
        // 当前演示服务器仍是 HTTP/IP 直连；iOS 的 ATS 默认会拦截全部业务请求。
        // 正式上架前切到 HTTPS，下面的临时放行会随构建环境自动消失。
        ...(usesInsecureHttpBackend ? {
          "NSAppTransportSecurity": {
            "NSAllowsArbitraryLoads": true
          }
        } : {})
      }
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/adaptive-icon.png",
        "backgroundImage": "./assets/images/adaptive-icon-background.png",
        "backgroundColor": "#EEDBB3"
      },
      "package": "com.roamdlut.cidi",
      "versionCode": 7,
      // 明文流量（usesCleartextTraffic）说明：后端当前为 http://<公网IP>:9091 直连，
      // SDK 54 已移除该 app config 字段的 prebuild 支持，改由 plugins/withCleartextTraffic.js 写入清单；
      // 决赛前若后端切 https，删除该插件即可。
      "permissions": [
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_LOCATION",
        "POST_NOTIFICATIONS",
        "RECORD_AUDIO",
        "VIBRATE",
        "WAKE_LOCK"
      ]
    },
    "web": {
      "bundler": "metro",
      "output": "single",
      "favicon": "./assets/images/favicon.png"
    },
    "plugins": [
      "./plugins/withCleartextTraffic",
      "./plugins/withAmapLocation",
      "expo-updates",
      [
        "expo-notifications",
        {
          "color": "#F5C26B",
          "defaultChannel": "cidi_like"
        }
      ],
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
          "backgroundColor": "#EEDBB3"
        }
      ],
      [
        "expo-image-picker",
        {
          "photosPermission": "允许「Here」访问您的相册，以便您为留言配上照片。",
          "cameraPermission": "允许「Here」使用您的相机，以便您直接拍摄照片上传。",
          "microphonePermission": "允许「Here」访问您的麦克风，以便您录制声音或拍摄带有声音的视频。"
        }
      ],
      [
        "expo-location",
        {
          "locationWhenInUsePermission": "「Here」需要访问您的位置，才能感知附近的留言。",
          "locationAlwaysAndWhenInUsePermission": "允许「Here」始终访问位置，以便在应用不在前台时提醒您附近的留言。",
          "isIosBackgroundLocationEnabled": true,
          "isAndroidBackgroundLocationEnabled": true,
          "isAndroidForegroundServiceEnabled": true
        }
      ],
      [
        "expo-camera",
        {
          "cameraPermission": "「Here」需要访问相机以拍摄照片和视频。",
          "microphonePermission": "「Here」需要访问麦克风以录制声音或视频。",
          "recordAudioAndroid": true
        }
      ]
    ],
    ...(easProjectId ? {
      "extra": {
        ...config.extra,
        "eas": {
          ...(typeof config.extra?.eas === 'object' && config.extra.eas !== null
            ? config.extra.eas
            : {}),
          "projectId": easProjectId
        }
      }
    } : {}),
    "experiments": {
      "typedRoutes": true
    }
  }
}
