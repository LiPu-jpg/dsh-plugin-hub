export interface NpmRelease {
    version: string;
    publishedAt: string;
}
/** 请求体包名数量上限：只为已安装插件按需查询，几十个足矣，封顶防滥用。 */
export declare const MAX_RELEASE_AGE_PACKAGES = 50;
/** 单包查询超时（ms）：慢网络下失败即返回 null，不拖住整个响应。 */
export declare const RELEASE_AGE_TIMEOUT_MS = 8000;
export declare const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org";
/** 从完整 packument 取 dist-tags.latest 对应版本及其发布时间；缺任一字段返回 null。 */
export declare function latestReleaseOf(packument: unknown): NpmRelease | null;
/** 请求体 → 去重后的合法包名列表；非数组 / 超量 / 含非法包名一律 null（拒绝非法输入）。 */
export declare function parseReleaseAgeRequest(body: unknown): string[] | null;
/** 查询一个包的最新版本与发布时间（成功结果按源缓存 10 分钟）；registry 为空回退官方源，失败返回 null。 */
export declare function lookupReleaseAge(packageName: string, registry: string, proxy: string, timeoutMs?: number): Promise<NpmRelease | null>;
