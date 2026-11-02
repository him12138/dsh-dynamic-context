/**
 * dsh-dynamic-context search.ts 单元测试（node:test，测编译产物 ../lib/search.js）。
 *
 * 契约：.notes/CONTRACTS.md §1 + §4（测试要求）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { normalize, bigrams, overlap, scoreCard, searchCards } from '../lib/search.js'

const T0 = '2026-01-01T00:00:00.000Z'

/** 构造卡片（只覆盖测试关心的字段，其余给固定默认值）。 */
function makeCard(over = {}) {
  return {
    id: 1,
    title: '',
    tags: [],
    conclusion: '',
    digest: '',
    status: 'done',
    createdAt: T0,
    sealedAt: T0,
    updatedAt: T0,
    sessionId: 'session-a',
    sessionCwd: 'C:\\proj',
    rawRef: { sessionId: 'session-a', fromSeq: 0, toSeq: 10 },
    ...over,
  }
}

function ids(cards) {
  return cards.map((card) => card.id)
}

test('normalize：小写化并去掉空白/标点/符号，保留汉字/字母/数字', () => {
  assert.equal(normalize('  Hello, 世界！ Node.js  '), 'hello世界nodejs')
  assert.equal(normalize('A B-C_D!?'), 'abcd')
  assert.equal(normalize('   '), '')
  assert.equal(normalize('纯中文，标点。'), '纯中文标点')
  assert.equal(normalize('版本 v0.2'), '版本v02')
  assert.equal(normalize(normalize('Node.JS 测试')), normalize('Node.JS 测试')) // 幂等
})

test('normalize：与契约 regex 实现逐码点等价（全 BMP + 增补平面样本）', () => {
  // 契约 §1 的参考实现（oracle）；normalize 是它的等价快速路径
  const reference = (s) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')

  const samples = [
    '',
    '  Hello, 世界！ Node.js  ',
    'ＡＢＣ１２３', // 全角
    'a\tb\nc\rd\ve\ff',
    '①②③④⑤',
    '—…《》“”‘’',
    '😀emoji😀🎉',
    '𝕏𝕐𝕑', // 增补平面字母（无小写映射）
    'ЖЖ привет',
    '한국어 테스트',
    'ΑΣ ΟΔΟΣ', // 希腊语词尾 sigma（toLowerCase 上下文相关）
    'İstanbul',
    'Straße',
    '\u0000\u0001x\u001f',
    '\u0301\u200d\ufeff',
    '\ud800x', // 孤立高代理项
    'x\udc00', // 孤立低代理项
  ]
  for (const s of samples) assert.equal(normalize(s), reference(s), `样本不一致：${JSON.stringify(s)}`)

  // 逐码点：x + 单个 BMP 字符 + Y（覆盖 \p{P}/\p{S}/\s/字母/数字/控制字符等）
  for (let code = 0; code <= 0xffff; code++) {
    const s = 'x' + String.fromCharCode(code) + 'Y'
    assert.equal(normalize(s), reference(s), `BMP 码点不一致：U+${code.toString(16)}`)
  }

  // 增补平面抽样（emoji、数学字母、CJK 扩展 B、区域指示符）
  for (const codePoint of [0x1f600, 0x1d54f, 0x10400, 0x1f1e6, 0x20000, 0x2fa1d, 0x10ffff]) {
    const s = 'a' + String.fromCodePoint(codePoint) + 'b'
    assert.equal(normalize(s), reference(s), `增补平面码点不一致：U+${codePoint.toString(16)}`)
  }
})

test('bigrams：归一化后按码点取相邻二元组；长度 <2 返回 0/1 个元素', () => {
  assert.deepEqual([...bigrams('贪吃蛇')], ['贪吃', '吃蛇'])
  assert.deepEqual([...bigrams('ab')], ['ab'])
  assert.deepEqual([...bigrams('a')], ['a'])
  assert.equal(bigrams('').size, 0)
  // 标点/空格被归一化掉后跨过它们组成 bigram；大小写不敏感
  assert.deepEqual([...bigrams('A-B')], ['ab'])
  assert.deepEqual([...bigrams('Node.js')], ['no', 'od', 'de', 'ej', 'js'])
})

test('overlap：|交集|/|query|；query 空或 target 空返回 0', () => {
  assert.equal(overlap(new Set(['ab', 'bc']), new Set(['ab'])), 0.5)
  assert.equal(overlap(new Set(['ab']), new Set(['ab', 'cd'])), 1)
  assert.equal(overlap(new Set(['ab']), new Set(['cd'])), 0)
  assert.equal(overlap(new Set(), new Set(['ab'])), 0)
  assert.equal(overlap(new Set(['ab']), new Set()), 0)
})

test('scoreCard：标签精确命中（契约公式两项可叠加）', () => {
  const card = makeCard({ tags: ['alpha'], title: '', conclusion: '', digest: '' })
  // 归一化后 query == tag：tagExactMatch=1 且 tagContains=1 -> 4 + 2.5
  assert.equal(scoreCard(card, 'alpha'), 6.5)
  assert.equal(scoreCard(card, 'ALPHA'), 6.5)
  // 无任何命中 -> 0
  const empty = makeCard()
  assert.equal(scoreCard(empty, 'alpha'), 0)
  assert.equal(scoreCard(card, ''), 0)
  assert.equal(scoreCard(card, '   '), 0)
  assert.equal(scoreCard(card, '！？。'), 0) // 归一化后为空
})

test('scoreCard：标签包含命中 + 无关查询不命中', () => {
  const card = makeCard({ tags: ['贪吃蛇', 'canvas'], title: '画布渲染', conclusion: '', digest: '' })
  // query 包含 tag（"贪吃蛇小游戏" 包含 "贪吃蛇"）
  assert.equal(scoreCard(card, '贪吃蛇小游戏'), 2.5)
  // tag 包含 query（"canvas" 包含 "can"）
  assert.equal(scoreCard(card, 'can'), 2.5)
  // 一切无关
  assert.equal(scoreCard(card, '火星殖民计划'), 0)
})

test('scoreCard：中文 bigram 同时命中 title 与 conclusion', () => {
  const card = makeCard({
    tags: [],
    title: '贪吃蛇小游戏',
    conclusion: '帧率卡顿',
    digest: '',
  })
  const q = '贪吃蛇卡顿'
  // title: 2/4 bigram -> 3*0.5 = 1.5；conclusion: 1/4 -> 2*0.25 = 0.5
  assert.equal(scoreCard(card, q), 2)
  // query 归一化后大小写/标点无关
  assert.equal(scoreCard(card, '贪吃蛇，卡顿！'), 2)
})

test('scoreCard：单字 query 不做 bigram，退化为子串包含匹配', () => {
  const card = makeCard({ title: '贪吃蛇小游戏', conclusion: '帧率卡顿', tags: [] })
  // 若错误地用 bigram，'蛇' 与 title 的 bigram 无交集 -> 0；子串命中 title -> 3
  assert.equal(scoreCard(card, '蛇'), 3)
  // conclusion 子串命中 -> 2；digest 为空 -> 0
  assert.equal(scoreCard(card, '顿'), 2)
})

test('scoreCard：长度 2 的查询正常走 bigram（conclusion 全命中）', () => {
  const card = makeCard({ title: '', conclusion: '帧率卡顿', digest: '', tags: [] })
  // conclusion bigrams: 帧率/率卡/卡顿；query '卡顿' -> 1/1 -> weight 2
  assert.equal(scoreCard(card, '卡顿'), 2)
})

test('searchCards：阈值 score >= 1.0（全命中返回，部分命中低于阈值不返回）', () => {
  const boundary = makeCard({ id: 1, title: '', tags: [], conclusion: '', digest: 'ab' })
  const partial = makeCard({ id: 2, title: '', tags: [], conclusion: '', digest: 'abc' })
  // digest bigram 全命中：1 * |{ab}|/|{ab}| = 1.0
  assert.equal(scoreCard(boundary, 'ab'), 1)
  // query 3 个 bigram 命中 2 个：1 * 2/3
  assert.equal(scoreCard(partial, 'abcd'), 2 / 3)
  assert.deepEqual(ids(searchCards([boundary], 'ab', 10)), [1]) // 恰好 1.0 -> 返回
  assert.deepEqual(ids(searchCards([partial], 'abcd', 10)), []) // 2/3 < 1.0 -> 过滤
})

test('searchCards：无关查询返回空数组', () => {
  const cards = [
    makeCard({ id: 1, title: '贪吃蛇小游戏', tags: ['游戏'], conclusion: '帧率卡顿', digest: '降低绘制频率' }),
    makeCard({ id: 2, title: '数据库迁移', tags: ['后端'], conclusion: '迁移完成', digest: '无损迁移' }),
  ]
  assert.deepEqual(searchCards(cards, '火星殖民计划', 10), [])
})

test('searchCards：空 query 返回最近列表——open 优先（sealedAt 升序）再 done 倒序', () => {
  const cards = [
    makeCard({ id: 1, status: 'open', sealedAt: '2026-03-01T00:00:00.000Z' }),
    makeCard({ id: 2, status: 'open', sealedAt: '2026-01-01T00:00:00.000Z' }),
    makeCard({ id: 3, status: 'done', sealedAt: '2026-05-01T00:00:00.000Z' }),
    makeCard({ id: 4, status: 'done', sealedAt: '2026-04-01T00:00:00.000Z' }),
    makeCard({ id: 5, status: 'done', sealedAt: '2026-02-01T00:00:00.000Z' }),
  ]
  const expected = [2, 1, 3, 4, 5]
  assert.deepEqual(ids(searchCards(cards, undefined, 20)), expected)
  assert.deepEqual(ids(searchCards(cards, '', 20)), expected)
  assert.deepEqual(ids(searchCards(cards, '   \t\n ', 20)), expected)
  // limit 截断
  assert.deepEqual(ids(searchCards(cards, undefined, 3)), [2, 1, 3])
  // limit 0 / 负数 -> 空
  assert.deepEqual(ids(searchCards(cards, undefined, 0)), [])
  assert.deepEqual(ids(searchCards(cards, undefined, -1)), [])
})

test('searchCards：最近列表不修改入参数组', () => {
  const cards = [
    makeCard({ id: 1, status: 'done', sealedAt: '2026-05-01T00:00:00.000Z' }),
    makeCard({ id: 2, status: 'open', sealedAt: '2026-01-01T00:00:00.000Z' }),
    makeCard({ id: 3, status: 'done', sealedAt: '2026-02-01T00:00:00.000Z' }),
  ]
  const before = cards.map((card) => card.id)
  searchCards(cards, undefined, 20)
  searchCards(cards, '任意查询', 20)
  assert.deepEqual(cards.map((card) => card.id), before)
})

test('searchCards：结果按 score 降序，同分按 sealedAt 降序，再按 id 降序', () => {
  const cards = [
    makeCard({ id: 1, tags: ['alpha'], sealedAt: '2026-01-01T00:00:00.000Z' }),
    makeCard({ id: 2, tags: ['alpha'], sealedAt: '2026-02-01T00:00:00.000Z' }),
    makeCard({ id: 3, tags: ['alpha'], sealedAt: '2026-02-01T00:00:00.000Z' }),
  ]
  // 三张卡同分：sealedAt 新的在前；同 sealedAt 时 id 大的在前
  assert.deepEqual(ids(searchCards(cards, 'alpha', 10)), [3, 2, 1])
})

test('searchCards：标签精确匹配排在仅包含匹配之前', () => {
  const partial = makeCard({ id: 1, tags: ['alpha beta'], sealedAt: T0 })
  const exact = makeCard({ id: 2, tags: ['alpha'], sealedAt: T0 })
  const cards = [partial, exact]
  assert.deepEqual(ids(searchCards(cards, 'alpha', 10)), [2, 1])
  assert.ok(scoreCard(exact, 'alpha') > scoreCard(partial, 'alpha'))
})

test('searchCards：limit 截断匹配结果，且不改动入参', () => {
  const cards = [
    makeCard({ id: 1, tags: ['alpha'], sealedAt: '2026-01-01T00:00:00.000Z' }),
    makeCard({ id: 2, tags: ['alpha'], sealedAt: '2026-01-02T00:00:00.000Z' }),
    makeCard({ id: 3, tags: ['alpha'], sealedAt: '2026-01-03T00:00:00.000Z' }),
  ]
  assert.deepEqual(ids(searchCards(cards, 'alpha', 2)), [3, 2])
  assert.deepEqual(ids(searchCards(cards, 'alpha', 1)), [3])
})

test('searchCards：单字 query 经子串匹配也能检索到（阈值以上）', () => {
  const cards = [
    makeCard({ id: 1, title: '贪吃蛇小游戏', tags: [] }),
    makeCard({ id: 2, title: '数据库迁移', tags: [] }),
  ]
  assert.deepEqual(ids(searchCards(cards, '蛇', 10)), [1])
  assert.deepEqual(ids(searchCards(cards, '库', 10)), [2])
})

test('searchCards：空卡片列表返回空数组', () => {
  assert.deepEqual(searchCards([], 'anything', 10), [])
  assert.deepEqual(searchCards([], undefined, 10), [])
})

test('searchCards：1000 条卡片单次检索 < 50ms（设计要求 < 2ms，测试留余量）', (t) => {
  const base = Date.UTC(2026, 0, 1)
  // 按需求 §6.2 的真实字段长度造数据：标题 ≤20 字、结论 ≤40 字、摘要约 260 字
  const cards = Array.from({ length: 1000 }, (_, i) =>
    makeCard({
      id: i + 1,
      title: `项目${i} 贪吃蛇小游戏 性能优化`,
      tags: [`标签${i % 20}`, '贪吃蛇', '性能优化'],
      conclusion: i % 7 === 0 ? '帧率卡顿已修复，降低绘制频率' : `第${i} 项任务已收尾，结论明确`,
      digest: `第${i}项任务：结论是降低渲染批次；关键坑：Canvas 帧率抖动与 requestAnimationFrame 时序；涉及文件 src/app-${i}.ts、src/render-${i}.ts。`.repeat(2).slice(0, 260),
      sealedAt: new Date(base + i * 86_400_000).toISOString(),
    }),
  )
  // 预热（同时填充 normalize 的码点分类缓存）
  searchCards(cards, '贪吃蛇卡顿', 5)
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    const result = searchCards(cards, '贪吃蛇卡顿', 5)
    const elapsed = performance.now() - start
    if (elapsed < best) best = elapsed
    assert.ok(result.length > 0)
    assert.ok(result.length <= 5)
  }
  t.diagnostic(`1000 条卡片（摘要 260 字）单次检索最优耗时：${best.toFixed(2)}ms（设计目标 < 2ms，测试阈值 < 50ms）`)
  assert.ok(best < 50, `1000 条卡片检索耗时 ${best.toFixed(2)}ms，应 < 50ms`)
})
