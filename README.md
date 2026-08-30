<div align="center">

# 🤖 dsh-auto-review
[![Gitee](https://img.shields.io/badge/Gitee-mirror-c71d23?logo=gitee)](https://gitee.com/perrylink/dsh-auto-review)

**Second-model AI approval for DeepSeek Harness — a read-only reviewer subagent decides allow/deny on the approval chain, fail-closed by default.**

*When an action crosses the sandbox boundary, a second model reads the evidence and returns a verdict with a reason — so humans approve nothing while nothing unsafe slips through.*

> **Official repository.** This is the only official repository of dsh-auto-review, maintained by PerryLink. Same-name repositories under other accounts are not affiliated.

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

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.1.1-rc.2` (dependencies pinned to `0.1.1-rc.2`; peers `>=0.1.0-rc.8 <0.2.0`) |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Platforms | All (host answerer; optional Web review panel via the session-projection capability) |
| Model | Any (the reviewer inherits the session agent's route; `reviewerModel` overrides) |

## What you get

`dsh-auto-review` puts a second model on the `approval/request` answerer chain:

1. **Official seam** — an answerer that claims only the requests it owns (`ai` policy) and delegates everything else via `next()`; the human approval flow is never short-circuited.
2. **Read-only reviewer subagent** — a one-shot fork with a `read`/`glob`/`grep` tool allow-list returns a structured verdict `{ decision, reason, riskLevel }`. Reviewer asks are recognized by identity and delegated; `maxDepth` + the allow-list keep the reviewer non-delegating.
3. **Fail closed** — reviewer crash, timeout, or schema mismatch resolves through `fallbackPolicy` (default `rejected`); a deny verdict feeds its reason back to the calling model.
4. **Config-driven routing** — per-tool policies (`ai`/`human`/`never`) plus regex risk rules, all changeable from cordis.yml.
5. **Deny reasons reach the model** — the reviewer's reason is injected into the denied tool result (callId-linked); fallback and `never`-policy rejections inject auditable markers too (`[auto-review]` / `[auto-review-fallback]` / `[auto-review-never]`).
6. **Full audit trail** — log-only `autoReview/verdict` + `autoReview/rejection` session events (envelope `ignorable: true`) plus an optional invariant companion enforcing marker ⟺ event.
7. **Safety knobs** — a rejection circuit breaker (3 consecutive denials, or 6 of the last 10 verdicts, per turn), a risk-level policy, a one-shot `/auto-review approve` override, and a `never`-policy hard disable that explains itself to the model.
8. **Optional reviewer context** — a bounded compact transcript (`contextBudget`) plus a Codex-style Markdown ruling policy (`reviewerPolicyText`).

Every decision reconstructs from the session log: `approval/asked` → `autoReview/verdict` (or `autoReview/rejection`) → `approval/decided`.

## Why a second model instead of rules?

Pattern-based auto-approvers decide before dispatch, with no evidence. `dsh-auto-review` gives the decision to a **reviewer subagent** that reads the actual workspace (through its read-only tool face), the already-streamed tool-call arguments (sensitive values redacted), the request reason, and your risk rules — then returns a structured verdict. A deny verdict feeds its **reason back to the calling model**, so the agent learns why instead of retrying blindly.

## Quick start

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"

# or from npm (published releases)
dsh plugin --profile web add dsh-auto-review

# 2. restart and verify the row
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

Out of the box the shipped patch AI-reviews `bash` and `write`; every other tool (including `edit` — in-place modification) delegates to the human chain. Add `edit: ai` explicitly if you accept in-place edits without a human in the loop.

## Install & uninstall

- **git channel** (latest `main`): `dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"` — the isolated `prepare` build needs the single `allowBuilds: { esbuild: true }` key the `dsh` CLI prints for `dsh-auto-review`.
- **npm channel** (published releases): `dsh plugin --profile web add dsh-auto-review`.
- **1024 store channel**: `npm i -g dsh1024` once, then `dsh1024 plugin --profile web add dsh-auto-review` (counts toward the [deepseek1024.com](https://deepseek1024.com) install ranking).
- **tarball channel**: `pnpm pack` in this repo, then `dsh plugin --profile web add ./dsh-auto-review-<version>.tgz`.
- **uninstall**: `dsh plugin --profile web remove dsh-auto-review` (or remove the row from the profile patch).
- **native build scripts**: when `dsh plugin add` stops at `ERR_PNPM_IGNORED_BUILDS` for `koffi` / `node-pty` (pulled in by the eval harness), run `pnpm approve-builds` to approve those build scripts.

## Configuration

All tunables are Schemastery `Config` fields (changeable from cordis.yml). An id-targeted override replaces the whole row — restate every key you need.

| Key | Default | Meaning |
|---|---|---|
| `enableByDefault` | `true` | Sessions start with auto-review enabled; `/auto-review on\|off` writes a durable override that beats this |
| `toolsPolicy.default` | `human` | Policy for unlisted tools (delegate to the human answerer) |
| `toolsPolicy.overrides` | `{}` | Per-tool policy: `ai` / `human` / `never` |
| `riskRules` | `[]` | `{pattern, policy, field?}` matched before the tool table; `field` selects `reason` (default), `toolName`, or `arguments` |
| `reviewerProvider` | `fork` | Subagent provider for the reviewer (in-process fork backend) |
| `reviewerModel` | *(inherit)* | Reviewer model id; unset inherits the session agent's route |
| `reviewerTimeoutMs` | `60000` | Verdict deadline; on expiry the fallback policy applies |
| `reviewerTools` | `[read, glob, grep]` | The reviewer child's tool allow-list (must be non-empty) |
| `fallbackPolicy` | `rejected` | Reviewer failure: `rejected` (fail closed) / `delegate` / `allow-once` |
| `maxReviewsPerTurn` | `10` | Real AI-verdict budget per open turn; beyond it, requests delegate |
| `maxFailuresPerTurn` | `10` | Reviewer-failure budget per open turn |
| `reasonMaxChars` | `2000` | Cap for reviewer reasons and the redacted argument preview |
| `reviewerGuidance` | *(none)* | Optional advisory guidance appended to the reviewer prompt |
| `reviewerPolicyText` | *(none)* | Markdown ruling policy injected into the reviewer prompt (Codex-style) |
| `denyGuidance` | *(anti-circumvention text)* | Guidance appended to every injected deny reason |
| `contextBudget` | `{turns: 0, maxChars: 4000}` | Compact transcript budget for the reviewer prompt; `turns: 0` disables |
| `riskPolicy` | `{maxAutoAllow: high, onHighRisk: delegate}` | `allow` verdicts above `maxAutoAllow` delegate or deny |
| `circuitBreaker` | `{consecutiveDenies: 3, windowDenies: 6, windowSize: 10, action: delegate}` | Rejection circuit breaker |
| `overrideTtlMs` | `300000` | How long a `/auto-review approve` override stays usable |
| `verdictCacheTtlMs` | `60000` | Reuse a recent verdict for an identical `tool + arguments` fingerprint; `0` disables the cache |
| `verdictCacheMaxEntries` | `256` | Maximum cached fingerprints before oldest-eviction |
| `language` | `en` | UI language of the `/auto-review` command output (`en` \| `zh`) |
| `allowUnmarkedAudit` | `false` | Force session-log audit on hosts that drop the `ignorable` marker or fail-closed on unknown event types (host `0.1.2-alpha.1`+) (dangerous: unmarked events make sessions unresumable elsewhere); default is detect-and-degrade |

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

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `auto-review` | answerer | `approval/request` waterfall answerer — claims `ai`-policy requests, delegates the rest via `next()` |
| `/auto-review` | command | `on\|off\|status\|approve [n]` — durable per-session override, budgets, and cumulative statistics |
| deny-reason injection | listener | `tools/post-execute` — verdict / fallback / `never` reasons fed back to the denied tool result |
| `autoReview` | session projection | Folded from the log-only `autoReview/*` events |
| Web review panel | client | Session-header action: switch, budgets, statistics, recent verdicts, one-shot approve |
| `dsh-eval` | CLI | YAML-driven agent evaluation engine (`bin/dsh-eval.mjs`) |
| invariant companion | invariant | `dsh-auto-review/invariant` (optional; needs the `invariants` service) |

## Session command

```
/auto-review on|off|status|approve [n]
```

`on`/`off` append the durable `autoReview/state` override (the fold survives restart/resume — replay IS the state) and inject a switch notice the model sees (logged as a `user/message` event). `status` reports the effective state, both per-turn budgets (AI verdicts and reviewer failures), a tripped circuit breaker when one is active, and the session's cumulative statistics (allows/denies/fallbacks/never rejects, mean duration, recent verdicts). `approve [n]` records a single-use `autoReview/override` for the n-th most recent denial (1 = most recent): the next same-tool review within `overrideTtlMs` carries the authorization as reviewer context — the reviewer still decides, and the override is consumed by that review regardless of its outcome.

## Web review panel

In the Web GUI (web profile), the package contributes a session-header action (**AI Review**) that opens a panel with the session's auto-review state: the switch with on/off buttons (they execute `/auto-review on|off`), both per-turn budgets, cumulative statistics (including hard-disable rejections and cache hits), the circuit trip, the recent verdicts, and one-shot **approve** buttons for recent denials (they execute `/auto-review approve [n]`).

How it is wired:

- The host registers an `autoReview` **session projection** (folded from the log-only `autoReview/*` events) and serves it through the session-projection channel.
- The browser half is a **client module** (auto-discovered from the `dsh.client` declaration) registered on the `conversation.session.header.actions` seat.
- No extra patch rows are needed: the panel loads whenever the plugin is installed in a profile whose web build provides the session-projection capability (the web profile does). Without that capability the panel reports itself unavailable; the answerer is unaffected.

The panel reads only whole projection values — it never receives the raw session event stream.

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

## dsh-eval — agent evaluation engine

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
```

Run it (a DeepSeek API key must be in the environment):

```sh
dsh-eval eval/cases --model deepseek-v4-flash --timeout-ms 240000 --out .eval-reports
```

### Assertion families

The `expect` block supports six assertion families; each assertion is evaluated independently and reports its own pass/fail with expected/actual values, so a failing case explains itself without a rerun.

| Family | DSL keys | What it gates |
|---|---|---|
| Tool trace | `toolCalls`, `toolCallsExact`, `noToolCalls`, `results` | ordered tool-call sequence (subsequence with skips), exact name sequence, per-tool result (`isError`/`contains`/`regex`) |
| Output & budget | `output`, `turnEnds`, `maxTokens` | final-output substring/regex, turn outcome, token budget |
| Prompt regression | `prompt` | the rendered system prompt must match a committed `baseline` (or a `baselineFrom` file); any drift is reported as a **side-by-side diff**, with `allowedChanges` regexes to whitelist intended edits |
| Stress metrics | `stress` | P99 step latency (`maxP99Ms`), worst time-to-first-token (`maxTtftMs`), aggregate token generation speed (`minTokensPerSecond`) |
| Fairness | `bias` | bias radar over the final output: per-category regex counts (`categories`), hard `forbid` patterns, `maxHits`/`maxCategoryHits` caps |
| Second-model review | `review` | a supplementary pass/fail verdict from the reviewer subagent (a separate layer, same seam as the approval reviewer) |

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

CI gate: the process exits 0 only when every case of every suite passed — failing evaluations fail the build. Each case leaves a replayable session JSONL and a trace JSON beside `report.md`/`report.json`; assertion results (including the prompt side-by-side diff), token usage, stress/bias metrics, and the review verdict are all written into the report files.

```yaml
- name: dsh-eval
  run: npx dsh-eval eval/cases --model deepseek-v4-flash --timeout-ms 240000 --out .eval-reports
  env:
    DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
```

`dsh-eval` differs from [openai/codex-research](https://github.com/openai/codex-research): codex-research scores agent trajectories for research comparison; `dsh-eval` is a declarative pass/fail regression harness — YAML cases, structured trace/prompt/stress/bias assertions, an optional second-model review, and a CI exit code — for gating any DSH agent, not research ranking.

## MCP server (standalone)

`dsh-auto-review` also ships a stdio **MCP server** (`dsh-auto-review-mcp`) so external MCP clients (Claude, Codex, …) can consume a deterministic review path without a harness. It speaks JSON-RPC 2.0 over newline-delimited JSON (NDJSON) — one JSON object per line, no `Content-Length` framing.

**Boundary.** The full reviewer needs the harness subagent seam and a second model, which a separate stdio process cannot reach. The standalone server is therefore **deterministic rules + cache, no model review**:

- `review_action` reuses the same-fingerprint verdict cache (`src/cache.ts`) and the risk-rule / tool-policy resolution (`src/config.ts`): a `never` rule → `deny`; a cache hit on an identical `tool + arguments` fingerprint replays that verdict; anything else (`ai` needs a model, `human` needs a human) → fail-closed `deny` with `reason: "standalone path, no model"`. It never allows an action a model did not already allow.
- `cache_stats` reports hit/store counts and the TTL status.

| Tool | Purpose |
|---|---|
| `review_action` | `{tool, args?, reason?}` → `{decision, reason, riskLevel}` — deterministic deny / cache replay |
| `cache_stats` | `{}` → `{hits, stores, size, ttlMs, enabled}` |

Run it directly:

```sh
# risk rules come from environment variables
export DSH_AUTO_REVIEW_RISK_RULES='[{"pattern":"rm -rf","policy":"never","field":"arguments"}]'
node bin/dsh-auto-review-mcp.mjs
# or, after npm install: npx dsh-auto-review-mcp
```

Environment config: `DSH_AUTO_REVIEW_RISK_RULES` (JSON array of `{pattern, policy, field?}`), `DSH_AUTO_REVIEW_TOOLS_POLICY` (JSON `{default?, overrides?}`), `DSH_AUTO_REVIEW_CACHE_TTL_MS`, `DSH_AUTO_REVIEW_CACHE_MAX_ENTRIES`.

Claude Desktop (`claude_desktop_config.json`) example:

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

The server is read-only and deterministic: no network, no model, no writes.

## Permissions & data

- **Permissions**: the workshop manifest declares `session:append`, `approval:answer`, `subagent:spawn`, `command:register`, and `tools:observe`.
- **Data**: nothing is stored on disk; the report ring buffer is in-memory and bounded. No network requests of its own.
- **Session log**: `autoReview/*` events carry reviewer identity, verdict, reason, risk, and duration — appended with the envelope's `ignorable: true` marker so any build loads the log. Hosts whose `Session.append` predates the marker (every released rc line through `0.1.1-rc.2` — no release stamps it yet) are detected before the first append (peer-version pre-check); host `0.1.2-alpha.1`+ removed the envelope entirely and rejects unknown event types on read, so those lines — and unresolvable versions — also fail closed before any append. Audit then degrades to an in-memory mirror with marker-free feedback, so sessions stay loadable everywhere.

## Security boundaries

- **The reviewer is a model.** Its verdicts are advisory policy, not a security kernel; prefer `human`/`never` rules for irreversible operations.
- **Fail closed.** Every abnormal path (provider missing, capability gaps, start rejection, timeout, non-`completed` stop reason, missing/malformed verdict, audit-correlation failure) resolves through `fallbackPolicy`, default `rejected` — and the rejection feeds an auditable reason back to the model. `allow-once` grants unconditionally; it exists only for unattended deployments whose admin accepts that risk.
- **Read-only reviewer.** The reviewer's `toolFilter` allow-list (`read`/`glob`/`grep`) cannot write, edit, run bash, fetch the network, or delegate (`maxDepth` = its own depth). Its session log is persisted and auditable.
- **Sensitive arguments are redacted** (key-name matching: `token`, `password`, `api_key`, `Authorization`, credentials, private keys …) before entering the reviewer prompt; the plugin never executes the reviewed arguments. Redaction is key-based, not content-based — do not AI-review tools whose argument values you cannot afford to show a model.
- **Hard disables explain themselves.** A `never` tool or risk rule rejects deterministically AND records a log-only `autoReview/rejection` event, then injects a `[auto-review-never]` marker into the denied tool result — the model learns the action is hard-disabled instead of retrying it (invariant-checked: marker ⟺ event).
- **Rejection circuit breaker.** A run of denials in one turn trips the breaker (`consecutiveDenies` / `windowDenies` inside `windowSize`), recorded as a log-only `autoReview/circuit` event; later requests follow its `action` (`delegate` / `reject` / `abort-turn`).
- **Reviewer context is presented transcript.** `contextBudget` feeds already-presented session content to the reviewer. With the default same-route reviewer model that content stays inside one provider; configure `reviewerModel` to a different provider only if you accept presenting that transcript to it.
- **`never` is one-way at this layer.** A `never` tool or risk rule rejects before the human chain sees the request — a lockdown knob, not a default.

## Known limitations

- The reviewer needs a working LLM route (inherited by default); without one every review falls back per `fallbackPolicy` — never a silent grant.
- `reviewerTools` names must exist as global tools in the profile; an unknown name fails the reviewer child loudly at the earliest point and falls back.
- Risk rules match the request `reason`, the `toolName`, or the redacted call `arguments` per their `field`; other conditions belong in `toolsPolicy.overrides`.
- The `/auto-review approve` override authorizes the next same-tool review, not the exact historical call; a different action on the same tool consumes it.
- The verdict events are log-only; the Web review panel reads the folded `autoReview` projection (the raw event stream never reaches browser plugins).
- `autoReview/state` and `autoReview/verdict` are appended with the envelope's `ignorable: true` marker on hosts that honor it, so any harness build loads the log — readers that do not know the out-of-repo types simply skip those records. On released rc hosts (rc.1–rc.8) the runtime detects the dropped marker and never writes these events (the in-memory mirror keeps the command, budgets, breaker, and `approve` working for the session); sessions already polluted by pre-0.5.1 versions can be repaired with `scripts/repair-session-logs.mjs` from `dsh-permission-rules` (its default target set covers all five `autoReview/*` event types).
- The git channel needs the single `allowBuilds` key the `dsh` CLI prints for `dsh-auto-review` itself. The repo ships its own `pnpm-workspace.yaml` with `allowBuilds: { esbuild: true }`; `typescript` + `tsdown` are regular `dependencies`.
- The optional invariant companion needs the `invariants` service (agent-spine compositions such as headless/ACP); the plain web profile does not provide it, so the row ships commented out in the bundle patch.

## Related work

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — two-state allow/deny classifier on the `tools/pre-execute` waterfall with file-log audit. `dsh-auto-review` deliberately differs: official **answerer** chain, always delegates what it does not own, read-only second model with a structured verdict, deny reasons fed back to the model, session-log audit.
- [ACP automation bridge](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/acp/acp) — one-shot machine decisions for its own ACP-owned agents. `dsh-auto-review` is session- and tool-policy-scoped for the interactive harness; it never infers durable grants.

## Development

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc: src + tests against the local harness checkout
pnpm test                   # vitest: 233 tests, 20 files
pnpm run build              # tsc declarations + tsdown bundles (lib/, incl. the client bundle)
pnpm run verify:self-contained
pnpm pack                   # the published tarball
```

Repository layout: `src/index.ts` (plugin contract) · `src/config.ts` (Schemastery schema + resolution) · `src/runtime.ts` (answerer, command, deny-reason injection) · `src/review.ts` (reviewer orchestration, prompt, sanitization) · `src/events.ts` (session-event vocabulary + folds) · `src/audit.ts` (host `ignorable`-marker capability detection) · `src/projection.ts` + `src/projection-types.ts` (the `autoReview` session projection) · `src/invariant.ts` (invariant companion) · `src/eval/` (the dsh-eval engine) · `eval/` (shipped evaluation composition) · `bin/dsh-eval.mjs` (CLI launcher) · `src/client/` (browser half) · `test/` · `fixtures/`.

## Topics

`deepseek-harness`, `dsh`, `dsh-plugin`, `cordis`, `approval`, `auto-review`, `second-model`, `ai-safety`, `sandbox`, `subagent`

## Contributors

- [@PerryLink](https://github.com/PerryLink) — creator and maintainer: the approval answerer, the reviewer subagent, risk policy and circuit breaker, the session-projection review panel, the invariant companion, dsh-eval, and the five-language docs.
- [@weipeng1999](https://github.com/weipeng1999) — proposed independent reviewer provider/model routing ([#11](https://github.com/PerryLink/dsh-auto-review/issues/11), [discussion #12](https://github.com/PerryLink/dsh-auto-review/discussions/12)), which shipped as `reviewerProvider` / `reviewerModel`.
- [@alexchenzl](https://github.com/alexchenzl) — listed the plugin on the DSH plugin directory ([#10](https://github.com/PerryLink/dsh-auto-review/issues/10)).

## PerryLink DSH Plugin Family

This project is one of the [33 DeepSeek Harness plugins](https://github.com/PerryLink) maintained by [PerryLink](https://github.com/PerryLink). If this one helps you, the others likely will too:

| Plugin | One-liner |
|---|---|
| **[dsh-dsh-background-agents](https://github.com/PerryLink/dsh-dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | |
| **[dsh-dsh-budget](https://github.com/PerryLink/dsh-dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | |
| **[dsh-dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore | |
| **[dsh-dsh-claude-move](https://github.com/PerryLink/dsh-dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | |
| **[dsh-dsh-click](https://github.com/PerryLink/dsh-dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. | |
| **[dsh-dsh-composer-history](https://github.com/PerryLink/dsh-dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search | |
| **[dsh-dsh-data-quality](https://github.com/PerryLink/dsh-dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) | |
| **[dsh-dsh-defend](https://github.com/PerryLink/dsh-dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | |
| **[dsh-dsh-doublecheck](https://github.com/PerryLink/dsh-dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review | |
| **[dsh-dsh-draw](https://github.com/PerryLink/dsh-dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | |
| **[dsh-dsh-fast](https://github.com/PerryLink/dsh-dsh-fast)** | Read-only performance diagnostics for DeepSeek Harness. | |
| **[dsh-dsh-fund-research](https://github.com/PerryLink/dsh-dsh-fund-research)** | Deterministic research reports for Chinese public mutual funds | |
| **[dsh-dsh-github](https://github.com/PerryLink/dsh-dsh-github)** | GitHub PR/issues integration for DSH, every write gated by approval | |
| **[dsh-dsh-industry-research](https://github.com/PerryLink/dsh-dsh-industry-research)** | Industry research orchestration that seals its deliverables through this plugin's `ctx.researchReport.assemble` | |
| **[dsh-dsh-library](https://github.com/PerryLink/dsh-dsh-library)** | Local document knowledge base for DeepSeek Harness. | |
| **[dsh-dsh-local-ai](https://github.com/PerryLink/dsh-dsh-local-ai)** | Local-model (Ollama) integration for DeepSeek Harness. | |
| **[dsh-dsh-lsp-actions](https://github.com/PerryLink/dsh-dsh-lsp-actions)** | LSP diagnostics, formatting, completion, code actions and rename over language servers | |
| **[dsh-dsh-mask](https://github.com/PerryLink/dsh-dsh-mask)** | PII masking middleware: anonymize at the model boundary, restore at the display layer | |
| **[dsh-dsh-mcp-panel](https://github.com/PerryLink/dsh-dsh-mcp-panel)** | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors | |
| **[dsh-dsh-memento](https://github.com/PerryLink/dsh-dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool | |
| **[dsh-dsh-observe](https://github.com/PerryLink/dsh-dsh-observe)** | OpenTelemetry and Langfuse observability exporter for DeepSeek Harness. | |
| **[dsh-dsh-output-styles](https://github.com/PerryLink/dsh-dsh-output-styles)** | Claude Code outputStyles-equivalent runtime style switching | |
| **[dsh-dsh-permission-rules](https://github.com/PerryLink/dsh-dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit | |
| **[dsh-dsh-plugin-guide](https://github.com/PerryLink/dsh-dsh-plugin-guide)** | Plugin-development knowledge base as an on-demand agent skill | |
| **[dsh-dsh-research-report](https://github.com/PerryLink/dsh-dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions | |
| **[dsh-dsh-score](https://github.com/PerryLink/dsh-dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. | |
| **[dsh-dsh-session-pin](https://github.com/PerryLink/dsh-dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | |
| **[dsh-dsh-session-sync](https://github.com/PerryLink/dsh-dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. | |
| **[dsh-dsh-skill-pack-security](https://github.com/PerryLink/dsh-dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review | |
| **[dsh-dsh-talk](https://github.com/PerryLink/dsh-dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. | |
| **[dsh-dsh-test-drive](https://github.com/PerryLink/dsh-dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. | |
| **[dsh-dsh-translate](https://github.com/PerryLink/dsh-dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. | |

## License

[Apache License 2.0](LICENSE) © 2026 dsh-auto-review contributors
