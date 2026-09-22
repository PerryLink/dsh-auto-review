# Changelog

All notable changes to `dsh-auto-review` are documented here. The repo is pre-release; versions follow the DeepSeek Harness `0.1.0-rc.x` target runtime and bump on every behavior change.

## [Unreleased]

### Changed

- **Adapt to host `dsh-v0.1.7-alpha.1`.** Five confirmed breakages between the `0.1.6-alpha.2` faces this package was built against and the `0.1.7-alpha.1` host:
  - **The `MessageSourceMap` catch-all `kind: 'plugin'` is gone.** The host's `MessageSourceMap` is a merge-extensible sum type whose every producer declares its OWN kind, and the durable-log admission path (`session-format-v3-to-v4/src/message-sources.ts`) refuses a row whose source is literally `kind: 'plugin'` — the refusal is physical, so not even a cast gets such a row past it. New `src/message-source.ts` declares `'auto-review'`, and both notices (`/auto-review on|off`'s switch notice, the circuit-breaker abort warning) now carry `{ kind: 'auto-review', form: 'notice', summary }` with the summary bounded by the host's `boundContextSummary`. Nothing in this package reads messages back BY source (the `autoReview` projection folds only its own `autoReview/*` events), so no back-compat branch was needed: the three durable spellings a stored log can hold — `{ kind: 'auto-review' }`, the V3→V4 migration's `plugin:auto-review` EVENT namespace (not a source), and the retired `{ kind: 'plugin', plugin: 'auto-review' }` source — only have to stay LOADABLE, which the host's own migration guarantees.
  - **The `'tool-result'` content block no longer exists.** V4 writes a first-class `role: 'tool'` message carrying `toolCallId` and the result blocks at its TOP level, and the V4 admission path refuses content that still contains a released `tool-result` wrapper. New `src/session-message.ts` normalizes both shapes for the three readers (`src/review.ts`'s reviewer transcript, `src/invariant.ts`'s marker↔event link, `src/eval/trace.ts`'s tool-result fold). **Read compatibility only — this package never WRITES the retired shape**; `tool/result` rows are produced by the host, and `fixtures/sessions/*.json` are replayable logs authored on the old line, so a fixture rewritten to V4 would stop exercising the upgrade path a real user's log takes. The invariant tests gained a released-V3 fixture for the same reason.
  - **`@deepseek-ai/dsh-settings-file` was deleted and `ctx.settingsScope` with it.** This package never registered a settings namespace and never injected `settings` — the only references were one dead `dependencies` row and the `eval/cordis.yml` row that mounted it. Both are removed; `eval/cordis.yml` now boots without it, and every configuration field stays an ordinary cordis.yml `Config` field, so no config, default, or persisted shape changes. (Its `settings` service is provided by the composition's own spine row.)
  - **`@deepseek-ai/dsh-agent-presets` → `@deepseek-ai/dsh-agent-preset-registry`.** This package never imported the renamed package; the only reference was one now-dead `pnpm-workspace.yaml` override row naming it, and that whole block is gone (see the dependency entry below).
  - **`turn/end.reason` gained `forked`.** `src/eval/trace.ts`'s `copyTurnEnd` was already a non-exhaustive `switch` with a `default`, so nothing fell through silently; `forked` now has its own `TraceTurnEnd` variant instead of degrading to `{ kind: 'unknown' }`, because the eval runner forks sessions and a case can legitimately end on a fork-seed cut. `turnEnds: completed` still reports it as not completed.
- **Whole-graph pin of `@deepseek-ai/dsh-*` to the host line in `pnpm-workspace.yaml`.** Only the DIRECT dependencies can be pinned in `package.json` (pnpm 11 no longer reads a `pnpm` field there), and everything else in the graph is a PEER: `autoInstallPeers` satisfies a peer with whatever version its range allows, and the frozen `dsh-agent-spine-demo@0.1.1-rc.2` subgraph still declares `^0.1.1-rc.2`/`^0.1.2-alpha.2` peers. pnpm filled those with 0.1.1/0.1.2 previews, which do not carry the exports the 0.1.7 host packages import — `assertNever` from `dsh-llm`, `longEdgeDimensions` from `dsh-attachment`, `SessionAlreadyExistsError` from `dsh-session-persistence`, the `dsh-subprocess/control` subpath — so four rows of the shipped `eval/cordis.yml` failed to IMPORT and `dsh-eval` booted a composition with **7 of 18 entries inactive**. The 18 old `0.1.2-alpha.2` compatibility override rows are replaced by 57 rows pinning every `@deepseek-ai/dsh-*` peer to `0.1.7-alpha.1`. Verified by booting `eval/cordis.yml` through `@deepseek-ai/dsh-app-boot` in a scratch `DSH_HOME`: before, `approval`/`commands`/`subagents`/`sessionProjections` up and `sessions`/`autoReviewRuntime` absent; after, every service present and no inactive entry. No row is added for a package the host has deleted (`dsh-agent-presets`, `dsh-code-runtime`) — pnpm could not resolve it.
- Pin the `@deepseek-ai/dsh-*` dev/test dependencies and runtime `dependencies` to the published `0.1.7-alpha.1` line (only `dsh-agent-spine-demo` stays on `0.1.1-rc.2`, which has no 0.1.7 release and no longer constrains anything: it declares no dependency on the renamed presets package). Raise `@deepseek-ai/cordis` `^4.0.2`→`^4.0.3`, `@deepseek-ai/schemastery` (dependency + devDependency) `^3.18.2`→`^3.18.3`, `@deepseek-ai/cordis-plugin-loader` `^1.0.3`→`^1.0.4`, `@deepseek-ai/cordis-plugin-include` `^1.0.7`→`^1.0.8`, and add `@deepseek-ai/cordis-plugin-group` `^1.0.3`: the `0.1.7-alpha.1` host packages declare exactly those peers, and the lockfile had resolved the older versions. Verified after install: `cordis 4.0.3`, `schemastery 3.18.3`, `cordis-plugin-loader 1.0.4`, `cordis-plugin-include 1.0.8`, `cordis-plugin-group 1.0.3`; `pnpm peers check` reports no issues. A raised floor is strictly narrower, so no supported host line is dropped.
- Add a fourth `engines.dsh` and `peerDependencies` range segment, `|| >=0.1.7-0 <0.2.0`. This is a BUG FIX, not a narrowing: npm's prerelease rule admits a prerelease only into a comparator set whose own tuple carries a prerelease, so the previous `>=0.1.6-0 <0.2.0` segment **did not cover `0.1.7-alpha.1` itself**. The earlier segments are unchanged, so `0.1.2-rc.1`, `0.1.3-alpha.2`, `0.1.5-rc.x`, and `0.1.6-alpha.x` stay supported.
- **Explicit deviation from the `0.1.5-rc.3` pin: the `@deepseek-ai/dsh-*` line is `0.1.7-alpha.1`.** `0.1.5-rc.3` is the *old-contract* next line — it still carries `kind: 'plugin'` message sources, the `tool-result` wrapper block, and `dsh-settings-file` — so adapting to it would produce code that cannot compile or run against the `0.1.7-alpha.1` host this package targets. `0.1.7-alpha.1` is the only published line carrying the contracts this package now consumes.

### Fixed

- **The three Loader negative regressions were silently passing.** Under loader `1.0.4` + cordis `4.0.3` a row whose config is rejected no longer rejects `loader.await()`: the loader reports it through `ctx.logger.error` and its tree waits with `Promise.allSettled`, so the error stays on that row's fiber while the composition returns normally — and a minimal composition has no log sink, so even the report is swallowed. The runner then fell through to its own downstream check and exited with `Loader composition: /auto-review command is missing from the commands registry`, which the loose assertion regexes accepted. `scripts/loader-runner.mjs` now re-throws the first `FiberState.FAILED` row's recorded error (value mirror `3`, since cordis declares it as a `const enum`). Measured before/after on the same invalid config, with the re-throw disabled by an env flag the runner honours for exactly this re-measurement: silent → `command is missing`; loud → `invalid config: - $.toolsPolicy.default expected "ai" | "human" | "never" but got "bogus" (at toolsPolicy.default)` and `reviewerTimeoutMs must be a positive safe integer, got 0`. A new regression guard in `test/composition.spec.ts` asserts both sides, so the re-throw cannot be dropped without a red test.

### Added

- `test/session-message.spec.ts` covers the V4 and released-V3 tool-result shapes at their own seam (normalization, the `source.callId` fallback, non-result rows, text joining, and the two failure signals); `test/eval/trace.spec.ts` gained V3-wrapper and `forked` cases; `fixtures/sessions/valid-deny-verdict-v3.json` replays the valid deny chain in the released shape.

## [0.12.6] - 2026-09-19

### Added

- `pnpm run check:lockfile` (`scripts/check-lockfile-drift.mjs`) fails fast when `package.json` and `pnpm-lock.yaml` disagree; the documented checks chain runs it alongside the other gates.

### Changed

- The release workflow now publishes through **npm trusted publishing** (OIDC) instead of the long-lived `NPM_TOKEN` secret: `setup-node` no longer sets `registry-url` (its empty `_authToken` line made the registry answer 404), and the "NPM_TOKEN is not set -> fail" guard is gone so the OIDC exchange is the only path. pnpm performs the OIDC exchange itself.

### Changed

- **Raise the pinned harness line from `0.1.5-rc.2` to `0.1.6-alpha.2`** (31 `@deepseek-ai/dsh-*` pins across `dependencies` and `devDependencies`; only `dsh-agent-spine-demo` stays on `0.1.1-rc.2`, as it has no alpha.2 release). The old pin was not merely cosmetic: on an alpha.2 host the hoisted `dsh-home-paths` came from the rc.2 line and lacks `dshCachePath`, which the alpha.2 host packages (`dsh-attachment-local`) import at module scope, so a scratch profile booted with `SyntaxError: The requested module '@deepseek-ai/dsh-home-paths' does not provide an export named 'dshCachePath'`. The lockfile now resolves a single `dsh-home-paths@0.1.6-alpha.2`. Feature detection for older host lines is untouched.

## [0.12.5] - 2026-09-18

### Changed

- Land the eval fixtures on the alpha.2 model vocabulary: `eval/cordis.yml` and `eval/cases/demo.yaml` (plus the five README run examples) now name `deepseek-flash` instead of the removed `deepseek-v4-flash` id, and the compatibility row admits the `>=0.1.6-0 <0.2.0` peer segment.
- Declare `dsh.manifestVersion: 1` and the canonical three-clause `engines.dsh` (G-3).

### Notes

- The A2 wrapper static assertion (a lint rule proving `src/session-events.ts` stays the only `snapshotEvents()` call site) is **not yet enforceable here**: this repo lints with oxlint (96 rules, no `typescript/no-deprecated` rule configured), so the card's precondition does not hold. The single call site is unchanged and documented; the assertion can land once the rule is enabled.
- The resume round-trip criterion (`check-session-log.mjs` over a real log) still needs a real host log; the audit gate contract plus the existing regression tests pin the no-unmarked-append invariant in the meantime.

## [0.12.4] - 2026-09-12

### Fixed

- Correct the host-capability documentation that claimed a later harness line could stamp the `ignorable` envelope marker from `Session.append`. **No published line can**, and the code was right all along. Verified three ways: the host source (`packages/core/session/src/index.ts:710-738` — the optional third parameter is `SurfaceIntent`, accepted for surface event types only, and the envelope is assembled from `{ type, seq, time, data }` plus `surfaceOp`/`sourceEventSeqs` alone), every relevant published tarball (`0.1.0-rc.2/3/6/7/8`, `0.1.1-rc.1/2`, `0.1.2-alpha.2–alpha.5`, `0.1.2-rc.1`, `0.1.3-alpha.2`, `0.1.5-rc.1`, `0.1.5-rc.2` — all build the same envelope), and a live append against the host's own built `Session` on the `0.1.5-rc.2` line, which returns keys `["type","seq","time","data"]` with `ignorable` undefined. The marker is reachable only through the seed/restore path, i.e. it is written by the harness that owns the log, never by a plugin appending to it. `isUnmarkedHostVersion` returning `true` for the whole published 0.1.x range is therefore accurate and not an over-reach; it is now pinned by a test so a future "narrow the bound" change cannot silently become the log pollution the guard exists to prevent. Reported with the opposite diagnosis on issue #38.
- Rewrite the `auditDisabledNotice` (EN + ZH), the `warnUnmarkedAuditHost` warning, the `allowUnmarkedAudit` config doc, and the AGENTS.md audit bullet so they no longer say the host "predates" the marker or that unmarked events break resume only "on stricter harness builds". The unmarked event is refused by `validateStoredEvents` on **every** validating harness, reached from the ordinary local jsonl load path — and `allowUnmarkedAudit: true` is now stated as what it is: a switch that makes those sessions unloadable, not a compatibility workaround. The previous wording led a user to recommend it publicly as safe on `0.1.5-rc.2`.
- Add a regression test that calls the installed peer's real `Session.append` with `{ ignorable: true }` on an out-of-tree type and asserts the returned envelope carries no marker, plus a table test over every published 0.1.x version string.

## [0.12.3] - 2026-09-12

### Changed

- Rename the four translated READMEs to `README-<lang>.md`. npm selects the package-page readme as the first markdown file matching its `{README,README.*}` glob (`@npmcli/package-json`, publish path), and that glob order puts `README.<lang>.md` ahead of `README.md` — so npm was serving the Simplified-Chinese file for this package too (measured on 15/15 sampled packages of the family). The new names sit outside the glob, so the English source is served again. No content changed apart from the language-switcher link each translation holds to its siblings, and the repo readme gate still passes. Takes effect with the next release; an already-published version cannot gain a corrected readme retroactively.
- Pin the `@deepseek-ai/dsh-*` dev/test dependencies to the published `0.1.5-rc.2` line and record `0.1.5-rc.2` in `dshWorkshop.compatibility.dshVersions`; the monthly Compat workflow now runs against `0.1.5-rc.2`. The peer range `>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0` is unchanged, so no supported host line is dropped.

## [0.12.2] - 2026-09-10

### Changed

- Pin the `@deepseek-ai/dsh-*` dev/test dependencies to the published `0.1.5-rc.1` line and record `0.1.5-rc.1` in `dshWorkshop.compatibility.dshVersions`; the monthly Compat workflow now runs against `0.1.5-rc.1`. The peer range `>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0` is unchanged, so no supported host line is dropped.

### Docs

- Refresh the five-language README compatibility baseline to `dsh-v0.1.5-rc.1` (verified 2026-09-10).

## [0.12.1] - 2026-09-09

### Fixed

- Runtime `dependencies`: all 15 `@deepseek-ai/dsh-*` pins moved from `0.1.2-rc.1` to `0.1.5-alpha.1`. Installing the `0.12.0` tarball into a `dsh@0.1.5-alpha.1` web profile hoisted that pinned `0.1.2-rc.1` tree (`dsh-session-persistence-jsonl`, `dsh-app-boot`, `dsh-tool-fs`, …) over the CLI's own `0.1.5-alpha.1` tree, and the next `dsh web` died at boot with `failed to import loader entry session-persistence-jsonl (@deepseek-ai/dsh-session-persistence-jsonl): The requested module '@deepseek-ai/dsh-session-persistence' does not provide an export named 'DEFAULT_PREPARED_SESSION_CACHE_SIZE'`. The runtime pins now follow the alpha line the published CLI installs, so a profile install no longer shadows the host tree. Reproduced and re-verified with `pnpm pack` + `dsh plugin --profile web add <tgz>` + `dsh web` against a scratch `DSH_HOME`: the pre-fix tarball crashes at boot, the fixed tarball boots and serves.
- `pnpm-lock.yaml` refreshed for the new pins (`pnpm install --no-frozen-lockfile`).

### Changed

- Peer ranges stay the dual-line `>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0` and `dshWorkshop.compatibility.dshVersions` still lists `0.1.2-rc.1`, `0.1.3-alpha.2`, and `0.1.5-alpha.1`: the plugin's code keeps feature-detecting both published host lines; only the *installed* runtime dependency pins follow the alpha line.

### Docs

- Five-language READMEs: the Harness row now states runtime deps `0.1.5-alpha.1` and why the pins follow the alpha line.
- `AGENTS.md` and the `pnpm-workspace.yaml` pin comment: the stale "runtime `dependencies` stay on the published `0.1.2-rc.1` line" statements replaced with the alpha-line pin.

## [0.12.0] - 2026-09-09

### Fixed

- dsh-eval session artifacts (`traces/*.session.jsonl`) are replayable on the 0.1.3+/V3 line again: the header line now emits the seed vocabulary of the header's own format version — `isSeeded` (and never the retired V0 `seedLength`) for V2/V3, `seedLength` for V0 — so the harness format catalog reads the artifact as a current header instead of refusing it as malformed. Previously a V3 artifact carried `version: 3` without `isSeeded` (and `seedLength` whenever an inherited count was present), which the persistence reader rejects.
- `src/eval/trace.ts`: the traced system prompt is read from the last non-empty `system/message` surface node on the 0.1.5 line (the prompt moved into the message history as surface node zero) while `request/header.header.system` remains the source on the 0.1.2/0.1.3 lines, so the prompt-baseline assertions keep working on both published lines.
- `scripts/check-host-versions.mjs`: the peer-range parser now splits `||` unions and judges every segment, so the dual-line peers (`>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0`) are recognized; the alpha-line check accepts an alpha peer segment in addition to the dev pins. The gate previously exited 1 with `no rc-pinned @deepseek-ai/dsh-* peers found`, which made the `host-compat` CI job permanently red.
- `src/eval/report.ts`: the Markdown footer no longer claims unconditional replayability; it states the line-specific header vocabulary.

### Changed

- Dev pins moved to `@deepseek-ai/dsh@0.1.5-alpha.1` (every `@deepseek-ai/dsh-*` devDependency that publishes the line; `@deepseek-ai/dsh-agent-spine-demo` stays on `0.1.1-rc.2`), including the new `@deepseek-ai/dsh-session-format-catalog@0.1.5-alpha.1` used by the artifact-replay tests; peer ranges are the dual-line `>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0`; runtime `dependencies` stay on the published `0.1.2-rc.1` line.
- `src/audit.ts`: `0.1.5-alpha.1` joins the known-unmarked host lines (V3 format; `Session.append` still has no marker channel), so session-log audit stays fail-closed there.
- `dshWorkshop.compatibility.dshVersions` now lists `0.1.5-alpha.1`; `.github/workflows/compat.yml` profile pins moved from the unsupported `0.1.1-rc.2` (below the peer floor) to `0.1.5-alpha.1`.

### Tests

- New `test/eval/session-artifact.spec.ts` (L6/U6): the rendered artifact replays through `@deepseek-ai/dsh-session-format-catalog` (`readHeader` + `createRestore().finish()`), a V0-line header stays readable with its seed semantics, and malformed V3 fixtures (missing `isSeeded`, retired `seedLength`, non-boolean `isSeeded`), a newer-format header, a V3 body behind a V2 header, and an unmarked unknown `autoReview/*` event are refused instead of silently misread.
- `test/eval/runner.spec.ts` asserts the runner's own artifact header against the installed format catalog; `test/audit.spec.ts` covers the `0.1.5-alpha.1` version line.

### Docs

- Five-language READMEs: the Harness row now names `dsh-v0.1.5-alpha.1` (verified 2026-09-09), the dev pin `0.1.5-alpha.1`, and the dual-line peer range; the `allowUnmarkedAudit` row and the session-log bullet list `0.1.5-alpha.1` among the non-stamping lines.
- `AGENTS.md`: corrected the stale test-peer statement and the host-version gate description (compound `||` peer ranges and the alpha peer segment).

## [0.11.0] - 2026-09-08

### Changed

- Migrate the dev pins from `@deepseek-ai/dsh@0.1.2-rc.1` to `@deepseek-ai/dsh@0.1.3-alpha.2` (all 15 `@deepseek-ai/dsh-*` devDependencies; `@deepseek-ai/dsh-agent-spine-demo` stays on `0.1.1-rc.2`). Dual-line runtime compatibility is preserved: the runtime `dependencies` and the `>=0.1.2-rc.1 <0.2.0` peer range stay on the published rc line, the trace fold reads stream timing from `assistant/chunk` (0.1.2) or the message's timed `stream` (0.1.3, including the new `assistant/attempt` settlement records), and the session-artifact renderer feature-detects the removed `packChunkRuns` export.
- Test fixtures now stamp headers with the host line's `SESSION_FORMAT_VERSION` (0 on 0.1.2, 2 on 0.1.3) instead of the literal `0`, and the fake-session header carries `isSeeded`; the reviewer/isolation suites pass on both published lines (278/278 each).
- `src/audit.ts`: `0.1.3-alpha.2` joins the known-unmarked host lines (its `Session.append` still assembles the envelope without the `ignorable` marker, and `autoReview/*` is still absent from `KNOWN_SESSION_EVENT_TYPES` — verified against the published tarball), so session-log audit stays fail-closed on the alpha line; unit tests cover both lines.
- `scripts/check-host-versions.mjs`: the `0.1.3-alpha.2` stay-behind exemption is removed — the migrated dev pins now cover the newest alpha line natively.
- `dshWorkshop.compatibility.dshVersions` and the five-language READMEs now state both supported host lines (`0.1.2-rc.1` and `0.1.3-alpha.2`).

## [0.10.6] - 2026-09-07

### Fixed

- Dual-line session-log compatibility for dsh-eval: the trace folds derive per-step stream timing from `assistant/chunk` (0.1.2 line) or the message's timed `stream` records (0.1.3 line), and the session-artifact renderer feature-detects the 0.1.2-only `packChunkRuns` export; both published host lines keep their existing behavior.
- The host-version gate now carries a documented stay-behind for `@deepseek-ai/dsh@0.1.3-alpha.2` (whose session vocabulary dropped `assistant/chunk`/`packChunkRuns`) until the dev pins migrate; the shipped pins stay on the published rc line.

### Docs

- Fix the DSH plugin badge URL: shields.io rejects the four-segment static badge form with "404 badge not found"; the label now uses the documented double-dash form (`dsh--plugin`), rendering identically; no behavior change.


## [0.10.5] - 2026-09-07

### Docs

- Refresh the five-language README support-version wording: the verified GitHub tag `dsh-v0.1.3-alpha.1` now leads the compatibility claim, while npm `0.1.2-rc.1` stays the published dependency-pin line (peers `>=0.1.2-rc.1 <0.2.0`); no behavior change.


## [0.10.4] - 2026-09-05

### Fixed

- `peerDependencies`: all 14 `@deepseek-ai/dsh-*` peer ranges moved from `>=0.1.0-rc.8 <0.2.0` to `>=0.1.2-rc.1 <0.2.0`. The old range matched only the `0.1.0-rc.8` line under bare (registry-driven) resolution while the `0.1.2-rc.1` production dependency wave demands `^0.1.2-rc.1` peers, so `pnpm install` of the packed tarball failed with `ERR_PNPM_NO_MATCHING_VERSION` (npm fell back to an ERESOLVE override). The range now resolves the `0.1.2-rc.1` line that the package actually ships against.

## [0.10.3] - 2026-09-04

### Changed

- All `@deepseek-ai/dsh-*` runtime `dependencies` and dev pins moved from the published `0.1.2-alpha.5` line to `0.1.2-rc.1`; `@deepseek-ai/dsh-agent-spine-demo` stays on `0.1.1-rc.2` (no newer spine line is published).
- `src/audit.ts`: `isUnmarkedHostVersion` now classifies the `0.1.2-rc.x` line as non-stamping (it ships the alpha.5 surface: the third append parameter is `SurfaceIntent` for surface event types only). Previously `0.1.2-rc.1` fell through the rc bound and was probed as marker-aware, which re-enabled session-log audit, broke the per-turn budget fold, and risked appending unmarked verdict events.
- `scripts/check-host-versions.mjs`: a dev pin on the rc line now counts as covering the npm alpha line (rc outranks alpha within the same minor), keeping the host-compat job green after the bump.
- Five-language READMEs: the harness table row now states `0.1.2-rc.1`.

## [0.10.2] - 2026-09-03

### Changed

- Runtime `dependencies` moved from the `0.1.1-rc.2` line to the published `0.1.2-alpha.5` line (15 packages); `@deepseek-ai/dsh-agent-spine-demo` (removed from the alpha.5 line) moved to devDependencies at `0.1.1-rc.2` — it is used only by the eval profile (`eval/cordis.yml`).
- Dev pins `@deepseek-ai/cordis-plugin-loader ^1.0.3` / `@deepseek-ai/cordis-plugin-include ^1.0.7` aligned with the `cordis 4.0.2` peer ranges.
- Five-language READMEs: the harness table row now states `dependencies pinned to 0.1.2-alpha.5`.

## [0.10.1] - 2026-09-02

### Docs

- Sync the five-language READMEs to the 0.1.2-alpha.5 facts; no behavior change.

## [0.10.0] - 2026-09-02

### Changed

- Align the devDependency pins to the published dsh 0.1.2-alpha.5 line and re-verify the adaptation claims; no behavior change.

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
