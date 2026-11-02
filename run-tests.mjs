/**
 * 单进程测试入口。
 *
 * `node --test` 会为每个测试文件 spawn 子进程；在受限沙箱里这会因
 * `spawn EPERM`（无法打开命名管道）失败。这里改为直接 import 所有测试文件，
 * 由 node:test 在同一进程内执行，结果与 `node --test` 等价。
 */
const FILES = [
  'config',
  'seal',
  'render',
  'store',
  'search',
  'transcript',
  'persona',
  'controller',
]

for (const name of FILES) {
  await import(`./test/${name}.test.mjs`)
}
