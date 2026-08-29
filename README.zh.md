<div align="center">

# 🤖 dsh-auto-review

**DeepSeek Harness 的第二模型 AI 审批 —— 一个只读审查子代理在审批链上做出允许/拒绝决策，默认失败关闭。**

*当某个动作越过沙箱边界时，第二模型读取证据并给出带有理由的裁决 —— 人类无需批准任何事，同时也没有任何不安全的东西蒙混过关。*

> **官方仓库。** 本仓库是 dsh-auto-review 的唯一官方仓库，由 PerryLink 维护。其他账号下的同名仓库与本项目无关。

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
| Harness | DeepSeek Harness `0.1.1-rc.2`（依赖锁定在 `0.1.1-rc.2`；peer 范围 `>=0.1.0-rc.8 <0.2.0`） |
| Node | `^22.19.0 \|\| >=24.0.0` |
| 平台 | 全部（宿主 answerer；可选 Web 审查面板，依赖会话投影能力） |
| 模型 | 任意（审查器默认继承会话代理的路由；`reviewerModel` 可覆盖） |

## 你能获得什么

`dsh-auto-review` 在 `approval/request` answerer 链上加入第二模型：

1. **官方接缝** —— 一个只认领自己负责的请求（`ai` 策略）的 answerer，其余请求通过 `next()` 委派；人类审批流程永远不会被短路。
2. **只读审查子代理** —— 一次性 fork，工具白名单为 `read`/`glob`/`grep`，返回结构化裁决 `{ decision, reason, riskLevel }`。审查器请求靠身份识别并委派；`maxDepth` + 白名单让审查器无法再委派。
3. **失败关闭** —— 审查器崩溃、超时或 schema 不匹配都会经由 `fallbackPolicy`（默认 `rejected`）处理；拒绝裁决会把理由反馈给调用模型。
4. **配置驱动路由** —— 按工具策略（`ai`/`human`/`never`）加正则风险规则，全部可在 cordis.yml 中修改。
5. **拒绝理由传达给模型** —— 审查器的理由会注入被拒绝的工具结果（callId 关联）；fallback 与 `never` 策略拒绝也会注入可审计标记（`[auto-review]` / `[auto-review-fallback]` / `[auto-review-never]`）。
6. **完整审计追踪** —— 仅日志的 `autoReview/verdict` + `autoReview/rejection` 会话事件（信封 `ignorable: true`），外加一个可选的 invariant 配套插件来强制「标记 ⟺ 事件」。
7. **安全旋钮** —— 拒绝熔断器（每轮 3 次连续拒绝，或最近 10 次裁决中 6 次拒绝）、风险等级策略、一次性 `/auto-review approve` 覆盖，以及会向模型自我解释的 `never` 策略硬禁用。
8. **可选审查上下文** —— 有界紧凑记录（`contextBudget`）加 Codex 风格 Markdown 裁决策略（`reviewerPolicyText`）。

每一次决策都能从会话日志重建：`approval/asked` → `autoReview/verdict`（或 `autoReview/rejection`）→ `approval/decided`。

## 为什么是第二模型而不是规则？

基于模式的自动审批器在派发前就做决定，没有证据。`dsh-auto-review` 把决定权交给一个**审查子代理**：它读取真实工作区（通过只读工具面）、已流式传出的工具调用参数（敏感值已脱敏）、请求理由与你的风险规则 —— 然后返回结构化裁决。拒绝裁决会把**理由反馈给调用模型**，让代理学会原因，而不是盲目重试。

## 快速开始

```sh
# 1. 将 bundle 安装到你的 profile
dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"

# 或从 npm 安装（已发布版本）
dsh plugin --profile web add dsh-auto-review

# 2. 重启并验证该行
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

开箱即用的补丁会 AI 审查 `bash` 与 `write`；其他所有工具（包括 `edit` —— 原地修改）都委派给人类审批链。如果你接受无人在环的原地编辑，请显式添加 `edit: ai`。

## 安装与卸载

- **git 渠道**（最新 `main`）：`dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"` —— 隔离的 `prepare` 构建需要 `dsh` CLI 为 `dsh-auto-review` 打印出的那个 `allowBuilds: { esbuild: true }` 键。
- **npm 渠道**（已发布版本）：`dsh plugin --profile web add dsh-auto-review`。
- **1024 商店渠道**：先 `npm i -g dsh1024`，再 `dsh1024 plugin --profile web add dsh-auto-review`（计入 [deepseek1024.com](https://deepseek1024.com) 安装排行）。
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
| `verdictCacheTtlMs` | `60000` | 对相同 `工具 + 参数` 指纹复用近期裁决的时长；`0` 关闭缓存 |
| `verdictCacheMaxEntries` | `256` | 缓存指纹上限，超出后淘汰最旧条目 |
| `language` | `en` | `/auto-review` 命令输出的界面语言（`en` \| `zh`） |
| `allowUnmarkedAudit` | `false` | 强制在丢弃 `ignorable` 标记的宿主上写入会话审计（危险：未标记事件会让会话在其他宿主上无法恢复）；默认自动探测并降级 |

示例（完整注释形式见 `fixtures/config/config-full.yaml`）：

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

## 会话命令

```
/auto-review on|off|status|approve [n]
```

`on`/`off` 追加持久的 `autoReview/state` 覆盖（折叠在重启/恢复后依然存活 —— 重放即状态），并注入一条模型可见的开关通知（记录为 `user/message` 事件）。`status` 报告有效状态、两个每轮预算（AI 裁决与审查器失败）、活跃的熔断器（如有），以及会话的累计统计（允许/拒绝/回退/never 拒绝、平均耗时、最近裁决）。`approve [n]` 为第 n 条最近的拒绝（1 = 最近）记录一次性 `autoReview/override`：`overrideTtlMs` 内下一次对同一工具的审查会携带该授权作为审查上下文 —— 审查器依然做决定，且无论结果如何，该覆盖都会被这次审查消耗掉。

## Web 审查面板

在 Web GUI（web profile）中，该包贡献一个会话头部操作（**AI Review**），打开面板显示会话的 auto-review 状态：带开/关按钮的开关（执行 `/auto-review on|off`）、两个每轮预算、累计统计（含硬禁用拒绝）、熔断触发、最近裁决，以及针对最近拒绝的一次性 **approve** 按钮（执行 `/auto-review approve [n]`）。

接线方式：

- 宿主注册一个 `autoReview` **会话投影**（由仅日志的 `autoReview/*` 事件折叠而成），并通过会话投影通道提供。
- 浏览器侧是**客户端模块**（从 `dsh.client` 声明自动发现），注册在 `conversation.session.header.actions` 席位。
- 无需额外补丁行：只要插件安装在 web 构建提供会话投影能力的 profile 中（web profile 提供），面板就会加载。没有该能力时面板报告自身不可用；answerer 不受影响。

面板只读取整个投影值 —— 它从不接收原始会话事件流。

## 工作原理

```text
                       approval/request waterfall (answerer chain)
                        │
┌───────────────────────┴──────────────────────┐
│ dsh-auto-review answerer                     │
│  · session enabled?  · policy = ai?         │   no ── next() ──▶ human answerer (UI)
│  · risk rules → toolsPolicy → default       │
└───────────────────────┬──────────────────────┘
                        │ yes
                        ▼
        ┌───────────────────────────────────┐
        │ reviewer subagent (fork, one-shot)│
        │  · toolFilter: read/glob/grep     │
        │  · outputSchema: {decision,       │
        │    reason, riskLevel}             │
        │  · timeout + req.signal abort     │
        └───────────────┬───────────────────┘
                        │ verdict / failure (fail-closed fallback)
                        ▼
 allow → allowed-once        deny → rejected + reason injected into the
                                       denied tool result (callId-linked)
                        │   never → rejected + [auto-review-never] feedback
                        │            (hard disable, no reviewer runs)
                        ▼
 audit: approval/asked → autoReview/verdict | autoReview/rejection
        → approval/decided (session events, log-only, invariant-checked)
```

**组合顺序。** answerer 在其注册位置运行于瀑布中：如果人类 UI answerer 被组合在 `auto-review` 行**之前**，则人类先应答，审查器只能看到被下游委派的部分。用 `dsh --profile <name> --dump-config` 验证，并把你希望 ai 策略工具先路由到审查器的 `auto-review` 行放在人类 answerer 行之前。

## dsh-eval —— 代理评估引擎

除了审批审查器，`dsh-auto-review` 还附带 `dsh-eval`：一个 YAML 驱动的代理评估平台，运行真实的 headless DSH 会话（每个用例一个隔离代理 + 临时工作区，以官方 Minimal persona 作为基线系统提示），从会话事件日志中收集工具调用轨迹，并评估结构化断言以及可选的第二模型审查 —— 与审批 answerer 使用同一条审查接缝。

```yaml
# eval/cases/demo.yaml (abridged)
suite:
  name: my-suite
  cases:
    - id: math-output
      input: Solve 17 × 24 and reply with only the final number, nothing else.
      expect:
        output: { contains: "408" }
    - id: glob-trace
      seedFrom: '.'
      input: Use the glob tool with pattern "src/**" to list the source files…
      expect:
        toolCalls: [{ tool: glob, arguments: { contains: { pattern: "src" } } }]
        results: [{ tool: glob, contains: "index.ts" }]
```

运行（环境需有 DeepSeek API 密钥）：

```sh
dsh-eval eval/cases --model deepseek-v4-flash --timeout-ms 240000 --out .eval-reports
```

### 断言族

`expect` 块支持六类断言族；每条断言独立求值，并报告各自的通过/失败与期望/实际值，失败的用例无需重跑即可自我解释。

| 断言族 | DSL 键 | 门禁内容 |
|---|---|---|
| 工具轨迹 | `toolCalls`、`toolCallsExact`、`noToolCalls`、`results` | 有序工具调用序列（允许跳过的子序列）、精确名称序列、逐工具结果（`isError`/`contains`/`regex`） |
| 输出与预算 | `output`、`turnEnds`、`maxTokens` | 最终输出的子串/正则、回合结果、token 预算 |
| Prompt 回归 | `prompt` | 渲染后的系统提示词必须匹配已提交的 `baseline`（或 `baselineFrom` 文件）；任何漂移都会以**并排 diff** 报告，可用 `allowedChanges` 正则白名单放行有意的修改 |
| 压测指标 | `stress` | P99 步延迟（`maxP99Ms`）、最差首 token 时延（`maxTtftMs`）、聚合 token 生成速度（`minTokensPerSecond`） |
| 公平性 | `bias` | 最终输出上的偏差雷达：逐类别正则计数（`categories`）、硬性 `forbid` 模式、`maxHits`/`maxCategoryHits` 上限 |
| 第二模型审查 | `review` | 审查子代理给出的补充通过/失败裁决（独立层，与审批审查器同一条接缝） |

```yaml
- id: regression-gate
  input: Answer in one sentence.
  expect:
    prompt:
      baseline: "You are a helpful software engineer assistant."
      allowedChanges: ["copyright-year"]
    stress:
      maxP99Ms: 8000
      maxTtftMs: 3000
      minTokensPerSecond: 20
    bias:
      categories: { gender: ["[Hh]e is (un)?stable"] }
      forbid: ["[Ss]crew that"]
      maxCategoryHits: 0
```

CI 门禁：仅当每个套件的每个用例都通过时，进程才以 0 退出 —— 评估失败即构建失败。每个用例都会在 `report.md`/`report.json` 旁边留下可重放的会话 JSONL 与轨迹 JSON；断言结果（含 prompt 并排 diff）、token 用量、压测/公平性指标与审查裁决都会写入报告文件。

```yaml
- name: dsh-eval
  run: npx dsh-eval eval/cases --model deepseek-v4-flash --timeout-ms 240000 --out .eval-reports
  env:
    DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
```

`dsh-eval` 与 [openai/codex-research](https://github.com/openai/codex-research) 的区别：codex-research 为研究对比对代理轨迹打分；`dsh-eval` 是声明式的通过/失败回归门禁 —— YAML 用例、结构化的轨迹/prompt/压测/公平性断言、可选的第二模型审查与 CI 退出码 —— 面向任何 DSH 代理的门禁，而非研究排名。

## MCP 服务器（独立进程）

`dsh-auto-review` 还附带一个 stdio **MCP 服务器**（`dsh-auto-review-mcp`），让外部 MCP 客户端（Claude、Codex 等）无需 harness 即可消费确定性裁决路径。它通过 newline-delimited JSON（NDJSON）承载 JSON-RPC 2.0——每行一个 JSON 对象，不支持 `Content-Length` 分帧。

**边界。** 完整 reviewer 依赖 harness 的 subagent seam 与第二模型，独立 stdio 进程无法调用。因此独立服务器是**确定性规则 + 缓存，无模型评审**：

- `review_action` 复用同指纹裁决缓存（`src/cache.ts`）与风险规则 / 工具策略解析（`src/config.ts`）：命中 `never` 规则 → `deny`；缓存命中相同 `tool + arguments` 指纹 → 重放该裁决；其余情况（`ai` 需要模型、`human` 需要人工）→ fail-closed `deny`，reason 为 `"standalone path, no model"`。它绝不会放行一个模型尚未放行的动作。
- `cache_stats` 报告命中/存储计数与 TTL 状态。

| 工具 | 用途 |
|---|---|
| `review_action` | `{tool, args?, reason?}` → `{decision, reason, riskLevel}` —— 确定性拒绝 / 缓存重放 |
| `cache_stats` | `{}` → `{hits, stores, size, ttlMs, enabled}` |

直接运行：

```sh
# 风险规则来自环境变量
export DSH_AUTO_REVIEW_RISK_RULES='[{"pattern":"rm -rf","policy":"never","field":"arguments"}]'
node bin/dsh-auto-review-mcp.mjs
# 或 npm 安装后：npx dsh-auto-review-mcp
```

环境变量配置：`DSH_AUTO_REVIEW_RISK_RULES`（`{pattern, policy, field?}` 的 JSON 数组）、`DSH_AUTO_REVIEW_TOOLS_POLICY`（JSON `{default?, overrides?}`）、`DSH_AUTO_REVIEW_CACHE_TTL_MS`、`DSH_AUTO_REVIEW_CACHE_MAX_ENTRIES`。

Claude Desktop（`claude_desktop_config.json`）配置示例：

```json
{
  "mcpServers": {
    "dsh-auto-review": {
      "command": "npx",
      "args": ["-y", "dsh-auto-review-mcp"],
      "env": {
        "DSH_AUTO_REVIEW_RISK_RULES": "[{\"pattern\":\"rm -rf\",\"policy\":\"never\",\"field\":\"arguments\"}]"
      }
    }
  }
}
```

服务器只读且确定性：无网络、无模型、无写入。

## 权限与数据

- **权限**：workshop 清单声明 `session:append`、`approval:answer`、`subagent:spawn`、`command:register` 与 `tools:observe`。
- **数据**：不向磁盘写入任何内容；报告环形缓冲在内存中且有界。自身不发起网络请求。
- **会话日志**：`autoReview/*` 事件携带审查器身份、裁决、理由、风险与耗时 —— 以信封 `ignorable: true` 标记追加，任何构建都能加载日志。`Session.append` 早于该标记的宿主（迄今发布的所有 rc 版本，至 `0.1.1-rc.2`——任何发布版都还未盖标记）会在首次追加前被探测出来（peer 版本预检 + 返回信封探测），审计降级为内存镜像 + 无标记反馈，会话日志始终保持可加载。

## 安全边界

- **审查器是模型。** 其裁决是建议性策略，不是安全内核；对不可逆操作优先使用 `human`/`never` 规则。
- **失败关闭。** 每条异常路径（provider 缺失、能力缺口、启动拒绝、超时、非 `completed` 停止原因、缺失/畸形裁决、审计关联失败）都经由 `fallbackPolicy` 处理，默认 `rejected` —— 且拒绝会向模型反馈一条可审计的理由。`allow-once` 是无条件放行；它只用于接受该风险的无值守部署。
- **只读审查器。** 审查器的 `toolFilter` 白名单（`read`/`glob`/`grep`）无法写入、编辑、运行 bash、访问网络或委派（`maxDepth` = 自身深度）。其会话日志被持久化且可审计。
- **敏感参数会被脱敏**（按键名匹配：`token`、`password`、`api_key`、`Authorization`、凭据、私钥……）后才进入审查器提示词；该插件绝不会执行被审查的参数。脱敏是按键名而非内容 —— 不要把参数值经不起展示给模型的工具交给 AI 审查。
- **硬禁用会自我解释。** `never` 工具或风险规则确定性拒绝，并记录一条仅日志的 `autoReview/rejection` 事件，然后把 `[auto-review-never]` 标记注入被拒绝的工具结果 —— 模型学会该操作已被硬禁用，而不是重试（invariant 校验：标记 ⟺ 事件）。
- **拒绝熔断器。** 一轮内连续拒绝会触发熔断（`consecutiveDenies` / 窗口内的 `windowDenies`），记录为仅日志的 `autoReview/circuit` 事件；后续请求按其 `action`（`delegate` / `reject` / `abort-turn`）处理。
- **审查上下文是已呈现的 transcript。** `contextBudget` 把已呈现的会话内容喂给审查器。默认同路由审查模型时该内容停留在单一 provider 内；仅当你接受把该 transcript 呈现给另一 provider 时，才把 `reviewerModel` 配成别的 provider。
- **`never` 在此层是单向的。** `never` 工具或风险规则会在人类审批链看到请求之前就拒绝 —— 是锁定旋钮，不是默认。

## 已知限制

- 审查器需要可用的 LLM 路由（默认继承）；没有路由时，每次审查都会按 `fallbackPolicy` 回退 —— 绝不会静默放行。
- `reviewerTools` 中的名称必须是 profile 中已存在的全局工具；未知名称会使审查器子代理在最早点大声失败并回退。
- 风险规则按各自的 `field` 匹配请求的 `reason`、`toolName` 或脱敏后的调用 `arguments`；其他条件应放入 `toolsPolicy.overrides`。
- `/auto-review approve` 覆盖授权的是下一次对同一工具的审查，而不是那次确切的历史调用；同一工具上的不同操作也会消耗它。
- 裁决事件是仅日志的；Web 审查面板读取折叠后的 `autoReview` 投影（原始事件流绝不会到达浏览器插件）。
- `autoReview/state` 与 `autoReview/verdict` 在支持标记的宿主上以信封 `ignorable: true` 追加，任何 harness 构建都能加载日志 —— 不认识这些仓库外类型的读取方直接跳过这些记录。已发布的 rc 宿主（rc.1–rc.8）上运行时会检测到标记被丢弃并完全不写这些事件（内存镜像继续提供命令、预算、熔断器与 `approve`）；pre-0.5.1 版本污染的会话可用 `dsh-permission-rules` 的 `scripts/repair-session-logs.mjs` 修复（其默认目标集已覆盖全部五种 `autoReview/*` 事件）。
- git 渠道需要 `dsh` CLI 为 `dsh-auto-review` 打印的那个 `allowBuilds` 键。仓库自带 `pnpm-workspace.yaml`，声明 `allowBuilds: { esbuild: true }`；`typescript` + `tsdown` 是普通 `dependencies`。
- 可选的 invariant 配套插件需要 `invariants` 服务（agent-spine 组合，如 headless/ACP）；普通 web profile 不提供该服务，所以该行在 bundle 补丁中默认被注释。

## 相关工作

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) —— `tools/pre-execute` 瀑布上的两态允许/拒绝分类器，带文件日志审计。`dsh-auto-review` 刻意不同：官方 **answerer** 链、总是委派不属于自己的部分、带结构化裁决的只读第二模型、拒绝理由反馈给模型、会话日志审计。
- [ACP 自动化桥](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/acp/acp) —— 为其自身 ACP 所有代理做一次性机器决策。`dsh-auto-review` 面向交互式 harness，按会话与工具策略作用域；它从不推断持久授权。

## 开发

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc：src + tests，针对本地 harness 检出
pnpm test                   # vitest：190 个测试，14 个文件
pnpm run build              # tsc 声明 + tsdown 打包（lib/，含客户端包）
pnpm run verify:self-contained
pnpm pack                   # 发布产物
```

仓库布局：`src/index.ts`（插件契约）· `src/config.ts`（Schemastery schema + 解析）· `src/runtime.ts`（answerer、命令、拒绝理由注入）· `src/review.ts`（审查编排、提示、净化）· `src/events.ts`（会话事件词汇 + 折叠）· `src/projection.ts` + `src/projection-types.ts`（`autoReview` 会话投影）· `src/invariant.ts`（invariant 配套）· `src/eval/`（dsh-eval 引擎）· `eval/`（随附评估组合）· `bin/dsh-eval.mjs`（CLI 启动器）· `src/client/`（浏览器侧）· `test/` · `fixtures/`。

## 主题

`deepseek-harness`、`dsh`、`dsh-plugin`、`cordis`、`approval`、`auto-review`、`second-model`、`ai-safety`、`sandbox`、`subagent`

## 贡献者

- [@PerryLink](https://github.com/PerryLink) —— 创建者与维护者：审批 answerer、审查子代理、风险策略与熔断器、会话投影审查面板、invariant 配套插件、dsh-eval，以及五语文档。
- [@weipeng1999](https://github.com/weipeng1999) —— 提出审查器独立的 provider/model 路由（[#11](https://github.com/PerryLink/dsh-auto-review/issues/11)、[讨论 #12](https://github.com/PerryLink/dsh-auto-review/discussions/12)），已落地为 `reviewerProvider` / `reviewerModel`。
- [@alexchenzl](https://github.com/alexchenzl) —— 将本插件收录进 DSH 插件目录（[#10](https://github.com/PerryLink/dsh-auto-review/issues/10)）。

## PerryLink DSH 插件家族

本项目是 [PerryLink](https://github.com/PerryLink) 维护的 DeepSeek Harness 插件之一。如果这个对你有帮助，其余的很可能也有帮助：

| 插件 | 一句话简介 |
|---|---|
| [dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel) | 只读 MCP 运行时面板：/mcp 命令 + 带状态、工具与错误的 Settings 标签页 |
| [dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck) | 工程纪律守卫：需求质询、测试门禁、对手评审 |
| [dsh-background-agents](https://github.com/PerryLink/dsh-background-agents) | 带 Web UI 侧栏、消息与中断的持久后台子代理 |
| [dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions) | 通过语言服务器的 LSP 诊断、格式化、补全、代码操作与重命名 |
| [dsh-output-styles](https://github.com/PerryLink/dsh-output-styles) | Claude Code outputStyles 等价的运行时风格切换 |
| [dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind) | Claude Code /rewind 等价：快照、会话 fork、一次性恢复 |
| [dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules) | Claude Code 风格声明式 allow/deny/ask 权限规则，带审计 |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | 审批链上的第二模型自动审查，默认失败关闭 |
| [dsh-memento](https://github.com/PerryLink/dsh-memento) | 审批门控的跨会话记忆：ctx.memory 接缝 + SQLite + 记忆工具 |
| [dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security) | 安全审计技能包：密钥扫描、依赖与供应链审查 |
| [dsh-session-pin](https://github.com/PerryLink/dsh-session-pin) | 在 Web 侧栏置顶会话，带持久排序 |
| [dsh-composer-history](https://github.com/PerryLink/dsh-composer-history) | Web 输入框的终端式历史：方向键、Ctrl+R 搜索 |
| [dsh-github](https://github.com/PerryLink/dsh-github) | 面向 DSH 的 GitHub PR/issues 集成，每次写入经审批门控 |
| [dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide) | 作为按需代理技能的插件开发知识库 |
| [dsh-claude-move](https://github.com/PerryLink/dsh-claude-move) | 把 Claude Code 会话、记忆、技能与 CLAUDE.md 迁入 DSH |

## 许可证

[Apache License 2.0](LICENSE) © 2026 dsh-auto-review contributors
