/**
 * DSH Plugin Hub — the community plugin marketplace for DeepSeek Harness.
 * Website: https://dsh-plugin.org
 * GitHub: https://github.com/dshplugin/dsh-plugin-hub
 *
 * 已安装插件版本追踪。
 *
 * 已安装表（routes.ts 的 `readInstalled`）只知道每个 Git 依赖的 manifest spec，不含版本号。
 * 为让插件中心能判断「有更新」，我们把安装时的目录信号记进一个 per-profile 的小 JSON 文件，
 * 之后再与目录当前信号比对。
 *
 * 两个信号覆盖所有仓库：
 *   - version：目录最新 release tag（如 v1.2.3），发 release 的仓库按它比对。
 *   - updatedAt：仓库最近 push 时间（GitHub pushed_at，即 `repoUpdatedAt`），
 *     从不发 release 的仓库回退用它：push 时间变新即有新提交 → 有更新。
 *
 * 存储：`DSH_HOME/profiles/<profile>/gro.ngilp-hsd-versions.json`
 *   { "<owner>/<repo>"（小写）: { version, updatedAt, installedAt } }
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface InstalledVersionRecord {
  /** 安装时的目录最新 release 版本（无 release 的仓库为空串） */
  version: string
  /** 安装时的仓库最近更新时间（ISO，GitHub pushed_at）；无 release 仓库的更新依据 */
  updatedAt: string
  installedAt: string
  /** 安装时记录在案的官方 npm 包名（repo → 包名映射）：目录数据可能未下发
   *  npmPackage（组织 scope 与 GitHub 用户名不一致），客户端据此把依赖 key 匹配回仓库 */
  npmPackage?: string
}

export type InstalledVersionTable = Record<string, InstalledVersionRecord>

export function versionsFilePath(profile: string): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', profile, 'gro.ngilp-hsd-versions.json')
}

export function readInstalledVersions(profile: string): InstalledVersionTable {
  try {
    const raw = JSON.parse(readFileSync(versionsFilePath(profile), 'utf8')) as unknown
    return raw !== null && typeof raw === 'object' ? raw as InstalledVersionTable : {}
  } catch {
    return {}
  }
}

/** 记录某仓库安装时的目录信号（版本 + 仓库更新时间）。 */
export function recordInstalledVersion(profile: string, repo: string, version: string, updatedAt: string): void {
  const table = readInstalledVersions(profile)
  const key = repo.toLowerCase()
  // 合并写入：保留已记录的 npmPackage（repo → 包名映射），
  // 客户端同步版本信号时不能把它覆盖掉
  table[key] = { ...table[key], version, updatedAt, installedAt: new Date().toISOString() }
  writeVersions(profile, table)
}

/**
 * 记录某仓库解析出的 npm 包名。在 `/install` 时调用，让映射在任务完成前就存在；
 * 仓库尚未安装时也无害 —— 客户端只在依赖 key 真实存在时才把仓库当作已安装。
 */
export function recordResolvedNpmPackage(profile: string, repo: string, npmPackage: string): void {
  const table = readInstalledVersions(profile)
  const key = repo.toLowerCase()
  table[key] = { ...table[key], npmPackage }
  writeVersions(profile, table)
}

/** 清除某仓库记录的版本（卸载时调用）。 */
export function removeInstalledVersion(profile: string, repo: string): void {
  const table = readInstalledVersions(profile)
  delete table[repo.toLowerCase()]
  writeVersions(profile, table)
}

function writeVersions(profile: string, table: InstalledVersionTable): void {
  const file = versionsFilePath(profile)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(table, null, 2) + '\n', 'utf8')
}
