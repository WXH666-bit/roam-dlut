import { MaShanZheng_400Regular } from '@expo-google-fonts/ma-shan-zheng';
import { useFonts } from 'expo-font';
import React, { createContext, useContext, useMemo, type ReactNode } from 'react';

const HANDWRITING = 'MaShanZheng_400Regular';

const FontContext = createContext<{ handwriting: string | undefined }>({
  handwriting: undefined,
});

// 手写字体体积较大，不阻塞首屏：未加载完成时回退系统字体，加载完成后自动切换
export function FontProvider({ children }: { children: ReactNode }) {
  const [loaded] = useFonts({ [HANDWRITING]: MaShanZheng_400Regular });
  const value = useMemo(
    () => ({ handwriting: loaded ? HANDWRITING : undefined }),
    [loaded]
  );
  return <FontContext.Provider value={value}>{children}</FontContext.Provider>;
}

export function useHandwritingFont(): string | undefined {
  return useContext(FontContext).handwriting;
}
