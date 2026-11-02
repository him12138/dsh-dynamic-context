/**
 * `/memory` 斜杠命令（技术设计 §8、需求 §6.8）：
 *   /memory list | open <id> | forget <id> | end
 *
 * 命令是 log-only 事件、不包裹 turn；`end` 只设置 pendingEnd 标记（卡片内容必须由模型生成）。
 */
import type { Controller } from './controller.js';
import type { PluginContextLike } from './platform.js';
/** 注册 `/memory`；返回精确的注销 disposer。 */
export declare function registerMemoryCommand(ctx: PluginContextLike, controller: Controller): () => void;
