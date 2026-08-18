# Changelog

All notable changes to `dsh-auto-review` are documented here. The repo is pre-release; versions follow the DeepSeek Harness `0.1.0-rc.x` target runtime and bump on every behavior change.

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
