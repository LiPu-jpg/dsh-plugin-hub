/** 预检结果：ok=false 表示分发改 package.json 声明的文件（入口或 bundle 补丁），
 *  missing 为该文件在包内的相对路径；
 *  name 为 git 分发包 package.json 声明的包名（非 git 目标/无法确定时为 null），
 *  供安装路由做「包名冲突」检测 —— 同名包名已被其他来源占用时，pnpm 装前必然撞车，
 *  需要把晦涩的 CLI 报错转成明确的拦截。 */
export interface PreflightResult {
    ok: boolean;
    missing: string | null;
    name: string | null;
}
export declare function preflightTarget(target: string): Promise<PreflightResult>;
/** GitHub codeload tarballs use a dynamic top-level directory (`repo-<sha>/`),
 * not npm's `package/` prefix. Pick only a package.json directly under that
 * single archive root; nested monorepo package manifests are intentionally
 * ignored. Exported for a small parser regression test. */
export declare function rootPackageEntryOfTarList(listing: string): string | null;
/**
 * 清单里第一个缺失的必需文件（成员名带包根前缀，由调用方拼好），全部都在则为 null。
 * 清单不可读（tar 缺失/解压失败）时按第一个必需文件缺失处理：与逐文件查询时
 * 「查不到就是缺」的判定一致，宁可拦下一次可疑安装，也不放一个空包过去。
 * Exported for a small parser regression test.
 */
export declare function missingDistributionFileOfTarList(listing: string | null, required: string[]): string | null;
