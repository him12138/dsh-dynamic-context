import type { MemoryConfig } from './types.js';
import type { AgentLike, CommandResultLike, LoggerLike, RawSessionLike } from './platform.js';
/** 控制器依赖：会话读取由注入的 DSH `ctx.sessionQuery.readSession` 提供。 */
export interface ControllerOptions {
    readonly config: MemoryConfig;
    readonly readSession: (sessionId: string) => Promise<RawSessionLike>;
    readonly logger?: LoggerLike;
}
/** 构造一条可作为 next-step 附加上下文的 user 消息（结构同 dsh-llm createUserMessage）。 */
export declare function makeUserMessage(text: string): unknown;
export declare class Controller {
    readonly config: MemoryConfig;
    private readonly readSessionImpl;
    private readonly logger?;
    private readonly stores;
    /** 用户执行过 `/memory end`、等待模型封存的会话（sessionId → 时间戳）。 */
    private readonly pendingEnd;
    constructor(options: ControllerOptions);
    private logWarn;
    private storeFor;
    private agentCwd;
    private reader;
    private sessionIdOf;
    /** systemPrompt.section：固定记忆段（每请求重渲染 → 用户改文件下一轮生效）。 */
    personaSection(agent: AgentLike | undefined): string;
    /** systemPrompt.section：行为规则段。 */
    guideSection(): string;
    /** systemPrompt.context：常驻卡片索引（稳定文本，变化才追加）。 */
    indexContext(agent: AgentLike | undefined): string;
    /** `memory_seal`：写入/更新一张任务卡片。 */
    seal(agent: AgentLike | undefined, rawArgs: unknown, defer?: (message: unknown) => void): string;
    /** `memory_search`：只搜卡片字段（标题/标签/结论/摘要），不搜原话。 */
    search(agent: AgentLike | undefined, rawQuery: unknown, rawLimit: unknown): string;
    /** `memory_open`：展开一张卡片的摘要与元信息，并报告原话是否可读。 */
    open(agent: AgentLike | undefined, rawId: unknown): Promise<string>;
    /** `memory_raw`：读取某任务原话片段；默认只给最新约 rawChunkChars 字。 */
    raw(agent: AgentLike | undefined, rawId: unknown, rawCursor: unknown): Promise<string>;
    /** `memory_persona`：凝练更新固定记忆文档（校验、备份、原子写）。 */
    updatePersona(agent: AgentLike | undefined, rawContent: unknown, reason?: unknown): string;
    /** `/memory ...` 命令分发。 */
    command(rawInput: string, agent: AgentLike | undefined): Promise<CommandResultLike>;
    /** 供测试/诊断：当前是否有待封存标记。 */
    hasPendingEnd(sessionId: string): boolean;
    /** 供测试/诊断：清理缓存与状态（插件 dispose 时调用）。 */
    dispose(): void;
}
/** 解析卡片 id：接受整数或数字字符串；非法返回 undefined。 */
export declare function toCardId(value: unknown): number | undefined;
