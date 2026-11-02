/**
 * 业务编排层：把存储、渲染、检索、原话、命令与注入串起来。
 *
 * 设计原则（技术设计 §13）：记忆功能失败不得导致对话失败——所有对外方法
 * 捕获内部异常并降级为可读文本；注入方法失败返回空串。
 */
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { Card, CardInput, CardPatch, CardStatus, MemoryConfig } from './types.js'
import { MemoryError } from './types.js'
import { ProjectStore, sortRecent } from './store.js'
import { normalizeSealArgs } from './seal.js'
import { checkPersona } from './persona.js'
import { searchCards } from './search.js'
import { probeRawAvailable, readRawTranscript } from './transcript.js'
import {
  rawChunkFooter,
  rawChunkHeader,
  renderCardList,
  renderCardOpen,
  renderGuideSection,
  renderIndex,
  renderPersonaSection,
  renderSearchResults,
  statusLabel,
} from './render.js'
import { countChars, deepFreeze, errorText, tidy } from './util.js'
import type {
  AgentLike,
  CommandResultLike,
  LoggerLike,
  RawSessionLike,
  ToolRunContextLike,
} from './platform.js'

/** 控制器依赖：会话读取由注入的 DSH `ctx.sessionQuery.readSession` 提供。 */
export interface ControllerOptions {
  readonly config: MemoryConfig
  readonly readSession: (sessionId: string) => Promise<RawSessionLike>
  readonly logger?: LoggerLike
}

/** 构造一条可作为 next-step 附加上下文的 user 消息（结构同 dsh-llm createUserMessage）。 */
export function makeUserMessage(text: string): unknown {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

export class Controller {
  readonly config: MemoryConfig
  private readonly readSessionImpl: (sessionId: string) => Promise<RawSessionLike>
  private readonly logger?: LoggerLike
  private readonly stores = new Map<string, ProjectStore>()
  /** 用户执行过 `/memory end`、等待模型封存的会话（sessionId → 时间戳）。 */
  private readonly pendingEnd = new Map<string, number>()

  constructor(options: ControllerOptions) {
    this.config = options.config
    this.readSessionImpl = options.readSession
    this.logger = options.logger
  }

  private logWarn(message: string): void {
    try {
      this.logger?.warn?.(message)
    } catch {
      /* 日志失败不影响主流程 */
    }
  }

  private storeFor(cwd: string): ProjectStore {
    const key = resolve(cwd)
    const previous = this.stores.get(key)
    if (previous !== undefined) return previous
    const store = new ProjectStore(key, this.config, this.logger)
    this.stores.set(key, store)
    return store
  }

  private agentCwd(agent: AgentLike | undefined): string | undefined {
    const cwd = agent?.session?.header?.cwd
    return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined
  }

  private reader(): { readSession(id: string): Promise<RawSessionLike> } {
    return { readSession: (id: string) => this.readSessionImpl(id) }
  }

  private sessionIdOf(agent: AgentLike | undefined): string | undefined {
    const id = agent?.session?.id
    return typeof id === 'string' && id !== '' ? id : undefined
  }

  // ------------------------------------------------------------- injection

  /** systemPrompt.section：固定记忆段（每请求重渲染 → 用户改文件下一轮生效）。 */
  personaSection(agent: AgentLike | undefined): string {
    try {
      const cwd = this.agentCwd(agent)
      if (cwd === undefined) return ''
      return renderPersonaSection(this.storeFor(cwd).readPersonaCached(), this.config)
    } catch (error) {
      this.logWarn(`[dsh-memory] 人设段渲染失败：${errorText(error)}`)
      return ''
    }
  }

  /** systemPrompt.section：行为规则段。 */
  guideSection(): string {
    try {
      return renderGuideSection(this.config)
    } catch (error) {
      this.logWarn(`[dsh-memory] 规则段渲染失败：${errorText(error)}`)
      return ''
    }
  }

  /** systemPrompt.context：常驻卡片索引（稳定文本，变化才追加）。 */
  indexContext(agent: AgentLike | undefined): string {
    try {
      const cwd = this.agentCwd(agent)
      if (cwd === undefined) return ''
      const store = this.storeFor(cwd)
      const sessionId = this.sessionIdOf(agent)
      const pendingEnd = sessionId !== undefined && this.pendingEnd.has(sessionId)
      const personaMissing = store.readPersonaCached() === null
      return renderIndex(store.listCards(), this.config, { pendingEnd, personaMissing })
    } catch (error) {
      this.logWarn(`[dsh-memory] 索引渲染失败：${errorText(error)}`)
      return ''
    }
  }

  // ------------------------------------------------------------------ tools

  /** `memory_seal`：写入/更新一张任务卡片。 */
  seal(agent: AgentLike | undefined, rawArgs: unknown, defer?: (message: unknown) => void): string {
    try {
      const cwd = this.agentCwd(agent)
      const sessionId = this.sessionIdOf(agent)
      const toSeq = agent?.session?.seq
      if (cwd === undefined || sessionId === undefined || typeof toSeq !== 'number') {
        return '记忆写入失败：无法确定当前会话的项目目录或会话序号。'
      }
      const parsed = normalizeSealArgs(rawArgs, this.config)
      if (!parsed.ok) return parsed.message
      const env = { sessionId, sessionCwd: cwd, toSeq }
      const store = this.storeFor(cwd)
      const hints = parsed.hints.length > 0 ? `\n${parsed.hints.map((hint) => `（${hint}）`).join('\n')}` : ''

      if (parsed.cardId !== undefined) {
        const existing = store.findCard(parsed.cardId)
        if (existing === undefined) {
          return `未找到卡片 #${parsed.cardId}；可用 memory_search 查看已有卡片 id。`
        }
        const updated = store.updateCard(parsed.cardId, parsed.patch, env)
        if (updated === undefined) return `未找到卡片 #${parsed.cardId}。`
        this.pendingEnd.delete(sessionId)
        return `已更新 #${updated.id}「${updated.title}」（${statusLabel(updated.status)}）。当前共 ${store.totalCards()} 条任务。${hints}`
      }

      const input = parsed.input
      const card = store.addCard(input, env)
      this.pendingEnd.delete(sessionId)
      if (typeof defer === 'function') {
        try {
          defer(makeUserMessage(`[记忆] 卡片 #${card.id}「${card.title}」已入目录。当前共 ${store.totalCards()} 条任务。`))
        } catch {
          /* 附加上下文失败不影响写入结果 */
        }
      }
      return `已记录 #${card.id}「${card.title}」（${statusLabel(card.status)}）。当前共 ${store.totalCards()} 条任务。${hints}`
    } catch (error) {
      if (error instanceof MemoryError) return error.message
      return `记忆写入失败：${errorText(error)}`
    }
  }

  /** `memory_search`：只搜卡片字段（标题/标签/结论/摘要），不搜原话。 */
  search(agent: AgentLike | undefined, rawQuery: unknown, rawLimit: unknown): string {
    try {
      const cwd = this.agentCwd(agent)
      if (cwd === undefined) return '记忆检索失败：无法确定当前会话的项目目录。'
      const store = this.storeFor(cwd)
      const cards = store.listCards()
      const query = typeof rawQuery === 'string' ? tidy(rawQuery) : ''
      if (query === '') {
        const recent = sortRecent(cards).slice(0, this.config.listLimit)
        return renderSearchResults(recent)
      }
      let limit = this.config.searchLimit
      if (typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0) {
        limit = Math.min(Math.floor(rawLimit), 10)
      }
      return renderSearchResults(searchCards(cards, query, limit))
    } catch (error) {
      return `记忆检索失败：${errorText(error)}`
    }
  }

  /** `memory_open`：展开一张卡片的摘要与元信息，并报告原话是否可读。 */
  async open(agent: AgentLike | undefined, rawId: unknown): Promise<string> {
    try {
      const cwd = this.agentCwd(agent)
      if (cwd === undefined) return '记忆读取失败：无法确定当前会话的项目目录。'
      const id = toCardId(rawId)
      if (id === undefined) return '用法：memory_open 需要整数参数 id（例如 12）。'
      const store = this.storeFor(cwd)
      const card = store.findCard(id)
      if (card === undefined) return `未找到卡片 #${id}（可能已删除）。当前共 ${store.totalCards()} 条任务。`
      const available = await probeRawAvailable(this.reader(), card.rawRef.sessionId)
      return renderCardOpen(card, available)
    } catch (error) {
      return `记忆读取失败：${errorText(error)}`
    }
  }

  /** `memory_raw`：读取某任务原话片段；默认只给最新约 rawChunkChars 字。 */
  async raw(agent: AgentLike | undefined, rawId: unknown, rawCursor: unknown): Promise<string> {
    try {
      const cwd = this.agentCwd(agent)
      if (cwd === undefined) return '记忆读取失败：无法确定当前会话的项目目录。'
      const id = toCardId(rawId)
      if (id === undefined) return '用法：memory_raw 需要整数参数 id（例如 12）。'
      const store = this.storeFor(cwd)
      const card = store.findCard(id)
      if (card === undefined) return `未找到卡片 #${id}（可能已删除）。当前共 ${store.totalCards()} 条任务。`
      const cursor =
        typeof rawCursor === 'number' && Number.isFinite(rawCursor) && rawCursor > 0 ? Math.floor(rawCursor) : 0
      const result = await readRawTranscript(this.reader(), {
        sessionId: card.rawRef.sessionId,
        // rawRef.fromSeq=0 表示"从会话开头算起"；区间约定为 (fromSeq, toSeq]，
        // 传 -1 才能把 seq 0 的第一条用户消息包含进来（否则首张卡片会丢掉开头）。
        fromSeq: card.rawRef.fromSeq === 0 ? -1 : card.rawRef.fromSeq,
        toSeq: card.rawRef.toSeq,
        cursor,
        chunkChars: this.config.rawChunkChars,
      })
      if (!result.ok || result.slice === undefined) {
        return result.message ?? '原话不可用（会话记录已删除或不可读）；摘要仍可用。'
      }
      if (result.slice.text.trim() === '') {
        return '原话区间内没有可读内容（任务区间近似或会话记录已被精简）；摘要仍可用。'
      }
      return [
        rawChunkHeader(card, cursor),
        result.slice.text,
        rawChunkFooter(result.slice.nextCursor, result.slice.hasMore),
      ].join('\n')
    } catch (error) {
      return `原话读取失败：${errorText(error)}；摘要仍可用。`
    }
  }

  /** `memory_persona`：凝练更新固定记忆文档（校验、备份、原子写）。 */
  updatePersona(agent: AgentLike | undefined, rawContent: unknown, reason?: unknown): string {
    try {
      const cwd = this.agentCwd(agent)
      if (cwd === undefined) return '人设更新失败：无法确定当前会话的项目目录。'
      if (typeof rawContent !== 'string') return '人设更新失败：content 必须是字符串（人设文档全文）。'
      const check = checkPersona(rawContent, this.config.maxPersonaChars)
      if (!check.ok) return check.message
      const store = this.storeFor(cwd)
      const previous = store.readPersonaCached()
      const previousLength = previous === null ? 0 : countChars(previous)
      const written = store.writePersona(rawContent)
      this.logger?.info?.(
        `[dsh-memory] 人设已更新（${written.length} 字${typeof reason === 'string' && reason.trim() !== '' ? `；原因：${reason.trim()}` : ''}）`,
      )
      const backupNote = written.backedUp ? '，已备份旧版本' : ''
      let text = `已更新人设文档（${written.length} 字${backupNote}）。下一轮对话生效。`
      if (previousLength > 0 && written.length > Math.floor(previousLength * 1.2)) {
        text += `\n内容变长（${previousLength} → ${written.length} 字），请确认是否确有必要；日常建议保持在 200–800 字。`
      }
      return text
    } catch (error) {
      if (error instanceof MemoryError) return error.message
      return `人设更新失败：${errorText(error)}`
    }
  }

  // --------------------------------------------------------------- commands

  /** `/memory ...` 命令分发。 */
  async command(rawInput: string, agent: AgentLike | undefined): Promise<CommandResultLike> {
    try {
      const input = typeof rawInput === 'string' ? rawInput.trim() : ''
      const [subRaw, ...rest] = input === '' ? [] : input.split(/\s+/)
      const sub = (subRaw ?? '').toLowerCase()
      const argument = rest.join(' ')
      const usage =
        '用法：/memory list | open <id> | forget <id> | end\n（也可以直接对我说“展开 #12”“删掉 #12”“记一下还没完”。）'

      if (sub === '' || sub === 'help') return { kind: 'success', text: usage }

      const cwd = this.agentCwd(agent)
      if (cwd === undefined) return { kind: 'error', text: '记忆操作失败：无法确定当前会话的项目目录。' }
      const store = this.storeFor(cwd)

      if (sub === 'list') {
        const total = store.totalCards()
        const cards = sortRecent(store.listCards()).slice(0, this.config.listLimit)
        let text = renderCardList(cards)
        if (total > cards.length) text += `\n（仅显示最近 ${cards.length} 条；共 ${total} 条。用 /memory open <id> 看摘要。）`
        return { kind: 'success', text }
      }

      if (sub === 'open') {
        const id = toCardId(argument)
        if (id === undefined) return { kind: 'error', text: '用法：/memory open <id>（id 为整数，如 /memory open 12）' }
        const card = store.findCard(id)
        if (card === undefined) return { kind: 'error', text: `未找到卡片 #${id}，当前共 ${store.totalCards()} 条任务。` }
        const available = await probeRawAvailable(this.reader(), card.rawRef.sessionId)
        return { kind: 'success', text: renderCardOpen(card, available) }
      }

      if (sub === 'forget') {
        const id = toCardId(argument)
        if (id === undefined) return { kind: 'error', text: '用法：/memory forget <id>（id 为整数，如 /memory forget 12）' }
        const removed = store.deleteCard(id)
        if (removed === undefined) return { kind: 'error', text: `未找到卡片 #${id}，当前共 ${store.totalCards()} 条任务。` }
        this.pendingEnd.delete(this.sessionIdOf(agent) ?? '')
        return { kind: 'success', text: `已删除 #${removed.id}「${removed.title}」，剩余 ${store.totalCards()} 条。` }
      }

      if (sub === 'end') {
        const sessionId = this.sessionIdOf(agent)
        if (sessionId === undefined) return { kind: 'error', text: '记忆操作失败：无法确定当前会话 id。' }
        this.pendingEnd.set(sessionId, Date.now())
        return { kind: 'success', text: '已请求结束当前任务；模型会在下一次回复前完成封存。' }
      }

      return { kind: 'error', text: `未知子命令“${sub}”。${usage}` }
    } catch (error) {
      return { kind: 'error', text: `记忆操作失败：${errorText(error)}` }
    }
  }

  /** 供测试/诊断：当前是否有待封存标记。 */
  hasPendingEnd(sessionId: string): boolean {
    return this.pendingEnd.has(sessionId)
  }

  /** 供测试/诊断：清理缓存与状态（插件 dispose 时调用）。 */
  dispose(): void {
    this.stores.clear()
    this.pendingEnd.clear()
  }
}

/** 解析卡片 id：接受整数或数字字符串；非法返回 undefined。 */
export function toCardId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim())
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
  }
  return undefined
}
