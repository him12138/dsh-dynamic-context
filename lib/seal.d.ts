/**
 * `memory_seal` 参数清洗与字段约束（需求 §6.2、技术设计 §7.1）。
 *
 * - 标题 ≤ 20 字；标签 3–5 个、每个 ≤ 16 字；结论 ≤ 40 字且含结果/状态；
 *   摘要 ≤ digestMaxChars（默认 320，建议 200–300）。
 * - 超出上限时**截断并提示**（提示会随工具结果返回给模型）；缺失必填字段则拒收并给用法。
 */
import type { CardInput, CardPatch, CardStatus, MemoryConfig } from './types.js';
export declare const TITLE_MAX_CHARS = 20;
export declare const TAG_MAX_CHARS = 16;
export declare const TAG_MIN = 3;
export declare const TAG_MAX = 5;
export declare const CONCLUSION_MAX_CHARS = 40;
export declare const UNCATEGORIZED_TAG = "\u672A\u5206\u7C7B";
/** `memory_seal` 的规范化结果。 */
export type NormalizeSealResult = {
    readonly ok: false;
    readonly message: string;
} | {
    readonly ok: true;
    /** 传入则更新已有卡片。 */
    readonly cardId: number | undefined;
    /** 新建卡片时的输入。 */
    readonly input: CardInput;
    /** 更新已有卡片时的字段补丁（只含模型给出的字段）。 */
    readonly patch: CardPatch;
    /** 截断/补全等提示（会随工具结果返回）。 */
    readonly hints: string[];
};
export declare function isMemoryStatus(value: unknown): value is CardStatus;
/**
 * 清洗 `memory_seal` 参数；非法输入返回可读错误文本，绝不抛错。
 */
export declare function normalizeSealArgs(rawArgs: unknown, config: MemoryConfig): NormalizeSealResult;
