import React, { useEffect } from 'react';
import { TouchableOpacity } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

interface Props {
  onPress: () => void;
  compact?: boolean;
  accessibilityLabel?: string;
  animationIndex?: number;
}

/** 一条附近留言对应一个可点击的暖金光点。 */
export function GlowDot({
  onPress,
  compact = false,
  accessibilityLabel,
  animationIndex = 0,
}: Props) {
  const float = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    const floatDuration = 2500 + (animationIndex % 4) * 230;
    const pulseDuration = 1400 + (animationIndex % 5) * 170;
    const delay = (animationIndex % 5) * 110;
    float.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: floatDuration, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: floatDuration, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        false
      ),
    );
    pulse.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: pulseDuration, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: pulseDuration, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        false
      ),
    );
  }, [animationIndex, float, pulse]);

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
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={compact ? 6 : 0}
      style={{ alignItems: 'center' }}
    >
      <Animated.View style={[
        {
          alignItems: 'center',
          justifyContent: 'center',
          width: compact ? 64 : 88,
          height: compact ? 64 : 88,
        },
        floatStyle,
      ]}>
        <Animated.View
          style={[
            {
              position: 'absolute',
              width: compact ? 50 : 72,
              height: compact ? 50 : 72,
              borderRadius: compact ? 25 : 36,
              backgroundColor: 'rgba(245,194,107,0.30)',
            },
            haloStyle,
          ]}
        />
        <Animated.View
          style={[
            {
              width: compact ? 16 : 20,
              height: compact ? 16 : 20,
              borderRadius: compact ? 8 : 10,
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
    </TouchableOpacity>
  );
}
