type NpmSearchPackage = {
    name?: unknown;
    keywords?: unknown;
    links?: {
        repository?: unknown;
    };
    repository?: unknown;
    dsh?: unknown;
};
export declare function isDshPackageMetadataForRepo(pkg: NpmSearchPackage, repo: string): boolean;
/**
 * 校验包名对应的 npm 包确实属于该仓库且声明为 DSH 插件：取 registry 上的 `latest`
 * 元数据比对 repository 与插件标记。网络异常、超时、非 200 一律返回 false，不阻塞调用方。
 */
export declare function isDshNpmPackageForRepo(packageName: string, repo: string, registry?: string, proxy?: string): Promise<boolean>;
export {};
