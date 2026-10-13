/**
 * DSH Plugin Hub — the community plugin marketplace for DeepSeek Harness.
 * Website: https://dsh-plugin.org
 * GitHub: https://github.com/dshplugin/dsh-plugin-hub
 *
 * Local HTTP routes exposing real installs to the in-app Plugin Hub UI.
 * The client fetches the same-origin `/dsh-plugin-hub/*` endpoints; the
 * install handler validates the target, then spawns the official dsh CLI
 * (see services/install/install.ts) and reports the captured result back.
 */
import { type LoaderHandle } from '../services/install/install.ts'
import { appendLog } from '../services/log.ts'
import { PROFILE_RE, type WebRoute, type WebServerService } from './shared.ts'
import { registerCatalogRoutes } from './catalog.ts'
import { registerInstallRoutes } from './install.ts'
import { registerSettingsRoutes } from './settings.ts'
import { registerLogsRoutes } from './logs.ts'
import { registerDiagnosticsRoutes } from './diagnostics.ts'
import { registerTaskRoutes } from './task.ts'

/**
 * Register the Plugin Hub API on the host web server and return a disposer.
 * @param webServer - DSH web server service.
 * @param profile - profile that owns plugin mutations.
 * @param loader - running loader (optional): lets uninstall remove the entry
 *   immediately so the page survives a refresh without a host restart.
 */
export function mountPluginHubRoutes(webServer: WebServerService, profile: string, loader?: LoaderHandle): () => void {
  if (!PROFILE_RE.test(profile)) throw new Error(`invalid profile name: ${profile}`)
  console.log(`[hub] routes mounted (profile=${profile}, loader=${loader === undefined ? 'undefined' : 'provided'})`)
  // 系统日志：插件随宿主启动即记录一条 —— 保证「打开就有运行日志」，日志页永远有内容
  appendLog(profile, {
    at: Date.now(),
    level: 'info',
    category: 'system',
    event: 'system.start',
    message: `Plugin Hub 已启动（profile=${profile}）`,
  })
  const routes: WebRoute[] = [
    ...registerCatalogRoutes(webServer, profile),
    ...registerInstallRoutes(webServer, profile, loader),
    ...registerSettingsRoutes(webServer, profile),
    ...registerLogsRoutes(webServer, profile),
    ...registerDiagnosticsRoutes(webServer, profile),
    ...registerTaskRoutes(webServer, profile, loader),
  ]
  const disposers = routes.map((route) => webServer.register(route))
  return () => {
    for (const dispose of disposers) dispose()
  }
}

/** Profile resolution shared with the client route docs. */
export { readProfileArg } from '../services/install/install.ts'
/** Re-exported so the host entry (index.ts) keeps importing it from this module. */
export type { WebServerService } from './shared.ts'
/** Re-exported so tests/routes.test.ts keeps importing these from this module. */
export { isDesktopHost, isSameOrigin } from './shared.ts'
