/**
 * 项目记忆存储层：`<cwd>/memory/` 下的文件读写、缓存、原子写、备份、损坏恢复。
 *
 * 只允许写 `<cwd>/<memoryDirName>/` 下的文件（技术设计 §5、§12、§13）：
 * - persona.md / persona.md.bak：固定记忆文档及其备份（用户可手改）
 * - cards.json / cards.json.bak：卡片库（插件原子读写）
 * - .gitignore：首次创建 `*` + `!.gitignore`，默认自忽略
 *
 * 所有操作为同步小文件 IO：注入层要求同步、毫秒级；单 Host 进程内 JS 事件循环
 * 天然串行，因此无需额外互斥锁（技术设计 §12）。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Card, CardInput, CardPatch, CardsFile, MemoryConfig, MemoryPaths, RawRef } from './types.js'
import { MemoryError } from './types.js'
import type { LoggerLike } from './platform.js'
import { countChars, nowIso } from './util.js'

/** cards.json 容量上限：8MB（技术设计 §5.3），超出拒绝新增并提示清理。 */
export const MAX_CARDS_BYTES = 8 * 1024 * 1024

/** 写入卡片时由调用方提供的会话环境（用于 rawRef）。 */
export interface StoreEnv {
  readonly sessionId: string
  readonly sessionCwd: string
  readonly toSeq: number
}

interface PersonaSnapshot {
  text: string | null
  length: number
  missing: boolean
  tooLong: boolean
}

interface CardsCacheEntry {
  key: string
  file: CardsFile
}

/** 排序：open 在前（sealedAt 升序），done 按 sealedAt 倒序（需求 §6.3）。 */
export function sortForIndex(cards: readonly Card[]): Card[] {
  const open = cards.filter((card) => card.status === 'open').sort((a, b) => a.sealedAt.localeCompare(b.sealedAt) || a.id - b.id)
  const done = cards.filter((card) => card.status !== 'open').sort((a, b) => b.sealedAt.localeCompare(a.sealedAt) || b.id - a.id)
  return [...open, ...done]
}

/** 排序：最近列表（open 在前，其余按 sealedAt 倒序；与常驻索引一致，便于用户理解）。 */
export function sortRecent(cards: readonly Card[]): Card[] {
  return sortForIndex(cards)
}

function emptyCardsFile(): CardsFile {
  return { schemaVersion: 1, nextId: 1, cards: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCardStatus(value: unknown): value is 'open' | 'done' {
  return value === 'open' || value === 'done'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isRawRef(value: unknown): value is RawRef {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.fromSeq === 'number' &&
    typeof value.toSeq === 'number'
  )
}

function isCard(value: unknown): value is Card {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    typeof value.title === 'string' &&
    isStringArray(value.tags) &&
    typeof value.conclusion === 'string' &&
    typeof value.digest === 'string' &&
    isCardStatus(value.status) &&
    typeof value.createdAt === 'string' &&
    typeof value.sealedAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.sessionCwd === 'string' &&
    isRawRef(value.rawRef)
  )
}

/** 校验并深拷贝 cards.json 结构；非法返回 undefined。 */
function parseCardsFile(text: string): CardsFile | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(raw)) return undefined
  if (raw.schemaVersion !== 1) return undefined
  if (typeof raw.nextId !== 'number' || !Number.isInteger(raw.nextId) || raw.nextId < 1) return undefined
  if (!Array.isArray(raw.cards) || !raw.cards.every(isCard)) return undefined
  const cards = raw.cards.map((card) => ({
    id: card.id,
    title: card.title,
    tags: [...card.tags],
    conclusion: card.conclusion,
    digest: card.digest,
    status: card.status,
    createdAt: card.createdAt,
    sealedAt: card.sealedAt,
    updatedAt: card.updatedAt,
    sessionId: card.sessionId,
    sessionCwd: card.sessionCwd,
    rawRef: { ...card.rawRef },
  }))
  // nextId 必须大于所有已存在 id，否则单调递增不变量被破坏。
  const maxId = cards.reduce((max, card) => Math.max(max, card.id), 0)
  return { schemaVersion: 1, nextId: Math.max(raw.nextId, maxId + 1), cards }
}

/** memory/ 文件存储。 */
export class ProjectStore {
  readonly cwd: string
  readonly config: MemoryConfig
  readonly paths: MemoryPaths
  private readonly logger?: LoggerLike
  private personaCache: { key: string; text: string | null } | null = null
  private cardsCache: CardsCacheEntry | null = null
  private diskCorrupt = false

  constructor(cwd: string, config: MemoryConfig, logger?: LoggerLike) {
    this.cwd = resolve(cwd)
    this.config = config
    this.logger = logger
    const dir = resolve(this.cwd, config.memoryDirName)
    this.paths = {
      dir,
      persona: join(dir, 'persona.md'),
      personaBackup: join(dir, 'persona.md.bak'),
      cards: join(dir, 'cards.json'),
      cardsBackup: join(dir, 'cards.json.bak'),
      gitignore: join(dir, '.gitignore'),
      lock: join(dir, '.lock'),
    }
  }

  /** 路径白名单校验：所有写路径必须位于 memoryDir 内（防止配置/拼接逃逸）。 */
  assertWritable(target: string): void {
    const resolved = resolve(target)
    const base = resolve(this.paths.dir) + sep
    if (resolved !== resolve(this.paths.dir) && !resolved.startsWith(base)) {
      throw new MemoryError('bad-path', `拒绝写入记忆目录之外的路径：${resolved}`)
    }
  }

  /** 惰性创建 memory/ 与 .gitignore（仅首次创建 .gitignore）。 */
  ensureDir(): void {
    if (!existsSync(this.paths.dir)) {
      mkdirSync(this.paths.dir, { recursive: true })
    }
    this.assertWritable(this.paths.gitignore)
    if (!existsSync(this.paths.gitignore)) {
      try {
        writeFileSync(this.paths.gitignore, '*\n!.gitignore\n', 'utf8')
      } catch (error) {
        this.logger?.warn?.(`[dsh-dynamic-context] 创建 memory/.gitignore 失败：${String(error)}`)
      }
    }
  }

  private statKey(target: string): string {
    try {
      const info = statSync(target)
      return `${info.mtimeMs}:${info.size}`
    } catch {
      return 'missing'
    }
  }

  // ---------------------------------------------------------------- persona

  /** 读取固定记忆文档（带 mtime/size 缓存）；不存在或不可读返回 null。 */
  readPersonaCached(): string | null {
    const key = this.statKey(this.paths.persona)
    if (this.personaCache !== null && this.personaCache.key === key) return this.personaCache.text
    let text: string | null = null
    if (key !== 'missing') {
      try {
        text = readFileSync(this.paths.persona, 'utf8')
      } catch (error) {
        this.logger?.warn?.(`[dsh-dynamic-context] 读取 memory/persona.md 失败：${String(error)}`)
        text = null
      }
    }
    this.personaCache = { key, text }
    return text
  }

  /** 读取固定记忆文档并给出注入所需元信息（超限判断见需求 §6.1）。 */
  readPersona(): PersonaSnapshot {
    const text = this.readPersonaCached()
    if (text === null) return { text: null, length: 0, missing: true, tooLong: false }
    const length = countChars(text)
    return { text, length, missing: text.trim() === '', tooLong: length > this.config.maxPersonaChars }
  }

  /**
   * 整体替换固定记忆文档：先备份当前文件为 persona.md.bak，再原子写。
   * 长度/自包含校验由控制器（persona.ts）在调用前完成。
   */
  writePersona(content: string): { length: number; lengthChanged: boolean; backedUp: boolean } {
    this.ensureDir()
    const previous = this.readPersonaCached()
    const lengthChanged = previous === null ? content.length > 0 : countChars(previous) !== countChars(content)
    let backedUp = false
    if (existsSync(this.paths.persona)) {
      this.assertWritable(this.paths.personaBackup)
      try {
        copyFileSync(this.paths.persona, this.paths.personaBackup)
        backedUp = true
      } catch (error) {
        throw new MemoryError('backup-failed', `备份 memory/persona.md 失败：${String(error)}`)
      }
    }
    this.atomicWrite(this.paths.persona, content)
    this.personaCache = null
    return { length: countChars(content), lengthChanged, backedUp }
  }

  // ------------------------------------------------------------------ cards

  private readCardsText(path: string): CardsFile | undefined {
    if (!existsSync(path)) return emptyCardsFile()
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
    return parseCardsFile(text)
  }

  /** 读取卡片库（带缓存）；损坏时回退 .bak，再失败则隔离坏文件并以空库继续（F8）。 */
  readCards(): CardsFile {
    const key = this.statKey(this.paths.cards)
    if (this.cardsCache !== null && this.cardsCache.key === key) return this.cardsCache.file
    let file = this.readCardsText(this.paths.cards)
    if (file === undefined) {
      this.diskCorrupt = true
      const backup = this.readCardsText(this.paths.cardsBackup)
      if (backup !== undefined) {
        this.logger?.warn?.('[dsh-dynamic-context] memory/cards.json 解析失败，已回退到 memory/cards.json.bak')
        file = backup
      } else {
        this.logger?.warn?.('[dsh-dynamic-context] memory/cards.json 与备份均不可读，已以空记忆库继续（坏文件将被隔离）')
        this.quarantineCorruptCards()
        file = emptyCardsFile()
      }
    }
    this.cardsCache = { key, file }
    return file
  }

  private quarantineCorruptCards(): void {
    this.assertWritable(this.paths.cards)
    if (!existsSync(this.paths.cards)) return
    try {
      renameSync(this.paths.cards, `${this.paths.cards}.corrupt-${Date.now()}`)
    } catch (error) {
      this.logger?.warn?.(`[dsh-dynamic-context] 隔离损坏的 memory/cards.json 失败：${String(error)}`)
    }
  }

  /** 原子写入卡片库：容量校验 → 备份上一版 → 临时文件 + rename。 */
  writeCards(file: CardsFile): void {
    this.ensureDir()
    this.assertWritable(this.paths.cards)
    const text = `${JSON.stringify(file, null, 2)}\n`
    if (Buffer.byteLength(text, 'utf8') > MAX_CARDS_BYTES) {
      throw new MemoryError(
        'too-large',
        '记忆库已超过 8MB 上限，未写入新卡片；请先用 /memory forget <id> 清理旧卡片。',
      )
    }
    if (!this.diskCorrupt && existsSync(this.paths.cards)) {
      try {
        copyFileSync(this.paths.cards, this.paths.cardsBackup)
      } catch (error) {
        this.logger?.warn?.(`[dsh-dynamic-context] 备份 memory/cards.json 失败（继续写入）：${String(error)}`)
      }
    }
    this.atomicWrite(this.paths.cards, text)
    this.diskCorrupt = false
    this.cardsCache = null
  }

  private atomicWrite(target: string, content: string): void {
    const temp = `${target}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
    try {
      writeFileSync(temp, content, { encoding: 'utf8', flag: 'w' })
      renameSync(temp, target)
    } catch (error) {
      try {
        rmSync(temp, { force: true })
      } catch {
        /* 清理失败不影响主错误 */
      }
      throw new MemoryError('write-failed', `记忆写入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 全部卡片（缓存副本，调用方只读）。 */
  listCards(): readonly Card[] {
    return this.readCards().cards
  }

  findCard(id: number): Card | undefined {
    return this.readCards().cards.find((card) => card.id === id)
  }

  totalCards(): number {
    return this.readCards().cards.length
  }

  /** 同会话上一张卡片的 rawRef.toSeq（没有则 0）；仅看同 sessionId 的卡片。 */
  private lastToSeqInSession(cards: readonly Card[], sessionId: string): number {
    let max = 0
    for (const card of cards) {
      if (card.rawRef.sessionId === sessionId && card.rawRef.toSeq > max) max = card.rawRef.toSeq
    }
    return max
  }

  /** 新增一张卡片（id 项目内单调递增、删除后不复用）。 */
  addCard(input: CardInput, env: StoreEnv): Card {
    this.ensureDir()
    const file = this.readCards()
    const timestamp = nowIso()
    const id = file.nextId
    const card: Card = {
      id,
      title: input.title,
      tags: [...input.tags],
      conclusion: input.conclusion,
      digest: input.digest,
      status: input.status,
      createdAt: timestamp,
      sealedAt: timestamp,
      updatedAt: timestamp,
      sessionId: env.sessionId,
      sessionCwd: env.sessionCwd,
      rawRef: {
        sessionId: env.sessionId,
        fromSeq: this.lastToSeqInSession(file.cards, env.sessionId),
        toSeq: env.toSeq,
      },
    }
    const next: CardsFile = {
      schemaVersion: 1,
      nextId: id + 1,
      cards: [...file.cards, card],
    }
    this.writeCards(next)
    return card
  }

  /** 更新已有卡片（含 open→done）；保留原 rawRef.fromSeq，同会话内延伸 toSeq。 */
  updateCard(id: number, patch: CardPatch, env: StoreEnv): Card | undefined {
    const file = this.readCards()
    const index = file.cards.findIndex((card) => card.id === id)
    if (index < 0) return undefined
    const previous = file.cards[index]!
    const timestamp = nowIso()
    const nextRawRef: RawRef =
      previous.rawRef.sessionId === env.sessionId && env.toSeq > previous.rawRef.toSeq
        ? { sessionId: previous.rawRef.sessionId, fromSeq: previous.rawRef.fromSeq, toSeq: env.toSeq }
        : { ...previous.rawRef }
    const updated: Card = {
      ...previous,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.tags !== undefined ? { tags: [...patch.tags] } : {}),
      ...(patch.conclusion !== undefined ? { conclusion: patch.conclusion } : {}),
      ...(patch.digest !== undefined ? { digest: patch.digest } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: timestamp,
      ...(patch.status === 'done' && previous.status === 'open' ? { sealedAt: timestamp } : {}),
      rawRef: nextRawRef,
    }
    const cards = [...file.cards]
    cards[index] = updated
    this.writeCards({ schemaVersion: 1, nextId: file.nextId, cards })
    return updated
  }

  /** 彻底删除一张卡片（含摘要与原话引用）；返回被删卡片，未找到返回 undefined。 */
  deleteCard(id: number): Card | undefined {
    const file = this.readCards()
    const index = file.cards.findIndex((card) => card.id === id)
    if (index < 0) return undefined
    const removed = file.cards[index]!
    const cards = file.cards.filter((_card, position) => position !== index)
    this.writeCards({ schemaVersion: 1, nextId: file.nextId, cards })
    return removed
  }
}
