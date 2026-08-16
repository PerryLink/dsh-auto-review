<!-- 语言链接 -->
[English](README.md) · [中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

<div align="center">

# 🤖 dsh-auto-review

**DeepSeek Harness 的第二模型 AI 自动审批** —— 以纯 Cordis 插件实现 Codex `approvals_reviewer=auto_review` / Claude Code *auto mode* 模式。

当 agent 的动作越过沙箱边界时，一个**只读审查子代理**给出 allow/deny 裁决与理由：人类无需操作，而不安全的操作也绝不会静默放行。

[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-4c51bf.svg)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![npm version](https://img.shields.io/npm/v/dsh-auto-review)](https://www.npmjs.com/package/dsh-auto-review)
[![npm downloads](https://img.shields.io/npm/dm/dsh-auto-review)](https://www.npmjs.com/package/dsh-auto-review)
[![tests](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-auto-review/ci.yml?label=tests&logo=githubactions)](.github/workflows/ci.yml)
[![typescript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](src)
[![type](https://img.shields.io/badge/type-cordis%20bundle-8a5cf6.svg)](cordis.patch.yml)
[![repo](https://img.shields.io/badge/repo-PerryLink%2Fdsh--auto--review-181717.svg)](https://github.com/PerryLink/dsh-auto-review)

**人类零操作。** 请求交给 AI 审查代理，裁决 = allow/deny + 理由 + 风险等级，且每个决策都能从会话日志完整重建：`approval/asked` → `autoReview/verdict`（硬禁用为 `autoReview/rejection`）→ `approval/decided`。

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
| 💬 **拒绝理由到达模型** | 审查理由经 callId 注入被拒工具结果，agent 据此调整。fail-closed 回退拒绝与 `never` 策略硬禁用同样注入可审计文本（`[auto-review]` / `[auto-review-fallback]` / `[auto-review-never]` 标记）。 |
| 📜 **完整审计链** | `autoReview/verdict` + `autoReview/rejection` 会话事件（审查代理身份/裁决/理由/风险/耗时）+ invariant 伴生强制「模型可见 ⟺ 已记录」。 |
| 🔁 **防递归** | 审查代理自身的审批请求按身份识别并委托；`maxDepth` + 工具白名单保证其无法再委派。 |
| 🧯 **拒绝熔断器** | 单个回合内连续 3 次拒绝（或最近 10 次裁决中 6 次）即触发熔断器：后续请求委托、拒绝或中止回合——不再有无尽拒绝循环。 |
| 🎚️ **风险等级策略** | 风险超过 `riskPolicy.maxAutoAllow` 的 `allow` 裁决绝不定案：改为委托人类或拒绝。 |
| ✋ **一次性人工覆盖** | `/auto-review approve [n]` 授权对最近一次拒绝的**一次**重试；下一次同工具审查把该授权作为审查上下文携带（最终仍由审查代理决定）。 |
| 📜 **审查上下文** | 可选的紧凑转录（近期消息与工具结果，有界）+ Codex 风格 Markdown `reviewerPolicyText` 裁决策略。 |
| ⌨️ **会话级命令** | `/auto-review on|off|status|approve [n]`，带跨恢复生效的 durable 会话级覆盖与会话累计统计。 |
| 🖥️ **Web 审查面板** | 会话头部面板（Web GUI）展示开关（带开启/关闭按钮）、两项每回合预算、累计统计、熔断器触发、最近裁决与一次性批准按钮——由 `autoReview` 会话投影驱动。 |

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
                        │   never → rejected + [auto-review-never] 反馈
                        │            （硬禁用，不启动审查代理）
                        ▼
 审计：approval/asked → autoReview/verdict | autoReview/rejection
       → approval/decided（会话事件，log-only，invariant 校验）
```

**组合顺序。** answerer 在其注册位置参与 waterfall：若人类 UI answerer 组合在 `auto-review` 行之前，则人类先行应答，审查代理只处理下游委托过来的请求。请用 `dsh --profile <name> --dump-config` 核验；若希望 ai 策略工具优先路由到审查代理，把 `auto-review` 行放在人类 answerer 行之前。

## 🚀 快速开始

四种安装通道；本插件是 **bundle** 形态（`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`）。

```sh
# 1. npm（已发布产物，无需构建）
dsh plugin --profile web add dsh-auto-review
dsh --profile web               # 重启生效

# 2. npm tarball（构建产物，离线安装）
pnpm pack                       # → dsh-auto-review-<version>.tgz
dsh plugin --profile web add ./dsh-auto-review-<version>.tgz
dsh --profile web               # 重启生效

# 3. git 源（钉住 commit；自包含 prepare 负责构建）
#    pnpm ≥ 10 默认阻止生命周期构建：先把提示的 allowBuilds 键
#    加入 profile 的 pnpm-workspace.yaml。
dsh plugin --profile web add "github:PerryLink/dsh-auto-review#<commit>"

# 4. 本地 link（开发调试）
dsh plugin --profile web add link:/path/to/dsh-auto-review
```

验证：

```sh
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

开箱配置对 `bash`、`write` 走 AI 裁决；其余工具（包括 `edit` —— 就地修改）委托人类链。若接受无人工介入的就地编辑，请显式添加 `edit: ai`。

## ⚙️ 配置

所有可调参数都是 Schemastery `Config` 字段（cordis.yml 可改）。按 `id` 定向覆盖时**整行 config 被替换**——需要保留的键必须全部重述。

| 键 | 默认 | 含义 |
|---|---|---|
| `enableByDefault` | `true` | 会话初始是否启用；`/auto-review on\|off` 写入的 durable 覆盖优先于它 |
| `toolsPolicy.default` | `human` | 未列出工具的策略（委托人类 answerer） |
| `toolsPolicy.overrides` | `{}` | 每工具策略：`ai`（AI 裁决）、`human`（强制人类）、`never`（确定性拒绝） |
| `riskRules` | `[]` | `{pattern, policy, field?}` 在工具表**之前**按顺序匹配（首个命中生效）；`field` 选择 `reason`（默认）、`toolName` 或 `arguments`（脱敏后的呈现调用参数） |
| `reviewerProvider` | `fork` | 审查代理的 subagent provider（进程内 fork 后端） |
| `reviewerModel` | *(继承)* | 审查模型 id；不设则继承会话 agent 的模型路由 |
| `reviewerTimeoutMs` | `60000` | 裁决截止时间；超时走回退策略 |
| `reviewerTools` | `[read, glob, grep]` | 审查子代理的工具白名单（必须非空）——其余工具在其中不可见 |
| `fallbackPolicy` | `rejected` | 审查失败处理：`rejected`（fail closed）、`delegate`（继续沿链）、`allow-once`（放行——见安全边界）。0.2.0 由 `allow-readonly` 更名而来；旧拼写会响亮失败 |
| `maxReviewsPerTurn` | `10` | 每个开放回合的真实 AI 裁决预算；耗尽后请求委托人类 |
| `maxFailuresPerTurn` | `10` | 每个开放回合的审查失败预算（超时/不可用/schema 不符，不含取消）；耗尽后请求改为委托，而不再等待另一次完整超时。默认取 `maxReviewsPerTurn` |
| `reasonMaxChars` | `2000` | 审查理由、请求 reason 与脱敏参数预览的长度上限 |
| `reviewerGuidance` | *(无)* | 追加进审查 prompt 的可选指导语（建议性，非硬规则） |
| `reviewerPolicyText` | *(无)* | 注入审查 prompt 的 Markdown 裁决策略（Codex 风格；模板见 `fixtures/config/policy-template.md`） |
| `denyGuidance` | *(防规避文本)* | 追加到每一段注入拒绝理由之后的指导语 |
| `contextBudget` | `{turns: 0, maxChars: 4000}` | 审查 prompt 的紧凑转录预算；`turns: 0` 禁用 |
| `riskPolicy` | `{maxAutoAllow: high, onHighRisk: delegate}` | 高于 `maxAutoAllow` 的 `allow` 裁决委托（`delegate`）或拒绝（`deny`） |
| `circuitBreaker` | `{consecutiveDenies: 3, windowDenies: 6, windowSize: 10, action: delegate}` | 拒绝熔断器；连续 3 次拒绝或最近 10 次裁决中 6 次即触发；`action`：`delegate` / `reject` / `abort-turn` |
| `overrideTtlMs` | `300000` | `/auto-review approve` 覆盖保持可用的时长 |
| `language` | `en` | `/auto-review` 命令输出的界面语言（`en` \| `zh`） |

示例（完整注释版见 `fixtures/config/config-full.yaml`）：

```yaml
- insert:
    - id: auto-review
      name: dsh-auto-review
      config:
        toolsPolicy:
          overrides: { bash: ai, write: ai }
        riskRules:
          - pattern: '(?i)(rm\s+(-[a-z]+\s+)*/|git\s+push\s+--force)'
            policy: never
          - pattern: 'write'
            policy: never
            field: toolName
        reviewerTimeoutMs: 30000
        fallbackPolicy: delegate
        riskPolicy: { maxAutoAllow: medium, onHighRisk: delegate }
        circuitBreaker: { consecutiveDenies: 3, windowDenies: 6, windowSize: 10, action: delegate }
```

## ⌨️ 会话级命令

```
/auto-review on|off|status|approve [n]
```

`on`/`off` 追加 durable 的 `autoReview/state` 覆盖事件（fold 跨重启/恢复生效——重放即状态），并注入模型可见的切换通知（记录为 `user/message` 事件）。`status` 显示当前生效状态、两项回合预算（AI 裁决与审查失败）、当前回合已触发的熔断器（如有）以及会话的累计统计（放行/拒绝/失败/硬禁用拒绝、平均耗时、最近裁决）。`approve [n]` 针对第 n 近的拒绝（1 = 最近一次）记录一次性 `autoReview/override`：在 `overrideTtlMs` 内的下一次同工具审查携带该授权作为审查上下文——最终仍由审查代理决定，且无论该审查结果如何，此覆盖都会被消耗。

## 🖥️ Web 审查面板

在 Web GUI（web profile）中，本包贡献一个会话头部按钮（**AI 审查**），打开面板显示本会话的自动审查状态：开关（带开启/关闭按钮，执行 `/auto-review on|off`）、两项每回合预算、累计统计（含硬禁用拒绝）、熔断器触发、最近裁决，以及针对近期拒绝的一次性**批准**按钮（执行 `/auto-review approve [n]`）。

接线方式：

- 宿主注册一个 `autoReview` **会话投影**（由 log-only 的 `autoReview/*` 事件折叠而来），经会话投影通道送达浏览器。
- 浏览器半是一个 **client module**（由 `dsh.client` 声明自动发现），注册在 `conversation.session.header.actions` 席位。
- 无需额外 patch 行：只要插件安装在 web 构建提供会话投影能力的 profile（web profile 即如此）中，面板即自动加载；缺少该能力时面板显示不可用，answerer 不受影响。

面板只读取投影整值——浏览器插件永远不会收到原始会话事件流。

## 🔒 安全边界

- 审查代理运行在**只读工具面**（`toolFilter` 白名单）内：不能写、改、执行 shell、访问网络、再委派（`maxDepth` = 自身深度）。其会话日志同样落盘可审计。
- **敏感参数先脱敏**（按键名匹配：`token`、`password`、`api_key`、`Authorization`、凭据、私钥等）再进入审查 prompt；插件绝不执行被审参数。脱敏是键名级而非内容级——参数值不能接受展示给模型的工具，不要纳入 AI 审查。
- **默认 fail closed。** 所有异常路径（provider 缺失、能力缺口、启动被拒、超时、非 `completed` 停止原因、裁决缺失/不合规、审计关联失败）都走 `fallbackPolicy`，默认 `rejected`——且该拒绝把一段可审计的理由回喂模型，而不是通用的 “user rejected” 文本。`allow-once` 是无条件放行——仅供接受该风险的无人值守部署使用。
- **硬禁用会自我解释。** `never` 工具或风险规则确定性拒绝，并记录 log-only 的 `autoReview/rejection` 事件（含命中的规则/表项），再向被拒工具结果注入 `[auto-review-never]` 标记文本——模型明白该动作已被硬禁用，而不是反复重试（invariant 校验：标记 ⟺ 事件）。
- **拒绝熔断器。** 单个回合内的一连串拒绝（`consecutiveDenies` / `windowSize` 内的 `windowDenies`）触发熔断器，记录为 log-only 的 `autoReview/circuit` 事件；后续请求遵循其 `action`（`delegate` / `reject` / `abort-turn`）。`abort-turn` 注入模型可见的警告并取消 agent。
- **审查上下文是已呈现的转录。** `contextBudget` 把已呈现的会话内容（消息、工具结果）喂给审查代理。默认同路由审查模型下该内容始终留在同一 provider 内；只有当你接受将这份转录呈现给另一个 provider 时，才把 `reviewerModel` 配置为不同 provider。
- **`never` 在本层是单向的。** `never` 工具或风险规则在人类链看到请求之前即拒绝——是锁定旋钮，不是默认值。
- **审查代理也是模型。** 其裁决是建议性策略，不是安全内核。不可逆操作请配 `human`/`never` 规则。

## ⚠️ 已知局限

- 审查代理需要可用的 LLM 路由（默认继承会话 agent 的 provider/model）；没有路由时每次审查按 `fallbackPolicy` 回退——绝不静默放行。
- `reviewerTools` 中的名字必须是 profile 中真实存在的全局工具；未知名字会在最早点响亮失败并回退。
- 风险规则按各自的 `field` 匹配请求 `reason`、`toolName` 或脱敏后的调用 `arguments`；其他条件请用 `toolsPolicy.overrides`。
- `/auto-review approve` 覆盖授权的是下一次同工具审查，而非那次精确的历史调用；同一工具上的另一动作也会消耗它。
- 裁决事件是 log-only；专属 Web 审查面板读取折叠后的 `autoReview` 投影（原始事件流不会到达浏览器插件）。
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
pnpm test                   # vitest：135 个测试、8 个套件
pnpm run build              # tsc 声明 + tsdown 打包（lib/）
pnpm run verify:self-contained
pnpm pack                   # 发布产物
```

仓库结构（plugin-template 结构）：`src/index.ts`（插件契约）· `src/config.ts`（Schemastery schema + 解析）· `src/runtime.ts`（answerer、命令、拒绝理由注入）· `src/review.ts`（审查代理编排、prompt、脱敏）· `src/events.ts`（会话事件词汇 + fold）· `src/projection.ts` + `src/projection-types.ts`（`autoReview` 会话投影）· `src/invariant.ts`（invariant 伴生）· `src/client/`（浏览器半：审查面板、locales、样式）· `test/` · `fixtures/`。

## 👥 贡献者

感谢所有为 `dsh-auto-review` 做出贡献的人：

- [PerryLink](https://github.com/PerryLink) — 作者与维护者：审批 answerer、审查子代理、风险策略与熔断器、会话投影审查面板、invariant 伴生、文档、CI/CD 与发布。

想参与？请先看 [issue 模板](.github/ISSUE_TEMPLATE/)、[安全策略](SECURITY.md) 与 [AGENTS.md](AGENTS.md) 的仓库约定——欢迎中英文 PR。

## PerryLink DSH 插件家族

本项目是 [PerryLink](https://github.com/PerryLink) 维护的 [15 个 DeepSeek Harness 插件](https://github.com/PerryLink)之一。如果你觉得这个插件有用，其余的很可能同样有用：

| 插件 | 一句话说明 |
|---|---|
| [dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel) | 只读 MCP 运行时面板：/mcp 命令 + 设置页，状态/工具/错误一览 |
| [dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck) | 工程纪律守门：需求审讯、测试证据门、对抗评审 |
| [dsh-background-agents](https://github.com/PerryLink/dsh-background-agents) | 持久化后台子代理：Web 侧边栏进度、随时留言与打断 |
| [dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions) | 基于语言服务器的诊断/格式化/补全/代码动作/重命名 |
| [dsh-output-styles](https://github.com/PerryLink/dsh-output-styles) | 对标 Claude Code outputStyles 的运行时风格切换 |
| [dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind) | 对标 Claude Code /rewind：快照、会话 fork、一键回退 |
| [dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules) | Claude Code 风格声明式 allow/deny/ask 权限规则，带审计 |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | 审批链上的第二模型自动审查，默认 fail-closed |
| [dsh-memento](https://github.com/PerryLink/dsh-memento) | 带审批门的跨会话记忆：ctx.memory + SQLite + memory 工具 |
| [dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security) | 安全审计技能包：密钥扫描、依赖与供应链审查 |
| [dsh-session-pin](https://github.com/PerryLink/dsh-session-pin) | 在 Web 侧边栏置顶会话，持久排序 |
| [dsh-composer-history](https://github.com/PerryLink/dsh-composer-history) | Web 作曲器终端式输入历史：方向键、Ctrl+R 搜索 |
| [dsh-github](https://github.com/PerryLink/dsh-github) | DSH 的 GitHub PR/issue 集成，所有写操作经审批门 |
| [dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide) | 插件开发知识库，随 bundle 安装的按需 agent 技能 |
| [dsh-claude-move](https://github.com/PerryLink/dsh-claude-move) | 把 Claude Code 会话、记忆、技能和 CLAUDE.md 迁入 DSH |

## 📄 License

[Apache License 2.0](LICENSE)
