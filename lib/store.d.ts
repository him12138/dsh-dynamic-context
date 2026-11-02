import type { Card, CardInput, CardPatch, CardsFile, MemoryConfig, MemoryPaths } from './types.js';
import type { LoggerLike } from './platform.js';
/** cards.json 容量上限：8MB（技术设计 §5.3），超出拒绝新增并提示清理。 */
export declare const MAX_CARDS_BYTES: number;
/** 写入卡片时由调用方提供的会话环境（用于 rawRef）。 */
export interface StoreEnv {
    readonly sessionId: string;
    readonly sessionCwd: string;
    readonly toSeq: number;
}
interface PersonaSnapshot {
    text: string | null;
    length: number;
    missing: boolean;
    tooLong: boolean;
}
/** 排序：open 在前（sealedAt 升序），done 按 sealedAt 倒序（需求 §6.3）。 */
export declare function sortForIndex(cards: readonly Card[]): Card[];
/** 排序：最近列表（open 在前，其余按 sealedAt 倒序；与常驻索引一致，便于用户理解）。 */
export declare function sortRecent(cards: readonly Card[]): Card[];
/** memory/ 文件存储。 */
export declare class ProjectStore {
    readonly cwd: string;
    readonly config: MemoryConfig;
    readonly paths: MemoryPaths;
    private readonly logger?;
    private personaCache;
    private cardsCache;
    private diskCorrupt;
    constructor(cwd: string, config: MemoryConfig, logger?: LoggerLike);
    /** 路径白名单校验：所有写路径必须位于 memoryDir 内（防止配置/拼接逃逸）。 */
    assertWritable(target: string): void;
    /** 惰性创建 memory/ 与 .gitignore（仅首次创建 .gitignore）。 */
    ensureDir(): void;
    private statKey;
    /** 读取固定记忆文档（带 mtime/size 缓存）；不存在或不可读返回 null。 */
    readPersonaCached(): string | null;
    /** 读取固定记忆文档并给出注入所需元信息（超限判断见需求 §6.1）。 */
    readPersona(): PersonaSnapshot;
    /**
     * 整体替换固定记忆文档：先备份当前文件为 persona.md.bak，再原子写。
     * 长度/自包含校验由控制器（persona.ts）在调用前完成。
     */
    writePersona(content: string): {
        length: number;
        lengthChanged: boolean;
        backedUp: boolean;
    };
    private readCardsText;
    /** 读取卡片库（带缓存）；损坏时回退 .bak，再失败则隔离坏文件并以空库继续（F8）。 */
    readCards(): CardsFile;
    private quarantineCorruptCards;
    /** 原子写入卡片库：容量校验 → 备份上一版 → 临时文件 + rename。 */
    writeCards(file: CardsFile): void;
    private atomicWrite;
    /** 全部卡片（缓存副本，调用方只读）。 */
    listCards(): readonly Card[];
    findCard(id: number): Card | undefined;
    totalCards(): number;
    /** 同会话上一张卡片的 rawRef.toSeq（没有则 0）；仅看同 sessionId 的卡片。 */
    private lastToSeqInSession;
    /** 新增一张卡片（id 项目内单调递增、删除后不复用）。 */
    addCard(input: CardInput, env: StoreEnv): Card;
    /** 更新已有卡片（含 open→done）；保留原 rawRef.fromSeq，同会话内延伸 toSeq。 */
    updateCard(id: number, patch: CardPatch, env: StoreEnv): Card | undefined;
    /** 彻底删除一张卡片（含摘要与原话引用）；返回被删卡片，未找到返回 undefined。 */
    deleteCard(id: number): Card | undefined;
}
export {};
