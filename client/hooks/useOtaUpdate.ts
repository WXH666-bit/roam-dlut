import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Updates from 'expo-updates';

/** 用户可见态：idle=无更新或检查中（不提示）；ready=新包已下载，可随时重启生效 */
export type OtaStatus = 'idle' | 'ready';

// expo-updates 在 web 无原生实现（import 安全、调用会抛），web 端整体短路。
const OTA_ENABLED = Platform.OS !== 'web';
const RETRY_DELAYS_MS = [2000, 5000, 15000] as const;

/**
 * 启动后检查国内自托管更新源：有更新则后台下载，完成后置 ready 并暴露 reload()。
 * 短时断网会退避重试，回到前台也会补查；所有失败都保留 APK 内置版本，不阻塞使用。
 */
export function useOtaUpdate(): { status: OtaStatus; reload: () => void } {
  const [status, setStatus] = useState<OtaStatus>('idle');

  useEffect(() => {
    if (!OTA_ENABLED || __DEV__ || !Updates.isEnabled) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let checking = false;
    let ready = false;
    let lastAttemptAt = 0;

    const schedule = (attempt: number, delay: number) => {
      if (cancelled || ready) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void check(attempt), delay);
    };

    const check = async (attempt: number) => {
      if (cancelled || ready || checking) return;
      checking = true;
      lastAttemptAt = Date.now();
      try {
        const result = await Updates.checkForUpdateAsync();
        if (cancelled || (!result.isAvailable && !result.isRollBackToEmbedded)) return;
        const fetched = await Updates.fetchUpdateAsync();
        if (!cancelled && (fetched.isNew || fetched.isRollBackToEmbedded)) {
          ready = true;
          setStatus('ready');
        }
      } catch {
        const nextAttempt = attempt + 1;
        if (nextAttempt < RETRY_DELAYS_MS.length) {
          schedule(nextAttempt, RETRY_DELAYS_MS[nextAttempt]);
        }
      } finally {
        checking = false;
      }
    };

    schedule(0, RETRY_DELAYS_MS[0]);
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (
        nextState === 'active' &&
        !ready &&
        !checking &&
        Date.now() - lastAttemptAt >= 30_000
      ) {
        schedule(0, 500);
      }
    });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      appStateSubscription.remove();
    };
  }, []);

  const reload = useCallback(() => {
    if (!OTA_ENABLED || !Updates.isEnabled) return;
    Updates.reloadAsync().catch(() => undefined);
  }, []);

  return { status, reload };
}
