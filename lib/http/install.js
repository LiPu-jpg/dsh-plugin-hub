/**
 * DSH Plugin Hub — the community plugin marketplace for DeepSeek Harness.
 * Website: https://dsh-plugin.org
 * GitHub: https://github.com/dshplugin/dsh-plugin-hub
 *
 * Install/uninstall routes: validate the target and spawn the official dsh CLI
 * (see services/install/install.ts), reporting the captured result back.
 * Custom installs accept npm package names only.
 */
import { githubRepoOf, globalNpmPackagesOf, hasQueuedTarget, installTargetOf, startPluginMutation, validPackageName } from '../services/install/install.js';
import { recordResolvedNpmPackage } from '../services/profile/installed-versions.js';
import { isDshNpmPackageForRepo } from '../services/install/npm-resolve.js';
import { probeUrl, systemProxy } from '../services/probe.js';
import { loadSettings } from '../services/settings.js';
import { readInstalled } from './catalog.js';
import { COMMAND_TIMEOUT_MS, readJsonBody, requireTrustedPost, sendJson } from './shared.js';
/** 安装/卸载 CLI 的子进程环境：透传宿主环境，并按设置注入 HTTP(S) 代理。
 *  不注入 npm registry —— 安装完全沿用用户本机 npm 配置（~/.npmrc / 全局配置）。
 *  代理优先级：设置里的代理 → 系统代理（macOS scutil / Windows 注册表）→ 宿主 env 原有值。
 *  使安装通道与诊断使用相同的代理来源。 */
function mutationEnv(settings) {
    const env = { ...process.env, CI: 'true' };
    const proxy = settings.proxy !== '' ? settings.proxy : (systemProxy() ?? '');
    if (proxy !== '') {
        env.HTTP_PROXY = proxy;
        env.HTTPS_PROXY = proxy;
        env.http_proxy = proxy;
        env.https_proxy = proxy;
    }
    return env;
}
export function registerInstallRoutes(webServer, profile, loader) {
    return [
        {
            kind: 'exact',
            path: '/dsh-plugin-hub/install',
            handler: async (request, response) => {
                if (!requireTrustedPost(request, response))
                    return;
                // 任务自动入队：即使已有插件操作在跑也接受请求（FIFO 串行执行），不做 409 拒绝
                try {
                    const body = await readJsonBody(request);
                    // mode: 'update' = 已安装目标的覆盖更新（放行 add，pnpm 对已存在依赖原位覆盖重装）。
                    let mode = body !== null && typeof body === 'object' && body.mode === 'update'
                        ? 'update'
                        : 'install';
                    // installTargetOf 先把完整 DSH 命令（`dsh plugin [--profile <p>] add <target>`）剥成裸目标，
                    // 兼容用户直接粘贴命令行；自定义目标只接受 npm 包名，真正语法判定交给 validPackageName。
                    const rawRepo = typeof body === 'object' && body !== null && typeof body.repo === 'string'
                        ? installTargetOf(body.repo)
                        : '';
                    // 前端决策的展示用仓库名（owner/repo）：npm 安装时 body.repo 是包名，display 用于
                    // 待重启行 / 任务恢复时展示仓库名，保证用户无感知（安装通道变化不改变所见目标）
                    const displayRepo = typeof body === 'object' && body !== null && typeof body.display === 'string'
                        ? body.display.trim()
                        : rawRepo;
                    // 请求来源：目录插件安装（catalog）走目录白名单；命令行安装（custom）受安全开关控制
                    const source = typeof body === 'object' && body !== null && typeof body.source === 'string'
                        ? body.source
                        : '';
                    // 自定义安装入口渠道（客户端上报，仅 NPM 包）：服务端日志/报错据此溯源「从哪个入口发起」；目录插件安装不传。
                    const installChannel = (() => {
                        const raw = body !== null && typeof body === 'object' ? body.installChannel : undefined;
                        return raw === 'npm' ? 'npm' : undefined;
                    })();
                    const settings = loadSettings(profile);
                    // 界面语言（客户端随请求携带）：错误消息按用户当前语言提示（中文界面给中文，英文界面给英文）
                    const lang = typeof body === 'object' && body !== null && body.lang === 'en'
                        ? 'en'
                        : 'zh';
                    // 全局 npm 安装（官方 README 的 `npm install -g <pkgs>`，如 dsh-tui 的安装命令）：
                    // 直接从命令框输入格式执行全局安装，不进任何 profile、无需宿主重启。
                    // 包列表优先取 body.globalNpm（客户端命令框解析后显式携带）；兜底再从 rawRepo 解析，
                    // 保证直接调 API 传完整命令也能识别。
                    const bodyGlobalNpm = Array.isArray(body.globalNpm)
                        ? body.globalNpm.filter((x) => typeof x === 'string' && x !== '')
                        : [];
                    const globalNpm = bodyGlobalNpm.length > 0 ? bodyGlobalNpm : (globalNpmPackagesOf(rawRepo) ?? []);
                    if (globalNpm.length > 0) {
                        // 包名逐个按 npm 包名语法校验 + 拒绝以 - 开头的 token（npm 会把 --xxx 当参数而非包名），数量封顶防滥用
                        if (globalNpm.length > 20 || globalNpm.some((p) => !validPackageName(p) || p.startsWith('-'))) {
                            sendJson(response, 400, { error: 'unsupported install target' });
                            return;
                        }
                        // 通道门禁与安装通道同构：全局安装本质是 npm 操作，吃「启用 NPM 安装」开关
                        if (source !== 'catalog' && !settings.enableNpmInstall) {
                            sendJson(response, 403, { error: 'npm installs are disabled by the security settings' });
                            return;
                        }
                        // 队列级去重：同一包列表已在排队/执行中时拒绝
                        const identity = globalNpm.join(' ');
                        if (hasQueuedTarget(identity)) {
                            sendJson(response, 409, { error: `already queued: ${identity}` });
                            return;
                        }
                        const task = startPluginMutation({
                            action: 'add',
                            profile,
                            target: identity,
                            displayTarget: identity,
                            globalNpm,
                            timeoutMs: COMMAND_TIMEOUT_MS,
                            env: mutationEnv(settings),
                            // 全局 npm 安装由 NPM 包卡片/官方命令发起：日志体现入口渠道
                            installChannel: installChannel ?? 'npm',
                        });
                        sendJson(response, 200, { ok: true, task: task.id });
                        return;
                    }
                    // 自定义安装目标只接受 npm 包名（@scope/name 或 name）：不再识别 GitHub 地址 / release 包。
                    if (!validPackageName(rawRepo)) {
                        sendJson(response, 400, { error: 'unsupported install target: expected an npm package name' });
                        return;
                    }
                    const target = rawRepo;
                    // 已尝试的安装方式（供失败提 Issue 预填）：npm 通道无反查，保持为空
                    const attempts = [];
                    // 代理口径与诊断/安装通道一致：设置里的代理 → 系统代理 → 环境变量 → 直连。
                    const effectiveProxy = settings.proxy !== ''
                        ? settings.proxy
                        : (systemProxy() ?? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? '');
                    // 目录插件安装：目录数据可能滞后于打包拆分，确认目录下发的 npm 目标确为该仓库的 DSH 包，
                    // 命中则记录 repo → 包名映射，客户端据此把依赖 key 匹配回仓库、列表立即显示「已安装」。
                    const catalogRepo = source === 'catalog' ? githubRepoOf(displayRepo) : null;
                    if (catalogRepo !== null) {
                        const catalogTargetIsDsh = await isDshNpmPackageForRepo(rawRepo, catalogRepo, settings.npmRegistry, effectiveProxy);
                        if (catalogTargetIsDsh)
                            recordResolvedNpmPackage(profile, catalogRepo, rawRepo);
                    }
                    // 命令行安装（目录外）受「启用 NPM 安装」开关控制；目录插件安装走目录白名单，不受开关影响。
                    if (source !== 'catalog' && !settings.enableNpmInstall) {
                        sendJson(response, 403, { error: 'npm installs are disabled by the security settings' });
                        return;
                    }
                    // 命中已安装目标时按「更新」语义执行（pnpm add 对已存在依赖本就是原位覆盖重装），
                    // 不再抛 409：客户端的已装列表与服务端实读可能不同步（如页面列表滞后），此时用户点
                    // 「安装」会撞上重复安装守卫，直接覆盖重装比让用户看到一句看不懂的 already installed
                    // 报错友好，最终状态也一致（都是已安装）。
                    const installed = readInstalled(profile);
                    const already = installed[target] !== undefined ? target : null;
                    if (already !== null)
                        mode = 'update';
                    // 队列级去重：同一目标已在排队/执行中时拒绝，避免客户端防重竞态导致重复入队
                    if (hasQueuedTarget(target)) {
                        sendJson(response, 409, { error: `already queued: ${target}` });
                        return;
                    }
                    // 安装前网络连通性预检：探 registry 根（通道的稳定入口，不探具体包 —— 404 表示
                    // 「包不存在」而非网络不通，不该被当成网络故障拦截）。仅新安装预检（更新是已信任
                    // 目标的覆盖重装，跳过）；不通直接 400 拦下并打 [network] 标记，客户端据此提示
                    // 「你的网络不通」，而不是把网络失败当成插件侧问题引导去作者仓库提 Issue。
                    if (already === null) {
                        const probeTarget = `${(settings.npmRegistry.replace(/\/+$/, '') || 'https://registry.npmjs.org')}/`;
                        const net = await probeUrl(probeTarget, effectiveProxy, 6000);
                        if (!net.ok) {
                            // 错误消息按客户端界面语言提示：中文界面给中文、英文界面给英文，
                            // 让用户一眼看懂是网络问题而非插件问题
                            const error = lang === 'zh'
                                ? `[network] 安装已中止：安装前无法连接到 npm 源（${probeTarget}）—— 您的网络似乎不通或被拦截（断网 / DNS 解析失败 / 防火墙 / 代理配置问题）。这不是插件本身的问题，请检查网络连接或代理设置，运行「系统诊断」检测各通道连通性后重试。`
                                : `[network] install aborted: cannot reach the npm registry (${probeTarget}) before install — your network connection appears to be down or blocked (DNS / proxy / firewall). This is not a problem with the plugin itself. Check your connection or proxy settings, run the connectivity diagnostic, then retry.`;
                            sendJson(response, 400, { error, attempts });
                            return;
                        }
                    }
                    // 入队前复检（与上方检查同语义，但必须在同步块内）：预检的 await 期间并发请求
                    // 可能已通过上方检查、任务却尚未入队——此处检查与 startPluginMutation 之间无 await，
                    // JS 单线程保证同一目标至多一个任务，杜绝双击/并发产生双任务
                    if (hasQueuedTarget(target)) {
                        sendJson(response, 409, { error: `already queued: ${target}` });
                        return;
                    }
                    // Kick off the CLI in the background; the client polls /status for progress
                    const task = startPluginMutation({
                        // mode=update（已安装目标的覆盖更新）以 update 动作入队：
                        // 日志按 update 类别落盘（update.start/done/fail），实际 CLI 执行仍是 add <target>@latest
                        action: mode === 'update' ? 'update' : 'add',
                        profile,
                        target,
                        // npm 安装时 target 是包名：displayTarget 固定展示仓库名，待重启行/前端恢复不受通道变化影响
                        displayTarget: githubRepoOf(displayRepo) ?? undefined,
                        // 覆盖更新：npm 命令显式 @latest（pnpm add 无版本对已存在依赖是幂等的，不加版本不会真更新）
                        updateNpm: mode === 'update',
                        // 运行中 loader：安装成功后把新插件热挂进 loader，非桌面端 + 纯服务端插件无需重启即生效
                        loader,
                        timeoutMs: COMMAND_TIMEOUT_MS,
                        env: mutationEnv(settings),
                        // 自定义安装入口渠道：日志/报错据此溯源
                        installChannel,
                    });
                    sendJson(response, 200, { ok: true, task: task.id });
                }
                catch (error) {
                    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        },
        {
            kind: 'exact',
            path: '/dsh-plugin-hub/uninstall',
            handler: async (request, response) => {
                if (!requireTrustedPost(request, response))
                    return;
                // 与安装一致：卸载也进入同一队列，FIFO 串行执行
                try {
                    const body = await readJsonBody(request);
                    const name = typeof body === 'object' && body !== null && typeof body.name === 'string'
                        ? body.name
                        : '';
                    // 展示用的 owner/repo：卸载命令只需要 npm 包名，但待重启行要与安装行一致地显示仓库名
                    const repo = typeof body === 'object' && body !== null && typeof body.repo === 'string'
                        ? body.repo
                        : '';
                    if (!validPackageName(name) || name === 'dsh-plugin') {
                        sendJson(response, 400, { error: 'plugin cannot be uninstalled here' });
                        return;
                    }
                    if (readInstalled(profile)[name] === undefined) {
                        sendJson(response, 400, { error: 'plugin is not installed' });
                        return;
                    }
                    // 队列级去重：同一包已在排队/执行中卸载时拒绝
                    if (hasQueuedTarget(name)) {
                        sendJson(response, 409, { error: `already queued: ${name}` });
                        return;
                    }
                    const task = startPluginMutation({
                        action: 'remove',
                        profile,
                        target: name,
                        // 卸载的 mutation 目标是 npm 包名；待重启行要显示 owner/repo（与安装行一致），非法/缺失时回退包名
                        displayTarget: githubRepoOf(repo) ?? undefined,
                        // 运行中 loader：卸载成功后主动移除条目，立即生效、无需重启
                        loader,
                        timeoutMs: COMMAND_TIMEOUT_MS,
                        env: mutationEnv(loadSettings(profile)),
                    });
                    sendJson(response, 200, { ok: true, task: task.id });
                }
                catch (error) {
                    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        },
    ];
}
