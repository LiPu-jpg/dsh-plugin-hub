/**
 * 安装前置探测（services/install/preflight.ts）单测。
 *
 * 覆盖两件事：哪些安装目标必须先有 git、以及本机没有 git 时产出的
 * `[git-missing]` 标记（ASCII，Windows 乱码下也能被前端归类）。
 * PATH 用临时空目录替换来模拟「没装 git」，不依赖真实环境。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commandOnPath, GIT_MISSING_DETAIL, gitMissingDetail, needsGit } from '../src/server/services/install/preflight.ts'

/** 空的 PATH：既没有 git，也没有 which —— 两种失败形态都算「探测为不存在」。 */
function withoutPath<T>(fn: (env: NodeJS.ProcessEnv) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-preflight-'))
  try {
    return fn({ ...process.env, PATH: dir, Path: dir })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('needsGit: git 源与 owner/repo 简写需要 git', () => {
  for (const target of [
    'github:owner/repo',
    'github:owner/repo#v1.2.3',
    'git+https://github.com/owner/repo.git',
    'git+ssh://git@github.com/owner/repo.git',
    'git@github.com:owner/repo.git',
    'owner/repo',
    '  owner/repo  ',
  ]) {
    assert.equal(needsGit(target), true, target)
  }
})

test('needsGit: npm 包名、scope 包、release 直链与本地路径不需要 git', () => {
  for (const target of [
    'dsh-plugin',
    'dsh-loopx-plugin',
    '@scope/pkg',
    'https://github.com/owner/repo/releases/download/v1/repo-1.0.0.tgz',
    'file:../my-widget',
    'link:../my-widget',
    './my-widget',
    '/Users/me/widget',
    'C:\\workspace\\widget',
  ]) {
    assert.equal(needsGit(target), false, target)
  }
})

test('commandOnPath: PATH 里没有的命令判为不存在', () => {
  withoutPath((env) => {
    assert.equal(commandOnPath('git', env), false)
    assert.equal(commandOnPath('dsh', env), false)
  })
})

test('commandOnPath: 本机有 git 时能探测到（本机无 git 则跳过该断言）', () => {
  if (!commandOnPath('git')) return
  assert.equal(commandOnPath('git'), true)
})

test('gitMissingDetail: 需要 git 但本机没有 → 返回 [git-missing] 标记', () => {
  withoutPath((env) => {
    assert.equal(gitMissingDetail('owner/repo', env), GIT_MISSING_DETAIL)
    assert.equal(gitMissingDetail('git+https://github.com/owner/repo.git', env), GIT_MISSING_DETAIL)
    assert.match(GIT_MISSING_DETAIL, /^\[git-missing\]/)
  })
})

test('gitMissingDetail: 不需要 git 的目标不拦截（即使本机没有 git）', () => {
  withoutPath((env) => {
    assert.equal(gitMissingDetail('dsh-plugin', env), null)
    assert.equal(gitMissingDetail('@scope/pkg', env), null)
    assert.equal(
      gitMissingDetail('https://github.com/owner/repo/releases/download/v1/repo-1.0.0.tgz', env),
      null,
    )
  })
})

test('gitMissingDetail: 本机有 git 时不拦正常安装', () => {
  if (!commandOnPath('git')) return
  assert.equal(gitMissingDetail('owner/repo'), null)
})
