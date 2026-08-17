<div align="center">

# 🤖 dsh-auto-review

**Second-model AI approval for DeepSeek Harness — a read-only reviewer subagent decides allow/deny on the approval chain, fail-closed by default.**

*When an action crosses the sandbox boundary, a second model reads the evidence and returns a verdict with a reason — so humans approve nothing while nothing unsafe slips through.*

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
| Harness | DeepSeek Harness `0.1.0-rc.6` (peers pinned to `0.1.0-rc.6`) |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Platforms | All (host answerer; optional Web review panel via the session-projection capability) |
| Model | Any (the reviewer inherits the session agent's route; `reviewerModel` overrides) |

## What you get

`dsh-auto-review` puts a second model on the `approval/request` answerer chain:

1. **Official seam** — an answerer that claims only the requests it owns (`ai` policy) and delegates everything else via `next()`; the human approval flow is never short-circuited.
2. **Read-only reviewer subagent** — a one-shot fork with a `read`/`glob`/`grep` tool allow-list returns a structured verdict `{ decision, reason, riskLevel }`.
3. **Fail closed** — reviewer crash, timeout, or schema mismatch resolves through `fallbackPolicy` (default `rejected`); a deny verdict feeds its reason back to the calling model.
4. **Config-driven routing** — per-tool policies (`ai`/`human`/`never`) plus regex risk rules, all changeable from cordis.yml.
5. **Full audit trail** — log-only `autoReview/verdict` + `autoReview/rejection` session events (envelope `ignorable: true`) plus an optional invariant companion enforcing marker ⟺ event.
6. **Safety knobs** — a rejection circuit breaker, a risk-level policy, a one-shot `/auto-review approve` override, and a `never`-policy hard disable that explains itself to the model.

Every decision reconstructs from the session log: `approval/asked` → `autoReview/verdict` (or `autoReview/rejection`) → `approval/decided`.

## Quick start

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"

# or from npm (published releases)
dsh plugin --profile web add dsh-auto-review

# 2. restart and verify the row
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

Out of the box the shipped patch AI-reviews `bash` and `write`; every other tool delegates to the human chain.

## Install & uninstall

- **git channel** (latest `main`): `dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"` — the isolated `prepare` build needs the single `allowBuilds: { esbuild: true }` key the `dsh` CLI prints for `dsh-auto-review`.
- **npm channel** (published releases): `dsh plugin --profile web add dsh-auto-review`.
- **tarball channel**: `pnpm pack` in this repo, then `dsh plugin --profile web add ./dsh-auto-review-<version>.tgz`.
- **uninstall**: `dsh plugin --profile web remove dsh-auto-review` (or remove the row from the profile patch).

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
| `language` | `en` | UI language of the `/auto-review` command output (`en` \| `zh`) |

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

## dsh-eval — agent evaluation engine

Beyond the approval reviewer, `dsh-auto-review` ships `dsh-eval`: a YAML-driven agent evaluation platform that runs real headless DSH sessions (one isolated agent + scratch workspace per case), collects the tool-call trace from the session event log, and evaluates structured assertions plus an optional second-model review — the same reviewer seam as the approval answerer.

```sh
dsh-eval eval/cases --model deepseek-v4-flash --timeout-ms 240000 --out .eval-reports
```

CI gate: the process exits 0 only when every case of every suite passed. Each case leaves a replayable session JSONL and a trace JSON beside `report.md`/`report.json`.

## Permissions & data

- **Permissions**: the workshop manifest declares `session:append`, `approval:answer`, `subagent:spawn`, `command:register`, and `tools:observe`.
- **Data**: nothing is stored on disk; the report ring buffer is in-memory and bounded. No network requests of its own.
- **Session log**: `autoReview/*` events carry reviewer identity, verdict, reason, risk, and duration — appended with the envelope's `ignorable: true` marker so any build loads the log.

## Security boundaries

- **The reviewer is a model.** Its verdicts are advisory policy, not a security kernel; prefer `human`/`never` rules for irreversible operations.
- **Fail closed.** Every abnormal path resolves through `fallbackPolicy`, default `rejected` — and the rejection feeds an auditable reason back to the model.
- **Read-only reviewer.** The reviewer's `toolFilter` allow-list (`read`/`glob`/`grep`) cannot write, edit, run bash, fetch the network, or delegate.
- **Sensitive arguments are redacted** (key-name matching) before entering the reviewer prompt; the plugin never executes the reviewed arguments.
- **`never` is one-way.** A `never` tool or risk rule rejects before the human chain sees the request.

## Known limitations

- The reviewer needs a working LLM route (inherited by default); without one every review falls back per `fallbackPolicy` — never a silent grant.
- `reviewerTools` names must exist as global tools in the profile; an unknown name fails the reviewer child loudly.
- Risk rules match the request `reason`, the `toolName`, or the redacted call `arguments`; other conditions belong in `toolsPolicy.overrides`.
- The `/auto-review approve` override authorizes the next same-tool review, not the exact historical call.
- The verdict events are log-only; the Web review panel reads the folded `autoReview` projection (the raw event stream never reaches browser plugins).
- The optional invariant companion needs the `invariants` service (agent-spine compositions); the plain web profile does not provide it.

## Development

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc: src + tests against the local harness checkout
pnpm test                   # vitest: 190 tests, 14 files
pnpm run build              # tsc declarations + tsdown bundles (lib/, incl. the client bundle)
pnpm run verify:self-contained
pnpm pack                   # the published tarball
```

## Topics

`deepseek-harness`, `dsh`, `dsh-plugin`, `cordis`, `approval`, `auto-review`, `second-model`, `ai-safety`, `sandbox`, `subagent`

## Contributors

- [@PerryLink](https://github.com/PerryLink) — creator and maintainer: the approval answerer, the reviewer subagent, risk policy and circuit breaker, the session-projection review panel, the invariant companion, dsh-eval, and the five-language docs.

## License

[Apache License 2.0](LICENSE) © 2026 dsh-auto-review contributors
