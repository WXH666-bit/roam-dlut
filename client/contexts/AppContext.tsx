import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import Geolocation from 'react-native-geolocation-service';
import { AppState, Platform } from 'react-native';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchAliveMessages,
  registerDevice,
  type AliveMessageBrief,
  type ApiUser,
} from '@/utils/api';
import { getDeviceId, overwriteDeviceId } from '@/utils/device';
import {
  isFreshLiveLocation,
  LOCATION_COORDINATE_SYSTEM,
  LOCATION_MAX_FUTURE_SKEW_MS,
  shouldAutoRetryLocation,
  type LocationFix,
  type LocationSource,
} from '@/utils/location';
import { READ_IDS_STORAGE_KEY } from '@/utils/notificationStorage';

// Re-export the location metadata types/constants from the context module so
// existing callers can keep importing all app-facing location contracts here.
export {
  LOCATION_COORDINATE_SYSTEM,
  LOCATION_MAX_AGE_MS,
  LOCATION_MAX_ACCURACY_METERS,
  isFreshLiveLocation,
} from '@/utils/location';
export type { LocationFix, LocationSource } from '@/utils/location';

/** Coordinates are WGS-84 throughout the client and API payloads. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** locating=定位中；ready=已拿到坐标；denied=权限被拒；unavailable=权限有但两引擎都拿不到坐标 */
export type LocationStatus = 'locating' | 'ready' | 'denied' | 'unavailable';

interface AppContextValue {
  deviceId: string | null;
  /** 服务端开启 SERVER_SECRET 时签发的设备令牌，开信/点赞时随请求回传 */
  deviceToken: string | null;
  user: ApiUser | null;
  setUser: (u: ApiUser) => void;
  /** 暗号认领成功后切换身份：覆写 deviceId、清 token 与本地已读、重新幂等注册 */
  adoptIdentity: (u: ApiUser) => Promise<void>;
  // 定位：demoMode 开启时用 mockLocation，否则用真实 GPS
  location: LatLng | null;
  /** 最近一次坐标的水平精度（米），未知为 null。 */
  locationAccuracy: number | null;
  /** 最近一次坐标的原生时间戳（毫秒），未知为 null。 */
  locationTimestamp: number | null;
  /** 最近一次坐标的来源；last-known 仅用于 UI 预热。 */
  locationSource: LocationSource | null;
  /** 是否来自仍在运行的实时 watch；过期性由 isFreshLiveLocation 再判断。 */
  locationIsLive: boolean;
  /** 真实 GPS 定位快照（demoMode 下仍保留真实 GPS 元数据）。 */
  locationFix: LocationFix | null;
  /** 读取最新 GPS 快照，供异步发布流程避免捕获旧时间戳。 */
  getLatestLocationFix: () => LocationFix | null;
  /** 定位流程是否已离开"定位中"（ready/denied/unavailable 任一终态） */
  locationReady: boolean;
  locationStatus: LocationStatus;
  /** 手动重试定位（重走权限请求与双引擎全流程） */
  retryLocation: () => void;
  demoMode: boolean;
  setDemoMode: (on: boolean) => void;
  mockLocation: LatLng | null;
  setMockLocation: (loc: LatLng) => void;
  // 存活留言（仅坐标）
  aliveMessages: AliveMessageBrief[];
  aliveTotal: number;
  refreshMessages: () => Promise<void>;
  // 已读缓存（本地）
  readIds: Set<string>;
  /** 已读缓存已从磁盘恢复，后台任务可安全同步当前集合。 */
  readIdsReady: boolean;
  markRead: (id: string) => void;
  // 首次引导：null=读取中，false=未引导（首页重定向去引导页）
  onboarded: boolean | null;
  completeOnboarding: () => Promise<void>;
  // 读满消散阈值（来自 GET /messages 的 read_limit，未拉到前默认 99）
  readLimit: number;
}

const AppContext = createContext<AppContextValue | null>(null);

const READ_IDS_KEY = READ_IDS_STORAGE_KEY;
const DEVICE_TOKEN_KEY = 'cidi:device_token';
const ONBOARDED_KEY = 'cidi:onboarded';
const POLL_INTERVAL = 30_000;

// web 端 expo-location 的 subscription.remove() 会碰不存在的原生 EventEmitter，静默降级
const removeExpoWatch = (sub: Location.LocationSubscription | null) => {
  try {
    sub?.remove();
  } catch {
    // 忽略清理失败，引用照常释放
  }
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [locationFix, setLocationFix] = useState<LocationFix | null>(null);
  const locationFixRef = useRef<LocationFix | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('locating');
  const [demoMode, setDemoModeState] = useState(false);
  const [mockLocation, setMockLocationState] = useState<LatLng | null>(null);
  const [aliveMessages, setAliveMessages] = useState<AliveMessageBrief[]>([]);
  const [aliveTotal, setAliveTotal] = useState(0);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [readIdsReady, setReadIdsReady] = useState(false);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [readLimit, setReadLimit] = useState(99);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const geoWatchIdRef = useRef<number | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 定位流程令牌：重入（retry）或卸载时递增，作废旧流程的异步回调
  const locationRunRef = useRef(0);
  const locationRunStartedAtRef = useRef(0);
  const lastAutomaticLocationRetryAtRef = useRef(0);

  // 启动：设备注册 + 已读缓存恢复
  useEffect(() => {
    (async () => {
      const id = await getDeviceId();
      setDeviceId(id);
      try {
        const savedToken = await AsyncStorage.getItem(DEVICE_TOKEN_KEY);
        if (savedToken) setDeviceToken(savedToken);
      } catch {
        // token 读取失败则等注册重新签发
      }
      try {
        const u = await registerDevice(id);
        setUser(u);
        if (u.token) {
          setDeviceToken(u.token);
          AsyncStorage.setItem(DEVICE_TOKEN_KEY, u.token).catch(() => undefined);
        }
      } catch (e) {
        console.warn('[app] register failed:', e);
      }
      try {
        const raw = await AsyncStorage.getItem(READ_IDS_KEY);
        if (raw) setReadIds(new Set(JSON.parse(raw) as string[]));
      } catch {
        // 已读缓存损坏则从空开始
      } finally {
        setReadIdsReady(true);
      }
      try {
        const ob = await AsyncStorage.getItem(ONBOARDED_KEY);
        setOnboarded(ob === '1');
      } catch {
        setOnboarded(false);
      }
    })();
  }, []);

  // 停掉两套定位引擎与备用切换定时器（重入/卸载前必调）
  const stopLocationEngines = useCallback(() => {
    removeExpoWatch(watchRef.current);
    watchRef.current = null;
    if (geoWatchIdRef.current !== null) {
      const watchId = geoWatchIdRef.current;
      geoWatchIdRef.current = null;
      try {
        Geolocation.clearWatch(watchId);
      } catch {
        // 原生模块异常时仍要继续清理下面的 timer/watchdog。
      }
    }
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (fallbackWatchdogRef.current) {
      clearTimeout(fallbackWatchdogRef.current);
      fallbackWatchdogRef.current = null;
    }
  }, []);

  // 定位全流程：Android 同时竞速 Expo 与系统 LocationManager，先拿到合格实时
  // 坐标的引擎胜出；这能避开华为/荣耀无 GMS 时原先最多 8 秒的等待。
  const startLocation = useCallback(async () => {
    const run = ++locationRunRef.current;
    locationRunStartedAtRef.current = Date.now();
    const stale = () => run !== locationRunRef.current;
    let fallbackStarted = false;
    let winningLiveSource: 'expo-watch' | 'fallback' | null = null;
    stopLocationEngines();
    setLocationStatus('locating');
    // Keep no stale fix while a retry is in flight.  A later last-known fix
    // may warm up the UI, but it is explicitly marked non-live below.
    locationFixRef.current = null;
    setLocationFix(null);

    const onFix = (
      lat: number,
      lng: number,
      accuracy: number | null,
      timestamp: number | null,
      source: LocationSource,
      isLive: boolean
    ) => {
      if (stale()) return;
      // 两套 Android 引擎并行竞速；一方拿到 ≤30 米的新鲜实时坐标后，拒绝败方
      // 已排队的回调，防止定位来源来回切换。
      if (
        (winningLiveSource === 'expo-watch' && source === 'fallback')
        || (winningLiveSource === 'fallback' && source === 'expo-watch')
      ) return;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const normalizedAccuracy = (
        typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0
      ) ? accuracy : null;
      const normalizedTimestamp = (
        typeof timestamp === 'number'
        && Number.isFinite(timestamp)
        && timestamp > 0
        && timestamp <= Number.MAX_SAFE_INTEGER
        && timestamp <= Date.now() + LOCATION_MAX_FUTURE_SKEW_MS
      ) ? Math.round(timestamp) : null;
      const nextFix: LocationFix = {
        lat,
        lng,
        accuracy: normalizedAccuracy,
        timestamp: normalizedTimestamp,
        source,
        isLive,
        coordinateSystem: LOCATION_COORDINATE_SYSTEM,
      };
      const previousFix = locationFixRef.current;
      const isFreshAccuracyUpgrade = Boolean(
        previousFix
        && nextFix.accuracy !== null
        && (previousFix.accuracy === null || nextFix.accuracy < previousFix.accuracy)
        && isFreshLiveLocation(nextFix)
      );
      // Never let a cached result replace a live one. Normally timestamps stay
      // monotonic, but racing providers can differ slightly, so allow an older
      // callback only when it is both fresh and genuinely more accurate.
      if (
        previousFix
        && (
          (previousFix.isLive && !nextFix.isLive)
          || (previousFix.timestamp !== null
            && (nextFix.timestamp === null
              || (nextFix.timestamp < previousFix.timestamp && !isFreshAccuracyUpgrade)))
          || (previousFix.timestamp !== null
            && nextFix.timestamp !== null
            && previousFix.timestamp === nextFix.timestamp
            && previousFix.accuracy !== null
            && nextFix.accuracy !== null
            && nextFix.accuracy > previousFix.accuracy)
        )
      ) return;
      locationFixRef.current = nextFix;
      setLocationFix(nextFix);
      setLocationStatus('ready');
      if (isFreshLiveLocation(nextFix)) {
        if (source === 'expo-watch') {
          winningLiveSource = 'expo-watch';
          if (geoWatchIdRef.current !== null) {
            const watchId = geoWatchIdRef.current;
            geoWatchIdRef.current = null;
            try {
              Geolocation.clearWatch(watchId);
            } catch {
              // winner guard still rejects any already queued fallback callback.
            }
          }
        } else if (source === 'fallback') {
          winningLiveSource = 'fallback';
          removeExpoWatch(watchRef.current);
          watchRef.current = null;
        }
        if (fallbackTimerRef.current) {
          clearTimeout(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
        }
        if (fallbackWatchdogRef.current) {
          clearTimeout(fallbackWatchdogRef.current);
          fallbackWatchdogRef.current = null;
        }
      }
    };

    // Android 并行引擎：强制走系统 LocationManager，荣耀/华为无需等待 GMS 超时。
    const startFallbackEngine = () => {
      if (stale() || fallbackStarted) return;
      fallbackStarted = true;
      // 清旧切换定时器与旧看门狗，防止 catch 路径与定时器路径先后触发
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      if (fallbackWatchdogRef.current) {
        clearTimeout(fallbackWatchdogRef.current);
        fallbackWatchdogRef.current = null;
      }
      // JS 看门狗：15 秒无 fix 置 unavailable；订阅保持，真实 fix 到达时 onFix 自动翻回 ready
      fallbackWatchdogRef.current = setTimeout(() => {
        if (stale()) return;
        setLocationStatus((s) => (s === 'ready' ? s : 'unavailable'));
      }, 15000);
      try {
        geoWatchIdRef.current = Geolocation.watchPosition(
          (pos) => onFix(
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.accuracy ?? null,
            pos.timestamp ?? null,
            'fallback',
            true
          ),
          (err) => {
            if (stale() || winningLiveSource === 'expo-watch') return;
            // 拿到过坐标后的间歇性丢星不翻状态，避免界面闪烁
            if (err.code === 1) setLocationStatus('denied');
            else setLocationStatus((s) => (s === 'ready' ? s : 'unavailable'));
          },
          {
            enableHighAccuracy: true,
            distanceFilter: 10,
            interval: 5000,
            forceLocationManager: true,
          }
        );
      } catch (e) {
        // Expo Go、旧 APK 或原生模块未正确链接时可能同步抛错；不能继续卡在 locating。
        console.warn('[app] fallback location start failed:', e);
        if (fallbackWatchdogRef.current) {
          clearTimeout(fallbackWatchdogRef.current);
          fallbackWatchdogRef.current = null;
        }
        if (!stale()) setLocationStatus((s) => (s === 'ready' ? s : 'unavailable'));
        return;
      }
      // 首拍缓存：并行 getCurrentPosition，命中系统 LocationManager 缓存可秒回
      try {
        Geolocation.getCurrentPosition(
          (pos) => {
            if (stale()) return;
            onFix(
              pos.coords.latitude,
              pos.coords.longitude,
              pos.coords.accuracy ?? null,
              pos.timestamp ?? null,
              'fallback',
              false
            );
          },
          () => {
            // 静默忽略，状态出口只有看门狗和 watch 的 onError，避免双写竞争
          },
          {
            timeout: 15000,
            maximumAge: 600000,
            enableHighAccuracy: true,
            forceLocationManager: true,
          }
        );
      } catch {
        // watch 与 JS 看门狗仍在运行；首拍失败不改变终态出口。
      }
    };

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (stale()) return;
      if (status !== 'granted') {
        setLocationStatus('denied');
        return;
      }
      // Android 立即启动系统 LocationManager，不再等待 Expo/GMS 8 秒超时。
      if (Platform.OS === 'android') {
        startFallbackEngine();
      } else if (Platform.OS === 'ios') {
        // iOS 无 GMS 问题，超时仅提示；主引擎晚到的回调仍可把状态翻回 ready。
        fallbackTimerRef.current = setTimeout(() => {
          if (!stale()) setLocationStatus((s) => (s === 'ready' ? s : 'unavailable'));
        }, 8000);
      }

      // 三条路径同时开始：缓存位置负责秒显；最高精度单次定位抢首拍；watch
      // 负责后续更新。任何一条原生 Promise 卡住都不会阻塞另外两条。
      void Location.getLastKnownPositionAsync()
        .then((last) => {
          if (stale() || !last) return;
          onFix(
            last.coords.latitude,
            last.coords.longitude,
            last.coords.accuracy ?? null,
            last.timestamp ?? null,
            'last-known',
            false
          );
        })
        .catch(() => {
          // 缓存未命中不影响两套实时引擎。
        });

      void Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      })
        .then((pos) => onFix(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy ?? null,
          pos.timestamp ?? null,
          'expo-watch',
          true
        ))
        .catch(() => {
          // watch 与 Android LocationManager 仍在竞速。
        });

      const sub = await Location.watchPositionAsync(
        {
          // A 50 m encounter/publish needs a live high-accuracy fix; the
          // last-known value above remains a UI warm-up only.
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        (pos) => onFix(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy ?? null,
          pos.timestamp ?? null,
          'expo-watch',
          true
        )
      );
      if (stale() || winningLiveSource === 'fallback') {
        removeExpoWatch(sub);
        return;
      }
      watchRef.current = sub;
    } catch (e) {
      console.warn('[app] location start failed:', e);
      if (stale()) return;
      // Android 主引擎任何一步异常都还有备用引擎可试；iOS/web 无备用，直接终态
      if (Platform.OS === 'android') startFallbackEngine();
      else setLocationStatus('unavailable');
    }
  }, [stopLocationEngines]);

  const retryLocation = useCallback(() => {
    startLocation();
  }, [startLocation]);

  const locationStatusRef = useRef<LocationStatus>('locating');
  useEffect(() => {
    locationStatusRef.current = locationStatus;
  }, [locationStatus]);

  // 前台持续自愈：首次粗定位保留 15 秒改善窗口；之后若坐标过期、缺失或
  // 精度仍大于 30 米，则重新启动双引擎。45 秒冷却避免弱信号环境反复重启 GPS。
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;

    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      const status = locationStatusRef.current;
      if (status === 'denied' || status === 'locating') return;

      const now = Date.now();
      if (!shouldAutoRetryLocation(
        locationFixRef.current,
        now,
        locationRunStartedAtRef.current,
        lastAutomaticLocationRetryAtRef.current
      )) return;

      lastAutomaticLocationRetryAtRef.current = now;
      startLocation();
    }, 5_000);

    return () => clearInterval(timer);
  }, [startLocation]);

  // 权限被拒后去系统设置开了权限，回到 App 时自动重试（仅 denied 态，不打断正常流程）
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && locationStatusRef.current === 'denied') startLocation();
    });
    return () => sub.remove();
  }, [startLocation]);

  // GPS 监听（前台，低频省电）；首拍异步触发，避免在 effect 内同步 setState
  useEffect(() => {
    const first = setTimeout(startLocation, 0);
    return () => {
      clearTimeout(first);
      locationRunRef.current += 1;
      stopLocationEngines();
    };
  }, [startLocation, stopLocationEngines]);

  const refreshMessages = useCallback(async () => {
    try {
      const data = await fetchAliveMessages();
      setAliveMessages(data.list);
      setAliveTotal(data.total);
      setReadLimit(data.read_limit);
    } catch (e) {
      console.warn('[app] fetch messages failed:', e);
    }
  }, []);

  // 暗号认领：本机身份切换为暗号对应的 deviceId；本地已读集合属于旧身份，一并清空
  const adoptIdentity = useCallback(
    async (claimed: ApiUser) => {
      await overwriteDeviceId(claimed.device_id);
      setDeviceId(claimed.device_id);
      setUser(claimed);
      setDeviceToken(null);
      setReadIds(new Set());
      try {
        await AsyncStorage.multiRemove([DEVICE_TOKEN_KEY, READ_IDS_KEY]);
      } catch {
        // 清理失败不阻塞身份切换
      }
      try {
        const fresh = await registerDevice(claimed.device_id);
        setUser(fresh);
        if (fresh.token) {
          setDeviceToken(fresh.token);
          AsyncStorage.setItem(DEVICE_TOKEN_KEY, fresh.token).catch(() => undefined);
        }
      } catch (e) {
        console.warn('[app] re-register after reclaim failed:', e);
      }
      await refreshMessages();
    },
    [refreshMessages]
  );

  // 存活留言轮询（首拍异步触发，避免在 effect 内同步 setState）
  useEffect(() => {
    const first = setTimeout(refreshMessages, 0);
    const timer = setInterval(refreshMessages, POLL_INTERVAL);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refreshMessages]);

  const markRead = useCallback((id: string) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      AsyncStorage.setItem(READ_IDS_KEY, JSON.stringify([...next])).catch(() => undefined);
      return next;
    });
  }, []);

  const setDemoMode = useCallback((on: boolean) => {
    setDemoModeState(on);
    if (on) {
      // WGS-84 校园中心；旧值是 GCJ-02，已在坐标契约迁移时换算。
      setMockLocationState((prev) => prev ?? { lat: 38.88192768, lng: 121.52139591 });
    }
  }, []);

  const setMockLocation = useCallback((loc: LatLng) => {
    setMockLocationState(loc);
  }, []);

  const completeOnboarding = useCallback(async () => {
    setOnboarded(true);
    try {
      await AsyncStorage.setItem(ONBOARDED_KEY, '1');
    } catch {
      // 持久化失败则下次启动再引导一次，不阻塞进入
    }
  }, []);

  const gpsLocation = useMemo<LatLng | null>(
    () => (locationFix ? { lat: locationFix.lat, lng: locationFix.lng } : null),
    [locationFix]
  );
  const locationAccuracy = locationFix?.accuracy ?? null;
  const locationTimestamp = locationFix?.timestamp ?? null;
  const locationSource = locationFix?.source ?? null;
  const locationIsLive = locationFix?.isLive ?? false;
  const location = demoMode ? mockLocation : gpsLocation;
  const locationReady = locationStatus !== 'locating';
  const getLatestLocationFix = useCallback(() => locationFixRef.current, []);

  const value = useMemo<AppContextValue>(
    () => ({
      deviceId,
      deviceToken,
      user,
      setUser,
      adoptIdentity,
      location,
      locationAccuracy,
      locationTimestamp,
      locationSource,
      locationIsLive,
      locationFix,
      getLatestLocationFix,
      locationReady,
      locationStatus,
      retryLocation,
      demoMode,
      setDemoMode,
      mockLocation,
      setMockLocation,
      aliveMessages,
      aliveTotal,
      refreshMessages,
      readIds,
      readIdsReady,
      markRead,
      onboarded,
      completeOnboarding,
      readLimit,
    }),
    [
      deviceId, deviceToken, user, adoptIdentity, location, locationAccuracy,
      locationTimestamp, locationSource, locationIsLive, locationFix,
      getLatestLocationFix, locationReady,
      locationStatus, retryLocation, demoMode, mockLocation,
      setDemoMode, setMockLocation, aliveMessages, aliveTotal, refreshMessages, readIds, readIdsReady, markRead,
      onboarded, completeOnboarding, readLimit,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = (): AppContextValue => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
