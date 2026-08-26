import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Updates from 'expo-updates';

/** 用户可见态：idle=无更新或检查中（不提示）；ready=新包已下载，可随时重启生效 */
export type OtaStatus = 'idle' | 'ready';

// expo-updates 在 web 无原生实现（import 安全、调用会抛），web 端整体短路
const OTA_ENABLED = Platform.OS !== 'web';

/**
 * 启动 2 秒后检查 EAS Update：有更新则后台静默下载，完成后置 ready 并暴露 reload()。
 * 一切失败路径（无网/无更新/未配置 projectId/原生库缺失）全部静默，绝不阻塞使用。
 */
export function useOtaUpdate(): { status: OtaStatus; reload: () => void } {
  const [status, setStatus] = useState<OtaStatus>('idle');

  useEffect(() => {
    if (!OTA_ENABLED || __DEV__) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const check = await Updates.checkForUpdateAsync();
        if (cancelled || !check.isAvailable) return;
        const fetched = await Updates.fetchUpdateAsync();
        if (!cancelled && fetched.isNew) setStatus('ready');
      } catch {
        // 静默：热更是增量能力，失败时 App 行为与未接入一致
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const reload = useCallback(() => {
    if (!OTA_ENABLED) return;
    Updates.reloadAsync().catch(() => undefined);
  }, []);

  return { status, reload };
}
