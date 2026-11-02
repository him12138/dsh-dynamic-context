/**
 * dsh-dynamic-context 检索评分（纯函数：同步、确定性、无 LLM、无 IO、无 DSH 依赖）。
 *
 * 设计依据：tech-design-dsh-memory.md §9（检索算法）、
 *           requirements-dsh-memory-v0.2.md §6.4（检索）。
 * 契约：.notes/CONTRACTS.md §1（导出名/签名/评分规则以契约为准）。
 */

import type { Card } from './types.js'

// ---------------------------------------------------------------------------
// normalize：小写 + 去掉所有空白/标点/符号（保留汉字/字母/数字）
//
// 契约语义：`s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')`。
// 该 regex 对每个字符做 Unicode 属性判断，实测 1000 条卡片（约 30 万字）耗时
// 约 5ms；为贴近契约"1000 卡片单次 < 2ms"的目标，这里改为逐码点扫描：
//   - ASCII 码点用查表（模块加载时按同一 regex 预计算，结果与 regex 完全一致）；
//   - 其它码点首次出现时用同一条 regex 分类并缓存（Uint8Array + Map），
//     结果同样与 regex 完全一致（见 search.test.mjs 的全 BMP 等价性测试）。
// 因此 normalize 的可观察行为严格等于契约给出的 regex 实现。
// ---------------------------------------------------------------------------

const CLASS_UNKNOWN = 2
const CLASS_DROP = 0
const CLASS_KEEP = 1

/** 单个字符是否属于契约要去掉的字符类 `[\s\p{P}\p{S}]`。 */
const DROP_CHAR = /[\s\p{P}\p{S}]/u

/** 按码点缓存的分类结果：BMP 用定长数组（快），增补平面用 Map（极少见）。 */
const bmpClass = new Uint8Array(0x10000).fill(CLASS_UNKNOWN)
const astralClass = new Map<number, number>()

function classifyCodePoint(codePoint: number): number {
  const cls = DROP_CHAR.test(String.fromCodePoint(codePoint)) ? CLASS_DROP : CLASS_KEEP
  if (codePoint <= 0xffff) bmpClass[codePoint] = cls
  else astralClass.set(codePoint, cls)
  return cls
}

// ASCII 码点（0x00-0x7F）在模块加载时一次性预计算，避免运行期判断。
for (let code = 0; code < 0x80; code++) {
  bmpClass[code] = DROP_CHAR.test(String.fromCharCode(code)) ? CLASS_DROP : CLASS_KEEP
}

/**
 * 归一化：转小写 + 去掉所有空白/标点/符号（保留汉字/字母/数字）。
 * 行为等价于 `s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')`。
 * 例：`'  Hello, 世界！Node.js '` -> `'hello世界nodejs'`
 */
export function normalize(s: string): string {
  const lower = s.toLowerCase()
  let out = ''
  for (let i = 0; i < lower.length; i++) {
    const code = lower.charCodeAt(i)

    if (code < 0x80) {
      if (bmpClass[code] === CLASS_KEEP) out += lower[i]
      continue
    }

    if (code >= 0xd800 && code <= 0xdbff) {
      // 高代理项：可能是增补平面字符（emoji 等），也可能是孤立代理项。
      const codePoint = lower.codePointAt(i)!
      const width = codePoint > 0xffff ? 2 : 1
      const cls = astralClass.get(codePoint) ?? classifyCodePoint(codePoint)
      if (cls === CLASS_KEEP) out += lower.slice(i, i + width)
      i += width - 1
      continue
    }

    let cls = bmpClass[code]
    if (cls === CLASS_UNKNOWN) cls = classifyCodePoint(code)
    if (cls === CLASS_KEEP) out += lower[i]
  }
  return out
}

// ---------------------------------------------------------------------------
// bigram / overlap（契约导出的基础函数）
// ---------------------------------------------------------------------------

/** 内部版：输入已归一化，按字符（码点）取相邻二元组；长度 <2 返回 0/1 个元素。 */
function bigramsOfNormalized(n: string): Set<string> {
  const chars = [...n]
  if (chars.length < 2) return new Set<string>(chars)
  const out = new Set<string>()
  for (let i = 0; i < chars.length - 1; i++) out.add(chars[i]! + chars[i + 1]!)
  return out
}

/**
 * 归一化后按字符（Unicode 码点）取相邻二元组。
 * 归一化后长度 < 2 时返回 0/1 个元素的集合（与设计 §9 伪代码一致）。
 */
export function bigrams(s: string): Set<string> {
  return bigramsOfNormalized(normalize(s))
}

/**
 * |query ∩ target| / |query|；query 为空（或 target 为空）返回 0。
 * 纯 bigram 集合的相似度，取值 [0, 1]。
 */
export function overlap(query: Set<string>, target: Set<string>): number {
  if (query.size === 0 || target.size === 0) return 0
  let hit = 0
  for (const g of query) if (target.has(g)) hit++
  return hit / query.size
}

/**
 * 与 overlap(query, bigrams(target)) 等价、但避免为 target 构建集合的快速实现：
 * query 的某个 bigram 在归一化 target 中出现，当且仅当它属于 target 的 bigram 集合。
 */
function bigramHits(queryBigrams: Set<string>, targetNormalized: string): number {
  if (queryBigrams.size === 0 || targetNormalized.length === 0) return 0
  let hit = 0
  for (const gram of queryBigrams) if (targetNormalized.includes(gram)) hit++
  return hit / queryBigrams.size
}

/**
 * 子串"互相包含"命中：haystack 含 needle 或 needle 含 haystack 记 1，否则 0。
 * 用于查询归一化后长度 < 2 的退化路径（不做 bigram，仅子串匹配，契约 §1）。
 * 空串不参与匹配，避免 "" 包含一切造成的假阳性。
 */
function substringHit(haystack: string, needle: string): number {
  if (haystack.length === 0 || needle.length === 0) return 0
  return haystack.includes(needle) || needle.includes(haystack) ? 1 : 0
}

/** 字符串比较（sealedAt 为 ISO 时间字符串；按字典序即时间序，确定性）。 */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 标签精确/包含匹配得分（各自 0/1 标志，按契约公式可叠加）。 */
function tagScore(card: Card, queryNormalized: string): number {
  let exact = 0
  let contains = 0
  for (const rawTag of card.tags) {
    const tag = normalize(rawTag)
    if (tag.length === 0) continue
    if (tag === queryNormalized) exact = 1
    if (tag.includes(queryNormalized) || queryNormalized.includes(tag)) contains = 1
  }
  return 4 * exact + 2.5 * contains
}

/** scoreCard 的内部形式：query 已归一化，避免每张卡重复归一化查询。 */
function scoreCardNormalized(card: Card, q: string, qBigrams: Set<string> | undefined): number {
  let score = tagScore(card, q)

  const title = normalize(card.title)
  const conclusion = normalize(card.conclusion)
  const digest = normalize(card.digest)

  if (q.length < 2) {
    // 退化路径：单字（或标点/空白归一化后只剩 1 字符）只做子串包含。
    score += 3 * substringHit(title, q)
    score += 2 * substringHit(conclusion, q)
    score += 1 * substringHit(digest, q)
    return score
  }

  const grams = qBigrams ?? bigramsOfNormalized(q)
  score += 3 * bigramHits(grams, title)
  score += 2 * bigramHits(grams, conclusion)
  score += 1 * bigramHits(grams, digest)
  return score
}

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
export function scoreCard(card: Card, query: string): number {
  const q = normalize(query)
  if (q.length === 0) return 0
  return scoreCardNormalized(card, q, q.length < 2 ? undefined : bigramsOfNormalized(q))
}

// ---------------------------------------------------------------------------
// searchCards
// ---------------------------------------------------------------------------

/** limit 规范化：非有限值/<=0 视为不返回。 */
function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 0
  const n = Math.floor(limit)
  return n > 0 ? n : 0
}

/**
 * 无 query 的"最近列表"：
 *   open 卡在前（sealedAt 升序），其余 done 按 sealedAt 倒序，取前 limit 条。
 */
function recentCards(cards: readonly Card[], limit: number): Card[] {
  const open: Card[] = []
  const rest: Card[] = []
  for (const card of cards) {
    if (card.status === 'open') open.push(card)
    else rest.push(card)
  }
  open.sort((a, b) => compareText(a.sealedAt, b.sealedAt))
  rest.sort((a, b) => compareText(b.sealedAt, a.sealedAt))
  return open.concat(rest).slice(0, limit)
}

/**
 * 检索卡片（契约 §1）：
 * - query 为 undefined / 空 / 纯空白（trim 后为空）：不评分，返回最近 limit 条。
 * - 否则按 scoreCard 打分，score >= 1.0 才返回；按 score 降序，
 *   同分按 sealedAt 降序，再按 id 降序。
 *
 * 纯函数、同步、确定性；不修改入参数组/卡片对象。
 */
export function searchCards(cards: readonly Card[], query: string | undefined, limit: number): Card[] {
  const max = clampLimit(limit)
  if (max === 0) return []

  if (query === undefined || query.trim() === '') return recentCards(cards, max)

  const queryNormalized = normalize(query)
  if (queryNormalized.length === 0) return []

  const qBigrams = queryNormalized.length < 2 ? undefined : bigramsOfNormalized(queryNormalized)

  const scored: Array<{ card: Card; score: number }> = []
  for (const card of cards) {
    const score = scoreCardNormalized(card, queryNormalized, qBigrams)
    if (score >= 1.0) scored.push({ card, score })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const bySealed = compareText(b.card.sealedAt, a.card.sealedAt) // 降序
    if (bySealed !== 0) return bySealed
    return b.card.id - a.card.id // id 降序
  })

  return scored.slice(0, max).map((entry) => entry.card)
}
