/**
 * 单测：zh / en 字典必须逐键对齐。
 *
 * 失败归因的文案是按 `failKind_<kind>` / `failReason_<kind>` 动态取的：任一侧漏一个键，
 * 界面上就会直接显示键名 —— 而且只在对应失败类型真正发生时才会暴露，平时看不出来。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { en, zh } from '../src/client/locales.ts'

test('locales: zh / en 的键集合完全一致', () => {
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  const missingInEn = zhKeys.filter((k) => !(k in en))
  const missingInZh = enKeys.filter((k) => !(k in zh))
  assert.deepEqual(missingInEn, [], '这些键缺少英文文案')
  assert.deepEqual(missingInZh, [], '这些键缺少中文文案')
})

test('locales: 每种失败类型的标题与原因成对存在', () => {
  for (const dict of [zh, en]) {
    for (const key of Object.keys(dict)) {
      if (!key.startsWith('failKind_')) continue
      const kind = key.slice('failKind_'.length)
      assert.ok(`failReason_${kind}` in dict, `缺少 failReason_${kind}`)
    }
    for (const key of Object.keys(dict)) {
      if (!key.startsWith('failReason_')) continue
      const kind = key.slice('failReason_'.length)
      assert.ok(`failKind_${kind}` in dict, `缺少 failKind_${kind}`)
    }
  }
})

test('locales: failKind 的每个后缀都是真实存在的失败类型', () => {
  // 从分类器源码里取联合类型，避免测试里再抄一份（抄的那份迟早和实现对不上）
  const source = readFileSync(new URL('../src/client/logic/failures.ts', import.meta.url), 'utf8')
  const union = /export type FailureKind = ([^\n]+)/.exec(source)?.[1] ?? ''
  assert.ok(union !== '', '未能解析 FailureKind 联合类型')
  for (const key of Object.keys(zh)) {
    if (!key.startsWith('failKind_')) continue
    const kind = key.slice('failKind_'.length)
    assert.ok(union.includes(`'${kind}'`), `failKind_${kind} 不是 FailureKind 的成员`)
  }
})
