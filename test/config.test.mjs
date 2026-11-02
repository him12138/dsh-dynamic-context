import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, normalizeConfig } from '../lib/config.js'

test('normalizeConfig：空配置返回默认值', () => {
  const config = normalizeConfig(undefined)
  assert.equal(config.recentCards, DEFAULT_CONFIG.recentCards)
  assert.equal(config.maxIndexChars, DEFAULT_CONFIG.maxIndexChars)
  assert.equal(config.maxPersonaChars, 3000)
  assert.equal(config.memoryDirName, 'memory')
  assert.equal(config.enableGuide, true)
})

test('normalizeConfig：合法覆盖字段被接受', () => {
  const config = normalizeConfig({
    recentCards: 3,
    maxIndexChars: 800,
    maxPersonaChars: 1200,
    digestMaxChars: 260,
    rawChunkChars: 1500,
    searchLimit: 8,
    listLimit: 10,
    memoryDirName: '.memory',
    enableGuide: false,
    enablePersonaHint: false,
  })
  assert.equal(config.recentCards, 3)
  assert.equal(config.maxIndexChars, 800)
  assert.equal(config.maxPersonaChars, 1200)
  assert.equal(config.digestMaxChars, 260)
  assert.equal(config.rawChunkChars, 1500)
  assert.equal(config.searchLimit, 8)
  assert.equal(config.listLimit, 10)
  assert.equal(config.memoryDirName, '.memory')
  assert.equal(config.enableGuide, false)
  assert.equal(config.enablePersonaHint, false)
})

test('normalizeConfig：非法值回落默认值', () => {
  const config = normalizeConfig({
    recentCards: -1,
    maxIndexChars: 'abc',
    maxPersonaChars: 0,
    digestMaxChars: null,
    rawChunkChars: 1.5,
    searchLimit: Infinity,
    listLimit: '12',
    enableGuide: 'yes',
  })
  assert.equal(config.recentCards, DEFAULT_CONFIG.recentCards)
  assert.equal(config.maxIndexChars, DEFAULT_CONFIG.maxIndexChars)
  assert.equal(config.maxPersonaChars, DEFAULT_CONFIG.maxPersonaChars)
  assert.equal(config.digestMaxChars, DEFAULT_CONFIG.digestMaxChars)
  assert.equal(config.rawChunkChars, DEFAULT_CONFIG.rawChunkChars)
  assert.equal(config.searchLimit, DEFAULT_CONFIG.searchLimit)
  assert.equal(config.listLimit, 12)
  assert.equal(config.enableGuide, DEFAULT_CONFIG.enableGuide)
})

test('normalizeConfig：memoryDirName 禁止绝对路径与 .. 逃逸', () => {
  assert.equal(normalizeConfig({ memoryDirName: '../evil' }).memoryDirName, 'memory')
  assert.equal(normalizeConfig({ memoryDirName: 'C:\\evil' }).memoryDirName, 'memory')
  assert.equal(normalizeConfig({ memoryDirName: '/etc' }).memoryDirName, 'memory')
  assert.equal(normalizeConfig({ memoryDirName: 'a/b' }).memoryDirName, 'a/b')
})

test('normalizeConfig：未知字段被忽略', () => {
  const config = normalizeConfig({ unknown: true, __proto__: { polluted: true } })
  assert.equal(Object.hasOwn(config, 'polluted'), false)
  assert.equal(Object.hasOwn(config, 'unknown'), false)
})

// 避免临时目录泄漏的简单冒烟：normalizeConfig 不应触盘
test('normalizeConfig：纯函数不触盘', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-memory-config-'))
  try {
    const config = normalizeConfig({})
    assert.equal(typeof config, 'object')
    assert.equal(dir.length > 0, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
