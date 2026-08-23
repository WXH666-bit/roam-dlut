import type { RefObject } from 'react';
import type { View } from 'react-native';

export type ShareResult = 'shared' | 'fallback' | 'silent';

export interface ShareSecretOptions {
  cardRef: RefObject<View | null>;
  prefillText: string;
}

// web 实现（native 走 ./shareSecret.native.ts）：有系统分享就直接用，否则让调用方展示复制层。
// 卡片截图是 native-only，web 分享只发预填文案。
export async function shareSecretCard({ prefillText }: ShareSecretOptions): Promise<ShareResult> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: '此地有话', text: prefillText });
    } catch {
      // 用户取消或分享失败：静默
    }
    return 'shared';
  }
  return 'fallback';
}

export async function copyShareText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
