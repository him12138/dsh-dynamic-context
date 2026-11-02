import type { PluginContextLike } from './platform.js';
/** Cordis 插件名（与 package.json 的 name 一致）。 */
export declare const name = "dsh-dynamic-context";
/** 依赖服务；缺失时插件不会激活（sessionQuery 在 base 默认挂载）。 */
export declare const inject: string[];
export declare function apply(ctx: PluginContextLike, rawConfig?: unknown): void;
