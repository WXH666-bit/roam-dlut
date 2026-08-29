import type { BanMode, DeviceModeration } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

const durationForMode = (mode: BanMode): number | null => {
  if (mode === '1d') return DAY_MS;
  if (mode === '7d') return 7 * DAY_MS;
  if (mode === '30d') return 30 * DAY_MS;
  return null;
};

/**
 * The model never bans by itself. Confirmed violations escalate as follows:
 * first strike only, then 1 day, 7 days, 30 days, and permanent on the fifth.
 */
export const restrictionAfterConfirmedViolation = (
  current: DeviceModeration | undefined,
  deviceId: string,
  mode: BanMode,
  reason: string | undefined,
  now: number
): DeviceModeration => {
  const violationCount = (current?.violationCount ?? 0) + 1;
  const effectiveMode: BanMode = mode === 'auto'
    ? violationCount >= 5
      ? 'permanent'
      : violationCount === 4
        ? '30d'
        : violationCount === 3
          ? '7d'
          : violationCount === 2
            ? '1d'
            : 'none'
    : mode;
  const duration = durationForMode(effectiveMode);
  const currentActiveUntil = current?.bannedUntil && current.bannedUntil > now
    ? current.bannedUntil
    : null;
  return {
    deviceId,
    violationCount,
    permanent: Boolean(current?.permanent || effectiveMode === 'permanent'),
    bannedUntil: effectiveMode === 'permanent'
      ? null
      : duration
        ? Math.max(currentActiveUntil ?? 0, now + duration)
        : currentActiveUntil,
    reason: reason?.trim().slice(0, 500) || current?.reason || '管理员确认违规',
    updatedAt: now,
  };
};

export const restrictionAfterManualBan = (
  current: DeviceModeration | undefined,
  deviceId: string,
  mode: Exclude<BanMode, 'auto' | 'none'>,
  reason: string | undefined,
  now: number
): DeviceModeration => {
  const duration = durationForMode(mode);
  const currentActiveUntil = current?.bannedUntil && current.bannedUntil > now
    ? current.bannedUntil
    : null;
  return {
    deviceId,
    violationCount: current?.violationCount ?? 0,
    permanent: Boolean(current?.permanent || mode === 'permanent'),
    bannedUntil: mode === 'permanent'
      ? null
      : Math.max(currentActiveUntil ?? 0, now + (duration ?? 0)),
    reason: reason?.trim().slice(0, 500) || current?.reason || '管理员手动封禁',
    updatedAt: now,
  };
};

export const unbannedRestriction = (
  current: DeviceModeration | undefined,
  deviceId: string,
  now: number
): DeviceModeration => ({
  deviceId,
  violationCount: current?.violationCount ?? 0,
  permanent: false,
  bannedUntil: null,
  reason: null,
  updatedAt: now,
});

export const activeRestriction = (
  value: DeviceModeration | undefined,
  now = Date.now()
): DeviceModeration | null => (
  value && (value.permanent || (value.bannedUntil !== null && value.bannedUntil > now))
    ? value
    : null
);
