/**
 * 小型工具函数（零依赖）。
 */
/** 按 Unicode 码点计"字"（与需求"字"一致，emoji/代理对算 1 个字）。 */
export declare function countChars(value: string): number;
/** 按码点截断到最多 maxChars 个字。 */
export declare function truncateChars(value: string, maxChars: number): string;
/**
 * 在自然边界处截断（不超 maxChars）：优先句末标点，其次逗号，最后硬切。
 *
 * 用于摘要/结论这类成句字段——硬切会把句子切断在半截（历史卡片已出现
 * “四命令全部实现并真机执”这类断头结论）。找不到边界时退回 truncateChars 的行为。
 */
export declare function truncateAtBoundary(value: string, maxChars: number): string;
/** 按码点安全切片（start/end 以码点计）。 */
export declare function sliceChars(value: string, start: number, end: number): string;
/** 本地时区 ISO 时间（带 +08:00 形式偏移），与需求示例一致。 */
export declare function nowIso(date?: Date): string;
/** 取 ISO 时间的日期部分（YYYY-MM-DD）；非法值返回空串。 */
export declare function isoDatePart(value: string | undefined): string;
/** 归一化空白：去除首尾空白并把内部连续空白折叠为单个空格。 */
export declare function tidy(value: string): string;
/** 把任意错误转成可读短文本（插件内异常一律不抛给模型）。 */
export declare function errorText(error: unknown): string;
/** 深冻结（递归），用于构造交给运行时的消息对象。 */
export declare function deepFreeze<T>(value: T): T;
