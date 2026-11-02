/**
 * 5 个模型工具（技术设计 §7、§19.1）：
 * memory_seal / memory_search / memory_open / memory_raw / memory_persona。
 *
 * 工具描述要短（每个请求都计入 toolsTokens）；参数用 JSON Schema 显式声明。
 * execute 内一律不抛错：Controller 返回可读文本作为工具结果，失败不结束回合。
 */
import type { Controller } from './controller.js';
import type { ToolDefinitionLike } from './platform.js';
/** 构建 5 个 memory_* 工具定义。 */
export declare function buildMemoryTools(controller: Controller): ToolDefinitionLike[];
