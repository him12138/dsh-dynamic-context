/**
 * 渲染层：固定记忆段、行为规则段、常驻卡片索引、摘要/检索/原话文本。
 *
 * 预算（需求 §7）：固定记忆 ≤ maxPersonaChars 字；规则段尽量短；常驻索引 ≤ maxIndexChars 字，
 * 且**文本稳定**——只随卡片集合/状态与 pendingEnd 变化，不含时间戳/计数抖动（不变式 I4）。
 */
import type { Card, MemoryConfig } from './types.js'
import { countChars, isoDatePart, truncateChars } from './util.js'
import { sortForIndex } from './store.js'

/** 固定记忆段前缀：告诉模型这段文本的性质（不是人设文件内容的一部分）。 */
export const PERSONA_INTRO = '以下是人设与固定偏好，来自项目 memory/persona.md，请始终遵守：'

/** 固定记忆被截断时的提示（不修改用户文件，需求 §6.1）。 */
export function personaTruncatedHint(maxPersonaChars: number): string {
  return `（人设文档过长，已截断；请提醒用户精简到 ${maxPersonaChars} 字以内）`
}

/**
 * 行为规则段（技术设计 §6.2；需求 §7 预算 ≤220 tokens，已压缩到约 300 汉字）。
 * 常驻系统提示词，教模型何时封存/检索/展开/回溯克制/更新人设。
 */
export const GUIDE_TEXT = [
  '项目记忆工具（memory_*）规则：',
  '1) 读取克制：memory_search 仅在用户提到过去任务时用；memory_open / memory_raw 仅当前任务确需旧细节时调，一次一条，看完不追问就停。常驻索引已够用，别为“可能有帮助”多读。',
  '2) 实质产出才写：改过文件、跑通命令或给出可执行结论，才在收尾时用 memory_seal 写卡；只看文件、纯问答、闲聊不写。写完在回复末尾单独一行报「📌 已记录 #N · 标题」，供用户纠正。用户说“记一下还没完”可写 open 卡片。',
  '3) 固定记忆只存长期有效、会改变默认行为的信息：称呼、语气、偏好、硬规则、身份、协作习惯；不存任务过程、一次性指令、路径、敏感信息、寒暄。仅按用户要求用 memory_persona 整体替换，先自检字数，超 3000 字自行归纳压缩，必须自包含。',
  '4) 不编造：没有记录就说没有记录；open 卡不算定稿；原话仅在摘要不足以回答时取。',
].join('\n')

export function statusLabel(status: Card['status']): string {
  return status === 'open' ? '进行中' : '完成'
}

/** 渲染固定记忆段；无人设文件/空文件时不注入。 */
export function renderPersonaSection(persona: string | null, config: MemoryConfig): string {
  if (persona === null || persona.trim() === '') return ''
  if (countChars(persona) > config.maxPersonaChars) {
    return `${PERSONA_INTRO}\n${truncateChars(persona, config.maxPersonaChars)}\n${personaTruncatedHint(config.maxPersonaChars)}`
  }
  return `${PERSONA_INTRO}\n${persona}`
}

/** 行为规则段（可配置关闭）；人设上限值随配置替换，避免文案与校验口径不一致。 */
export function renderGuideSection(config: MemoryConfig): string {
  if (!config.enableGuide) return ''
  return config.maxPersonaChars === 3000
    ? GUIDE_TEXT
    : GUIDE_TEXT.replace('3000 字', `${config.maxPersonaChars} 字`)
}

/** 索引条目单行格式（需求 §6.3）。 */
export function indexLine(card: Card): string {
  const tags = card.tags.length > 0 ? card.tags.join(',') : '无'
  return `#${card.id} [${statusLabel(card.status)}] ${card.title} · 标签: ${tags} · 结论: ${card.conclusion}`
}

export interface IndexRenderOptions {
  /** 用户执行过 /memory end 且尚未封存。 */
  readonly pendingEnd: boolean
  /** 人设文件缺失（索引末尾提示）。 */
  readonly personaMissing: boolean
}

/**
 * 渲染常驻索引（需求 §6.3、技术设计 §6.3）：
 * - 最近 N 条（open 在前、其余按 sealedAt 倒序），每行 `#id [状态] 标题 · 标签: a,b · 结论: …`
 * - 头部带总数与导航；空态固定文案
 * - 仅在 pendingEnd / 人设缺失时追加固定提示行
 * - 超预算从最旧一条开始丢弃并加 `…`；仍超则硬截断
 */
export function renderIndex(
  cards: readonly Card[],
  config: MemoryConfig,
  options: IndexRenderOptions,
): string {
  const total = cards.length
  const selected = sortForIndex(cards).slice(0, config.recentCards)
  const extras: string[] = []
  if (options.pendingEnd) {
    extras.push('【待办】用户已请求结束当前任务，请尽快调用 memory_seal 写卡片。')
  }
  if (options.personaMissing && config.enablePersonaHint) {
    extras.push('【提示】尚未设置人设文档（memory/persona.md）；可把长期偏好写进去。')
  }

  if (total === 0) {
    return fitIndex(['【项目记忆】共 0 条任务；完成任务后会自动记录。', ...extras], config.maxIndexChars)
  }

  const header = `【项目记忆】最近 ${selected.length} 条任务（共 ${total} 条；可用 memory_search 检索、memory_open 看摘要、memory_raw 看原话）`
  const entries = selected.map(indexLine)
  let dropped = false
  const build = (): string => [header, ...entries, ...(dropped ? ['…'] : []), ...extras].join('\n')
  while (countChars(build()) > config.maxIndexChars && entries.length > 0) {
    entries.pop()
    dropped = true
  }
  return fitIndexText(build(), config.maxIndexChars)
}

function fitIndex(lines: readonly string[], maxChars: number): string {
  return fitIndexText(lines.join('\n'), maxChars)
}

function fitIndexText(text: string, maxChars: number): string {
  if (countChars(text) <= maxChars) return text
  return `${truncateChars(text, Math.max(0, maxChars - 1))}…`
}

/** `/memory list` 行格式（需求 §6.8）。 */
export function renderCardList(cards: readonly Card[]): string {
  if (cards.length === 0) return '暂无任务卡片（共 0 条）。'
  return cards
    .map((card) => {
      const date = isoDatePart(card.sealedAt) || isoDatePart(card.createdAt)
      return `#${card.id} [${statusLabel(card.status)}] ${card.title} · 结论: ${card.conclusion} · ${date}`
    })
    .join('\n')
}

/** 检索结果行格式（需求 §6.4）。 */
export function renderSearchResults(cards: readonly Card[]): string {
  if (cards.length === 0) return '未找到匹配卡片。'
  return cards
    .map((card) => `#${card.id} [${statusLabel(card.status)}] ${card.title} · 标签: ${card.tags.join(',')} · 结论: ${card.conclusion}`)
    .join('\n')
}

/** `memory_open` 输出（需求 §6.5：摘要 + 元信息 + 原话是否可读）。 */
export function renderCardOpen(card: Card, rawAvailable: boolean): string {
  const date = isoDatePart(card.sealedAt) || isoDatePart(card.createdAt)
  const tags = card.tags.length > 0 ? card.tags.join(', ') : '无'
  const rawLine = rawAvailable
    ? '原话：可用 memory_raw 查看（会话记录存在）。'
    : '原话：原话不可用（会话记录已删除或不可读）；摘要仍可用。'
  return [
    `#${card.id} ${card.title}（${statusLabel(card.status)}，${date}）`,
    `标签：${tags}`,
    `摘要：${card.digest}`,
    rawLine,
  ].join('\n')
}

/** 原话片段输出头（需求 §6.6：默认最新片段；cursor>0 才是更早片段）。 */
export function rawChunkHeader(card: Card, cursor: number): string {
  return cursor > 0 ? `原话片段（任务 #${card.id}，更早片段）：` : `原话片段（任务 #${card.id}，最新片段）：`
}

/** 原话片段尾注：只在有更早内容且模型可能想继续翻时给出 cursor；默认克制。 */
export function rawChunkFooter(nextCursor: number, hasMore: boolean): string {
  if (!hasMore) return '——\n（已到该任务区间开头）'
  return `——\n（若确有必要看更早内容，再传 cursor=${nextCursor}；无明确需要不要继续往前翻。）`
}

/** 索引文本的 token 粗估（供 README/验收记录参考，不作为门槛）。 */
export function estimateIndexChars(cards: readonly Card[], config: MemoryConfig, options: IndexRenderOptions): number {
  return countChars(renderIndex(cards, config, options))
}
