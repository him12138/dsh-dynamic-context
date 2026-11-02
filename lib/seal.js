import { countChars, tidy, truncateAtBoundary, truncateChars } from './util.js';
export const TITLE_MAX_CHARS = 20;
export const TAG_MAX_CHARS = 16;
export const TAG_MIN = 3;
export const TAG_MAX = 5;
export const CONCLUSION_MAX_CHARS = 40;
export const UNCATEGORIZED_TAG = '未分类';
export function isMemoryStatus(value) {
    return value === 'open' || value === 'done';
}
function asRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}
/** 解析正整数 id（兼容数字与数字字符串）。 */
function toPositiveId(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0)
        return value;
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        const parsed = Number(value.trim());
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
    }
    return undefined;
}
function normalizeTags(raw, hints) {
    if (!Array.isArray(raw))
        return { error: '未记录：tags 必填（3–5 个标签的字符串数组）。' };
    const tags = [];
    let truncated = false;
    for (const item of raw) {
        if (typeof item !== 'string')
            continue;
        const cleaned = tidy(item);
        if (cleaned === '')
            continue;
        if (countChars(cleaned) > TAG_MAX_CHARS)
            truncated = true;
        const tag = truncateChars(cleaned, TAG_MAX_CHARS);
        if (!tags.includes(tag))
            tags.push(tag);
    }
    if (truncated)
        hints.push(`标签超过 ${TAG_MAX_CHARS} 字的内容已截断`);
    if (tags.length === 0)
        return { error: '未记录：tags 必须包含至少一个非空标签。' };
    if (tags.length > TAG_MAX) {
        tags.length = TAG_MAX;
        hints.push(`标签超过 ${TAG_MAX} 个，已保留前 ${TAG_MAX} 个`);
    }
    while (tags.length < TAG_MIN) {
        if (!tags.includes(UNCATEGORIZED_TAG)) {
            tags.push(UNCATEGORIZED_TAG);
            hints.push(`标签不足 ${TAG_MIN} 个，已补“${UNCATEGORIZED_TAG}”`);
        }
        else {
            tags.push(`${UNCATEGORIZED_TAG}${tags.length + 1}`);
            hints.push(`标签不足 ${TAG_MIN} 个，已补“${UNCATEGORIZED_TAG}”`);
        }
    }
    return tags;
}
function normalizeRequiredText(raw, hints, field, maxChars, label, hintText) {
    if (typeof raw !== 'string' || tidy(raw) === '') {
        return { error: `未记录：${field} 必填（${label}）。` };
    }
    const cleaned = field === 'digest' ? raw.trim() : tidy(raw);
    if (countChars(cleaned) > maxChars) {
        hints.push(hintText);
        // 标题短且无句式，硬切即可；结论与摘要是成句文本，切在自然边界，避免断头句。
        return field === 'title' ? truncateChars(cleaned, maxChars) : truncateAtBoundary(cleaned, maxChars);
    }
    return cleaned;
}
/**
 * 清洗 `memory_seal` 参数；非法输入返回可读错误文本，绝不抛错。
 */
export function normalizeSealArgs(rawArgs, config) {
    const args = asRecord(rawArgs);
    const hints = [];
    const cardIdRaw = args.cardId;
    const cardId = toPositiveId(cardIdRaw);
    if (cardIdRaw !== undefined && cardIdRaw !== null && cardId === undefined) {
        return { ok: false, message: '未记录：cardId 必须是正整数（省略表示新建卡片）。' };
    }
    const title = normalizeRequiredText(args.title, hints, 'title', TITLE_MAX_CHARS, '卡片标题，≤ 20 个汉字', `标题超过 ${TITLE_MAX_CHARS} 字，已截断`);
    if (typeof title !== 'string')
        return { ok: false, message: title.error };
    const tags = normalizeTags(args.tags, hints);
    if (!Array.isArray(tags))
        return { ok: false, message: tags.error };
    const conclusion = normalizeRequiredText(args.conclusion, hints, 'conclusion', CONCLUSION_MAX_CHARS, '一句话结论，≤ 40 字，必须包含结果或状态', `结论超过 ${CONCLUSION_MAX_CHARS} 字，已在句末截断；请把要点压缩到 ${CONCLUSION_MAX_CHARS} 字内`);
    if (typeof conclusion !== 'string')
        return { ok: false, message: conclusion.error };
    const digest = normalizeRequiredText(args.digest, hints, 'digest', config.digestMaxChars, `摘要，建议 200–300 字：结论 + 关键坑 + 涉及文件，≤ ${config.digestMaxChars} 字`, `摘要超过 ${config.digestMaxChars} 字，已在句末截断；请压缩到 200–300 字，并把关键信息写在结尾`);
    if (typeof digest !== 'string')
        return { ok: false, message: digest.error };
    if (countChars(digest) < 60)
        hints.push('摘要偏短（建议 200–300 字：结论 + 关键坑 + 涉及文件）');
    let status;
    if (args.status !== undefined && args.status !== null) {
        if (isMemoryStatus(args.status))
            status = args.status;
        else
            hints.push('status 只能是 done 或 open，已按默认处理');
    }
    const input = {
        title,
        tags,
        conclusion,
        digest,
        status: status ?? 'done',
    };
    const patch = {
        title,
        tags,
        conclusion,
        digest,
        ...(status !== undefined ? { status } : {}),
    };
    return { ok: true, cardId, input, patch, hints };
}
