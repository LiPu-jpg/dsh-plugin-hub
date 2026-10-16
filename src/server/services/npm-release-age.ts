/**
 * DSH Plugin Hub — the community plugin marketplace for DeepSeek Harness.
 * Website: https://dsh-plugin.org
 * GitHub: https://github.com/dshplugin/dsh-plugin-hub
 *
 * npm 包最新版本的发布时间查询：为「已安装插件是否有更新」提供供应链门禁依据。
 * pnpm 对发布不满 24h（dsh profile minimumReleaseAge=1440）的版本会静默回退到旧版本，
 * 因此发布未满门槛的版本不该提示更新（否则用户点了也装不上）。
 * 结果按包名内存缓存，同一次会话内不重复请求；失败/超时/响应过大一律返回 null，绝不抛错、绝不阻塞。
 */
import { get as httpsGet } from 'node:https'
import { validPackageName } from './profile/profile.ts'
import { fetchViaCurl } from './probe.ts'

export interface NpmRelease {
  version: string
  publishedAt: string
}

/** 请求体包名数量上限：只为已安装插件按需查询，几十个足矣，封顶防滥用。 */
export const MAX_RELEASE_AGE_PACKAGES = 50
/** 单包查询超时（ms）：慢网络下失败即返回 null，不拖住整个响应。 */
export const RELEASE_AGE_TIMEOUT_MS = 8000
/** 响应体上限：完整 packument 可能达数 MB，超限直接放弃，避免异常大包拖垮服务。 */
const MAX_PACKUMENT_BYTES = 10 * 1024 * 1024
export const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org'

/** 会话内缓存（包名 → 版本与发布时间）：只存成功结果，一次网络抖动不会把判断永久粘住。 */
const releaseCache = new Map<string, NpmRelease>()

/** 从完整 packument 取 dist-tags.latest 对应版本及其发布时间；缺任一字段返回 null。 */
export function latestReleaseOf(packument: unknown): NpmRelease | null {
  if (packument === null || typeof packument !== 'object') return null
  const doc = packument as { 'dist-tags'?: unknown; time?: unknown }
  const tags = doc['dist-tags']
  const version = tags !== null && typeof tags === 'object' ? (tags as { latest?: unknown }).latest : undefined
  if (typeof version !== 'string' || version === '') return null
  const time = doc.time
  const publishedAt = time !== null && typeof time === 'object' ? (time as Record<string, unknown>)[version] : undefined
  if (typeof publishedAt !== 'string' || publishedAt === '') return null
  return { version, publishedAt }
}

/** 请求体 → 去重后的合法包名列表；非数组 / 超量 / 含非法包名一律 null（拒绝非法输入）。 */
export function parseReleaseAgeRequest(body: unknown): string[] | null {
  if (body === null || typeof body !== 'object') return null
  const raw = (body as { packages?: unknown }).packages
  if (!Array.isArray(raw) || raw.length > MAX_RELEASE_AGE_PACKAGES) return null
  const names = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string' || item === '' || item.startsWith('-') || !validPackageName(item)) return null
    names.add(item)
  }
  return [...names]
}

/** node:https 直连 GET，仅接受 200；超时/超限/网络失败返回 null。 */
function getJson(url: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (value: string | null) => { if (!done) { done = true; resolve(value) } }
    const req = httpsGet(url, { timeout: timeoutMs, headers: { accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); finish(null); return }
      const declared = Number(res.headers['content-length'])
      if (Number.isFinite(declared) && declared > MAX_PACKUMENT_BYTES) { res.destroy(); finish(null); return }
      let body = ''
      let bytes = 0
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > MAX_PACKUMENT_BYTES) { res.destroy(); finish(null); return }
        body += chunk.toString()
      })
      res.on('end', () => finish(body))
      res.on('error', () => finish(null))
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => finish(null))
  })
}

/** 拉取一个包的完整 packument 正文；配了代理时复用与安装/目录同一套代理口径（curl 子进程注入 proxy env）。 */
async function fetchPackument(url: string, proxy: string, timeoutMs: number): Promise<string | null> {
  if (proxy !== '') {
    const r = await fetchViaCurl(url, proxy, timeoutMs)
    return r.ok && r.body !== '' && Buffer.byteLength(r.body) <= MAX_PACKUMENT_BYTES ? r.body : null
  }
  return getJson(url, timeoutMs)
}

/** 查询一个包的最新版本与发布时间（成功结果缓存，同会话内同包不重复请求）；registry 为空回退官方源，失败返回 null。 */
export async function lookupReleaseAge(
  packageName: string,
  registry: string,
  proxy: string,
  timeoutMs = RELEASE_AGE_TIMEOUT_MS,
): Promise<NpmRelease | null> {
  const cached = releaseCache.get(packageName)
  if (cached !== undefined) return cached
  const base = registry.replace(/\/+$/, '') || DEFAULT_NPM_REGISTRY
  const body = await fetchPackument(`${base}/${encodeURIComponent(packageName)}`, proxy, timeoutMs)
  if (body === null) return null
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { return null }
  const release = latestReleaseOf(parsed)
  if (release !== null) releaseCache.set(packageName, release)
  return release
}
