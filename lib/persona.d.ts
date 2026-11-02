/**
 * dsh-memory 固定记忆文档（人设）校验（纯函数：无 IO、无 DSH 依赖）。
 *
 * 设计依据：tech-design-dsh-memory.md §7.5 第 2–3 步、
 *           requirements-dsh-memory-v0.2.md §6.1（总长上限 3000 字 + 自包含）。
 * 契约：.notes/CONTRACTS.md §2（导出名/签名/文案以契约为准）。
 *
 * 说明：工具只做"安全兜底"——超长只退回并提示模型先归纳压缩，绝不自动截断；
 * 外部文档引用只退回并给出建议，不修改内容。
 */
/** 按 Unicode 码点计"字"（emoji / 扩展区字符按 1 个字计，与 [...s].length 一致）。
 *  统一从 util.js 引入并再导出，避免与 store/seal 各持一份实现导致口径漂移。 */
import { countChars } from './util.js';
export { countChars };
/** checkPersona 的结果（判别联合，与契约 §2 一致）。 */
export type PersonaCheck = {
    ok: true;
} | {
    ok: false;
    code: 'too-long';
    length: number;
    message: string;
} | {
    ok: false;
    code: 'reference';
    length: number;
    message: string;
    hits: string[];
};
/**
 * 校验待写入的人设文档（契约 §2）：
 *   1. 先做长度兜底：length > maxChars -> too-long（优先于引用检查）。
 *   2. 再做自包含检查：命中外部文档引用 -> reference，hits 为命中的原文片段（最多 3 条）。
 *   3. 都通过 -> { ok: true }。
 */
export declare function checkPersona(content: string, maxChars: number): PersonaCheck;
