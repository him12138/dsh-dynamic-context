# 安装与卸载

## 方式 A：热安装（推荐，DSH Desktop，HMR 已启用）

在任意 DSH 会话里让模型调用 `plugin_manager` 工具（或在 Plugins 页操作）：

```json
{ "action": "install_bundle", "target": "link:C:\\path\\to\\dsh-dynamic-context" }
```

返回 `application: "applied"` 即已挂载到运行中的 Host，**无需重启**。

验证：`plugin_manager list_plugins` 出现 `entryId: "include:dsh-dynamic-context"`、`fiberPhase: "active"`；工具表中出现 `memory_*`。

> 开发态 link 安装不复制文件；改代码后 `npm run build`，再触发一次 profile recomposition（对 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 做一次真实写入，例如追加一行注释）即可热重载，约 2–3 秒生效；改完记得逐字节恢复 patch。

## 方式 B：手工安装（等价落盘位置）

```powershell
# 1) 构建
cd <repo>/dsh-dynamic-context
npm install          # 仅开发依赖（typescript/@types/node），插件运行时零依赖
npm run build        # tsc -> lib/

# 2) 装进 profile
cd $env:DSH_HOME\profiles\desktop
pnpm add link:<repo>\dsh-dynamic-context

# 3) 把 "dsh-dynamic-context" 加入该 package.json 的 dsh.profile.bundles
# 4) 重启 DSH（无 HMR 的场景需要重启）
```

bundle 的 patch 声明见 `cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-dynamic-context
      name: dsh-dynamic-context
      config: {}
```

## 卸载

```json
{ "action": "remove_bundle", "target": "dsh-dynamic-context" }
```

无 HMR 时需重启；link 安装可能残留 `node_modules/dsh-dynamic-context` Junction，可用 `cmd /c rmdir <profile>\node_modules\dsh-dynamic-context` 清理。
