// 手绘魔法贴纸注册表。文本协议：[em:xx] 占位符，渲染为贴纸图。
export interface StickerDef {
  id: string;
  label: string;
}

export const STICKERS: StickerDef[] = [
  { id: 'star', label: '星星' },
  { id: 'moon', label: '月亮' },
  { id: 'envelope', label: '信封' },
  { id: 'cat', label: '猫' },
  { id: 'elf', label: '小精灵' },
  { id: 'sparkle', label: '星光' },
  { id: 'heart', label: '爱心' },
  { id: 'clover', label: '四叶草' },
  { id: 'candle', label: '蜡烛' },
  { id: 'key', label: '钥匙' },
  { id: 'coffee', label: '热饮' },
  { id: 'book', label: '书' },
  { id: 'cloud', label: '云' },
  { id: 'music', label: '音符' },
  { id: 'lantern', label: '灯笼' },
  { id: 'balloon', label: '气球' },
  { id: 'flower', label: '小花' },
  { id: 'fish', label: '鱼' },
];

export const STICKER_IDS = new Set(STICKERS.map((s) => s.id));

export const stickerToken = (id: string) => `[em:${id}]`;

const TOKEN_RE = /\[em:([a-z]+)\]/g;

export type TextSegment = { type: 'text'; value: string } | { type: 'sticker'; id: string };

/** 把含 [em:xx] 占位符的文本解析为片段序列 */
export const parseStickerText = (text: string): TextSegment[] => {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    const idx = match.index ?? 0;
    const id = match[1];
    if (!STICKER_IDS.has(id)) continue;
    if (idx > last) segments.push({ type: 'text', value: text.slice(last, idx) });
    segments.push({ type: 'sticker', id });
    last = idx + match[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', value: text.slice(last) });
  return segments;
};
