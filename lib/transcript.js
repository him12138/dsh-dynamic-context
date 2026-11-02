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
/** 说话人标识（契约固定文案）。 */
const SPEAKER_USER = '用户：';
const SPEAKER_ASSISTANT = '助手：';
/** 未知/缺失工具名时的占位。 */
const UNKNOWN_TOOL_NAME = '未知工具';
/** 工具结果只有图片/二进制块时的占位。 */
const MEDIA_MARKER = '[图片/附件]';
/** 单条工具调用参数截断长度（码点）。 */
const TOOL_ARGS_MAX_CHARS = 200;
/** 单条工具结果文本截断长度（码点）。 */
const TOOL_RESULT_MAX_CHARS = 400;
/** 未知 data 形状的 JSON 兜底截断长度。 */
const UNKNOWN_DATA_MAX_CHARS = 300;
/** fromSeq>=toSeq 异常区间回退的事件条数。 */
const FALLBACK_EVENT_LIMIT = 200;
/** 降级文案（契约固定，控制器/测试直接比对；不要改写）。 */
const EMPTY_MESSAGE = '原话区间内没有可读内容（任务区间近似或会话记录已被精简）；摘要仍可用。';
const UNAVAILABLE_MESSAGE = '原话不可用（会话记录已删除或不可读）；摘要仍可用。';
const BAD_REF_MESSAGE = '原话引用无效（缺少会话 id 或事件区间）；摘要仍可用。';
/**
 * 支持的事件类型 → 渲染器。其它类型（turn/start、request/header 等）直接跳过。
 * 事件 data 形状（以 DSH SessionEventMap 为准，本模块防御式取值）：
 * - user/message: UserMessage 本体 { id, role:'user', content: ContentBlock[] }
 * - assistant/message: { message: AssistantMessage, ... }
 * - tool/call: { name: string, arguments: string（JSON 字符串） }
 * - tool/result: { message: ToolResultMessage, ... }
 */
const EVENT_RENDERERS = {
    'user/message': (data) => renderMessage(SPEAKER_USER, data),
    'assistant/message': (data) => renderMessage(SPEAKER_ASSISTANT, data),
    'tool/call': (data) => renderToolCall(data),
    'tool/result': (data) => renderToolResult(data),
};
// ---------------------------------------------------------------------------
// 基础防御式取值
// ---------------------------------------------------------------------------
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** 取出有限数值 seq；坏值返回 NaN（后续过滤掉）。 */
function seqOf(event) {
    if (!isRecord(event))
        return Number.NaN;
    const seq = event.seq;
    return typeof seq === 'number' && Number.isFinite(seq) ? seq : Number.NaN;
}
/** 是否为原话保留的事件类型。 */
function isSupportedType(type) {
    return typeof type === 'string' && Object.hasOwn(EVENT_RENDERERS, type);
}
/** JSON 序列化兜底：不可序列化（循环引用、BigInt 等）时返回空串。 */
function stringifyUnknown(value) {
    if (value === undefined)
        return '';
    try {
        const json = JSON.stringify(value);
        return typeof json === 'string' ? json : '';
    }
    catch {
        return '';
    }
}
/**
 * 按码点截断，绝不切断 surrogate pair（emoji 等）。
 * 长度按“字”（Unicode 码点）计，符合契约“截断 200/400/300 字”的口径。
 */
function truncateChars(text, maxChars) {
    if (maxChars <= 0 || text === '')
        return '';
    let units = 0;
    let index = 0;
    while (index < text.length && units < maxChars) {
        const codePoint = text.codePointAt(index);
        index += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
        units += 1;
    }
    return index >= text.length ? text : text.slice(0, index);
}
/** 未知 data 形状：JSON.stringify 后截断 300 字（契约兜底）。 */
function renderUnknownData(data) {
    return truncateChars(stringifyUnknown(data), UNKNOWN_DATA_MAX_CHARS);
}
/** 非负整数化（cursor/chunkChars 防御式清洗；非法值按 0 处理）。 */
function toNonNegativeInt(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
        return 0;
    return Math.trunc(value);
}
/** 扫描 ContentBlock[]，收集 text 块、标记图片/附件块。 */
function inspectBlocks(blocks) {
    const texts = [];
    let hasMedia = false;
    for (const block of blocks) {
        if (!isRecord(block))
            continue;
        if (block.type === 'text') {
            if (typeof block.text === 'string' && block.text !== '')
                texts.push(block.text);
        }
        else if (block.type === 'image' || block.type === 'file') {
            hasMedia = true;
        }
    }
    return { text: texts.join('\n'), hasMedia };
}
/**
 * 兼容两种事件形状取消息内容：
 * - user/message 的 data 是 UserMessage 本体 → data.content；
 * - assistant/message、tool/result 的 data 是 `{ message: XxxMessage }` 包装 → data.message.content。
 * 找不到可识别的 content 时返回 undefined（调用方走 JSON 兜底）。
 */
function messageContent(data) {
    if (!isRecord(data))
        return undefined;
    const wrapped = data.message;
    const candidates = [isRecord(wrapped) ? wrapped : undefined, data];
    for (const candidate of candidates) {
        if (!isRecord(candidate))
            continue;
        const content = candidate.content;
        if (Array.isArray(content))
            return inspectBlocks(content);
        if (typeof content === 'string')
            return { text: content, hasMedia: false };
    }
    return undefined;
}
// ---------------------------------------------------------------------------
// 单事件渲染
// ---------------------------------------------------------------------------
/** 用户/助手消息：`用户：<text>` / `助手：<text>`；形状不认识时回退 JSON。 */
function renderMessage(speaker, data) {
    const content = messageContent(data);
    if (content !== undefined)
        return speaker + content.text;
    // 未知形状：JSON 兜底；连 JSON 都无法序列化（循环引用等）时返回空串，
    // 由 renderEvents 当作“单条渲染失败”跳过。
    const fallback = renderUnknownData(data);
    return fallback === '' ? '' : speaker + fallback;
}
/** 工具调用：`[工具调用 <name>] <arguments 截断 200 字>`。 */
function renderToolCall(data) {
    if (!isRecord(data)) {
        const fallback = renderUnknownData(data);
        const prefix = `[工具调用 ${UNKNOWN_TOOL_NAME}]`;
        return fallback === '' ? prefix : `${prefix} ${fallback}`;
    }
    const name = typeof data.name === 'string' && data.name !== '' ? data.name : UNKNOWN_TOOL_NAME;
    const argumentsText = typeof data.arguments === 'string'
        ? data.arguments
        : stringifyUnknown(data.arguments);
    const renderedArguments = truncateChars(argumentsText, TOOL_ARGS_MAX_CHARS);
    const prefix = `[工具调用 ${name}]`;
    return renderedArguments === '' ? prefix : `${prefix} ${renderedArguments}`;
}
/** 工具结果：`[工具结果] <text 截断 400 字>`；无 text 且含图片/附件块 → `[图片/附件]`。 */
function renderToolResult(data) {
    const prefix = '[工具结果]';
    const content = messageContent(data);
    if (content === undefined) {
        const fallback = renderUnknownData(data);
        return fallback === '' ? prefix : `${prefix} ${fallback}`;
    }
    const renderedText = truncateChars(content.text, TOOL_RESULT_MAX_CHARS);
    if (renderedText !== '')
        return `${prefix} ${renderedText}`;
    if (content.hasMedia)
        return `${prefix} ${MEDIA_MARKER}`;
    return prefix;
}
/**
 * 渲染事件数组：过滤支持的类型、按 seq 升序、逐条渲染。
 * 单条渲染失败（形状异常/访问器抛错）跳过，不中断整段原话。
 */
function renderEvents(events) {
    const lines = [];
    for (const event of events) {
        if (!isRecord(event))
            continue;
        if (!isSupportedType(event.type))
            continue;
        const renderer = EVENT_RENDERERS[event.type];
        if (renderer === undefined)
            continue;
        try {
            const line = renderer(event.data);
            if (typeof line === 'string' && line !== '')
                lines.push(line);
        }
        catch {
            // 契约：单条渲染失败跳过，不中断。
        }
    }
    return { text: lines.join('\n'), count: lines.length };
}
/** 过滤出 seq 有限的事件并按 seq 升序排序（时间顺序 = 会话日志顺序）。 */
function normalizeEvents(events) {
    if (!Array.isArray(events))
        return [];
    const normalized = [];
    for (const event of events) {
        if (!Number.isFinite(seqOf(event)))
            continue;
        normalized.push(event);
    }
    normalized.sort((a, b) => seqOf(a) - seqOf(b));
    return normalized;
}
// ---------------------------------------------------------------------------
// 公开 API（契约第 3 节）
// ---------------------------------------------------------------------------
/**
 * 渲染事件序列中 `fromSeq < seq <= toSeq` 的原话。
 *
 * 区间语义：fromSeq 为同会话上一张卡片的 toSeq，故用开区间（不含等号）。
 * 返回空串表示区间内没有可渲染内容；`fromSeq >= toSeq` 的异常区间回退由
 * {@link readRawTranscript} 负责（本函数严格按区间过滤，便于单测与复用）。
 */
export function renderTranscript(events, fromSeq, toSeq) {
    if (!Array.isArray(events))
        return '';
    const selected = [];
    for (const event of events) {
        const seq = seqOf(event);
        if (!Number.isFinite(seq))
            continue;
        if (seq > fromSeq && seq <= toSeq)
            selected.push(event);
    }
    selected.sort((a, b) => seqOf(a) - seqOf(b));
    return renderEvents(selected).text;
}
/** 是否为 UTF-16 高代理（surrogate pair 的前半个码元）。 */
function isHighSurrogate(codeUnit) {
    return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}
function isLowSurrogate(codeUnit) {
    return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}
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
export function sliceLatest(full, cursor, chunkChars) {
    const source = typeof full === 'string' ? full : '';
    const totalChars = source.length;
    const safeCursor = toNonNegativeInt(cursor);
    const safeChunkChars = toNonNegativeInt(chunkChars);
    let end = Math.max(0, totalChars - safeCursor);
    let start = Math.max(0, end - safeChunkChars);
    // end 落在“高代理 | 低代理”之间：向前退 1，丢掉半个 emoji。
    if (end > 0 &&
        end < totalChars &&
        isLowSurrogate(source.charCodeAt(end)) &&
        isHighSurrogate(source.charCodeAt(end - 1))) {
        end -= 1;
    }
    // start 落在“高代理 | 低代理”之间：向后进 1，从完整码点开始。
    if (start > 0 &&
        start < totalChars &&
        isLowSurrogate(source.charCodeAt(start)) &&
        isHighSurrogate(source.charCodeAt(start - 1))) {
        start += 1;
    }
    if (start > end)
        start = end;
    return {
        text: source.slice(start, end),
        nextCursor: safeCursor + (end - start),
        hasMore: start > 0,
        totalChars,
    };
}
/** 降级结果构造（ok=false）。 */
function failed(reason, message) {
    return { ok: false, reason, message };
}
/**
 * 读取一张卡片的原话片段。
 *
 * - `fromSeq < event.seq <= toSeq` 的事件按时间顺序渲染；
 * - `fromSeq >= toSeq`（异常区间）回退为最近 200 条事件，并置 usedFallbackRange=true；
 * - 渲染为空 → reason='empty'；会话不可读/抛错 → reason='unavailable'；
 *   会话 id 或区间缺失/非法 → reason='bad-ref'；
 * - 结果只返回最新 chunkChars 字（sliceLatest），首次 cursor=0 即从末尾开始。
 */
export async function readRawTranscript(reader, opts) {
    const sessionId = opts?.sessionId;
    if (typeof sessionId !== 'string' || sessionId.trim() === '') {
        return failed('bad-ref', BAD_REF_MESSAGE);
    }
    const fromSeq = opts?.fromSeq;
    const toSeq = opts?.toSeq;
    if (typeof fromSeq !== 'number' ||
        !Number.isFinite(fromSeq) ||
        typeof toSeq !== 'number' ||
        !Number.isFinite(toSeq)) {
        return failed('bad-ref', BAD_REF_MESSAGE);
    }
    let session;
    try {
        session = await reader.readSession(sessionId);
    }
    catch {
        return failed('unavailable', UNAVAILABLE_MESSAGE);
    }
    if (session === null || session === undefined || !Array.isArray(session.events)) {
        return failed('unavailable', UNAVAILABLE_MESSAGE);
    }
    const events = normalizeEvents(session.events);
    const usedFallbackRange = fromSeq >= toSeq;
    let selected;
    if (usedFallbackRange) {
        // 契约 §3：异常区间回退为“最近 200 条事件”（按 seq 取最后 200 条，再过滤支持类型）。
        selected = events
            .slice(-FALLBACK_EVENT_LIMIT)
            .filter((event) => isSupportedType(event.type));
    }
    else {
        selected = events.filter((event) => event.seq > fromSeq && event.seq <= toSeq);
    }
    const rendered = renderEvents(selected);
    if (rendered.text === '') {
        return failed('empty', EMPTY_MESSAGE);
    }
    const cursor = toNonNegativeInt(opts.cursor);
    const chunkChars = toNonNegativeInt(opts.chunkChars);
    return {
        ok: true,
        slice: sliceLatest(rendered.text, cursor, chunkChars),
        eventCount: rendered.count,
        renderedChars: rendered.text.length,
        usedFallbackRange,
    };
}
/**
 * 探测某会话的原话是否可读（memory_open 展示“原话是否可读”用）。
 *
 * readSession 成功且 events.length > 0 → true；任何异常/空 → false（不抛错）。
 */
export async function probeRawAvailable(reader, sessionId) {
    if (typeof sessionId !== 'string' || sessionId.trim() === '')
        return false;
    try {
        const session = await reader.readSession(sessionId);
        return (session !== null &&
            session !== undefined &&
            Array.isArray(session.events) &&
            session.events.length > 0);
    }
    catch {
        return false;
    }
}
