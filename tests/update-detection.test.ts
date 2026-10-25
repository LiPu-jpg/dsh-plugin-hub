/**
 * 单测：「有更新」判定只认「目录版本 > 已装版本」，兼容 v 前缀。
 * 目录可能滞后于 npm，直接用 != 会把「已装 1.1.10、目录还写 1.1.8」判成有更新，引导用户降级。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasUpdateOf } from '../src/client/logic/installed.ts'
import { compareVersions, isUpdateOffered, MIN_RELEASE_AGE_MS } from '../src/client/logic/release-age.ts'
import type { HubPlugin } from '../src/client/types.ts'
import type { InstalledVersionSignal } from '../src/client/logic/installed.ts'

const REPO = 'michengai/dsh-archive-manager'
const PKG = '@michengai/dsh-archive-manager'

function plugin(catalogVersion?: string): HubPlugin {
  return {
    slug: 'dsh-archive-manager',
    source: { repo: REPO, npmPackage: PKG },
    ...(catalogVersion === undefined ? {} : { version: catalogVersion }),
  } as HubPlugin
}

function ledger(version: string): Record<string, InstalledVersionSignal> {
  return { [REPO.toLowerCase()]: { version, updatedAt: '2026-10-24T08:09:57Z' } }
}

// 已装表以 npm 包名为 key（scope 包保留 @scope/ 前缀）
const installed = { [PKG]: PKG }

test('hasUpdateOf: only a newer catalog version counts as an update', () => {
  // 目录落后：已装 1.1.10，目录写 v1.1.8 → 不是更新（否则会把用户引导到降级）
  assert.equal(hasUpdateOf(plugin('v1.1.8'), installed, ledger('1.1.10')), false)
  // v 前缀与无前缀视为同一版本
  assert.equal(hasUpdateOf(plugin('v1.1.10'), installed, ledger('1.1.10')), false)
  // 目录更新 → 有更新
  assert.equal(hasUpdateOf(plugin('v1.1.11'), installed, ledger('1.1.10')), true)
})

test('hasUpdateOf: without a version, the repo update time still drives updates', () => {
  const p = { slug: 'x', source: { repo: REPO, npmPackage: PKG }, dates: { repoUpdatedAt: '2026-10-25T00:00:00Z' } } as HubPlugin
  assert.equal(hasUpdateOf(p, installed, ledger('1.1.10')), true)
  const older = { slug: 'x', source: { repo: REPO, npmPackage: PKG }, dates: { repoUpdatedAt: '2026-10-20T00:00:00Z' } } as HubPlugin
  assert.equal(hasUpdateOf(older, installed, ledger('1.1.10')), false)
})

test('compareVersions: a prerelease ranks below the matching release', () => {
  assert.ok(compareVersions('1.0.0-beta.1', '1.0.0') < 0)
  assert.ok(compareVersions('1.0.0', '1.0.0-beta.1') > 0)
  assert.ok(compareVersions('1.0.0-rc.1', '1.0.0-beta.2') > 0)
  // build metadata 不参与比较；v 前缀仍视为同版本
  assert.equal(compareVersions('1.0.0+build.5', '1.0.0'), 0)
  assert.equal(compareVersions('v1.1.10', '1.1.10'), 0)
})

test('isUpdateOffered: only offer an update npm can actually install', () => {
  const now = Date.parse('2026-10-25T00:00:00Z')
  const matured = new Date(now - MIN_RELEASE_AGE_MS - 60_000).toISOString()
  const fresh = new Date(now - 60_000).toISOString()
  // 目录标到 1.2.0，但 npm 上只有 1.1.0（作者只打了 release 没发 npm）→ 不提示，否则永远点不掉
  assert.equal(isUpdateOffered({ version: '1.1.0', publishedAt: matured }, '1.1.0', now), false)
  // npm 上确实更高且已过门禁 → 提示
  assert.equal(isUpdateOffered({ version: '1.2.0', publishedAt: matured }, '1.1.0', now), true)
  // 发布不满 24h → 暂缓（pnpm 会静默回退，点了也装不上）
  assert.equal(isUpdateOffered({ version: '1.2.0', publishedAt: fresh }, '1.1.0', now), false)
  // 查询失败 / 没有账本记录 → 交回原有判定，不吞掉真实更新
  assert.equal(isUpdateOffered(null, '1.1.0', now), true)
  assert.equal(isUpdateOffered({ version: '1.2.0', publishedAt: matured }, null, now), true)
})
