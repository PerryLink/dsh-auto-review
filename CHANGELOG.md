# Changelog

All notable changes to `dsh-auto-review` are documented here. The repo is pre-release; versions follow the DeepSeek Harness `0.1.0-rc.x` target runtime and bump on every behavior change.

## [0.1.2] — unreleased

### Fixed

- **Failure-classification race**: a timeout or user cancellation surfaced as a subagent start/run rejection (e.g. the fork driver's pre-publication abort) is now classified `timeout` / `cancelled` instead of the generic `unavailable`, keeping `autoReview/verdict.outcome` consistent with the service's `approval/decided`.
- **Invariant gaps closed**: the companion now enforces **one verdict per `approval/asked`** and **verdict/`decided` outcome agreement** (previously claimed in JSDoc but not implemented), and validates the new fallback marker.
- **Per-turn budget split**: `maxReviewsPerTurn` now counts real AI verdicts only; the new `maxFailuresPerTurn` budgets reviewer failures separately, so a broken reviewer no longer eats the AI-decision budget (and stops being retried after the failure budget is spent).
- **Request reason hygiene**: the request `reason` is truncated to `reasonMaxChars` before entering the reviewer prompt (it is also labeled as the calling agent's self-report, evidence only).

### Added

- **Fail-closed feedback**: a fallback rejection now injects an auditable failure text (`[auto-review-fallback]` marker, reviewId-linked) into the denied tool result, so the agent learns why it was rejected instead of retrying the same escalation blindly.
- `/auto-review status` reports both per-turn budgets (AI verdicts and reviewer failures).

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
