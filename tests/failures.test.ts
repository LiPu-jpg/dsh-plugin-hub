/**
 * DSH Plugin Hub — the community plugin marketplace for DeepSeek Harness.
 * Website: https://dsh-plugin.org
 * GitHub: https://github.com/dshplugin/dsh-plugin-hub
 *
 * Unit tests for the failure classifier and the core-error collector
 * (src/client/logic/failures.ts).
 *
 * Run with the Node built-in test runner: `npm test` (Node >= 22.6 with
 * type stripping). No extra test dependencies required.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyFailure, coreErrorCode, missingRegistryPackageOf, npmTooLowVersion, registryMissingHintOf, summarizeError, unreachableTargetOf, registryHostOf, actionOfRecord, actionWordEn, actionWordZh } from '../src/client/logic/failures.ts'

const dshTailHint = 'dsh: git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed — add the exact key pnpm printed above under allowBuilds in /Users/x/.dsh/profiles/web/pnpm-workspace.yaml, then re-run'

test('classifyFailure: git prepare blocked by the allowlist is a plugin distribution issue (pnpmIgnoredBuild)', () => {
  assert.equal(classifyFailure('[ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED] ... not in the "allowBuilds" allowlist'), 'pnpmIgnoredBuild')
})

test('classifyFailure: [npm-too-low] marker from the server is a local npm issue, not a plugin issue', () => {
  const msg = [
    '[ERR_PNPM_PREPARE_PACKAGE] Failed to prepare git-hosted package fetched from "https://codeload.github.com/x/y/tar.gz/abc"',
    'npm error Cannot read properties of null (reading \'edgesOut\')',
    '[npm-too-low] npm@11.3.0 — npm arborist crashed while resolving peer deps (\'edgesOut\'); local npm is below 11.6.0; upgrade npm (npm install -g npm@latest) and retry',
    '[exit 1]',
  ].join('\n')
  assert.equal(classifyFailure(msg), 'npmTooOld')
})

test('classifyFailure: edgesOut crash inside ERR_PNPM_PREPARE_PACKAGE is npmTooOld, not pluginPrepare (history records without the marker)', () => {
  const msg = [
    '[ERR_PNPM_PREPARE_PACKAGE] Failed to prepare git-hosted package fetched from "https://codeload.github.com/meisam2236/agent-board/tar.gz/abc"',
    'npm error Cannot read properties of null (reading \'edgesOut\')',
    dshTailHint,
    '[exit 1]',
  ].join('\n')
  assert.equal(classifyFailure(msg), 'npmTooOld')
})

test('classifyFailure: ignored native-module builds are a plugin issue, even with the host hint attached', () => {
  const msg = [
    '[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: node-pty@1.1.0',
    'Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.',
    dshTailHint,
    '[exit 1]',
  ].join('\n')
  assert.equal(classifyFailure(msg), 'pnpmIgnoredBuild')
})

test('classifyFailure: the host hint alone (no raw pnpm code in the log) is still an allowlist block (issue #210)', () => {
  // 新版宿主把 pnpm 报错只写进 diagnostics 日志文件，终端里只留摘要行 —— 日志里一条 ERR_PNPM_* 都没有
  const msg = [
    'dsh: plugin command failed; diagnostics: C:\\Users\\wanda\\.dsh\\profiles\\desktop\\.plugin-manager\\logs\\operation-qmFtOx\\pnpm.log',
    dshTailHint,
  ].join('\n')
  assert.equal(classifyFailure(msg), 'pnpmIgnoredBuild')
})

test('classifyFailure: prepare script actually failing is a plugin issue, even with the host hint attached', () => {
  const msg = [
    '[ERR_PNPM_PREPARE_PACKAGE] Failed to prepare git-hosted package fetched from "https://codeload.github.com/ccch1mneyyy/dsh-tui/tar.gz/abc": @deepseek-harness-tui/dsh-tui@0.8.6 pnpm-install: `pnpm install`',
    dshTailHint,
    '[exit 1]',
  ].join('\n')
  assert.equal(classifyFailure(msg), 'pluginPrepare')
})

test('classifyFailure: git fetch timeout (issue #10) is a network issue, not a plugin issue', () => {
  const msg = [
    'ERR_PNPM_GIT_FETCH_FAILED Git fetch failed: "git fetch https://github.com/adoresever/graph-memory HEAD ..."',
    'fatal: unable to access \'https://github.com/adoresever/graph-memory/\': Failed to connect to github.com port 443: Timed out',
    '[exit 1]',
  ].join('\n')
  assert.equal(classifyFailure(msg), 'network')
})

test('classifyFailure: [network] marker from the server pre-check is a network issue', () => {
  const msg = '[network] install aborted: cannot reach github.com (https://github.com/) before install — your network connection appears to be down or blocked (DNS / proxy / firewall).'
  assert.equal(classifyFailure(msg), 'network')
})

test('classifyFailure: DNS / connection-reset / TLS failures are network issues, even wrapped by Command failed', () => {
  assert.equal(classifyFailure('Command failed: git fetch https://github.com/x/y\nfatal: unable to access: Could not resolve host: github.com'), 'network')
  assert.equal(classifyFailure('pnpm error code ECONNRESET\npnpm error network socket hang up'), 'network')
  assert.equal(classifyFailure('getaddrinfo ENOTFOUND registry.npmjs.org'), 'network')
  assert.equal(classifyFailure('SSL certificate problem: unable to get local issuer certificate'), 'network')
})

test('classifyFailure: a symbolic undici error code in a tarball retry line is a network issue (issue #217)', () => {
  // #217：pnpm 重试行括号里是 undici 的符号错误码（UND_ERR_SOCKET），不是数字码 —— 同样是网络问题
  const msg = [
    '[WARN] GET https://registry.npmjs.org/@img/sharp-libvips-darwin-x64/-/sharp-libvips-darwin-x64-1.3.4.tgz error (UND_ERR_SOCKET). Will retry in 10 seconds. 2 retries left.',
    'dsh: pnpm failed in profile directory C:\\Users\\Administrator\\.dsh\\profiles\\desktop',
  ].join('\n')
  assert.equal(classifyFailure(msg), 'network')
  assert.notEqual(classifyFailure(msg), 'hub')
  // 数字码（#32 的 error (0)）与符号码两种形态都要认，且不依赖其它关键字
  assert.equal(classifyFailure('[WARN] GET https://registry.npmjs.org/x/-/x-1.0.0.tgz error (0). Will retry in 10 seconds. 2 retries left.'), 'network')
  assert.equal(classifyFailure('[WARN] GET https://registry.npmjs.org/x/-/x-1.0.0.tgz error (UND_ERR_CONNECT_TIMEOUT). Will retry in 10 seconds. 2 retries left.'), 'network')
})

test('classifyFailure: allowBuilds rejection wins over trailing connection-failure noise (graph-memory #82-#84)', () => {
  // #84：主因是插件 prepare 脚本被 allowBuilds 拦截（tarball 已下载、网络是通的），
  // 日志尾部混着重试残留的 ETIMEDOUT / Failed to connect —— 不能误判成网络问题
  const mixed = [
    '[ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED] Failed to prepare git-hosted package fetched from "https://codeload.github.com/adoresever/graph-memory/tar.gz/66183143": The git-hosted package "graph-memory@1.6.0-beta.8" needs to execute build scripts but is not in the "allowBuilds" allowlist.',
    '[WARN] HEAD https://github.com/adoresever/graph-memory error (ETIMEDOUT). Will retry in 500 milliseconds. 2 retries left.',
    '[ERR_PNPM_GIT_RESOLVE_FAILED] Failed to resolve git dependency "git+https://github.com/adoresever/graph-memory.git": git ls-remote failed: fatal: unable to access \'https://github.com/adoresever/graph-memory.git/\': Failed to connect to github.com:443 after 21356 ms: Could not connect to server',
  ].join('\n')
  assert.equal(classifyFailure(mixed), 'pnpmIgnoredBuild')
  // #82 / #83：PREPARE_NOT_ALLOWED + PREPARE_PACKAGE（prepare 被白名单拦截后脚本链失败）
  assert.equal(classifyFailure('[ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED] ... needs to execute build scripts but is not in the "allowBuilds" allowlist.\n[ERR_PNPM_PREPARE_PACKAGE] Failed to prepare git-hosted package fetched from "...": graph-memory@1.6.0-beta.8 npm-install: `npm install`'), 'pnpmIgnoredBuild')
  // 纯 IGNORED_BUILDS（原生模块构建被忽略）仍是 pnpmIgnoredBuild
  assert.equal(classifyFailure('pnpm-install: [ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: node-pty, esbuild'), 'pnpmIgnoredBuild')
})

test('classifyFailure: pure git fetch timeout without allowBuilds noise stays a network issue (graph-memory #87)', () => {
  const msg = [
    '[WARN] HEAD https://github.com/adoresever/graph-memory error (ETIMEDOUT). Will retry in 500 milliseconds. 2 retries left.',
    '[ERR_PNPM_GIT_FETCH_FAILED] Failed to fetch from the git repository "https://github.com/adoresever/graph-memory.git": fatal: unable to access \'https://github.com/adoresever/graph-memory.git/\': Failed to connect to github.com port 443 after 21027 ms: Timed out',
    '[exit 1]',
  ].join('\n')
  assert.equal(classifyFailure(msg), 'network')
})

test('npmTooLowVersion extracts the version from the marker, null otherwise', () => {
  assert.equal(npmTooLowVersion('[npm-too-low] npm@11.3.0 — npm arborist crashed'), '11.3.0')
  assert.equal(npmTooLowVersion('no marker here'), null)
})

test('classifyFailure: dsh command missing on the machine is an environment issue (issue #12), not a plugin issue', () => {
  // Windows cmd: 'dsh' 不是内部或外部命令
  assert.equal(classifyFailure("'dsh' \u4e0d\u662f\u5185\u90e8\u6216\u5916\u90e8\u547d\u4ee4\uff0c\u4e5f\u4e0d\u662f\u53ef\u8fd0\u884c\u7684\u7a0b\u5e8f\n\u6216\u6279\u5904\u7406\u6587\u4ef6\u3002"), 'dshMissing')
  // Windows cmd (English)
  assert.equal(classifyFailure("'dsh' is not recognized as an internal or external command,"), 'dshMissing')
  // POSIX shell
  assert.equal(classifyFailure('sh: dsh: command not found'), 'dshMissing')
  // node spawn ENOENT
  assert.equal(classifyFailure('spawn dsh ENOENT'), 'dshMissing')
  // 服务端 [dsh-missing] 标记（乱码免疫）：Windows cmd 中文版输出 GBK 被 UTF-8 误解码成乱码，
  // 原文匹配不了，服务端 spawn 前探测后打 ASCII 标记，前端据此归类
  assert.equal(classifyFailure('[dsh-missing] the dsh CLI was not found on this machine'), 'dshMissing')
  assert.equal(classifyFailure("'dsh' \u951f\u62b7\u6546\u662f\u9550\u5927\u90e8\u6216\u5916\u90e8\u547d\u4ee4 \u2026\n[dsh-missing] the dsh CLI was not found"), 'dshMissing')
  // 即使被外层 "Command failed" 包裹也必须归类为环境问题，不能被吞成插件问题
  assert.equal(classifyFailure("Command failed: dsh plugin add github:owner/repo\n'dsh' \u4e0d\u662f\u5185\u90e8\u6216\u5916\u90e8\u547d\u4ee4\uff0c\u4e5f\u4e0d\u662f\u53ef\u8fd0\u884c\u7684\u7a0b\u5e8f\u3002"), 'dshMissing')
})

test('classifyFailure: missing git executable is an environment issue (issue #21), not a plugin issue', () => {
  // Windows cmd (Chinese)
  assert.equal(classifyFailure("'git' \u4e0d\u662f\u5185\u90e8\u6216\u5916\u90e8\u547d\u4ee4\uff0c\u4e5f\u4e0d\u662f\u53ef\u8fd0\u884c\u7684\u7a0b\u5e8f\u3002"), 'gitMissing')
  // Windows cmd (English)
  assert.equal(classifyFailure("'git' is not recognized as an internal or external command,"), 'gitMissing')
  // POSIX shell
  assert.equal(classifyFailure('sh: git: command not found'), 'gitMissing')
  // node spawn ENOENT
  assert.equal(classifyFailure('spawn git ENOENT'), 'gitMissing')
  // 服务端 [git-missing] 标记（乱码免疫）
  assert.equal(classifyFailure('[git-missing] the git CLI was not found on this machine'), 'gitMissing')
  // 作者场景：pnpm 把缺 git 报成 ERR_PNPM_GIT_RESOLVE_FAILED（git ls-remote failed），
  // 且外层无包裹也必须归类为环境问题，不能被吞成 dshMissing（dshMissing 正则含裸 is not recognized）
  assert.equal(
    classifyFailure("[ERR_PNPM_GIT_RESOLVE_FAILED] Failed to resolve git dependency\ngit ls-remote failed: 'git' is not recognized as an internal or external command"),
    'gitMissing',
  )
  // 优先级：git 缺失必须先于 dshMissing 判出（裸 is not recognized 模式不能吞掉 'git'）
  assert.equal(classifyFailure("Command failed: git ls-remote\n'git' is not recognized as an internal or external command"), 'gitMissing')
})

test('classifyFailure: missing npm executable is an environment issue, not a plugin issue', () => {
  // Windows cmd (Chinese)
  assert.equal(classifyFailure("'npm' \u4e0d\u662f\u5185\u90e8\u6216\u5916\u90e8\u547d\u4ee4\uff0c\u4e5f\u4e0d\u662f\u53ef\u8fd0\u884c\u7684\u7a0b\u5e8f\u3002"), 'npmMissing')
  // Windows cmd (English)
  assert.equal(classifyFailure("'npm' is not recognized as an internal or external command,"), 'npmMissing')
  // POSIX shell
  assert.equal(classifyFailure('sh: npm: command not found'), 'npmMissing')
  // node spawn ENOENT
  assert.equal(classifyFailure('spawn npm ENOENT'), 'npmMissing')
  // 服务端 [npm-missing] 标记（乱码免疫）
  assert.equal(classifyFailure('[npm-missing] the npm CLI was not found on this machine'), 'npmMissing')
  // 优先级：npm 缺失必须先于 dshMissing 判出（裸 is not recognized 模式不能吞掉 'npm'）
  assert.equal(classifyFailure("Command failed: npm install -g foo\n'npm' is not recognized as an internal or external command"), 'npmMissing')
})

test('classifyFailure: pnpm command missing is an environment issue (issue #13), not a plugin issue', () => {
  // dsh 存在但缺 pnpm（dsh 用它管理 profile 插件）：issue #13 的真实报错（Linux）
  assert.equal(classifyFailure('dsh: pnpm not found on PATH — install pnpm to manage profile plugins'), 'pnpmMissing')
  // POSIX shell
  assert.equal(classifyFailure('sh: pnpm: command not found'), 'pnpmMissing')
  // node spawn ENOENT
  assert.equal(classifyFailure('spawn pnpm ENOENT'), 'pnpmMissing')
  // Windows cmd 中英文
  assert.equal(classifyFailure("'pnpm' \u4e0d\u662f\u5185\u90e8\u6216\u5916\u90e8\u547d\u4ee4\uff0c\u4e5f\u4e0d\u662f\u53ef\u8fd0\u884c\u7684\u7a0b\u5e8f\u3002"), 'pnpmMissing')
  assert.equal(classifyFailure("'pnpm' is not recognized as an internal or external command"), 'pnpmMissing')
  // 服务端 [pnpm-missing] 标记（乱码免疫）
  assert.equal(classifyFailure('[pnpm-missing] the pnpm CLI was not found on this machine'), 'pnpmMissing')
  // 优先级：pnpm 缺失不能被 dshMissing（裸 command not found）或插件侧（Command failed）吞掉
  assert.equal(classifyFailure('Command failed: dsh plugin add github:owner/repo\nsh: pnpm: command not found'), 'pnpmMissing')
})

test('classifyFailure: pnpm store version mismatch is an environment issue (issue #14), not a plugin issue', () => {
  assert.equal(classifyFailure('[ERR_PNPM_UNEXPECTED_STORE] Unexpected store location\n(This error may happen if the node_modules was installed with a different major version of pnpm)\ndsh: pnpm failed in profile directory /Users/xxx/.dsh/profiles/web'), 'pnpmStore')
  assert.equal(classifyFailure('dsh: pnpm failed in profile directory /Users/xxx/.dsh/profiles/web\n[ERR_PNPM_UNEXPECTED_STORE] Unexpected store location'), 'pnpmStore')
  // 裸 Unexpected store location（无 ERR_ 前缀）也要能归到 pnpmStore
  assert.equal(classifyFailure('Unexpected store location: expected /Users/xxx/.pnpm-store, got /Users/xxx/.pnpm-store/v10'), 'pnpmStore')
})

test('classifyFailure: virtual store location mismatch is an environment issue (issue #30), not a plugin issue', () => {
  // profile 目录被复制/移动、virtual-store-dir 配置变化 → ERR_PNPM_UNEXPECTED_VIRTUAL_STORE
  assert.equal(classifyFailure('[ERR_PNPM_UNEXPECTED_VIRTUAL_STORE] Unexpected virtual store location\ndsh: pnpm failed in profile directory C:\\Users\\zijin\\.dsh-desktop\\profiles\\web'), 'pnpmStore')
  // 裸 Unexpected virtual store location（无 ERR_ 前缀）也要能归到 pnpmStore
  assert.equal(classifyFailure('Unexpected virtual store location: the modules directory is linked to a different virtual store'), 'pnpmStore')
  // 验证该错误码不落入「插件侧失败」兜底
  assert.equal(classifyFailure('[ERR_PNPM_UNEXPECTED_VIRTUAL_STORE] Unexpected virtual store location'), 'pnpmStore')
})

test('classifyFailure: pnpm supply-chain policy blocks are environment issues (issues #15/#16), not plugin issues', () => {
  // #15：minimumReleaseAge —— 锁文件里包的发布时间太近被 pnpm 11 拒收（用户装刚发布的官方插件）
  assert.equal(classifyFailure('[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 2 lockfile entries failed verification\nSome packages are not released long enough to be installed\n(use minimumReleaseAge setting to adjust)'), 'pnpmPolicy')
  assert.equal(classifyFailure('Minimum release age of @scope/pkg is 1 day, but the package was published 2 hours ago'), 'pnpmPolicy')
  // #16：untrusted origin —— 依赖来源未受本机 pnpm 信任
  assert.equal(classifyFailure('untrusted origin\ndsh: pnpm failed in profile directory /Users/xxx/.dsh/profiles/web'), 'pnpmPolicy')
  assert.equal(classifyFailure('ERR_PNPM_UNTRUSTED_ORIGIN untrusted origin for @scope/pkg'), 'pnpmPolicy')
  // 这两类都必须优先于「构建脚本被白名单拦截 / Command failed / 兜底 repo」
  assert.equal(classifyFailure('ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION ... Command failed: pnpm add'), 'pnpmPolicy')
})

test('classifyFailure: the local hub service\'s bare `untrusted origin` 403 is originRejected, not pnpmPolicy (issue #70)', () => {
  // 服务端 requireTrustedPost 的 403 正文恰好是裸 `untrusted origin`（整行以它结尾）：
  // 请求在进入安装流程前就被拦下，与 pnpm 无关 —— 不能与 pnpmPolicy 同归一类，后者的
  // 解法（删 profile 的 node_modules + pnpm-lock.yaml）对本类无效（dsh-plugin-hub#70）
  assert.equal(classifyFailure('untrusted origin'), 'originRejected')
  // useTaskQueue 把服务端 error 字段拼在 install 命令行之后，同样以它结尾
  assert.equal(classifyFailure('[install] dsh-plugin\nuntrusted origin'), 'originRejected')
  // 尾随空白不影响判定
  assert.equal(classifyFailure('untrusted origin\n'), 'originRejected')
  // 反过来：pnpm 的真实报错尾部还有 dsh 的上下文，不能被抢走（见上一条 #16 用例，仍是 pnpmPolicy）
  assert.notEqual(classifyFailure('untrusted origin\ndsh: pnpm failed in profile directory /Users/xxx/.dsh/profiles/web'), 'originRejected')
})

test('classifyFailure: pnpm workspace-root check is an environment issue (issue #40), not a plugin issue', () => {
  // #40：宿主在 profile 目录（pnpm 视为 workspace 根）执行 pnpm add 时未声明在根操作 →
  // pnpm 直接拒绝，任何插件都装不上
  assert.equal(
    classifyFailure('ERR_PNPM_ADDING_TO_ROOT  Running this command will add the dependency to the workspace root, which might not be what you want - if you really meant it, make it explicit by running this command again with the -w flag (or --workspace-root). If you do not want to see this warning anymore, you may set the ignore-workspace-root-check setting to true.\ndsh: pnpm failed in profile directory C:\\Users\\five\\.dsh\\profiles\\web'),
    'pnpmWorkspace',
  )
  // 只带说明句（无错误码）也要能归到 pnpmWorkspace
  assert.equal(classifyFailure('Running this command will add the dependency to the workspace root, which might not be what you want'), 'pnpmWorkspace')
  // 不落入「插件侧失败」兜底
  assert.equal(classifyFailure('ERR_PNPM_ADDING_TO_ROOT'), 'pnpmWorkspace')
})

test('classifyFailure: a stale pnpm patch entry on the machine is an environment issue (issue #48), not a plugin issue', () => {
  // #48：profile 里留着指向旧版本 dsh-plugin 的 patch 声明，本次安装解析到的版本已不是它，
  // pnpm 发现补丁没被用上即中止整次安装 —— 任何插件都装不进来
  const msg = [
    '[ERR_PNPM_UNUSED_PATCH] The following patches were not used: dsh-plugin@1.4.2',
    'dsh: pnpm failed in profile directory /home/zhongsy/.dsh/profiles/web',
  ].join('\n')
  assert.equal(classifyFailure(msg), 'pnpmUnusedPatch')
  // 不能被 repo 兜底吞掉：旧逻辑会把 #48 误报成「插件侧安装失败」引导去提 Issue
  assert.notEqual(classifyFailure(msg), 'pluginPrepare')
  // 只带说明句（无错误码）也要能归到 pnpmUnusedPatch，且优先于「Command failed」的插件侧判定
  assert.equal(classifyFailure('The following patches were not used: dsh-plugin@1.4.2\nCommand failed: pnpm add'), 'pnpmUnusedPatch')
})

test('classifyFailure: a locked file inside the profile is an environment issue (issue #47), not a plugin issue', () => {
  // #47：Windows 下 profile 里的文件被其他进程占用，pnpm 无法替换。中文原文经解码后可能残缺，
  // 靠 ASCII 特征 os error 32 命中（乱码免疫），不能要求匹配中文原句
  const msg = [
    'Error:',
    '\u4ef6\uff0c\u8fdb\u7a0b\u65e0\u6cd5\u8bbf\u95ee\u3002 (os error 32)',
    'dsh: pnpm failed in profile directory C:\\Users\\ZeKun\\.dsh\\profiles\\web',
  ].join('\n')
  assert.equal(classifyFailure(msg), 'fileLocked')
  assert.notEqual(classifyFailure(msg), 'pluginPrepare')
  // 其他形态的占用报错（EBUSY / 英文原句）同样归到 fileLocked
  assert.equal(classifyFailure('EBUSY: resource busy or locked, rename ...'), 'fileLocked')
  assert.equal(classifyFailure('Error: the process cannot access the file because it is being used by another process'), 'fileLocked')
})

test('classifyFailure: a write access denial inside the profile is an environment issue (issue #50), not a plugin issue', () => {
  // #50：Windows 下 pnpm 在 swap 阶段替换 profile 里的文件被系统拒绝（os error 5 = ERROR_ACCESS_DENIED，
  // 中文为「拒绝访问」）。中文原文经 GBK→UTF-8 解码会残缺，靠 ASCII 特征 os error 5 命中（乱码免疫）
  const msg = [
    'Error:',
    '\u00d7 adding a new package',
    'swap: \u62d2\u7edd\u8bbf\u95ee\u3002 (os error 5)',
    'dsh: pnpm failed in profile directory C:\\Users\\Administrator\\AppData\\Roaming\\Deepseek-Harness-Desktop\\dsh-home\\profiles\\web',
  ].join('\n')
  assert.equal(classifyFailure(msg), 'accessDenied')
  assert.notEqual(classifyFailure(msg), 'pluginPrepare')
  // 语义与 os error 32（文件被占用）不同，不能被 fileLocked 分支抢走
  assert.notEqual(classifyFailure(msg), 'fileLocked')
  // Node 层的权限码与 Windows 英文原句同样归到 accessDenied
  assert.equal(classifyFailure('EPERM: operation not permitted, rename ...'), 'accessDenied')
  assert.equal(classifyFailure('EACCES: permission denied, unlink ...'), 'accessDenied')
  assert.equal(classifyFailure('Error: Access is denied. (os error 5)'), 'accessDenied')
  // 不能被后续分支抢走：普通安装失败仍归插件侧（避免新分支过宽）
  assert.equal(classifyFailure('Command failed: pnpm add some-plugin'), 'pluginPrepare')
})

test('classifyFailure: a file system that cannot accept writes is an environment issue, not a plugin issue', () => {
  // 在 pnpm 落盘阶段报错：磁盘写不进去时任何插件都装不上，不能落 repo 兜底引导用户去插件仓库提 Issue
  assert.equal(classifyFailure('Error: ENOSPC: no space left on device, write'), 'fsUnavailable')
  assert.equal(classifyFailure('npm ERR! code ENOSPC\nnpm ERR! syscall write'), 'fsUnavailable')
  assert.equal(classifyFailure('Error: EROFS: read-only file system, mkdir ...'), 'fsUnavailable')
  assert.equal(classifyFailure('Error: EMFILE: too many open files, open ...'), 'fsUnavailable')
  assert.equal(classifyFailure('Error: ENFILE: file table overflow'), 'fsUnavailable')
  // Windows 形态：只认 ASCII 错误码（中文原文经 GBK→UTF-8 解码会残缺）
  assert.equal(classifyFailure('write: There is not enough space on the disk. (os error 112)'), 'fsUnavailable')
  assert.equal(classifyFailure('mkdir: The media is write protected. (os error 19)'), 'fsUnavailable')
  assert.notEqual(classifyFailure('Error: ENOSPC: no space left on device, write'), 'pluginPrepare')
  // 磁盘满时 pnpm 日志尾部常混着超时/重试特征，不能被 network 抢走
  assert.notEqual(classifyFailure('Error: ENOSPC: no space left on device\nETIMEDOUT'), 'network')
  // 不能被后续分支抢走：普通安装失败仍归插件侧（避免新分支过宽）
  assert.equal(classifyFailure('Command failed: pnpm add some-plugin'), 'pluginPrepare')
})

test('classifyFailure: the browser "Failed to fetch" on the host request is an environment issue (issue #45), not a plugin issue', () => {
  const msg = '安装失败 — Failed to fetch'
  assert.equal(classifyFailure(msg), 'network')
  assert.notEqual(classifyFailure(msg), 'pluginPrepare')
})

test('classifyFailure: hub state-guard messages are hubState, not plugin-side (issue #187)', () => {
  // 这些字符串由本服务的守卫发出（未安装 / 不在此处卸载 / 已在队列中），不是 CLI 输出、也不是插件问题
  assert.equal(classifyFailure('plugin is not installed'), 'hubState')
  assert.equal(classifyFailure('plugin cannot be uninstalled here'), 'hubState')
  assert.equal(classifyFailure('already queued: some-plugin'), 'hubState')
  // 不能被误判成插件侧（会去提作者 Issue），也不是未知兜底
  assert.notEqual(classifyFailure('plugin is not installed'), 'pluginPrepare')
  assert.notEqual(classifyFailure('plugin is not installed'), 'hub')
})

test('classifyFailure: the short "already installed" guard line is hubState, not an unknown failure (issue #193)', () => {
  // 旧版本守卫在「目标已安装」时返回的整行短消息：已装列表与服务端实读不同步，不是插件问题
  assert.equal(classifyFailure('already installed: dsh-cuigengji-plugin'), 'hubState')
  // 前面带一行说明（自定义安装会先加一行入口渠道）时同样命中
  assert.equal(classifyFailure('some prefix line\nalready installed: dsh-cuigengji-plugin'), 'hubState')
  // 包名冲突那条带「——」说明，是另一回事，不能按状态不同步提示
  assert.notEqual(
    classifyFailure('already installed: dsh-cuigengji-plugin —— mistnest/dsh-cuigengji-plugin 声明的 npm 包名「dsh-cuigengji-plugin」已存在于当前 profile'),
    'hubState',
  )
})

test('classifyFailure: our own timeout marker is a timeout, not an unknown failure (issue #197)', () => {
  // 命令跑满本地上限被强杀时安装器打的标记：既不是插件问题、也不是用户环境问题，而且可能其实已装成功
  const msg = [
    'Progress: resolved 68, reused 26, downloaded 21, added 21, done',
    'Done in 7.1s using pnpm v11.7.0',
    '[timed out]',
  ].join('\n')
  assert.equal(classifyFailure(msg), 'timeout')
  assert.notEqual(classifyFailure(msg), 'hub')
  // 日志里真有 pnpm 报错时以真实报错为准（超时归类只是兜底）
  assert.equal(classifyFailure('[ERR_PNPM_FETCH_404] GET https://registry.npmjs.org/x: Not Found - 404\n[timed out]'), 'pnpmMissingDep')
  // 超时后复核「其实已装成功」时打的说明行不是失败信号
  assert.notEqual(classifyFailure('[timeout] the install had already completed — treating it as a success'), 'timeout')
})

test('classifyFailure: DSH waiting on its own profile writer lock is a profileLock, not an unknown failure (issue #206)', () => {
  // DSH 原子写 profile 时等不到 package.json.lock（同一 profile 有别的 dsh 进程/安装任务在写）：
  // 既不是插件问题、也不是用户环境坏了，给「收掉并发再重试」的可行动提示，不引导提 Issue
  const msg = [
    'if (Date.now() >= deadline) throw new Error(`atomic-write: timed out waiting for the writer lock at ${lockPath}`);',
    'Error: atomic-write: timed out waiting for the writer lock at /home/UOS/.dsh/profiles/web/package.json.lock',
  ].join('\n')
  assert.equal(classifyFailure(msg), 'profileLock')
  assert.notEqual(classifyFailure(msg), 'hub')
})

test('classifyFailure: 官方 registry 复核结果决定「缺包」的责任方（作者侧 vs 本机镜像）', () => {
  // 服务端用官方源复查：官方上也没有 → 作者侧问题（插件的依赖没发布/已被删除）
  const missing = [
    '[ERR_PNPM_FETCH_404] GET https://registry.npmjs.org/foo-dep: Not Found - 404',
    '[registry-missing] foo-dep is not published on the official npm registry (registry.npmjs.org) — a dependency of this plugin is missing or was removed; author-side issue',
  ].join('\n')
  assert.equal(classifyFailure(missing), 'pluginMissingDep')
  // 官方上有 → 本机镜像源未同步：维持「用户环境」分类，不改归属
  const mirrorLag = [
    '[ERR_PNPM_FETCH_404] GET https://registry.npmmirror.com/foo-dep: Not Found - 404',
    '[registry-mirror-lag] foo-dep exists on the official npm registry — the configured registry or mirror has not synced it; local environment issue',
  ].join('\n')
  assert.equal(classifyFailure(mirrorLag), 'pnpmMissingDep')
  // 无标记（服务端没复核、或复核不出结论）时沿用既有判定：profile 残留依赖（#73）
  assert.equal(classifyFailure('[ERR_PNPM_FETCH_404] GET https://registry.npmjs.org/x: Not Found - 404'), 'pnpmMissingDep')
  // 提示变体：镜像滞后提示换源；其余沿用「删除 profile 里的残留依赖」
  assert.equal(registryMissingHintOf(mirrorLag), 'failRegistryMirrorLagHint')
  assert.equal(registryMissingHintOf('[ERR_PNPM_FETCH_404] GET https://registry.npmjs.org/x: Not Found - 404'), 'failPnpmMissingDepHint')
})

test('classifyFailure: a dependency missing from the registry is an environment issue (issue #73), not a plugin issue', () => {
  // profile 里既存依赖 dsh-our-free-model 在 npm 上不存在：pnpm 解析依赖时先卡在它上面，
  // 日志尾部只有宿主那句通用的 `dsh: plugin command failed`
  const msg = [
    '[ERR_PNPM_FETCH_404] GET https://registry.npmjs.org/dsh-our-free-model: Not Found - 404',
    'This error happened while installing a direct dependency of C:\\Users\\xiangyu\\.dsh\\profiles\\desktop',
    'dsh: plugin command failed; diagnostics: C:\\Users\\xiangyu\\.dsh\\profiles\\desktop\\.plugin-manager\\logs\\operation-qmm9Rk\\pnpm.log',
  ].join('\n')
  assert.equal(classifyFailure(msg), 'pnpmMissingDep')
  // 不能把 Issue 误挂到正在安装的插件上
  assert.notEqual(classifyFailure(msg), 'pluginPrepare')
  assert.notEqual(classifyFailure(msg), 'pluginPrepare')
  // 404 是「包不存在」，不是网络不通
  assert.notEqual(classifyFailure(msg), 'network')
  // npm 通道的同类报错（`npm error 404 Not Found - GET …`）同样归到这里
  assert.equal(classifyFailure('npm error 404 Not Found - GET https://registry.npmjs.org/foo - Not found'), 'pnpmMissingDep')
})

test('classifyFailure: a version missing from the install registry is an environment issue (issue #175), not a plugin issue', () => {
  // #175：反查包名走设置里的 npmRegistry，实际安装沿用本机 ~/.npmrc 的源；镜像滞后于官方时
  // 就会出现「解析挑到新版本 → 安装源里没有」—— 与插件作者无关，不能落 repo 兜底推给作者仓库
  const msg = [
    '[ERR_PNPM_NO_MATCHING_VERSION] No matching version found for @caob23/dsh-browser-control@1.0.10',
    'while fetching it from https://registry.npmmirror.com/',
    'dsh: plugin command failed; diagnostics: /x/.plugin-manager/logs/operation-Xn3nTz/pnpm.log',
  ].join('\n')
  assert.equal(classifyFailure(msg), 'registryVersionStale')
  assert.notEqual(classifyFailure(msg), 'pluginPrepare')
  // npm 通道的 ETARGET / 描述句（无 ERR_ 前缀）同样归到这里
  assert.equal(classifyFailure('npm error code ETARGET\nnpm error notarget No matching version found for foo@9.9.9'), 'registryVersionStale')
  assert.equal(classifyFailure('No matching version found for dsh-plugin@1.9.9'), 'registryVersionStale')
})

test('classifyFailure: the 24h release-age gate (ERR_PNPM_NO_MATURE_MATCHING_VERSION) is a policy issue (issue #175), not a plugin issue', () => {
  // #175 补充：dsh profile 自带 minimumReleaseAge=1440，刚发布的版本被包龄闸门拦下时报这个码 ——
  // 那是 dsh 自己的供应链策略在正常工作，不是任何人的错，不能落 repo 变成作者邮箱里的工单
  const msg = [
    '[ERR_PNPM_NO_MATURE_MATCHING_VERSION] 1 version does not meet the minimumReleaseAge constraint:',
    '  @caob23/dsh-browser-control@1.0.14 was published at 2026-10-12T14:02:49.910Z, within the minimumReleaseAge cutoff (2026-10-11T14:25:47.400Z)',
    'dsh: plugin command failed; diagnostics: /x/.plugin-manager/logs/operation-Xn3nTz/pnpm.log',
  ].join('\n')
  assert.equal(classifyFailure(msg), 'pnpmPolicy')
  assert.notEqual(classifyFailure(msg), 'pluginPrepare')
})

test('pnpmPolicyHintOf: minimumReleaseAge via ERR_PNPM_NO_MATURE_MATCHING_VERSION yields the exact retry time', async () => {
  const { pnpmPolicyHintOf, releaseAgeRetryAfter } = await import('../src/client/logic/failures.ts')
  const msg = '[ERR_PNPM_NO_MATURE_MATCHING_VERSION] 1 version does not meet the minimumReleaseAge constraint:\n'
    + '  @caob23/dsh-browser-control@1.0.14 was published at 2026-10-12T14:02:49.910Z, within the minimumReleaseAge cutoff'
  assert.equal(pnpmPolicyHintOf(msg), 'failPnpmReleaseAgeHint')
  assert.equal(releaseAgeRetryAfter(msg), '2026-10-13T14:02Z')
})

test('classifyFailure: a dangling local (link:) dependency in the profile is an environment issue (issue #172), not a plugin issue', () => {
  const msg = [
    '[ERR_PNPM_LINKED_PKG_DIR_NOT_FOUND] Could not install from "C:\\Users\\23812\\.dsh\\Documents\\deepseek-harness\\default-workspace\\dsh-menu-opaque" as it does not exist.',
    'This error happened while installing a direct dependency of C:\\Users\\23812\\.dsh\\profiles\\desktop',
    'dsh: plugin command failed; diagnostics: C:\\Users\\23812\\.dsh\\profiles\\desktop\\.plugin-manager\\logs\\operation-cuaKvy\\pnpm.log',
  ].join('\n')
  assert.equal(classifyFailure(msg), 'pnpmLinkedDirMissing')
  assert.notEqual(classifyFailure(msg), 'pluginPrepare')
  // 无 ERR_ 前缀、只有描述句时同样归到这里
  assert.equal(classifyFailure('Could not install from "/tmp/gone-plugin" as it does not exist'), 'pnpmLinkedDirMissing')
})

test('classifyFailure: the host tail alone (lowercase `command failed`) is not a prepare failure', () => {
  // 宿主尾部提示是小写的 `dsh: plugin command failed`，只是「这条命令失败了」的通用说明，
  // 不算构建脚本失败
  assert.equal(classifyFailure('something unexpected\ndsh: plugin command failed; diagnostics: /tmp/pnpm.log'), 'hub')
  // pnpm 真正包出来的 `Command failed: …`（大写 C）仍按 prepare 失败处理
  assert.equal(classifyFailure('Command failed: pnpm add some-plugin'), 'pluginPrepare')
})

test('missingRegistryPackageOf extracts the 404 package name (scoped too), null otherwise', () => {
  assert.equal(
    missingRegistryPackageOf('[ERR_PNPM_FETCH_404] GET https://registry.npmjs.org/dsh-our-free-model: Not Found - 404'),
    'dsh-our-free-model')
  assert.equal(
    missingRegistryPackageOf('ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/@scope/pkg: Not Found - 404'),
    '@scope/pkg')
  // 私有/自定义 registry 同样取路径里的包名（带端口的 host 也能剥掉）
  assert.equal(missingRegistryPackageOf('[ERROR] GET http://registry.local:4873/foo: Not Found - 404'), 'foo')
  // 非 404 / 取不到 URL → null（调用方据此跳过「哪个包缺失」那行）
  assert.equal(missingRegistryPackageOf('[ERR_PNPM_PREPARE_PACKAGE] Failed to prepare git-hosted package'), null)
  assert.equal(missingRegistryPackageOf(''), null)
})

test('classifyFailure: generic install failure falls back to hub', () => {
  assert.equal(classifyFailure('network error while fetching'), 'hub')
  assert.equal(classifyFailure(''), 'hub')
})

test('unreachableTargetOf extracts the exact unreachable address for the dialog', () => {
  // 服务端 [network] 预检消息（中/英文括号）优先取括号里的探测地址
  assert.equal(
    unreachableTargetOf('[network] 安装已中止：安装前无法连接到 GitHub（https://github.com/）—— 您的网络似乎不通或被拦截。'),
    'https://github.com/')
  assert.equal(
    unreachableTargetOf('[network] install aborted: cannot reach the npm registry (https://registry.npmjs.org/) before install.'),
    'https://registry.npmjs.org/')
  // 安装日志里的连接失败：取第一个 URL（git 仓库地址）
  assert.equal(
    unreachableTargetOf('fatal: unable to access \'https://github.com/adoresever/graph-memory/\': Failed to connect to github.com port 443: Timed out'),
    'https://github.com/adoresever/graph-memory/')
  // 提取不到 URL → null（调用方据此跳过地址行）
  assert.equal(unreachableTargetOf('pnpm error code ECONNRESET'), null)
})

test('classifyFailure: registry tarball download failure is a network/registry issue (issue #32), not a plugin issue', () => {
  // #32 真实报错：pnpm 被配成公司内网 Artifactory 源，tarball 拉取失败 → fetch failed
  const msg = [
    '[WARN] GET https://cmc.centralrepo.rnd.huawei.com/artifactory/api/npm/npm-public/dsh-plugin/-/dsh-plugin-1.4.2.tgz error (0). Will retry in 10 seconds. 2 retries left.',
    '[WARN] GET https://cmc.centralrepo.rnd.huawei.com/artifactory/api/npm/npm-public/dsh-plugin/-/dsh-plugin-1.4.2.tgz error (0). Will retry in 1 minute. 1 retries left.',
    '[ERROR] fetch failed',
    'TypeError: fetch failed',
    'dsh: pnpm failed in profile directory C:\\Users\\x00257188\\.dsh\\profiles\\web',
  ].join('\n')
  assert.equal(classifyFailure(msg), 'network')
  // 只有 TypeError: fetch failed（pnpm 各版本输出形态不同）也要能归到 network
  assert.equal(classifyFailure('TypeError: fetch failed\ndsh: pnpm failed in profile directory /Users/x/.dsh/profiles/web'), 'network')
  // 不能被 repo 兜底吞掉：旧逻辑会把 #32 误报成「插件侧安装失败」引导去提 Issue
  assert.notEqual(classifyFailure(msg), 'pluginPrepare')
})

test('classifyFailure: generic "network error while fetching" without the tarball markers stays hub', () => {
  // 不加面过宽的词：只有描述性文本时仍按未知原因兜底（防止误伤真实插件侧报错）
  assert.equal(classifyFailure('network error while fetching'), 'hub')
})

test('classifyFailure: the host-spawn marker is its own cause (issue #212)', () => {
  // 带标记 → 单独归类
  assert.equal(
    classifyFailure('[error] spawn D:\\DSH\\DSH Desktop\\DSH Desktop.exe ENOENT\n[host-spawn] the DSH host could not be launched (D:\\DSH\\DSH Desktop\\DSH Desktop.exe: ENOENT)'),
    'hostCliSpawn')
  // 具体命令的 ENOENT 归各自的环境类
  assert.equal(classifyFailure('[error] spawn dsh ENOENT'), 'dshMissing')
  assert.equal(classifyFailure('[error] spawn pnpm ENOENT'), 'pnpmMissing')
  // 无标记的裸 spawn ENOENT 不认（curl/git/taskkill 等任何 spawn 都会产出这种文本）
  assert.equal(classifyFailure('[error] spawn curl ENOENT'), 'hub')
  assert.equal(classifyFailure('spawn /Applications/DSH.app/Contents/MacOS/DSH ENOENT'), 'hub')
})

test('actionOfRecord / action words: a removal is never described as an install', () => {
  // 老记录只有 kind，按 kind 兜底；更新记录的 kind 仍是 install，靠 action 区分
  assert.equal(actionOfRecord({ kind: 'uninstall' }), 'uninstall')
  assert.equal(actionOfRecord({ kind: 'install' }), 'install')
  assert.equal(actionOfRecord({ kind: 'install', action: 'update' }), 'update')
  assert.equal(actionOfRecord({ kind: 'uninstall', action: 'update' }), 'update')
  assert.equal(actionWordZh('uninstall'), '卸载')
  assert.equal(actionWordZh('update'), '更新')
  assert.equal(actionWordZh('install'), '安装')
  assert.equal(actionWordEn('uninstall'), 'removal')
  assert.equal(actionWordEn('update'), 'update')
  assert.equal(actionWordEn('install'), 'install')
})

test('registryHostOf reports a private/internal registry host, null for official or public mirrors', () => {
  // 内网/自定义源（#32：华为内网 Artifactory）→ 返回主机名，前端据此给出换源指引
  assert.equal(
    registryHostOf('GET https://cmc.centralrepo.rnd.huawei.com/artifactory/api/npm/npm-public/dsh-plugin/-/dsh-plugin-1.4.2.tgz error (0)'),
    'cmc.centralrepo.rnd.huawei.com')
  // 带端口的私有源 → 返回去掉端口的主机名
  assert.equal(
    registryHostOf('GET http://registry.local:4873/dsh-plugin/-/dsh-plugin-1.4.2.tgz error (0)'),
    'registry.local')
  // 官方源 → null（属正常配置，按通用网络问题提示即可）
  assert.equal(
    registryHostOf('GET https://registry.npmjs.org/dsh-plugin/-/dsh-plugin-1.4.2.tgz error (0)'),
    null)
  // 公开镜像 → null
  assert.equal(
    registryHostOf('GET https://registry.npmmirror.com/dsh-plugin/-/dsh-plugin-1.4.2.tgz error (0)'),
    null)
  // 非 tarball 下载 URL（git 仓库 / metadata）→ null
  assert.equal(registryHostOf('Could not connect to github.com:443: Timed out'), null)
  assert.equal(registryHostOf(''), null)
})

test('coreErrorCode extracts the first error code', () => {
  assert.equal(coreErrorCode('foo [ERR_PNPM_PREPARE_PACKAGE] bar'), 'ERR_PNPM_PREPARE_PACKAGE')
  // 带数字的错误码不能被截断（是 ERR_PNPM_FETCH_404，不是 ERR_PNPM_FETCH_）
  assert.equal(
    coreErrorCode('[ERR_PNPM_FETCH_404] GET https://registry.npmjs.org/foo: Not Found - 404'),
    'ERR_PNPM_FETCH_404')
  assert.equal(coreErrorCode('no code here'), null)
})

test('summarizeError keeps only the diagnostic lines, deduplicated', () => {
  const msg = [
    'Progress: resolved 0, reused 1, downloaded 0, added 0',
    '[ERR_PNPM_PREPARE_PACKAGE] Failed to prepare git-hosted package fetched from "https://x/1.tar.gz"',
    'dsh: pnpm failed in profile directory /Users/x/.dsh/profiles/web',
    '[ERR_PNPM_PREPARE_PACKAGE] Failed to prepare git-hosted package fetched from "https://x/1.tar.gz"',
    dshTailHint,
    '[exit 1]',
  ].join('\n')
  const out = summarizeError(msg)
  assert.ok(!out.includes('Progress:'))
  assert.ok(out.includes('ERR_PNPM_PREPARE_PACKAGE'))
  assert.ok(out.includes('pnpm failed in profile'))
  assert.ok(out.includes('allowBuilds'))
  assert.equal(out.split('ERR_PNPM_PREPARE_PACKAGE').length, 2) // deduped
})

test('summarizeError drops harmless peer-dependency WARNs so the real error surfaces (issue #28)', () => {
  const msg = [
    'WARN Issues with peer dependencies found',
    '└─ ✕ missing peer @deepseek-ai/cordis',
    '  ✕ missing peer dsh-settings',
    '  ✕ missing peer react',
    'Peer dependencies that should be installed:',
    '  @deepseek-ai/cordis  react',
    '[ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED] The git-hosted package "anime-find@0.1.12" needs to execute build scripts but is not in the "allowBuilds" allowlist.',
    '[exit 1]',
  ].join('\n')
  const out = summarizeError(msg)
  assert.ok(out.includes('ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED'), 'the real git prepare error must survive')
  assert.ok(!out.includes('missing peer'), 'missing-peer WARN must be dropped')
  assert.ok(!out.includes('Issues with peer dependencies'), 'peer WARN header must be dropped')
})

test('summarizeError keeps descriptive failure lines like a missing submodule', () => {
  const msg = [
    'Progress: resolved 42, reused 41, downloaded 1, added 0',
    '[ERR_PNPM_PREPARE_PACKAGE] Failed to prepare git-hosted package fetched from "https://codeload.github.com/ccch1mneyyy/dsh-tui/tar.gz/abc"',
    'prepare-guard: vendor/dsh-std submodule content is missing (git tarball excludes submodules)',
    dshTailHint,
    '[exit 1]',
  ].join('\n')
  const out = summarizeError(msg)
  assert.ok(out.includes('submodule content is missing'), 'descriptive submodule line must survive compression')
  assert.ok(out.includes('ERR_PNPM_PREPARE_PACKAGE'))
  assert.ok(out.includes('prepare-guard'))
  assert.ok(!out.includes('Progress:'))
})

test('summarizeError falls back to head+tail snapshot when nothing matches', () => {
  const head = 'line one start'
  const tail = 'last line end'
  const out = summarizeError(`${head}\n${'middle '.repeat(200)}\n${tail}`)
  assert.ok(out.startsWith('line one start'))
  assert.ok(out.endsWith('last line end'))
})

test('summarizeError truncates over-long single lines and total output', () => {
  const longLine = `ERR_PNPM_PREPARE_PACKAGE ${'x'.repeat(2000)}`
  assert.ok(summarizeError(longLine).length <= 5000 + 16)
  const many = Array.from({ length: 60 }, (_, i) => `Command failed (${'y'.repeat(80)} ${i})`).join('\n')
  assert.ok(summarizeError(many).endsWith('… (truncated)'))
})

test('summarizeError honors a caller-provided budget (issue URL clamp)', () => {
  const msg = `ERR_PNPM_PREPARE_PACKAGE ${'x'.repeat(2000)}`
  assert.ok(summarizeError(msg, 300).length <= 300 + 16)
})

test('missing tarball integrity is a pnpm policy rejection with specific recovery guidance', async () => {
  const { pnpmPolicyHintOf } = await import('../src/client/logic/failures.ts')
  const message = '[ERR_PNPM_MISSING_TARBALL_INTEGRITY] Cannot install package "sample@https://github.com/example/sample/releases/download/v1/sample.tgz": its lockfile entry has no "integrity" field.\nCommand failed\nETIMEDOUT'
  assert.equal(classifyFailure(message), 'pnpmPolicy')
  assert.equal(pnpmPolicyHintOf(message), 'failPnpmTarballIntegrityHint')
  assert.equal(pnpmPolicyHintOf('ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION'), 'failPnpmPolicyHint')
  assert.equal(pnpmPolicyHintOf('ERR_PNPM_TARBALL_INTEGRITY checksum mismatch'), 'failPnpmPolicyHint')
  assert.equal(classifyFailure('ERR_PNPM_TARBALL_INTEGRITY checksum mismatch'), 'hub')
  assert.equal(classifyFailure('a plugin says its integrity is missing'), 'hub')
  assert.equal(classifyFailure('ERR_PNPM_MISSING_TARBALL_INTEGRITY_OTHER'), 'hub')
})

test('minimum release age rejection gets its own hint with the exact retry time', async () => {
  const { pnpmPolicyHintOf, pnpmPolicyHintParams, releaseAgeRetryAfter } = await import('../src/client/logic/failures.ts')
  // #121：pnpm 拒收「刚发布」包的报错文本（真实样例见 issue #121）
  const message = '[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:\n'
    + '  dsh-plugin@1.5.2 was published at 2026-10-08T00:51:35.776Z, within the minimumReleaseAge cutoff (2026-10-07T06:45:12.810Z)'
  assert.equal(classifyFailure(message), 'pnpmPolicy')
  // 能从报错里算出发布时间 → 走专属文案（给出确切的「何时可再试」）
  assert.equal(pnpmPolicyHintOf(message), 'failPnpmReleaseAgeHint')
  // 发布时间 + 24h，UTC 分钟精度
  assert.equal(releaseAgeRetryAfter(message), '2026-10-09T00:51Z')
  assert.deepEqual(pnpmPolicyHintParams(message), { time: '2026-10-09T00:51Z' })
  // 算不出发布时间（只给了错误码）→ 退回通用文案，且时间参数为空串而非 undefined
  assert.equal(pnpmPolicyHintOf('[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] blocked'), 'failPnpmPolicyHint')
  assert.deepEqual(pnpmPolicyHintParams('[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] blocked'), { time: '' })
  // untrusted origin 不含发布时间 → 仍走通用文案
  assert.equal(pnpmPolicyHintOf('[ERR_PNPM_UNTRUSTED_ORIGIN] blocked'), 'failPnpmPolicyHint')
})
