# 数据、存储与插件结构

## 数据与存储

```
<项目根>/memory/
├── persona.md          # 固定记忆文档（用户手改；模型经工具凝练更新）
├── persona.md.bak      # 模型写入前的自动备份
├── cards.json          # { schemaVersion: 1, nextId, cards[] }（原子读写）
├── cards.json.bak      # 上一版本备份
└── .gitignore          # * + !.gitignore，默认自忽略（仅首次创建）
```

- 插件只写 `memory/` 下的文件，不修改项目其它文件，也不修改 DSH 会话日志。
- 所有写操作：备份上一版 → 临时文件 + rename 原子替换；`cards.json` 超过 8MB 时拒绝新增并提示清理。
- 读取失败（损坏）时：回退 `cards.json.bak`；仍失败则隔离坏文件（`cards.json.corrupt-<ts>`）并以空库继续，告警但不阻断对话。
- 卡片 `rawRef` 只保存 `{ sessionId, fromSeq, toSeq }` 引用（`fromSeq` = 同会话上一张卡片的 `toSeq`，首张为 0），**不复制原话**；会话删除后原话不可读，摘要仍可用。
- 注入层读盘为同步小文件读 + `mtime/size` 缓存：未变化的文件每 step 只做 stat，毫秒级。

## 注入位置

| 内容 | 注入点 | order |
|---|---|---|
| 固定记忆（人设） | `systemPrompt.section` | 100（persona prefix 之后、plan policy 之前） |
| 常驻索引 | `systemPrompt.context` | 300（runtime context 之后） |
| 行为规则 | `systemPrompt.section` | 460（plan/team policy 之前） |

## 插件结构

```
src/
├── index.ts       # 插件入口：name/inject/apply；注册 3 段注入、5 个工具、1 个命令
├── platform.ts    # 对 Cordis/DSH 运行时的最小结构化类型声明（不 import @deepseek-ai/*）
├── config.ts      # 配置默认值与归一化
├── types.ts       # Card / CardsFile / MemoryConfig 等公共类型
├── store.ts       # memory/ 读写、缓存、原子写、备份、损坏恢复、排序
├── render.ts      # 固定记忆段、规则段、索引、摘要/检索/原话文本渲染
├── search.ts      # 检索评分（中文 bigram + 标签匹配）
├── persona.ts     # 人设长度与自包含校验
├── seal.ts        # memory_seal 参数清洗与字段约束
├── transcript.ts  # 原话读取/渲染/分片（注入 SessionReader）
├── controller.ts  # 业务编排（封存/检索/展开/原话/人设/命令/注入）
├── tools.ts       # 5 个模型工具定义
└── commands.ts    # /memory 命令注册
lib/               # tsc 构建产物（package main 指向 lib/index.js）
test/              # node:test 单测（110 个用例）
```
