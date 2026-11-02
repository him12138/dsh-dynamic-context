/**
 * dsh-memory persona.ts 单元测试（node:test，测编译产物 ../lib/persona.js）。
 *
 * 契约：.notes/CONTRACTS.md §2 + §4（测试要求）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { countChars, checkPersona } from '../lib/persona.js'

const MAX = 3000

test('countChars：按 Unicode 码点计数（emoji 算 1 个字）', () => {
  assert.equal(countChars(''), 0)
  assert.equal(countChars('abc'), 3)
  assert.equal(countChars('中文字'), 3)
  assert.equal(countChars('😀😀'), 2)
  assert.notEqual(countChars('😀😀'), '😀😀'.length) // UTF-16 下 length 为 4
  assert.equal(countChars('a😀中'), 3)
  assert.equal(countChars('字'.repeat(3000)), 3000)
})

test('checkPersona：界内内容通过', () => {
  assert.deepEqual(checkPersona('', MAX), { ok: true })
  assert.deepEqual(checkPersona('叫我老王，默认用中文回答。', MAX), { ok: true })
  assert.deepEqual(checkPersona('字'.repeat(3000), MAX), { ok: true }) // 恰好 maxChars 通过
})

test('checkPersona：超过 maxChars -> too-long，message 固定文案', () => {
  const result = checkPersona('字'.repeat(3001), MAX)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'too-long')
  assert.equal(result.length, 3001)
  assert.equal(typeof result.message, 'string')
  assert.ok(result.message.includes('3001 字'))
  assert.ok(result.message.includes('3000 字上限'))
  assert.ok(result.message.includes('归纳压缩'))
  assert.ok(result.message.includes('不要提交超长内容等待截断'))
  assert.ok(result.message.includes('未写入'))
  // 边界：maxChars + 1 too-long；maxChars 通过
  const small = checkPersona('字'.repeat(11), 10)
  assert.equal(small.ok, false)
  assert.equal(small.code, 'too-long')
  assert.equal(small.length, 11)
  assert.deepEqual(checkPersona('字'.repeat(10), 10), { ok: true })
})

test('checkPersona：too-long 优先于 reference（长度兜底先执行）', () => {
  const content = `详见 ${'a'.repeat(20)}.md` // 命中引用且超长
  const result = checkPersona(content, 5)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'too-long')
  assert.equal(result.length, countChars(content))
})

test('checkPersona：第 1 类引用（markdown 文件链接）命中 -> reference', () => {
  const content = '# 写作偏好\n参见 [写作规范](docs/writing.md) 执行。'
  const result = checkPersona(content, MAX)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'reference')
  assert.equal(result.length, countChars(content))
  assert.ok(Array.isArray(result.hits))
  assert.ok(result.hits.length >= 1 && result.hits.length <= 3)
  assert.ok(result.hits.some((hit) => hit.includes('writing.md')))
  assert.ok(result.message.includes('自包含'))
  assert.ok(result.message.includes('删除对文件/附件的引用'))
})

test('checkPersona：第 2 类引用（裸文件名/路径）命中 -> reference', () => {
  for (const content of [
    '默认参考 architecture.txt 的约定。',
    '完整规则见 C:\\proj\\docs\\spec.docx。',
    '实现细节参考 src/guide.md。',
    '规范文件 SPEC.MD 优先。',
  ]) {
    const result = checkPersona(content, MAX)
    assert.equal(result.ok, false, `应命中引用：${content}`)
    assert.equal(result.code, 'reference')
    assert.ok(result.hits.length >= 1)
    assert.ok(result.hits.some((hit) => /\.(md|txt|pdf|docx?)/i.test(hit)), `hits 应包含文件名：${result.hits}`)
  }
})

test('checkPersona：第 3 类引用（引用措辞 + 文件名）命中 -> reference', () => {
  for (const content of [
    '需要时参见《团队规范.pdf》第 3 节。',
    '详见 design.doc 里的说明。',
    '使用方法参考 usage.txt。',
  ]) {
    const result = checkPersona(content, MAX)
    assert.equal(result.ok, false, `应命中引用：${content}`)
    assert.equal(result.code, 'reference')
    assert.ok(result.hits.some((hit) => /\.(md|txt|pdf|docx?)/i.test(hit)))
  }
})

test('checkPersona：第 4 类引用（附件）命中 -> reference', () => {
  for (const content of ['细节见附件。', '完整内容在附件2中。', '附件：需求清单']) {
    const result = checkPersona(content, MAX)
    assert.equal(result.ok, false, `应命中附件：${content}`)
    assert.equal(result.code, 'reference')
    assert.ok(result.hits.some((hit) => hit.includes('附件')), `hits 应包含附件：${result.hits}`)
  }
})

test('checkPersona：正常文本通过（中文标点、普通 URL、技术名词）', () => {
  const content = [
    '# 称呼',
    '- 叫我老王。',
    '- 默认用中文回答；先给结论，再解释。',
    '',
    '# 语气',
    '- 直接、少客套。',
    '',
    '# 长期偏好',
    '- 代码示例要能直接运行（Node.js 22+，TypeScript ESM）。',
    '- 参考链接：https://example.com/guide 只作说明，不作为外部依赖。',
    '',
    '# 硬规则',
    '- 不确定就说不确定，不要编造。',
  ].join('\n')
  assert.deepEqual(checkPersona(content, MAX), { ok: true })
})

test('checkPersona：hits 去重且最多 3 条', () => {
  const content = 'a.md、b.md、c.md、d.md、e.md'
  const result = checkPersona(content, MAX)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'reference')
  assert.equal(result.hits.length, 3)
  assert.deepEqual(result.hits, ['a.md', 'b.md', 'c.md'])
  // 重复引用不重复计数
  const dup = checkPersona('a.md 与 a.md 还有 a.md', MAX)
  assert.equal(dup.ok, false)
  assert.equal(dup.hits.length, 1)
})

test('checkPersona：emoji 码点边界（maxChars=5）', () => {
  assert.deepEqual(checkPersona('😀'.repeat(5), 5), { ok: true })
  const over = checkPersona('😀'.repeat(6), 5)
  assert.equal(over.ok, false)
  assert.equal(over.code, 'too-long')
  assert.equal(over.length, 6)
})

test('checkPersona：返回值形状（ok:true 不含 code/hits）', () => {
  const pass = checkPersona('普通内容', MAX)
  assert.equal(pass.ok, true)
  assert.equal('code' in pass, false)
  assert.equal('hits' in pass, false)
})

test('checkPersona：纯函数、无副作用（同一输入多次调用结果一致）', () => {
  const content = '详见 docs/rule.md'
  const a = checkPersona(content, MAX)
  const b = checkPersona(content, MAX)
  assert.deepEqual(a, b)
  assert.equal(content, '详见 docs/rule.md')
})
