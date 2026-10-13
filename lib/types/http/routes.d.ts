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
import { type LoaderHandle } from '../services/install/install.ts';
import { type WebServerService } from './shared.ts';
/**
 * Register the Plugin Hub API on the host web server and return a disposer.
 * @param webServer - DSH web server service.
 * @param profile - profile that owns plugin mutations.
 * @param loader - running loader (optional): lets uninstall remove the entry
 *   immediately so the page survives a refresh without a host restart.
 */
export declare function mountPluginHubRoutes(webServer: WebServerService, profile: string, loader?: LoaderHandle): () => void;
/** Profile resolution shared with the client route docs. */
export { readProfileArg } from '../services/install/install.ts';
/** Re-exported so the host entry (index.ts) keeps importing it from this module. */
export type { WebServerService } from './shared.ts';
/** Re-exported so tests/routes.test.ts keeps importing these from this module. */
export { isDesktopHost, isSameOrigin } from './shared.ts';
