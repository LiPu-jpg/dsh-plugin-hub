import { appendLog } from '../services/log.js';
import { PROFILE_RE } from './shared.js';
import { registerCatalogRoutes } from './catalog.js';
import { registerInstallRoutes } from './install.js';
import { registerSettingsRoutes } from './settings.js';
import { registerLogsRoutes } from './logs.js';
import { registerDiagnosticsRoutes } from './diagnostics.js';
import { registerTaskRoutes } from './task.js';
import { registerNpmReleaseAgeRoutes } from './npm-release-age.js';
/**
 * Register the Plugin Hub API on the host web server and return a disposer.
 * @param webServer - DSH web server service.
 * @param profile - profile that owns plugin mutations.
 * @param loader - running loader (optional): lets uninstall remove the entry
 *   immediately so the page survives a refresh without a host restart.
 */
export function mountPluginHubRoutes(webServer, profile, loader) {
    if (!PROFILE_RE.test(profile))
        throw new Error(`invalid profile name: ${profile}`);
    console.log(`[hub] routes mounted (profile=${profile}, loader=${loader === undefined ? 'undefined' : 'provided'})`);
    // 系统日志：插件随宿主启动即记录一条 —— 保证「打开就有运行日志」，日志页永远有内容
    appendLog(profile, {
        at: Date.now(),
        level: 'info',
        category: 'system',
        event: 'system.start',
        message: `Plugin Hub 已启动（profile=${profile}）`,
    });
    const routes = [
        ...registerCatalogRoutes(webServer, profile),
        ...registerInstallRoutes(webServer, profile, loader),
        ...registerSettingsRoutes(webServer, profile),
        ...registerLogsRoutes(webServer, profile),
        ...registerDiagnosticsRoutes(webServer, profile),
        ...registerTaskRoutes(webServer, profile, loader),
        ...registerNpmReleaseAgeRoutes(webServer, profile),
    ];
    const disposers = routes.map((route) => webServer.register(route));
    return () => {
        for (const dispose of disposers)
            dispose();
    };
}
/** Profile resolution shared with the client route docs. */
export { readProfileArg } from '../services/install/install.js';
/** Re-exported so tests/routes.test.ts keeps importing these from this module. */
export { isDesktopHost, isSameOrigin } from './shared.js';
