import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as Haptics from 'expo-haptics';
import dayjs from 'dayjs';
import { useApp } from '@/contexts/AppContext';
import { likeMessage, openMessage, type MessageDetail } from '@/utils/api';
import { playDissolve } from '@/utils/sound';
import { DissolveFx } from './DissolveFx';
import { RichText } from './RichText';
import { useHandwritingFont } from '@/contexts/FontContext';
import { StickerIcon } from './StickerIcon';

interface Props {
  messageId: string;
  onClose: () => void;
}

const INK = '#3E3626';
const INK_SOFT = '#6B5F45';
const PAPER = '#F6EFDD';

/** 开信：光点绽放 → 信纸展开 → 花名浮现 → 文字逐行 → 媒体与名额收尾 */
export function LetterOverlay({ messageId, onClose }: Props) {
  const handwriting = useHandwritingFont();
  const { deviceId, deviceToken, markRead, readIds } = useApp();
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [dissolved, setDissolved] = useState(false);
  const [likes, setLikes] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  // 消散告别：idle=正常读信；fx=光点告别中（信纸淡出）；gone=只留告别语
  const [dissolveStage, setDissolveStage] = useState<'idle' | 'fx' | 'gone'>('idle');
  const [fxAlive, setFxAlive] = useState(false);
  // 本次打开是否为首次有效阅读（已读过再打开不重播告别）
  const firstReadRef = useRef(false);

  const burstScale = useSharedValue(0.15);
  const burstOpacity = useSharedValue(0);
  const cardOpacity = useSharedValue(1);

  useEffect(() => {
    // 第一幕：光点绽放
    burstScale.value = withTiming(3.2, { duration: 650, easing: Easing.out(Easing.cubic) });
    burstOpacity.value = withSequence(
      withTiming(0.95, { duration: 220 }),
      withTiming(0, { duration: 430, easing: Easing.in(Easing.quad) })
    );
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }

    (async () => {
      if (!deviceId) return;
      try {
        const d = await openMessage(messageId, deviceId, deviceToken);
        firstReadRef.current = !readIds.has(messageId);
        setDetail(d);
        setLikes(d.likes);
        setLiked(d.liked);
        markRead(messageId);
      } catch (e) {
        // 410：刚被别人读完最后名额，或它到时间了
        setDissolved(true);
        markRead(messageId);
        console.warn('[letter] open failed:', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId, deviceId, deviceToken]);

  const burstStyle = useAnimatedStyle(() => ({
    transform: [{ scale: burstScale.value }],
    opacity: burstOpacity.value,
  }));

  const cardFadeStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
  }));

  const lines = useMemo(() => (detail ? detail.text.split('\n').filter((l) => l.trim().length > 0) : []), [detail]);

  const textDoneDelay = 900 + lines.length * 150 + 200;

  // 最后名额 + 本机首次阅读：收尾文案停顿 800ms 后播告别动画与音效（仅原生端），信纸淡出后留告别语
  useEffect(() => {
    if (!detail || detail.remaining !== 0 || !firstReadRef.current || Platform.OS === 'web') return;
    const start = textDoneDelay + 200 + 800;
    const t1 = setTimeout(() => {
      setDissolveStage('fx');
      setFxAlive(true);
      playDissolve();
      cardOpacity.value = withTiming(0, { duration: 900, easing: Easing.in(Easing.quad) });
    }, start);
    const t2 = setTimeout(() => setDissolveStage('gone'), start + 1500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [detail, textDoneDelay, cardOpacity]);

  const onLike = async () => {
    if (!deviceId || !detail || liked || likeBusy) return;
    setLikeBusy(true);
    try {
      const r = await likeMessage(detail.id, deviceId, deviceToken);
      setLikes(r.likes);
      setLiked(true);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      }
    } catch {
      // 点赞失败保持原状
    } finally {
      setLikeBusy(false);
    }
  };

  return (
    <Modal transparent animationType="none" visible onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(11,14,35,0.94)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        {/* 绽放光点 */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: 26,
              height: 26,
              borderRadius: 13,
              backgroundColor: '#FFE3A3',
              shadowColor: '#F5C26B',
              shadowOpacity: 1,
              shadowRadius: 30,
              shadowOffset: { width: 0, height: 0 },
            },
            burstStyle,
          ]}
        />

        {dissolved && (
          <Animated.View entering={FadeIn.duration(500)} style={{ alignItems: 'center' }}>
            <StickerIcon id="moon" size={44} />
            <Text style={{ color: '#8E8BA3', fontSize: 15, marginTop: 16, fontFamily: handwriting, letterSpacing: 1 }}>
              你来晚了一步，它刚刚消散在风里了
            </Text>
            <TouchableOpacity onPress={onClose} style={{ marginTop: 28, paddingVertical: 10, paddingHorizontal: 28, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(245,194,107,0.35)' }}>
              <Text style={{ color: '#F5C26B', fontSize: 14 }}>知道了</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {!dissolved && !detail && <ActivityIndicator color="#F5C26B" style={{ marginTop: 200 }} />}

        {!dissolved && detail && (
          <Animated.View
            entering={FadeIn.duration(450).delay(300)}
            style={[
              {
                width: '100%',
                maxWidth: 420,
                maxHeight: '86%',
                backgroundColor: PAPER,
                borderRadius: 24,
                overflow: 'hidden',
                shadowColor: '#F5C26B',
                shadowOpacity: 0.25,
                shadowRadius: 40,
                shadowOffset: { width: 0, height: 0 },
                elevation: 12,
              },
              cardFadeStyle,
            ]}
          >
            <ScrollView contentContainerStyle={{ padding: 26, paddingBottom: 30 }}>
              {/* 花名浮现 */}
              <Animated.View entering={FadeInUp.delay(650).duration(350)} style={{ alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ fontFamily: handwriting, fontSize: 22, color: INK, letterSpacing: 1 }}>
                  {detail.flower_name}
                </Text>
                <Text style={{ fontSize: 12, color: INK_SOFT, marginTop: 6, letterSpacing: 1 }}>
                  {dayjs(detail.created_at).format('YYYY年M月D日 HH:mm')} 藏下
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 4 }}>
                  <View style={{ width: 36, height: 1, backgroundColor: 'rgba(62,54,38,0.25)' }} />
                  <View style={{ marginHorizontal: 10 }}>
                    <StickerIcon id="envelope" size={20} />
                  </View>
                  <View style={{ width: 36, height: 1, backgroundColor: 'rgba(62,54,38,0.25)' }} />
                </View>
              </Animated.View>

              {/* 文字逐行显现 */}
              {lines.map((line, i) => (
                <Animated.View key={i} entering={FadeInUp.delay(900 + i * 150).duration(320)} style={{ marginTop: i === 0 ? 8 : 0 }}>
                  <RichText text={line} fontSize={16.5} lineHeight={30} color={INK} />
                </Animated.View>
              ))}

              {/* 多媒体 */}
              {detail.media_type === 'image' && detail.media_url && (
                <Animated.View entering={FadeIn.delay(textDoneDelay).duration(400)} style={{ marginTop: 18 }}>
                  <Image
                    source={{ uri: detail.media_url }}
                    style={{ width: '100%', height: 210, borderRadius: 14, backgroundColor: 'rgba(62,54,38,0.08)' }}
                    contentFit="cover"
                  />
                </Animated.View>
              )}
              {detail.media_type === 'video' && detail.media_url && (
                <Animated.View entering={FadeIn.delay(textDoneDelay).duration(400)} style={{ marginTop: 18 }}>
                  <LetterVideo uri={detail.media_url} />
                </Animated.View>
              )}

              {/* 收尾：剩余名额 + 点赞 */}
              <Animated.View entering={FadeInUp.delay(textDoneDelay + 200).duration(350)} style={{ marginTop: 22, alignItems: 'center' }}>
                <Text style={{ fontSize: 12.5, color: INK_SOFT, letterSpacing: 0.5 }}>
                  {detail.remaining > 0
                    ? `这条留言还能被 ${detail.remaining} 人读到`
                    : '你是最后一个读到它的人'}
                </Text>
                <TouchableOpacity
                  onPress={onLike}
                  disabled={liked || likeBusy}
                  activeOpacity={0.7}
                  style={{
                    marginTop: 14,
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 9,
                    paddingHorizontal: 22,
                    borderRadius: 999,
                    backgroundColor: liked ? 'rgba(245,194,107,0.25)' : 'rgba(62,54,38,0.06)',
                    borderWidth: 1,
                    borderColor: liked ? 'rgba(245,194,107,0.7)' : 'rgba(62,54,38,0.15)',
                  }}
                >
                  <StickerIcon id="heart" size={18} />
                  <Text style={{ marginLeft: 7, fontSize: 14, color: INK, fontWeight: '600' }}>
                    {liked ? `已喜欢 · ${likes}` : `喜欢 · ${likes}`}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            </ScrollView>
          </Animated.View>
        )}

        {/* 消散告别层（不阻塞交互）与告别语 */}
        {fxAlive && <DissolveFx onDone={() => setFxAlive(false)} />}
        {dissolveStage === 'gone' && (
          <Animated.View
            entering={FadeIn.duration(600)}
            style={{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' }}
            pointerEvents="none"
          >
            <StickerIcon id="moon" size={40} />
            <Text style={{ color: '#8E8BA3', fontSize: 15, marginTop: 14, fontFamily: handwriting, letterSpacing: 1 }}>
              这条留言已随风消散
            </Text>
          </Animated.View>
        )}

        {/* 关闭 */}
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 56, right: 28, padding: 8 }}>
          <Text style={{ color: 'rgba(237,231,246,0.6)', fontSize: 15 }}>收起</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function LetterVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return (
    <VideoView
      player={player}
      style={{ width: '100%', height: 210, borderRadius: 14, backgroundColor: 'rgba(62,54,38,0.08)' }}
      contentFit="cover"
      nativeControls
    />
  );
}
