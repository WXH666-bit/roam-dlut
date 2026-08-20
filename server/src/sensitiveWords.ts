// 敏感词表：命中即拦截发布。覆盖违法违规、诈骗、校园乱象等明确类别。
export const SENSITIVE_WORDS = [
  '诈骗', '赌博', '赌球', '毒品', '贩毒', '吸毒', '枪支', '弹药',
  '代考', '枪手', '替考', '作弊器', '买卖答案', '论文代写', '代写论文',
  '裸聊', '约炮', '援交', '刷单', '刷信誉', '兼职刷单',
  '办证', '假证', '刻章', '发票代开', '高利贷', '校园贷', '裸贷',
  '传销', '非法集资', '洗钱', '偷渡', '走私',
  '自杀教学', '自残方法', '恐怖袭击', '爆炸物制作',
];

export const hitSensitiveWord = (text: string): string | null => {
  for (const w of SENSITIVE_WORDS) {
    if (text.includes(w)) return w;
  }
  return null;
};
