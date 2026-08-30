const { withAndroidManifest } = require('expo/config-plugins');

const AMAP_API_KEY_METADATA = 'com.amap.api.v2.apikey';

/**
 * Injects the Android AMap key at prebuild time without committing it.
 * Set AMAP_ANDROID_API_KEY in the shell/EAS build environment. The generated
 * AndroidManifest necessarily contains the mobile key; protect it in AMap's
 * console by binding the package name and signing SHA-1.
 */
module.exports = function withAmapLocation(config) {
  return withAndroidManifest(config, (mod) => {
    const apiKey = String(process.env.AMAP_ANDROID_API_KEY || '').trim();
    const app = mod.modResults.manifest.application?.[0];
    if (!app || !apiKey) return mod;

    const metadata = app['meta-data'] ?? [];
    const existing = metadata.find(
      (entry) => entry?.$?.['android:name'] === AMAP_API_KEY_METADATA
    );
    if (existing) {
      existing.$['android:value'] = apiKey;
    } else {
      metadata.push({
        $: {
          'android:name': AMAP_API_KEY_METADATA,
          'android:value': apiKey,
        },
      });
    }
    app['meta-data'] = metadata;
    return mod;
  });
};
