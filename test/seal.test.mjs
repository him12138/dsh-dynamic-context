import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG } from '../lib/config.js'
import { normalizeSealArgs } from '../lib/seal.js'

const CONFIG = { ...DEFAULT_CONFIG }

const VALID = {
  title: '贪吃蛇小游戏',
  tags: ['canvas', '渲染', '小游戏'],
  conclusion: '换 requestAnimationFrame 解决帧率卡顿。',
  digest:
    '结论：换 requestAnimationFrame 后帧率稳定 60fps，游戏已可玩。关键坑：setInterval 定时器导致掉帧与输入延迟。涉及文件：snake.html、game.js。',
}

test('normalizeSealArgs：合法输入原样通过，无提示', () => {
  const result = normalizeSealArgs(VALID, CONFIG)
  assert.equal(result.ok, true)
  assert.equal(result.cardId, undefined)
  assert.deepEqual(result.hints, [])
  assert.equal(result.input.title, VALID.title)
  assert.deepEqual(result.input.tags, VALID.tags)
  assert.equal(result.input.status, 'done')
})

test('normalizeSealArgs：title 超 20 字截断并提示', () => {
  const result = normalizeSealArgs({ ...VALID, title: '这是一个超过二十个汉字的超长卡片标题用于测试截断行为是否生效' }, CONFIG)
  assert.equal(result.ok, true)
  assert.equal([...result.input.title].length, 20)
  assert.match(result.hints.join(), /标题超过 20 字/)
})

test('normalizeSealArgs：标签不足 3 个补“未分类”，超过 5 个截断', () => {
  const fewer = normalizeSealArgs({ ...VALID, tags: ['canvas'] }, CONFIG)
  assert.equal(fewer.ok, true)
  assert.equal(fewer.input.tags.length >= 3, true)
  assert.equal(fewer.input.tags.includes('未分类'), true)
  assert.match(fewer.hints.join(), /标签不足 3 个/)
  const many = normalizeSealArgs({ ...VALID, tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, CONFIG)
  assert.equal(many.ok, true)
  assert.equal(many.input.tags.length, 5)
  assert.match(many.hints.join(), /标签超过 5 个/)
})

test('normalizeSealArgs：标签去重、超 16 字截断', () => {
  const result = normalizeSealArgs(
    { ...VALID, tags: ['同一个标签', '同一个标签', '这是一个超过十六个字的标签名称会被截断掉', 'x'] },
    CONFIG,
  )
  assert.equal(result.ok, true)
  assert.equal(new Set(result.input.tags).size, result.input.tags.length)
  assert.match(result.hints.join(), /标签超过 16 字/)
})

test('normalizeSealArgs：conclusion 超 40 字截断并提示', () => {
  const long = '结论'.repeat(30) // 60 字
  const result = normalizeSealArgs({ ...VALID, conclusion: long }, CONFIG)
  assert.equal(result.ok, true)
  assert.equal([...result.input.conclusion].length, 40)
  assert.match(result.hints.join(), /结论超过 40 字/)
})

test('normalizeSealArgs：摘要超 digestMaxChars 截断并提示', () => {
  const long = '摘要'.repeat(200) // 400 字 > 320
  const result = normalizeSealArgs({ ...VALID, digest: long }, CONFIG)
  assert.equal(result.ok, true)
  assert.equal([...result.input.digest].length, CONFIG.digestMaxChars)
  assert.match(result.hints.join(), /摘要超过 320 字/)
})

test('normalizeSealArgs：摘要超长时切在句末，不留断头句', () => {
  const long = `结论：${'甲'.repeat(100)}。${'乙'.repeat(100)}。${'丙'.repeat(200)}。`
  const result = normalizeSealArgs({ ...VALID, digest: long }, CONFIG)
  assert.equal(result.ok, true)
  const digest = result.input.digest
  assert.ok([...digest].length <= CONFIG.digestMaxChars)
  assert.equal(digest.endsWith('。'), true)
  assert.equal(digest.includes('丙'), false, '超上限的尾部内容应被切掉')
  assert.match(result.hints.join(), /已在句末截断/)
})

test('normalizeSealArgs：结论超长时切在句末', () => {
  const long = `${'甲'.repeat(30)}。${'乙'.repeat(60)}。`
  const result = normalizeSealArgs({ ...VALID, conclusion: long }, CONFIG)
  assert.equal(result.ok, true)
  const conclusion = result.input.conclusion
  assert.ok([...conclusion].length <= 40)
  assert.equal(conclusion.endsWith('。'), true)
  assert.match(result.hints.join(), /结论超过 40 字/)
})

test('normalizeSealArgs：摘要过短给建议提示（不拒收）', () => {
  const result = normalizeSealArgs({ ...VALID, digest: '太短了。' }, CONFIG)
  assert.equal(result.ok, true)
  assert.match(result.hints.join(), /摘要偏短/)
})

test('normalizeSealArgs：缺少必填字段拒收并给字段名', () => {
  for (const field of ['title', 'conclusion', 'digest']) {
    const args = { ...VALID }
    delete args[field]
    const result = normalizeSealArgs(args, CONFIG)
    assert.equal(result.ok, false)
    assert.match(result.message, new RegExp(`${field} 必填`))
  }
  const noTags = { ...VALID }
  delete noTags.tags
  const result = normalizeSealArgs(noTags, CONFIG)
  assert.equal(result.ok, false)
  assert.match(result.message, /tags 必填/)
})

test('normalizeSealArgs：空白标题/标签拒收', () => {
  const result = normalizeSealArgs({ ...VALID, title: '   ', tags: ['  '] }, CONFIG)
  assert.equal(result.ok, false)
  assert.match(result.message, /title 必填/)
})

test('normalizeSealArgs：status 合法值生效、非法值提示并按默认 done', () => {
  const open = normalizeSealArgs({ ...VALID, status: 'open' }, CONFIG)
  assert.equal(open.input.status, 'open')
  assert.equal(open.patch.status, 'open')
  const invalid = normalizeSealArgs({ ...VALID, status: 'doing' }, CONFIG)
  assert.equal(invalid.input.status, 'done')
  assert.match(invalid.hints.join(), /status 只能是 done 或 open/)
})

test('normalizeSealArgs：cardId 支持数字与数字字符串，非法值拒收', () => {
  assert.equal(normalizeSealArgs({ ...VALID, cardId: 12 }, CONFIG).cardId, 12)
  assert.equal(normalizeSealArgs({ ...VALID, cardId: '12' }, CONFIG).cardId, 12)
  const zero = normalizeSealArgs({ ...VALID, cardId: 0 }, CONFIG)
  assert.equal(zero.ok, false)
  assert.match(zero.message, /cardId 必须是正整数/)
  const negative = normalizeSealArgs({ ...VALID, cardId: -3 }, CONFIG)
  assert.equal(negative.ok, false)
})

test('normalizeSealArgs：非对象参数拒收（不抛错）', () => {
  for (const raw of [null, undefined, 42, 'x', []]) {
    const result = normalizeSealArgs(raw, CONFIG)
    assert.equal(result.ok, false)
    assert.equal(typeof result.message, 'string')
  }
})

test('normalizeSealArgs：patch 只含模型给出的字段（无 status 时更新不改状态）', () => {
  const result = normalizeSealArgs(VALID, CONFIG)
  assert.equal(result.ok, true)
  assert.equal(Object.hasOwn(result.patch, 'status'), false)
  assert.equal(result.patch.title, VALID.title)
})

test('normalizeSealArgs：emoji 按码点计数（20 个 emoji 不截断）', () => {
  const emojiTitle = '🐍'.repeat(20)
  const result = normalizeSealArgs({ ...VALID, title: emojiTitle }, CONFIG)
  assert.equal(result.ok, true)
  assert.equal(result.input.title, emojiTitle)
  assert.doesNotMatch(result.hints.join(), /标题超过/)
})
