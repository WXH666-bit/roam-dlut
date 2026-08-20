import React, { useEffect } from 'react';
import { useHandwritingFont } from '@/contexts/FontContext';
import { Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

interface Props {
  onPress: () => void;
}

/** 偶遇光点：暖金色、轻微漂浮、微光呼吸——屏幕上唯一的路标 */
export function GlowDot({ onPress }: Props) {
  const handwriting = useHandwritingFont();
  const float = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    float.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 2800, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, [float, pulse]);

  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: float.value * -16 + 8 }],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.35 }],
    opacity: 0.4 - pulse.value * 0.25,
  }));
  const coreStyle = useAnimatedStyle(() => ({
    opacity: 0.85 + pulse.value * 0.15,
  }));

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{ alignItems: 'center' }}>
      <Animated.View style={[{ alignItems: 'center', justifyContent: 'center', width: 88, height: 88 }, floatStyle]}>
        <Animated.View
          style={[
            {
              position: 'absolute',
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: 'rgba(245,194,107,0.30)',
            },
            haloStyle,
          ]}
        />
        <Animated.View
          style={[
            {
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: '#FFE3A3',
              shadowColor: '#F5C26B',
              shadowOpacity: 0.9,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 0 },
              elevation: 10,
            },
            coreStyle,
          ]}
        />
      </Animated.View>
      <View style={{ marginTop: 4 }}>
        <Text style={{ color: '#F5C26B', fontSize: 13, letterSpacing: 2, fontFamily: handwriting }}>
          附近有一条留言
        </Text>
      </View>
    </TouchableOpacity>
  );
}
