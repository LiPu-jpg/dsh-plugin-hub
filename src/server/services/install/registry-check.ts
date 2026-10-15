/**
 * DSH Plugin Hub — the community plugin marketplace for DeepSeek Harness.
 * Website: https://dsh-plugin.org
 * GitHub: https://github.com/dshplugin/dsh-plugin-hub
 *
 * 官方 registry 存在性复核：把「包在 registry 上不存在」这类失败的责任方分开。
 *
 * 背景：安装失败日志出现 `ERR_PNPM_FETCH_404` / `Not Found - 404` 时，光看日志分不清三种情形：
 *   ① 缺的包是 **profile 自己声明的依赖**（历史残留条目，指向一个从未发布的包）—— 用户环境问题：
 *      pnpm 每次解析依赖都会先卡在它上面，任何插件都装不进来（issue #73），提示删掉该条目即可；
 *   ② 缺的包来自**插件的依赖树**，且该包在官方 registry 上也不存在 —— 作者侧问题（漏声明依赖、
 *      依赖被删除或从未发布），应引导用户投插件作者仓库；
 *   ③ 缺的包来自插件依赖树，但官方 registry 上有 —— 用户本机 registry 指向的镜像/私有源未同步
 *      该包，属用户环境问题，提示换源即可。
 * 故本模块先排除 ①（读 profile 的 package.json），再用**官方** registry（registry.npmjs.org，
 * 绕开本机可能配置的镜像）复查存在性，产出 ② / ③ 的标记行。
 *
 * 与 npm-check.ts 同构：本模块只产出「标记行」，由 task-queue 追加到任务输出，前端按标记分类。
 * fetch 与 profile 目录都可注入，便于单测覆盖全部结论而不依赖网络。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** pnpm 输出里 scope 包是 URL 编码形态（`@scope%2Fname`）：比较依赖名、拼查询 URL 前先还原成
 *  `@scope/name`。 */
function decodePackageName(raw: string): string {
  return raw.replace(/%40/gi, '@').replace(/%2f/gi, '/')
}

/** 从失败输出里提取「registry 上不存在的包名」（含 scope，如 `@scope/name`）：读 404 行的请求路径。
 *  提取不到返回 null。 */
export function missingPackageOf(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    if (!/ERR_PNPM_FETCH_404|404/.test(line)) continue
    const m = line.match(/GET\s+https?:\/\/[^\s/]+\/((?:@[^/\s:]+\/)?[^/\s:]+)/)
    if (m) return decodePackageName(m[1])
  }
  return null
}

/** 读 profile 自己声明的依赖名（profile 目录下 package.json 的 dependencies 键）。读不到返回空数组。 */
export function profileDependencyNames(profileDir: string): string[] {
  try {
    const raw = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as { dependencies?: Record<string, unknown> }
    return Object.keys(raw.dependencies ?? {})
  } catch {
    return []
  }
}

/** 官方 registry 上是否存在该包：明确 404 → false（不存在），2xx → true，其余（限流/网络异常）→ null
 *  —— 判不了就不判，绝不妄下结论。 */
async function existsOnOfficialRegistry(
  name: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<boolean | null> {
  // scope 包的路径要编码：`@scope/name` → `%40scope%2Fname`
  const url = `https://registry.npmjs.org/${name.replace('@', '%40').replace('/', '%2F')}`
  try {
    const res = await fetchImpl(url, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 404) return false
    return res.ok ? true : null
  } catch {
    return null
  }
}

/**
 * 产出「包不存在」失败的责任方标记行；判不了返回 null（前端维持既有提示）。
 * - `[registry-missing]`     缺的包在官方源上也不存在 → 作者侧问题（前端引导投作者）
 * - `[registry-mirror-lag]`  官方源上有 → 本机镜像源未同步（前端提示换源，不投任何一方）
 */
export async function registryMissingMarker(
  output: string,
  opts: { profileDir: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<string | null> {
  const name = missingPackageOf(output)
  if (name === null) return null
  // ① profile 自己声明的残留依赖（#73）：用户环境问题，交给既有的 pnpmMissingDep 提示（该提示就是
  // 教用户删 profile 里那条依赖），这里不再产出标记、不改归属
  if (profileDependencyNames(opts.profileDir).some((dep) => dep.toLowerCase() === name.toLowerCase())) return null
  const exists = await existsOnOfficialRegistry(name, opts.fetchImpl ?? fetch, opts.timeoutMs ?? 8000)
  if (exists === false) {
    return `[registry-missing] ${name} is not published on the official npm registry (registry.npmjs.org) — a dependency of this plugin is missing or was removed; author-side issue`
  }
  if (exists === true) {
    return `[registry-mirror-lag] ${name} exists on the official npm registry — the configured registry or mirror has not synced it; local environment issue`
  }
  return null
}
