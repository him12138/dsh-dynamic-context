/**
 * dsh-memory 固定记忆文档（人设）校验（纯函数：无 IO、无 DSH 依赖）。
 *
 * 设计依据：tech-design-dsh-memory.md §7.5 第 2–3 步、
 *           requirements-dsh-memory-v0.2.md §6.1（总长上限 3000 字 + 自包含）。
 * 契约：.notes/CONTRACTS.md §2（导出名/签名/文案以契约为准）。
 *
 * 说明：工具只做"安全兜底"——超长只退回并提示模型先归纳压缩，绝不自动截断；
 * 外部文档引用只退回并给出建议，不修改内容。
 */
/** 按 Unicode 码点计"字"（emoji / 扩展区字符按 1 个字计，与 [...s].length 一致）。
 *  统一从 util.js 引入并再导出，避免与 store/seal 各持一份实现导致口径漂移。 */
import { countChars } from './util.js';
export { countChars };
/**
 * 自包含检查规则（设计 §7.5 第 3 步）：
 *   1. markdown 文件链接：`](...md|txt|pdf|doc|docx)`
 *   2. 裸文件路径/文件名：`xxx.md` / `xxx.txt` / `xxx.pdf` / `xxx.doc(x)`
 *   3. 引用措辞 + 文件名：`详见/参见/参考/见 … .md|txt|pdf|doc(x)`
 *   4. `附件`（含 `附件：` / `附件1` 等变体）
 *
 * 全部忽略大小写；命中任一即视为"引用了外部文档"。
 * 注意：规则不专门识别 URL —— 普通 URL 不命中，但以 .md/.txt/.pdf/.docx
 * 结尾的 URL 会被规则 2 命中（契约"不检查 URL"的直译，与设计一致）。
 */
const REFERENCE_RULES = [
    /\]\([^)]*\.(md|txt|pdf|docx?)\)/gi,
    /[\w\u4e00-\u9fa5./\\-]+\.(md|txt|pdf|docx?)\b/gi,
    /(详见|参见|参考|见)\s*[《“‘"]?\s*[^\s，。；]{1,40}\.(md|txt|pdf|docx?)/gi,
    /附件[：:0-9]?/gi,
];
/** markdown 链接命中形如 `](docs/a.md)`，截出里面的路径，让提示更可读。 */
function tidyHit(raw) {
    const mdLink = /^\]\(([^)]*)\)$/.exec(raw);
    return (mdLink ? mdLink[1] : raw).trim();
}
/** 收集外部引用命中的原文片段（去重、最多 3 条；纯函数，不修改入参）。 */
function findReferenceHits(content) {
    const hits = [];
    const seen = new Set();
    for (const pattern of REFERENCE_RULES) {
        for (const match of content.matchAll(pattern)) {
            const raw = match[0];
            if (typeof raw !== 'string')
                continue;
            const hit = tidyHit(raw);
            if (hit.length === 0 || seen.has(hit))
                continue;
            seen.add(hit);
            hits.push(hit);
            if (hits.length >= 3)
                return hits;
        }
    }
    return hits;
}
/**
 * 校验待写入的人设文档（契约 §2）：
 *   1. 先做长度兜底：length > maxChars -> too-long（优先于引用检查）。
 *   2. 再做自包含检查：命中外部文档引用 -> reference，hits 为命中的原文片段（最多 3 条）。
 *   3. 都通过 -> { ok: true }。
 */
export function checkPersona(content, maxChars) {
    const length = countChars(content);
    if (length > maxChars) {
        return {
            ok: false,
            code: 'too-long',
            length,
            message: `未写入：人设文档 ${length} 字，超过 ${maxChars} 字上限。请先自己归纳压缩（删过时/重复/非必要内容）后再提交；不要提交超长内容等待截断。`,
        };
    }
    const hits = findReferenceHits(content);
    if (hits.length > 0) {
        const quoted = hits.map((hit) => `「${hit}」`).join('');
        return {
            ok: false,
            code: 'reference',
            length,
            message: `未写入：人设文档必须自包含，检测到外部文档引用${quoted}。请删除对文件/附件的引用后重新提交。`,
            hits,
        };
    }
    return { ok: true };
}
