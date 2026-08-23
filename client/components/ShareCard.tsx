import React, { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StickerIcon } from './StickerIcon';
import { useHandwritingFont } from '@/contexts/FontContext';

// 设计稿尺寸（dp），截图按 3x 输出 1080×1440
export const SHARE_CARD_W = 360;
export const SHARE_CARD_H = 480;

interface Props {
  flowerName: string;
  dateText: string;
}

// 与 NightSky 相同的确定性伪随机：截图内容每次渲染一致，且不触发 react-hooks/purity
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const DOTS = (() => {
  const rand = mulberry32(20260822);
  return Array.from({ length: 16 }, () => ({
    left: rand() * 320 + 20,
    top: rand() * 440 + 20,
    size: 1.5 + rand() * 2.5,
    opacity: 0.2 + rand() * 0.5,
    gold: rand() > 0.45,
  }));
})();

/**
 * 藏话卡：用于发布后分享，只承载悬念，不出现留言正文与任何位置线索（产品红线）。
 * 由 ShareSecretEntry 隐藏在屏幕外渲染，react-native-view-shot 截图成 PNG。
 */
export const ShareCard = forwardRef<View, Props>(function ShareCard({ flowerName, dateText }, ref) {
  const handwriting = useHandwritingFont();
  return (
    <View ref={ref} style={styles.card} collapsable={false}>
      <LinearGradient colors={['#0B0E23', '#141637', '#1A1C3E']} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      {DOTS.map((d, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: d.left,
            top: d.top,
            width: d.size,
            height: d.size,
            borderRadius: d.size / 2,
            opacity: d.opacity,
            backgroundColor: d.gold ? '#F5C26B' : '#EDE7F6',
          }}
        />
      ))}
      <View style={styles.frame}>
        <View style={{ marginTop: 44 }}>
          <StickerIcon id="moon" size={56} />
        </View>
        <Text style={[styles.title, { fontFamily: handwriting }]}>我在大工的某个角落，{'\n'}藏了一句话</Text>
        <Text style={styles.subtitle}>走近 50 米，才能遇见它</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.footer}>
          {flowerName} · {dateText} · 「此地有话」
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    width: SHARE_CARD_W,
    height: SHARE_CARD_H,
    overflow: 'hidden',
  },
  frame: {
    flex: 1,
    margin: 16,
    borderWidth: 1,
    borderColor: 'rgba(245,194,107,0.28)',
    borderRadius: 14,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 26,
  },
  title: {
    marginTop: 36,
    fontSize: 23,
    lineHeight: 38,
    color: '#FFE3A3',
    textAlign: 'center',
    letterSpacing: 2,
  },
  subtitle: {
    marginTop: 18,
    fontSize: 13,
    color: 'rgba(237,231,246,0.72)',
    letterSpacing: 1.5,
  },
  footer: {
    fontSize: 11,
    color: 'rgba(142,139,163,0.9)',
    letterSpacing: 1,
    textAlign: 'center',
  },
});
