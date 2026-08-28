import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import Constants from 'expo-constants';
import { FontAwesome6 } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import dayjs from 'dayjs';
import { Screen } from '@/components/Screen';
import { NightSky } from '@/components/NightSky';
import { StickerIcon } from '@/components/StickerIcon';
import { LetterOverlay } from '@/components/LetterOverlay';
import { RichText } from '@/components/RichText';
import { useApp } from '@/contexts/AppContext';
import { useHandwritingFont } from '@/contexts/FontContext';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import {
  fetchUsersMe,
  reclaimIdentity,
  renameFlowerName,
  type ApiUser,
  type FootprintItem,
  type MyMessageItem,
  type UsersMeResponse,
} from '@/utils/api';

// 与服务端 config.ts TTL_DAYS 默认值一致；该值接口未下发，服务端改环境变量时需同步这里
const MESSAGE_TTL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const APP_VERSION = Constants.expoConfig?.version ?? '1.1.0';

export default function ProfileScreen() {
  const router = useSafeRouter();
  const handwriting = useHandwritingFont();
  const { deviceId, deviceToken, user, setUser, demoMode, setDemoMode } = useApp();
  const [data, setData] = useState<UsersMeResponse | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [letterId, setLetterId] = useState<string | null>(null);
  // 从「我藏下的」打开的回看带分享入口；足迹打开的不带
  const [letterShare, setLetterShare] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [versionTaps, setVersionTaps] = useState(0);
  const versionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (idOverride?: string, tokenOverride?: string | null) => {
    const id = idOverride ?? deviceId;
    if (!id) return;
    try {
      const d = await fetchUsersMe(id, idOverride ? tokenOverride : deviceToken);
      setData(d);
      setUser(d.user);
      setLoadedAt(Date.now());
    } catch (e) {
      console.warn('[profile] load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [deviceId, deviceToken, setUser]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onVersionTap = () => {
    const next = versionTaps + 1;
    setVersionTaps(next);
    if (versionTimerRef.current) clearTimeout(versionTimerRef.current);
    versionTimerRef.current = setTimeout(() => setVersionTaps(0), 2500);
    if (next >= 5) {
      setVersionTaps(0);
      if (!demoMode) {
        setDemoMode(true);
        Toast.show({ type: 'success', text1: '演示模式已开启，回首页点左上角罗盘调位置' });
      } else {
        Toast.show({ type: 'info', text1: '演示模式已经在开着了' });
      }
    }
  };

  return (
    <Screen backgroundColor="#0B0E23">
      <NightSky />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={{ padding: 6 }}>
          <FontAwesome6 name="arrow-left" size={17} color="#EDE7F6" />
        </TouchableOpacity>
        <Text style={{ fontFamily: handwriting, fontSize: 18, color: '#EDE7F6', letterSpacing: 2 }}>
          我的
        </Text>
        <View style={{ width: 29 }} />
      </View>

      {loading ? (
        <ActivityIndicator color="#F5C26B" style={{ marginTop: 80 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 80 }}>
          {/* 花名卡 */}
          <View
            style={{
              borderRadius: 24,
              padding: 22,
              backgroundColor: 'rgba(255,255,255,0.06)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.08)',
              alignItems: 'center',
            }}
          >
            <StickerIcon id="lantern" size={40} />
            <Text style={{ marginTop: 12, fontFamily: handwriting, fontSize: 24, color: '#FFE3A3', letterSpacing: 1 }}>
              {data?.user.flower_name ?? user?.flower_name ?? '……'}
            </Text>
            <Text style={{ marginTop: 6, fontSize: 12, color: '#8E8BA3', letterSpacing: 0.5 }}>
              这是路上的人认识你的方式
            </Text>
            {data && !data.user.renamed && (
              <TouchableOpacity
                onPress={() => setRenameOpen(true)}
                style={{ marginTop: 14, paddingVertical: 7, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(245,194,107,0.35)' }}
              >
                <Text style={{ fontSize: 12.5, color: '#F5C26B' }}>改一次花名（仅此一次）</Text>
              </TouchableOpacity>
            )}
            <View style={{ flexDirection: 'row', marginTop: 18, gap: 28 }}>
              <Stat label="我藏下的" value={data?.my_messages.length ?? 0} />
              <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />
              <Stat label="我解锁的" value={data?.footprints.length ?? 0} />
            </View>
            <TouchableOpacity
              onPress={() => setIdentityOpen(true)}
              hitSlop={8}
              style={{ marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 10 }}
            >
              <FontAwesome6 name="key" size={10} color="rgba(142,139,163,0.75)" />
              <Text style={{ fontSize: 12, color: 'rgba(142,139,163,0.75)', letterSpacing: 1 }}>身份与找回</Text>
            </TouchableOpacity>
          </View>

          {/* 我发布的 */}
          <SectionTitle text="我藏下的" />
          {data?.my_messages.length === 0 && (
            <EmptyHint text="还没有藏过留言。第一句最难，也最值得。" />
          )}
          {data?.my_messages.map((m) => (
            <MyMessageRow key={m.id} item={m} nowTs={loadedAt} onPress={() => { setLetterId(m.id); setLetterShare(true); }} />
          ))}

          {/* 足迹 */}
          <SectionTitle text="我解锁过的" />
          {data?.footprints.length === 0 && (
            <EmptyHint text="还没有偶遇过任何留言。多走走，它们在等你。" />
          )}
          {data?.footprints.map((f) => (
            <FootprintRow key={f.id} item={f} onPress={f.alive ? () => setLetterId(f.id) : undefined} />
          ))}

          {/* 版本号：连点 5 次进入演示模式 */}
          <TouchableOpacity onPress={onVersionTap} activeOpacity={0.6} style={{ marginTop: 44, alignItems: 'center' }}>
            <Text style={{ fontSize: 12, color: 'rgba(142,139,163,0.7)', letterSpacing: 1 }}>
              此地有话 v{APP_VERSION} · 写给陌生人的信
            </Text>
            {demoMode && <Text style={{ marginTop: 4, fontSize: 11, color: '#F5C26B' }}>演示模式开启中</Text>}
          </TouchableOpacity>
          {demoMode && (
            <TouchableOpacity
              onPress={() => {
                setDemoMode(false);
                Toast.show({ type: 'info', text1: '已恢复真实 GPS' });
              }}
              style={{ marginTop: 12, alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(142,139,163,0.4)' }}
            >
              <Text style={{ fontSize: 12, color: '#8E8BA3' }}>关闭演示模式</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      {renameOpen && data && (
        <RenameModal
          current={data.user.flower_name}
          onClose={() => setRenameOpen(false)}
          onDone={(u) => {
            setUser(u);
            setData((prev) => (prev ? { ...prev, user: u } : prev));
            setRenameOpen(false);
          }}
        />
      )}
      {identityOpen && (
        <IdentityModal
          recoveryCode={data?.user.recovery_code ?? user?.recovery_code ?? ''}
          onClose={() => setIdentityOpen(false)}
          onSwitched={(u) => {
            setLoading(true);
            load(u.device_id, u.token);
          }}
        />
      )}
      {letterId && (
        <LetterOverlay
          messageId={letterId}
          shareEntry={letterShare}
          onClose={() => {
            setLetterId(null);
            setLetterShare(false);
          }}
        />
      )}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const handwriting = useHandwritingFont();
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontFamily: handwriting, fontSize: 22, color: '#EDE7F6' }}>{value}</Text>
      <Text style={{ marginTop: 2, fontSize: 12, color: '#8E8BA3' }}>{label}</Text>
    </View>
  );
}

function SectionTitle({ text }: { text: string }) {
  const handwriting = useHandwritingFont();
  return (
    <Text style={{ marginTop: 30, marginBottom: 12, fontFamily: handwriting, fontSize: 16, color: 'rgba(237,231,246,0.85)', letterSpacing: 2 }}>
      {text}
    </Text>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <Text style={{ fontSize: 13, color: 'rgba(142,139,163,0.8)', lineHeight: 20, paddingVertical: 6 }}>{text}</Text>
  );
}

function MyMessageRow({ item, nowTs, onPress }: { item: MyMessageItem; nowTs: number | null; onPress: () => void }) {
  const { readLimit } = useApp();
  const countdown = (() => {
    if (!item.alive || nowTs === null) return '';
    const parts: string[] = [];
    const readsLeft = readLimit - item.read_count;
    const daysLeft = Math.round((item.created_at + MESSAGE_TTL_DAYS * DAY_MS - nowTs) / DAY_MS);
    if (readsLeft > 0) parts.push(`还能被 ${readsLeft} 人读到`);
    if (daysLeft > 0) parts.push(`还剩 ${daysLeft} 天`);
    return parts.join(' · ');
  })();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        borderRadius: 18,
        padding: 16,
        marginBottom: 10,
        backgroundColor: item.alive ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
        borderWidth: 1,
        borderColor: item.alive ? 'rgba(245,194,107,0.18)' : 'rgba(255,255,255,0.06)',
        opacity: item.alive ? 1 : 0.75,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <StatusChip alive={item.alive} />
        <Text style={{ fontSize: 11, color: '#8E8BA3' }}>{dayjs(item.created_at).format('M月D日 HH:mm')}</Text>
      </View>
      <RichText text={item.text} fontSize={14.5} lineHeight={23} color={item.alive ? '#EDE7F6' : '#8E8BA3'} />
      <View style={{ flexDirection: 'row', marginTop: 10, gap: 16 }}>
        <Text style={{ fontSize: 11.5, color: '#8E8BA3' }}>被 {item.read_count} 人读到</Text>
        <Text style={{ fontSize: 11.5, color: '#8E8BA3' }}>{item.likes} 人喜欢</Text>
        {countdown !== '' && <Text style={{ fontSize: 11.5, color: '#8E8BA3' }}>{countdown}</Text>}
        {!item.alive && <Text style={{ fontSize: 11.5, color: '#5A5870' }}>仅你能回看</Text>}
      </View>
    </TouchableOpacity>
  );
}

function FootprintRow({ item, onPress }: { item: FootprintItem; onPress?: () => void }) {
  const handwriting = useHandwritingFont();
  const inner = (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <StatusChip alive={item.alive} />
        <Text style={{ fontSize: 11, color: '#8E8BA3' }}>{dayjs(item.created_at).format('M月D日')}</Text>
      </View>
      {item.alive && item.text ? (
        <>
          <RichText text={item.text} fontSize={14.5} lineHeight={23} color="#EDE7F6" />
          <Text style={{ marginTop: 8, fontSize: 11.5, color: '#8E8BA3' }}>来自「{item.flower_name}」</Text>
        </>
      ) : (
        <Text style={{ fontSize: 13, color: '#5A5870', fontFamily: handwriting, letterSpacing: 1 }}>
          它曾经在这里，现在内容已经成了秘密
        </Text>
      )}
    </>
  );
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.8}
      style={{
        borderRadius: 18,
        padding: 16,
        marginBottom: 10,
        backgroundColor: item.alive ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.07)',
        opacity: item.alive ? 1 : 0.7,
      }}
    >
      {inner}
    </TouchableOpacity>
  );
}

function StatusChip({ alive }: { alive: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 3,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: alive ? 'rgba(245,194,107,0.12)' : 'rgba(90,88,112,0.25)',
      }}
    >
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: alive ? '#F5C26B' : '#5A5870', marginRight: 6 }} />
      <Text style={{ fontSize: 11, color: alive ? '#F5C26B' : '#8E8BA3' }}>{alive ? '还在等待' : '已消散'}</Text>
    </View>
  );
}

function RenameModal({
  current,
  onClose,
  onDone,
}: {
  current: string;
  onClose: () => void;
  onDone: (u: { device_id: string; flower_name: string; renamed: boolean }) => void;
}) {
  const { deviceId } = useApp();
  const handwriting = useHandwritingFont();
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!deviceId || busy) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 12) {
      Toast.show({ type: 'info', text1: '花名需为 1-12 个字符' });
      return;
    }
    setBusy(true);
    try {
      const u = await renameFlowerName(deviceId, trimmed);
      Toast.show({ type: 'success', text1: `以后你就是「${u.flower_name}」了` });
      onDone(u);
    } catch (e) {
      Toast.show({ type: 'error', text1: e instanceof Error ? e.message : '没改成，再试试' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(11,14,35,0.9)', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <View style={{ width: '100%', maxWidth: 380, borderRadius: 22, backgroundColor: '#1A1C3E', padding: 24, borderWidth: 1, borderColor: 'rgba(245,194,107,0.25)' }}>
          <Text style={{ fontFamily: handwriting, fontSize: 18, color: '#FFE3A3', letterSpacing: 1 }}>
            想换个什么花名？
          </Text>
          <Text style={{ marginTop: 6, fontSize: 12, color: '#8E8BA3' }}>只能改这一次，想清楚再落笔</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            maxLength={12}
            autoFocus
            placeholder="1-12 个字符"
            placeholderTextColor="rgba(142,139,163,0.5)"
            style={{
              marginTop: 18,
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 12,
              fontSize: 16,
              color: '#EDE7F6',
              backgroundColor: 'rgba(255,255,255,0.06)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.12)',
              ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as never : {}),
            }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 20, gap: 12 }}>
            <TouchableOpacity onPress={onClose} style={{ paddingVertical: 10, paddingHorizontal: 20 }}>
              <Text style={{ color: '#8E8BA3', fontSize: 14 }}>算了</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={submit}
              disabled={busy}
              style={{ paddingVertical: 10, paddingHorizontal: 24, borderRadius: 999, backgroundColor: '#F5C26B' }}
            >
              <Text style={{ color: '#0B0E23', fontSize: 14, fontWeight: '700' }}>{busy ? '落笔中…' : '就它了'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function IdentityModal({
  recoveryCode,
  onClose,
  onSwitched,
}: {
  recoveryCode: string;
  onClose: () => void;
  onSwitched: (u: ApiUser) => void;
}) {
  const { adoptIdentity } = useApp();
  const handwriting = useHandwritingFont();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  // 认领成功待确认切换的身份
  const [pending, setPending] = useState<ApiUser | null>(null);

  const reclaim = async () => {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      setPending(await reclaimIdentity(trimmed));
    } catch (e) {
      Toast.show({ type: 'error', text1: e instanceof Error ? e.message : '认领失败，再试试' });
    } finally {
      setBusy(false);
    }
  };

  const confirmSwitch = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await adoptIdentity(pending);
      Toast.show({ type: 'success', text1: `欢迎回来，${pending.flower_name}` });
      onSwitched(pending);
      onClose();
    } catch {
      Toast.show({ type: 'error', text1: '切换失败，再试一次' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(11,14,35,0.9)', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <View style={{ width: '100%', maxWidth: 380, borderRadius: 22, backgroundColor: '#1A1C3E', padding: 24, borderWidth: 1, borderColor: 'rgba(245,194,107,0.25)' }}>
          {pending ? (
            <>
              <Text style={{ fontFamily: handwriting, fontSize: 18, color: '#FFE3A3', letterSpacing: 1 }}>
                暗号对上了
              </Text>
              <Text style={{ marginTop: 16, fontSize: 15, lineHeight: 25, color: '#EDE7F6' }}>
                将切换为「{pending.flower_name}」
              </Text>
              <Text style={{ marginTop: 8, fontSize: 12, lineHeight: 19, color: '#8E8BA3' }}>
                这台设备当前的身份会退出，花名、留言和足迹都跟暗号走。
              </Text>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 22, gap: 12 }}>
                <TouchableOpacity onPress={() => setPending(null)} style={{ paddingVertical: 10, paddingHorizontal: 20 }}>
                  <Text style={{ color: '#8E8BA3', fontSize: 14 }}>再想想</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={confirmSwitch}
                  disabled={busy}
                  style={{ paddingVertical: 10, paddingHorizontal: 24, borderRadius: 999, backgroundColor: '#F5C26B' }}
                >
                  <Text style={{ color: '#0B0E23', fontSize: 14, fontWeight: '700' }}>{busy ? '切换中…' : '确认切换'}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={{ fontFamily: handwriting, fontSize: 18, color: '#FFE3A3', letterSpacing: 1 }}>
                你的暗号
              </Text>
              <Text style={{ marginTop: 16, fontFamily: handwriting, fontSize: 24, lineHeight: 34, color: '#F5C26B', letterSpacing: 2, textAlign: 'center' }}>
                {recoveryCode || '……'}
              </Text>
              <Text style={{ marginTop: 12, fontSize: 12, lineHeight: 19, color: '#8E8BA3', textAlign: 'center' }}>
                抄在本子上。凭暗号可以在任何设备找回你的花名
              </Text>
              <View style={{ marginVertical: 20, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />
              <Text style={{ fontSize: 12.5, color: 'rgba(142,139,163,0.9)', letterSpacing: 1 }}>
                凭暗号找回花名
              </Text>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="银杏·晚风·天台·07"
                placeholderTextColor="rgba(142,139,163,0.5)"
                autoCapitalize="none"
                style={{
                  marginTop: 10,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  fontSize: 16,
                  color: '#EDE7F6',
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.12)',
                  ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as never : {}),
                }}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 20, gap: 12 }}>
                <TouchableOpacity onPress={onClose} style={{ paddingVertical: 10, paddingHorizontal: 20 }}>
                  <Text style={{ color: '#8E8BA3', fontSize: 14 }}>收起</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={reclaim}
                  disabled={busy}
                  style={{ paddingVertical: 10, paddingHorizontal: 24, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(245,194,107,0.45)' }}
                >
                  <Text style={{ color: '#F5C26B', fontSize: 14 }}>{busy ? '对暗号中…' : '找回'}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
