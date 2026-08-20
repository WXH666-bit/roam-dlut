export const config = {
  // 读满人数上限，达到即消散（验收可调小，如 MESSAGE_READ_LIMIT=3）
  readLimit: Number(process.env.MESSAGE_READ_LIMIT || 99),
  // 存活天数，满 30 天消散
  ttlDays: Number(process.env.MESSAGE_TTL_DAYS || 30),
  // 每日发布上限
  dailyLimit: Number(process.env.MESSAGE_DAILY_LIMIT || 3),
  // 偶遇感应半径（米），仅后端记录用，判定在 App 端
  radiusMeters: Number(process.env.ENCOUNTER_RADIUS || 50),
};

export const TTL_MS = config.ttlDays * 24 * 60 * 60 * 1000;
