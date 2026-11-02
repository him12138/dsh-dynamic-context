/**
 * dsh-dynamic-context 公共类型与存储结构。
 *
 * 设计依据：requirements-dsh-memory-v0.2.md §9、tech-design-dsh-memory.md §5。
 * 本文件不 import 任何 @deepseek-ai/* 包：插件运行时只依赖 Node 内置模块。
 */
/** 任务卡片状态：进行中 / 已完成。 */
export type CardStatus = 'open' | 'done';
/** 原话引用：只存会话 id + 事件序号范围，不复制原文（D26/I5）。 */
export interface RawRef {
    sessionId: string;
    fromSeq: number;
    toSeq: number;
}
/** 任务卡片（长期记忆最小单位，对应一次已收尾的任务）。 */
export interface Card {
    id: number;
    title: string;
    tags: string[];
    conclusion: string;
    digest: string;
    status: CardStatus;
    createdAt: string;
    sealedAt: string;
    updatedAt: string;
    sessionId: string;
    sessionCwd: string;
    rawRef: RawRef;
}
/** memory/cards.json 顶层结构（带 schemaVersion 便于未来迁移）。 */
export interface CardsFile {
    schemaVersion: 1;
    nextId: number;
    cards: Card[];
}
/** memory_persona 工具提交结果。 */
export type PersonaWriteResult = {
    ok: true;
    length: number;
    lengthChanged: boolean;
    backedUp: boolean;
} | {
    ok: false;
    length: number;
    reason: 'too-long' | 'reference';
    message: string;
};
/** 插件配置（对应技术设计 §14；未用 schemastery，保持零运行时依赖）。 */
export interface MemoryConfig {
    recentCards: number;
    maxIndexChars: number;
    maxPersonaChars: number;
    digestMaxChars: number;
    rawChunkChars: number;
    searchLimit: number;
    listLimit: number;
    memoryDirName: string;
    enableGuide: boolean;
    enablePersonaHint: boolean;
}
/** 项目内 memory/ 各文件绝对路径。 */
export interface MemoryPaths {
    dir: string;
    persona: string;
    personaBackup: string;
    cards: string;
    cardsBackup: string;
    gitignore: string;
    lock: string;
}
/** 卡片写入输入（memory_seal 参数清洗后）。 */
export interface CardInput {
    title: string;
    tags: string[];
    conclusion: string;
    digest: string;
    status: CardStatus;
}
/** 卡片更新输入（memory_seal 带 cardId 时）。 */
export interface CardPatch {
    title?: string;
    tags?: string[];
    conclusion?: string;
    digest?: string;
    status?: CardStatus;
}
/** 领域错误：插件内部不抛给模型，统一转成可读文本（技术设计 §13）。 */
export declare class MemoryError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
