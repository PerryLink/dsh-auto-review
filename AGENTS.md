# AGENTS.md

Standalone DeepSeek Harness plugin repository (`dsh-auto-review`). Development follows the dsh-plugin-guide skill and the official plugin contract; this file records repo-local decisions.

## Layout

- `src/index.ts` — function-plugin contract (`name`/`inject`/`Config`/`apply`; NO default export — the Loader unwraps `exports.default ?? exports`).
- `src/config.ts` — Schemastery schema + explicit `resolveConfig` (no hidden `?? default` in `run()` paths).
- `src/runtime.ts` — `approval/request` answerer, `tools/post-execute` deny-reason injection, `/auto-review` command.
- `src/review.ts` — reviewer subagent orchestration, prompt, sanitization, verdict parsing.
- `src/events.ts` — `autoReview/state` + `autoReview/verdict` SessionEventMap members (declaration merging), pure folds, and the `StateAppend`/`VerdictAppend` surfaces that request the envelope's `ignorable: true` marker.
- `src/invariant.ts` — invariant companion, exported as `dsh-auto-review/invariant`. Shipped commented-out in the bundle patch: it needs the `invariants` service, which spine compositions (headless/ACP) provide but the plain web profile does not.
- `test/` — vitest; real `Context` + real `Session`/`ApprovalService`/`InvariantRegistry` from the `0.1.0-rc.6` peers, scripted subagent/commands/tools mocks.
- `fixtures/` — replayable session logs (invariant specs) + config examples.

## Hard rules applied here

- Waterfall listeners (`approval/request`, `tools/post-execute`) always call `next()` unless they claim the request.
- Model-visible ⟺ logged: the only model-visible plugin content is the injected deny reason (`[auto-review]` marker) and the injected fallback-rejection text (`[auto-review-fallback]` marker); both embed the verdict `reviewId` marker and the invariant companion enforces marker ⟺ verdict.
- Log-only audit: `autoReview/state` and `autoReview/verdict` are appended with `{ ignorable: true }` via the `StateAppend`/`VerdictAppend` surfaces (rc.6 hosts ignore the options bag — same event, no marker; post-rc.6 hosts stamp the marker so any build loads the log).
- Fail closed: every reviewer failure path resolves through `fallbackPolicy`, default `rejected`.
- The `never` approval policy is enforced inside the core service; this plugin never tries to bypass it.
- No agent-loop changes; the plugin only uses documented seams (approval answerer, subagents, commands, tools/post-execute, invariants).

## Build

`scripts/prepare.mjs` is the single build entry (tsc declarations → `lib/types`, tsdown bundles → `lib/index.js` + `lib/invariant.js`). `typescript` + `tsdown` are regular `dependencies` so the git channel's isolated prepare environment always has them. The repo's own `pnpm-workspace.yaml` declares `allowBuilds: { esbuild: true }`: pnpm's isolated prepare env for git-hosted packages reads the dependency's shipped workspace file, and without that entry both local installs and git installs fail with `ERR_PNPM_IGNORED_BUILDS` on esbuild's (harmless platform-binary validation) postinstall — verified live against the published repo. The package.json `pnpm` field is NOT usable for this: pnpm 11 ignores it. Git users still need the single `allowBuilds` key for `dsh-auto-review` itself, which the `dsh` CLI prints verbatim.

## Docs

- Five-language READMEs (`README.md`, `README.zh.md`, `README.es.md`, `README.pt.md`, `README.hi.md`) — keep all five in sync; the English file is the source of truth.
- `CHANGELOG.md` documents every behavior change per version (the release notes live in `RELEASE.md` for the initial release).
- When the repo is published on GitHub, set topics `dsh`, `dsh-plugin`, `deepseek-harness`, `deepseek`, `cordis`, `ai-safety`, `approval`, `sandbox`, `subagent`, `llm` (the ecosystem's visibility channel is the `dsh-plugin` topic; see dsh-plugin-guide §9).

## Checks

`pnpm run typecheck && pnpm test && pnpm run build && pnpm run verify:self-contained && pnpm pack`.

`scripts/check-host-versions.mjs` (run by the CI job `host-compat`) fails when the exact-pinned `@deepseek-ai/dsh-*` peers no longer match the npm `latest` of `@deepseek-ai/dsh` — bump the pins (or document a deliberate stay-behind) before publishing.

## Publishing

After a version bump, repack the sibling integration tarball for `dsh-permission-rules` (`pnpm --dir ../dsh-auto-review pack --pack-destination ../dsh-permission-rules/vendor`) and update its `file:` devDependency to the new filename, then rerun its test suite.
