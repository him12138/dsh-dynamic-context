/**
 * dsh-dynamic-context 检索评分（纯函数：同步、确定性、无 LLM、无 IO、无 DSH 依赖）。
 *
 * 设计依据：tech-design-dsh-memory.md §9（检索算法）、
 *           requirements-dsh-memory-v0.2.md §6.4（检索）。
 * 契约：.notes/CONTRACTS.md §1（导出名/签名/评分规则以契约为准）。
 */
import type { Card } from './types.js';
/**
 * 归一化：转小写 + 去掉所有空白/标点/符号（保留汉字/字母/数字）。
 * 行为等价于 `s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')`。
 * 例：`'  Hello, 世界！Node.js '` -> `'hello世界nodejs'`
 */
export declare function normalize(s: string): string;
/**
 * 归一化后按字符（Unicode 码点）取相邻二元组。
 * 归一化后长度 < 2 时返回 0/1 个元素的集合（与设计 §9 伪代码一致）。
 */
export declare function bigrams(s: string): Set<string>;
/**
 * |query ∩ target| / |query|；query 为空（或 target 为空）返回 0。
 * 纯 bigram 集合的相似度，取值 [0, 1]。
 */
export declare function overlap(query: Set<string>, target: Set<string>): number;
/**
 * 单卡片相关度评分（契约 §1 / 设计 §9）：
 *
 *   score = 4 * tagExactMatch + 2.5 * tagContains
 *         + 3 * overlap(query, title) + 2 * overlap(query, conclusion)
 *         + 1 * overlap(query, digest)
 *
 * - query 归一化后为空：返回 0（无有效查询，不评分）。
 * - query 归一化后长度 < 2：不做 bigram，title/conclusion/digest 改为
 *   "互相包含"的子串命中（命中记对应权重），见 substringHit()。
 */
export declare function scoreCard(card: Card, query: string): number;
/**
 * 检索卡片（契约 §1）：
 * - query 为 undefined / 空 / 纯空白（trim 后为空）：不评分，返回最近 limit 条。
 * - 否则按 scoreCard 打分，score >= 1.0 才返回；按 score 降序，
 *   同分按 sealedAt 降序，再按 id 降序。
 *
 * 纯函数、同步、确定性；不修改入参数组/卡片对象。
 */
export declare function searchCards(cards: readonly Card[], query: string | undefined, limit: number): Card[];
