# dsh-plugin-hub 重构执行清单

> 给执行者（AI / 人）看的任务清单。目标：把超长文件拆到「职责单一、每个文件 ≤300 行」，防止未来继续膨胀。
> 本文档是唯一执行依据：换会话、上下文丢失都按此继续，不重来、不猜。

## 铁律（不可违反）

1. **不改任何行为**：函数签名、判断条件、返回值、正则、错误文案、import 语义一律不动。
2. **只移动 / 只拆结构**，不新增功能、不删除功能、不「顺手优化」。
3. **每步一个 commit**，可独立回滚。
4. **每步跑 `npm run typecheck && npm test`**，全绿才进入下一步。
5. 完成后网页版冒烟：目录加载、装一个插件、卸一个插件、改设置、跑诊断。

## 任务列表

### 任务 1：超长代码行拆行（低风险，纯格式化）

- `src/server/http/routes.ts:17` — import 语句拆多行（每个符号一行）。
- `src/server/services/install/task-queue.ts:61 / 66 / 272` — 对象字面量字段各占一行。

验证：`npm run typecheck`

### 任务 2：拆分 routes.ts（核心，纯提取）

现状：`src/server/http/routes.ts` 1258 行 = 工具函数 + `mountPluginHubRoutes`（21 个路由）。

目标结构：

```
src/server/http/
├── routes.ts        # 入口 mountPluginHubRoutes：组装各模块；isSameOrigin / isDesktopHost / require* 校验
├── shared.ts        # sendJson / 常量 / HOST_RESTART_SCRIPT / isDesktopHost
├── catalog.ts       # /catalog 路由 + 目录缓存 + profile 读取 helper（readInstalled 等）
├── install.ts       # /install + /uninstall
├── settings.ts      # /settings + /settings/reset
├── logs.ts          # /logs + /clear-log + /open-log + /choose-log-dir
├── diagnostics.ts   # /diagnostics + /proxy-check + hostEnv / toolVersion
└── task.ts          # /status /active /env /cancel /restart /installed-version /open-path /installed /debug-loader-entries
```

做法：

- 每个模块导出 `registerXxxRoutes(deps): WebRoute[]`，`routes.ts` 里按组拼装。
- 移动时逐字保留 handler 代码，只改「从哪个文件 import」。

注意：

- `tests/routes.test.ts` 里 `import { isDesktopHost, isSameOrigin } from '../src/server/http/routes.ts'` 必须保持可用（这两个函数留在 `routes.ts`，或移去 `shared.ts` 后同步改测试的 import）。

验证：`npm run typecheck && npm test`，然后网页版冒烟。

### 任务 3：瘦身 PluginHubSection.tsx（中风险）

现状：820 行。

目标：拆成子组件 / 渲染函数，每个 ≤300 行。

做法：把弹窗渲染、各视图组装抽成独立函数或子组件。

验证：`npm run typecheck && npm test`，网页版切换各视图正常。

### 任务 4：瘦身 task-queue.ts / useTaskQueue.ts（中风险）

现状：738 行 / 687 行。

目标：拆 helper / 纯函数，每个 ≤300 行。

做法：

- `task-queue.ts`：把 `runPluginMutation` 里的 allowBuilds 恢复、装后校验、npm 版本标注拆成独立函数。
- `useTaskQueue.ts`：把轮询合并逻辑拆成纯函数。

验证：`npm run typecheck && npm test`

### 任务 5：加防膨胀约束（可选，一劳永逸）

- eslint 规则 `max-lines: 300`、`max-len: 120`。
- 验证：规则生效，超限在 lint 时报错。

## 验收规则（测试流程）

重构是「只移动、不改逻辑」，验收目标 = 证明行为与重构前完全一致。分三层：

### 第一层：静态验证（每个任务必过）

- `npm run typecheck` —— 拆分后类型 / import / 函数签名正确。
- `npm test` —— 现有单测全绿，纯函数行为不变。

### 第二层：冒烟验证（任务 2~4 完成后，网页版逐项点一遍）

1. 目录加载：插件市场列表正常显示。
2. 安装：装一个 git 插件，成功或失败弹窗都正常。
3. 卸载：卸掉它，正常。
4. 设置：改一项设置（如代理），保存生效。
5. 诊断：跑「系统诊断」，正常返回结果。

### 第三层：日志核对（可选，最严格）

- 冒烟前后对比 `~/.dsh/logs/dsh-web-7923.log`，无新增报错。

### 通过标准

- 第一层全绿 + 第二层 5 项全部正常。
- 每个任务一个独立 commit，可单独回滚。
