import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
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
  locationReady: boolean;
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

export function AppProvider({ children }: { children: ReactNode }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [gpsLocation, setGpsLocation] = useState<LatLng | null>(null);
  const [locationReady, setLocationReady] = useState(false);
  const [demoMode, setDemoModeState] = useState(false);
  const [mockLocation, setMockLocationState] = useState<LatLng | null>(null);
  const [aliveMessages, setAliveMessages] = useState<AliveMessageBrief[]>([]);
  const [aliveTotal, setAliveTotal] = useState(0);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [readLimit, setReadLimit] = useState(99);
  const watchRef = useRef<Location.LocationSubscription | null>(null);

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

  // GPS 监听（前台，低频省电）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') {
          setLocationReady(true);
          return;
        }
        const last = await Location.getLastKnownPositionAsync();
        if (!cancelled && last) {
          setGpsLocation({ lat: last.coords.latitude, lng: last.coords.longitude });
        }
        watchRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 5000,
            distanceInterval: 10,
          },
          (pos) => {
            setGpsLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            setLocationReady(true);
          }
        );
        setLocationReady(true);
      } catch (e) {
        console.warn('[app] location watch failed:', e);
        if (!cancelled) setLocationReady(true);
      }
    })();
    return () => {
      cancelled = true;
      watchRef.current?.remove();
      watchRef.current = null;
    };
  }, []);

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

  const value = useMemo<AppContextValue>(
    () => ({
      deviceId,
      deviceToken,
      user,
      setUser,
      adoptIdentity,
      location,
      locationReady,
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
      deviceId, deviceToken, user, adoptIdentity, location, locationReady, demoMode, mockLocation,
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
