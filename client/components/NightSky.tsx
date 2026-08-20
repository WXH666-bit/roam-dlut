import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';

interface Star {
  left: string;
  top: string;
  size: number;
  opacity: number;
}

// 确定性伪随机（同一渲染稳定）
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const makeStars = (count: number, seed: number): Star[] => {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => ({
    left: `${rand() * 100}%`,
    top: `${rand() * 100}%`,
    size: 1 + rand() * 2,
    opacity: 0.25 + rand() * 0.55,
  }));
};

function DriftGlow({ delay, left, top, size }: { delay: number; left: string; top: string; size: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      progress.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 9000, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        false
      );
    }, delay);
    return () => clearTimeout(timer);
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * 36 - 18 },
      { translateY: progress.value * -26 + 13 },
    ],
    opacity: 0.5 + progress.value * 0.3,
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: left as DimensionValue,
          top: top as DimensionValue,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: 'rgba(245,194,107,0.10)',
          shadowColor: '#F5C26B',
          shadowOpacity: 0.5,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 0 },
        },
        style,
      ]}
    />
  );
}

/** 夜空背景：蓝紫渐变 + 星点 + 缓慢漂移的远光 */
export function NightSky({ children }: { children?: React.ReactNode }) {
  const stars = useMemo(() => makeStars(70, 20240501), []);
  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={['#0B0E23', '#141637', '#1A1C3E']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      {stars.map((s, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: s.left as never,
            top: s.top as never,
            width: s.size,
            height: s.size,
            borderRadius: s.size,
            backgroundColor: '#EDE7F6',
            opacity: s.opacity,
          }}
        />
      ))}
      <DriftGlow delay={0} left="12%" top="18%" size={90} />
      <DriftGlow delay={3000} left="68%" top="58%" size={120} />
      <DriftGlow delay={6000} left="30%" top="76%" size={70} />
      {children}
    </View>
  );
}
