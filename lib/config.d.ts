/**
 * 插件配置默认值与归一化。
 *
 * 不使用 schemastery：插件保持零运行时依赖，配置可由 cordis.patch.yml 的
 * `config:` 覆盖；未提供/非法字段回落到默认值（技术设计 §14）。
 */
import type { MemoryConfig } from './types.js';
export declare const DEFAULT_CONFIG: Readonly<MemoryConfig>;
/** 把任意原始配置归一化为完整 MemoryConfig。 */
export declare function normalizeConfig(raw: unknown): MemoryConfig;
