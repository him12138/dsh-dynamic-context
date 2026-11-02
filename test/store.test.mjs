import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../lib/config.js'
import { ProjectStore, sortForIndex, sortRecent, MAX_CARDS_BYTES } from '../lib/store.js'

function makeStore() {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-memory-store-'))
  const store = new ProjectStore(cwd, DEFAULT_CONFIG)
  return { cwd, store, cleanup: () => rmSync(cwd, { recursive: true, force: true }) }
}

const ENV = { sessionId: 'session-a', sessionCwd: 'C:\\proj', toSeq: 10 }
const INPUT = {
  title: '贪吃蛇小游戏',
  tags: ['canvas', '渲染', '小游戏'],
  conclusion: '换 requestAnimationFrame 解决帧率卡顿。',
  digest: '结论：…… 关键坑：setInterval 掉帧，改 rAF 后稳定 60fps。涉及文件：snake.html、game.js。',
  status: 'done',
}

test('ensureDir：创建 memory/ 与自忽略 .gitignore（仅首次）', () => {
  const { store, cleanup } = makeStore()
  try {
    store.ensureDir()
    assert.equal(existsSync(join(store.cwd, 'memory')), true)
    assert.equal(readFileSync(join(store.cwd, 'memory', '.gitignore'), 'utf8'), '*\n!.gitignore\n')
    // 第二次不改写
    writeFileSync(join(store.cwd, 'memory', '.gitignore'), 'custom\n')
    store.ensureDir()
    assert.equal(readFileSync(join(store.cwd, 'memory', '.gitignore'), 'utf8'), 'custom\n')
  } finally {
    cleanup()
  }
})

test('addCard：id 单调递增、首张 fromSeq=0、同会话 fromSeq 接上一张 toSeq', () => {
  const { store, cleanup } = makeStore()
  try {
    const first = store.addCard(INPUT, ENV)
    assert.equal(first.id, 1)
    assert.equal(first.status, 'done')
    assert.deepEqual(first.rawRef, { sessionId: 'session-a', fromSeq: 0, toSeq: 10 })
    assert.match(first.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
    const second = store.addCard(
      { ...INPUT, title: '记账 App 首页', sessionId: undefined },
      { ...ENV, toSeq: 42 },
    )
    assert.equal(second.id, 2)
    assert.deepEqual(second.rawRef, { sessionId: 'session-a', fromSeq: 10, toSeq: 42 })
    assert.equal(store.totalCards(), 2)
  } finally {
    cleanup()
  }
})

test('addCard：不同会话 fromSeq 独立从 0 开始', () => {
  const { store, cleanup } = makeStore()
  try {
    store.addCard(INPUT, ENV)
    const other = store.addCard(INPUT, { sessionId: 'session-b', sessionCwd: 'C:\\proj', toSeq: 5 })
    assert.equal(other.rawRef.fromSeq, 0)
  } finally {
    cleanup()
  }
})

test('updateCard：保留 fromSeq、同会话延伸 toSeq、open→done 更新 sealedAt', () => {
  const { store, cleanup } = makeStore()
  try {
    const card = store.addCard({ ...INPUT, status: 'open' }, ENV)
    assert.equal(card.status, 'open')
    // 把磁盘上的 sealedAt 改成很久以前，验证 open→done 时 sealedAt 被刷新。
    const path = join(store.cwd, 'memory', 'cards.json')
    const file = JSON.parse(readFileSync(path, 'utf8'))
    file.cards[0].sealedAt = '2020-01-01T00:00:00+08:00'
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`)
    const revived = new ProjectStore(store.cwd, DEFAULT_CONFIG)
    const sealedAtBefore = revived.findCard(card.id).sealedAt
    assert.equal(sealedAtBefore, '2020-01-01T00:00:00+08:00')
    const updated = revived.updateCard(card.id, { status: 'done', conclusion: '已完成：可玩。' }, { ...ENV, toSeq: 30 })
    assert.equal(updated.status, 'done')
    assert.equal(updated.conclusion, '已完成：可玩。')
    assert.equal(updated.rawRef.fromSeq, 0)
    assert.equal(updated.rawRef.toSeq, 30)
    assert.notEqual(updated.sealedAt, sealedAtBefore)
    assert.equal(revived.findCard(card.id).status, 'done')
  } finally {
    cleanup()
  }
})

test('updateCard：更新不存在 id 返回 undefined', () => {
  const { store, cleanup } = makeStore()
  try {
    assert.equal(store.updateCard(99, { title: 'x' }, ENV), undefined)
  } finally {
    cleanup()
  }
})

test('deleteCard：彻底删除且 id 不复用', () => {
  const { store, cleanup } = makeStore()
  try {
    const first = store.addCard(INPUT, ENV)
    store.deleteCard(first.id)
    assert.equal(store.findCard(first.id), undefined)
    assert.equal(store.totalCards(), 0)
    const next = store.addCard(INPUT, ENV)
    assert.equal(next.id, 2)
  } finally {
    cleanup()
  }
})

test('readCards：缓存随 mtime/size 失效（外部编辑可读到新内容）', async () => {
  const { store, cleanup } = makeStore()
  try {
    store.addCard(INPUT, ENV)
    assert.equal(store.totalCards(), 1)
    const path = join(store.cwd, 'memory', 'cards.json')
    await new Promise((resolve) => setTimeout(resolve, 5))
    const file = JSON.parse(readFileSync(path, 'utf8'))
    file.cards = []
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`)
    assert.equal(store.totalCards(), 0)
  } finally {
    cleanup()
  }
})

test('readCards：损坏时回退 .bak', () => {
  const { store, cleanup } = makeStore()
  try {
    store.addCard(INPUT, ENV)
    // 再写一张 → cards.json.bak 是上一版（含 1 张卡）
    store.addCard(INPUT, ENV)
    writeFileSync(join(store.cwd, 'memory', 'cards.json'), '{ 坏掉的 json')
    const fresh = new ProjectStore(store.cwd, DEFAULT_CONFIG)
    assert.equal(fresh.totalCards(), 1)
  } finally {
    cleanup()
  }
})

test('readCards：无可用备份时隔离坏文件并以空库继续，后续写入自愈', () => {
  const { store, cleanup } = makeStore()
  try {
    store.ensureDir()
    writeFileSync(join(store.cwd, 'memory', 'cards.json'), 'not json at all')
    const fresh = new ProjectStore(store.cwd, DEFAULT_CONFIG)
    assert.equal(fresh.totalCards(), 0)
    const card = fresh.addCard(INPUT, ENV)
    assert.equal(card.id, 1)
    const persisted = JSON.parse(readFileSync(join(store.cwd, 'memory', 'cards.json'), 'utf8'))
    assert.equal(persisted.cards.length, 1)
  } finally {
    cleanup()
  }
})

test('writeCards：原子写不残留临时文件', () => {
  const { store, cleanup } = makeStore()
  try {
    store.addCard(INPUT, ENV)
    const files = readdirSync(join(store.cwd, 'memory'))
    assert.equal(files.some((name) => name.includes('.tmp-')), false)
  } finally {
    cleanup()
  }
})

test('assertWritable：拒绝 memory/ 之外的写路径', () => {
  const { store, cleanup } = makeStore()
  try {
    assert.throws(() => store.assertWritable(join(store.cwd, 'outside.txt')), /拒绝写入记忆目录之外/)
    store.assertWritable(join(store.cwd, 'memory', 'cards.json'))
  } finally {
    cleanup()
  }
})

test('sortForIndex：open 在前（sealedAt 升序），done 按 sealedAt 倒序', () => {
  const mk = (id, status, sealedAt) => ({
    id,
    title: `t${id}`,
    tags: [],
    conclusion: 'c',
    digest: 'd',
    status,
    createdAt: sealedAt,
    sealedAt,
    updatedAt: sealedAt,
    sessionId: 's',
    sessionCwd: 'c',
    rawRef: { sessionId: 's', fromSeq: 0, toSeq: 1 },
  })
  const cards = [
    mk(1, 'done', '2026-10-01T00:00:00+08:00'),
    mk(2, 'open', '2026-10-03T00:00:00+08:00'),
    mk(3, 'done', '2026-10-02T00:00:00+08:00'),
    mk(4, 'open', '2026-10-02T00:00:00+08:00'),
  ]
  assert.deepEqual(sortForIndex(cards).map((card) => card.id), [4, 2, 3, 1])
  assert.deepEqual(sortRecent(cards).map((card) => card.id), [4, 2, 3, 1])
})

test('MAX_CARDS_BYTES：容量上限为 8MB', () => {
  assert.equal(MAX_CARDS_BYTES, 8 * 1024 * 1024)
})
