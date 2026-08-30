import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { Screen } from '@/components/Screen';
import { NightSky } from '@/components/NightSky';
import { useApp } from '@/contexts/AppContext';
import { useHandwritingFont } from '@/contexts/FontContext';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { renameFlowerName } from '@/utils/api';

interface GuidePage {
  key: string;
  title: string;
  sub: string;
}

/** 首次启动引导：3 屏讲清核心机制 → 起花名 → 进守候界面。仅出现一次（cidi:onboarded） */
export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const handwriting = useHandwritingFont();
  const { width } = useWindowDimensions();
  const { user, deviceId, readLimit, completeOnboarding } = useApp();

  const [pageIndex, setPageIndex] = useState(0);
  const [step, setStep] = useState<'guide' | 'name'>('guide');

  const pages: GuidePage[] = [
    { key: 'p1', title: '这座城市藏着一些话', sub: '没有地图，没有提示，它们散落在校园各处' },
    { key: 'p2', title: '走近 50 米，才会遇见', sub: '路过某个转角时，App 会轻轻震动，信会浮现' },
    { key: 'p3', title: `每封信，只能被 ${readLimit} 个人读到`, sub: '读满就会消散。有些话，错过就是错过了' },
  ];

  // 拖动过半即切换页码，让下一屏文字随滑动淡入；同值 setState 会被 React 跳过
  const syncPageIndex = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.max(0, Math.min(Math.round(e.nativeEvent.contentOffset.x / width), pages.length - 1));
    setPageIndex((prev) => (prev === i ? prev : i));
  };

  if (step === 'name') {
    return (
      <NameStep
        autoName={user?.flower_name ?? ''}
        deviceId={deviceId}
        disabled={!deviceId}
        onDone={async () => {
          await completeOnboarding();
          router.replace('/');
        }}
      />
    );
  }

  return (
    <Screen backgroundColor="#0B0E23" safeAreaEdges={['left', 'right', 'bottom']}>
      <NightSky />
      <View style={{ flex: 1, paddingTop: insets.top + 12 }}>
        {/* 跳过：同样进入起名流程 */}
        <View style={{ alignItems: 'flex-end', paddingHorizontal: 20, height: 40, justifyContent: 'center' }}>
          <TouchableOpacity onPress={() => setStep('name')} hitSlop={12}>
            <Text style={{ color: 'rgba(142,139,163,0.85)', fontSize: 13, letterSpacing: 2 }}>跳过</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={pages}
          keyExtractor={(p) => p.key}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={syncPageIndex}
          scrollEventThrottle={32}
          onMomentumScrollEnd={syncPageIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          renderItem={({ item, index }) => (
            <View style={{ width, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
              {index === pageIndex && (
                <Animated.View key={item.key} entering={FadeIn.duration(700)} style={{ alignItems: 'center' }}>
                  <Text
                    style={{
                      fontFamily: handwriting,
                      fontSize: 26,
                      color: '#EDE7F6',
                      letterSpacing: 2,
                      textAlign: 'center',
                      textShadowColor: 'rgba(245,194,107,0.25)',
                      textShadowRadius: 18,
                    }}
                  >
                    {item.title}
                  </Text>
                  <Text
                    style={{
                      marginTop: 20,
                      fontFamily: handwriting,
                      fontSize: 15,
                      color: 'rgba(142,139,163,0.95)',
                      letterSpacing: 1.5,
                      textAlign: 'center',
                      lineHeight: 24,
                    }}
                  >
                    {item.sub}
                  </Text>
                </Animated.View>
              )}
            </View>
          )}
        />

        {/* 页码点 */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 18 }}>
          {pages.map((p, i) => (
            <View
              key={p.key}
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === pageIndex ? '#F5C26B' : 'rgba(142,139,163,0.35)',
              }}
            />
          ))}
        </View>

        {/* 末屏主按钮，其余屏留出同高空间避免跳动 */}
        <View style={{ alignItems: 'center', paddingBottom: 44, minHeight: 76 }}>
          {pageIndex === pages.length - 1 && (
            <Animated.View entering={FadeIn.duration(500)}>
              <TouchableOpacity
                onPress={() => setStep('name')}
                activeOpacity={0.85}
                style={{
                  paddingVertical: 13,
                  paddingHorizontal: 40,
                  borderRadius: 24,
                  backgroundColor: '#F5C26B',
                  shadowColor: '#F5C26B',
                  shadowOpacity: 0.45,
                  shadowRadius: 20,
                  shadowOffset: { width: 0, height: 0 },
                  elevation: 8,
                }}
              >
                <Text style={{ fontFamily: handwriting, fontSize: 16, color: '#0B0E23', letterSpacing: 2 }}>
                  去起个花名吧
                </Text>
              </TouchableOpacity>
            </Animated.View>
          )}
        </View>
      </View>
    </Screen>
  );
}

/** 起名步：预填系统花名，可改（消耗唯一一次改名机会）；留空则沿用系统给的 */
function NameStep({
  autoName,
  deviceId,
  disabled,
  onDone,
}: {
  autoName: string;
  deviceId: string | null;
  disabled: boolean;
  onDone: () => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const handwriting = useHandwritingFont();
  const { setUser } = useApp();
  const [name, setName] = useState(autoName);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  // 注册结果晚到时用系统花名预填（用户已动手则不覆盖）
  useEffect(() => {
    if (!touched && autoName) setName(autoName);
  }, [autoName, touched]);

  const submit = async () => {
    if (busy || disabled) return;
    const trimmed = name.trim();
    if (trimmed.length > 12) {
      Toast.show({ type: 'info', text1: '花名需为 1-12 个字符' });
      return;
    }
    setBusy(true);
    try {
      if (trimmed && trimmed !== autoName && deviceId) {
        try {
          const u = await renameFlowerName(deviceId, trimmed);
          setUser(u);
        } catch {
          // 改名失败不消耗唯一机会，进首页后可去「我的」再改
          Toast.show({ type: 'info', text1: '花名没改成，先用系统给的，之后还能改' });
        }
      }
      await onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen backgroundColor="#0B0E23" safeAreaEdges={['left', 'right', 'bottom']}>
      <NightSky />
      <View style={{ flex: 1, paddingTop: insets.top + 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 }}>
        <Animated.View entering={FadeIn.duration(700)} style={{ alignItems: 'center', width: '100%' }}>
          <Text
            style={{
              fontFamily: handwriting,
              fontSize: 24,
              color: '#EDE7F6',
              letterSpacing: 2,
              textAlign: 'center',
            }}
          >
            在这里，你只有一个花名
          </Text>
          <Text
            style={{
              marginTop: 16,
              fontFamily: handwriting,
              fontSize: 14,
              color: 'rgba(142,139,163,0.95)',
              letterSpacing: 1.5,
              textAlign: 'center',
              lineHeight: 22,
            }}
          >
            不留真名，不留头像{'\n'}信被读到时，对方只知道这个名字
          </Text>
          <TextInput
            value={name}
            onChangeText={(t) => {
              setTouched(true);
              setName(t);
            }}
            maxLength={12}
            placeholder={autoName || '1-12 个字符'}
            placeholderTextColor="rgba(142,139,163,0.5)"
            style={{
              marginTop: 32,
              width: '100%',
              maxWidth: 320,
              borderRadius: 14,
              paddingHorizontal: 16,
              paddingVertical: 13,
              fontSize: 17,
              fontFamily: handwriting,
              letterSpacing: 1,
              textAlign: 'center',
              color: '#FFE3A3',
              backgroundColor: 'rgba(255,255,255,0.06)',
              borderWidth: 1,
              borderColor: 'rgba(245,194,107,0.30)',
              ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as never) : {}),
            }}
          />
          <TouchableOpacity
            onPress={submit}
            disabled={busy || disabled}
            activeOpacity={0.85}
            style={{
              marginTop: 26,
              paddingVertical: 13,
              paddingHorizontal: 44,
              borderRadius: 24,
              backgroundColor: busy || disabled ? 'rgba(245,194,107,0.35)' : '#F5C26B',
              shadowColor: '#F5C26B',
              shadowOpacity: 0.45,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 0 },
              elevation: 8,
            }}
          >
            <Text style={{ fontFamily: handwriting, fontSize: 16, color: '#0B0E23', letterSpacing: 2 }}>
              {busy ? '落笔中……' : '就叫这个，进去看看'}
            </Text>
          </TouchableOpacity>
          <Text
            style={{
              marginTop: 14,
              maxWidth: 320,
              fontSize: 10.5,
              lineHeight: 17,
              textAlign: 'center',
              color: 'rgba(142,139,163,0.72)',
            }}
          >
            继续即表示你同意：授予系统位置权限后，Here 使用高德定位 SDK
            处理位置、设备及网络信息，用于前后台定位与附近提醒；可随时在系统设置中关闭。
          </Text>
        </Animated.View>
      </View>
    </Screen>
  );
}
