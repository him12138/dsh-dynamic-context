const TEXT_SCHEMA = { type: 'string' };
function renderText(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return [{ type: 'text', text }];
}
const STRING_OUTPUT = {
    schema: TEXT_SCHEMA,
    render: (_args, value) => renderText(value),
};
/** 构建 5 个 memory_* 工具定义。 */
export function buildMemoryTools(controller) {
    return [
        {
            name: 'memory_seal',
            description: '写一张项目任务卡片（标题/标签/结论/摘要）。任务收尾时才调用；用户说“还没完”时可用 status=open。传 cardId 可更新已有卡片。',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: '卡片标题，≤ 20 个汉字。' },
                    tags: { type: 'array', items: { type: 'string' }, description: '3–5 个标签，每个 ≤ 16 字。' },
                    conclusion: { type: 'string', description: '一句话结论，≤ 40 字，必须包含结果或状态。' },
                    digest: { type: 'string', description: '摘要，约 200–300 字：结论 + 关键坑 + 涉及文件。' },
                    status: { type: 'string', enum: ['done', 'open'], description: '默认 done；任务未完成时用 open。' },
                    cardId: { type: 'integer', description: '传入则更新该 id 的已有卡片（含 open→done）；省略表示新建。' },
                },
                required: ['title', 'tags', 'conclusion', 'digest'],
            },
            output: STRING_OUTPUT,
            execute: async (args, exec) => controller.seal(exec.agent, args, (message) => exec.deferContext?.(message)),
        },
        {
            name: 'memory_search',
            description: '按关键词在项目任务卡片中检索（标题/标签/结论/摘要）；日常闲聊不要调用。不传 query 返回最近任务列表。',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: '检索关键词，可为空（空则返回最近任务）。' },
                    limit: { type: 'integer', description: '返回条数，默认 5，最大 10。' },
                },
            },
            output: STRING_OUTPUT,
            execute: async (args, exec) => {
                const record = args !== null && typeof args === 'object' ? args : {};
                return controller.search(exec.agent, record.query, record.limit);
            },
        },
        {
            name: 'memory_open',
            description: '展开某张任务卡片的摘要与元信息（先检索拿到 id）。',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'integer', description: '卡片 id，例如 12。' },
                },
                required: ['id'],
            },
            output: STRING_OUTPUT,
            execute: async (args, exec) => {
                const record = args !== null && typeof args === 'object' ? args : {};
                return controller.open(exec.agent, record.id);
            },
        },
        {
            name: 'memory_raw',
            description: '按卡片 id 查看该任务的原始对话片段：默认只取最新约 2000 字，非必要不要继续往前翻；只有用户明确要求或确有必要时才传 cursor。',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'integer', description: '卡片 id，例如 12。' },
                    cursor: { type: 'integer', description: '回溯游标，默认 0（最新片段）；取更早片段时传上次返回的 nextCursor。' },
                },
                required: ['id'],
            },
            output: STRING_OUTPUT,
            execute: async (args, exec) => {
                const record = args !== null && typeof args === 'object' ? args : {};
                return controller.raw(exec.agent, record.id, record.cursor);
            },
        },
        {
            name: 'memory_persona',
            description: '更新固定记忆文档（人设）：只存长期有效内容；提交前自检字数，超过 3000 字先自己归纳压缩；整体替换；不得引用其他文档。',
            parameters: {
                type: 'object',
                properties: {
                    content: { type: 'string', description: '人设文档全文（Markdown，目标 ≤ 3000 字，建议 200–800 字）。' },
                    reason: { type: 'string', description: '简短说明本次更新原因（写日志，不注入）。' },
                },
                required: ['content'],
            },
            output: STRING_OUTPUT,
            execute: async (args, exec) => {
                const record = args !== null && typeof args === 'object' ? args : {};
                return controller.updatePersona(exec.agent, record.content, record.reason);
            },
        },
    ];
}
