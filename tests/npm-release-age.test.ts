/**
 * DSH Plugin Hub — the community plugin marketplace for DeepSeek Harness.
 * Website: https://dsh-plugin.org
 * GitHub: https://github.com/dshplugin/dsh-plugin-hub
 *
 * npm-release-age 纯函数单测：packument → 版本/发布时间，以及请求体校验。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_RELEASE_AGE_PACKAGES, latestReleaseOf, parseReleaseAgeRequest } from '../src/server/services/npm-release-age.ts'

test('latestReleaseOf: 取 dist-tags.latest 对应版本与 time 中的发布时间', () => {
  assert.deepEqual(latestReleaseOf({
    'dist-tags': { latest: '1.2.3', next: '2.0.0-beta.1' },
    time: { '1.2.3': '2026-09-01T00:00:00.000Z', '2.0.0-beta.1': '2026-09-10T00:00:00.000Z' },
  }), { version: '1.2.3', publishedAt: '2026-09-01T00:00:00.000Z' })
})

test('latestReleaseOf: 缺版本、缺发布时间或输入非法一律返回 null', () => {
  assert.equal(latestReleaseOf(null), null)
  assert.equal(latestReleaseOf('not-an-object'), null)
  assert.equal(latestReleaseOf({}), null)
  // 有 dist-tags.latest 但 time 里没有该版本 → 判不了，返回 null
  assert.equal(latestReleaseOf({ 'dist-tags': { latest: '1.0.0' }, time: {} }), null)
  // latest 必须是字符串
  assert.equal(latestReleaseOf({ 'dist-tags': { latest: 1 }, time: { 1: '2026-09-01T00:00:00.000Z' } }), null)
})

test('parseReleaseAgeRequest: 接受合法包名并去重', () => {
  assert.deepEqual(parseReleaseAgeRequest({ packages: ['dsh-plugin', '@scope/pkg', 'dsh-plugin'] }), ['dsh-plugin', '@scope/pkg'])
  assert.deepEqual(parseReleaseAgeRequest({ packages: [] }), [])
})

test('parseReleaseAgeRequest: 非数组 / 超量 / 非法包名一律拒绝', () => {
  assert.equal(parseReleaseAgeRequest(null), null)
  assert.equal(parseReleaseAgeRequest({ packages: 'dsh-plugin' }), null)
  assert.equal(parseReleaseAgeRequest({ packages: ['ok', 123] }), null)
  assert.equal(parseReleaseAgeRequest({ packages: ['ok', '--foo'] }), null)
  assert.equal(parseReleaseAgeRequest({ packages: ['not a pkg'] }), null)
  assert.equal(parseReleaseAgeRequest({ packages: Array.from({ length: MAX_RELEASE_AGE_PACKAGES + 1 }, (_, i) => `p${i}`) }), null)
})
