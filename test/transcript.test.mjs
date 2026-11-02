/**
 * dsh-memory transcript（原话读取/渲染/分片）单测。
 *
 * 测编译产物 `../lib/transcript.js`；覆盖 `.notes/CONTRACTS.md` 第 4 节列出的
 * transcript 用例：区间过滤、四类事件渲染、截断、未知 data 回退、单条坏数据跳过、
 * slice 首/中/末段、emoji 不切半、readSession 抛错降级、fromSeq>=toSeq 回退 200 条。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  renderTranscript,
  sliceLatest,
  readRawTranscript,
  probeRawAvailable,
} from '../lib/transcript.js'

// --- 测试数据构造（形状对齐 DSH SessionEventMap） -------------------------

/** user/message 的 data 是 UserMessage 本体。 */
function userEvent(seq, text) {
  return {
    seq,
    type: 'user/message',
    time: 1_700_000_000_000 + seq,
    data: {
      id: `m-user-${seq}`,
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    },
  }
}

/** assistant/message 的 data 是 { message: AssistantMessage, ... } 包装。 */
function assistantEvent(seq, text) {
  return {
    seq,
    type: 'assistant/message',
    time: 1_700_000_000_000 + seq,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: `m-assistant-${seq}`,
        role: 'assistant',
        content: [{ type: 'text', text }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      },
      stream: [],
    },
  }
}

/** tool/call 的 data：{ turn, step, callId, name, arguments(JSON 字符串) }。 */
function toolCallEvent(seq, name, args) {
  return {
    seq,
    type: 'tool/call',
    time: 1_700_000_000_000 + seq,
    data: { turn: 1, step: 1, callId: `call-${seq}`, name, arguments: args },
  }
}

/** tool/result 的 data：{ turn, step, message: ToolResultMessage }。 */
function toolResultEvent(seq, blocks) {
  return {
    seq,
    type: 'tool/result',
    time: 1_700_000_000_000 + seq,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: `m-tool-${seq}`,
        role: 'tool',
        toolCallId: `call-${seq}`,
        content: blocks,
        source: { kind: 'tool', name: 'bash' },
      },
    },
  }
}

/** 待测的假 reader：readSession 返回给定会话。 */
function staticReader(events) {
  return {
    async readSession(id) {
      return { session: { id, cwd: 'C:/work/demo' }, events }
    },
  }
}

/** 检测文本里是否存在落单代理（split surrogate pair）。 */
function hasLoneSurrogate(text) {
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      i += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true
    }
  }
  return false
}

// --- renderTranscript：区间过滤、顺序、格式 --------------------------------

test('renderTranscript 区间过滤：fromSeq 排除、toSeq 包含', () => {
  const events = [1, 2, 3, 4, 5, 6].map((seq) => userEvent(seq, `消息${seq}`))

  const text = renderTranscript(events, 2, 5)

  assert.equal(text, '用户：消息3\n用户：消息4\n用户：消息5')
  // fromSeq 恰恰等于 seq 时被排除；toSeq 等于 seq 时被包含。
  assert.equal(renderTranscript(events, 6, 6), '')
})

test('renderTranscript 四类事件按 seq 时间序渲染（输入乱序也归一）', () => {
  const events = [
    toolResultEvent(4, [{ type: 'text', text: '文件A' }]),
    userEvent(1, '你好'),
    assistantEvent(2, '收到'),
    toolCallEvent(3, 'bash', '{"command":"ls"}'),
  ]

  const text = renderTranscript(events, 0, 10)

  assert.equal(
    text,
    [
      '用户：你好',
      '助手：收到',
      '[工具调用 bash] {"command":"ls"}',
      '[工具结果] 文件A',
    ].join('\n'),
  )
})

test('renderTranscript 消息多 text 块按换行连接，其它事件类型跳过', () => {
  const events = [
    {
      seq: 1,
      type: 'user/message',
      data: {
        id: 'm1',
        role: 'user',
        content: [
          { type: 'text', text: '第一段' },
          { type: 'text', text: '第二段' },
        ],
      },
    },
    { seq: 2, type: 'turn/start', data: { turn: 1 } },
    { seq: 3, type: 'request/header', data: { header: {} } },
    assistantEvent(4, '好的'),
  ]

  assert.equal(renderTranscript(events, 0, 10), '用户：第一段\n第二段\n助手：好的')
})

// --- renderTranscript：截断 ------------------------------------------------

test('renderTranscript 工具参数截断 200 字、工具结果文本截断 400 字', () => {
  const events = [
    toolCallEvent(1, 'bash', 'a'.repeat(500)),
    toolResultEvent(2, [{ type: 'text', text: 'b'.repeat(900) }]),
    userEvent(3, 'c'.repeat(1000)),
  ]

  const [callLine, resultLine, messageLine] = renderTranscript(events, 0, 10).split('\n')

  assert.equal(callLine, `[工具调用 bash] ${'a'.repeat(200)}`)
  assert.equal(resultLine, `[工具结果] ${'b'.repeat(400)}`)
  // 消息正文不截断（单次总量由 sliceLatest 的 chunkChars 控制）。
  assert.equal(messageLine, `用户：${'c'.repeat(1000)}`)
})

test('renderTranscript 截断按码点计，emoji 不切半', () => {
  const events = [
    toolCallEvent(1, 'bash', '😀'.repeat(250)),
    toolResultEvent(2, [{ type: 'text', text: '🎉'.repeat(500) }]),
  ]

  const [callLine, resultLine] = renderTranscript(events, 0, 10).split('\n')
  const callArg = callLine.slice('[工具调用 bash] '.length)
  const resultText = resultLine.slice('[工具结果] '.length)

  assert.equal(callArg, '😀'.repeat(200))
  assert.equal(resultText, '🎉'.repeat(400))
  assert.equal(hasLoneSurrogate(callLine), false)
  assert.equal(hasLoneSurrogate(resultLine), false)
})

// --- renderTranscript：未知 data / 坏数据 / 图片 ---------------------------

test('renderTranscript 未知 data 形状回退 JSON.stringify 截断 300 字', () => {
  const assistantPayload = { payload: 'z'.repeat(400) }
  const events = [
    { seq: 1, type: 'user/message', data: { weird: true } },
    { seq: 2, type: 'assistant/message', data: assistantPayload },
    { seq: 3, type: 'tool/result', data: { foo: 'bar' } },
    { seq: 4, type: 'tool/call', data: 'oops' },
  ]

  const [userLine, assistantLine, resultLine, callLine] = renderTranscript(
    events,
    0,
    10,
  ).split('\n')

  assert.equal(userLine, '用户：{"weird":true}')
  assert.equal(
    assistantLine,
    `助手：${JSON.stringify(assistantPayload).slice(0, 300)}`,
  )
  assert.equal(resultLine, '[工具结果] {"foo":"bar"}')
  assert.equal(callLine, '[工具调用 未知工具] "oops"')
})

test('renderTranscript 单条坏数据跳过、不中断整段原话', () => {
  const circular = {}
  circular.self = circular
  const throwingEvent = { seq: 4, type: 'user/message' }
  Object.defineProperty(throwingEvent, 'data', {
    get() {
      throw new Error('boom')
    },
  })

  const events = [
    userEvent(1, '一'),
    null, // 非对象事件（防御式）
    throwingEvent,
    { seq: 5, type: 'turn/start', data: { turn: 1 } },
    { seq: 6, type: 'assistant/message', data: circular }, // JSON 兜底也失败 → 跳过
    userEvent(7, '七'),
  ]

  assert.equal(renderTranscript(events, 0, 10), '用户：一\n用户：七')
})

test('renderTranscript 工具结果只有图片/附件块 → [图片/附件]', () => {
  const events = [
    toolResultEvent(1, [
      { type: 'image', data: 'base64...', mimeType: 'image/png' },
    ]),
    toolResultEvent(2, [{ type: 'text', text: '说明' }, { type: 'file', path: 'a.pdf' }]),
    toolResultEvent(3, []),
  ]

  assert.equal(
    renderTranscript(events, 0, 10),
    ['[工具结果] [图片/附件]', '[工具结果] 说明', '[工具结果]'].join('\n'),
  )
})

// --- sliceLatest：分片、cursor、hasMore -----------------------------------

test('sliceLatest 首段/中段/末段：cursor、hasMore、totalChars、nextCursor 递推', () => {
  const full = 'abcdefghij'

  const first = sliceLatest(full, 0, 4)
  assert.deepEqual(first, {
    text: 'ghij',
    nextCursor: 4,
    hasMore: true,
    totalChars: 10,
  })

  const middle = sliceLatest(full, first.nextCursor, 4)
  assert.deepEqual(middle, {
    text: 'cdef',
    nextCursor: 8,
    hasMore: true,
    totalChars: 10,
  })

  const last = sliceLatest(full, middle.nextCursor, 4)
  assert.deepEqual(last, {
    text: 'ab',
    nextCursor: 10,
    hasMore: false,
    totalChars: 10,
  })

  // 逐段回溯拼接 = 原文。
  assert.equal([last.text, middle.text, first.text].join(''), full)
})

test('sliceLatest 空串/超长 cursor 边界', () => {
  assert.deepEqual(sliceLatest('', 0, 10), {
    text: '',
    nextCursor: 0,
    hasMore: false,
    totalChars: 0,
  })
  assert.deepEqual(sliceLatest('abc', 99, 10), {
    text: '',
    nextCursor: 99,
    hasMore: false,
    totalChars: 3,
  })
})

test('sliceLatest 不切割 surrogate pair（emoji 不切半）', () => {
  const full = 'A😀B' // UTF-16: 'A', 高代理, 低代理, 'B'

  // chunkChars=2 时首个切片恰好会切到 emoji 中间，安全回退成完整字符。
  const first = sliceLatest(full, 0, 2)
  const second = sliceLatest(full, first.nextCursor, 2)
  const third = sliceLatest(full, second.nextCursor, 2)

  assert.equal(first.text, 'B')
  assert.equal(second.text, '😀')
  assert.equal(third.text, 'A')
  assert.equal(first.nextCursor, 1)
  assert.equal(second.nextCursor, 3)
  assert.equal(third.nextCursor, 4)
  assert.equal(first.hasMore, true)
  assert.equal(second.hasMore, true)
  assert.equal(third.hasMore, false)
  for (const chunk of [first, second, third]) {
    assert.equal(hasLoneSurrogate(chunk.text), false)
  }
  assert.equal([third.text, second.text, first.text].join(''), full)

  // 人为传入切在代理对中间的 cursor：同样不得返回落单代理。
  const arbitrary = sliceLatest(full, 2, 10)
  assert.equal(hasLoneSurrogate(arbitrary.text), false)
  assert.equal(arbitrary.text, 'A')
})

// --- readRawTranscript：正常路径与分片 ------------------------------------

test('readRawTranscript 正常读取：eventCount/renderedChars/slice 递推', async () => {
  const events = [userEvent(1, '一'), assistantEvent(2, '二'), userEvent(3, '三')]
  const reader = staticReader(events)
  const full = '用户：一\n助手：二\n用户：三'

  const first = await readRawTranscript(reader, {
    sessionId: 's1',
    fromSeq: 0,
    toSeq: 3,
    cursor: 0,
    chunkChars: 5,
  })

  assert.equal(first.ok, true)
  assert.equal(first.usedFallbackRange, false)
  assert.equal(first.eventCount, 3)
  assert.equal(first.renderedChars, full.length)
  assert.deepEqual(first.slice, {
    text: '\n用户：三',
    nextCursor: 5,
    hasMore: true,
    totalChars: full.length,
  })

  const second = await readRawTranscript(reader, {
    sessionId: 's1',
    fromSeq: 0,
    toSeq: 3,
    cursor: first.slice.nextCursor,
    chunkChars: 5,
  })
  assert.equal(second.slice.text, '\n助手：二')

  const third = await readRawTranscript(reader, {
    sessionId: 's1',
    fromSeq: 0,
    toSeq: 3,
    cursor: second.slice.nextCursor,
    chunkChars: 5,
  })
  assert.equal(third.slice.text, '用户：一')
  assert.equal(third.slice.hasMore, false)
  assert.equal(third.slice.nextCursor, full.length)
})

// --- readRawTranscript：降级 ----------------------------------------------

test('readRawTranscript readSession 抛错/返回空 → unavailable 固定文案', async () => {
  const expectedMessage = '原话不可用（会话记录已删除或不可读）；摘要仍可用。'
  const readers = [
    {
      async readSession() {
        throw new Error('session deleted')
      },
    },
    {
      readSession() {
        throw new Error('sync boom')
      },
    },
    { async readSession() { return null } },
    { async readSession() { return undefined } },
    { async readSession() { return { events: 'not-an-array' } } },
  ]

  for (const reader of readers) {
    const result = await readRawTranscript(reader, {
      sessionId: 'gone',
      fromSeq: 0,
      toSeq: 10,
      cursor: 0,
      chunkChars: 2000,
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'unavailable')
    assert.equal(result.message, expectedMessage)
    assert.equal(result.slice, undefined)
  }
})

test('readRawTranscript 区间内无可读内容 → empty 固定文案', async () => {
  const expectedMessage =
    '原话区间内没有可读内容（任务区间近似或会话记录已被精简）；摘要仍可用。'

  const emptySession = await readRawTranscript(staticReader([]), {
    sessionId: 's1',
    fromSeq: 0,
    toSeq: 10,
    cursor: 0,
    chunkChars: 2000,
  })
  assert.equal(emptySession.ok, false)
  assert.equal(emptySession.reason, 'empty')
  assert.equal(emptySession.message, expectedMessage)

  // 会话可读，但区间内只有不支持的事件类型。
  const noReadable = await readRawTranscript(
    staticReader([{ seq: 1, type: 'turn/start', data: { turn: 1 } }]),
    { sessionId: 's1', fromSeq: 0, toSeq: 10, cursor: 0, chunkChars: 2000 },
  )
  assert.equal(noReadable.ok, false)
  assert.equal(noReadable.reason, 'empty')
  assert.equal(noReadable.message, expectedMessage)
})

test('readRawTranscript 会话 id/区间非法 → bad-ref（不抛错）', async () => {
  const reader = staticReader([userEvent(1, '一')])
  const base = {
    sessionId: 's1',
    fromSeq: 0,
    toSeq: 10,
    cursor: 0,
    chunkChars: 2000,
  }

  const noId = await readRawTranscript(reader, { ...base, sessionId: '  ' })
  assert.equal(noId.ok, false)
  assert.equal(noId.reason, 'bad-ref')
  assert.match(noId.message, /原话引用无效/)

  const nanRange = await readRawTranscript(reader, {
    ...base,
    fromSeq: Number.NaN,
  })
  assert.equal(nanRange.ok, false)
  assert.equal(nanRange.reason, 'bad-ref')

  const missingRange = await readRawTranscript(reader, {
    ...base,
    toSeq: undefined,
  })
  assert.equal(missingRange.ok, false)
  assert.equal(missingRange.reason, 'bad-ref')
})

// --- readRawTranscript：fromSeq>=toSeq 回退最近 200 条 ---------------------

test('readRawTranscript fromSeq>=toSeq 回退最近 200 条事件', async () => {
  const events = Array.from({ length: 250 }, (_, index) =>
    userEvent(index + 1, `e${index + 1}`),
  )
  const reader = staticReader(events)
  const opts = {
    sessionId: 's1',
    fromSeq: 250,
    toSeq: 100,
    cursor: 0,
    chunkChars: 1_000_000,
  }

  const result = await readRawTranscript(reader, opts)

  assert.equal(result.ok, true)
  assert.equal(result.usedFallbackRange, true)
  assert.equal(result.eventCount, 200)
  const lines = result.slice.text.split('\n')
  assert.equal(lines.length, 200)
  assert.equal(lines[0], '用户：e51')
  assert.equal(lines[199], '用户：e250')
  assert.equal(result.slice.hasMore, false)
  // chunkChars 足够大时一次取完：nextCursor = 已消费的全部长度。
  assert.equal(result.slice.nextCursor, result.renderedChars)
  assert.equal(result.renderedChars, result.slice.text.length)

  // fromSeq 与 toSeq 相等（空区间）同样走回退。
  const equalRange = await readRawTranscript(reader, {
    ...opts,
    fromSeq: 120,
    toSeq: 120,
  })
  assert.equal(equalRange.usedFallbackRange, true)
  assert.equal(equalRange.eventCount, 200)
  assert.equal(equalRange.slice.text.split('\n')[0], '用户：e51')
})

// --- probeRawAvailable -----------------------------------------------------

test('probeRawAvailable：有事件 true，空/抛错/空 id false', async () => {
  assert.equal(await probeRawAvailable(staticReader([userEvent(1, '一')]), 's1'), true)
  assert.equal(await probeRawAvailable(staticReader([]), 's1'), false)
  assert.equal(
    await probeRawAvailable(
      {
        async readSession() {
          throw new Error('gone')
        },
      },
      's1',
    ),
    false,
  )
  assert.equal(await probeRawAvailable(staticReader([userEvent(1, '一')]), ''), false)
})
