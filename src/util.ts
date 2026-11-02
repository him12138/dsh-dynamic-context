/**
 * 小型工具函数（零依赖）。
 */

/** 按 Unicode 码点计"字"（与需求"字"一致，emoji/代理对算 1 个字）。 */
export function countChars(value: string): number {
  return [...value].length
}

/** 按码点截断到最多 maxChars 个字。 */
export function truncateChars(value: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  const chars = [...value]
  return chars.length <= maxChars ? value : chars.slice(0, maxChars).join('')
}

/**
 * 在自然边界处截断（不超 maxChars）：优先句末标点，其次逗号，最后硬切。
 *
 * 用于摘要/结论这类成句字段——硬切会把句子切断在半截（历史卡片已出现
 * “四命令全部实现并真机执”这类断头结论）。找不到边界时退回 truncateChars 的行为。
 */
export function truncateAtBoundary(value: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  const chars = [...value]
  if (chars.length <= maxChars) return value
  const slice = chars.slice(0, maxChars)
  // 边界不能太靠前，否则会截掉大半个字段；至少保留一半内容。
  const floor = Math.floor(maxChars / 2)
  const groups: ReadonlyArray<ReadonlyArray<string>> = [
    ['。', '！', '？', '；', '…', '!', '?', ';'],
    ['，', '、', ','],
  ]
  for (const group of groups) {
    let best = -1
    let width = 1
    for (const mark of group) {
      const idx = slice.lastIndexOf(mark)
      if (idx > best) {
        best = idx
        width = [...mark].length
      }
    }
    if (best >= floor) return slice.slice(0, best + width).join('')
  }
  return slice.join('')
}

/** 按码点安全切片（start/end 以码点计）。 */
export function sliceChars(value: string, start: number, end: number): string {
  return [...value].slice(Math.max(0, start), Math.max(0, end)).join('')
}

/** 本地时区 ISO 时间（带 +08:00 形式偏移），与需求示例一致。 */
export function nowIso(date: Date = new Date()): string {
  const pad = (n: number, width = 2): string => String(Math.abs(n)).padStart(width, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

/** 取 ISO 时间的日期部分（YYYY-MM-DD）；非法值返回空串。 */
export function isoDatePart(value: string | undefined): string {
  if (typeof value !== 'string') return ''
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value)
  return match ? match[1] : ''
}

/** 归一化空白：去除首尾空白并把内部连续空白折叠为单个空格。 */
export function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** 把任意错误转成可读短文本（插件内异常一律不抛给模型）。 */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** 深冻结（递归），用于构造交给运行时的消息对象。 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}
