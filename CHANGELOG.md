# Changelog

All notable changes to `dsh-auto-review` are documented here. The repo is pre-release; versions follow the DeepSeek Harness `0.1.0-rc.x` target runtime and bump on every behavior change.

## [0.9.0] - 2026-09-01

### Changed

- Host `0.1.2-alpha.3` compatibility (no behavior change): dev/test pins bumped to `0.1.2-alpha.3`, `dshWorkshop.compatibility.dshVersions` lists `0.1.2-alpha.3`; the `isUnmarkedHostVersion` classification (`0.1.2.x` → unmarked, stay-write) and the audit docs are calibrated to the alpha.3 facts.

### Security

- **The reviewer child no longer receives injected context** ([#21](https://github.com/PerryLink/dsh-auto-review/issues/21)). The reviewer is built through the ordinary agent path, so the harness composed its steps the ordinary way: the workspace instruction files (`AGENTS.md` / `CLAUDE.md`), the loop's runtime-context snapshot, and any context-injecting plugin the user has installed all entered the child ABOVE the reviewer prompt — repository-controlled text inside the component that decides whether a privileged operation is allowed. A new context firewall (`src/isolation.ts`) filters every reviewer step on the documented `agent/pre-step` seam ("reject a proposed step or replace the messages that enter it") down to an allow-list of message SOURCES: the reviewer's own prompt (`user`) and its own read-only tool results (`tool`). Everything else is dropped before the loop appends it, so it never enters the child's log or its model request. The listener is registered with `prepend: true` so it wraps the whole waterfall and removes injections whichever listener added them; non-reviewer steps are returned untouched. Reviewer children are recognized by their announced prompt before `ctx.subagents.start` has resolved their session id (the in-process driver wakes the child's loop while `start` is still resolving, so an id-only test would miss the first step) and by the latched id afterwards.
- **The reviewer prompt fences everything outside itself** as untrusted transcript that grants no permission and overrides no verdict rule. This is defence in depth behind the firewall, and the only defence against a seeding provider's parent-history copy (`fork`'s completed-turn prefix), which is already the child's own log rather than a message entering a step.
- **The injected context is not provider-dependent.** The same request measured under `reviewerProvider: fork` and `reviewerProvider: spawn` produced BYTE-IDENTICAL injected context (workspace instructions 3559 chars, runtime-context snapshot 843 chars, third-party git-status snapshot 691 chars): these producers inject fresh into any new agent session rather than arriving through the fork seed. The `agent/pre-step` source filter is therefore the only thing that closes them, and it does so under either provider — `reviewerProvider: spawn` alone does NOT keep workspace instructions out of the reviewer. `spawn` addresses the completed-turn seeding specifically; neither substitutes for the other, and the seeding produced no additional messages in either trace, so its practical impact is unquantified.

### Changed

- **`contextBudget.turns` defaults to 2 instead of 0** ([#21](https://github.com/PerryLink/dsh-auto-review/issues/21)). With `turns: 0` the reviewer received no transcript at all, so the only evidence for a user-authorized action was the calling agent's own self-report — and the reviewer's own verdict rule ("deny … when the evidence is insufficient") turned that into a denial of every user-authorized escalation. The new default is the open turn (which carries the pending call and usually the request that authorized it) plus the one before it; `fixtures/config/config-full.yaml` already used 2. `turns: 0` remains a valid opt-out, and combining it with any `ai` policy now logs a warning at mount time (`hasAiPolicy`) instead of reading as a broken reviewer.
- **The context budget's character cap is spent newest-line first.** `buildContextSection` truncated the joined transcript from the front, which cut its tail — the open turn holding the evidence the verdict rules ask for. It now collects lines backwards from the newest until the cap is reached, so an over-budget transcript loses its oldest lines instead. A single line wider than the whole cap still yields its head.
- **The verdict cache is off by default as a consequence of the new `contextBudget` default**: `fingerprintFor` already refused to key a transcript-dependent verdict on `tool + arguments` alone, and that guard now fires with the shipped configuration. Set `contextBudget: { turns: 0 }` to trade the reviewer's transcript back for same-fingerprint verdict reuse.
- Host `0.1.2-alpha.2` compatibility: `Session.append`'s third parameter is now `SurfaceIntent` (surface event types only — no `ignorable` option), so append can never stamp the audit marker; the `ignorable` field stays on the event envelope and the persistence read path still fails closed on unmarked unknown event types. The `isUnmarkedHostVersion` classification (`0.1.2.x` → unmarked, stay-write) is unchanged — the audit docs are calibrated to the alpha.2 facts.
- The call-id brand is derived locally (`src/call-id.ts`) from `dsh-tools`' `ToolExecution['callId']` instead of importing `CallId` from `@deepseek-ai/dsh-llm` (renamed `ToolCallId` on host master), keeping the source green on both the published `0.1.1-rc.2` line and host checkout.
- The client half no longer imports `@deepseek-ai/dsh-client-runtime` (removed from the host): `ClientContext` is cordis `Context`, `SessionId` comes from `@deepseek-ai/dsh-session/types`, and the slots registry is accessed structurally (`ctx.get('slots')`). The `@deepseek-ai/dsh-client-runtime` peer/dev dependency, client `inject` entry, and bundle external are dropped.
- Peer lower bounds relaxed `>=0.1.1-rc.2 <0.2.0` → `>=0.1.0-rc.8 <0.2.0`; dev/test pins bumped to `0.1.2-alpha.2`; `@deepseek-ai/cordis` `^4.0.2`; `@deepseek-ai/schemastery` `^3.18.2`.
- `scripts/check-host-versions.mjs` now also watches the npm `alpha` release line (the exact dev pins are its coverage), so a newer host alpha fails the gate before a publish.

### Documentation

- **The five READMEs now say where the config actually comes from** ([#21](https://github.com/PerryLink/dsh-auto-review/issues/21)). An `auto-review:` block in `~/.dsh/settings.yaml` has no effect and produces no warning — this plugin receives its `Config` from the row the loader mounts it with, the profile's cordis patch layer — and the failure looks identical to the reviewer simply denying. Some other DSH plugins additionally read the settings service, so the inconsistency is easy to trip over. The new "Where the config actually comes from" subsection states the one real source, warns that an id-targeted override replaces the WHOLE config row (dropping `toolsPolicy` returns `bash`/`write` to the schema default `human` and the reviewer stops running), and carries a complete working example.

## [0.8.0] - 2026-08-30

### Changed

- Host `0.1.2-alpha.1` compatibility: master removed the `ignorable` envelope (42dc2a46c2) and fail-closes on unknown session event types, so `isUnmarkedHostVersion` now also classifies `0.1.2-alpha.1`+ lines as unmarked, and an unresolvable peer version fails closed BEFORE the first append (the append probe now only runs for recognized marker-aware future lines) — a probe append would otherwise pollute the log and make the session unloadable. `allowUnmarkedAudit: true` still opts back in.

### Fixed

- Test harness derives synthetic tool-call ids from `dsh-tools`' `ToolExecution['callId']` instead of importing `CallId` (renamed `ToolCallId` on host HEAD), keeping `typecheck` (checkout) and the published `0.1.1-rc.2` types both green.

### Fixed

- Declared the five client `@deepseek-ai/dsh-client-*` services (`dsh-client-connection`, `dsh-client-runtime`, `dsh-client-locale`, `dsh-client-ui-slots`, `dsh-client-ui-conversation`) as optional peerDependencies (via `peerDependenciesMeta.optional`) to match the client `inject` manifest. Added an install note to run `pnpm approve-builds` for the `koffi`/`node-pty` build scripts when pnpm reports `ERR_PNPM_IGNORED_BUILDS`.

## [0.7.0] — 2026-08-26

### Added

- **stdio MCP server export** (`dsh-auto-review/mcp` + the `dsh-auto-review-mcp` bin): a standalone stdio JSON-RPC 2.0 / MCP server (newline-delimited JSON, one object per line) exposing two tools — `review_action` (deterministic deny on a matched never-rule or fail-closed, otherwise replay a cached verdict for an identical fingerprint) and `cache_stats` (cache counters + TTL). The new `src/mcp/` modules own only protocol dispatch; every decision lives in the standalone reviewer.
- **Same-fingerprint verdict cache with TTL**: a repeated, identical tool action reuses its recent reviewer verdict instead of paying another second-model round-trip. The fingerprint is a SHA-256 digest of the tool name plus canonicalized call arguments (volatile keys stripped, keys sorted); only the digest is stored, so plaintext arguments never enter the cache. New config knobs control TTL and cacheability, `cache_stats` reports hits/stores/live size, and the web panel shows the cache state.

### Changed

- Renovate is enabled via the shared `dsh-plugin-kit` preset, and the five-language READMEs credit community contributors. No plugin behavior changed.

### Fixed

- Packed smoke install now resolves the next-tagged rc line: the `@deepseek-ai/dsh-*` peer floor is raised to `0.1.1-rc.2` (the peer ranges already cover it), so `pnpm pack` plus the smoke install no longer fails to resolve peers.

## [0.6.0] — 2026-08-23

### Added

- **dsh-eval assertion engine gains three structured assertion families** (completing the evaluation-platform direction):
  - **Prompt regression** (`expect.prompt`): the rendered system prompt must match a committed `baseline` (inline or via `baselineFrom` file); any drift is reported as a **side-by-side diff** in the report, with `allowedChanges` regexes to whitelist intended edits. The baseline file is resolved before any agent runs, and a missing/unreadable file fails the suite loudly.
  - **Stress metrics** (`expect.stress`): gates P99 step latency (`maxP99Ms`), worst time-to-first-token (`maxTtftMs`), and aggregate token generation speed (`minTokensPerSecond`), folded from per-step timing records (`step/start` → first/last `assistant/chunk` → `step/end`).
  - **Bias radar** (`expect.bias`): per-category regex counts over the final output (`categories`), hard `forbid` patterns, and `maxHits`/`maxCategoryHits` caps — the fairness (Bias-Radar) assertion.
  - Per-step timing is now collected into `trace.steps`, and the assertion engine reports optional multi-line `detail` (the prompt diff, the bias radar) which the Markdown report renders as a code block.
- Five-language READMEs document the assertion families with a combined `prompt`/`stress`/`bias` example, a GitHub Action CI snippet, and the contrast with `openai/codex-research`.

## [0.5.4] — 2026-08-22

### Changed

- Runtime `dependencies` and `devDependencies` pin the exact `0.1.1-rc.2` line and `dshWorkshop.dshVersions` lists `0.1.1-rc.2`; the peer specs stay on the `>=0.1.0-rc.8 <0.2.0` range, which already covers `0.1.1-rc.2`.
- The session-projection unit migrated to the rc2 `ProjectionDefinition` contract (`stateSchema` + `wire: { viewSchema, view }` + the required `stateVersion`), and the `autoReview` key now declares both the client `SessionProjectionMap` and the host `SessionProjectionStateMap` entries.
- The browser panel calls the rc2 `remote.commands.execute` shape (empty image list for the text-only `/auto-review` command).
- `scripts/check-host-versions.mjs` now recognizes the `0.1.1-rc.N` line family; `pnpm-workspace.yaml` excludes the whole `@deepseek-ai/*` scope from `minimumReleaseAge`; the compat workflow pins the rc2 CLI and `dsh-base`/`dsh-headless` bundles.

## [0.5.3] — 2026-08-21

### Changed

- Peers and dev/test pins bumped `0.1.0-rc.7` → `0.1.0-rc.8` (npm `next` moved; the batch rc8 compatibility release). Peer specs now use the `>=0.1.0-rc.8 <0.2.0` range form; runtime `dependencies` and `devDependencies` pin the exact `0.1.0-rc.8` line, and `dshWorkshop.dshVersions` lists `0.1.0-rc.8`.
- `isUnmarkedHostVersion` bound extended to `0.1.0-rc.8`: the rc.8 release still drops the `ignorable` envelope marker (the stamping fix exists on harness master only), so rc.8 hosts are detected BEFORE the first append and session-log audit degrades to the in-memory mirror instead of polluting the log with an unmarked `autoReview/*` event. Docs (five-language READMEs, AGENTS.md) and the README compatibility table updated to the rc.8 line.
- `scripts/check-host-versions.mjs` now accepts both exact (`0.1.0-rc.N`) and range (`>=0.1.0-rc.N <0.2.0`) peer pins and fails when they no longer cover the newest rc line published by `@deepseek-ai/dsh` (on `latest` or `next`).

## [0.5.2] — 2026-08-19

### Fixed

- The circuit breaker's deferred abort-turn `setTimeout(…, 0)` is now tracked by the runtime and cleared through a teardown effect when the plugin fiber unloads — an unload inside the macro-task window can no longer fire a stale `agent.cancel` against a disposed composition.

## [0.5.1] — 2026-08-17

### Fixed

- **rc session-corruption fix (the #918 report).** On hosts whose `Session.append` predates the `ignorable` envelope-marker surface (every released rc line through `0.1.0-rc.7` silently drops the options bag — the stamping fix exists on harness master only), `autoReview/*` audit events used to land in the session log WITHOUT the marker — stricter hosts then refused to resume those sessions (`SessionFormatUnsupportedError`). The runtime now detects such hosts BEFORE polluting a log (installed-peer pre-check, then a probe of the first appended envelope's return value), disables session-log audit with a one-time warning, and degrades to an in-memory audit mirror: marker-free deny/fallback/circuit feedback, in-memory budgets, circuit breaker, `/auto-review on|off` override and `approve` feed. Marker-aware hosts (a future release that stamps the marker, or any unresolvable version that probes clean) keep the full event-based audit unchanged. `allowUnmarkedAudit: true` opts back into the old behavior on unmarked hosts (deliberately dangerous), and already-polluted logs can be repaired with `scripts/repair-session-logs.mjs` from `dsh-permission-rules` (its default target set now covers `autoReview/state`, `autoReview/verdict`, `autoReview/circuit`, `autoReview/override`, `autoReview/rejection`).
- `/auto-review status` reports the disabled-audit notice on unmarked hosts.
- The browser half pins the api-remotes `commands` Remote namespace shape locally (the ambient namespace merge is fragile across strict package-manager copies on rc.7).

### Changed

- Peers and dev/test pins bumped `0.1.0-rc.6` → `0.1.0-rc.7` (npm `latest` moved); the full gate passes against the rc.7 peers, and `dshWorkshop.dshVersions` now lists both.

### Added

- New `src/audit.ts` host-capability module (`isMarkedAuditEvent`, `isUnmarkedHostVersion`, `peerSessionVersion`) shared by every audit path; unit-tested in `test/audit.spec.ts`, and the full degraded path is covered by `test/audit-degradation.spec.ts` (unmarked-host default safety, in-memory breaker/override/approve, the unversioned-host probe).

## [0.5.0] — 2026-08-16

### Added

- **dsh-eval agent evaluation engine** (`dsh-auto-review/eval` + the `dsh-eval` CLI): a YAML case DSL (`input`, structured `expect` block — tool-call sequence with argument matchers, per-tool results, final-output matchers, turn outcome, token budget — optional second-model `review` block, per-case `timeoutMs`/`model`/`tier`, workspace `files`/`seedFrom`, batch suites), one isolated headless session per case (fresh scratch workspace, official Minimal persona as the baseline system prompt, approval `never`, workspace-write sandbox), tool-call-trace collection from the session event log, and Markdown/JSON reports with token stats, per-assertion explanations, replayable session-log artifacts, and a CI gate (exit 0 only when every case of every suite passed).
- The second-model review is a supplementary assertion layer over the same run, reusing the approval reviewer's subagent seam (the mounted runtime is now published as `ctx.autoReviewRuntime`, so the eval engine reads the exact mounted configuration instead of a driftable copy).
- Shipped evaluation composition `eval/cordis.yml`, the self-regression suite `eval/cases/demo.yaml` (output assertion, tool-trace assertion, second-model review — three cases over this repository), the `bin/dsh-eval.mjs` launcher, and the `./eval` / `./eval-cli` package exports.
- CLI flags: `--provider`, `--model`, `--tier`, `--timeout-ms`, `--concurrency`, `--out`, `--workspace-root`, `--keep-workspaces`, `--no-markdown`, `--no-gate`, `--review-provider`, `--review-model`, `--review-timeout-ms`. A case whose model or timeout resolves from nothing fails the suite loudly (no hardcoded defaults); runs are cancellable (`AbortSignal` + SIGINT/SIGTERM) and the worker pool respects the concurrency cap.

### Changed

- README (all five languages) documents the evaluation engine with a case example, a CI integration snippet, and the contrast with codex-research.
- The unit suite covers the eval engine end to end (DSL, assertion engine, trace collection, runner, reports, CLI).

## [0.4.1] — 2026-08-15

### Added

- `package.json#dshWorkshop` manifest (`omdsh-workshop-package/v1`): transactional `profile-bundle` install declaration, `harness-profile` integration protocol, restart-profile lifecycle, the `/auto-review status` named capability, and author-run install/remove evidence under `docs/omdsh-evidence/` — the omdsh hub intake surface (author declarations only; verification stays with the hub).

## [0.4.0] — 2026-08-15

### Added

- **Hard-disable feedback**: a `never`-policy rejection (risk rule or tool-policy table entry) now records a log-only `autoReview/rejection` event (with the matched rule/entry as the reason and the correlated `approvalId`) and injects a `[auto-review-never]` marker text plus the deny guidance into the denied tool result — the model learns the action is hard-disabled instead of retrying it. The invariant companion validates the rejection chain (marker ⟺ event, one decision per `approval/asked`, `decided` agreement); the panel and `/auto-review status` count never rejects.
- `/auto-review status` reports a tripped circuit breaker (kind, count, action) when one is active in the turn.
- The web review panel's switch gains explicit on/off buttons (they execute `/auto-review on|off`).

### Changed

- **Circuit-breaker defaults are now reachable**: `windowDenies` 10 → 6 and `windowSize` 50 → 10, so the window mode (6 of the last 10 verdicts) can trip under the default `maxReviewsPerTurn: 10` even without a 3-deny run (the old 10-in-50 window could never trip first). Explicit configs are unaffected.
- The projection unit is now built per mount (`makeAutoReviewProjection(enabledByDefault)`), so the panel's initial switch state follows the resolved `enableByDefault` instead of a hardcoded `true`; `stateVersion` bumped to 2 (also for the new `neverRejects` wire field).
- tsdown `external`/`noExternal` migrated to the non-deprecated `deps.neverBundle`/`deps.alwaysBundle`.
- Published on npm; the README install section now lists the npm channel first.

### Fixed

- The panel's switch row no longer renders the localized "ON" text as its label (it now reads "State: ON/OFF").

## [0.3.0] — 2026-08-14

### Added

- **Web review panel**: a session-header action in the Web GUI showing the session's switch, both per-turn budgets, cumulative statistics, the circuit trip, recent verdicts, and one-shot approve buttons for recent denials (they execute `/auto-review approve [n]`).
  - Host: an `autoReview` **session projection** (`src/projection.ts` + `src/projection-types.ts`) folds the log-only `autoReview/*` events into one wire-JSON value; it registers whenever the host provides the session-projection capability (the web profile does), so non-web mounts keep working unchanged.
  - Browser: a **client module** (`dsh.client` declaration + `./client` export) registered on the `conversation.session.header.actions` seat; it reads only the projection whole value — the raw session event stream never reaches browser plugins.
  - The browser bundle follows the shell's client-bundle handshake (`window.__ModuleLoader__.load`), with platform modules external and everything else inlined.
- `CHANGELOG.md` is now shipped in the tarball.

## [0.2.0] — 2026-08-14

### Breaking

- `fallbackPolicy: allow-readonly` is renamed `allow-once` (the grant is unconditional, never "readonly"); the old spelling is rejected loudly at load. Migration: rename the key.
- The shipped bundle patch no longer AI-reviews `edit` by default (`bash`/`write` remain); in-place modification now reaches the human chain unless configured explicitly.

### Added

- **Risk-level policy** (`riskPolicy`): an `allow` verdict whose risk exceeds `maxAutoAllow` never settles the request — `onHighRisk: delegate` continues the chain, `deny` rejects. Recorded as `escalation: 'risk-policy'` on the verdict.
- **Rejection circuit breaker** (`circuitBreaker`): trips on `consecutiveDenies` consecutive denials or `windowDenies` within the last `windowSize` verdicts of a turn; later requests `delegate`, `reject` (auditable `[auto-review-circuit]` feedback), or `abort-turn` (warning injected + agent cancelled). Recorded as a log-only `autoReview/circuit` event, once per turn.
- **One-shot human override**: `/auto-review approve [n]` records a single-use `autoReview/override` for the n-th most recent denial; the next same-tool review within `overrideTtlMs` carries the authorization as reviewer context.
- **Compact reviewer transcript** (`contextBudget`): the reviewer sees a bounded tail of the session's presented messages and tool results.
- **Ruling policy text** (`reviewerPolicyText`): Codex-style Markdown policy injected into the reviewer prompt (template at `fixtures/config/policy-template.md`).
- **Anti-circumvention deny guidance** (`denyGuidance`) appended to every injected deny reason.
- **Risk-rule fields**: `riskRules[].field` selects `reason` (default) | `toolName` | `arguments` (redacted presented call arguments).
- `/auto-review status` reports cumulative session statistics (allows/denies/fallbacks, mean duration, recent verdicts).
- Provider capability precheck (`outputSchema`/`toolFilter`) fails with a clear message instead of a generic start rejection; `reviewerTools: []` fails loud at load.
- UI language config (`language: 'en' | 'zh'`) for the `/auto-review` command output.

### Fixed

- Fallback-policy switch and docs now use the honest `allow-once` naming.

## [0.1.2] — 2026-08-14

### Fixed

- **Failure-classification race**: a timeout or user cancellation surfaced as a subagent start/run rejection (e.g. the fork driver's pre-publication abort) is now classified `timeout` / `cancelled` instead of the generic `unavailable`, keeping `autoReview/verdict.outcome` consistent with the service's `approval/decided`.
- **Invariant gaps closed**: the companion now enforces **one verdict per `approval/asked`** and **verdict/`decided` outcome agreement** (previously claimed in JSDoc but not implemented), and validates the new fallback marker.
- **Per-turn budget split**: `maxReviewsPerTurn` now counts real AI verdicts only; the new `maxFailuresPerTurn` budgets reviewer failures separately, so a broken reviewer no longer eats the AI-decision budget (and stops being retried after the failure budget is spent).
- **Request reason hygiene**: the request `reason` is truncated to `reasonMaxChars` before entering the reviewer prompt (it is also labeled as the calling agent's self-report, evidence only).

### Added

- **Fail-closed feedback**: a fallback rejection now injects an auditable failure text (`[auto-review-fallback]` marker, reviewId-linked) into the denied tool result, so the agent learns why it was rejected instead of retrying the same escalation blindly.
- `/auto-review status` reports both per-turn budgets (AI verdicts and reviewer failures).
- CI workflow (`typecheck`/`test`/`build`/`verify`/`pack`) plus a host-version watch that fails when the exact-pinned `@deepseek-ai/dsh-*` peers lag the npm `latest`.

### Changed

- Removed stale demo probe scripts and capture artifacts; the tests badge is now a live GitHub Actions badge.

## [0.1.1]

### Added

- `autoReview/state` and `autoReview/verdict` are appended with the envelope's `ignorable: true` marker so any harness build can load the log.

### Changed

- Git-install channel hardening: repo-shipped `pnpm-workspace.yaml` declares `allowBuilds: { esbuild: true }` for the isolated prepare environment.

## [0.1.0]

### Added

- Initial release: `approval/request` answerer with second-model read-only reviewer subagent, structured verdict schema, fail-closed fallback, anti-recursion, per-tool/risk-rule policy routing, deny-reason feedback, session-log audit (`autoReview/verdict`), invariant companion, and the `/auto-review` session command.
