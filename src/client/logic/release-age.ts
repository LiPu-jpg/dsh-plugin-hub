/**
 * DSH Plugin Hub — the community plugin marketplace for DeepSeek Harness.
 * Website: https://dsh-plugin.org
 * GitHub: https://github.com/dshplugin/dsh-plugin-hub
 *
 * 供应链门禁的时间判定（纯函数）：pnpm 会静默回退发布未满门槛的版本，
 * 故发布太新的版本不该提示更新。Hub 自身更新与插件更新共用同一门槛。
 */
import type { HubUpdateInfo, HubUpdateState, HubUpdateVersion } from '../types.ts'

/** pnpm 供应链门禁：dsh profile 默认 minimumReleaseAge=1440（分钟）；+30 分钟缓冲抵消网络/CDN 边缘时间偏差。 */
export const MIN_RELEASE_AGE_MS = 24 * 60 * 60 * 1000 + 30 * 60 * 1000

/** 发布时间是否仍在门禁窗口内（太新 → 暂缓提示）；无值/解析不出返回 false（不拦真实更新）。 */
export function isReleaseTooFresh(publishedAt: string | null | undefined, now: number): boolean {
  if (typeof publishedAt !== 'string' || publishedAt === '') return false
  const ms = Date.parse(publishedAt)
  if (Number.isNaN(ms)) return false
  return now - ms < MIN_RELEASE_AGE_MS
}

/** 版本号比较（逐段数字；缺失段按 0）。返回负数/0/正数，非法输入按相等处理。 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] => v.split(/[.+-]/).map((part) => Number.parseInt(part, 10)).filter((n) => !Number.isNaN(n))
  const va = parse(a)
  const vb = parse(b)
  const len = Math.max(va.length, vb.length)
  for (let i = 0; i < len; i++) {
    const d = (va[i] ?? 0) - (vb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * 选出本次真正该提示的更新版本。
 *
 * 只看最新版会漏更新：连续发版时间隔小于供应链门禁时，最新版永远「太新」，
 * 提示被整体跳过。这里把最新版与 recentVersions 一起当候选，取「高于当前版本且已过门禁」
 * 的最高版本；一个都没有但仍存在更高版本 → pending（暂缓，不谎称已是最新）。
 */
export function pickHubUpdate(info: HubUpdateInfo, currentVersion: string, now: number): { state: HubUpdateState; target: HubUpdateVersion | null } {
  if (currentVersion === '') return { state: 'latest', target: null }
  const seen = new Set<string>()
  const candidates: HubUpdateVersion[] = []
  for (const entry of [{ version: info.version, publishedAt: info.publishedAt, notes: info.notes }, ...(info.recentVersions ?? [])]) {
    if (typeof entry.version !== 'string' || entry.version === '' || seen.has(entry.version)) continue
    seen.add(entry.version)
    candidates.push(entry)
  }
  const higher = candidates
    .filter((c) => compareVersions(c.version, currentVersion) > 0)
    .sort((a, b) => compareVersions(b.version, a.version))
  if (higher.length === 0) return { state: 'latest', target: null }
  const ready = higher.find((c) => !isReleaseTooFresh(c.publishedAt, now))
  return ready !== undefined
    ? { state: 'available', target: ready }
    : { state: 'pending', target: higher[0]! }
}
