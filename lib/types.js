/**
 * dsh-dynamic-context 公共类型与存储结构。
 *
 * 设计依据：requirements-dsh-memory-v0.2.md §9、tech-design-dsh-memory.md §5。
 * 本文件不 import 任何 @deepseek-ai/* 包：插件运行时只依赖 Node 内置模块。
 */
/** 领域错误：插件内部不抛给模型，统一转成可读文本（技术设计 §13）。 */
export class MemoryError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'MemoryError';
        this.code = code;
    }
}
