/**
 * DSH Plugin Hub — the community plugin marketplace for DeepSeek Harness.
 * Website: https://dsh-plugin.org
 * GitHub: https://github.com/dshplugin/dsh-plugin-hub
 *
 * 供应链门禁的时间判定（纯函数）：pnpm 会静默回退发布未满门槛的版本，
 * 故发布太新的版本不该提示更新。Hub 自身更新与插件更新共用同一门槛。
 */

/** pnpm 供应链门禁：dsh profile 默认 minimumReleaseAge=1440（分钟）；+30 分钟缓冲抵消网络/CDN 边缘时间偏差。 */
export const MIN_RELEASE_AGE_MS = 24 * 60 * 60 * 1000 + 30 * 60 * 1000

/** 发布时间是否仍在门禁窗口内（太新 → 暂缓提示）；无值/解析不出返回 false（不拦真实更新）。 */
export function isReleaseTooFresh(publishedAt: string | null | undefined, now: number): boolean {
  if (typeof publishedAt !== 'string' || publishedAt === '') return false
  const ms = Date.parse(publishedAt)
  if (Number.isNaN(ms)) return false
  return now - ms < MIN_RELEASE_AGE_MS
}
