/**
 * 渲染层：固定记忆段、行为规则段、常驻卡片索引、摘要/检索/原话文本。
 *
 * 预算（需求 §7）：固定记忆 ≤ maxPersonaChars 字；规则段尽量短；常驻索引 ≤ maxIndexChars 字，
 * 且**文本稳定**——只随卡片集合/状态与 pendingEnd 变化，不含时间戳/计数抖动（不变式 I4）。
 */
import type { Card, MemoryConfig } from './types.js';
/** 固定记忆段前缀：告诉模型这段文本的性质（不是人设文件内容的一部分）。 */
export declare const PERSONA_INTRO = "\u4EE5\u4E0B\u662F\u4EBA\u8BBE\u4E0E\u56FA\u5B9A\u504F\u597D\uFF0C\u6765\u81EA\u9879\u76EE memory/persona.md\uFF0C\u8BF7\u59CB\u7EC8\u9075\u5B88\uFF1A";
/** 固定记忆被截断时的提示（不修改用户文件，需求 §6.1）。 */
export declare function personaTruncatedHint(maxPersonaChars: number): string;
/**
 * 行为规则段（技术设计 §6.2；需求 §7 预算 ≤220 tokens，已压缩到约 300 汉字）。
 * 常驻系统提示词，教模型何时封存/检索/展开/回溯克制/更新人设。
 */
export declare const GUIDE_TEXT: string;
export declare function statusLabel(status: Card['status']): string;
/** 渲染固定记忆段；无人设文件/空文件时不注入。 */
export declare function renderPersonaSection(persona: string | null, config: MemoryConfig): string;
/** 行为规则段（可配置关闭）；人设上限值随配置替换，避免文案与校验口径不一致。 */
export declare function renderGuideSection(config: MemoryConfig): string;
/** 索引条目单行格式（需求 §6.3）。 */
export declare function indexLine(card: Card): string;
export interface IndexRenderOptions {
    /** 用户执行过 /memory end 且尚未封存。 */
    readonly pendingEnd: boolean;
    /** 人设文件缺失（索引末尾提示）。 */
    readonly personaMissing: boolean;
}
/**
 * 渲染常驻索引（需求 §6.3、技术设计 §6.3）：
 * - 最近 N 条（open 在前、其余按 sealedAt 倒序），每行 `#id [状态] 标题 · 标签: a,b · 结论: …`
 * - 头部带总数与导航；空态固定文案
 * - 仅在 pendingEnd / 人设缺失时追加固定提示行
 * - 超预算从最旧一条开始丢弃并加 `…`；仍超则硬截断
 */
export declare function renderIndex(cards: readonly Card[], config: MemoryConfig, options: IndexRenderOptions): string;
/** `/memory list` 行格式（需求 §6.8）。 */
export declare function renderCardList(cards: readonly Card[]): string;
/** 检索结果行格式（需求 §6.4）。 */
export declare function renderSearchResults(cards: readonly Card[]): string;
/** `memory_open` 输出（需求 §6.5：摘要 + 元信息 + 原话是否可读）。 */
export declare function renderCardOpen(card: Card, rawAvailable: boolean): string;
/** 原话片段输出头（需求 §6.6：默认最新片段；cursor>0 才是更早片段）。 */
export declare function rawChunkHeader(card: Card, cursor: number): string;
/** 原话片段尾注：只在有更早内容且模型可能想继续翻时给出 cursor；默认克制。 */
export declare function rawChunkFooter(nextCursor: number, hasMore: boolean): string;
/** 索引文本的 token 粗估（供 README/验收记录参考，不作为门槛）。 */
export declare function estimateIndexChars(cards: readonly Card[], config: MemoryConfig, options: IndexRenderOptions): number;
