/**
 * DSH Plugin Hub — the community plugin marketplace for DeepSeek Harness.
 * Website: https://dsh-plugin.org
 * GitHub: https://github.com/dshplugin/dsh-plugin-hub
 *
 * 供应链门禁判定（src/client/logic/release-age.ts）单测：注入 now，不依赖真实时间。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MIN_RELEASE_AGE_MS, isReleaseTooFresh } from '../src/client/logic/release-age.ts'

const NOW = Date.parse('2026-10-16T12:00:00.000Z')

test('isReleaseTooFresh: 发布未满门槛窗口视为太新', () => {
  // 刚发布（0 分钟）与门槛内（门槛 - 1ms）都判太新
  assert.equal(isReleaseTooFresh(new Date(NOW).toISOString(), NOW), true)
  assert.equal(isReleaseTooFresh(new Date(NOW - (MIN_RELEASE_AGE_MS - 1)).toISOString(), NOW), true)
})

test('isReleaseTooFresh: 门槛窗口外（>= 门槛）不再是太新', () => {
  assert.equal(isReleaseTooFresh(new Date(NOW - MIN_RELEASE_AGE_MS).toISOString(), NOW), false)
  assert.equal(isReleaseTooFresh(new Date(NOW - 48 * 60 * 60 * 1000).toISOString(), NOW), false)
})

test('isReleaseTooFresh: 缺值 / 解析不出返回 false（不拦真实更新）', () => {
  assert.equal(isReleaseTooFresh(null, NOW), false)
  assert.equal(isReleaseTooFresh(undefined, NOW), false)
  assert.equal(isReleaseTooFresh('', NOW), false)
  assert.equal(isReleaseTooFresh('not-a-date', NOW), false)
})
