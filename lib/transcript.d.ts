/**
 * dsh-dynamic-context 原话（会话记录）读取、渲染与分片。
 *
 * 设计依据：tech-design-dsh-memory.md §10（原话读取与分片）、
 * requirements-dsh-memory-v0.2.md §6.6/§9.3；模块契约见 `.notes/CONTRACTS.md` 第 3 节。
 *
 * 约束（契约硬性要求）：
 * - 运行时不 import 任何 `@deepseek-ai/*` 包，也不读 DSH 私有会话文件；
 *   只通过注入的 {@link SessionReader}（控制器用 `ctx.sessionQuery.readSession` 适配）读取会话。
 * - 纯函数 + 注入 reader，无全局状态；异步仅 readSession。
 * - 原话只取该任务最新片段（由 sliceLatest 实现“默认不主动回溯”），单次文本上限由调用方
 *   的 chunkChars（默认 2000）控制。
 */
/** 会话日志中的单条事件（只声明本模块用到的字段；其余字段忽略）。 */
export interface RawEvent {
    readonly seq: number;
    readonly type: string;
    readonly time?: number;
    readonly data?: unknown;
}
/**
 * `readSession` 返回的会话快照（兼容 header/session 两种头部字段命名）。
 *
 * 字段声明为只读：DSH 的 `ctx.sessionQuery.readSession` 返回结构化克隆的只读快照，
 * 控制器 `platform.ts` 的 `RawSessionLike` 也声明为 readonly；本模块只读不写。
 */
export interface RawSession {
    readonly header?: {
        readonly id?: string;
        readonly cwd?: string;
    };
    readonly session?: {
        readonly id?: string;
        readonly cwd?: string;
    };
    readonly events: readonly RawEvent[];
}
/** 注入的会话读取器：DSH 的 `ctx.sessionQuery.readSession` 形状。 */
export interface SessionReader {
    readSession(id: string): Promise<RawSession | undefined | null>;
}
/** 最新原话切片。cursor/长度均按 UTF-16 单元计（JS String#slice 语义）。 */
export interface RawSlice {
    text: string;
    nextCursor: number;
    hasMore: boolean;
    totalChars: number;
}
/** 读取原话的结果；ok=false 时给出可读降级文案（不抛错）。 */
export interface RawResult {
    ok: boolean;
    reason?: 'unavailable' | 'empty' | 'bad-ref';
    message?: string;
    slice?: RawSlice;
    eventCount?: number;
    renderedChars?: number;
    usedFallbackRange?: boolean;
}
/**
 * 渲染事件序列中 `fromSeq < seq <= toSeq` 的原话。
 *
 * 区间语义：fromSeq 为同会话上一张卡片的 toSeq，故用开区间（不含等号）。
 * 返回空串表示区间内没有可渲染内容；`fromSeq >= toSeq` 的异常区间回退由
 * {@link readRawTranscript} 负责（本函数严格按区间过滤，便于单测与复用）。
 */
export declare function renderTranscript(events: readonly RawEvent[], fromSeq: number, toSeq: number): string;
/**
 * 只取最新一段原话（默认不主动回溯）。
 *
 * 公式（契约 §3）：
 *   end = max(0, full.length - cursor)
 *   start = max(0, end - chunkChars)
 *   text = full.slice(start, end)
 *   nextCursor = cursor + (end - start)
 *   hasMore = start > 0
 *   totalChars = full.length
 *
 * 额外安全回退（契约允许）：当 start/end 恰好落在 surrogate pair 中间时，
 * 向外扩/缩 1 个 UTF-16 单元，保证返回文本不含落单代理（emoji 不切半）。
 * 正常游标链（cursor 由上次 nextCursor 递推）不会触发该回退。
 */
export declare function sliceLatest(full: string, cursor: number, chunkChars: number): RawSlice;
/**
 * 读取一张卡片的原话片段。
 *
 * - `fromSeq < event.seq <= toSeq` 的事件按时间顺序渲染；
 * - `fromSeq >= toSeq`（异常区间）回退为最近 200 条事件，并置 usedFallbackRange=true；
 * - 渲染为空 → reason='empty'；会话不可读/抛错 → reason='unavailable'；
 *   会话 id 或区间缺失/非法 → reason='bad-ref'；
 * - 结果只返回最新 chunkChars 字（sliceLatest），首次 cursor=0 即从末尾开始。
 */
export declare function readRawTranscript(reader: SessionReader, opts: {
    sessionId: string;
    fromSeq: number;
    toSeq: number;
    cursor: number;
    chunkChars: number;
}): Promise<RawResult>;
/**
 * 探测某会话的原话是否可读（memory_open 展示“原话是否可读”用）。
 *
 * readSession 成功且 events.length > 0 → true；任何异常/空 → false（不抛错）。
 */
export declare function probeRawAvailable(reader: SessionReader, sessionId: string): Promise<boolean>;
