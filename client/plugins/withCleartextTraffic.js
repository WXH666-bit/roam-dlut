const { withAndroidManifest } = require('expo/config-plugins');

// 后端当前为 http://<公网IP>:9091 直连（无域名无 https），Android 9+ 默认拦截明文流量。
// SDK 54 的 prebuild 已不再处理 app config 里的 android.usesCleartextTraffic 字段，
// 因此用本插件在 prebuild 时直接写入 AndroidManifest。
// 决赛前若后端切到 https，删除本文件及 app.config.ts plugins 里的引用即可。
module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (app) {
      app.$['android:usesCleartextTraffic'] = 'true';
    }
    return mod;
  });
};
