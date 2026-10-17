/**
 * 从 DSH 输出里解析 operation 日志路径（`diagnostics: <path>`）。
 * 只认 DSH 的 operation 日志：路径含 `.plugin-manager` 且以 `pnpm.log` 结尾；
 * 不是这种路径（或压根没有该行）返回 null，调用方据此跳过回捞。
 */
export declare function operationLogPathOf(output: string): string | null;
/**
 * 回捞 operation 日志尾部，作为失败详情返回；拿不到（无路径 / 文件不存在 / 读失败 /
 * 内容为空）返回 null。尾部截到与子进程输出相同的上限，避免超大日志撑爆内存与消息。
 */
export declare function backfillOperationLog(output: string): string | null;
/**
 * 运行期抓取：宿主的 operation 日志只在命令运行期间存在，结束后可能被清理，
 * 退出后再按路径读往往已经拿不到。这里在安装过程中轮询 profile 下最新的
 * `.plugin-manager/logs/<operation>/pnpm.log`，用抓到的内容兜底。
 * 只认本次运行产生的新文件（mtime 晚于启动基线），避免复述上一次安装的日志。
 */
export declare function createOperationLogTap(profileDir: string): {
    stop: () => string;
};
