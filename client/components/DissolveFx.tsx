import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useHandwritingFont } from '@/contexts/FontContext';

const GOLD = ['#FFE3A3', '#F5C26B', '#E8A94E'];
const COUNT = 20;
// 整场约 2.4s 内收尾（最后一颗 delay+duration 不超 2400ms）
const MAX_TOTAL_MS = 2400;

interface ParticleSpec {
  left: number;
  top: number;
  size: number;
  rise: number;
  sway: number;
  delay: number;
  duration: number;
  color: string;
}

interface Props {
  /** 播完自动回调（父组件据此卸载本层） */
  onDone?: () => void;
  /** 演示用途的中央说明文案；真实消散场景不传 */
  note?: string;
}

/** 消散告别层：金色光点自中下部上浮、轻摆、渐隐，叠加信纸轮廓淡出。pointerEvents=none，不阻塞交互 */
export function DissolveFx({ onDone, note }: Props) {
  const { width, height } = useWindowDimensions();
  // 粒子参数含随机值，只能在 effect 里生成（渲染期必须纯净），首帧无粒子肉眼不可辨
  const [particles, setParticles] = useState<ParticleSpec[]>([]);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const specs = Array.from({ length: COUNT }, (_, i) => ({
      left: 0.18 + Math.random() * 0.64,
      top: 0.55 + Math.random() * 0.2,
      size: 2 + Math.random() * 3,
      rise: 130 + Math.random() * 100,
      sway: 10 + Math.random() * 14,
      delay: i * 14 + Math.random() * 160,
      duration: 1500 + Math.random() * 500,
      color: GOLD[i % GOLD.length],
    }));
    const last = Math.max(...specs.map((p) => p.delay + p.duration), MAX_TOTAL_MS);
    // 异步回填，避免 effect 体内同步 setState 造成级联渲染
    const show = setTimeout(() => setParticles(specs), 30);
    const done = setTimeout(() => onDoneRef.current?.(), last + 80);
    return () => {
      clearTimeout(show);
      clearTimeout(done);
    };
  }, []);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <PaperGhost width={width} height={height} />
      {particles.map((p, i) => (
        <Particle key={i} spec={p} width={width} height={height} />
      ))}
      {note && (
        <Animated.View
          entering={FadeIn.delay(450).duration(500)}
          style={{ position: 'absolute', left: 0, right: 0, top: height * 0.42, alignItems: 'center', paddingHorizontal: 40 }}
        >
          <NoteText text={note} />
        </Animated.View>
      )}
    </View>
  );
}

function NoteText({ text }: { text: string }) {
  const handwriting = useHandwritingFont();
  return (
    <Text style={{ fontFamily: handwriting, fontSize: 15, color: 'rgba(237,231,246,0.8)', letterSpacing: 2, textAlign: 'center' }}>
      {text}
    </Text>
  );
}

function Particle({ spec, width, height }: { spec: ParticleSpec; width: number; height: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(
      spec.delay,
      withTiming(1, { duration: spec.duration, easing: Easing.out(Easing.quad) })
    );
  }, [p, spec]);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - p.value,
    transform: [
      { translateX: spec.sway * Math.sin(p.value * Math.PI) },
      { translateY: -spec.rise * p.value },
    ],
  }));
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: spec.left * width,
          top: spec.top * height,
          width: spec.size,
          height: spec.size,
          borderRadius: spec.size / 2,
          backgroundColor: spec.color,
          shadowColor: '#F5C26B',
          shadowOpacity: 0.9,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 0 },
        },
        style,
      ]}
    />
  );
}

/** 信纸轮廓：低透明度米白圆角卡，放大一点同时淡出，模拟"信散成光" */
function PaperGhost({ width, height }: { width: number; height: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) });
  }, [p]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.14 * (1 - p.value),
    transform: [{ scale: 1 + 0.1 * p.value }],
  }));
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: width / 2 - 105,
          top: height * 0.3,
          width: 210,
          height: 270,
          borderRadius: 24,
          backgroundColor: '#F6EFDD',
        },
        style,
      ]}
    />
  );
}
