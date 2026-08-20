import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Screen } from '@/components/Screen';
import { NightSky } from '@/components/NightSky';
import { GlowDot } from '@/components/GlowDot';
import { LetterOverlay } from '@/components/LetterOverlay';
import { DemoPanel } from '@/components/DemoPanel';
import { useApp } from '@/contexts/AppContext';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { haversineMeters } from '@/utils/haversine';

const MOOD_LINES = [
  '它们藏在路灯下、台阶上、风里',
  '也许有一句，正等着你路过',
  '不着急，最好的偶遇都走得慢',
  '今晚的校园，比白天多了一点秘密',
  '换一条没走过的路试试',
];

const ENCOUNTER_RADIUS_M = 50;

function BreathingNumber({ value }: { value: number }) {
  const breath = useSharedValue(0);
  useEffect(() => {
    breath.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 3200, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, [breath]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.75 + breath.value * 0.25,
    transform: [{ scale: 1 + breath.value * 0.03 }],
  }));
  return (
    <Animated.Text
      style={[
        {
          fontFamily: 'NotoSerifSC_300Light',
          fontSize: 118,
          color: '#FFE3A3',
          textShadowColor: 'rgba(245,194,107,0.55)',
          textShadowRadius: 36,
          includeFontPadding: false,
        },
        style,
      ]}
    >
      {value}
    </Animated.Text>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const {
    location,
    locationReady,
    demoMode,
    aliveMessages,
    aliveTotal,
    refreshMessages,
    readIds,
    user,
  } = useApp();

  const [moodIndex, setMoodIndex] = useState(0);
  const [encounterId, setEncounterId] = useState<string | null>(null);
  const [letterId, setLetterId] = useState<string | null>(null);
  const [panelVisible, setPanelVisible] = useState(false);

  // 页面聚焦时刷新存活列表
  useFocusEffect(
    React.useCallback(() => {
      refreshMessages();
    }, [refreshMessages])
  );

  // 氛围文案轮换
  useEffect(() => {
    const timer = setInterval(() => setMoodIndex((i) => (i + 1) % MOOD_LINES.length), 6000);
    return () => clearInterval(timer);
  }, []);

  // 偶遇感应：与存活留言做 Haversine 距离判定
  useEffect(() => {
    if (!location) {
      setEncounterId(null);
      return;
    }
    let nearest: string | null = null;
    let nearestDist = Infinity;
    for (const m of aliveMessages) {
      if (readIds.has(m.id)) continue;
      const d = haversineMeters(location.lat, location.lng, m.lat, m.lng);
      if (d <= ENCOUNTER_RADIUS_M && d < nearestDist) {
        nearest = m.id;
        nearestDist = d;
      }
    }
    if (nearest && nearest !== encounterId && Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
    setEncounterId(nearest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, aliveMessages, readIds]);

  const waitingText = useMemo(() => (aliveTotal > 0 ? '条留言正在等待' : '条留言刚刚都消散了'), [aliveTotal]);

  return (
    <Screen backgroundColor="#0B0E23" safeAreaEdges={['left', 'right', 'bottom']}>
      <NightSky />
      <View style={{ flex: 1, paddingTop: insets.top + 12 }}>
        {/* 顶部栏 */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 }}>
          <View style={{ width: 44 }}>
            {demoMode && (
              <TouchableOpacity
                onPress={() => setPanelVisible((v) => !v)}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(245,194,107,0.12)',
                  borderWidth: 1,
                  borderColor: 'rgba(245,194,107,0.35)',
                }}
              >
                <FontAwesome6 name="location-crosshairs" size={17} color="#F5C26B" />
              </TouchableOpacity>
            )}
          </View>
          <Text style={{ color: 'rgba(237,231,246,0.5)', fontSize: 13, letterSpacing: 4, fontFamily: 'MaShanZheng_400Regular' }}>
            此地有话
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/profile')}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(255,255,255,0.06)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.10)',
            }}
          >
            <FontAwesome6 name="user" size={16} color="#EDE7F6" />
          </TouchableOpacity>
        </View>

        {/* 守候区 */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          {encounterId ? (
            <Animated.View entering={FadeIn.duration(600)} exiting={FadeOut.duration(400)} style={{ alignItems: 'center' }}>
              <GlowDot onPress={() => setLetterId(encounterId)} />
            </Animated.View>
          ) : (
            <Animated.View entering={FadeIn.duration(800)} style={{ alignItems: 'center' }}>
              <Text
                style={{
                  fontFamily: 'MaShanZheng_400Regular',
                  fontSize: 20,
                  color: 'rgba(237,231,246,0.85)',
                  letterSpacing: 2,
                }}
              >
                此刻，校园的某个角落
              </Text>
              <View style={{ marginVertical: 8 }}>
                <BreathingNumber value={aliveTotal} />
              </View>
              <Text
                style={{
                  fontFamily: 'NotoSerifSC_600SemiBold',
                  fontSize: 16,
                  color: 'rgba(237,231,246,0.75)',
                  letterSpacing: 3,
                }}
              >
                {waitingText}
              </Text>
              <Animated.Text
                key={moodIndex}
                entering={FadeIn.duration(900)}
                style={{
                  marginTop: 40,
                  fontFamily: 'MaShanZheng_400Regular',
                  fontSize: 15,
                  color: 'rgba(142,139,163,0.9)',
                  letterSpacing: 1.5,
                }}
              >
                {MOOD_LINES[moodIndex]}
              </Animated.Text>
              {locationReady && !location && (
                <Text style={{ marginTop: 20, fontSize: 12, color: 'rgba(142,139,163,0.7)', letterSpacing: 1 }}>
                  正在寻找你的位置……找不到的话，去「我的」连点版本号 5 次试试演示模式
                </Text>
              )}
            </Animated.View>
          )}
        </View>

        {/* 底部 + 按钮 */}
        <View style={{ alignItems: 'center', paddingBottom: 28 }}>
          <TouchableOpacity
            onPress={() => router.push('/compose')}
            activeOpacity={0.85}
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#F5C26B',
              shadowColor: '#F5C26B',
              shadowOpacity: 0.5,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 0 },
              elevation: 10,
            }}
          >
            <FontAwesome6 name="plus" size={22} color="#0B0E23" />
          </TouchableOpacity>
          {user && (
            <Text style={{ marginTop: 12, fontSize: 12, color: 'rgba(142,139,163,0.8)', letterSpacing: 1 }}>
              你是「{user.flower_name}」
            </Text>
          )}
        </View>
      </View>

      {demoMode && panelVisible && <DemoPanel onClose={() => setPanelVisible(false)} />}
      {letterId && <LetterOverlay messageId={letterId} onClose={() => setLetterId(null)} />}
    </Screen>
  );
}
