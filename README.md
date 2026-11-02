# dsh-memory

> **动态上下文**——模型记住的不是整段历史，而是此刻该知道的事。

给 DeepSeek Harness 的项目级记忆插件：上下文随任务生长、按需收缩，而不是把全部对话塞进窗口。Host-only 单包，无客户端面板、无后台进程、无网络、无 LLM 二次调用。

它把长期记忆分成三层，让模型平时只持有极小的固定记忆与最近任务索引，其余内容按需检索、展开、取原话：

| 层 | 内容 | 存放 | 何时进入模型上下文 |
|---|---|---|---|
| L1 固定记忆（人设） | `memory/persona.md` 全文（≤ 3000 字，建议 200–800 字） | 项目内 | 每次请求（系统提示词段，改文件下一轮生效） |
| L2 任务记忆 | 最近 5 条任务卡片索引（标题 + 标签 + 状态 + 一句话结论） | 项目内 `memory/cards.json` | 每次请求（运行时上下文快照，内容变化才追加） |
| L3 原话 | 任务对应时间段的原始对话/工具结果 | DSH 会话日志（只存引用） | 模型显式调用 `memory_raw` 时按需读取 |

作用域是**会话 cwd（项目根）**：同一项目下的所有会话（新会话、resume、compact 后）共享一套记忆；不同项目完全隔离。

## 功能一览

- **固定记忆文档** `memory/persona.md`：用户可随时手改，下一轮生效；模型可经 `memory_persona` 工具凝练更新（≤ 3000 字、自包含、写前自动备份 `persona.md.bak`，超限退回要求先归纳压缩，不自动截断）。
- **任务卡片**：模型在任务收尾时调用 `memory_seal` 写入（标题 ≤ 20 字、标签 3–5 个、结论 ≤ 40 字、摘要约 200–300 字）；支持 open（进行中）/done（完成）状态与按 id 更新；卡片 id 项目内单调递增、删除后不复用。
- **常驻索引**：最近 5 条卡片，`open` 在前、其余按封存时间倒序；≤ 300 tokens 预算、文本稳定（只在卡片增删改/状态变化/`/memory end` 时变化），压缩后由 DSH 自动重建。
- **检索** `memory_search`：只搜卡片字段（标题/标签/结论/摘要），中文按字符二元组 + 标签精确匹配计分，毫秒级、确定性、不调用 LLM；无 query 时返回最近 20 条。
- **展开摘要** `memory_open`：完整摘要 + 元信息（状态/标签/封存时间/原话是否可读）。
- **看原话** `memory_raw`：从最新向前分片，每次约 2000 字，默认只给最新片段；只有用户明确要求或确有必要时才用返回的 `cursor` 继续往前翻；会话被删除时降级为可读提示，摘要仍可用。
- **命令**：`/memory list`、`/memory open <id>`、`/memory forget <id>`、`/memory end`（请求结束当前任务，模型在下一次回复前封存）。
- **自动防误传**：`memory/` 首次使用自动创建 `.gitignore`（内容 `*` + `!.gitignore`），避免人设与卡片被误提交。

## 安装

### 方式 A：热安装（推荐，DSH Desktop，HMR 已启用）

在任意 DSH 会话里让模型调用 `plugin_manager` 工具（或在 Plugins 页操作）：

```json
{ "action": "install_bundle", "target": "link:C:\\path\\to\\dsh-memory" }
```

返回 `application: "applied"` 即已挂载到运行中的 Host，**无需重启**。验证：`plugin_manager list_plugins` 出现 `entryId: "include:dsh-memory"`、`fiberPhase: "active"`；工具表中出现 `memory_*`。

> 开发态 link 安装不复制文件；改代码后 `npm run build`，再触发一次 profile recomposition（对 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 做一次真实写入，例如追加一行注释）即可热重载，约 2–3 秒生效；改完记得逐字节恢复 patch。

### 方式 B：手工安装（等价落盘位置）

```powershell
# 1) 构建
cd <repo>/dsh-memory
npm install          # 仅开发依赖（typescript/@types/node），插件运行时零依赖
npm run build        # tsc -> lib/

# 2) 装进 profile
cd $env:DSH_HOME\profiles\desktop
pnpm add link:<repo>\dsh-memory

# 3) 把 "dsh-memory" 加入该 package.json 的 dsh.profile.bundles
# 4) 重启 DSH（无 HMR 的场景需要重启）
```

bundle 的 patch 声明见 `cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-memory
      name: dsh-memory
      config: {}
```

### 卸载

```json
{ "action": "remove_bundle", "target": "dsh-memory" }
```

无 HMR 时需重启；link 安装可能残留 `node_modules/dsh-memory` Junction，可用 `cmd /c rmdir <profile>\node_modules\dsh-memory` 清理。

## 配置

通过 profile patch 覆盖（`id: dsh-memory` 的 `config`）：

```yaml
- id: dsh-memory
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

插件不导出 schemastery `Config`：配置按纯对象读取并由 `src/config.ts` 归一化/校验，非法值回落到默认值（零运行时依赖，见「已知限制」）。

## 使用

对话示例：

- 「上次贪吃蛇那个任务怎么解决的？」→ 模型会先 `memory_search`，再 `memory_open` 展开摘要。
- 「看下原话」→ `memory_raw` 只返回最新约 2000 字；「再往前看」才继续翻。
- 「以后叫我老王，记下来」→ 模型用 `memory_persona` 凝练更新 `memory/persona.md`。
- 「删掉 #12」→ 模型调用工具（或用户直接用 `/memory forget 12`）。

命令示例：

```
/memory list          # 最近 20 条卡片： #id [状态] 标题 · 结论 · 封存日期
/memory open 12       # 摘要 + 元信息
/memory forget 12     # 彻底删除（卡片、摘要、原话引用一并删除）
/memory end           # 请求结束当前任务；模型会在下一次回复前封存
```

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
- 注入层读盘为同步小文件读 + `mtime/size` 缓存：未变化的文件每 step 只做 stat，毫秒级（见验收实验 E2）。

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

设计文档与验收记录暂未随仓库公开。

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
- **配置无 JSON Schema**：未依赖 schemastery（保持零运行时依赖），因此 Plugins 页不会显示本插件的配置表单；配置仍可通过 profile patch 覆盖。若后续需要可视化配置，可加回 schemastery 依赖。
- **模型遵从性依赖规则段与工具描述**：误记/漏记由用户口头纠正、`/memory end` 或 `/memory forget` 兜底，不做逐轮自动提醒（产品决策 D20）。
- **`memory/` 位于项目工作区**：人设与卡片会被工作区工具看到（设计如此，便于用户手改）；默认 `.gitignore` 自忽略。

---

*现在，你能给他完整的一生了*

