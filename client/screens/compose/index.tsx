import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Camera } from 'expo-camera';
import { FontAwesome6 } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import dayjs from 'dayjs';
import { Screen } from '@/components/Screen';
import { NightSky } from '@/components/NightSky';
import { ShareSecretEntry } from '@/components/ShareSecretEntry';
import { RichText } from '@/components/RichText';
import { StickerIcon } from '@/components/StickerIcon';
import { useApp } from '@/contexts/AppContext';
import { useHandwritingFont } from '@/contexts/FontContext';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { publishMessage, uploadMedia } from '@/utils/api';
import {
  isFreshLiveLocation,
  LOCATION_COORDINATE_SYSTEM,
  LOCATION_MAX_ACCURACY_METERS,
} from '@/utils/location';
import { STICKERS, stickerToken } from '@/utils/stickers';
import type { MessageMediaType } from '@/utils/messageTypes';

const MAX_LEN = 140;
const INK = '#3E3626';
const PAPER = '#F6EFDD';
// 与服务端 multer 上限（server/src/routes/upload.ts）保持一致
const MEDIA_MAX_BYTES = 120 * 1024 * 1024;

interface PickedMedia {
  uri: string;
  kind: 'image' | 'video';
  mimeType: string;
  fileName: string;
}

export default function ComposeScreen() {
  const router = useSafeRouter();
  const handwriting = useHandwritingFont();
  const {
    deviceId,
    location,
    locationFix,
    getLatestLocationFix,
    locationAccuracy,
    locationIsLive,
    locationStatus,
    retryLocation,
    demoMode,
    refreshMessages,
    user,
  } = useApp();

  // The media upload is asynchronous.  Keep refs in sync so the final publish
  // uses the newest fix rather than the timestamp captured when the screen
  // rendered or when the upload began.
  const latestLocationRef = useRef(location);
  const latestDemoModeRef = useRef(demoMode);
  latestLocationRef.current = location;
  latestDemoModeRef.current = demoMode;

  const [text, setText] = useState('');
  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [chooserKind, setChooserKind] = useState<'image' | 'video' | null>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const inputRef = useRef<TextInput>(null);

  const insertSticker = (id: string) => {
    const token = stickerToken(id);
    const { start, end } = selectionRef.current;
    const next = text.slice(0, start) + token + text.slice(end);
    if (next.length > MAX_LEN) {
      Toast.show({ type: 'info', text1: '字数快满了，贴纸放不下了' });
      return;
    }
    setText(next);
    const pos = start + token.length;
    selectionRef.current = { start: pos, end: pos };
    // 尽力恢复光标位置（Web 端不支持则落到末尾，可接受）
    setTimeout(() => {
      inputRef.current?.setNativeProps?.({ selection: { start: pos, end: pos } });
    }, 30);
  };

  const acceptAsset = (asset: ImagePicker.ImagePickerAsset, kind: 'image' | 'video') => {
    if (asset.fileSize != null && asset.fileSize > MEDIA_MAX_BYTES) {
      Toast.show({
        type: 'info',
        text1: kind === 'video' ? '视频太大了，试试录短一点' : '这张图片太大了，换一张试试',
      });
      return;
    }
    const mimeType =
      asset.mimeType ?? (kind === 'image' ? 'image/jpeg' : 'video/mp4');
    const ext = asset.uri.split('.').pop()?.split('?')[0] || (kind === 'image' ? 'jpg' : 'mp4');
    setMedia({
      uri: asset.uri,
      kind,
      mimeType,
      fileName: `cidi_${Date.now()}.${ext}`,
    });
  };

  const pickFromLibrary = async (kind: 'image' | 'video') => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === 'image' ? ['images'] : ['videos'],
      quality: 0.85,
      videoMaxDuration: 60,
      allowsMultipleSelection: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    acceptAsset(result.assets[0], kind);
  };

  const promptPermission = (what: string) => {
    Alert.alert(
      `需要${what}权限`,
      `想把此刻的画面留下来，需要先用一下${what}。`,
      [
        { text: '下次吧', style: 'cancel' },
        { text: '去设置', onPress: () => Linking.openSettings() },
      ]
    );
  };

  const captureNow = async (kind: 'image' | 'video') => {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (!cam.granted) {
      promptPermission('相机');
      return;
    }
    if (kind === 'video') {
      const mic = await Camera.requestMicrophonePermissionsAsync();
      if (!mic.granted) {
        promptPermission('麦克风');
        return;
      }
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: kind === 'image' ? ['images'] : ['videos'],
      quality: 0.85,
      ...(kind === 'video' ? { videoMaxDuration: 60 } : {}),
    });
    if (result.canceled || !result.assets?.[0]) return;
    acceptAsset(result.assets[0], kind);
  };

  // 等选择层收起动画结束再调起相机/相册，避免 iOS 上两层视图互相抢占
  const chooseMediaSource = (action: 'camera' | 'library') => {
    const kind = chooserKind;
    setChooserKind(null);
    if (!kind) return;
    setTimeout(() => {
      if (action === 'camera') void captureNow(kind);
      else void pickFromLibrary(kind);
    }, 280);
  };

  const onMediaButton = (kind: 'image' | 'video') => {
    // web 端没有相机，保持原来的直开相册行为
    if (Platform.OS === 'web') void pickFromLibrary(kind);
    else setChooserKind(kind);
  };

  const publish = async () => {
    if (!deviceId || publishing) return;
    if (!text.trim()) {
      Toast.show({ type: 'info', text1: '说点什么吧，哪怕一句也好' });
      return;
    }
    const initialDemoMode = latestDemoModeRef.current;
    const initialFix = getLatestLocationFix();
    const initialLocation = initialDemoMode
      ? latestLocationRef.current
      : initialFix
        ? { lat: initialFix.lat, lng: initialFix.lng }
        : null;
    if (!initialLocation) {
      Toast.show({ type: 'error', text1: '还没有找到你的位置，等定位好了再藏' });
      return;
    }
    if (!initialDemoMode && !isFreshLiveLocation(initialFix)) {
      Toast.show({ type: 'error', text1: '定位还不够新或不够准（需实时且精度≤30米）' });
      return;
    }
    setPublishing(true);
    try {
      let mediaType: MessageMediaType = 'none';
      let mediaKey: string | undefined;
      if (media) {
        const uploaded = await uploadMedia(media.uri, media.fileName, media.mimeType);
        mediaType = media.kind;
        mediaKey = uploaded.key;
      }

      // Uploading a video can take long enough for the original fix to age
      // out.  Re-read both refs immediately before sending the coordinates.
      const currentDemoMode = latestDemoModeRef.current;
      const currentFix = getLatestLocationFix();
      const currentLocation = currentDemoMode
        ? latestLocationRef.current
        : currentFix
          ? { lat: currentFix.lat, lng: currentFix.lng }
          : null;
      if (!currentLocation || (!currentDemoMode && !isFreshLiveLocation(currentFix))) {
        throw new Error('location_unusable');
      }
      // Demo coordinates are local-only test data.  Keep their wire shape
      // complete as well; real publishes always use the current fix metadata.
      const locationMetadata = currentDemoMode
        ? {
          coordinateSystem: LOCATION_COORDINATE_SYSTEM,
          accuracy: 0,
          capturedAt: Date.now(),
        }
        : {
          coordinateSystem: currentFix?.coordinateSystem ?? LOCATION_COORDINATE_SYSTEM,
          accuracy: currentFix?.accuracy ?? 0,
          capturedAt: currentFix?.timestamp ?? Date.now(),
        };
      await publishMessage({
        deviceId,
        text: text.trim(),
        mediaType,
        mediaKey,
        lat: currentLocation.lat,
        lng: currentLocation.lng,
        ...locationMetadata,
      });
      await refreshMessages();
      Toast.show({ type: 'success', text1: '已藏在此地，等一个路过的人。' });
      setPublished(true);
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      const msg =
        raw === 'location_unusable'
          ? '定位已过期或精度不足，等实时定位（精度≤30米）再藏'
          : raw === 'file_too_large'
            ? media?.kind === 'video'
              ? '视频太大了，试试录短一点'
              : '这张图片太大了，换一张试试'
            : raw || '没藏成功，再试一次';
      Toast.show({ type: 'error', text1: msg });
    } finally {
      setPublishing(false);
    }
  };

  if (published) {
    return (
      <Screen backgroundColor="#0B0E23">
        <NightSky />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <StickerIcon id="envelope" size={50} />
          <Text style={{ marginTop: 26, fontFamily: handwriting, fontSize: 20, color: '#FFE3A3', letterSpacing: 1.5, textAlign: 'center' }}>
            已藏在此地，等一个路过的人。
          </Text>
          <Text style={{ marginTop: 14, fontSize: 13, color: 'rgba(237,231,246,0.6)', letterSpacing: 1 }}>
            路过的人走近 50 米，就会遇见它
          </Text>
          <ShareSecretEntry
            variant="button"
            flowerName={user?.flower_name ?? '一位同学'}
            dateText={dayjs().format('YYYY年M月D日')}
            style={{ marginTop: 34 }}
          />
          <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ marginTop: 26, padding: 8 }}>
            <Text style={{ fontSize: 13.5, color: '#8E8BA3' }}>好了，回去</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  return (
    <Screen backgroundColor="#0B0E23">
      <NightSky />
      {/* 头部 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={{ padding: 6 }}>
          <FontAwesome6 name="arrow-left" size={17} color="#EDE7F6" />
        </TouchableOpacity>
        <Text style={{ fontFamily: handwriting, fontSize: 18, color: '#EDE7F6', letterSpacing: 2 }}>
          藏一句话
        </Text>
        <View style={{ width: 29 }} />
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        {/* 信纸输入区 */}
        <View style={{ backgroundColor: PAPER, borderRadius: 20, padding: 18, minHeight: 190 }}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={(t) => setText(t.slice(0, MAX_LEN + 20))}
            onSelectionChange={(e) => {
              selectionRef.current = e.nativeEvent.selection;
            }}
            placeholder="写给那个会路过这里的陌生人……"
            placeholderTextColor="rgba(62,54,38,0.35)"
            multiline
            maxLength={MAX_LEN + 20}
            style={{
              minHeight: 140,
              fontSize: 16.5,
              lineHeight: 28,
              color: INK,
              textAlignVertical: 'top',
              ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as never : {}),
            }}
          />
          <Text style={{ alignSelf: 'flex-end', fontSize: 12, color: 'rgba(62,54,38,0.45)', marginTop: 4 }}>
            {text.length}/{MAX_LEN}
          </Text>
        </View>

        {/* 贴纸栏 */}
        <Text style={{ marginTop: 18, marginBottom: 10, fontSize: 12.5, color: 'rgba(142,139,163,0.9)', letterSpacing: 1 }}>
          塞一点魔法进去
        </Text>
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always">
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {STICKERS.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => insertSticker(s.id)}
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.10)',
                  }}
                >
                  <StickerIcon id={s.id} size={26} />
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* 贴纸预览（含贴纸时显示） */}
        {text.includes('[em:') && (
          <View style={{ marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
            <Text style={{ fontSize: 11, color: 'rgba(142,139,163,0.8)', marginBottom: 8 }}>路上的人看到的会是这样</Text>
            <RichText text={text} fontSize={15} lineHeight={26} color="#EDE7F6" />
          </View>
        )}

        {/* 媒体 */}
        <Text style={{ marginTop: 20, marginBottom: 10, fontSize: 12.5, color: 'rgba(142,139,163,0.9)', letterSpacing: 1 }}>
          也可以留下一点画面（可选）
        </Text>
        {!media ? (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <MediaButton icon="image" label="一张照片" onPress={() => onMediaButton('image')} />
            <MediaButton icon="video" label="一段视频（≤60秒）" onPress={() => onMediaButton('video')} />
          </View>
        ) : (
          <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
            {media.kind === 'image' ? (
              <Image source={{ uri: media.uri }} style={{ width: '100%', height: 200 }} contentFit="cover" />
            ) : (
              <View style={{ width: '100%', height: 120, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}>
                <FontAwesome6 name="video" size={22} color="#F5C26B" />
                <Text style={{ marginTop: 8, fontSize: 12, color: '#8E8BA3' }}>已选好一段视频</Text>
              </View>
            )}
            <TouchableOpacity
              onPress={() => setMedia(null)}
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                width: 30,
                height: 30,
                borderRadius: 15,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(11,14,35,0.7)',
              }}
            >
              <FontAwesome6 name="xmark" size={14} color="#EDE7F6" />
            </TouchableOpacity>
          </View>
        )}

        {/* 发布 */}
        <TouchableOpacity
          onPress={publish}
          disabled={publishing}
          activeOpacity={0.85}
          style={{
            marginTop: 34,
            height: 54,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: publishing ? 'rgba(245,194,107,0.4)' : '#F5C26B',
            shadowColor: '#F5C26B',
            shadowOpacity: 0.4,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 0 },
            elevation: 8,
          }}
        >
          {publishing ? (
            <ActivityIndicator color="#0B0E23" />
          ) : (
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#0B0E23', letterSpacing: 2 }}>藏在此地</Text>
          )}
        </TouchableOpacity>
        <Text style={{ marginTop: 14, textAlign: 'center', fontSize: 12, color: 'rgba(142,139,163,0.85)', letterSpacing: 0.5 }}>
          它会藏在你现在的位置，等一个路过的人 · 30 天或 99 人读到后消散
        </Text>
        {/* 当前位置状态行：坐标/定位中/权限引导/重试，小字不抢主文案 */}
        <View style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          {demoMode ? (
            <Text style={{ fontSize: 12, color: 'rgba(142,139,163,0.85)', letterSpacing: 0.5 }}>
              {location
                ? `虚拟位置 · ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`
                : '还没找到你的位置，去演示模式设置虚拟位置'}
            </Text>
          ) : locationStatus === 'ready' && location && locationIsLive ? (
            <>
              <Text style={{ fontSize: 12, color: 'rgba(142,139,163,0.85)', letterSpacing: 0.5 }}>
                已定位 · {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
              </Text>
              {locationAccuracy === null ? (
                <Text style={{ fontSize: 12, color: '#F5C26B', letterSpacing: 0.5 }}>
                  定位精度未知 · 需要实时高精度定位
                </Text>
              ) : locationAccuracy > LOCATION_MAX_ACCURACY_METERS ? (
                <Text style={{ fontSize: 12, color: '#F5C26B', letterSpacing: 0.5 }}>
                  定位精度约±{Math.round(locationAccuracy)}米 · 需≤30米才能发布
                </Text>
              ) : !isFreshLiveLocation(locationFix) ? (
                <Text style={{ fontSize: 12, color: '#F5C26B', letterSpacing: 0.5 }}>
                  实时定位已过期 · 正在更新
                </Text>
              ) : null}
            </>
          ) : locationStatus === 'ready' && location ? (
            <Text style={{ fontSize: 12, color: '#F5C26B', letterSpacing: 0.5 }}>
              位置缓存 · 正在获取实时定位（实时且精度≤30米后才能发布）
            </Text>
          ) : locationStatus === 'locating' ? (
            <Text style={{ fontSize: 12, color: '#F2A7C8', letterSpacing: 0.5 }}>定位中…</Text>
          ) : locationStatus === 'denied' ? (
            <>
              <Text style={{ fontSize: 12, color: '#F2A7C8', letterSpacing: 0.5 }}>定位权限没开</Text>
              <TouchableOpacity onPress={() => Linking.openSettings().catch(() => undefined)}>
                <Text style={{ fontSize: 12, color: '#F5C26B', letterSpacing: 1, textDecorationLine: 'underline' }}>去开启</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 12, color: '#F2A7C8', letterSpacing: 0.5 }}>定位信号弱，稍等片刻</Text>
              <TouchableOpacity onPress={retryLocation}>
                <Text style={{ fontSize: 12, color: '#F5C26B', letterSpacing: 1, textDecorationLine: 'underline' }}>重试</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>

      {/* 媒体来源选择层（原生端；web 直开相册不经过这里） */}
      <Modal
        visible={chooserKind !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setChooserKind(null)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setChooserKind(null)}
          style={{ flex: 1, backgroundColor: 'rgba(5,7,18,0.62)', justifyContent: 'flex-end' }}
        >
          <View style={{ padding: 20, paddingBottom: 36 }}>
            <View
              style={{
                backgroundColor: '#1A1C3E',
                borderRadius: 22,
                padding: 18,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.10)',
              }}
            >
              <Text style={{ fontFamily: handwriting, fontSize: 17, color: '#EDE7F6', textAlign: 'center', marginBottom: 14, letterSpacing: 1 }}>
                {chooserKind === 'video' ? '这段画面，从哪里来？' : '这张照片，从哪里来？'}
              </Text>
              <ChooserOption
                icon={chooserKind === 'video' ? 'video' : 'camera'}
                label="现场拍摄"
                onPress={() => chooseMediaSource('camera')}
              />
              <View style={{ height: 10 }} />
              <ChooserOption
                icon="images"
                label="从相册选"
                onPress={() => chooseMediaSource('library')}
              />
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </Screen>
  );
}

function ChooserOption({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        height: 50,
        borderRadius: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 9,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.10)',
      }}
    >
      <FontAwesome6 name={icon} size={15} color="#A79BFA" />
      <Text style={{ fontSize: 14.5, color: '#EDE7F6', letterSpacing: 1 }}>{label}</Text>
    </TouchableOpacity>
  );
}

function MediaButton({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flex: 1,
        height: 48,
        borderRadius: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.10)',
      }}
    >
      <FontAwesome6 name={icon} size={15} color="#A79BFA" />
      <Text style={{ fontSize: 13, color: '#EDE7F6' }}>{label}</Text>
    </TouchableOpacity>
  );
}
