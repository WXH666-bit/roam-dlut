import React, { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { ShareCard, SHARE_CARD_H, SHARE_CARD_W } from './ShareCard';
import { copyShareText, shareSecretCard } from '@/utils/shareSecret';
import { useHandwritingFont } from '@/contexts/FontContext';

const PREFILL = '我在大工藏了一句话，50米内才能遇见。来找我';

interface Props {
  flowerName: string;
  dateText: string;
  variant: 'button' | 'icon';
  style?: StyleProp<ViewStyle>;
}

/**
 * 「分享这个秘密」入口：原生端截藏话卡调系统分享面板；
 * web 端优先 navigator.share，不行则展示预填文案 + 一键复制。
 */
export function ShareSecretEntry({ flowerName, dateText, variant, style }: Props) {
  const handwriting = useHandwritingFont();
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const [fallbackOpen, setFallbackOpen] = useState(false);

  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await shareSecretCard({ cardRef, prefillText: PREFILL });
      if (r === 'fallback') setFallbackOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async () => {
    const ok = await copyShareText(PREFILL);
    Toast.show({ type: ok ? 'success' : 'info', text1: ok ? '已复制，去粘贴吧' : '复制失败，长按手动复制' });
    if (ok) setFallbackOpen(false);
  };

  return (
    <>
      {variant === 'button' ? (
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.8}
          style={[
            {
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingVertical: 12,
              paddingHorizontal: 26,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: 'rgba(245,194,107,0.45)',
              backgroundColor: 'rgba(245,194,107,0.08)',
            },
            style,
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#F5C26B" />
          ) : (
            <FontAwesome6 name="share-nodes" size={14} color="#F5C26B" />
          )}
          <Text style={{ fontSize: 14.5, color: '#F5C26B', fontFamily: handwriting, letterSpacing: 1 }}>分享这个秘密</Text>
        </TouchableOpacity>
      ) : (
        <Pressable onPress={onPress} hitSlop={10} style={[{ padding: 8 }, style]}>
          {busy ? (
            <ActivityIndicator size="small" color="rgba(237,231,246,0.6)" />
          ) : (
            <FontAwesome6 name="share-nodes" size={15} color="rgba(237,231,246,0.6)" />
          )}
        </Pressable>
      )}

      {/* 隐藏渲染的藏话卡：仅 native 截图用，web 不需要 */}
      {Platform.OS !== 'web' && (
        <View pointerEvents="none" style={{ position: 'absolute', left: -SHARE_CARD_W - 100, top: 0, width: SHARE_CARD_W, height: SHARE_CARD_H }}>
          <ShareCard ref={cardRef} flowerName={flowerName} dateText={dateText} />
        </View>
      )}

      {/* web 降级：预填文案 + 一键复制 */}
      {fallbackOpen && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setFallbackOpen(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(11,14,35,0.9)', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
            <View style={{ width: '100%', maxWidth: 380, borderRadius: 18, padding: 24, backgroundColor: '#1A1C3E', borderWidth: 1, borderColor: 'rgba(245,194,107,0.25)' }}>
              <Text style={{ fontFamily: handwriting, fontSize: 17, color: '#FFE3A3', letterSpacing: 1 }}>把这句话带给朋友</Text>
              <Text selectable style={{ marginTop: 16, fontSize: 14.5, lineHeight: 24, color: '#EDE7F6' }}>
                {PREFILL}
              </Text>
              <Text style={{ marginTop: 12, fontSize: 12, lineHeight: 19, color: 'rgba(142,139,163,0.9)' }}>
                藏话卡图片请在 App 端生成分享
              </Text>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 22 }}>
                <TouchableOpacity onPress={() => setFallbackOpen(false)} style={{ paddingVertical: 8, paddingHorizontal: 14 }}>
                  <Text style={{ fontSize: 13.5, color: '#8E8BA3' }}>算了</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={onCopy}
                  style={{ paddingVertical: 8, paddingHorizontal: 20, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(245,194,107,0.45)' }}
                >
                  <Text style={{ fontSize: 13.5, color: '#F5C26B' }}>一键复制</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}
