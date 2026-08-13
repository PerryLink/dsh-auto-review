# dsh-auto-review

DeepSeek Harness 审批请求的**第二模型 AI 自动审批**插件 —— 以纯 cordis 插件实现 Codex `approvals_reviewer=auto_review` / Claude Code "auto mode" 模式。

当 agent 的动作越过权限边界（沙箱升级、需要审批的工具）时，`dsh-auto-review` 作为 `approval/request` waterfall 上的一个 **answerer**，启动一次性的**审查子代理**：一个只读的子模型，返回结构化的 allow/deny 裁决与理由。插件不接管的请求一律经 `next()` 委托给人类 answerer 链 —— 人类审批流程绝不被短路。每条裁决都能从会话日志完整重建：`approval/asked` → `autoReview/verdict` → `approval/decided`。

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
          │ 审查子代理（fork，一次性）           │
          │  · toolFilter：仅 read/glob/grep    │
          │  · outputSchema：{decision, reason, │
          │    riskLevel}（structured_output）  │
          │  · 超时 + req.signal 中止           │
          └───────────────┬───────────────────┘
                          │ 裁决 / 失败（fail-closed 回退）
                          ▼
   allow → allowed-once        deny → rejected，理由经 callId
                                       注入被拒工具结果回喂模型
                          │
                          ▼
   审计：approval/asked → autoReview/verdict → approval/decided
         （会话事件，log-only，运行时不变式校验）
```

## 为什么用第二个模型而不是规则

基于规则的自动审批在派发前就做出二态判定，没有证据。审查子代理通过其只读工具面读取真实工作区、已流式呈现的工具调用参数（敏感值已脱敏）、请求方 reason 与配置的风险规则，再做裁决。deny 裁决把**理由回喂调用模型**（注入被拒工具的结果），agent 能学到原因而不是盲目重试。

## 行为契约

- **只接管自己该接管的请求。** 仅当同时满足：会话启用了 auto-review、该工具/风险的解析策略为 `ai`、本回合预算（`maxReviewsPerTurn`）未耗尽时，才接管请求；其余一律 `next()`。
- **人类流程不被短路。** 未列出的工具默认 `human`（委托）；`human` 意味着请求继续沿链交给人类 answerer。只有 `never` 短路 —— 作为确定性拒绝，且仅用于管理员硬禁用的工具。
- **fail closed。** 审查代理崩溃、subagent 服务不可用、超时、结构化裁决缺失或不合 schema，都不会放行：按 `fallbackPolicy` 回退，默认 `rejected`。`delegate` 交给下游 answerer；`allow-readonly` 放行（危险，见安全边界）。
- **防递归。** 审查子代理自身的审批请求按会话身份识别并直接委托；审查代理以 `maxDepth: 0` + 只读工具白名单运行，不能升级、改写或再委派。
- **绝不绕过 `never` 审批策略。** 该策略由核心服务在派发前强制，本插件无法也不尝试绕过。
- **可审计。** 服务自动记录 `approval/asked` + `approval/decided`；插件追加 `autoReview/verdict`（审查代理身份、裁决、理由、风险等级、耗时、回退类型）——log-only，不进模型上下文。唯一模型可见的内容（注入的拒绝理由）内嵌 `reviewId` 标记，invariant 伴生插件在每条会话日志上校验"标记 ⟺ 裁决"的对应关系。

## 安装

三种通道；本插件是 **bundle** 形态（`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`）。

```sh
# 1. npm tarball（构建产物，无需构建许可）
pnpm pack                       # 在本仓库内 → dsh-auto-review-0.1.0.tgz
dsh plugin --profile web add ./dsh-auto-review-0.1.0.tgz
dsh --profile web               # 重启生效

# 2. git 源（钉住 commit；自包含 prepare 负责构建）
#    pnpm ≥ 10 默认阻止 git 依赖的生命周期构建：先按提示把 allowBuilds
#    键加入 profile 的 pnpm-workspace.yaml。
dsh plugin --profile web add "github:<owner>/dsh-auto-review#<commit>"

# 3. 本地 link（开发调试）
dsh plugin --profile web add link:/path/to/dsh-auto-review
```

验证组合结果与加载状态：

```sh
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

随包 patch 挂载 `auto-review` 行，附开箱演示策略：`bash`、`write`、`edit` 走 AI 裁决，其余工具委托人类链。**invariant 伴生**（`dsh-auto-review/invariant`）随包发布但以注释形式存在：它等待 `invariants` 服务，该服务由 agent-spine 组合（headless/ACP 应用）提供、普通 web profile 不提供——只在挂载了该服务的组合中，把该行取消注释加入你的 profile patch 层。

## 配置

所有可调参数都是 Schemastery `Config` 字段（cordis.yml 可改）。按 `id` 定向覆盖时**整行 config 被替换**——需要保留的键必须全部重述。

| 键 | 默认 | 含义 |
|---|---|---|
| `enableByDefault` | `true` | 会话初始是否启用 auto-review；`/auto-review on\|off` 写入的 durable 会话级覆盖优先于此默认值 |
| `toolsPolicy.default` | `human` | 未列入 `overrides` 的工具的策略（委托人类 answerer） |
| `toolsPolicy.overrides` | `{}` | 每工具策略：`ai`（AI 裁决）、`human`（强制人类）、`never`（确定性拒绝） |
| `riskRules` | `[]` | `{pattern, policy}` 列表，按顺序对请求 reason 匹配（首个命中生效），**先于**工具表——安全规则压过工具默认 |
| `reviewerProvider` | `fork` | 审查代理的 subagent provider（进程内 fork 后端） |
| `reviewerModel` | *(继承)* | 审查模型 id；不设则继承会话 agent 的模型路由 |
| `reviewerTimeoutMs` | `60000` | 裁决截止时间；超时走回退策略 |
| `reviewerTools` | `[read, glob, grep]` | 审查子代理的工具白名单——其余工具在子代理中不可见、不可执行 |
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

### 会话级命令

```
/auto-review on|off|status
```

`on`/`off` 追加 durable 的 `autoReview/state` 覆盖事件（fold 跨重启/恢复生效——重放即状态），并注入模型可见的切换通知（记录为 `user/message` 事件，模型可见 ⟺ 已记录）。`status` 显示当前生效状态与本回合裁决预算。

## 安全边界

- 审查代理运行在**只读工具面**（`toolFilter` 白名单）内：不能写文件、改文件、执行 bash、访问网络、再委派（`maxDepth: 0`）。其会话日志与普通会话一样落盘可审计。
- **敏感参数先脱敏**（按键名匹配：`token`、`password`、`api_key`、`Authorization`、凭据、私钥等）再进入审查 prompt；插件绝不执行被审参数内容。脱敏是键名级而非内容级——藏在任意字符串值里的密钥仍会进入审查 prompt。凡参数内容无法接受展示给模型的工具，不要纳入 AI 审查。
- **默认 fail closed。** 所有异常路径（provider 缺失、启动被拒、超时、非 `completed` 停止原因、结构化裁决缺失/不合规、审计关联失败）都走 `fallbackPolicy`，默认 `rejected`。`allow-readonly` 是无条件放行——并非任何强制意义上的"只读"，仅供接受该风险的无人值守部署使用。
- **`never` 在本层是单向的。** `never` 工具或风险规则在人类链看到请求之前即拒绝。它是针对"需要审批时一律硬禁用"的工具的锁定旋钮，不是默认值。
- **审查代理也是模型。** 其裁决是建议性策略，不是安全内核。不可逆操作请配 `human`/`never` 规则；审查模型较弱时不要使用 `allow-readonly`。

## 已知局限

- 审查代理需要可用的 LLM 路由（默认继承会话 agent 的 provider/model）。没有路由时每次审查按 `fallbackPolicy` 回退——除非显式配置，否则请求绝不会被静默放行。
- `reviewerTools` 中的名字必须是 profile 中真实存在的全局工具；未知名字会让 `tools.restrict()` 在子代理创建时响亮失败（审查在最早点失败并回退）。
- 风险规则只匹配请求 `reason`；按工具名区分请用 `toolsPolicy.overrides`。
- 裁决事件是 log-only；Web UI 审计面板按会话事件原样渲染，因此裁决行会出现在面板中（无专属面板）。
- 把 `typescript` + `tsdown` 放在 `dependencies`（而非 devDependencies）是有意为之：pnpm 不会安装 git 依赖的 devDependencies，而 git 通道的 `prepare` 必须仅凭生产依赖完成构建。

## 演示

`docs/demo-auto-review.gif` 是一次真实证据链（真实服务器、真实 API key、两轮真实模型）：只读会话请求越界升级写工作区文件——AI 审查代理**放行**（risk low，5.2s，人类零操作）；随后对工作区外目录的递归删除 + 全权限升级被**拒绝**（risk high，8.9s），拒绝理由直接出现在转录中。重放脚本：`demo/capture-demo.mjs` + `demo/cordis.patch.yml`。

## 开发

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc，src + 测试
pnpm test                   # vitest：61 个测试、6 个套件
pnpm run build              # tsc 声明 + tsdown 打包（lib/）
pnpm run verify:self-contained
pnpm pack                   # 发布产物
```

仓库结构（plugin-template 结构）：`src/index.ts`（插件契约）、`src/config.ts`（Schemastery schema + 解析）、`src/runtime.ts`（answerer、命令、拒绝理由注入）、`src/review.ts`（审查子代理编排、prompt、脱敏）、`src/events.ts`（会话事件词汇 + fold）、`src/invariant.ts`（invariant 伴生，以 `dsh-auto-review/invariant` 挂载）、`test/`、`fixtures/`（可重放的会话日志与配置示例）。

## 相关项目

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) 在 `tools/pre-execute` waterfall 上实现 allow/deny 二态分类器，审计走自有文件日志；`dsh-auto-review` 刻意差异化：挂在官方 `approval/request` **answerer** 链上，不拥有的请求一律委托，用只读第二模型产出结构化裁决，把拒绝理由回喂模型，且每条裁决均可从会话日志重建。
- [ACP automation bridge](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/acp/acp) 为其自有的 ACP agent 提供一次性机器决策。`dsh-auto-review` 面向交互式 harness 的会话与工具策略作用域，不涉及 ACP 协议，也绝不推断持久授权。

## License

MIT
