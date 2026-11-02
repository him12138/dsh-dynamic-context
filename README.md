# dsh-dynamic-context

> **动态上下文**——模型记住的不是整段历史，而是此刻该知道的事。

给 DeepSeek Harness 的项目级记忆插件：上下文随任务生长、按需收缩，而不是把全部对话塞进窗口。

- **常驻成本恒定**：人设 ≤3000 字 + 最近任务索引 ≈300 tokens，与对话多长无关
- **项目作用域**：同一项目下所有会话共享，跨项目完全隔离
- **零负担**：无运行时依赖、无网络、无后台进程、无额外 LLM 调用
- **文件即记忆**：`memory/` 下全是明文，可随手改、可删、可提交到自己的私有库

## 三层结构

| 层 | 内容 | 何时进入上下文 |
|---|---|---|
| L1 固定记忆 | `memory/persona.md` 全文 | 每次请求 |
| L2 任务卡片 | 最近 5 条卡片索引 | 每次请求 |
| L3 原话 | 会话日志引用（不复制正文） | 显式调用 `memory_raw` 时 |

## 快速开始

```json
{ "action": "install_bundle", "target": "link:C:\\path\\to\\dsh-dynamic-context" }
```

验证：`plugin_manager list_plugins` 里出现 `include:dsh-dynamic-context`（`fiberPhase: "active"`），工具表出现 `memory_*`。

日常只需两句话：「上次那个任务怎么解决的？」→ 检索并展开摘要；「记一下」→ 收尾封存卡片。

## 常用命令

| 命令 | 作用 |
|---|---|
| `/memory list` | 最近 20 条卡片 |
| `/memory open <id>` | 摘要 + 元信息 |
| `/memory forget <id>` | 彻底删除 |
| `/memory end` | 结束当前任务并封存 |

## 文档

- [安装与卸载](docs/installation.md)
- [配置项](docs/configuration.md)
- [数据、存储与插件结构](docs/architecture.md)
- [开发、测试与已知限制](docs/development.md)

## 兼容性

DSH `>=0.2.1-rc.3`（实测 `0.2.1-rc.5`）；Node `^22.19.0 || >=24.0.0`。MIT License。

---

*现在，你能给他完整的一生了*
