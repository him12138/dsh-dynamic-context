export const DEFAULT_CONFIG = Object.freeze({
    recentCards: 5,
    maxIndexChars: 600,
    maxPersonaChars: 3000,
    digestMaxChars: 320,
    rawChunkChars: 2000,
    searchLimit: 5,
    listLimit: 20,
    memoryDirName: 'memory',
    enableGuide: true,
    enablePersonaHint: true,
});
function positiveInt(value, fallback) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0)
        return value;
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        const parsed = Number(value.trim());
        if (Number.isSafeInteger(parsed) && parsed > 0)
            return parsed;
    }
    return fallback;
}
function boolValue(value, fallback) {
    if (typeof value === 'boolean')
        return value;
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    return fallback;
}
function dirName(value, fallback) {
    if (typeof value !== 'string')
        return fallback;
    const trimmed = value.trim();
    if (trimmed === '')
        return fallback;
    // 只允许相对目录名：禁止绝对路径与 `..` 逃逸（插件只能写 <cwd>/<dir>/）。
    if (/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(trimmed))
        return fallback;
    if (trimmed.split(/[\\/]+/).some((part) => part === '..'))
        return fallback;
    return trimmed;
}
/** 把任意原始配置归一化为完整 MemoryConfig。 */
export function normalizeConfig(raw) {
    const source = raw !== null && typeof raw === 'object' ? raw : {};
    return {
        recentCards: Math.min(positiveInt(source.recentCards, DEFAULT_CONFIG.recentCards), 20),
        maxIndexChars: Math.min(positiveInt(source.maxIndexChars, DEFAULT_CONFIG.maxIndexChars), 4000),
        maxPersonaChars: Math.min(positiveInt(source.maxPersonaChars, DEFAULT_CONFIG.maxPersonaChars), 100_000),
        digestMaxChars: Math.min(positiveInt(source.digestMaxChars, DEFAULT_CONFIG.digestMaxChars), 2000),
        rawChunkChars: Math.min(positiveInt(source.rawChunkChars, DEFAULT_CONFIG.rawChunkChars), 20_000),
        searchLimit: Math.min(positiveInt(source.searchLimit, DEFAULT_CONFIG.searchLimit), 20),
        listLimit: Math.min(positiveInt(source.listLimit, DEFAULT_CONFIG.listLimit), 200),
        memoryDirName: dirName(source.memoryDirName, DEFAULT_CONFIG.memoryDirName),
        enableGuide: boolValue(source.enableGuide, DEFAULT_CONFIG.enableGuide),
        enablePersonaHint: boolValue(source.enablePersonaHint, DEFAULT_CONFIG.enablePersonaHint),
    };
}
