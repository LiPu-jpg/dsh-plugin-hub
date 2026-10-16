/**
 * DSH Plugin Hub — the community plugin marketplace for DeepSeek Harness.
 * Website: https://dsh-plugin.org
 * GitHub: https://github.com/dshplugin/dsh-plugin-hub
 *
 * Install/uninstall routes: validate the target and spawn the official dsh CLI
 * (see services/install/install.ts), reporting the captured result back.
 * Custom installs accept npm package names only.
 */
import { type LoaderHandle } from '../services/install/install.ts';
import { type WebRoute, type WebServerService } from './shared.ts';
export declare function registerInstallRoutes(webServer: WebServerService, profile: string, loader: LoaderHandle | undefined): WebRoute[];
