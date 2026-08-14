<!-- 语言链接 -->
[English](README.md) · [中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

<div align="center">

# 🤖 dsh-auto-review

**DeepSeek Harness 的第二模型 AI 自动审批** —— 以纯 Cordis 插件实现 Codex `approvals_reviewer=auto_review` / Claude Code *auto mode* 模式。

当 agent 的动作越过沙箱边界时，一个**只读审查子代理**给出 allow/deny 裁决与理由：人类无需操作，而不安全的操作也绝不会静默放行。

[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-4c51bf.svg)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![tests](https://img.shields.io/badge/tests-61%20passing-brightgreen.svg)](test)
[![typescript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](src)
[![type](https://img.shields.io/badge/type-cordis%20bundle-8a5cf6.svg)](cordis.patch.yml)
[![repo](https://img.shields.io/badge/repo-PerryLink%2Fdsh--auto--review-181717.svg)](https://github.com/PerryLink/dsh-auto-review)

**人类零操作。** 请求交给 AI 审查代理，裁决 = allow/deny + 理由 + 风险等级，且每个决策都能从会话日志完整重建：`approval/asked` → `autoReview/verdict` → `approval/decided`。

<img src="docs/demo-auto-review.gif" alt="dsh-auto-review 演示" width="720"/>

*一次真实证据链（真实服务器、真实 API key、两轮真实模型）：AI 审查代理**放行**工作区内的升级写入（risk low，5.2s），随后**拒绝**工作区外的递归删除（risk high，8.9s）——拒绝理由回喂模型，直接显示在转录中。*

</div>

## 为什么用第二个模型而不是规则？

基于规则的自动审批在派发前就做出二态判定，没有证据。`dsh-auto-review` 把决策交给**审查子代理**：它通过只读工具面读取真实工作区、已流式呈现的工具调用参数（敏感值已脱敏）、请求方 reason 与你的风险规则，再返回结构化裁决。deny 裁决把**理由回喂调用模型**，agent 能学到原因而不是盲目重试。

## ✨ 特性

| | |
|---|---|
| 🔌 **官方接缝** | `approval/request` waterfall 上的 answerer；不接管的请求一律 `next()` 委托——人类审批流程绝不被短路。 |
| 🧠 **第二模型裁决** | 一次性 fork 子代理，只读工具白名单（`read`/`glob`/`grep`）+ 结构化裁决 schema `{ decision, reason, riskLevel }`。 |
| 🛡️ **fail closed** | 审查代理崩溃、超时、schema 不符都绝不放行：按 `fallbackPolicy` 回退，默认 `rejected`。 |
| 🧩 **配置驱动路由** | 每工具策略（`ai`/`human`/`never`）+ 正则风险规则，全部可在 cordis.yml 中修改。 |
| 💬 **拒绝理由到达模型** | 审查理由经 callId 注入被拒工具结果，agent 据此调整。 |
| 📜 **完整审计链** | `autoReview/verdict` 会话事件（审查代理身份/裁决/理由/风险/耗时）+ invariant 伴生强制「模型可见 ⟺ 已记录」。 |
| 🔁 **防递归** | 审查代理自身的审批请求按身份识别并委托；`maxDepth` + 工具白名单保证其无法再委派。 |
| ⌨️ **会话级命令** | `/auto-review on|off|status`，durable 会话级覆盖跨恢复生效。 |

## 工作原理

```text
                       approval/request waterfall（answerer 链）
                        │
┌───────────────────────┴──────────────────────┐
│ dsh-auto-review answerer                     │
│  · 会话已启用？  · 策略 = ai？               │  否 ── next() ──▶ 人类 answerer（UI）
│  · 风险规则 → toolsPolicy → 默认值          │
└───────────────────────┬──────────────────────┘
                        │ 是
                        ▼
        ┌───────────────────────────────────┐
        │ 审查子代理（fork，一次性）          │
        │  · toolFilter：read/glob/grep     │
        │  · outputSchema：{decision,       │
        │    reason, riskLevel}             │
        │  · 超时 + req.signal 中止          │
        └───────────────┬───────────────────┘
                        │ 裁决 / 失败（fail-closed 回退）
                        ▼
 allow → allowed-once        deny → rejected，理由注入被拒工具结果
                                        （经 callId 关联）
                        │
                        ▼
 审计：approval/asked → autoReview/verdict → approval/decided
       （会话事件，log-only，invariant 校验）
```

## 🚀 快速开始

三种安装通道；本插件是 **bundle** 形态（`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`）。

```sh
# 1. npm tarball（构建产物，无需构建许可）
pnpm pack                       # → dsh-auto-review-0.1.0.tgz
dsh plugin --profile web add ./dsh-auto-review-0.1.0.tgz
dsh --profile web               # 重启生效

# 2. git 源（钉住 commit；自包含 prepare 负责构建）
#    pnpm ≥ 10 默认阻止生命周期构建：先把提示的 allowBuilds 键
#    加入 profile 的 pnpm-workspace.yaml。
dsh plugin --profile web add "github:PerryLink/dsh-auto-review#<commit>"

# 3. 本地 link（开发调试）
dsh plugin --profile web add link:/path/to/dsh-auto-review
```

验证：

```sh
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

开箱配置对 `bash`、`write`、`edit` 走 AI 裁决，其余工具委托人类链。

## ⚙️ 配置

所有可调参数都是 Schemastery `Config` 字段（cordis.yml 可改）。按 `id` 定向覆盖时**整行 config 被替换**——需要保留的键必须全部重述。

| 键 | 默认 | 含义 |
|---|---|---|
| `enableByDefault` | `true` | 会话初始是否启用；`/auto-review on\|off` 写入的 durable 覆盖优先于它 |
| `toolsPolicy.default` | `human` | 未列出工具的策略（委托人类 answerer） |
| `toolsPolicy.overrides` | `{}` | 每工具策略：`ai`（AI 裁决）、`human`（强制人类）、`never`（确定性拒绝） |
| `riskRules` | `[]` | `{pattern, policy}` 按顺序匹配请求 reason（首个命中生效），**先于**工具表 |
| `reviewerProvider` | `fork` | 审查代理的 subagent provider（进程内 fork 后端） |
| `reviewerModel` | *(继承)* | 审查模型 id；不设则继承会话 agent 的模型路由 |
| `reviewerTimeoutMs` | `60000` | 裁决截止时间；超时走回退策略 |
| `reviewerTools` | `[read, glob, grep]` | 审查子代理的工具白名单——其余工具在其中不可见 |
| `fallbackPolicy` | `rejected` | 审查失败处理：`rejected`（fail closed）、`delegate`（继续沿链）、`allow-readonly`（放行——见安全边界） |
| `maxReviewsPerTurn` | `10` | 每个开放回合的裁决预算；耗尽后委托人类 |
| `reasonMaxChars` | `2000` | 审查理由与脱敏参数预览的长度上限 |
| `reviewerGuidance` | *(无)* | 追加进审查 prompt 的可选指导语（建议性，非硬规则） |

示例（完整注释版见 `fixtures/config/config-full.yaml`）：

```yaml
- insert:
    - id: auto-review
      name: dsh-auto-review
      config:
        toolsPolicy:
          overrides: { bash: ai, write: ai, edit: ai }
        riskRules:
          - pattern: '(?i)(rm\s+(-[a-z]+\s+)*/|git\s+push\s+--force)'
            policy: never
        reviewerTimeoutMs: 30000
        fallbackPolicy: delegate
```

## ⌨️ 会话级命令

```
/auto-review on|off|status
```

`on`/`off` 追加 durable 的 `autoReview/state` 覆盖事件（fold 跨重启/恢复生效——重放即状态），并注入模型可见的切换通知（记录为 `user/message` 事件）。`status` 显示当前生效状态与本回合裁决预算。

## 🔒 安全边界

- 审查代理运行在**只读工具面**（`toolFilter` 白名单）内：不能写、改、执行 shell、访问网络、再委派（`maxDepth` = 自身深度）。其会话日志同样落盘可审计。
- **敏感参数先脱敏**（按键名匹配：`token`、`password`、`api_key`、`Authorization`、凭据、私钥等）再进入审查 prompt；插件绝不执行被审参数。脱敏是键名级而非内容级——参数值不能接受展示给模型的工具，不要纳入 AI 审查。
- **默认 fail closed。** 所有异常路径（provider 缺失、启动被拒、超时、非 `completed` 停止原因、裁决缺失/不合规、审计关联失败）都走 `fallbackPolicy`，默认 `rejected`。`allow-readonly` 是无条件放行——仅供接受该风险的无人值守部署使用。
- **`never` 在本层是单向的。** `never` 工具或风险规则在人类链看到请求之前即拒绝——是锁定旋钮，不是默认值。
- **审查代理也是模型。** 其裁决是建议性策略，不是安全内核。不可逆操作请配 `human`/`never` 规则。

## ⚠️ 已知局限

- 审查代理需要可用的 LLM 路由（默认继承会话 agent 的 provider/model）；没有路由时每次审查按 `fallbackPolicy` 回退——绝不静默放行。
- `reviewerTools` 中的名字必须是 profile 中真实存在的全局工具；未知名字会在最早点响亮失败并回退。
- 风险规则只匹配请求 `reason`；按工具名区分请用 `toolsPolicy.overrides`。
- 裁决事件是 log-only；Web UI 审计面板按会话事件原样渲染（无专属面板）。
- `autoReview/state` 与 `autoReview/verdict` 均以信封 `ignorable: true` 标记写入，任何 harness 构建都能加载日志——不认识这些仓库外类型的读取器只会跳过相应记录而不是拒绝整个会话。（rc.6 宿主会接受并忽略该标记，行为与打标前完全一致；0.1.1 之前版本写入的会话可用 `dsh-permission-rules` 的 `scripts/repair-session-logs.mjs` 一次性修复。）
- git 通道只需要 `dsh` CLI 打印的那一条 `allowBuilds` 键（针对 `dsh-auto-review` 本体）。仓库自带 `pnpm-workspace.yaml` 并声明 `allowBuilds: { esbuild: true }`，使隔离的 prepare 环境不会因 esbuild 的（无害的平台二进制校验）postinstall 而失败；`typescript` + `tsdown` 是常规 `dependencies`，保证该环境始终有构建工具。
- 可选 invariant 伴生（`dsh-auto-review/invariant`）需要 `invariants` 服务（agent-spine 组合，如 headless/ACP）；普通 web profile 不提供该服务，因此该行在 bundle patch 中以注释形式发布。

## 🏷️ GitHub 话题

发布仓库时建议添加：`dsh` · `dsh-plugin` · `deepseek-harness` · `deepseek` · `cordis` · `ai-safety` · `approval` · `sandbox` · `subagent` · `llm`

## 🔗 相关项目

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) —— `tools/pre-execute` waterfall 上的二态 allow/deny 分类器，审计走文件日志。`dsh-auto-review` 刻意差异化：官方 **answerer** 链、不拥有的请求一律委托、只读第二模型结构化裁决、拒绝理由回喂模型、会话日志级审计。
- [ACP automation bridge](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/acp/acp) —— 为其自有 ACP agent 提供一次性机器决策。`dsh-auto-review` 面向交互式 harness 的会话与工具策略作用域，绝不推断持久授权。

## 🧑‍💻 开发

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc，src + 测试
pnpm test                   # vitest：61 个测试、6 个套件
pnpm run build              # tsc 声明 + tsdown 打包（lib/）
pnpm run verify:self-contained
pnpm pack                   # 发布产物
```

仓库结构（plugin-template 结构）：`src/index.ts`（插件契约）· `src/config.ts`（Schemastery schema + 解析）· `src/runtime.ts`（answerer、命令、拒绝理由注入）· `src/review.ts`（审查代理编排、prompt、脱敏）· `src/events.ts`（会话事件词汇 + fold）· `src/invariant.ts`（invariant 伴生）· `test/` · `fixtures/`。

## 📄 License

[Apache License 2.0](LICENSE)
