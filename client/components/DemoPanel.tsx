import React, { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import { useApp, type LatLng } from '@/contexts/AppContext';
import { haversineMeters } from '@/utils/haversine';

const STEP = 0.00025; // 约 25-30 米

interface Props {
  onClose: () => void;
}

/** 演示模式 · 虚拟定位面板（调试用朴素样式，不属于产品 UI） */
export function DemoPanel({ onClose }: Props) {
  const { mockLocation, setMockLocation, setDemoMode, aliveMessages, readIds } = useApp();

  // 跳到留言旁列表：按当前虚拟定位距离升序，已读的置灰置底
  const jumpList = useMemo(() => {
    const dist = (m: LatLng) =>
      mockLocation ? haversineMeters(mockLocation.lat, mockLocation.lng, m.lat, m.lng) : Number.MAX_SAFE_INTEGER;
    return aliveMessages
      .map((m) => ({ ...m, read: readIds.has(m.id), distance: dist(m) }))
      .sort((a, b) => Number(a.read) - Number(b.read) || a.distance - b.distance);
  }, [aliveMessages, readIds, mockLocation]);

  const move = (dLat: number, dLng: number) => {
    if (!mockLocation) return;
    setMockLocation({
      lat: Number((mockLocation.lat + dLat).toFixed(6)),
      lng: Number((mockLocation.lng + dLng).toFixed(6)),
    });
  };

  const jumpTo = (target: LatLng) => {
    // 落在目标以北约 20 米（50m 半径内）
    setMockLocation({ lat: Number((target.lat + 0.00018).toFixed(6)), lng: target.lng });
  };

  return (
    <View
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 12,
        backgroundColor: '#16182F',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(245,194,107,0.35)',
        padding: 14,
        maxHeight: 320,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: '#F5C26B', fontSize: 13, fontWeight: '700', letterSpacing: 1 }}>
          演示模式 · 虚拟定位
        </Text>
        <TouchableOpacity onPress={onClose} hitSlop={8}>
          <FontAwesome6 name="xmark" size={14} color="#8E8BA3" />
        </TouchableOpacity>
      </View>

      <Text style={{ color: '#8E8BA3', fontSize: 11, marginTop: 8, fontFamily: 'monospace' as never }}>
        {mockLocation ? `${mockLocation.lat.toFixed(6)}, ${mockLocation.lng.toFixed(6)}` : '无定位'}
      </Text>

      {/* 步进微调 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10 }}>
        <View style={{ alignItems: 'center' }}>
          <StepButton icon="arrow-up" onPress={() => move(STEP, 0)} />
          <View style={{ flexDirection: 'row', gap: 22, marginVertical: 6 }}>
            <StepButton icon="arrow-left" onPress={() => move(0, -STEP)} />
            <StepButton icon="arrow-right" onPress={() => move(0, STEP)} />
          </View>
          <StepButton icon="arrow-down" onPress={() => move(-STEP, 0)} />
        </View>
        <Text style={{ color: '#5A5870', fontSize: 11, flex: 1, marginLeft: 6 }}>
          每步约 25 米{'\n'}走进 50m 内会触发偶遇
        </Text>
      </View>

      {/* 快捷跳转 */}
      <Text style={{ color: '#8E8BA3', fontSize: 11, marginTop: 10, marginBottom: 6 }}>跳到某条留言旁：</Text>
      <ScrollView style={{ maxHeight: 120 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {jumpList.slice(0, 20).map((m) => (
            <TouchableOpacity
              key={m.id}
              disabled={m.read}
              onPress={() => jumpTo({ lat: m.lat, lng: m.lng })}
              style={{
                paddingVertical: 5,
                paddingHorizontal: 10,
                borderRadius: 8,
                backgroundColor: m.read ? 'rgba(142,139,163,0.08)' : 'rgba(245,194,107,0.10)',
                borderWidth: 1,
                borderColor: m.read ? 'rgba(142,139,163,0.18)' : 'rgba(245,194,107,0.25)',
              }}
            >
              <Text style={{ color: m.read ? '#5A5870' : '#EDE7F6', fontSize: 11 }}>
                {m.read ? '已读' : '附近'}
                {m.distance === Number.MAX_SAFE_INTEGER ? '' : ` · 约 ${formatDistance(m.distance)}`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <TouchableOpacity
        onPress={() => {
          setDemoMode(false);
          onClose();
        }}
        style={{
          marginTop: 12,
          alignSelf: 'flex-start',
          paddingVertical: 6,
          paddingHorizontal: 14,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: 'rgba(142,139,163,0.4)',
        }}
      >
        <Text style={{ color: '#8E8BA3', fontSize: 12 }}>恢复真实 GPS</Text>
      </TouchableOpacity>
    </View>
  );
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
  return `${Math.round(meters)}m`;
}

function StepButton({ icon, onPress }: { icon: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(245,194,107,0.12)',
        borderWidth: 1,
        borderColor: 'rgba(245,194,107,0.3)',
      }}
    >
      <FontAwesome6 name={icon} size={12} color="#F5C26B" />
    </TouchableOpacity>
  );
}
