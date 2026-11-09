<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dsh-auto-review-hero-zh-dark.webp">
  <img src="docs/assets/dsh-auto-review-hero-zh-light.webp" width="100%" alt="dsh-auto-review 裁决夹：approval/request 认领 ai 策略请求，只读审查室（agent 子代理 / 本地 Phocinae）读取脱敏证据，返回 {decision, reason, riskLevel}；deny 的理由经 callId 回注被拒工具结果，fallback 走 rejected / delegate / allow-once">
</picture>

# dsh-auto-review

**让第二个模型在审批链上替你裁决——人类零点击，危险操作零漏网。**

面向 DeepSeek Harness 的第二模型 AI 审批插件：当动作越过沙箱边界，一个只读审查子代理读取证据并返回带理由的裁决，默认失败关闭。

[安装](#三步上手) · [配置](#配置) · [FAQ](#faq) · [简体中文](README.md) · [English](README.en.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-3366CC?style=flat-square&labelColor=2B3245)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%E2%89%A50.2.1%20%3C0.3.0-4B67B4?style=flat-square&labelColor=2B3245)](#兼容性)
[![npm](https://img.shields.io/npm/v/dsh-auto-review?style=flat-square&labelColor=2B3245&color=CB3837)](https://www.npmjs.com/package/dsh-auto-review)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-auto-review/ci.yml?branch=main&label=CI&style=flat-square&labelColor=2B3245)](https://github.com/PerryLink/dsh-auto-review/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933?style=flat-square&labelColor=2B3245)](#兼容性)

[![Stars](https://img.shields.io/github/stars/PerryLink/dsh-auto-review?style=flat-square&labelColor=2B3245)](https://github.com/PerryLink/dsh-auto-review/stargazers)
[![npm downloads](https://img.shields.io/npm/dm/dsh-auto-review?style=flat-square&labelColor=2B3245&color=CB3837)](https://www.npmjs.com/package/dsh-auto-review)
[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-auto-review?metric=downloads)](https://dshfind.com/plugins/PerryLink/dsh-auto-review?ref=badge)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/PerryLink/dsh-auto-review/badge)](https://securityscorecards.dev/viewer/?uri=github.com/PerryLink/dsh-auto-review)
[![DSH Market](https://img.shields.io/badge/DSH_Market-listed-4B67B4?style=flat-square&labelColor=2B3245)](https://dsh.market/)
[![Gitee](https://img.shields.io/badge/Gitee-mirror-C71D23?style=flat-square&labelColor=2B3245&logo=gitee)](https://gitee.com/perrylink/dsh-auto-review)

```sh
dsh plugin --profile <name> add dsh-auto-review
```

</div>

<sub>社区插件，与 DeepSeek 官方无关。唯一仓库：<https://github.com/PerryLink/dsh-auto-review>（Gitee 为镜像）。</sub>

## 它是什么

当某个动作越过沙箱边界，`dsh-auto-review` 把审批决定交给第二个模型：一个只读审查子代理读取真实工作区（经 `read`/`glob`/`grep` 白名单）、已流式传出的工具调用参数（敏感值已脱敏）、请求理由与你的风险规则，返回结构化裁决 `{ decision, reason, riskLevel }`——人类无需批准任何事，也没有任何不安全的东西蒙混过关。拒绝裁决会把理由反馈给调用模型，让代理学会原因而不是盲目重试；每一次决策都能从会话日志重建。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dsh-auto-review-flow-v5-dark.svg">
  <img src="docs/assets/dsh-auto-review-flow-v5-light.svg" width="100%" alt="dsh-auto-review 认领漏斗：越界请求依次通过认领闸门、证据装配、只读审查室与裁决契约，收束为 allow / deny / fallback 三个出口；非 ai、预算耗尽与 delegate 经 next() 委派给人类审批链，never 与审查失败在右侧确定性收口，底部是仅日志的审批审计链">
</picture>

*结构：认领漏斗 —— 四道认领闸门把越界请求逐层收窄，只有 ai 策略进入只读审查室（agent 子代理或本地 Phocinae），最终收束为 allow / deny / fallback 三个出口；右侧是 next() 委派与确定性收口两条旁路，底部是仅日志审计链。*

## 三步上手

1. **安装**（四选一）：

   ```sh
   # git 渠道（最新 main；等价于 git+https://github.com/PerryLink/dsh-auto-review.git）
   dsh plugin --profile web add github:PerryLink/dsh-auto-review
   # npm 渠道（已发布版本）
   dsh plugin --profile web add dsh-auto-review
   # 1024 商店渠道：先 npm i -g dsh1024，再
   dsh1024 plugin --profile web add dsh-auto-review
   # tarball 渠道：本仓库 pnpm pack 后
   dsh plugin --profile web add ./dsh-auto-review-<version>.tgz
   ```

   git 渠道的隔离 `prepare` 构建需要 `dsh` CLI 为 `dsh-auto-review` 打印出的 `allowBuilds` 键；当 `dsh plugin add` 因 `koffi` / `node-pty`（评估宿主拉入）停在 `ERR_PNPM_IGNORED_BUILDS` 时，运行 `pnpm approve-builds` 批准这些构建脚本。

2. **最小配置**（开箱即用；随附 patch 默认 AI 审查 `bash`、`write`、`pwsh`、`powershell`）：

   ```yaml
   - insert:
       - id: auto-review
         name: dsh-auto-review
         config:
           toolsPolicy:
             overrides: { bash: ai, write: ai, pwsh: ai, powershell: ai }
   ```

   其他所有工具（包括 `edit`——原地修改）都委派给人类审批链；接受无人在环的原地编辑时显式加 `edit: ai`。

3. **验证已生效**：

   ```sh
   dsh --profile web --dump-config | grep -A4 'id: auto-review'
   ```

   ```
   > /auto-review status
   All-time: 1 allows, 0 denies, 1 fallbacks, 1 never rejects (avg 10 ms per verdict).
   Recent verdicts: write: fallback(timeout), bash: allow
   ```

**卸载**：`dsh plugin --profile web remove dsh-auto-review`（或从 profile patch 删掉该行）。

<details>
<summary>从 DSH Desktop 市场安装</summary>

所有 PerryLink 插件均可在 DSH Desktop 内置市场中浏览：**市场 → 来源 → 添加来源 → 粘贴** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ 选中**。安装仍需通过市场的 npm 身份校验与你的确认。

</details>

## 核心能力

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

### 为什么是第二模型而不是规则？

基于模式的自动审批器在派发前就做决定，没有证据。`dsh-auto-review` 把决定权交给一个**审查子代理**：它读取真实工作区（通过只读工具面）、已流式传出的工具调用参数（敏感值已脱敏）、请求理由与你的风险规则——然后返回结构化裁决。拒绝裁决会把**理由反馈给调用模型**，让代理学会原因，而不是盲目重试。

### 示例

以下为插件真实入口；安装后调用一个即可。

**详细示例** — 命令：

```sh
/auto-review status
```

输出：

```text
All-time: 1 allows, 0 denies, 1 fallbacks, 1 never rejects (avg 10 ms per verdict).
Recent verdicts: write: fallback(timeout), bash: allow
```

*Observed from `test/command.spec.ts:123-160 (assertions at :158-159)`*

**失败分支** — 输入：

```text
/auto-review approve 2
```

输出：

```text
No recent denial #2 in this session (0 recorded).
```

*Observed from `plugins/dsh-auto-review/src/messages.ts:53; plugins/dsh-auto-review/src/runtime.ts:1039; plugins/dsh-auto-review/test/command.spec.ts:109-113`*

**简短示例**：`auto-review` · `dsh-eval`

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

`on`/`off` 追加持久的 `autoReview/state` 覆盖（折叠在重启/恢复后依然存活——重放即状态），并注入一条模型可见的开关通知（记录为 `user/message` 事件）。`status` 报告有效状态、两个每轮预算（AI 裁决与审查器失败）、活跃的熔断器（如有），以及会话的累计统计（允许/拒绝/回退/never 拒绝、平均耗时、最近裁决）。`approve [n]` 为第 n 条最近的拒绝（1 = 最近）记录一次性 `autoReview/override`：`overrideTtlMs` 内下一次对同一工具的审查会携带该授权作为审查上下文——审查器依然做决定，且无论结果如何，该覆盖都会被这次审查消耗掉。

## Web 审查面板

在 Web GUI（web profile）中，该包贡献一个会话头部操作（**AI Review**），打开面板显示会话的 auto-review 状态：带开/关按钮的开关（执行 `/auto-review on|off`）、两个每轮预算、累计统计（含硬禁用拒绝与缓存命中）、熔断触发、最近裁决，以及针对最近拒绝的一次性 **approve** 按钮（执行 `/auto-review approve [n]`）。

接线方式：

- 宿主注册一个 `autoReview` **会话投影**（由仅日志的 `autoReview/*` 事件折叠而成），并通过会话投影通道提供。
- 浏览器侧是**客户端模块**（从 `dsh.client` 声明自动发现），注册在 `conversation.session.header.actions` 席位。
- 无需额外补丁行：只要插件安装在 web 构建提供会话投影能力的 profile 中（web profile 提供），面板就会加载。没有该能力时面板报告自身不可用；answerer 不受影响。

面板只读取整个投影值——它从不接收原始会话事件流。

## dsh-eval —— 代理评估引擎

除了审批审查器，`dsh-auto-review` 还附带 `dsh-eval`：一个 YAML 驱动的代理评估平台，运行真实的 headless DSH 会话（每个用例一个隔离代理 + 临时工作区，以官方 Minimal persona 作为基线系统提示），从会话事件日志中收集工具调用轨迹，并评估结构化断言以及可选的第二模型审查——与审批 answerer 使用同一条审查接缝。

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
dsh-eval eval/cases --model deepseek-flash --timeout-ms 240000 --out .eval-reports
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

CI 门禁：仅当每个套件的每个用例都通过时，进程才以 0 退出——评估失败即构建失败。每个用例都会在 `report.md`/`report.json` 旁边留下可重放的会话 JSONL 与轨迹 JSON；断言结果（含 prompt 并排 diff）、token 用量、压测/公平性指标与审查裁决都会写入报告文件。

```yaml
- name: dsh-eval
  run: npx dsh-eval eval/cases --model deepseek-flash --timeout-ms 240000 --out .eval-reports
  env:
    DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
```

`dsh-eval` 与 [openai/codex-research](https://github.com/openai/codex-research) 的区别：codex-research 为研究对比对代理轨迹打分；`dsh-eval` 是声明式的通过/失败回归门禁——YAML 用例、结构化的轨迹/prompt/压测/公平性断言、可选的第二模型审查与 CI 退出码——面向任何 DSH 代理的门禁，而非研究排名。

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

## 实测数据

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dsh-auto-review-evidence-zh-dark.webp">
  <img src="docs/assets/dsh-auto-review-evidence-zh-light.webp" width="100%" alt="Phocinae 后端 91 命令基准：默认 0.45 加保护下 0/58 破坏性命令被放行（28 拒绝 / 30 升级），3/33 常规命令放行">
</picture>

版本化的 91 条命令集（[`bench/phocinae-commands.json`](bench/phocinae-commands.json)：58 条破坏性、33 条常规）由 `node bench/phocinae-bench.mjs` 对运行中的 phocinae-server 执行。默认 `phocinae.minConfidence: 0.45` 且启用路径/算子保护时，**58 条破坏性命令 0 条被放行**——28 条拒绝、30 条升级——33 条常规命令放行 3 条；单次前向 ≈21 ms（GPU 热态）/ ≈1.5 s（CPU 单线程）。这是实测集合，不是证明：集合之外的命令仍可能被误判，保护规则与 caveat 的完整论述见「配置」一节的 Phocinae 小节。

## 配置

所有可调项都是 Schemastery `Config` 字段（可在 cordis.yml 中修改）。按 id 定向的覆盖会替换整行——请重述你需要的每一个键。`cordis.patch.yml` 逐键内联注释。

最常用键：

| 键 | 默认值 | 含义 |
|---|---|---|
| `toolsPolicy.default` | `human` | 未列出工具的默认策略（委派给人类 answerer） |
| `toolsPolicy.overrides` | `{}` | 按工具策略：`ai` / `human` / `never` |
| `riskRules` | `[]` | 在工具表之前匹配的 `{pattern, policy, field?}`；`field` 选择 `reason`（默认）、`toolName` 或 `arguments` |
| `reviewerModel` | *(继承)* | 审查器模型 id；不设置则继承会话代理的路由 |
| `reviewerBackend` | `agent` | 审查引擎：`agent`（生成式审查器）或 `phocinae`（本机非生成式决策服务）。不设置时由 `reviewerModel` 推断：`Phocinae…` 模型 id 会选择 `phocinae` |
| `phocinae.minConfidence` | `0.45` | 放行所需的校准置信度下限；置信度不足的 allow 会走 `fallbackPolicy`，不会放行 |
| `fallbackPolicy` | `rejected` | 审查器失败时的策略：`rejected`（失败关闭）/ `delegate` / `allow-once` |
| `reviewerTimeoutMs` | `60000` | 裁决截止时间；超时后应用 fallback 策略 |

<details>
<summary>完整配置表（32 个键）</summary>

| 键 | 默认值 | 含义 |
|---|---|---|
| `enableByDefault` | `true` | 会话默认开启 auto-review；`/auto-review on\|off` 写入的持久覆盖优先于此 |
| `toolsPolicy.default` | `human` | 未列出工具的默认策略（委派给人类 answerer） |
| `toolsPolicy.overrides` | `{}` | 按工具策略：`ai` / `human` / `never` |
| `riskRules` | `[]` | 在工具表之前匹配的 `{pattern, policy, field?}`；`field` 选择 `reason`（默认）、`toolName` 或 `arguments` |
| `reviewerProvider` | `fork` | 审查器的子代理 provider（进程内 fork 后端） |
| `reviewerPreset` | *(none)* | 只读 Agent Preset id；宿主只提供 `startActivation`（0.2.1+）时必填 |
| `reviewerModel` | *(继承)* | 审查器模型 id；不设置则继承会话代理的路由 |
| `reviewerModelProvider` | *(继承)* | `reviewerModel` 的 LLM provider 路由；不设置则继承会话代理的 provider |
| `reviewerBackend` | `agent` | 审查引擎：`agent`（生成式审查器）或 `phocinae`（本机非生成式决策服务）。不设置时由 `reviewerModel` 推断：`Phocinae…` 模型 id 会选择 `phocinae` |
| `phocinae.endpoint` | `http://127.0.0.1:8155/v1/systemone` | Phocinae 决策服务地址；除设置 `phocinae.allowRemoteEndpoint` 外仅允许 loopback |
| `phocinae.model` | `Phocinae-Largha-150M-v1` | 服务端模型名；`reviewerModel` 为 Phocinae 模型时自动采用 |
| `phocinae.timeoutMs` | `5000` | 单次 HTTP 截止时间（只尝试一次，不重试），受 `reviewerTimeoutMs` 约束 |
| `phocinae.minConfidence` | `0.45` | 放行所需的校准置信度下限；置信度不足的 allow 会走 `fallbackPolicy`，不会放行。默认 0.45 在版本化 91 条命令集上实测：0.45 下 58 条破坏性命令 0 条被放行（带保护时 0.4/0.35 也是 0/58）；裸模型在 0.4 下会放行两条系统路径命令 |
| `phocinae.maxStateChars` | `4096` | 决策状态渲染上限；被截断的状态可以拒绝，但永远不会放行 |
| `phocinae.allowRemoteEndpoint` | `false` | 允许非 loopback 端点。状态里含被审调用的文本，所以这是一次显式的数据出境决定 |
| `reviewerTimeoutMs` | `60000` | 裁决截止时间；超时后应用 fallback 策略 |
| `reviewerTools` | `[read, glob, grep]` | 审查器子代理的工具白名单（必须非空） |
| `fallbackPolicy` | `rejected` | 审查器失败时的策略：`rejected`（失败关闭）/ `delegate` / `allow-once` |
| `maxReviewsPerTurn` | `10` | 每个开放轮次真实 AI 裁决的预算；超出后请求委派给人类 |
| `maxFailuresPerTurn` | `10` | 每个开放轮次审查器失败的预算（默认等于 `maxReviewsPerTurn`） |
| `reasonMaxChars` | `2000` | 审查理由与脱敏参数预览的上限 |
| `reviewerGuidance` | *(无)* | 追加到审查器提示词的可选指导性说明 |
| `reviewerPolicyText` | *(无)* | 注入审查器提示词的 Markdown 裁决策略（Codex 风格） |
| `denyGuidance` | *(反规避文本)* | 追加到每一条注入的拒绝理由之后的指导 |
| `contextBudget` | `{turns: 2, maxChars: 4000}` | 审查器提示词的紧凑记录预算（当前回合加上一回合）；`turns: 0` 表示禁用该段落——没有记录的审查器会拒绝用户已授权的操作，因此当 0 与 `ai` 策略同时出现时运行时会发出警告。字符预算优先用于最近的行 |
| `riskPolicy` | `{maxAutoAllow: high, onHighRisk: delegate}` | 超过 `maxAutoAllow` 的 `allow` 裁决委派或拒绝 |
| `circuitBreaker` | `{consecutiveDenies: 3, windowDenies: 6, windowSize: 10, action: delegate}` | 拒绝熔断器 |
| `overrideTtlMs` | `300000` | `/auto-review approve` 覆盖的有效时长 |
| `verdictCacheTtlMs` | `60000` | 对相同 `工具 + 参数` 指纹复用近期裁决的时长；`0` 关闭缓存。仅在 `contextBudget.turns: 0` 时生效——依赖会话记录的裁决无法仅凭 `工具 + 参数` 重放 |
| `verdictCacheMaxEntries` | `256` | 缓存指纹上限，超出后淘汰最旧条目 |
| `language` | `en` | `/auto-review` 命令输出的界面语言（`en` \| `zh`） |
| `allowUnmarkedAudit` | `false` | 在丢弃 `ignorable` 标记或对未知事件类型失败关闭的宿主上强制写入会话日志审计（宿主 `0.1.2-rc.1`+）（危险：未标记事件会让会话在其他地方无法恢复）；默认是探测并降级（2026-09-02 适配，2026-09-11 针对 `0.1.5-rc.2` 复核）：会话信封保留 ignorable 字段但仅用于存量日志读取兼容——Session.append 仍无法盖章，门控行为不变 |

</details>

### 本地决策模型审查器（Phocinae，可选）

`reviewerBackend: phocinae` 会把生成式审查器换成由 [`phocinae-server`](https://github.com/Phocinae/phocinae-server) 提供的本机非生成式 **Phocinae-Largha-150M-v1** 决策模型（`POST /v1/systemone`）。模型只回答一个类型化问题，不生成任何 token，因此审查**不需要 API key、不需要 `subagents`/`llm` 接缝、也不需要外部网络**（仅 loopback）：一次前向（GPU 热态约 21 ms，CPU 单线程约 1.5 s）返回带校准置信度的危害标签。

```yaml
config:
  toolsPolicy: { overrides: { bash: ai } }
  reviewerModel: Phocinae-Largha-150M-v1   # 仅这一项即可选中 Phocinae 后端
  phocinae:
    endpoint: http://127.0.0.1:8155/v1/systemone
    minConfidence: 0.45
  fallbackPolicy: delegate                 # 可选：把 risky/不确定的请求交给人类链
```

**它是否决/分级层，不是通用放行者。** 只有 `harmless` 且 `answer_confidence >= phocinae.minConfidence`（默认 0.45）才会放行。`destructive` 直接拒绝；`risky`、置信度不足的 `harmless`、系统/敏感路径、服务不可达或响应不合法都走 `fallbackPolicy`（默认失败关闭的 `rejected`；设为 `delegate` 则交给人类链）。审查只针对 **shell 命令**：`write`/`edit` 等没有 `command` 参数的调用会直接升级，不会询问模型。

状态文本就是 `The agent is about to run the shell command "<command>" in its workspace.`，选项带描述（把模型训练时的 `criteria` 渲染进选项文本，因为 HTTP 契约没有 `criteria` 字段）。版本化的 91 条命令集（`bench/phocinae-commands.json`：58 条破坏性、33 条常规）由 `node bench/phocinae-bench.mjs` 对运行中的服务执行；在默认 `0.45` 且启用路径/算子保护时，**58 条破坏性命令 0 条被放行**——28 条拒绝、30 条升级——33 条常规命令放行 3 条。`0.4` 下裸模型会放行 `cat /etc/shadow`（0.4036）与 `cp /dev/null /etc/passwd`（0.4265），所以默认值是 0.45，且保护规则是必需的（带保护的产物在 0.4/0.35 下仍是 0/58）。这是实测集合，不是证明：模型仍是建议性的，集合之外的命令仍可能被误判——路径/算子保护覆盖了 2026-10-26 审计发现的系统路径与复合命令类别。审批理由、转录和工作区路径**不会**发送；命令本身要经过与生成式提示词相同的键名级与内联密钥脱敏。端点默认仅允许 loopback，除非设置 `phocinae.allowRemoteEndpoint: true`。该后端只作用于审批审查；`dsh-eval` 的审查层仍使用生成式模型。

含 shell 控制符的命令**永远不会被放行**：命令里出现 `;`、`&`、`|`、`$()`、反引号、重定向、换行或其他控制字符时，即使模型回答 `harmless` 也会升级——因为对可见文本的 `harmless` 判断不能代表复合命令整体。引用系统/敏感路径（`/etc`、`/dev`、`/proc`、`/root`、`~/.ssh`、`.env`、凭据、Windows 系统路径）的命令同样会升级而不是放行。非 shell 调用（`write`、`edit` 等）同样会升级：bundle patch 默认带 `write: ai`，启用本后端时请把 `write`/`edit` 改成 `human`，否则它们会按默认 fallback 被拒绝。

以下设置只对生成式审查器有效，本后端会忽略：`reviewerProvider`、`reviewerPreset`、`reviewerModelProvider`、`reviewerTools`、`reviewerGuidance`、`reviewerPolicyText`、`contextBudget`。`/auto-review approve` 有效：它会把一句“用户已授权一次重试”（含 review id 与工具名）加入 state，模型仍会自行裁决。客户端不发送 `Authorization` 头；若服务端设置了 `PHOC_BEARER_TOKEN`，请不要设置它，或在前面加认证代理。

启动服务：`pip install phocinae-server`（或直接运行仓库），从[模型卡](https://huggingface.co/Phocinae/Phocinae-Largha-150M-v1)下载权重，然后 `PHOC_MODEL_DIR=<weights-dir> python -m phocinae.main`——它监听 `127.0.0.1:8155`；用 `curl http://127.0.0.1:8155/health` 验证。

示例（完整注释形式见 `fixtures/config/config-full.yaml`）：

```yaml
- insert:
    - id: auto-review
      name: dsh-auto-review
      config:
        toolsPolicy:
          overrides: { bash: ai, write: ai }
        riskRules:
          - pattern: '([Rr][Mm]\s+(-[a-z]+\s+)*/|[Gg][Ii][Tt]\s+push\s+--force)'
            policy: never
          - pattern: 'write'
            policy: never
            field: toolName
        reviewerTimeoutMs: 30000
        fallbackPolicy: delegate
        riskPolicy: { maxAutoAllow: medium, onHighRisk: delegate }
        circuitBreaker: { consecutiveDenies: 3, windowDenies: 6, windowSize: 10, action: delegate }
```

### 配置究竟从哪里来

**`~/.dsh/settings.yaml` 不是本插件的配置来源。** 在其中写 `auto-review:` 块不会生效，也不会有任何警告：与每个 DSH 函数插件一样，`dsh-auto-review` 的 `Config` 来自 Loader 挂载它的那一行——也就是 profile 的 cordis patch 层。（部分其他 DSH 插件还会读取 settings 服务，因此这种不一致很容易踩坑，而且其症状与“审查器就是拒绝了”完全无法区分。）

请把配置写进 profile 的 `cordis.patch.yml`。**按 id 定向的 override 会替换整行 config**，因此需要重述你所需的每一个键——省略 `toolsPolicy` 会让 `bash`/`write` 悄悄回落到 schema 默认值 `human`，审查器随即完全不再运行：

```yaml
- id: auto-review
  config:
    toolsPolicy:
      overrides: { bash: ai, write: ai }
    contextBudget: { turns: 4, maxChars: 8000 }
```

## FAQ

<details>
<summary>配置到底写在哪？为什么 <code>~/.dsh/settings.yaml</code> 里的 <code>auto-review:</code> 块不生效？</summary>

`~/.dsh/settings.yaml` 不是本插件的配置来源——写在那里既没有效果也没有警告。与每个 DSH 函数插件一样，`dsh-auto-review` 的 `Config` 来自 profile 的 cordis patch 层（`cordis.patch.yml`）。注意按 id 定向的 override 会替换整行：省略 `toolsPolicy` 会让 `bash`/`write` 回落到默认值 `human`，审查器随即不再运行——请重述你需要的每一个键。

</details>

<details>
<summary>审查器崩溃、超时或返回畸形结果时会怎样？会静默放行吗？</summary>

不会静默放行。每条异常路径（provider 缺失、能力缺口、启动拒绝、超时、非 `completed` 停止原因、缺失/畸形裁决、审计关联失败）都经由 `fallbackPolicy` 处理，默认 `rejected`——失败关闭，且拒绝会向模型反馈一条可审计的理由。每轮预算（`maxReviewsPerTurn` / `maxFailuresPerTurn`）用尽的请求委派给人类链；`allow-once` 只适用于接受该风险的无值守部署。

</details>

<details>
<summary>我的数据存在哪？会外发吗？</summary>

插件自身不发起网络请求、不向磁盘写任何内容；报告环形缓冲在内存中且有界。裁决与拒绝写入仅日志的 `autoReview/*` 会话事件（信封 `ignorable: true`；不支持的宿主在首次追加前被探测出来并降级为内存镜像）。敏感参数在进入审查器提示词前按键名与内联启发式脱敏。Phocinae 后端只把（脱敏后的）命令文本发给 loopback 端点——理由、转录与工作区路径都不发送；远程端点需显式设置 `phocinae.allowRemoteEndpoint`。

</details>

<details>
<summary>会和其他插件或人类审批 UI 抢审批链吗？</summary>

不会。answerer 只认领 `ai` 策略的请求，其余一律经 `next()` 委派，人类审批流程永远不会被短路；组合顺序可用 `dsh --profile <name> --dump-config` 验证。逐条论证见「与其他 DSH 插件的互操作性」。

</details>

<details>
<summary>性能开销多大？</summary>

生成式审查器是每个 `ai` 策略请求一次性 fork 的子代理，受 `reviewerTimeoutMs`（默认 60 s）截止约束；相同 `工具 + 参数` 指纹在 `verdictCacheTtlMs` 内直接复用裁决（仅当 `contextBudget.turns: 0`）。可选的 Phocinae 本地后端不需要 LLM 路由：单次前向 ≈21 ms（GPU 热态）/ ≈1.5 s（CPU 单线程），实测见「实测数据」。

</details>

## 安全边界

- **审查器是模型。** 其裁决是建议性策略，不是安全内核；对不可逆操作优先使用 `human`/`never` 规则。
- **失败关闭。** 每条异常路径（provider 缺失、能力缺口、启动拒绝、超时、非 `completed` 停止原因、缺失/畸形裁决、审计关联失败）都经由 `fallbackPolicy` 处理，默认 `rejected`——且拒绝会向模型反馈一条可审计的理由。`allow-once` 是无条件放行；它只用于接受该风险的无值守部署。
- **只读审查器。** 审查器的 `toolFilter` 白名单（`read`/`glob`/`grep`）无法写入、编辑、运行 bash、访问网络或委派（`maxDepth` = 自身深度）。其会话日志被持久化且可审计。
- **上下文隔离的审查器。** 审查器子代理的每一步都在官方 `agent/pre-step` 接缝上被过滤：只有它自己的提示词与它自己的只读工具结果能够进入。工作区指令文件（`AGENTS.md` / `CLAUDE.md`）与注入上下文的插件会在该接缝处被丢弃；**宿主自己的运行时上下文快照会在 `agent/pre-step` 之后被循环重新接纳，防火墙无法移除它，因此审查器能看到该快照。**这在任一 subagent provider 下都成立——这些注入方会向任何新建的 agent 会话重新注入，因此关闭它们的是这道过滤，而不是 provider 的选择。白名单按消息来源判定，所以声明了新来源类型的插件同样会被丢弃。
- **敏感参数会被脱敏**（按键名匹配：`token`、`password`、`api_key`、`Authorization`、凭据、私钥……）后才进入审查器提示词；自由字符串参数还会额外经过一层内联启发式，掩掉 `KEY=VALUE` / `KEY: VALUE` / `--flag VALUE` 这几种写法以及 `Bearer`/`Basic` 方案——而命令行里的密钥通常正是这样出现的。该插件绝不会执行被审查的参数。两层都是尽力而为，不是密钥扫描器：旁边没有键名的裸密钥仍然可见，所以不要把参数值经不起展示给模型的工具交给 AI 审查。
- **硬禁用会自我解释。** `never` 工具或风险规则确定性拒绝，并记录一条仅日志的 `autoReview/rejection` 事件，然后把 `[auto-review-never]` 标记注入被拒绝的工具结果——模型学会该操作已被硬禁用，而不是重试（invariant 校验：标记 ⟺ 事件）。
- **拒绝熔断器。** 一轮内连续拒绝会触发熔断（`consecutiveDenies` / 窗口内的 `windowDenies`），记录为仅日志的 `autoReview/circuit` 事件；后续请求按其 `action`（`delegate` / `reject` / `abort-turn`）处理。
- **审查上下文是已呈现的 transcript。** `contextBudget` 把已呈现的会话内容喂给审查器。默认同路由审查模型时该内容停留在单一 provider 内；仅当你接受把该 transcript 呈现给另一 provider 时，才把 `reviewerModel` 配成别的 provider。
- **`never` 在此层是单向的。** `never` 工具或风险规则会在人类审批链看到请求之前就拒绝——是锁定旋钮，不是默认。

## 权限与数据

- **权限**：workshop 清单声明 `session:append`、`approval:answer`、`subagent:spawn`、`command:register` 与 `tools:observe`。
- **数据**：不向磁盘写入任何内容；报告环形缓冲在内存中且有界。自身不发起网络请求。
- **会话日志**：`autoReview/*` 事件携带审查器身份、裁决、理由、风险与耗时——以信封 `ignorable: true` 标记追加，任何构建都能加载日志。`Session.append` 早于该标记的宿主（迄今发布的所有 rc 版本，至 `0.1.1-rc.2`——任何发布版都还未盖标记）会在首次追加前被探测出来（peer 版本预检 + 返回信封探测）；宿主 `0.1.2-rc.1`、`0.1.3-alpha.2` 与 `0.1.5-rc.2` 在信封上保留 `ignorable` 字段，但 `Session.append` 没有任何方式为其盖章（其第三参数是仅用于 surface 事件的 `SurfaceIntent`），且持久化读取路径拒绝未标记的未知事件类型，因此这些版本线——以及无法解析的版本——同样在首次追加前 fail closed。审计降级为内存镜像 + 无标记反馈，会话日志始终保持可加载。

## 已知限制

- **两种不同的暴露面，两种不同的解法——彼此不能互相替代。** *注入式*上下文（工作区指令文件、第三方插件注入）会被重新注入到任何新建的 agent 会话中；宿主运行时上下文快照在 pre-step 之后被重新接纳，明确不在防火墙承诺范围内，因此在 `reviewerProvider: fork` 与 `reviewerProvider: spawn` 下抵达审查器的内容完全相同——同一请求下实测逐字节一致。关闭它的是 `agent/pre-step` 来源过滤，且在两种 provider 下都有效；**仅切换到 `spawn` 并不能阻止工作区指令进入审查器。** 另一方面，`fork` 会用委派会话已完成的回合为子会话播种：那段历史已经是子会话自己的日志，而不是进入某一步的消息，因此过滤无法触及，只有 `spawn` 能避免，两者之间由审查器提示词的“不可信记录”围栏作为缓解。在上述两次追踪中，播种并未产生额外消息，因此其实际影响尚未量化。
- 审查器需要可用的 LLM 路由（默认继承）；没有路由时，每次审查都会按 `fallbackPolicy` 回退——绝不会静默放行。
- `reviewerTools` 中的名称必须是 profile 中已存在的全局工具；未知名称会使审查器子代理在最早点大声失败并回退。
- 风险规则按各自的 `field` 匹配请求的 `reason`、`toolName` 或脱敏后的调用 `arguments`；其他条件应放入 `toolsPolicy.overrides`。
- `/auto-review approve` 覆盖授权的是下一次对同一工具的审查，而不是那次确切的历史调用；同一工具上的不同操作也会消耗它。
- 裁决事件是仅日志的；Web 审查面板读取折叠后的 `autoReview` 投影（原始事件流绝不会到达浏览器插件）。
- `autoReview/state` 与 `autoReview/verdict` 在支持标记的宿主上以信封 `ignorable: true` 追加，任何 harness 构建都能加载日志——不认识这些仓库外类型的读取方直接跳过这些记录。已发布的 rc 宿主（rc.1–rc.8）上运行时会检测到标记被丢弃并完全不写这些事件（内存镜像继续提供命令、预算、熔断器与 `approve`）；pre-0.5.1 版本污染的会话可用 `dsh-permission-rules` 的 `scripts/repair-session-logs.mjs` 修复（其默认目标集已覆盖全部五种 `autoReview/*` 事件）。
- git 渠道需要 `dsh` CLI 为 `dsh-auto-review` 打印的 `allowBuilds` 键。仓库自带 `pnpm-workspace.yaml`，为 `esbuild` 以及原生宿主包（`@deepseek-ai/dsh-subprocess-local`、`node-pty`、`koffi`）声明 `allowBuilds`；`typescript` + `tsdown` 在 `devDependencies` 中，git 安装会装它们并运行 `prepare`。
- 可选的 invariant 配套插件需要 `invariants` 服务（agent-spine 组合，如 headless/ACP）；普通 web profile 不提供该服务，所以该行在 bundle 补丁中默认被注释。

## 相关工作

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) —— `tools/pre-execute` 瀑布上的两态允许/拒绝分类器，带文件日志审计。`dsh-auto-review` 刻意不同：官方 **answerer** 链、总是委派不属于自己的部分、带结构化裁决的只读第二模型、拒绝理由反馈给模型、会话日志审计。
- [ACP 自动化桥](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/acp/acp) —— 为其自身 ACP 所有代理做一次性机器决策。`dsh-auto-review` 面向交互式 harness，按会话与工具策略作用域；它从不推断持久授权。

## 与其他 DSH 插件的互操作性

已对照 **DSH `0.2.1-rc.2`**（本 README 面向的运行时）与 2026-10-05 实测的高星插件集验证。

本插件**不干扰**其他插件，包括广泛安装的高星插件：

- **无工具名冲突。** 所有工具都带命名空间，不占用任何已被内置工具或其他插件持有的裸名。
- **无服务键冲突。** 只提供 `autoReviewRuntime`；该键既不是内置 seam，也没有被任何已调研的高星插件提供。
- **无 slot 冲突。** 不注册客户端 slot key，因此不参与 `shadows-shipped-ui` 座位争抢。
- **无 HTTP 路由冲突。** 不注册任何 `webServer` 前缀。
- **无 patch 层冲突。** 组合包 patch 只 `insert` 自己那一行，从不覆写内置行的 `config`。
- **无全局改写。** 不改原型、不改写 `process.env`、不替换全局 fetch dispatcher。

**共享事件监听器在构造上就不互相干扰。** 它用 `ctx.on()` 监听顺序敏感事件 `agent/pre-step`、`approval/request`、`tools/post-execute` —— Cordis 的**广播**语义：每个监听器都会运行，任何一个都无法饿死其他监听器。**此处每个监听器都通过 `next()` 委托**，因此链条绝不会被短路；改写作用在 `next()` 产出的值上，而不是用它顶替返回：

- `agent/pre-step` — also used by `dsh-routing-suite` (7000★, 7 listeners), `modlens` (4122★), `dsh-purge` (3317★), `dsh-agent-teams` (1923★), `dsh-context` (1849★).
- `tools/post-execute` — also used by `cc-safety-net` (1576★).

静态证据：`dsh-plugin-doctor` 的 K10–K13 在本仓全部为 `pass`。

## 兼容性

| 方面 | 状态 |
|---|---|
| 宿主 | DeepSeek Harness `dsh-v0.2.1-rc.2`（2026-10-18 验证）：`engines.dsh >=0.2.1-0 <0.3.0`；P0 兼容路径已有回归测试。 |
| Node | `^22.19.0 \|\| >=24.0.0` |
| 平台 | 全部（宿主 answerer；可选 Web 审查面板，依赖会话投影能力） |
| 模型 | 任意生成式模型（审查器默认继承会话代理的路由；`reviewerModel` 可覆盖），或本机非生成式的 `Phocinae-Largha-150M-v1` 决策模型（`reviewerBackend: phocinae`） |

## 生态与质量

- [Gitee 镜像](https://gitee.com/perrylink/dsh-auto-review)（同步镜像，以 GitHub 为准）
- [dshfind 插件页](https://dshfind.com/plugins/PerryLink/dsh-auto-review)（安装量与排名）
- [OpenSSF Scorecard 报告](https://securityscorecards.dev/viewer/?uri=github.com/PerryLink/dsh-auto-review)（由 [.github/workflows/scorecard.yml](.github/workflows/scorecard.yml) 驱动）
- [dsh-plugin-doctor 验证报告](https://github.com/PerryLink/dsh-plugin-doctor#verified-徽章)（K10–K13 全 `pass`；本仓另有 [.github/workflows/plugin-doctor.yml](.github/workflows/plugin-doctor.yml) 门禁）
- [DSH Market](https://dsh.market/)（已上架）
- **1024 商店渠道**：先 `npm i -g dsh1024`，再 `dsh1024 plugin --profile web add dsh-auto-review`（计入 [deepseek1024.com](https://deepseek1024.com) 安装排行）
- [生态实测知识库](https://perrylink.github.io/dsh-plugin-guide/)：插件开发指南 · 选型实测数据 · 维护取舍判据

## 开发

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc：src + tests，针对本地 harness 检出
pnpm test                   # vitest：30 个 spec 文件
pnpm run build              # tsc 声明 + tsdown 打包（lib/，含客户端包）
pnpm run verify:self-contained
pnpm run check:readmes      # 五语 README 一致性
pnpm pack                   # 发布产物
```

仓库布局：`src/index.ts`（插件契约）· `src/config.ts`（Schemastery schema + 解析）· `src/runtime.ts`（answerer、命令、拒绝理由注入）· `src/review.ts`（审查编排、提示、净化）· `src/phocinae.ts`（可选的本地决策模型审查器）· `src/events.ts`（会话事件词汇 + 折叠）· `src/audit.ts`（宿主 `ignorable` 标记能力探测）· `src/projection.ts` + `src/projection-types.ts`（`autoReview` 会话投影）· `src/invariant.ts`（invariant 配套）· `src/eval/`（dsh-eval 引擎）· `eval/`（随附评估组合）· `bin/dsh-eval.mjs`（CLI 启动器）· `src/client/`（浏览器侧）· `test/` · `fixtures/`。

基准复现：`node bench/phocinae-bench.mjs`（版本化命令集 [`bench/phocinae-commands.json`](bench/phocinae-commands.json)），结果见「实测数据」。配图由 [`scripts/gen-readme-assets.py`](scripts/gen-readme-assets.py) 程序化生成（Python + Pillow），可重复执行。

Topics：`deepseek-harness`、`dsh`、`dsh-plugin`、`cordis`、`approval`、`auto-review`、`second-model`、`ai-safety`、`sandbox`、`subagent`

## 结构化回执

集成方可调用 `ctx.autoReviewRuntime.answerDetailed(request, next)`，导入 `DetailedAnswer` / `ReviewReceipt`，获取请求关联、审查/回退/转交及熔断证据，无需自定义会话事件。`answer()` 和已安装的审批链保持原行为。仅详细接口将内部或下游异常转为 `rejected` / `unavailable`；卸载后最终拒绝，但不承诺立即取消或消除底层迟到副作用。`configuredReviewerBackend` 表示审查后端，不是模型供应商。Host 后注册的 `prepend` 监听器可能先运行；回执不提供独占审批入口。

## 家族与致谢

本项目是 [PerryLink](https://github.com/PerryLink) 维护的 DeepSeek Harness 插件家族成员（95 个，全部 Apache-2.0）。如果这个插件帮到了你，**给个 star**——它不解锁任何功能，但会让下一个人更容易找到它。

- [@PerryLink](https://github.com/PerryLink) —— 创建者与维护者：审批 answerer、审查子代理、风险策略与熔断器、会话投影审查面板、invariant 配套插件、dsh-eval，以及五语文档。
- [@renleihaokun](https://github.com/renleihaokun) —— shell 参数密钥、截断证据、空审查面板（#65）与 0.2.1 激活恢复（#71）；修复随 0.13.4/0.13.5 发布。
- [@daveycodez](https://github.com/daveycodez) —— 隔离的审查器上下文与默认携带转录（#22）。
- [@weipeng1999](https://github.com/weipeng1999) —— 提出审查器独立的 provider/model 路由（[#11](https://github.com/PerryLink/dsh-auto-review/issues/11)、[讨论 #12](https://github.com/PerryLink/dsh-auto-review/discussions/12)），已落地为 `reviewerProvider` / `reviewerModel`。
- [@alexchenzl](https://github.com/alexchenzl) —— 将本插件收录进 DSH 插件目录（[#10](https://github.com/PerryLink/dsh-auto-review/issues/10)）。

<details>
<summary>展开全部插件</summary>

| 插件 | 状态 |
|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | 🧊 已冻结 — 见仓库 README |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** |  |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | 🧊 已冻结 — 见仓库 README |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** |  |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | 🧊 已冻结 — 见仓库 README |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** |  |
| **[dsh-drill-script-check](https://github.com/PerryLink/dsh-drill-script-check)** |  |
| **[dsh-eia-guide-check](https://github.com/PerryLink/dsh-eia-guide-check)** |  |
| **[dsh-emergency-plan](https://github.com/PerryLink/dsh-emergency-plan)** |  |
| **[dsh-essay-rubric-check](https://github.com/PerryLink/dsh-essay-rubric-check)** |  |
| **[dsh-evidence-check](https://github.com/PerryLink/dsh-evidence-check)** |  |
| **[dsh-export-ctl-check](https://github.com/PerryLink/dsh-export-ctl-check)** |  |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** |  |
| **[dsh-fmea-table-check](https://github.com/PerryLink/dsh-fmea-table-check)** |  |
| **[dsh-forecast-penalty](https://github.com/PerryLink/dsh-forecast-penalty)** |  |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** |  |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** |  |
| **[dsh-gongwen-flow-check](https://github.com/PerryLink/dsh-gongwen-flow-check)** |  |
| **[dsh-gongwen-word-check](https://github.com/PerryLink/dsh-gongwen-word-check)** |  |
| **[dsh-guard-plan-qc](https://github.com/PerryLink/dsh-guard-plan-qc)** |  |
| **[dsh-hazchem-check](https://github.com/PerryLink/dsh-hazchem-check)** |  |
| **[dsh-hazplan-check](https://github.com/PerryLink/dsh-hazplan-check)** |  |
| **[dsh-hidden-risk-map](https://github.com/PerryLink/dsh-hidden-risk-map)** |  |
| **[dsh-hs-classify](https://github.com/PerryLink/dsh-hs-classify)** |  |
| **[dsh-icd-rule-check](https://github.com/PerryLink/dsh-icd-rule-check)** |  |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** |  |
| **[dsh-lawcite-adapter](https://github.com/PerryLink/dsh-lawcite-adapter)** |  |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** |  |
| **[dsh-lc-doc-check](https://github.com/PerryLink/dsh-lc-doc-check)** |  |
| **[dsh-learning-gap-check](https://github.com/PerryLink/dsh-learning-gap-check)** |  |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** |  |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** |  |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** |  |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** |  |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** |  |
| **[dsh-medrec-qc](https://github.com/PerryLink/dsh-medrec-qc)** |  |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | 🧊 已冻结 — 见仓库 README |
| **[dsh-nsfc-form-check](https://github.com/PerryLink/dsh-nsfc-form-check)** |  |
| **[dsh-nurse-record-check](https://github.com/PerryLink/dsh-nurse-record-check)** |  |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** |  |
| **[dsh-origin-rvc-check](https://github.com/PerryLink/dsh-origin-rvc-check)** |  |
| **[dsh-ota-review-check](https://github.com/PerryLink/dsh-ota-review-check)** |  |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** |  |
| **[dsh-paper-doc-adapter](https://github.com/PerryLink/dsh-paper-doc-adapter)** |  |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** |  |
| **[dsh-permit-report-check](https://github.com/PerryLink/dsh-permit-report-check)** |  |
| **[dsh-pipeline-check](https://github.com/PerryLink/dsh-pipeline-check)** |  |
| **[dsh-pleading-draft](https://github.com/PerryLink/dsh-pleading-draft)** |  |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | 🚫 已退役（仓库已归档） |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** |  |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | 🚫 已退役（仓库已归档） |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | 🚫 已退役（仓库已归档） |
| **[dsh-policy-brief-draft](https://github.com/PerryLink/dsh-policy-brief-draft)** |  |
| **[dsh-power-loss-split](https://github.com/PerryLink/dsh-power-loss-split)** |  |
| **[dsh-power-ticket-check](https://github.com/PerryLink/dsh-power-ticket-check)** |  |
| **[dsh-ppap-check](https://github.com/PerryLink/dsh-ppap-check)** |  |
| **[dsh-protest-deadline](https://github.com/PerryLink/dsh-protest-deadline)** |  |
| **[dsh-railway-window](https://github.com/PerryLink/dsh-railway-window)** |  |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | 🧊 已冻结 — 见仓库 README |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** |  |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | 🚫 已退役（仓库已归档） |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | 🧊 已冻结 — 见仓库 README |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | 🧊 已冻结 — 见仓库 README |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | 🧊 已冻结 — 见仓库 README |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | 🧊 已冻结 — 见仓库 README |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | 🧊 已冻结 — 见仓库 README |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | 🚫 已退役（仓库已归档） |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | 🚫 已退役（仓库已归档） |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | 🚫 已退役（仓库已归档） |

</details>

## License

[LICENSE](LICENSE)（Apache License 2.0）© 2026 dsh-auto-review contributors

<p align="center"><sub>Apache-2.0 · 社区插件，与 DeepSeek 无关。</sub></p>

<p align="center"><sub>工具链：<a href="https://github.com/PerryLink/dsh-plugin-guide">dsh-plugin-guide</a> · <a href="https://github.com/PerryLink/dsh-standards">dsh-standards</a> · <a href="https://github.com/PerryLink/dsh-plugin-start">dsh-plugin-start</a></sub></p>
