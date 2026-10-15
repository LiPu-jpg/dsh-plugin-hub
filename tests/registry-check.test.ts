/**
 * 官方 registry 存在性复核（services/install/registry-check.ts）单测。
 *
 * 固化「包在 registry 不存在」的三种责任方，避免归属漂移：
 *   ① profile 自己声明的残留依赖（#73）→ 用户环境，本模块不产出标记（既有提示负责）
 *   ② 官方源上也不存在 → 作者侧，`[registry-missing]`
 *   ③ 官方源上存在 → 本机镜像源未同步，`[registry-mirror-lag]`
 * fetch 与 profile 目录都注入，全程不依赖网络。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { missingPackageOf, profileDependencyNames, registryMissingMarker } from '../src/server/services/install/registry-check.ts'

const NOT_FOUND_LOG = [
  '[ERR_PNPM_FETCH_404] GET https://registry.npmjs.org/dsh-our-free-model: Not Found - 404',
  'This error happened while installing a direct dependency of /home/u/.dsh/profiles/web',
].join('\n')

/** 造一个临时 profile 目录（可带 package.json 的 dependencies），回调结束后清理。 */
async function withProfile<T>(deps: string[], fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-registry-check-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: Object.fromEntries(deps.map((d) => [d, '^1.0.0'])) }))
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 只关心状态码的假 fetch（单测不联网）。 */
function fakeFetch(status: number): typeof fetch {
  return (async () => new Response('', { status })) as unknown as typeof fetch
}

test('missingPackageOf: 从 404 行取包名，并把 scope 包的编码形态还原', () => {
  assert.equal(missingPackageOf(NOT_FOUND_LOG), 'dsh-our-free-model')
  // pnpm 对 scope 包打印的是 URL 编码形态
  assert.equal(
    missingPackageOf('[ERR_PNPM_FETCH_404] GET https://registry.npmjs.org/@scope%2Fname: Not Found - 404'),
    '@scope/name',
  )
  assert.equal(missingPackageOf('Progress: resolved 40, reused 0, downloaded 11, added 1, done'), null)
})

test('profileDependencyNames: 读 profile 声明的依赖，缺失或损坏时返回空数组', async () => {
  await withProfile(['left-pad', '@scope/name'], async (dir) => {
    assert.deepEqual(profileDependencyNames(dir).sort(), ['@scope/name', 'left-pad'])
  })
  const empty = mkdtempSync(join(tmpdir(), 'dsh-registry-check-'))
  try {
    assert.deepEqual(profileDependencyNames(empty), [])
    mkdirSync(join(empty, 'package.json'), { recursive: true })
    assert.deepEqual(profileDependencyNames(empty), [])
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

test('registryMissingMarker: 缺的包是本机 profile 的残留依赖时不产出标记（#73 归用户环境）', async () => {
  await withProfile(['dsh-our-free-model'], async (dir) => {
    // 官方源上也查不到，但它就在 profile 的 dependencies 里 → 属既有的「删除残留条目」提示
    assert.equal(await registryMissingMarker(NOT_FOUND_LOG, { profileDir: dir, fetchImpl: fakeFetch(404) }), null)
  })
})

test('registryMissingMarker: 官方源上也不存在 → 作者侧标记', async () => {
  await withProfile([], async (dir) => {
    const line = await registryMissingMarker(NOT_FOUND_LOG, { profileDir: dir, fetchImpl: fakeFetch(404) })
    assert.ok(line !== null && line.startsWith('[registry-missing] dsh-our-free-model'))
    assert.match(line ?? '', /author-side issue/)
  })
})

test('registryMissingMarker: 官方源上存在 → 镜像滞后标记（不算作者的问题）', async () => {
  await withProfile([], async (dir) => {
    const line = await registryMissingMarker(NOT_FOUND_LOG, { profileDir: dir, fetchImpl: fakeFetch(200) })
    assert.ok(line !== null && line.startsWith('[registry-mirror-lag] dsh-our-free-model'))
    assert.match(line ?? '', /local environment issue/)
  })
})

test('registryMissingMarker: 复核不了就不下结论', async () => {
  await withProfile([], async (dir) => {
    // 官方源返回异常状态（限流等）
    assert.equal(await registryMissingMarker(NOT_FOUND_LOG, { profileDir: dir, fetchImpl: fakeFetch(500) }), null)
    // 网络异常
    const throwing = (async () => { throw new Error('ENOTFOUND') }) as unknown as typeof fetch
    assert.equal(await registryMissingMarker(NOT_FOUND_LOG, { profileDir: dir, fetchImpl: throwing }), null)
    // 日志里根本没有「包不存在」
    assert.equal(
      await registryMissingMarker('Progress: resolved 417, reused 18, done', { profileDir: dir, fetchImpl: fakeFetch(404) }),
      null,
    )
  })
})
