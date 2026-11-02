/**
 * dsh-memory 插件入口（技术设计 §3、§19.2）。
 *
 * Host-only 单包插件：
 * - 固定记忆 → systemPrompt.section（order 100，每请求重新渲染，改文件下一轮生效）
 * - 行为规则 → systemPrompt.section（order 460，可配置关闭）
 * - 常驻索引 → systemPrompt.context（order 300，文本变化才追加，压缩后自动重建）
 * - 5 个模型工具 + 1 个 /memory 命令
 *
 * 依赖服务：systemPrompt / tools / commands / sessionQuery（DSH base 默认挂载）。
 * 插件内所有异常都降级为告警或可读文本，不阻断对话（技术设计 §13）。
 */
import { normalizeConfig } from './config.js'
import { Controller } from './controller.js'
import { registerMemoryCommand } from './commands.js'
import { buildMemoryTools } from './tools.js'
import type { PluginContextLike } from './platform.js'
import { errorText } from './util.js'

/** Cordis 插件名（与 package.json 的 name 一致）。 */
export const name = 'dsh-memory'

/** 依赖服务；缺失时插件不会激活（sessionQuery 在 base 默认挂载）。 */
export const inject = ['systemPrompt', 'tools', 'commands', 'sessionQuery']

/** 固定记忆段的 order：位于 deployment persona prefix(0) 之后、plan policy(500) 之前。 */
const PERSONA_SECTION_ORDER = 100
/** 常驻索引的 order：位于 runtime context 的 working-directory(100)/web-surface(210) 之后。 */
const INDEX_CONTEXT_ORDER = 300
/** 行为规则段的 order：位于 plan/team policy(500/600) 之前。 */
const GUIDE_SECTION_ORDER = 460

export function apply(ctx: PluginContextLike, rawConfig?: unknown): void {
  const config = normalizeConfig(rawConfig ?? {})
  const warn = (message: string): void => {
    try {
      ctx.logger?.warn?.(message)
    } catch {
      /* 日志失败不影响加载 */
    }
  }

  const controller = new Controller({
    config,
    readSession: (sessionId) => ctx.sessionQuery.readSession(sessionId),
    logger: ctx.logger,
  })

  const disposers: Array<() => void> = []
  const add = (disposer: unknown): void => {
    if (typeof disposer === 'function') disposers.push(disposer as () => void)
  }

  try {
    add(
      ctx.systemPrompt.section({
        name: 'memory:persona',
        order: PERSONA_SECTION_ORDER,
        interpolate: false,
        text: (context) => controller.personaSection(context?.agent),
      }),
    )
  } catch (error) {
    warn(`[dsh-memory] 注册固定记忆段失败：${errorText(error)}`)
  }

  try {
    add(
      ctx.systemPrompt.context({
        name: 'memory:index',
        order: INDEX_CONTEXT_ORDER,
        interpolate: false,
        text: (context) => controller.indexContext(context?.agent),
      }),
    )
  } catch (error) {
    warn(`[dsh-memory] 注册常驻索引失败：${errorText(error)}`)
  }

  try {
    add(
      ctx.systemPrompt.section({
        name: 'memory:guide',
        order: GUIDE_SECTION_ORDER,
        interpolate: false,
        text: () => controller.guideSection(),
      }),
    )
  } catch (error) {
    warn(`[dsh-memory] 注册行为规则段失败：${errorText(error)}`)
  }

  for (const tool of buildMemoryTools(controller)) {
    try {
      add(ctx.tools.register(tool))
    } catch (error) {
      warn(`[dsh-memory] 注册工具 ${tool.name} 失败：${errorText(error)}`)
    }
  }

  try {
    add(registerMemoryCommand(ctx, controller))
  } catch (error) {
    warn(`[dsh-memory] 注册 /memory 命令失败：${errorText(error)}`)
  }

  const cleanup = (): void => {
    const pending = disposers.splice(0)
    for (const dispose of pending) {
      try {
        dispose()
      } catch {
        /* 卸载时忽略单个 disposer 失败 */
      }
    }
    controller.dispose()
  }
  try {
    const off = ctx.on?.('dispose', cleanup)
    if (typeof off === 'function') disposers.push(off)
  } catch (error) {
    warn(`[dsh-memory] 注册 dispose 清理失败：${errorText(error)}`)
  }
}
