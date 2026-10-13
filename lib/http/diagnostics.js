/**
 * DSH Plugin Hub — the community plugin marketplace for DeepSeek Harness.
 * Website: https://dsh-plugin.org
 * GitHub: https://github.com/dshplugin/dsh-plugin-hub
 *
 * Diagnostics routes: streaming connectivity self-check, proxy verification,
 * and the host environment snapshot shared with the task module's /env route.
 */
import { readFileSync } from 'node:fs';
import { homedir, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadSettings } from '../services/settings.js';
import { gitLsRemote, probeUrl, systemProxy } from '../services/probe.js';
import { appendLog } from '../services/log.js';
import { readJsonBody, requireTrustedPost, sendJson } from './shared.js';
/** 宿主 dsh CLI 版本：优先直接跑 `dsh --version`（与 pnpm/npm/git 同款同步探测，1500ms 超时兜底，
 *  绝不挂起）；拿不到再退回从入口 `process.argv[1]` 向上找 package.json（dsh 不在 PATH 时兜底）。 */
function hostDshVersion() {
    const viaCli = toolVersion('dsh', ['--version']);
    if (viaCli)
        return viaCli;
    const entry = process.argv[1];
    if (entry === undefined)
        return null;
    let dir = dirname(resolve(entry));
    for (let depth = 0; depth < 4; depth++) {
        try {
            const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
            const name = manifest.name ?? '';
            if (typeof manifest.version === 'string' && (name === 'dsh' || name.includes('dsh') || name.includes('harness'))) {
                return manifest.version;
            }
        }
        catch {
            /* not a package root — keep walking up */
        }
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return null;
}
/** 探测命令行工具的版本号（pnpm --version / npm --version / git --version）：
 *  未安装 / 不在 PATH / 超时一律返回 null —— issue 环境快照如实写 unknown，绝不挂起。
 *  （同步探测仅用于启动期/请求期的低频率 /env 快照，安装通道不经过这里。） */
function toolVersion(cmd, args) {
    try {
        const r = spawnSync(cmd, args, { timeout: 1500, encoding: 'utf8' });
        if (r.error || r.status !== 0)
            return null;
        const v = (r.stdout ?? '').trim().split(/\r?\n/)[0];
        return v || null;
    }
    catch {
        return null;
    }
}
/** 宿主环境快照：提交 bug 时随 issue 附上，便于作者复现（前端 /env 端点返回）。 */
export function hostEnv(profile) {
    return {
        dshVersion: hostDshVersion(),
        nodeVersion: process.version,
        pnpmVersion: toolVersion('pnpm', ['--version']),
        npmVersion: toolVersion('npm', ['--version']),
        gitVersion: toolVersion('git', ['--version']),
        platform: process.platform,
        arch: process.arch,
        release: release(),
        profile,
        dshHome: process.env.DSH_HOME ?? join(homedir(), '.dsh'),
    };
}
export function registerDiagnosticsRoutes(webServer, profile) {
    return [
        {
            kind: 'exact',
            path: '/dsh-plugin-hub/diagnostics',
            handler: async (request, response) => {
                if (!requireTrustedPost(request, response))
                    return;
                // 连通性自检：npm registry（镜像/官方）/ GitHub API / 目录站点，逐路探测并测速。
                // 与安装通道一一对应 —— npm 反查与 npm 安装走 registry、git 源走 github、目录数据走 dsh-plugin.org。
                // 流式（NDJSON）逐条上报：每个探测先发命令行，完成后发结果行，客户端以黑窗口终端实时展示。
                // 可选 body { key }：只重测指定通道（页面列表「重测」单项时用），缺省全量串行探测。
                let onlyKey = '';
                try {
                    const body = await readJsonBody(request);
                    if (body !== null && typeof body === 'object' && typeof body.key === 'string') {
                        onlyKey = body.key;
                    }
                }
                catch {
                    // 空 body / 非 JSON：视为全量探测
                }
                const settings = loadSettings(profile);
                // npm 通道：设置里配置了镜像源就探测该镜像（安装通道吃同一个 registry）；
                // 未配置（空串）时探测官方源作为「跟随本机 npm 配置」的基础连通性参考。
                const registry = settings.npmRegistry.replace(/\/+$/, '') || 'https://registry.npmjs.org';
                // 连通性自检直接打安装通道真实访问的轻量资源：npm 源拉包元数据、git 通道探
                // 仓库主页、目录站探 badge 小文件，避免拉取目录全量 JSON。
                // npm 行 display：配置了镜像就显示镜像地址；未配置置空 —— 客户端显示「未配置（跟随本机 npm 配置）」。
                const allChecks = [
                    { key: 'npm', url: `${registry}/dsh-plugin`, display: settings.npmRegistry !== '' ? registry : '', cmd: `npm view dsh-plugin version --registry ${registry}` },
                    // GitHub 行用真实 git 克隆握手（git ls-remote）打 dshplugin/hello-dsh 小仓库：
                    // 「网页能打开」和「git 能克隆」是两码事，握手成功才算通道通；小仓库秒级完成，不打 17MB 的 dsh-plugin-hub。
                    { key: 'github', url: 'https://github.com/dshplugin/hello-dsh', display: 'github.com', cmd: 'git ls-remote https://github.com/dshplugin/hello-dsh', git: true },
                    { key: 'catalog', url: 'https://api.dsh-plugin.org/stats.json', display: '', cmd: 'curl -s https://api.dsh-plugin.org/stats.json' },
                ];
                // 配置了 HTTP 代理：追加一行代理诊断 —— 用该代理打 github.com（安装通道真实访问的地址），
                // 验证「代理能不能把请求带出去」。与安装同口径：curl 子进程注入该代理 env。
                // 设置里未配置代理时不显示该行（跟随系统代理/直连，无「代理本身」可验证）。
                if (settings.proxy !== '') {
                    allChecks.push({ key: 'proxy', url: 'https://github.com', display: settings.proxy, cmd: `curl -s -o /dev/null -x ${settings.proxy} https://github.com`, proxy: settings.proxy });
                }
                const checks = onlyKey !== '' ? allChecks.filter((c) => c.key === onlyKey) : allChecks;
                response.writeHead(200, {
                    'content-type': 'application/x-ndjson; charset=utf-8',
                    'cache-control': 'no-store',
                });
                const send = (line) => { response.write(`${JSON.stringify(line)}\n`); };
                // 探测走代理的优先级：设置里的代理 → 系统代理（macOS scutil / Windows 注册表）→ 环境变量 HTTPS_PROXY → 直连。
                // 与安装通道一致（npm/git 靠 HTTP_PROXY 环境变量走代理），且自动跟随系统代理 ——
                // 浏览器挂着代理能开、诊断就能测通，不用用户手动把代理填进设置。
                // proxy 行例外：它验证的正是「设置里配的那个代理」，必须显式用它（而非 effectiveProxy）去探测。
                const effectiveProxy = settings.proxy !== ''
                    ? settings.proxy
                    : (systemProxy() ?? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? '');
                const probe = (url, proxy) => probeUrl(url, proxy ?? effectiveProxy, 6000);
                // 逐路串行：一条命令一条结果地推送给终端，保持「程序在跑」的真实感
                const results = [];
                for (const c of checks) {
                    send({ type: 'probe', key: c.key, cmd: c.cmd, display: c.display });
                    // git 行走真实克隆握手（gitLsRemote），其余走 curl 探测，两路都带超时兜底
                    const r = c.git
                        ? await gitLsRemote(c.url, c.proxy ?? effectiveProxy, 6000)
                        : await probe(c.url, c.proxy);
                    results.push({ key: c.key, ok: r.ok });
                    // git 行的 status 是退出码，客户端 git 行只显示 OK / 不可达，不显示成 HTTP 码。
                    // reason 透出失败细分原因（如 Windows 证书吊销受阻），客户端据此给对症提示而非笼统「不可达」。
                    send({
                        type: r.ok ? 'ok' : 'fail',
                        key: c.key,
                        display: c.display,
                        ms: r.ms,
                        status: c.git ? null : r.status,
                        reason: r.ok ? null : (r.reason ?? null),
                    });
                }
                send({ type: 'end', at: Date.now() });
                response.end();
                // 系统日志：诊断汇总（全部通过 / 存在不可达）
                const failed = results.filter((r) => !r.ok);
                appendLog(profile, {
                    at: Date.now(),
                    level: failed.length === 0 ? 'success' : 'error',
                    category: 'diagnostics',
                    event: 'diagnostics.done',
                    message: failed.length === 0
                        ? `连通性检测通过（${results.length} 个通道）`
                        : `连通性检测：${failed.length}/${results.length} 个通道不可达`,
                });
            },
        },
        {
            kind: 'exact',
            path: '/dsh-plugin-hub/proxy-check',
            handler: async (request, response) => {
                if (!requireTrustedPost(request, response))
                    return;
                // 代理连通性校验：用待测代理打 dshplugin/hello-dsh 真实仓库页（权威可达目标），
                // 供设置页输入代理时实时反馈「这个地址通不通」。不通过也允许保存 ——
                // 用户可能是先填地址后开代理，因此这里只报告探测结果、不拦截保存。
                let proxy = '';
                let target = 'https://github.com/dshplugin/hello-dsh';
                try {
                    const body = await readJsonBody(request);
                    if (body !== null && typeof body === 'object') {
                        const b = body;
                        if (typeof b.proxy === 'string')
                            proxy = b.proxy.trim();
                        if (typeof b.target === 'string' && b.target.trim() !== '')
                            target = b.target.trim();
                    }
                }
                catch {
                    // 空 body / 非 JSON：按默认目标探测
                }
                if (proxy === '') {
                    sendJson(response, 200, { ok: false, ms: null, status: null, target, reason: 'empty' });
                    return;
                }
                // 探测走该代理本身（不是 effectiveProxy）：验证的就是用户填的这个地址。
                // reason 带上失败细分原因（如证书吊销受阻），设置页才能提示「不是代理地址的问题」。
                const r = await probeUrl(target, proxy, 6000);
                sendJson(response, 200, { ok: r.ok, ms: r.ms, status: r.status, target, reason: r.reason ?? null });
            },
        },
    ];
}
