# Changelog

All notable changes to `dsh-auto-review` are documented here. The repo is pre-release; versions follow the DeepSeek Harness `0.1.0-rc.x` target runtime and bump on every behavior change.

## [0.2.0] — unreleased

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
