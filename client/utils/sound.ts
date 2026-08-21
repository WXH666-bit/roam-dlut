import { Audio } from 'expo-av';

type SoundKey = 'encounter' | 'dissolve';

const SOURCES: Record<SoundKey, number> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  encounter: require('../assets/sounds/encounter.wav') as number,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  dissolve: require('../assets/sounds/dissolve.wav') as number,
};

const sounds: Partial<Record<SoundKey, Audio.Sound>> = {};

// 音效只是氛围层：任何失败都静默吞掉，绝不影响主流程
const play = async (key: SoundKey, volume: number): Promise<void> => {
  try {
    let s = sounds[key];
    if (!s) {
      s = (await Audio.Sound.createAsync(SOURCES[key], { volume })).sound;
      sounds[key] = s;
    }
    await s.setPositionAsync(0);
    await s.playAsync();
  } catch {
    // 静默
  }
};

/** 偶遇浮现 · 风铃双音（仅原生端调用；iOS 静音键行为跟随系统，expo-av 默认） */
export const playEncounter = (): void => {
  void play('encounter', 0.6);
};

/** 消散 · 下行琶音 */
export const playDissolve = (): void => {
  void play('dissolve', 0.85);
};
