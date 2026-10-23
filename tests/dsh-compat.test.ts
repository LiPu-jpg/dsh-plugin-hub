/**
 * 单测：插件声明的 DSH 版本下限 vs 当前宿主（scripts 无关，纯函数 + 注入 fetch）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dshFloorOf, dshTooOldMarker, npmNameOf, versionTriple } from '../src/server/services/install/dsh-compat.ts'

test('npmNameOf: keeps npm names, strips versions, rejects non-npm targets', () => {
  assert.equal(npmNameOf('dsh-better-sidebar'), 'dsh-better-sidebar')
  assert.equal(npmNameOf('@scope/pkg'), '@scope/pkg')
  assert.equal(npmNameOf('@scope/pkg@1.2.3'), '@scope/pkg')
  assert.equal(npmNameOf('dsh-plugin@latest'), 'dsh-plugin')
  // git / URL / 本地路径都不是 npm 包名
  assert.equal(npmNameOf('github:owner/repo'), null)
  assert.equal(npmNameOf('owner/repo'), null)
  assert.equal(npmNameOf('https://github.com/o/r'), null)
  assert.equal(npmNameOf('./local/plugin'), null)
  assert.equal(npmNameOf('file:../x.tgz'), null)
  assert.equal(npmNameOf(''), null)
})

test('versionTriple / dshFloorOf: takes the highest declared floor', () => {
  assert.deepEqual(versionTriple('^0.2.1-rc.1'), [0, 2, 1])
  assert.deepEqual(versionTriple('>=0.2.0-0 <0.3.0'), [0, 2, 0])
  assert.equal(versionTriple('latest'), null)

  const floor = dshFloorOf({
    engines: { dsh: '>=0.2.0-0 <0.3.0' },
    peerDependencies: { '@deepseek-ai/dsh-llm': '^0.2.1-rc.1', react: '^18' },
  })
  assert.equal(floor, '^0.2.1-rc.1')
  // 与 DSH 无关的 peer 不算
  assert.equal(dshFloorOf({ peerDependencies: { react: '^18' } }), null)
})

function manifestResponse(manifest: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(manifest), { status: 200 })) as unknown as typeof fetch
}

test('dshTooOldMarker: older host than the declared floor produces the marker', async () => {
  const line = await dshTooOldMarker('dsh-better-sidebar', {
    currentVersion: '0.2.0-rc.2',
    fetchImpl: manifestResponse({ peerDependencies: { '@deepseek-ai/dsh-llm': '^0.2.1-rc.1' } }),
  })
  assert.ok(line?.startsWith('[dsh-too-old] dsh-better-sidebar requires DSH >= ^0.2.1-rc.1'), line ?? '')
  assert.ok(line?.includes('0.2.0-rc.2'), line ?? '')
})

test('dshTooOldMarker: stays silent when the host satisfies the floor or nothing is declared', async () => {
  assert.equal(
    await dshTooOldMarker('dsh-better-sidebar', {
      currentVersion: '0.2.1',
      fetchImpl: manifestResponse({ peerDependencies: { '@deepseek-ai/dsh-llm': '^0.2.1-rc.1' } }),
    }),
    null,
  )
  assert.equal(
    await dshTooOldMarker('dsh-better-sidebar', {
      currentVersion: '0.2.0',
      fetchImpl: manifestResponse({ peerDependencies: { react: '^18' } }),
    }),
    null,
  )
  const failing = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch
  // 非 npm 目标、宿主版本未知、元数据拉取失败都不产出标记（不联网：全部注入 fetch）
  assert.equal(await dshTooOldMarker('owner/repo', { currentVersion: '0.2.0', fetchImpl: failing }), null)
  assert.equal(await dshTooOldMarker('dsh-x', { currentVersion: null, fetchImpl: failing }), null)
  assert.equal(await dshTooOldMarker('dsh-x', { currentVersion: '0.2.0', fetchImpl: failing }), null)
})
