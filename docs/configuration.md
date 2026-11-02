# 配置项

通过 profile patch 覆盖（`id: dsh-dynamic-context` 的 `config`）：

```yaml
- id: dsh-dynamic-context
  config:
    recentCards: 5
    maxIndexChars: 600
    maxPersonaChars: 3000
    digestMaxChars: 320
    rawChunkChars: 2000
    searchLimit: 5
    listLimit: 20
    memoryDirName: memory
    enableGuide: true
    enablePersonaHint: true
```

| 配置 | 默认 | 说明 |
|---|---|---|
| `recentCards` | 5 | 常驻索引条数 |
| `maxIndexChars` | 600 | 索引字符上限（≈300 tokens） |
| `maxPersonaChars` | 3000 | 固定记忆上限（字，建议 200–800；超限退回提示，不自动截断） |
| `digestMaxChars` | 320 | 摘要字符上限 |
| `rawChunkChars` | 2000 | 原话分片字数 |
| `searchLimit` | 5 | 检索默认返回条数（上限 10） |
| `listLimit` | 20 | `/memory list` 与空 query 检索条数 |
| `memoryDirName` | `memory` | 记忆目录名（相对项目根） |
| `enableGuide` | true | 是否注入行为规则段 |
| `enablePersonaHint` | true | 无人设文件时是否在索引末尾提示 |

插件不导出 schemastery `Config`：配置按纯对象读取并由 `src/config.ts` 归一化/校验，非法值回落到默认值（保持零运行时依赖）。
