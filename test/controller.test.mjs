import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, name, inject } from '../lib/index.js'

/** 构造最小 fake Cordis ctx，记录注册项。 */
function makeCtx(sessions) {
  const state = { sections: [], contexts: [], tools: [], commands: [], disposed: false }
  const off = () => undefined
  const ctx = {
    systemPrompt: {
      section: (section) => {
        state.sections.push(section)
        return off
      },
      context: (context) => {
        state.contexts.push(context)
        return off
      },
    },
    tools: {
      register: (tool) => {
        state.tools.push(tool)
        return off
      },
    },
    commands: {
      register: (command) => {
        state.commands.push(command)
        return off
      },
    },
    sessionQuery: {
      readSession: async (sessionId) => {
        const session = sessions[sessionId]
        if (session === undefined) throw new Error(`session not found: ${sessionId}`)
        return session
      },
    },
    logger: { warn: () => undefined, info: () => undefined },
    on: (event) => {
      if (event === 'dispose') state.disposed = true
      return off
    },
  }
  return { ctx, state }
}

function makeAgent(cwd, sessionId = 'session-1', seq = 100) {
  return { id: sessionId, session: { id: sessionId, header: { id: sessionId, cwd }, seq } }
}

function makeSession(sessionId, cwd) {
  const events = [
    { seq: 0, type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '帮我做个贪吃蛇小游戏' }] } },
    {
      seq: 1,
      type: 'assistant/message',
      data: {
        role: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: '好的，先写 canvas 渲染。' }] },
        stream: [],
      },
    },
    { seq: 2, type: 'tool/call', data: { name: 'write', arguments: JSON.stringify({ path: 'snake.html' }) } },
    { seq: 3, type: 'tool/result', data: { message: { role: 'tool', content: [{ type: 'text', text: '文件已写入 snake.html' }] } } },
    { seq: 4, type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '帧率有点卡' }] } },
    {
      seq: 5,
      type: 'assistant/message',
      data: {
        role: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: '改用 requestAnimationFrame。' }] },
        stream: [],
      },
    },
  ]
  return { session: { id: sessionId, cwd }, events }
}

function newWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-memory-controller-'))
  const sessionId = 'session-1'
  const sessions = { [sessionId]: makeSession(sessionId, cwd) }
  const { ctx, state } = makeCtx(sessions)
  apply(ctx, {})
  const agent = makeAgent(cwd, sessionId, 100)
  const byName = (list, name) => list.find((item) => item.name === name)
  return { cwd, state, agent, sessions, tool: (toolName) => byName(state.tools, toolName), sessionId }
}

const SEAL = {
  title: '贪吃蛇小游戏',
  tags: ['canvas', '渲染', '小游戏'],
  conclusion: '换 requestAnimationFrame 解决帧率卡顿。',
  digest:
    '结论：换 requestAnimationFrame 后帧率稳定 60fps，游戏已可玩。关键坑：setInterval 定时器导致掉帧与输入延迟。涉及文件：snake.html、game.js。',
}

test('插件入口：name/inject 与注册项齐全（3 段/1 上下文/5 工具/1 命令）', () => {
  assert.equal(name, 'dsh-dynamic-context')
  assert.deepEqual(inject, ['systemPrompt', 'tools', 'commands', 'sessionQuery'])
  const { state, cwd } = newWorkspace()
  try {
    assert.deepEqual(state.sections.map((section) => section.name).sort(), ['memory:guide', 'memory:persona'])
    assert.deepEqual(state.contexts.map((context) => context.name), ['memory:index'])
    assert.deepEqual(
      state.tools.map((tool) => tool.name).sort(),
      ['memory_open', 'memory_persona', 'memory_raw', 'memory_seal', 'memory_search'],
    )
    assert.deepEqual(state.commands.map((command) => command.name), ['memory'])
    assert.equal(existsSync(join(cwd, 'memory')), false) // 注入层不应创建目录
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('注入：无人设时人设段为空，索引为空态，规则段存在', () => {
  const { state, agent, cwd } = newWorkspace()
  try {
    const persona = state.sections.find((section) => section.name === 'memory:persona')
    const guide = state.sections.find((section) => section.name === 'memory:guide')
    const index = state.contexts[0]
    assert.equal(persona.text({ agent }), '')
    assert.match(guide.text({ agent }), /memory_seal/)
    assert.equal(index.text({ agent }), '【项目记忆】共 0 条任务；完成任务后会自动记录。\n【提示】尚未设置人设文档（memory/persona.md）；可把长期偏好写进去。')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('memory_seal → 卡片落盘 + 索引/搜索/展开/原话全链路', async () => {
  const { state, agent, cwd, tool } = newWorkspace()
  try {
    const deferred = []
    const sealed = await tool('memory_seal').execute(SEAL, {
      callId: 'call-1',
      name: 'memory_seal',
      arguments: SEAL,
      agent,
      deferContext: (message) => deferred.push(message),
    })
    assert.match(sealed, /已记录 #1「贪吃蛇小游戏」（完成）。当前共 1 条任务。/)
    assert.equal(deferred.length, 1)
    assert.match(deferred[0].content[0].text, /\[记忆\] 卡片 #1「贪吃蛇小游戏」已入目录/)

    const raw = readFileSync(join(cwd, 'memory', 'cards.json'), 'utf8')
    const file = JSON.parse(raw)
    assert.equal(file.schemaVersion, 1)
    assert.equal(file.nextId, 2)
    assert.equal(file.cards[0].rawRef.sessionId, 'session-1')
    assert.equal(file.cards[0].rawRef.fromSeq, 0)
    assert.equal(file.cards[0].rawRef.toSeq, 100)

    const index = state.contexts[0].text({ agent })
    assert.match(index, /最近 1 条任务（共 1 条/)
    assert.match(index, /#1 \[完成\] 贪吃蛇小游戏 · 标签: canvas,渲染,小游戏 · 结论: /)

    const searched = await tool('memory_search').execute({ query: '贪吃蛇 卡顿' }, { agent, callId: 'c2', name: 'memory_search', arguments: {} })
    assert.match(searched, /#1 \[完成\] 贪吃蛇小游戏/)

    const opened = await tool('memory_open').execute({ id: 1 }, { agent, callId: 'c3', name: 'memory_open', arguments: { id: 1 } })
    assert.match(opened, /^#1 贪吃蛇小游戏（完成，\d{4}-\d{2}-\d{2}）/)
    assert.match(opened, /摘要：结论：/)

    const rawText = await tool('memory_raw').execute({ id: 1 }, { agent, callId: 'c4', name: 'memory_raw', arguments: { id: 1 } })
    assert.match(rawText, /原话片段（任务 #1，最新片段）：/)
    assert.match(rawText, /用户：帮我做个贪吃蛇小游戏/)
    assert.match(rawText, /助手：改用 requestAnimationFrame。/)
    assert.match(rawText, /\[工具调用 write\]/)
    assert.match(rawText, /\[工具结果\] 文件已写入 snake.html/)
    assert.match(rawText, /已到该任务区间开头/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('memory_seal：非法输入返回可读错误、不落盘', async () => {
  const { cwd, agent, tool } = newWorkspace()
  try {
    const result = await tool('memory_seal').execute({ title: '只有标题' }, { agent, callId: 'c', name: 'memory_seal', arguments: {} })
    assert.match(result, /未记录：tags 必填/)
    assert.equal(existsSync(join(cwd, 'memory', 'cards.json')), false)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('memory_seal：cardId 更新已有卡片（open→done）并保留原 rawRef.fromSeq', async () => {
  const { agent, cwd, tool } = newWorkspace()
  try {
    await tool('memory_seal').execute({ ...SEAL, status: 'open' }, { agent: makeAgent(cwd, 'session-1', 20), callId: 'c1', name: 'memory_seal', arguments: {} })
    const updated = await tool('memory_seal').execute(
      { ...SEAL, cardId: 1, status: 'done' },
      { agent: makeAgent(cwd, 'session-1', 300), callId: 'c2', name: 'memory_seal', arguments: {} },
    )
    assert.match(updated, /已更新 #1「贪吃蛇小游戏」（完成）。当前共 1 条任务。/)
    const file = JSON.parse(readFileSync(join(cwd, 'memory', 'cards.json'), 'utf8'))
    assert.equal(file.cards[0].status, 'done')
    assert.equal(file.cards[0].rawRef.fromSeq, 0)
    assert.equal(file.cards[0].rawRef.toSeq, 300)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('memory_persona：写入成功、备份旧版本、超限退回、外部引用退回', async () => {
  const { cwd, agent, tool, state } = newWorkspace()
  try {
    const first = await tool('memory_persona').execute({ content: '# 人设\n叫我老王。' }, { agent, callId: 'c1', name: 'memory_persona', arguments: {} })
    assert.match(first, /已更新人设文档（\d+ 字）。下一轮对话生效。/)
    assert.equal(readFileSync(join(cwd, 'memory', 'persona.md'), 'utf8'), '# 人设\n叫我老王。')
    const personaText = state.sections.find((section) => section.name === 'memory:persona').text({ agent })
    assert.match(personaText, /叫我老王/)

    const second = await tool('memory_persona').execute({ content: '# 人设\n以后叫我老王。' }, { agent, callId: 'c2', name: 'memory_persona', arguments: {} })
    assert.match(second, /已备份旧版本/)
    assert.equal(readFileSync(join(cwd, 'memory', 'persona.md.bak'), 'utf8'), '# 人设\n叫我老王。')

    const tooLong = await tool('memory_persona').execute({ content: '长'.repeat(3001) }, { agent, callId: 'c3', name: 'memory_persona', arguments: {} })
    assert.match(tooLong, /超过 3000 字上限/)
    assert.match(tooLong, /归纳压缩/)
    assert.equal(readFileSync(join(cwd, 'memory', 'persona.md'), 'utf8'), '# 人设\n以后叫我老王。')

    const reference = await tool('memory_persona').execute({ content: '规则详见 rules.md' }, { agent, callId: 'c4', name: 'memory_persona', arguments: {} })
    assert.match(reference, /不得引用其他文档|外部文档引用|自包含/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('命令：list/open/forget/end/未知子命令', async () => {
  const { state, agent, cwd, tool } = newWorkspace()
  try {
    const handler = state.commands[0].handler
    await tool('memory_seal').execute(SEAL, { agent, callId: 'c1', name: 'memory_seal', arguments: {} })

    const list = await handler({ agent, rawInput: 'list' })
    assert.equal(list.kind, 'success')
    assert.match(list.text, /#1 \[完成\] 贪吃蛇小游戏 · 结论: .* · \d{4}-\d{2}-\d{2}/)

    const open = await handler({ agent, rawInput: 'open 1' })
    assert.equal(open.kind, 'success')
    assert.match(open.text, /摘要：/)

    const openMissing = await handler({ agent, rawInput: 'open 99' })
    assert.equal(openMissing.kind, 'error')
    assert.match(openMissing.text, /未找到卡片 #99/)

    const end = await handler({ agent, rawInput: 'end' })
    assert.equal(end.kind, 'success')
    assert.match(end.text, /已请求结束当前任务/)
    assert.match(state.contexts[0].text({ agent }), /【待办】用户已请求结束当前任务/)

    // 封存后清除 pendingEnd
    await tool('memory_seal').execute({ ...SEAL, title: '第二个任务' }, { agent, callId: 'c2', name: 'memory_seal', arguments: {} })
    assert.doesNotMatch(state.contexts[0].text({ agent }), /【待办】/)
    assert.equal(state.commands.length, 1)

    const forget = await handler({ agent, rawInput: 'forget 1' })
    assert.equal(forget.kind, 'success')
    assert.match(forget.text, /已删除 #1「贪吃蛇小游戏」，剩余 1 条。/)
    const listAfter = await handler({ agent, rawInput: 'list' })
    assert.doesNotMatch(listAfter.text, /贪吃蛇小游戏/)

    const unknown = await handler({ agent, rawInput: 'bogus' })
    assert.equal(unknown.kind, 'error')
    assert.match(unknown.text, /未知子命令/)

    const usage = await handler({ agent, rawInput: '' })
    assert.equal(usage.kind, 'success')
    assert.match(usage.text, /\/memory list/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('降级：会话不可读时 memory_raw 返回固定降级文案；open 报告原话不可用', async () => {
  const { agent, cwd, tool, sessions } = newWorkspace()
  try {
    // 让卡片引用一个已不存在的会话
    await tool('memory_seal').execute(SEAL, { agent, callId: 'c1', name: 'memory_seal', arguments: {} })
    delete sessions['session-1']
    const raw = await tool('memory_raw').execute({ id: 1 }, { agent, callId: 'c2', name: 'memory_raw', arguments: {} })
    assert.equal(raw, '原话不可用（会话记录已删除或不可读）；摘要仍可用。')
    const open = await tool('memory_open').execute({ id: 1 }, { agent, callId: 'c3', name: 'memory_open', arguments: {} })
    assert.match(open, /原话：原话不可用（会话记录已删除或不可读）；摘要仍可用。/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('常驻索引稳定性：内容和数量不变时文本逐字节相同', async () => {
  const { state, agent, cwd, tool } = newWorkspace()
  try {
    await tool('memory_seal').execute(SEAL, { agent, callId: 'c1', name: 'memory_seal', arguments: {} })
    const first = state.contexts[0].text({ agent })
    const second = state.contexts[0].text({ agent })
    assert.equal(first, second)
    assert.doesNotMatch(first, /\d{4}-\d{2}-\d{2}/) // 索引不出现时间戳
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
