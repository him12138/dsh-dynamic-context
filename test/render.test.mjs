import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG } from '../lib/config.js'
import {
  GUIDE_TEXT,
  PERSONA_INTRO,
  indexLine,
  rawChunkFooter,
  rawChunkHeader,
  renderCardList,
  renderCardOpen,
  renderGuideSection,
  renderIndex,
  renderPersonaSection,
  renderSearchResults,
  statusLabel,
} from '../lib/render.js'

function card(overrides = {}) {
  return {
    id: 1,
    title: '贪吃蛇小游戏',
    tags: ['canvas', '渲染', '小游戏'],
    conclusion: '换 requestAnimationFrame 解决帧率卡顿。',
    digest: '结论：…… 关键坑：setInterval 掉帧，改 rAF 后稳定 60fps。涉及文件：snake.html、game.js。',
    status: 'done',
    createdAt: '2026-10-30T10:00:00+08:00',
    sealedAt: '2026-10-30T10:40:00+08:00',
    updatedAt: '2026-10-30T10:40:00+08:00',
    sessionId: 'session-xxxx',
    sessionCwd: 'C:\\project',
    rawRef: { sessionId: 'session-xxxx', fromSeq: 1200, toSeq: 1345 },
    ...overrides,
  }
}

const CONFIG = { ...DEFAULT_CONFIG, maxPersonaChars: 40 }

test('renderPersonaSection：缺失/空文件不注入', () => {
  assert.equal(renderPersonaSection(null, CONFIG), '')
  assert.equal(renderPersonaSection('   ', CONFIG), '')
})

test('renderPersonaSection：正常注入带前缀', () => {
  const text = '# 人设\n叫我老王。'
  const rendered = renderPersonaSection(text, CONFIG)
  assert.equal(rendered, `${PERSONA_INTRO}\n${text}`)
})

test('renderPersonaSection：超限截断并提示（不修改文件）', () => {
  const long = '规则'.repeat(30) // 60 字 > 40
  const rendered = renderPersonaSection(long, CONFIG)
  assert.match(rendered, /已截断/)
  assert.equal(rendered.split('\n')[1], '规则'.repeat(20))
})

test('renderGuideSection：可配置关闭、人设上限文案随配置替换', () => {
  assert.equal(renderGuideSection({ ...DEFAULT_CONFIG, enableGuide: false }), '')
  const text = renderGuideSection(DEFAULT_CONFIG)
  assert.equal(text, GUIDE_TEXT)
  assert.match(text, /memory_seal/)
  assert.match(text, /memory_raw/)
  assert.match(text, /memory_persona/)
  const widened = renderGuideSection({ ...DEFAULT_CONFIG, maxPersonaChars: 5000 })
  assert.match(widened, /5000 字/)
  assert.doesNotMatch(widened, /3000 字/)
})

test('renderIndex：空态文案固定', () => {
  const text = renderIndex([], CONFIG, { pendingEnd: false, personaMissing: false })
  assert.equal(text, '【项目记忆】共 0 条任务；完成任务后会自动记录。')
})

test('renderIndex：最近卡片按 open 优先、done 倒序，含头部总数与导航', () => {
  const cards = [
    card({ id: 1, title: '旧任务', status: 'done', sealedAt: '2026-10-01T00:00:00+08:00' }),
    card({ id: 2, title: '新任务', status: 'done', sealedAt: '2026-10-03T00:00:00+08:00' }),
    card({ id: 3, title: '进行中任务', status: 'open', sealedAt: '2026-10-02T00:00:00+08:00' }),
  ]
  const text = renderIndex(cards, CONFIG, { pendingEnd: false, personaMissing: false })
  const lines = text.split('\n')
  assert.match(lines[0], /最近 3 条任务（共 3 条；可用 memory_search 检索、memory_open 看摘要、memory_raw 看原话）/)
  assert.match(lines[1], /^#3 \[进行中\] 进行中任务 · 标签: canvas,渲染,小游戏 · 结论: /)
  assert.match(lines[2], /^#2 \[完成\] 新任务/)
  assert.match(lines[3], /^#1 \[完成\] 旧任务/)
})

test('renderIndex：只显示 recentCards 条', () => {
  const cards = Array.from({ length: 8 }, (_value, index) =>
    card({ id: index + 1, title: `任务${index + 1}`, sealedAt: `2026-10-0${index + 1}T00:00:00+08:00` }),
  )
  const text = renderIndex(cards, { ...CONFIG, recentCards: 3 }, { pendingEnd: false, personaMissing: false })
  const lines = text.split('\n')
  assert.equal(lines.length, 4)
  assert.match(lines[1], /^#8 /)
  assert.match(lines[3], /^#6 /)
})

test('renderIndex：pendingEnd 与人设缺失提示行', () => {
  const text = renderIndex([card()], CONFIG, { pendingEnd: true, personaMissing: true })
  assert.match(text, /【待办】用户已请求结束当前任务，请尽快调用 memory_seal 写卡片。/)
  assert.match(text, /【提示】尚未设置人设文档/)
  const noHint = renderIndex([card()], { ...CONFIG, enablePersonaHint: false }, { pendingEnd: false, personaMissing: true })
  assert.doesNotMatch(noHint, /尚未设置人设文档/)
})

test('renderIndex：超预算从最旧开始丢弃并加省略号，且不超 maxIndexChars', () => {
  const cards = Array.from({ length: 6 }, (_value, index) =>
    card({
      id: index + 1,
      title: `很长的任务标题第${index + 1}号`,
      tags: ['标签一', '标签二', '标签三'],
      conclusion: '这是一句比较长的结论用于撑大索引文本占用预算。',
      sealedAt: `2026-10-0${index + 1}T00:00:00+08:00`,
    }),
  )
  const config = { ...CONFIG, maxIndexChars: 160 }
  const text = renderIndex(cards, config, { pendingEnd: false, personaMissing: false })
  assert.equal([...text].length <= 160, true)
  assert.match(text, /…/)
})

test('renderIndex：头部总数不受显示条数影响', () => {
  const cards = Array.from({ length: 7 }, (_value, index) => card({ id: index + 1 }))
  const text = renderIndex(cards, { ...CONFIG, recentCards: 2 }, { pendingEnd: false, personaMissing: false })
  assert.match(text.split('\n')[0], /最近 2 条任务（共 7 条/)
})

test('indexLine：无标签时用“无”', () => {
  assert.equal(indexLine(card({ tags: [] })), '#1 [完成] 贪吃蛇小游戏 · 标签: 无 · 结论: 换 requestAnimationFrame 解决帧率卡顿。')
})

test('statusLabel：open=进行中 / done=完成', () => {
  assert.equal(statusLabel('open'), '进行中')
  assert.equal(statusLabel('done'), '完成')
})

test('renderCardList：行格式与空态', () => {
  assert.equal(renderCardList([]), '暂无任务卡片（共 0 条）。')
  const text = renderCardList([card(), card({ id: 2, title: '记账 App 首页', conclusion: '抽离表单校验 hook。' })])
  assert.equal(
    text,
    '#1 [完成] 贪吃蛇小游戏 · 结论: 换 requestAnimationFrame 解决帧率卡顿。 · 2026-10-30\n' +
      '#2 [完成] 记账 App 首页 · 结论: 抽离表单校验 hook。 · 2026-10-30',
  )
})

test('renderSearchResults：行格式与未命中文案', () => {
  assert.equal(renderSearchResults([]), '未找到匹配卡片。')
  assert.equal(
    renderSearchResults([card()]),
    '#1 [完成] 贪吃蛇小游戏 · 标签: canvas,渲染,小游戏 · 结论: 换 requestAnimationFrame 解决帧率卡顿。',
  )
})

test('renderCardOpen：摘要 + 元信息 + 原话可读性', () => {
  const available = renderCardOpen(card(), true)
  assert.match(available, /^#1 贪吃蛇小游戏（完成，2026-10-30）/)
  assert.match(available, /标签：canvas, 渲染, 小游戏/)
  assert.match(available, /摘要：结论：……/)
  assert.match(available, /原话：可用 memory_raw 查看（会话记录存在）。/)
  const unavailable = renderCardOpen(card({ status: 'open' }), false)
  assert.match(unavailable, /进行中/)
  assert.match(unavailable, /原话：原话不可用（会话记录已删除或不可读）；摘要仍可用。/)
})

test('rawChunkHeader/Footer：默认最新片段、克制回溯提示', () => {
  assert.match(rawChunkHeader(card(), 0), /最新片段/)
  assert.match(rawChunkHeader(card(), 2000), /更早片段/)
  assert.match(rawChunkFooter(4000, true), /cursor=4000/)
  assert.match(rawChunkFooter(4000, false), /已到该任务区间开头/)
})

test('GUIDE_TEXT：长度在预算量级（不逐轮变化）', () => {
  assert.equal([...GUIDE_TEXT].length < 600, true)
  assert.equal(renderGuideSection(DEFAULT_CONFIG), GUIDE_TEXT)
})
