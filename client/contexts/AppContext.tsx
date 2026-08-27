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
  /** 最近一次坐标的水平精度（米），未知为 null；>=50（偶遇半径）时坐标可能不足以触发偶遇 */
  locationAccuracy: number | null;
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
  markRead: (id: string) => void;
  // 首次引导：null=读取中，false=未引导（首页重定向去引导页）
  onboarded: boolean | null;
  completeOnboarding: () => Promise<void>;
  // 读满消散阈值（来自 GET /messages 的 read_limit，未拉到前默认 99）
  readLimit: number;
}

const AppContext = createContext<AppContextValue | null>(null);

const READ_IDS_KEY = 'cidi:read_ids';
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
  const [gpsLocation, setGpsLocation] = useState<LatLng | null>(null);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('locating');
  const [demoMode, setDemoModeState] = useState(false);
  const [mockLocation, setMockLocationState] = useState<LatLng | null>(null);
  const [aliveMessages, setAliveMessages] = useState<AliveMessageBrief[]>([]);
  const [aliveTotal, setAliveTotal] = useState(0);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [readLimit, setReadLimit] = useState(99);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const geoWatchIdRef = useRef<number | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 定位流程令牌：重入（retry）或卸载时递增，作废旧流程的异步回调
  const locationRunRef = useRef(0);

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
      Geolocation.clearWatch(geoWatchIdRef.current);
      geoWatchIdRef.current = null;
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

  // 定位全流程：expo-location 主引擎；Android 上 8 秒无坐标则切备用引擎
  // （华为/荣耀国行无 GMS，expo-location 的 FusedLocationProvider 不回调，
  //  react-native-geolocation-service 的 forceLocationManager 走系统 LocationManager 兜底）
  const startLocation = useCallback(async () => {
    const run = ++locationRunRef.current;
    const stale = () => run !== locationRunRef.current;
    stopLocationEngines();
    setLocationStatus('locating');
    setLocationAccuracy(null);

    const onFix = (lat: number, lng: number, accuracy: number | null) => {
      setGpsLocation({ lat, lng });
      setLocationAccuracy(accuracy);
      setLocationStatus('ready');
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      if (fallbackWatchdogRef.current) {
        clearTimeout(fallbackWatchdogRef.current);
        fallbackWatchdogRef.current = null;
      }
    };

    // 备用引擎：停 expo watch，强制走系统 LocationManager（终态交给 onError 判定）
    const startFallbackEngine = () => {
      if (stale()) return;
      // 清旧切换定时器与旧看门狗，防止 catch 路径与定时器路径先后触发
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      if (fallbackWatchdogRef.current) {
        clearTimeout(fallbackWatchdogRef.current);
        fallbackWatchdogRef.current = null;
      }
      removeExpoWatch(watchRef.current);
      watchRef.current = null;
      geoWatchIdRef.current = Geolocation.watchPosition(
        (pos) => onFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null),
        (err) => {
          if (stale()) return;
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
      // JS 看门狗：15 秒无 fix 置 unavailable；订阅保持，真实 fix 到达时 onFix 自动翻回 ready
      fallbackWatchdogRef.current = setTimeout(() => {
        if (stale()) return;
        setLocationStatus((s) => (s === 'ready' ? s : 'unavailable'));
      }, 15000);
      // 首拍缓存：并行 getCurrentPosition，命中系统 LocationManager 缓存可秒回
      Geolocation.getCurrentPosition(
        (pos) => {
          if (stale()) return;
          onFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null);
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
    };

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (stale()) return;
      if (status !== 'granted') {
        setLocationStatus('denied');
        return;
      }
      const last = await Location.getLastKnownPositionAsync();
      if (stale()) return;
      if (last) onFix(last.coords.latitude, last.coords.longitude, last.coords.accuracy ?? null);
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        (pos) => onFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null)
      );
      if (stale()) {
        removeExpoWatch(sub);
        return;
      }
      watchRef.current = sub;
      if (Platform.OS === 'android') {
        fallbackTimerRef.current = setTimeout(startFallbackEngine, 8000);
      } else if (Platform.OS === 'ios') {
        // iOS 无 GMS 问题，备用引擎不启用；超时仅提示，watch 回调仍可把状态翻回 ready
        fallbackTimerRef.current = setTimeout(() => {
          if (!stale()) setLocationStatus((s) => (s === 'ready' ? s : 'unavailable'));
        }, 8000);
      }
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
      // 开启时默认落在校园中心（令希图书馆与主楼之间）
      setMockLocationState((prev) => prev ?? { lat: 38.8828, lng: 121.5265 });
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

  const location = demoMode ? mockLocation : gpsLocation;
  const locationReady = locationStatus !== 'locating';

  const value = useMemo<AppContextValue>(
    () => ({
      deviceId,
      deviceToken,
      user,
      setUser,
      adoptIdentity,
      location,
      locationAccuracy,
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
      markRead,
      onboarded,
      completeOnboarding,
      readLimit,
    }),
    [
      deviceId, deviceToken, user, adoptIdentity, location, locationAccuracy, locationReady,
      locationStatus, retryLocation, demoMode, mockLocation,
      setDemoMode, setMockLocation, aliveMessages, aliveTotal, refreshMessages, readIds, markRead,
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
