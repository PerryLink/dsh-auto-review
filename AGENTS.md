# AGENTS.md

Standalone DeepSeek Harness plugin repository (`dsh-auto-review`). Development follows the dsh-plugin-guide skill and the official plugin contract; this file records repo-local decisions.

## Layout

- `src/index.ts` — function-plugin contract (`name`/`inject`/`Config`/`apply`; NO default export — the Loader unwraps `exports.default ?? exports`).
- `src/config.ts` — Schemastery schema + explicit `resolveConfig` (no hidden `?? default` in `run()` paths).
- `src/runtime.ts` — `approval/request` answerer, `tools/post-execute` deny-reason injection, `/auto-review` command.
- `src/review.ts` — reviewer subagent orchestration, prompt, sanitization, verdict parsing.
- `src/isolation.ts` — the reviewer child's context firewall: the `ReviewerChildren` registry (prompt announcement before `subagents.start`, id latch afterwards — the child's first step races the start's resolution) and the `agent/pre-step` allow-list over message SOURCES that keeps injected context (workspace instruction files, the loop's runtime-context snapshot, third-party injections) out of the reviewer's steps.
- `src/events.ts` — `autoReview/state` + `autoReview/verdict` + `autoReview/circuit` + `autoReview/override` + `autoReview/rejection` SessionEventMap members (declaration merging), pure folds, the `StateAppend`/`VerdictAppend`/`CircuitAppend`/`OverrideAppend`/`RejectionAppend` surfaces that request the envelope's `ignorable: true` marker, and the marker-free `plain*ResultText` builders for audit-disabled hosts.
- `src/call-id.ts` — dual-ruler call-id brand (`ToolExecution['callId']` from `dsh-tools`): host master renamed the dsh-llm `CallId` brand to `ToolCallId`, so the package derives the brand locally instead of naming either line's brand.
- `src/audit.ts` — host `ignorable`-marker capability detection (`isMarkedAuditEvent`, `isUnmarkedHostVersion`, `peerSessionVersion`), the shared seam every audit append gates on.
- `src/messages.ts` — `/auto-review` command strings in `en`/`zh` (the `language` config selects the table).
- `src/projection.ts` + `src/projection-types.ts` — the `autoReview` session-projection unit (host fold + wire schema) and its pure-type outlet (zero value imports, so client programs never drag the host chain). Registered in `apply` whenever the host provides the session-projection capability (feature-detected: the answerer must work without it).
- `src/client/` — browser half: the session-header review panel (`ReviewPanel.tsx`), locale dictionaries, scoped stylesheet, and the client-plugin entry (contract: `name` = package name, `inject`, `apply(ctx)`; the bundle follows the shell's `window.__ModuleLoader__.load` handshake).
- `src/invariant.ts` — invariant companion, exported as `dsh-auto-review/invariant`. Shipped commented-out in the bundle patch: it needs the `invariants` service, which spine compositions (headless/ACP) provide but the plain web profile does not.
- `test/` — vitest; real `Context` + real `Session`/`ApprovalService`/`InvariantRegistry` from the pinned `0.1.5-rc.2` dev peers (the runtime `dependencies` follow the same `0.1.5-rc.2` line since 0.12.1 — pinning `0.1.2-rc.1` there hoisted that tree over a `0.1.5-alpha.1` CLI profile and crashed boot; both published host lines are still handled by feature detection), scripted subagent/commands/tools mocks.
- `fixtures/` — replayable session logs (invariant specs) + config examples.

## Hard rules applied here

- Waterfall listeners (`approval/request`, `tools/post-execute`) always call `next()` unless they claim the request.
- Model-visible ⟺ logged: the only model-visible plugin content is the injected deny reason (`[auto-review]` marker), the fallback-rejection text (`[auto-review-fallback]`), the circuit rejection (`[auto-review-circuit]`), the hard-disable text (`[auto-review-never]`), and the switch/circuit notice messages; each embeds its id marker and the invariant companion enforces marker ⟺ recorded event. On hosts whose audit envelope cannot be written the injected texts are the MARKER-FREE `plain*ResultText` variants (the logged tool result is the audit), so the invariant stays vacuous instead of failing.
- Log-only audit: `autoReview/*` events are appended with `{ ignorable: true }` via the typed append surfaces. **No published `Session.append` can write the marker** (verified 2026-09-12 against the host source, every relevant published tarball, and a live append on `0.1.5-rc.2`: the optional third parameter is `SurfaceIntent`, accepted for surface event types only, and the envelope is assembled from `{ type, seq, time, data }` plus `surfaceOp`/`sourceEventSeqs` alone — the option is silently dropped). An unmarked `autoReview/*` event therefore breaks resume on ANY harness that validates stored events, so such hosts are detected BEFORE the first append — installed-peer version pre-check against the known-unmarked lines, then a probe of the first appended envelope's return value — and session-log audit is disabled with a one-time warning: the in-memory mirror (`SessionMemory`) keeps budgets, the circuit breaker, the `/auto-review on|off` override, and `approve` working for the session lifetime, with marker-free feedback. The persistence read path fails closed on unmarked unknown event types (`autoReview/*` is not in `KNOWN_SESSION_EVENT_TYPES`), so every published line — and unresolvable peer versions — fail closed BEFORE any append (the probe only runs for a recognized marker-aware FUTURE line; none has shipped). `allowUnmarkedAudit: true` forces unmarked appends anyway and makes those sessions unloadable — it is not a compatibility workaround; already-written logs are repaired with `scripts/repair-session-logs.mjs` from `dsh-permission-rules` (its default target set covers all five `autoReview/*` types).
- Fail closed: every reviewer failure path resolves through `fallbackPolicy`, default `rejected`.
- The `never` approval policy is enforced inside the core service; this plugin never tries to bypass it.
- No agent-loop changes; the plugin only uses documented seams (approval answerer, subagents, commands, tools/post-execute, invariants).

## Build

`scripts/prepare.mjs` is the single build entry (tsc declarations → `lib/types`, tsdown bundles → `lib/index.js` + `lib/invariant.js` + `lib/client.js`; the client bundle carries the `window.__ModuleLoader__.load` handshake). `typescript` + `tsdown` are regular `dependencies` so the git channel's isolated prepare environment always has them; `zod` is bundled into the node face (`noExternal`), keeping the host half self-contained. The repo's own `pnpm-workspace.yaml` declares `allowBuilds: { esbuild: true }`: pnpm's isolated prepare env for git-hosted packages reads the dependency's shipped workspace file, and without that entry both local installs and git installs fail with `ERR_PNPM_IGNORED_BUILDS` on esbuild's (harmless platform-binary validation) postinstall — verified live against the published repo. The package.json `pnpm` field is NOT usable for this: pnpm 11 ignores it. Git users still need the single `allowBuilds` key for `dsh-auto-review` itself, which the `dsh` CLI prints verbatim.

## Docs

- Five-language READMEs (`README.md`, `README-zh.md`, `README-es.md`, `README-pt.md`, `README-hi.md`) — keep all five in sync; the English file is the source of truth.
- `CHANGELOG.md` documents every behavior change per version (the release notes live in `RELEASE.md` for the initial release).
- When the repo is published on GitHub, set topics `dsh`, `dsh-plugin`, `deepseek-harness`, `deepseek`, `cordis`, `ai-safety`, `approval`, `sandbox`, `subagent`, `llm` (the ecosystem's visibility channel is the `dsh-plugin` topic; see dsh-plugin-guide §9).

## Checks

`pnpm run typecheck && pnpm test && pnpm run build && pnpm run verify:self-contained && pnpm pack`.

CI (`ci.yml`) additionally proves the packed artifact: `pnpm pack --pack-destination out` followed by `node scripts/smoke-package.mjs out` (installs the tarball into a scratch project and loads the node faces through the package exports; the scratch manifest pins `@deepseek-ai/dsh-scope` / `@deepseek-ai/dsh-typert-protocol` because pnpm's auto-install-peers synthesizes an unsatisfiable stable-anchored spec for the harness's prerelease-only peer chain).

`scripts/check-host-versions.mjs` (run by the CI job `host-compat`) fails when the `@deepseek-ai/dsh-*` peer pins (exact `0.1.x-rc.N`/`0.1.x-alpha.N`, a `>=0.1.x-rc.N <0.2.0` range, or a `||` union of such segments) no longer cover the newest rc line published by `@deepseek-ai/dsh` (on any dist-tag), and when the npm `alpha` line outruns both the alpha peer segments and the dev-pinned alpha — bump the pins (or document a deliberate stay-behind) before publishing.

## Publishing

Releases flow through the `publish` workflow: push a `v<version>` tag matching `package.json` (`prepublishOnly` re-runs the full gate, then the workflow publishes to npm and cuts a GitHub Release). The `NPM_TOKEN` secret must exist on the repo.

After a version bump, repack the sibling integration tarball for `dsh-permission-rules` (`pnpm --dir ../dsh-auto-review pack --pack-destination ../dsh-permission-rules/vendor`) and update its `file:` devDependency to the new filename, then rerun its test suite.

## Workshop intake

`package.json#dshWorkshop` (`omdsh-workshop-package/v1`) declares the omdsh hub intake facts (author declarations only — verification belongs to the hub). Regenerate the v2 submission against the current HEAD with `node scripts/build-omdsh-submission.mjs <full-sha> <out.json>` — it copies `dshWorkshop` verbatim and derives `release.capabilities.restartRequired` from `dshWorkshop.lifecycle.activation` (hub rule: `/^restart-/` → true, `hot-reload`/`immediate` → false; invalid activation values abort the generator). Before filing, reproduce the hub's exact preflight locally against a hub clone (`npm ci --ignore-scripts`): build a `GITHUB_EVENT_PATH` JSON with the final issue body and run `node scripts/prepare-issue-intake.mjs <event.json>` (GITHUB_TOKEN from `gh auth token`, never echoed) plus `npm run check`; both must pass — `npm run intake:validate` alone does not cover issue-level checks. After filing the `[Submission] dsh-auto-review@<version>` issue on `omdsh-dev/dsh-hub-workshop`, watch the triggered `intake` run and the bot comment on the issue; a "preflight failed" comment (自动化插件预检未通过) must be fixed and resubmitted (edit body → close → reopen) in the same round. Author-run evidence lives under `docs/omdsh-evidence/`.
