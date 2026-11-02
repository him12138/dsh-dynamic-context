# 开发、测试与已知限制

## 开发与测试

```powershell
npm install      # devDependencies: typescript / @types/node
npm run build    # tsc -> lib/
npm test         # node --test "test/*.test.mjs"（对 lib/ 产物）
```

单测覆盖：配置归一化/逃逸防护、存储（原子写/备份/损坏恢复/缓存失效/排序/容量）、渲染（人设截断、索引预算与稳定性、命令与工具文本）、检索（标签/bigram/阈值/排序/1000 条性能）、人设校验（超长/外部引用/边界/emoji）、原话（区间/渲染/截断/分片/降级/回退）、seal 参数清洗、以及 controller 集成测试（fake ctx 下的完整工具/命令/注入链路与降级路径）。

## 已知限制与风险

- **依赖 DSH rc 运行时**：已验证 runtime `0.2.1-rc.5`。只使用公开服务面（`ctx.systemPrompt` / `ctx.tools` / `ctx.commands` / `ctx.sessionQuery`），运行时升级后需回归验收实验 E1–E7；`engines.dsh: ">=0.2.1-rc.3"` 由启动器校验。
- **任务区间是近似**：`rawRef` 以「同会话上一张卡片的封存事件序号 → 本卡片封存事件序号」近似任务区间，交叉进行的多个任务可能夹带少量穿插内容。
- **压缩只能观察、不能拦截**：插件不依赖压缩前钩子；固定记忆段与规则段在系统提示词 node 0（压缩不覆盖），常驻索引由 runtime context 在压缩后自动重建。
- **配置无 JSON Schema**：未依赖 schemastery（保持零运行时依赖），因此 Plugins 页不会显示本插件的配置表单；配置仍可通过 profile patch 覆盖。
- **模型遵从性依赖规则段与工具描述**：误记/漏记由用户口头纠正、`/memory end` 或 `/memory forget` 兜底，不做逐轮自动提醒。
- **`memory/` 位于项目工作区**：人设与卡片会被工作区工具看到（设计如此，便于用户手改）；默认 `.gitignore` 自忽略。
