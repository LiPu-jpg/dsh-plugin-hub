/**
 * DSH Plugin Hub — the community plugin marketplace for DeepSeek Harness.
 * Website: https://dsh-plugin.org
 * GitHub: https://github.com/dshplugin/dsh-plugin-hub
 *
 * 失败回捞（src/server/services/install/operation-log.ts）的单元测试：
 * 从 DSH 输出里解析 operation 日志路径、只读白名单内的 DSH 日志、读不到时静默降级，
 * 以及回捞内容能被 classifyFailure 正确归类（issue #192 的回归）。
 *
 * Run with the Node built-in test runner: `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backfillOperationLog, operationLogPathOf } from '../src/server/services/install/operation-log.ts'
import { classifyFailure } from '../src/client/logic/failures.ts'

/** 造一个 DSH 的 operation 日志目录结构，返回 pnpm.log 的绝对路径。 */
function makeOperationLog(root: string, content: string): string {
  const dir = join(root, '.plugin-manager', 'logs', 'operation-cuZjxW')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'pnpm.log')
  writeFileSync(file, content)
  return file
}

test('operationLogPathOf: extracts the path from the host summary line (issue #192)', () => {
  const line = 'dsh: plugin command failed; diagnostics: C:\\Users\\29491\\.dsh\\profiles\\desktop\\.plugin-manager\\logs\\operation-cuZjxW\\pnpm.log'
  assert.equal(
    operationLogPathOf(`some earlier line\n${line}\n`),
    'C:\\Users\\29491\\.dsh\\profiles\\desktop\\.plugin-manager\\logs\\operation-cuZjxW\\pnpm.log',
  )
})

test('operationLogPathOf: ignores paths outside DSH own operation log (no arbitrary file reads)', () => {
  assert.equal(operationLogPathOf('diagnostics: /tmp/somewhere/pnpm.log'), null)
  assert.equal(operationLogPathOf('diagnostics: ~/.dsh/profiles/desktop/hub.log'), null)
  assert.equal(operationLogPathOf('some failure without the diagnostics line'), null)
})

test('backfillOperationLog: reads the operation log tail so the real pnpm error reaches the client', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-oplog-'))
  try {
    const file = makeOperationLog(root, '[ERR_PNPM_FETCH_404] GET https://registry.npmjs.org/dsh-whale-pet: Not Found - 404\n')
    const output = `dsh: plugin command failed; diagnostics: ${file}`
    const backfilled = backfillOperationLog(output)
    assert.ok(backfilled !== null)
    // 回捞出的真实错误码能被自动归类（否则只能归到「未知失败」）
    assert.equal(classifyFailure(backfilled), 'pnpmMissingDep')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('backfillOperationLog: degrades to null when the log is missing or empty', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-oplog-'))
  try {
    const missing = join(root, '.plugin-manager', 'logs', 'operation-nope', 'pnpm.log')
    assert.equal(backfillOperationLog(`diagnostics: ${missing}`), null)
    const empty = makeOperationLog(root, '   \n')
    assert.equal(backfillOperationLog(`diagnostics: ${empty}`), null)
    assert.equal(backfillOperationLog('no diagnostics line at all'), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
