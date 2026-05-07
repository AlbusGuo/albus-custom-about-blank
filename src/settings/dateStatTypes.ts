// =============================================================================
//                             日期统计类型定义
// =============================================================================

export const DATE_STAT_TYPES = {
  anniversary: "anniversary",
  countdown: "countdown",
} as const;

export type DateStatType = typeof DATE_STAT_TYPES[keyof typeof DATE_STAT_TYPES];

export interface DateStatDefinition {
  id: string;
  type: DateStatType;
  title: string;
  date: string; // 'YYYY-MM-DD' for anniversary, 'MM-DD' for countdown
}

export const NEW_DATE_STAT: DateStatDefinition = {
  id: "",
  type: DATE_STAT_TYPES.anniversary,
  title: "",
  date: "",
};

export const createDateStat = (): DateStatDefinition => ({
  id: `date-stat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  type: DATE_STAT_TYPES.anniversary,
  title: "",
  date: "",
});

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

export const isDateStatDefinition = (value: unknown): value is DateStatDefinition => {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.id === "string"
    && (value.type === DATE_STAT_TYPES.anniversary || value.type === DATE_STAT_TYPES.countdown)
    && typeof value.title === "string"
    && typeof value.date === "string";
};

// =============================================================================
//                           日期统计算法
// =============================================================================

/**
 * 计算纪念日天数：目标日期距今的天数
 * 使用 UTC 日期避免时区问题（业界标准做法）
 */
export const calcAnniversaryDays = (dateStr: string): number => {
  const target = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(target.getTime())) {
    return 0;
  }
  const today = new Date();
  const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const targetUTC = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.floor(Math.abs((todayUTC - targetUTC) / (1000 * 60 * 60 * 24)));
};

/**
 * 计算倒数日天数：距离下一个目标日期还有多少天
 * 输入格式为 'MM-DD'，按年重复
 * 也兼容 'YYYY-MM-DD' 格式（自动提取月日部分）
 * 若本年度目标已过（diff < 0），则计算到明年的天数
 * 若恰好是今天（diff === 0），则显示 0
 */
export const calcCountdownDays = (dateStr: string): number => {
  if (!dateStr || typeof dateStr !== "string") {
    return 0;
  }

  const trimmed = dateStr.trim();
  const parts = trimmed.split("-");

  let month: number;
  let day: number;

  if (parts.length === 3) {
    // YYYY-MM-DD 格式：取后两位
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else if (parts.length === 2) {
    // MM-DD 格式
    month = parseInt(parts[0], 10);
    day = parseInt(parts[1], 10);
  } else {
    return 0;
  }

  if (Number.isNaN(month) || Number.isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return 0;
  }

  // 使用本地化日期比较以避免 UTC 边界问题
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();

  // 构造今年的目标日期
  let target = new Date(today.getFullYear(), month - 1, day);
  target.setHours(0, 0, 0, 0);

  // 已过（< 0）才推到下一年；正好今天（=== 0）显示 0
  if (target.getTime() < todayTime) {
    target = new Date(today.getFullYear() + 1, month - 1, day);
    target.setHours(0, 0, 0, 0);
  }

  const diffMs = target.getTime() - todayTime;
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
};

/**
 * 计算日期统计项目的显示值
 */
export const calcDateStatValue = (stat: DateStatDefinition): number => {
  if (stat.type === DATE_STAT_TYPES.anniversary) {
    return calcAnniversaryDays(stat.date);
  }
  return calcCountdownDays(stat.date);
};

/**
 * 获取日期统计的标签文本
 */
export const getDateStatLabel = (stat: DateStatDefinition): string => {
  if (stat.type === DATE_STAT_TYPES.anniversary) {
    return "天";
  }
  return "天";
};

/**
 * 获取日期统计的类型标签
 */
export const getDateStatTypeLabel = (type: DateStatType): string => {
  return type === DATE_STAT_TYPES.anniversary ? "纪念日" : "倒数日";
};

/**
 * 验证日期字符串格式
 */
export const isValidAnniversaryDate = (dateStr: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const d = new Date(dateStr + "T00:00:00");
  return !Number.isNaN(d.getTime())
    && d.toISOString().slice(0, 10) === dateStr;
};

export const isValidCountdownDate = (dateStr: string): boolean => {
  if (!/^\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const parts = dateStr.split("-");
  const month = parseInt(parts[0], 10);
  const day = parseInt(parts[1], 10);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
};

/**
 * 规范化日期统计定义数组
 */
export const normalizeDateStatDefinitions = (value: unknown): DateStatDefinition[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (isDateStatDefinition(item) ? item : null))
    .filter((item): item is DateStatDefinition => item !== null);
};
