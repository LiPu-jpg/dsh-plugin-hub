/**
 * DSH Plugin Hub — the community plugin marketplace for DeepSeek Harness.
 * Website: https://dsh-plugin.org
 * GitHub: https://github.com/dshplugin/dsh-plugin-hub
 *
 * 失败回捞：DSH 有时只把一行摘要（`dsh: plugin command failed; diagnostics: <path>`）
 * 回显到控制台，真正的 pnpm 报错写进该路径的 operation 日志。这里从输出里解析出该路径
 * 并读取其尾部，补进失败信息 —— 否则前端拿不到任何错误特征，只能把失败归为「未知」。
 * 只允许读 DSH 自己的 operation 日志（路径含 .plugin-manager 且以 pnpm.log 结尾），
 * 防止插件把任意路径打印进日志造成越权读取；任何异常都静默降级（返回 null），
 * 不改变原有失败处理。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CAPTURE_LIMIT_BYTES } from './install-types.ts'

/**
 * 从 DSH 输出里解析 operation 日志路径（`diagnostics: <path>`）。
 * 只认 DSH 的 operation 日志：路径含 `.plugin-manager` 且以 `pnpm.log` 结尾；
 * 不是这种路径（或压根没有该行）返回 null，调用方据此跳过回捞。
 */
export function operationLogPathOf(output: string): string | null {
  for (const raw of output.split(/\r?\n/)) {
    const m = /diagnostics:\s*"?(.+?)"?\s*$/i.exec(raw.trim())
    if (m === null) continue
    const path = m[1].trim()
    if (!path.includes('.plugin-manager') || !path.toLowerCase().endsWith('pnpm.log')) continue
    return path
  }
  return null
}

/**
 * 回捞 operation 日志尾部，作为失败详情返回；拿不到（无路径 / 文件不存在 / 读失败 /
 * 内容为空）返回 null。尾部截到与子进程输出相同的上限，避免超大日志撑爆内存与消息。
 */
export function backfillOperationLog(output: string): string | null {
  const path = operationLogPathOf(output)
  if (path === null) return null
  try {
    const text = readFileSync(path, 'utf8').trim()
    if (text === '') return null
    return text.length > CAPTURE_LIMIT_BYTES ? text.slice(-CAPTURE_LIMIT_BYTES) : text
  } catch {
    return null
  }
}

/**
 * 运行期抓取：宿主的 operation 日志只在命令运行期间存在，结束后可能被清理，
 * 退出后再按路径读往往已经拿不到。这里在安装过程中轮询 profile 下最新的
 * `.plugin-manager/logs/<operation>/pnpm.log`，用抓到的内容兜底。
 * 只认本次运行产生的新文件（mtime 晚于启动基线），避免复述上一次安装的日志。
 */
export function createOperationLogTap(profileDir: string): { stop: () => string } {
  const logsDir = join(profileDir, '.plugin-manager', 'logs')
  const newestLog = (): { file: string; mtimeMs: number } | null => {
    let newest: { file: string; mtimeMs: number } | null = null
    for (const entry of readdirSync(logsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const file = join(logsDir, entry.name, 'pnpm.log')
      try {
        const mtimeMs = statSync(file).mtimeMs
        if (newest === null || mtimeMs > newest.mtimeMs) newest = { file, mtimeMs }
      } catch { /* 该 operation 还没有 pnpm.log */ }
    }
    return newest
  }
  let baselineMs = 0
  try {
    baselineMs = newestLog()?.mtimeMs ?? 0
  } catch { /* logs 目录还不存在 */ }
  let captured = ''
  const tick = (): void => {
    try {
      const newest = newestLog()
      if (newest === null || newest.mtimeMs <= baselineMs) return
      const text = readFileSync(newest.file, 'utf8')
      if (text.length > captured.length) captured = text
    } catch { /* 读不到就放弃这一轮 */ }
  }
  const timer = setInterval(tick, 700)
  timer.unref()
  tick()
  return {
    stop: (): string => {
      clearInterval(timer)
      tick()
      return captured.length > CAPTURE_LIMIT_BYTES ? captured.slice(-CAPTURE_LIMIT_BYTES) : captured
    },
  }
}
