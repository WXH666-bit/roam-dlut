// 身份暗号词库：校园意象名词，风格与 flowerNames 一致（温柔、有集体记忆）
// 暗号 = 三个不重复的词 + 两位数字，如「银杏·晚风·天台·07」
const WORDS = [
  // 植物
  '银杏', '梧桐', '丁香', '爬山虎', '芦苇', '樱花', '松树', '薄荷', '苔痕', '向日葵',
  // 天气
  '晚风', '薄雾', '初雪', '蝉鸣', '细雨', '晴空', '晚霞', '露水', '阵风', '融雪',
  // 校园角落
  '天台', '连廊', '自习室', '传达室', '车棚', '报栏', '阶梯教室', '琴房', '操场边', '小卖部',
  // 食物
  '烤冷面', '糖葫芦', '酸梅汤', '煎饼果子', '绿豆汤', '烤红薯', '关东煮', '桂花糕', '酸奶', '泡面',
  // 声音
  '闭馆铃', '上课铃', '熄灯号', '广播体操', '翻书声', '风铃', '下课铃', '熄灯哨', '晨读', '蛙鸣',
];

export const RECOVERY_WORD_COUNT = WORDS.length;

/** 生成暗号：抽 3 个不重复的词 + 两位数字（00-99） */
export const randomRecoveryCode = (rand: () => number = Math.random): string => {
  const pool = [...WORDS];
  const picked: string[] = [];
  for (let i = 0; i < 3; i++) {
    const idx = Math.floor(rand() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  const num = String(Math.floor(rand() * 100)).padStart(2, '0');
  return `${picked.join('·')}·${num}`;
};
