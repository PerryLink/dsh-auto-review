<div align="center">

# 🤖 dsh-auto-review

**DeepSeek Harness 的第二模型 AI 审批 —— 一个只读审查子代理在审批链上做出允许/拒绝决策，默认失败关闭。**

*当某个动作越过沙箱边界时，第二模型读取证据并给出带有理由的裁决 —— 人类无需批准任何事，同时也没有任何不安全的东西蒙混过关。*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-auto-review/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-auto-review/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-auto-review?label=version)](https://github.com/PerryLink/dsh-auto-review/releases)
[![npm version](https://img.shields.io/npm/v/dsh-auto-review)](https://www.npmjs.com/package/dsh-auto-review)
[![npm downloads](https://img.shields.io/npm/dm/dsh-auto-review)](https://www.npmjs.com/package/dsh-auto-review)

[English](README.md) · [简体中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

</div>

---

## 兼容性

| 方面 | 状态 |
|---|---|
| Harness | DeepSeek Harness `0.1.0-rc.6`（peer 依赖锁定在 `0.1.0-rc.6`） |
| Node | `^22.19.0 \|\| >=24.0.0` |
| 平台 | 全部（宿主 answerer；可选 Web 审查面板，依赖会话投影能力） |
| 模型 | 任意（审查器默认继承会话代理的路由；`reviewerModel` 可覆盖） |

## 你能获得什么

`dsh-auto-review` 在 `approval/request` answerer 链上加入第二模型：

1. **官方接缝** —— 一个只认领自己负责的请求（`ai` 策略）的 answerer，其余请求通过 `next()` 委派；人类审批流程永远不会被短路。
2. **只读审查子代理** —— 一次性 fork，工具白名单为 `read`/`glob`/`grep`，返回结构化裁决 `{ decision, reason, riskLevel }`。
3. **失败关闭** —— 审查器崩溃、超时或 schema 不匹配都会经由 `fallbackPolicy`（默认 `rejected`）处理；拒绝裁决会把理由反馈给调用模型。
4. **配置驱动路由** —— 按工具策略（`ai`/`human`/`never`）加正则风险规则，全部可在 cordis.yml 中修改。
5. **完整审计追踪** —— 仅日志的 `autoReview/verdict` + `autoReview/rejection` 会话事件（信封 `ignorable: true`），外加一个可选的 invariant 配套插件来强制「标记 ⟺ 事件」。
6. **安全旋钮** —— 拒绝熔断器、风险等级策略、一次性 `/auto-review approve` 覆盖，以及会向模型自我解释的 `never` 策略硬禁用。

每一次决策都能从会话日志重建：`approval/asked` → `autoReview/verdict`（或 `autoReview/rejection`）→ `approval/decided`。

## 快速开始

```sh
# 1. 将 bundle 安装到你的 profile
dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"

# 或从 npm 安装（已发布版本）
dsh plugin --profile web add dsh-auto-review

# 2. 重启并验证该行
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

开箱即用的补丁会 AI 审查 `bash` 与 `write`；其他所有工具都委派给人类审批链。

## 安装与卸载

- **git 渠道**（最新 `main`）：`dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"` —— 隔离的 `prepare` 构建需要 `dsh` CLI 为 `dsh-auto-review` 打印出的那个 `allowBuilds: { esbuild: true }` 键。
- **npm 渠道**（已发布版本）：`dsh plugin --profile web add dsh-auto-review`。
- **tarball 渠道**：在本仓库执行 `pnpm pack`，然后 `dsh plugin --profile web add ./dsh-auto-review-<version>.tgz`。
- **卸载**：`dsh plugin --profile web remove dsh-auto-review`（或从 profile 补丁中删除该行）。

## 配置

所有可调项都是 Schemastery `Config` 字段（可在 cordis.yml 中修改）。按 id 定向的覆盖会替换整行 —— 请重述你需要的每一个键。

| 键 | 默认值 | 含义 |
|---|---|---|
| `enableByDefault` | `true` | 会话默认开启 auto-review；`/auto-review on\|off` 写入的持久覆盖优先于此 |
| `toolsPolicy.default` | `human` | 未列出工具的默认策略（委派给人类 answerer） |
| `toolsPolicy.overrides` | `{}` | 按工具策略：`ai` / `human` / `never` |
| `riskRules` | `[]` | 在工具表之前匹配的 `{pattern, policy, field?}`；`field` 选择 `reason`（默认）、`toolName` 或 `arguments` |
| `reviewerProvider` | `fork` | 审查器的子代理 provider（进程内 fork 后端） |
| `reviewerModel` | *(继承)* | 审查器模型 id；不设置则继承会话代理的路由 |
| `reviewerTimeoutMs` | `60000` | 裁决截止时间；超时后应用 fallback 策略 |
| `reviewerTools` | `[read, glob, grep]` | 审查器子代理的工具白名单（必须非空） |
| `fallbackPolicy` | `rejected` | 审查器失败时的策略：`rejected`（失败关闭）/ `delegate` / `allow-once` |
| `maxReviewsPerTurn` | `10` | 每个开放轮次真实 AI 裁决的预算；超出后请求委派给人类 |
| `maxFailuresPerTurn` | `10` | 每个开放轮次审查器失败的预算 |
| `reasonMaxChars` | `2000` | 审查理由与脱敏参数预览的上限 |
| `reviewerGuidance` | *(无)* | 追加到审查器提示词的可选指导性说明 |
| `reviewerPolicyText` | *(无)* | 注入审查器提示词的 Markdown 裁决策略（Codex 风格） |
| `denyGuidance` | *(反规避文本)* | 追加到每一条注入的拒绝理由之后的指导 |
| `contextBudget` | `{turns: 0, maxChars: 4000}` | 审查器提示词的紧凑记录预算；`turns: 0` 表示禁用 |
| `riskPolicy` | `{maxAutoAllow: high, onHighRisk: delegate}` | 超过 `maxAutoAllow` 的 `allow` 裁决委派或拒绝 |
| `circuitBreaker` | `{consecutiveDenies: 3, windowDenies: 6, windowSize: 10, action: delegate}` | 拒绝熔断器 |
| `overrideTtlMs` | `300000` | `/auto-review approve` 覆盖的有效时长 |
| `language` | `en` | `/auto-review` 命令输出的界面语言（`en` \| `zh`） |

## 工具与界面

| 界面 | 类型 | 说明 |
|---|---|---|
| `auto-review` | answerer | `approval/request` 瀑布 answerer —— 认领 `ai` 策略请求，其余经 `next()` 委派 |
| `/auto-review` | 命令 | `on\|off\|status\|approve [n]` —— 持久会话覆盖、预算与累计统计 |
| 拒绝理由注入 | 监听器 | `tools/post-execute` —— 将裁决 / fallback / `never` 理由反馈到被拒绝的工具结果 |
| `autoReview` | 会话投影 | 由仅日志的 `autoReview/*` 事件折叠而成 |
| Web 审查面板 | 客户端 | 会话头部操作：开关、预算、统计、最近裁决、一次性批准 |
| `dsh-eval` | CLI | YAML 驱动的代理评估引擎（`bin/dsh-eval.mjs`） |
| invariant 配套插件 | invariant | `dsh-auto-review/invariant`（可选；需要 `invariants` 服务） |

## dsh-eval —— 代理评估引擎

除了审批审查器，`dsh-auto-review` 还附带 `dsh-eval`：一个 YAML 驱动的代理评估平台，运行真实的 headless DSH 会话（每个用例一个隔离代理 + 临时工作区），从会话事件日志中收集工具调用轨迹，并评估结构化断言以及可选的第二模型审查 —— 与审批 answerer 使用同一条审查接缝。

```sh
dsh-eval eval/cases --model deepseek-v4-flash --timeout-ms 240000 --out .eval-reports
```

CI 门禁：仅当每个套件的每个用例都通过时，进程才以 0 退出。每个用例都会在 `report.md`/`report.json` 旁边留下可重放的会话 JSONL 与轨迹 JSON。

## 权限与数据

- **权限**：workshop 清单声明 `session:append`、`approval:answer`、`subagent:spawn`、`command:register` 与 `tools:observe`。
- **数据**：不向磁盘写入任何内容；报告环形缓冲在内存中且有界。自身不发起网络请求。
- **会话日志**：`autoReview/*` 事件携带审查器身份、裁决、理由、风险与耗时 —— 以信封 `ignorable: true` 标记追加，任何构建都能加载日志。

## 安全边界

- **审查器是模型。** 其裁决是建议性策略，不是安全内核；对不可逆操作优先使用 `human`/`never` 规则。
- **失败关闭。** 每条异常路径都经由 `fallbackPolicy` 处理，默认 `rejected` —— 且拒绝会向模型反馈一条可审计的理由。
- **只读审查器。** 审查器的 `toolFilter` 白名单（`read`/`glob`/`grep`）无法写入、编辑、运行 bash、访问网络或委派。
- **敏感参数会被脱敏**（按键名匹配）后才进入审查器提示词；该插件绝不会执行被审查的参数。
- **`never` 是单向的。** `never` 工具或风险规则会在人类审批链看到请求之前就拒绝它。

## 已知限制

- 审查器需要可用的 LLM 路由（默认继承）；没有路由时，每次审查都会按 `fallbackPolicy` 回退 —— 绝不会静默放行。
- `reviewerTools` 中的名称必须是 profile 中已存在的全局工具；未知名称会使审查器子代理大声失败。
- 风险规则按各自的 `field` 匹配请求的 `reason`、`toolName` 或脱敏后的调用 `arguments`；其他条件应放入 `toolsPolicy.overrides`。
- `/auto-review approve` 覆盖授权的是下一次对同一工具的审查，而不是那次确切的历史调用。
- 裁决事件是仅日志的；Web 审查面板读取折叠后的 `autoReview` 投影（原始事件流绝不会到达浏览器插件）。
- 可选的 invariant 配套插件需要 `invariants` 服务（agent-spine 组合）；普通 web profile 不提供该服务。

## 开发

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc：src + tests，针对本地 harness 检出
pnpm test                   # vitest：190 个测试，14 个文件
pnpm run build              # tsc 声明 + tsdown 打包（lib/，含客户端包）
pnpm run verify:self-contained
pnpm pack                   # 发布产物
```

## 主题

`deepseek-harness`、`dsh`、`dsh-plugin`、`cordis`、`approval`、`auto-review`、`second-model`、`ai-safety`、`sandbox`、`subagent`

## 贡献者

- [@PerryLink](https://github.com/PerryLink) —— 创建者与维护者：审批 answerer、审查子代理、风险策略与熔断器、会话投影审查面板、invariant 配套插件、dsh-eval，以及五语文档。

## 许可证

[Apache License 2.0](LICENSE) © 2026 dsh-auto-review contributors
