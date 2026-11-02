/**
 * 对 DSH 运行时对象的最小结构化类型声明。
 *
 * 插件刻意不 import 任何 `@deepseek-ai/*` 包（零运行时依赖、可独立加载），
 * 只声明本插件实际用到的平台形状；真实对象由 Cordis 注入，结构兼容。
 * 平台契约来源：`audit-dsh-platform.md` 与运行时包 typert 声明（0.2.1-rc.5）。
 */
export {};
