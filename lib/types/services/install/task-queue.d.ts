import type { InstallResult, InstallTask, Invocation } from './install-types.ts';
import type { LoaderHandle } from '../loader.ts';
/** Snapshot of a task (keeps the live object untouched by consumers). */
export declare function getTask(id: number): InstallTask | undefined;
export interface ActiveTaskInfo {
    id: number;
    target: string;
    action: 'add' | 'remove' | 'update';
    status: 'pending' | 'running';
    progress: number;
    lines: string[];
    /** 尝试过的安装方式（npm 反查 + 实际执行命令）：失败时前端 issue 预填需要 */
    attempts: string[];
    /** 自定义安装入口渠道（NPM 包 / GitHub 源码 / DSH 命令卡片）：前端刷新恢复后仍能精准溯源 */
    installChannel?: 'npm' | 'git' | 'dsh';
}
/** All non-terminal tasks in queue order (running first, then pending). Lets the client resume a queue after a page reload. */
export declare function activeTask(): ActiveTaskInfo[];
/**
 * True while a mutation child process is still alive. The concurrent slot is
 * keyed off the live child set rather than task.status: cancelling a running
 * task flips its status immediately, but the child may still be shutting down
 * (the close event lands later) — the slot must stay held until then, otherwise
 * a new task would start while the old pnpm still runs in the same profile dir.
 */
export declare function hasRunningTask(): boolean;
/** Whether the target already has a non-terminal task in the queue (install/uninstall dedupe). */
export declare function hasQueuedTarget(target: string): boolean;
/**
 * Cancel a queued or running task.
 * - pending: removed from the queue immediately (never spawned).
 * - running: kills the child process; the queue worker then picks the next one.
 * Returns false when the task is unknown or already finished.
 */
export declare function cancelTask(id: number): boolean;
/**
 * 打包桌面端宿主的 CLI 引导脚本路径（`<asar 根>/lib/desktop-cli.js`，即应用内
 * pnpm 服务的 dshBootstrapPath）。宿主入口落在 app.asar 内时按 asar 根反推候选路径，
 * 命中存在的那个才采用；布局不认识（官方改版）时返回 null，调用方回退原逻辑。
 * 导出供单测覆盖路径推导。
 */
export declare function desktopCliBootstrap(entry: string): string | null;
/**
 * Enqueue a plugin mutation and return its task. Tasks run strictly serially:
 * the queue worker starts the next one only after the previous finishes.
 * Progress is visible through `getTask(id)` / `activeTask()` until done.
 */
export declare function startPluginMutation(options: {
    action: 'add' | 'remove' | 'update';
    profile: string;
    target: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    /** 全局 npm 安装（官方 `npm install -g <pkgs>`）：非空时执行全局安装，不进任何 profile、无需宿主重启 */
    globalNpm?: string[];
    /** 待重启行的展示目标（owner/repo）：卸载时用于把 npm 包名映射回仓库名 */
    displayTarget?: string;
    /** 运行中 loader：安装成功后热挂新条目、卸载成功后停用旧条目，两类操作都尽量立即生效
     *  （缺失时安装/卸载仍需重启） */
    loader?: LoaderHandle;
    /** 入队前已尝试的安装方式（npm registry 反查等）：失败提 Issue 时如实展示；实际执行的命令由 spawn 时追加 */
    attempts?: string[];
    /** 更新已安装的 npm 包（mode=update）：命令显式带 @latest，让 pnpm 真正解析最新版本 */
    updateNpm?: boolean;
    /** 自定义安装入口渠道（客户端三张卡片：NPM 包 / GitHub 源码 / DSH 命令）：
     *  任务输出行与系统日志据此溯源「从哪个入口发起」；目录插件安装不传 */
    installChannel?: 'npm' | 'git' | 'dsh';
}): InstallTask;
/**
 * 安装后校验已装包里 package.json 声明的文件（main / exports["."].default 与
 * dsh.bundle.patch）是否真实存在。git: 分发常不提交构建产物（lib/ 等），pnpm 装完没有
 * 报错，但宿主重启加载插件树时会 ERR_MODULE_NOT_FOUND 直接崩溃、网页打不开 —— 这里在
 * 登记「待重启」前就把这类残缺包拦下。没有声明过的文件不在这里追究：没声明入口的
 * bundle 包（只挂技能）本来就不需要入口，宿主读的是它的 package.json 与声明的补丁。
 * 返回 { name, missing }：name 为空表示无法定位目标包（跳过校验）；missing 为缺失文件的路径。
 */
export declare function verifyInstalledEntry(profile: string, target: string): {
    name: string | null;
    missing: string | null;
};
/**
 * 宿主自身 CLI 调不起来时的 ASCII 标记行：spawn 我们解析出的宿主入口报 ENOENT 时返回
 * `[host-spawn]`，供前端单独归因、不引导提 Issue。PATH 上的 dsh/npm 各有自己的标记，返回 null。
 * 导出供单测覆盖判据。
 */
export declare function hostSpawnMarker(invocation: Invocation, error: unknown): string | null;
/**
 * Run a plugin mutation with one recovery path: when `add` fails because
 * pnpm's allowBuilds gate blocks a build script — either the git-hosted
 * package's own `prepare` (`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`, key from
 * the printed key@url hint) or a dependency's native build
 * (`ERR_PNPM_IGNORED_BUILDS`, key = the listed name@version) — write the
 * exact keys into the profile's pnpm-workspace.yaml and retry once.
 * Other failures fall through to the single-spawn result.
 */
export declare function runPluginMutation(options: {
    action: 'add' | 'remove' | 'update';
    profile: string;
    target: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    task?: InstallTask;
    /** 待重启行的展示目标（owner/repo）：卸载时用于把 npm 包名映射回仓库名 */
    displayTarget?: string;
    /** 运行中 loader：安装成功后热挂新条目、卸载成功后停用旧条目（缺失时仍需重启） */
    loader?: LoaderHandle;
    /** 全局 npm 安装（官方 `npm install -g <pkgs>`）：非空时执行全局安装，不进任何 profile、无需宿主重启 */
    globalNpm?: string[];
}): Promise<InstallResult>;
