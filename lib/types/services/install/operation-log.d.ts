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
