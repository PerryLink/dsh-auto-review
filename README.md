<!-- language links -->
[English](README.md) · [中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

<div align="center">

# 🤖 dsh-auto-review

**Second-model AI approval for DeepSeek Harness** — the Codex `approvals_reviewer=auto_review` / Claude Code *auto mode* pattern, built as a pure Cordis plugin.

When an agent's action crosses the sandbox boundary, a **read-only reviewer subagent** decides allow/deny — with a reason — so humans approve nothing while nothing unsafe slips through.

[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-4c51bf.svg)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![tests](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-auto-review/ci.yml?label=tests&logo=githubactions)](.github/workflows/ci.yml)
[![typescript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](src)
[![type](https://img.shields.io/badge/type-cordis%20bundle-8a5cf6.svg)](cordis.patch.yml)
[![repo](https://img.shields.io/badge/repo-PerryLink%2Fdsh--auto--review-181717.svg)](https://github.com/PerryLink/dsh-auto-review)

**Zero human operations.** The request goes to the AI reviewer, the verdict is allow/deny + reason + risk level, and every decision is reconstructable from the session log: `approval/asked` → `autoReview/verdict` → `approval/decided`.

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
| 💬 **Deny reasons reach the model** | The reviewer's reason is injected into the denied tool result (callId-linked), so the agent adapts. Fail-closed fallback rejections inject an auditable failure text too. |
| 📜 **Full audit trail** | `autoReview/verdict` session events (reviewer identity, verdict, reason, risk, duration) + an invariant companion enforcing *model-visible ⟺ logged*. |
| 🔁 **No recursion** | Reviewer asks are recognized by identity and delegated; `maxDepth` + the tool allow-list keep the reviewer non-delegating. |
| ⌨️ **Session command** | `/auto-review on|off|status` with a durable per-session override that survives restore. |

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
                        │
                        ▼
 audit: approval/asked → autoReview/verdict → approval/decided
        (session events, log-only, invariant-checked)
```

## 🚀 Quick start

Three install channels; the plugin is a **bundle** (`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`).

```sh
# 1. npm tarball (built artifacts, no build permission needed)
pnpm pack                       # → dsh-auto-review-<version>.tgz
dsh plugin --profile web add ./dsh-auto-review-<version>.tgz
dsh --profile web               # restart

# 2. git source (pin the commit; self-contained `prepare` builds it)
#    pnpm ≥ 10 blocks lifecycle builds: add the printed allowBuilds key
#    to the profile's pnpm-workspace.yaml first.
dsh plugin --profile web add "github:PerryLink/dsh-auto-review#<commit>"

# 3. local link (development)
dsh plugin --profile web add link:/path/to/dsh-auto-review
```

Verify:

```sh
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

Out of the box the shipped patch AI-reviews `bash`, `write`, and `edit`; every other tool delegates to the human chain.

## ⚙️ Configuration

All tunables are Schemastery `Config` fields (changeable from cordis.yml). An id-targeted override **replaces the whole config row** — restate every key you need.

| Key | Default | Meaning |
|---|---|---|
| `enableByDefault` | `true` | Sessions start with auto-review enabled; `/auto-review on\|off` writes a durable override that beats this |
| `toolsPolicy.default` | `human` | Policy for unlisted tools (delegate to the human answerer) |
| `toolsPolicy.overrides` | `{}` | Per-tool policy: `ai` (reviewer decides), `human` (force human), `never` (deterministic reject) |
| `riskRules` | `[]` | `{pattern, policy}` matched (first match wins) against the request reason, **before** the tool table |
| `reviewerProvider` | `fork` | Subagent provider for the reviewer (in-process fork backend) |
| `reviewerModel` | *(inherit)* | Reviewer model id; unset inherits the session agent's route |
| `reviewerTimeoutMs` | `60000` | Verdict deadline; on expiry the fallback policy applies |
| `reviewerTools` | `[read, glob, grep]` | The reviewer child's tool allow-list — everything else is invisible there |
| `fallbackPolicy` | `rejected` | Reviewer failure: `rejected` (fail closed), `delegate` (continue the chain), `allow-readonly` (grant — see Security) |
| `maxReviewsPerTurn` | `10` | Real AI-verdict budget per open turn; beyond it, requests delegate to humans |
| `maxFailuresPerTurn` | `10` | Reviewer-failure budget per open turn (timeout/unavailable/schema, not cancellations); beyond it, requests delegate instead of paying another full timeout. Defaults to `maxReviewsPerTurn` |
| `reasonMaxChars` | `2000` | Cap for reviewer reasons and the redacted argument preview |
| `reviewerGuidance` | *(none)* | Optional advisory guidance appended to the reviewer prompt |

Example (annotated full form: `fixtures/config/config-full.yaml`):

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

## ⌨️ Session command

```
/auto-review on|off|status
```

`on`/`off` append the durable `autoReview/state` override (the fold survives restart/resume — replay IS the state) and inject a switch notice the model sees (logged as a `user/message` event). `status` reports the effective state and both per-turn budgets (AI verdicts and reviewer failures).

## 🔒 Security

- The reviewer runs in a **read-only tool face** (`toolFilter` allow-list). It cannot write, edit, run bash, fetch the network, or delegate (`maxDepth` = its own depth). Its session log is persisted and auditable.
- **Sensitive arguments are redacted** (key-name matching: `token`, `password`, `api_key`, `Authorization`, credentials, private keys …) before entering the reviewer prompt; the plugin never executes the reviewed arguments. Redaction is key-based, not content-based — do not AI-review tools whose argument values you cannot afford to show a model.
- **Fail closed by default.** Every abnormal path (provider missing, start rejection, timeout, non-`completed` stop reason, missing/malformed verdict, audit-correlation failure) resolves through `fallbackPolicy`, default `rejected` — and the rejection feeds an auditable reason back to the model instead of the generic "user rejected" text. `allow-readonly` grants unconditionally — it exists only for unattended deployments whose admin accepts that risk.
- **`never` is one-way at this layer.** A `never` tool or risk rule rejects before the human chain sees the request — a lockdown knob, not a default.
- **The reviewer is a model.** Its verdicts are advisory policy, not a security kernel. Prefer `human`/`never` rules for irreversible operations.

## ⚠️ Known limitations

- The reviewer needs a working LLM route (inherited from the session agent by default); without one every review falls back per `fallbackPolicy` — never a silent grant.
- `reviewerTools` names must exist as global tools in the profile; an unknown name fails the reviewer child loudly at the earliest point and falls back.
- Risk rules match the request `reason` only; tool-name conditions belong in `toolsPolicy.overrides`.
- The verdict event is log-only; the Web UI audit panel renders session events as-is (no dedicated panel).
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
pnpm test                   # vitest: 61 tests, 6 suites
pnpm run build              # tsc declarations + tsdown bundles (lib/)
pnpm run verify:self-contained
pnpm pack                   # publish artifact
```

Repository layout (plugin-template structure): `src/index.ts` (plugin contract) · `src/config.ts` (Schemastery schema + resolution) · `src/runtime.ts` (answerer, command, deny-reason injection) · `src/review.ts` (reviewer orchestration, prompt, sanitization) · `src/events.ts` (session-event vocabulary + folds) · `src/invariant.ts` (invariant companion) · `test/` · `fixtures/`.

## 📄 License

[Apache License 2.0](LICENSE)
