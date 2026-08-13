# dsh-auto-review

Second-model AI auto-review for DeepSeek Harness approval requests — the Codex `approvals_reviewer=auto_review` / Claude Code "auto mode" pattern as a pure cordis plugin.

When an agent's action crosses a permission boundary (sandbox escalation, approval-gated tool), `dsh-auto-review` answers the `approval/request` waterfall with a one-shot **reviewer subagent**: a read-only child model that returns a structured allow/deny verdict with a reason. Requests the plugin does not own are delegated via `next()` to the human answerer chain — the human approval flow is never short-circuited. Every verdict is audit-loggable from the session log: `approval/asked` → `autoReview/verdict` → `approval/decided`.

```text
                         approval/request waterfall (answerer chain)
                          │
  ┌───────────────────────┴──────────────────────┐
  │ dsh-auto-review answerer                     │
  │  · session enabled?  · policy = ai?          │  no  ── next() ──▶ human answerer (UI)
  │  · risk rules → toolsPolicy → default        │
  └───────────────────────┬──────────────────────┘
                          │ yes
                          ▼
          ┌───────────────────────────────┐
          │ reviewer subagent (fork, one-shot) │
          │  · toolFilter: read/glob/grep only │
          │  · outputSchema: {decision, reason, │
          │    riskLevel}  (structured_output)  │
          │  · timeout + req.signal abort       │
          └───────────────┬───────────────┘
                          │ verdict / failure (fail-closed fallback)
                          ▼
   allow → allowed-once        deny → rejected + reason injected into
                                       the denied tool result (callId-linked)
                          │
                          ▼
   audit: approval/asked → autoReview/verdict → approval/decided
          (session events, log-only, invariant-checked)
```

## Why a second model instead of rules

Pattern-based auto-approvers reject or allow before dispatch without evidence. The reviewer subagent reads the actual workspace (through its read-only tool face), the already-streamed tool-call arguments (sensitive values redacted), the request reason, and the configured risk rules — then decides. A deny verdict feeds its **reason back to the calling model** through the denied tool result, so the agent learns why instead of retrying blindly.

## How it behaves

- **Answers only what it owns.** A request is claimed only when all of: auto-review is enabled for the session, the resolved policy for that tool/reason is `ai`, and the per-turn budget (`maxReviewsPerTurn`) remains. Everything else calls `next()`.
- **Human flow intact.** Unlisted tools default to `human` (delegate). A `human` policy means the request continues down the chain to the human answerer. Only `never` short-circuits — as a deterministic reject — and only for tools an admin hard-disables.
- **Fail closed.** Reviewer crash, subagent seam failure, timeout, or a malformed structured verdict never opens the gate: the `fallbackPolicy` applies, and the default is `rejected`. `delegate` hands the request to the next answerer; `allow-readonly` grants it (dangerous — see Security).
- **No recursion.** A reviewer child's own approval asks are recognized by session identity and delegated onward; the reviewer runs with `maxDepth: 0` and a read-only tool allow-list, so it cannot escalate, mutate, or delegate.
- **The `never` approval policy is untouched.** It is enforced inside the core service before any answerer runs; this plugin cannot and does not try to bypass it.
- **Auditable.** The service already writes `approval/asked` + `approval/decided`. The plugin appends `autoReview/verdict` (reviewer identity, verdict, reason, risk level, duration, fallback kind) — log-only, never in the model transcript. The one model-visible piece of content (the injected deny reason) embeds the verdict's `reviewId`, and the invariant companion verifies the marker ⟺ verdict link on every session log.

## Install

Three channels; the plugin is a **bundle** (`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`).

```sh
# 1. npm tarball (built artifacts, no build permission needed)
pnpm pack                       # in this repo → dsh-auto-review-0.1.0.tgz
dsh plugin --profile web add ./dsh-auto-review-0.1.0.tgz
dsh --profile web               # restart

# 2. git source (pinned commit; self-contained `prepare` builds it)
#    pnpm ≥ 10 blocks dependency lifecycle builds until allowed: add the
#    printed allowBuilds key to the profile's pnpm-workspace.yaml first.
dsh plugin --profile web add "github:<owner>/dsh-auto-review#<commit>"

# 3. local link (development)
dsh plugin --profile web add link:/path/to/dsh-auto-review
```

Verify the composition and that nothing fails to load:

```sh
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

The shipped patch mounts the `auto-review` row with an out-of-the-box demo policy: `bash`, `write`, and `edit` are AI-reviewed; every other tool delegates to the human chain. The **invariant companion** (`dsh-auto-review/invariant`) is shipped but commented out in the patch: it waits for the `invariants` service, which agent-spine compositions (headless/ACP apps) provide but the plain web profile does not — uncomment the row into your profile patch layer only in compositions that mount that service.

## Configuration

All tunables are Schemastery `Config` fields (changeable from cordis.yml). An id-targeted override **replaces the whole config row** — restate every key you need.

| Key | Default | Meaning |
|---|---|---|
| `enableByDefault` | `true` | Whether sessions start with auto-review enabled; `/auto-review on\|off` writes a durable per-session override that beats this |
| `toolsPolicy.default` | `human` | Policy for tools not listed in `overrides` (delegate to the human answerer) |
| `toolsPolicy.overrides` | `{}` | Per-tool policy: `ai` (reviewer decides), `human` (force human), `never` (deterministic reject) |
| `riskRules` | `[]` | `{pattern, policy}` list matched (first match wins) against the request reason, **before** the tool table — security rules beat tool defaults |
| `reviewerProvider` | `fork` | Subagent provider for the reviewer (the in-process fork backend) |
| `reviewerModel` | *(inherit)* | Reviewer model id; unset inherits the session agent's route |
| `reviewerTimeoutMs` | `60000` | Verdict deadline; on expiry the fallback policy applies |
| `reviewerTools` | `[read, glob, grep]` | The reviewer child's tool allow-list — everything else is invisible and unexecutable there |
| `fallbackPolicy` | `rejected` | Reviewer failure handling: `rejected` (fail closed), `delegate` (continue the chain), `allow-readonly` (grant — see Security) |
| `maxReviewsPerTurn` | `10` | Verdict budget per open turn; further requests delegate to humans |
| `reasonMaxChars` | `2000` | Cap for reviewer reasons and the redacted argument preview |
| `reviewerGuidance` | *(none)* | Optional advisory guidance appended to the reviewer prompt (not a hard rule) |

Example (see `fixtures/config/config-full.yaml` for the annotated full form):

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

### Session command

```
/auto-review on|off|status
```

`on`/`off` append the durable `autoReview/state` override (the fold survives restart/resume — replay IS the state) and inject a switch notice the model sees (logged as a `user/message` event, model-visible ⟺ logged). `status` reports the effective state and the turn's verdict budget.

## Security boundaries

- The reviewer runs in a **read-only tool face** (`toolFilter` allow-list). It cannot write, edit, execute bash, fetch the network, or delegate (`maxDepth: 0`). Its own session log is persisted and auditable like any other.
- **Sensitive arguments are redacted** (key-name matching: `token`, `password`, `api_key`, `Authorization`, credentials, private keys …) before entering the reviewer prompt; the plugin never executes the reviewed arguments. Redaction is key-based, not content-based — a secret inside an arbitrary string value still reaches the reviewer. Do not review tools whose arguments you cannot afford to show a model.
- **Fail closed by default.** Every abnormal path (provider missing, start rejection, timeout, non-`completed` stop reason, missing/malformed structured verdict, audit-correlation failure) resolves through `fallbackPolicy`; the default is `rejected`. `allow-readonly` grants the request unconditionally — it is not "readonly" in any enforced sense and exists only for unattended deployments whose admin accepts that risk.
- **`never` is one-way at this layer.** A `never` tool or risk rule rejects before the human chain sees the request. It is a lockdown knob for tools an admin wants hard-disabled whenever approval is required — not a default.
- **The reviewer is a model.** Its verdicts are advisory policy, not a security kernel. Do not use `allow-readonly`, and prefer `human`/`never` rules for irreversible operations, when the reviewer runs on a weak model.

## Known limitations

- The reviewer needs a working LLM route (the session agent's provider/model by default). Without one every review falls back per `fallbackPolicy` — the request still never silently proceeds unless configured to.
- `reviewerTools` names must exist as global tools in the profile; an unknown name makes `tools.restrict()` reject the reviewer child (the review fails at the earliest point, loudly, and falls back).
- Risk rules match the request `reason` only; tool-name conditions belong in `toolsPolicy.overrides`.
- The verdict event is log-only; the Web UI's audit panel renders session events as-is, so the verdict row appears there without a dedicated panel.
- Bundling `typescript` + `tsdown` as regular `dependencies` (not devDependencies) is deliberate: pnpm does not install devDependencies of git-hosted packages, and the git channel's `prepare` must build with what production dependencies alone provide.

## Demo

`docs/demo-auto-review.gif` is one real evidence run (real server, real API key, two real model rounds): a read-only session asks for an escalated workspace write — the AI reviewer **allows** it (risk low, 5.2s, zero human operations); a recursive out-of-workspace delete with full-access escalation is **denied** (risk high, 8.9s) and the reviewer's reason appears in the transcript. Replay: `demo/capture-demo.mjs` + `demo/cordis.patch.yml`.

## Development

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc, src + tests
pnpm test                   # vitest: 61 tests, 6 suites
pnpm run build              # tsc declarations + tsdown bundles (lib/)
pnpm run verify:self-contained
pnpm pack                   # publish artifact
```

Repository layout (plugin-template structure): `src/index.ts` (plugin contract), `src/config.ts` (Schemastery schema + resolution), `src/runtime.ts` (answerer, command, deny-reason injection), `src/review.ts` (reviewer subagent orchestration, prompt, sanitization), `src/events.ts` (session-event vocabulary + folds), `src/invariant.ts` (invariant companion, mounted as `dsh-auto-review/invariant`), `test/`, `fixtures/` (replayable session logs + config examples).

## Related work

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) implements a two-state allow/deny classifier on the `tools/pre-execute` waterfall with its own file-log audit; `dsh-auto-review` deliberately differs: it sits on the official `approval/request` **answerer** chain, always delegates what it does not own, decides with a read-only second model that returns a structured verdict, feeds deny reasons back into the model, and keeps every verdict reconstructable from the session log.
- The [ACP automation bridge](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/acp/acp) offers one-shot machine decisions for its own ACP-owned agents. `dsh-auto-review` is session- and tool-policy-scoped for the interactive harness; it does not speak ACP and never infers durable grants.

## License

Apache License 2.0
