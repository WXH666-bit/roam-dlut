import type { RefObject } from 'react';
import type { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

export type ShareResult = 'shared' | 'fallback' | 'silent';

export interface ShareSecretOptions {
  cardRef: RefObject<View | null>;
  prefillText: string;
}

// 截藏话卡 → 调系统分享面板。失败/取消一律静默，不影响发布主流程。
export async function shareSecretCard({ cardRef }: ShareSecretOptions): Promise<ShareResult> {
  try {
    const uri = await captureRef(cardRef, {
      format: 'png',
      quality: 1,
      width: 1080,
      height: 1440,
      result: 'tmpfile',
    });
    if (!(await Sharing.isAvailableAsync())) return 'silent';
    await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: '分享这个秘密' });
    return 'shared';
  } catch {
    return 'silent';
  }
}

// native 不会进入 web 的复制降级层，此导出仅为保持接口一致
export async function copyShareText(_text: string): Promise<boolean> {
  return false;
}
