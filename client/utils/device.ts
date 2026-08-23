import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const DEVICE_ID_KEY = 'cidi:device_id';

let cached: string | null = null;

/** 设备唯一 ID：首次生成并持久化，作为匿名身份 */
export const getDeviceId = async (): Promise<string> => {
  if (cached) return cached;
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
  } catch {
    // 读取失败则重新生成
  }
  const id = `dev-${Crypto.randomUUID()}`;
  cached = id;
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  } catch {
    // 持久化失败不阻塞，本次会话内仍可用
  }
  return id;
};

/** 暗号认领后覆写设备身份：更新持久化与内存缓存 */
export const overwriteDeviceId = async (id: string): Promise<void> => {
  cached = id;
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  } catch {
    // 持久化失败不阻塞，本次会话内仍可用
  }
};
