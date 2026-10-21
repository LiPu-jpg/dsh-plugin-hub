/**
 * DSH Plugin Hub — the community plugin marketplace for DeepSeek Harness.
 * Website: https://dsh-plugin.org
 * GitHub: https://github.com/dshplugin/dsh-plugin-hub
 *
 * 供应链门禁判定（src/client/logic/release-age.ts）单测：注入 now，不依赖真实时间。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MIN_RELEASE_AGE_MS, compareVersions, isReleaseTooFresh, pickHubUpdate } from '../src/client/logic/release-age.ts'

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

const hoursAgo = (h: number): string => new Date(NOW - h * 60 * 60 * 1000).toISOString()

test('compareVersions: 数字段逐段比较，不是字典序', () => {
  assert.ok(compareVersions('2.0.10', '2.0.9') > 0)
  assert.ok(compareVersions('2.0.5', '2.0.6') < 0)
  assert.equal(compareVersions('2.0.6', '2.0.6'), 0)
  assert.ok(compareVersions('2.1', '2.0.9') > 0)
})

test('pickHubUpdate: 连续快速发版时回退到「已过门禁」的更早版本', () => {
  // 现场：本机 2.0.4；2.0.5 已发布 30h（过门禁）；2.0.6 刚发布 5h（门禁内）
  const info = {
    version: '2.0.6',
    publishedAt: hoursAgo(5),
    notes: 'latest notes',
    recentVersions: [
      { version: '2.0.6', publishedAt: hoursAgo(5), notes: 'latest notes' },
      { version: '2.0.5', publishedAt: hoursAgo(30), notes: 'older notes' },
    ],
  }
  const result = pickHubUpdate(info, '2.0.4', NOW)
  assert.equal(result.state, 'available')
  assert.equal(result.target?.version, '2.0.5')
  assert.equal(result.target?.notes, 'older notes')
})

test('pickHubUpdate: 所有更高版本都还在门禁内 → pending，不谎称已最新', () => {
  const info = {
    version: '2.0.6',
    publishedAt: hoursAgo(5),
    recentVersions: [{ version: '2.0.5', publishedAt: hoursAgo(6) }],
  }
  const result = pickHubUpdate(info, '2.0.4', NOW)
  assert.equal(result.state, 'pending')
  assert.equal(result.target?.version, '2.0.6')
})

test('pickHubUpdate: 本机已是最新 / 只有更低版本 → latest', () => {
  const info = { version: '2.0.6', publishedAt: hoursAgo(48), recentVersions: [{ version: '2.0.5', publishedAt: hoursAgo(72) }] }
  assert.equal(pickHubUpdate(info, '2.0.6', NOW).state, 'latest')
  // 停在比 latest 还新的版本（回滚/本地构建）也不提示降级
  assert.equal(pickHubUpdate(info, '2.0.7', NOW).state, 'latest')
})

test('pickHubUpdate: 老接口没有 recentVersions 时保持原行为', () => {
  // 最新版已过门禁 → available
  assert.equal(pickHubUpdate({ version: '2.0.6', publishedAt: hoursAgo(30) }, '2.0.4', NOW).state, 'available')
  // 最新版还在门禁内 → pending
  assert.equal(pickHubUpdate({ version: '2.0.6', publishedAt: hoursAgo(1) }, '2.0.4', NOW).state, 'pending')
})

test('pickHubUpdate: recentVersions 里高于当前版本但低于 latest 的版本也能选为提示目标', () => {
  // latest 太新；2.0.5 已过门禁；2.0.4 是当前版本（不能被选中）
  const info = {
    version: '2.0.6',
    publishedAt: hoursAgo(2),
    recentVersions: [
      { version: '2.0.5', publishedAt: hoursAgo(26) },
      { version: '2.0.4', publishedAt: hoursAgo(100) },
    ],
  }
  const result = pickHubUpdate(info, '2.0.4', NOW)
  assert.equal(result.state, 'available')
  assert.equal(result.target?.version, '2.0.5')
})
