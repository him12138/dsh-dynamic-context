/**
 * 对 DSH 运行时对象的最小结构化类型声明。
 *
 * 插件刻意不 import 任何 `@deepseek-ai/*` 包（零运行时依赖、可独立加载），
 * 只声明本插件实际用到的平台形状；真实对象由 Cordis 注入，结构兼容。
 * 平台契约来源：`audit-dsh-platform.md` 与运行时包 typert 声明（0.2.1-rc.5）。
 */

/** Session 头（SessionHeader）：cwd 是项目边界（审计 §5.1、§7.2）。 */
export interface SessionHeaderLike {
  readonly id: string
  readonly cwd?: string
  readonly parentSession?: string
  readonly origin?: string
}

/** 会话对象：seq 是下一个事件的序号（事件日志长度）。 */
export interface SessionLike {
  readonly id: string
  readonly header: SessionHeaderLike
  readonly seq: number
}

/** Agent：工具/命令执行时由运行时提供。 */
export interface AgentLike {
  readonly id: string
  readonly session: SessionLike
}

/** systemPrompt.section/context 的渲染上下文（assembleContextFor(agent) = {agent, scope, signal}）。 */
export interface PromptAssembleContextLike {
  readonly agent?: AgentLike
  readonly signal?: AbortSignal
}

/** 模型可见的提示词段/动态上下文。 */
export interface PromptSectionLike {
  readonly name: string
  readonly order: number
  readonly text: string | ((context: PromptAssembleContextLike) => string)
  readonly interpolate?: boolean
  readonly complete?: boolean
}

export interface PromptContextLike {
  readonly name: string
  readonly order: number
  readonly text: string | ((context: PromptAssembleContextLike) => string)
  readonly interpolate?: boolean
  readonly required?: boolean
}

/** 工具 execute 的运行上下文（ToolRunContext）。 */
export interface ToolRunContextLike {
  readonly callId: string
  readonly name: string
  readonly arguments: unknown
  readonly agent?: AgentLike
  readonly signal?: AbortSignal
  deferContext?(message: unknown): void
}

/** 工具输出渲染块。 */
export interface TextContentBlockLike {
  readonly type: 'text'
  readonly text: string
}

/** 工具定义（ToolDefinition 的结构子集）。 */
export interface ToolDefinitionLike {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => TextContentBlockLike[]
  }
  execute: (args: unknown, exec: ToolRunContextLike) => Promise<unknown>
}

/** 命令 invocation（CommandInvocation）。 */
export interface CommandInvocationLike {
  readonly agent: AgentLike
  readonly rawInput: string
  readonly signal?: AbortSignal
}

/** 命令结果（CommandResult）。 */
export type CommandResultLike =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** 命令定义（CommandDefinition 的结构子集）。 */
export interface CommandDefinitionLike {
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint: string }
  handler: (invocation: CommandInvocationLike) => CommandResultLike | Promise<CommandResultLike>
}

/** 会话原始事件（sessionQuery.readSession 的 events 成员）。 */
export interface RawEventLike {
  readonly seq: number
  readonly type: string
  readonly time?: number
  readonly data?: unknown
}

/** sessionQuery.readSession 返回值（SessionLogSnapshot 的结构子集）。 */
export interface RawSessionLike {
  readonly session?: { readonly id?: string; readonly cwd?: string }
  readonly header?: { readonly id?: string; readonly cwd?: string }
  readonly events: readonly RawEventLike[]
}

/** sessionQuery 服务（只用到 readSession）。 */
export interface SessionQueryLike {
  readSession(sessionId: string): Promise<RawSessionLike>
}

/** 插件日志接口（可缺省）。 */
export interface LoggerLike {
  warn?(message: string): void
  info?(message: string): void
}

/** 插件上下文（本插件用到的 Cordis Context 能力子集）。 */
export interface PluginContextLike {
  readonly systemPrompt: {
    section(section: PromptSectionLike): () => void
    context(context: PromptContextLike): () => void
  }
  readonly tools: {
    register(definition: ToolDefinitionLike): () => void
  }
  readonly commands: {
    register(definition: CommandDefinitionLike): () => void
  }
  readonly sessionQuery: SessionQueryLike
  readonly logger?: LoggerLike
  on?(event: string, listener: (...args: unknown[]) => void): () => void
  effect?(execute: () => (() => void) | void): () => void
}
