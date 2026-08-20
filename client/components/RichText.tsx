import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { parseStickerText } from '@/utils/stickers';
import { StickerIcon } from './StickerIcon';

interface Props {
  text: string;
  fontSize?: number;
  lineHeight?: number;
  color?: string;
  fontFamily?: string;
  textAlign?: 'left' | 'center';
}

const LATIN_RE = /^[\x20-\x7E]+$/;

/** 把文本片段切成可换行单元：CJK 逐字、拉丁按词 */
const splitUnits = (value: string): string[] => {
  const units: string[] = [];
  let word = '';
  for (const ch of value) {
    if (LATIN_RE.test(ch)) {
      word += ch;
    } else {
      if (word) {
        units.push(word);
        word = '';
      }
      units.push(ch);
    }
  }
  if (word) units.push(word);
  return units;
};

/** 渲染含 [em:xx] 贴纸占位符的正文：贴纸与文字内联混排 */
export function RichText({
  text,
  fontSize = 16,
  lineHeight,
  color = '#EDE7F6',
  fontFamily,
  textAlign = 'left',
}: Props) {
  const lh = lineHeight ?? Math.round(fontSize * 1.7);
  const items = useMemo(() => {
    const segments = parseStickerText(text);
    const out: ({ kind: 'char'; value: string } | { kind: 'sticker'; id: string } | { kind: 'br' })[] = [];
    for (const seg of segments) {
      if (seg.type === 'sticker') {
        out.push({ kind: 'sticker', id: seg.id });
      } else {
        for (const unit of splitUnits(seg.value)) {
          if (unit === '\n') out.push({ kind: 'br' });
          else out.push({ kind: 'char', value: unit });
        }
      }
    }
    return out;
  }, [text]);

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: textAlign === 'center' ? 'center' : 'flex-start',
      }}
    >
      {items.map((item, i) => {
        if (item.kind === 'br') {
          return <View key={i} style={{ width: '100%', height: Math.round(lh * 0.4) }} />;
        }
        if (item.kind === 'sticker') {
          return (
            <View key={i} style={{ marginHorizontal: 1, height: lh, justifyContent: 'center' }}>
              <StickerIcon id={item.id} size={fontSize + 4} />
            </View>
          );
        }
        return (
          <Text key={i} style={{ fontSize, lineHeight: lh, color, fontFamily }}>
            {item.value}
          </Text>
        );
      })}
    </View>
  );
}
