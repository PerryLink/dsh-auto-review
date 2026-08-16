<!-- language links -->
[English](README.md) · [中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

<div align="center">

# 🤖 dsh-auto-review

**Second-model AI approval for DeepSeek Harness** — the Codex `approvals_reviewer=auto_review` / Claude Code *auto mode* pattern, built as a pure Cordis plugin.

When an agent's action crosses the sandbox boundary, a **read-only reviewer subagent** decides allow/deny — with a reason — so humans approve nothing while nothing unsafe slips through.

[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-4c51bf.svg)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![npm version](https://img.shields.io/npm/v/dsh-auto-review)](https://www.npmjs.com/package/dsh-auto-review)
[![npm downloads](https://img.shields.io/npm/dm/dsh-auto-review)](https://www.npmjs.com/package/dsh-auto-review)
[![tests](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-auto-review/ci.yml?label=tests&logo=githubactions)](.github/workflows/ci.yml)
[![typescript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](src)
[![type](https://img.shields.io/badge/type-cordis%20bundle-8a5cf6.svg)](cordis.patch.yml)
[![repo](https://img.shields.io/badge/repo-PerryLink%2Fdsh--auto--review-181717.svg)](https://github.com/PerryLink/dsh-auto-review)

**Zero human operations.** The request goes to the AI reviewer, the verdict is allow/deny + reason + risk level, and every decision is reconstructable from the session log: `approval/asked` → `autoReview/verdict` (or `autoReview/rejection` for hard disables) → `approval/decided`.

<img src="docs/demo-auto-review.gif" alt="dsh-auto-review demo" width="720"/>

*One real evidence run (real server, real API key, two real model rounds): the AI reviewer **allows** an escalated workspace write (risk low, 5.2 s), then **denies** a recursive out-of-workspace delete (risk high, 8.9 s) — the deny reason is fed back to the model, visible in the transcript.*

</div>

## Why a second model instead of rules?

Pattern-based auto-approvers decide before dispatch, with no evidence. `dsh-auto-review` gives the decision to a **reviewer subagent** that reads the actual workspace (through its read-only tool face), the already-streamed tool-call arguments (sensitive values redacted), the request reason, and your risk rules — then returns a structured verdict. A deny verdict feeds its **reason back to the calling model**, so the agent learns why instead of retrying blindly.

## ✨ Features

| | |
|---|---|
| 🔌 **Official seam** | An answerer on the `approval/request` waterfall. Requests it does not own are delegated via `next()` — the human approval flow is never short-circuited. |
| 🧠 **Second-model verdict** | One-shot fork subagent with a read-only tool allow-list (`read`/`glob`/`grep`) and a structured verdict schema `{ decision, reason, riskLevel }`. |
| 🛡️ **Fail closed** | Reviewer crash, timeout, or schema mismatch never opens the gate: `fallbackPolicy` applies, default `rejected`. |
| 🧩 **Config-driven routing** | Per-tool policies (`ai`/`human`/`never`) + regex risk rules, all changeable from cordis.yml. |
| 💬 **Deny reasons reach the model** | The reviewer's reason is injected into the denied tool result (callId-linked), so the agent adapts. Fail-closed fallback rejections and `never`-policy hard disables inject auditable failure texts too (`[auto-review]` / `[auto-review-fallback]` / `[auto-review-never]` markers). |
| 📜 **Full audit trail** | `autoReview/verdict` + `autoReview/rejection` session events (reviewer identity, verdict, reason, risk, duration) + an invariant companion enforcing *model-visible ⟺ logged*. |
| 🔁 **No recursion** | Reviewer asks are recognized by identity and delegated; `maxDepth` + the tool allow-list keep the reviewer non-delegating. |
| 🧯 **Rejection circuit breaker** | 3 consecutive denials (or 6 within the last 10 verdicts) in one turn trip the breaker: later requests delegate, reject, or abort the turn — no endless denial loops. |
| 🎚️ **Risk-level policy** | An `allow` verdict whose risk exceeds `riskPolicy.maxAutoAllow` never settles the request: it delegates to a human or denies. |
| ✋ **One-shot human override** | `/auto-review approve [n]` authorizes ONE retry of a recent denial; the next same-tool review carries that authorization as reviewer context (the reviewer still decides). |
| 📜 **Reviewer context** | Optional compact transcript (recent messages and tool results, bounded) + a Codex-style Markdown `reviewerPolicyText` ruling policy. |
| ⌨️ **Session command** | `/auto-review on|off|status|approve [n]` with a durable per-session override that survives restore and cumulative session statistics. |
| 🖥️ **Web review panel** | A session-header panel (Web GUI) shows the switch (with on/off buttons), both per-turn budgets, cumulative statistics, the circuit trip, recent verdicts, and one-shot approve buttons — driven by the `autoReview` session projection. |

## How it works

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

**Composition order.** The answerer runs at its registration position in the waterfall: if a human UI answerer is composed BEFORE the `auto-review` row, humans answer first and the reviewer only sees what is delegated downstream. Verify with `dsh --profile <name> --dump-config` and place the `auto-review` row before your human answerer rows when you want ai-policy tools routed to the reviewer first.

## 🚀 Quick start

Three install channels; the plugin is a **bundle** (`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`).

```sh
# 1. npm (published artifact, no build step)
dsh plugin --profile web add dsh-auto-review
dsh --profile web               # restart

# 2. npm tarball (built artifacts, offline install)
pnpm pack                       # → dsh-auto-review-<version>.tgz
dsh plugin --profile web add ./dsh-auto-review-<version>.tgz
dsh --profile web               # restart

# 3. git source (pin the commit; self-contained `prepare` builds it)
#    pnpm ≥ 10 blocks lifecycle builds: add the printed allowBuilds key
#    to the profile's pnpm-workspace.yaml first.
dsh plugin --profile web add "github:PerryLink/dsh-auto-review#<commit>"

# 4. local link (development)
dsh plugin --profile web add link:/path/to/dsh-auto-review
```

Verify:

```sh
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

Out of the box the shipped patch AI-reviews `bash` and `write`; every other tool (including `edit` — in-place modification) delegates to the human chain. Add `edit: ai` explicitly if you accept in-place edits without a human in the loop.

## ⚙️ Configuration

All tunables are Schemastery `Config` fields (changeable from cordis.yml). An id-targeted override **replaces the whole config row** — restate every key you need.

| Key | Default | Meaning |
|---|---|---|
| `enableByDefault` | `true` | Sessions start with auto-review enabled; `/auto-review on\|off` writes a durable override that beats this |
| `toolsPolicy.default` | `human` | Policy for unlisted tools (delegate to the human answerer) |
| `toolsPolicy.overrides` | `{}` | Per-tool policy: `ai` (reviewer decides), `human` (force human), `never` (deterministic reject) |
| `riskRules` | `[]` | `{pattern, policy, field?}` matched (first match wins) before the tool table; `field` selects `reason` (default), `toolName`, or `arguments` (the redacted presented call arguments) |
| `reviewerProvider` | `fork` | Subagent provider for the reviewer (in-process fork backend) |
| `reviewerModel` | *(inherit)* | Reviewer model id; unset inherits the session agent's route |
| `reviewerTimeoutMs` | `60000` | Verdict deadline; on expiry the fallback policy applies |
| `reviewerTools` | `[read, glob, grep]` | The reviewer child's tool allow-list (must be non-empty) — everything else is invisible there |
| `fallbackPolicy` | `rejected` | Reviewer failure: `rejected` (fail closed), `delegate` (continue the chain), `allow-once` (grant — see Security). Renamed from `allow-readonly` in 0.2.0; the old spelling fails loudly |
| `maxReviewsPerTurn` | `10` | Real AI-verdict budget per open turn; beyond it, requests delegate to humans |
| `maxFailuresPerTurn` | `10` | Reviewer-failure budget per open turn (timeout/unavailable/schema, not cancellations); beyond it, requests delegate instead of paying another full timeout. Defaults to `maxReviewsPerTurn` |
| `reasonMaxChars` | `2000` | Cap for reviewer reasons, the request reason, and the redacted argument preview |
| `reviewerGuidance` | *(none)* | Optional advisory guidance appended to the reviewer prompt |
| `reviewerPolicyText` | *(none)* | Markdown ruling policy injected into the reviewer prompt (Codex-style; template at `fixtures/config/policy-template.md`) |
| `denyGuidance` | *(anti-circumvention text)* | Guidance appended to every injected deny reason |
| `contextBudget` | `{turns: 0, maxChars: 4000}` | Compact transcript budget for the reviewer prompt; `turns: 0` disables |
| `riskPolicy` | `{maxAutoAllow: high, onHighRisk: delegate}` | `allow` verdicts above `maxAutoAllow` delegate (`delegate`) or deny (`deny`) |
| `circuitBreaker` | `{consecutiveDenies: 3, windowDenies: 6, windowSize: 10, action: delegate}` | Rejection circuit breaker; trips on 3 consecutive denies or 6 of the last 10 verdicts in a turn; `action`: `delegate` / `reject` / `abort-turn` |
| `overrideTtlMs` | `300000` | How long a `/auto-review approve` override stays usable |
| `language` | `en` | UI language of the `/auto-review` command output (`en` \| `zh`) |

Example (annotated full form: `fixtures/config/config-full.yaml`):

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

## ⌨️ Session command

```
/auto-review on|off|status|approve [n]
```

`on`/`off` append the durable `autoReview/state` override (the fold survives restart/resume — replay IS the state) and inject a switch notice the model sees (logged as a `user/message` event). `status` reports the effective state, both per-turn budgets (AI verdicts and reviewer failures), a tripped circuit breaker when one is active, and the session's cumulative statistics (allows/denies/fallbacks/never rejects, mean duration, recent verdicts). `approve [n]` records a single-use `autoReview/override` for the n-th most recent denial (1 = most recent): the next same-tool review within `overrideTtlMs` carries the authorization as reviewer context — the reviewer still decides, and the override is consumed by that review regardless of its outcome.

## 🖥️ Web review panel

In the Web GUI (web profile), the package contributes a session-header action (**AI Review**) that opens a panel with the session's auto-review state: the switch with on/off buttons (they execute `/auto-review on|off`), both per-turn budgets, cumulative statistics (including hard-disable rejections), the circuit trip, the recent verdicts, and one-shot **approve** buttons for recent denials (they execute `/auto-review approve [n]`).

How it is wired:

- The host registers an `autoReview` **session projection** (folded from the log-only `autoReview/*` events) and serves it through the session-projection channel.
- The browser half is a **client module** (auto-discovered from the `dsh.client` declaration) registered on the `conversation.session.header.actions` seat.
- No extra patch rows are needed: the panel loads whenever the plugin is installed in a profile whose web build provides the session-projection capability (the web profile does). Without that capability the panel reports itself unavailable; the answerer is unaffected.

The panel reads only whole projection values — it never receives the raw session event stream.

## 🧪 dsh-eval — agent evaluation engine

Beyond the approval reviewer, `dsh-auto-review` ships `dsh-eval`: a YAML-driven agent evaluation platform that runs real headless DSH sessions (one isolated agent + scratch workspace per case, the official Minimal persona as the baseline system prompt), collects the tool-call trace from the session event log, and evaluates structured assertions plus an optional second-model review — the same reviewer seam as the approval answerer.

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
    - id: review-write
      input: Read src/config.ts, write the default reviewerTimeoutMs into scratch/answer.txt…
      expect:
        output: { contains: "60000" }
      review:
        statement: The agent read the default reviewerTimeoutMs and wrote it to the file.
```

Run it (a DeepSeek API key must be in the environment):

```sh
dsh-eval eval/cases --model deepseek-v4-flash --timeout-ms 240000 --out .eval-reports
```

CI gate: the process exits 0 only when every case of every suite passed — drop it into a GitHub Action step and failing evaluations fail the build. Each case leaves a replayable session JSONL and a trace JSON beside `report.md`/`report.json`; assertion results, token usage, and the review verdict are all written into the report files. The engine never substitutes hardcoded model or timeout defaults, aborts cleanly on SIGINT/SIGTERM, and caps the worker pool at the configured concurrency.

Unlike [codex-research](https://github.com/openai/codex/tree/main/codex-rs/research) (browser-automation agent research), `dsh-eval` targets harness-level agent evaluation: tool-call-trace assertions against the session event log, second-model review as a supplementary assertion layer, and per-case isolated headless sessions — no browser or Selenium stack.

## 🔒 Security

- The reviewer runs in a **read-only tool face** (`toolFilter` allow-list). It cannot write, edit, run bash, fetch the network, or delegate (`maxDepth` = its own depth). Its session log is persisted and auditable.
- **Sensitive arguments are redacted** (key-name matching: `token`, `password`, `api_key`, `Authorization`, credentials, private keys …) before entering the reviewer prompt; the plugin never executes the reviewed arguments. Redaction is key-based, not content-based — do not AI-review tools whose argument values you cannot afford to show a model.
- **Fail closed by default.** Every abnormal path (provider missing, capability gaps, start rejection, timeout, non-`completed` stop reason, missing/malformed verdict, audit-correlation failure) resolves through `fallbackPolicy`, default `rejected` — and the rejection feeds an auditable reason back to the model instead of the generic "user rejected" text. `allow-once` grants unconditionally — it exists only for unattended deployments whose admin accepts that risk.
- **Hard disables explain themselves.** A `never` tool or risk rule rejects deterministically AND records a log-only `autoReview/rejection` event with the matched rule/table entry, then injects a `[auto-review-never]` marker text into the denied tool result — the model learns the action is hard-disabled instead of retrying it (invariant-checked: marker ⟺ event).
- **Rejection circuit breaker.** A run of denials in one turn trips the breaker (`consecutiveDenies` / `windowDenies` inside `windowSize`), recorded as a log-only `autoReview/circuit` event; later requests follow its `action` (`delegate` / `reject` / `abort-turn`). `abort-turn` injects a model-visible warning and cancels the agent.
- **Reviewer context is presented transcript.** `contextBudget` feeds already-presented session content (messages, tool results) to the reviewer. With the default same-route reviewer model that content stays inside one provider; configure `reviewerModel` to a different provider only if you accept presenting that transcript to it.
- **`never` is one-way at this layer.** A `never` tool or risk rule rejects before the human chain sees the request — a lockdown knob, not a default.
- **The reviewer is a model.** Its verdicts are advisory policy, not a security kernel. Prefer `human`/`never` rules for irreversible operations.

## ⚠️ Known limitations

- The reviewer needs a working LLM route (inherited from the session agent by default); without one every review falls back per `fallbackPolicy` — never a silent grant.
- `reviewerTools` names must exist as global tools in the profile; an unknown name fails the reviewer child loudly at the earliest point and falls back.
- Risk rules match the request `reason`, the `toolName`, or the redacted call `arguments` per their `field`; other conditions belong in `toolsPolicy.overrides`.
- The `/auto-review approve` override authorizes the next same-tool review, not the exact historical call; a different action on the same tool consumes it.
- The verdict events are log-only; the dedicated Web review panel reads the folded `autoReview` projection (the raw event stream never reaches browser plugins).
- `autoReview/state` and `autoReview/verdict` are appended with the envelope's `ignorable: true` marker, so any harness build loads the log — readers that do not know the out-of-repo types simply skip those records instead of refusing the session. (rc.6 hosts accept and ignore the marker, keeping the exact pre-marker behavior; sessions written by pre-0.1.1 versions can be repaired with `scripts/repair-session-logs.mjs` from `dsh-permission-rules`.)
- The git channel needs the single `allowBuilds` key the `dsh` CLI prints for `dsh-auto-review` itself. The repo ships its own `pnpm-workspace.yaml` with `allowBuilds: { esbuild: true }` so the isolated prepare environment does not fail on esbuild's (harmless platform-binary validation) postinstall; `typescript` + `tsdown` are regular `dependencies` so that environment always has the build tools.
- The optional invariant companion (`dsh-auto-review/invariant`) needs the `invariants` service (agent-spine compositions such as headless/ACP); the plain web profile does not provide it, so the row ships commented out in the bundle patch.

## 🏷️ GitHub topics

Recommended when you publish: `dsh` · `dsh-plugin` · `deepseek-harness` · `deepseek` · `cordis` · `ai-safety` · `approval` · `sandbox` · `subagent` · `llm`

## 🔗 Related work

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — two-state allow/deny classifier on the `tools/pre-execute` waterfall with file-log audit. `dsh-auto-review` deliberately differs: official **answerer** chain, always delegates what it does not own, read-only second model with a structured verdict, deny reasons fed back to the model, session-log audit.
- [ACP automation bridge](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/acp/acp) — one-shot machine decisions for its own ACP-owned agents. `dsh-auto-review` is session- and tool-policy-scoped for the interactive harness; it never infers durable grants.

## 🧑‍💻 Development

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc, src + tests
pnpm test                   # vitest: 190 tests, 14 files
pnpm run build              # tsc declarations + tsdown bundles (lib/, incl. the client bundle)
pnpm run verify:self-contained
pnpm pack                   # publish artifact
```

Repository layout (plugin-template structure): `src/index.ts` (plugin contract) · `src/config.ts` (Schemastery schema + resolution) · `src/runtime.ts` (answerer, command, deny-reason injection) · `src/review.ts` (reviewer orchestration, prompt, sanitization) · `src/events.ts` (session-event vocabulary + folds) · `src/projection.ts` + `src/projection-types.ts` (the `autoReview` session projection) · `src/invariant.ts` (invariant companion) · `src/eval/` (the dsh-eval engine: DSL, runner, assertions, trace, review, reports, CLI) · `eval/` (shipped evaluation composition + demo suite) · `bin/dsh-eval.mjs` (CLI launcher) · `src/client/` (browser half: review panel, locales, styles) · `test/` · `fixtures/`.

## 👥 Contributors

Thanks to everyone who has contributed to `dsh-auto-review`:

- [PerryLink](https://github.com/PerryLink) — author and maintainer: approval answerer, reviewer subagent, risk policy and circuit breaker, session-projection review panel, invariant companion, docs, CI/CD and releases.

Want to help? Check the [issue templates](.github/ISSUE_TEMPLATE/), the [security policy](SECURITY.md), and [AGENTS.md](AGENTS.md) for repo conventions — PRs are welcome in English or Chinese.

## PerryLink DSH Plugin Family

This project is one of the [15 DeepSeek Harness plugins](https://github.com/PerryLink) maintained by [PerryLink](https://github.com/PerryLink). If this one helps you, the others likely will too:

| Plugin | One-liner |
|---|---|
| [dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel) | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors |
| [dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck) | Engineering-discipline guard: requirements grill, test gates, adversary review |
| [dsh-background-agents](https://github.com/PerryLink/dsh-background-agents) | Durable background child agents with a Web UI sidebar, messaging and interrupt |
| [dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions) | LSP diagnostics, formatting, completion, code actions and rename over language servers |
| [dsh-output-styles](https://github.com/PerryLink/dsh-output-styles) | Claude Code outputStyles-equivalent runtime style switching |
| [dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind) | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |
| [dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules) | Claude Code-style declarative allow/deny/ask permission rules with audit |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default |
| [dsh-memento](https://github.com/PerryLink/dsh-memento) | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool |
| [dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security) | Security-audit skill pack: secret scan, dependency and supply-chain review |
| [dsh-session-pin](https://github.com/PerryLink/dsh-session-pin) | Pin sessions in the Web sidebar with durable ordering |
| [dsh-composer-history](https://github.com/PerryLink/dsh-composer-history) | Terminal-style input history for the web composer: arrows, Ctrl+R search |
| [dsh-github](https://github.com/PerryLink/dsh-github) | GitHub PR/issues integration for DSH, every write gated by approval |
| [dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide) | Plugin-development knowledge base as an on-demand agent skill |
| [dsh-claude-move](https://github.com/PerryLink/dsh-claude-move) | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH |

## 📄 License

[Apache License 2.0](LICENSE)
