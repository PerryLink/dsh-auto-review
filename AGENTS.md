# AGENTS.md

Standalone DeepSeek Harness plugin repository (`dsh-auto-review`). Development follows the dsh-plugin-guide skill and the official plugin contract; this file records repo-local decisions.

## Layout

- `src/index.ts` — function-plugin contract (`name`/`inject`/`Config`/`apply`; NO default export — the Loader unwraps `exports.default ?? exports`).
- `src/config.ts` — Schemastery schema + explicit `resolveConfig` (no hidden `?? default` in `run()` paths).
- `src/runtime.ts` — `approval/request` answerer, `tools/post-execute` deny-reason injection, `/auto-review` command.
- `src/review.ts` — reviewer subagent orchestration, prompt, sanitization, verdict parsing.
- `src/events.ts` — `autoReview/state` + `autoReview/verdict` + `autoReview/circuit` + `autoReview/override` SessionEventMap members (declaration merging), pure folds, and the `StateAppend`/`VerdictAppend`/`CircuitAppend`/`OverrideAppend` surfaces that request the envelope's `ignorable: true` marker.
- `src/messages.ts` — `/auto-review` command strings in `en`/`zh` (the `language` config selects the table).
- `src/projection.ts` + `src/projection-types.ts` — the `autoReview` session-projection unit (host fold + wire schema) and its pure-type outlet (zero value imports, so client programs never drag the host chain). Registered in `apply` whenever the host provides the session-projection capability (feature-detected: the answerer must work without it).
- `src/client/` — browser half: the session-header review panel (`ReviewPanel.tsx`), locale dictionaries, scoped stylesheet, and the client-plugin entry (contract: `name` = package name, `inject`, `apply(ctx)`; the bundle follows the shell's `window.__ModuleLoader__.load` handshake).
- `src/invariant.ts` — invariant companion, exported as `dsh-auto-review/invariant`. Shipped commented-out in the bundle patch: it needs the `invariants` service, which spine compositions (headless/ACP) provide but the plain web profile does not.
- `test/` — vitest; real `Context` + real `Session`/`ApprovalService`/`InvariantRegistry` from the `0.1.0-rc.6` peers, scripted subagent/commands/tools mocks.
- `fixtures/` — replayable session logs (invariant specs) + config examples.

## Hard rules applied here

- Waterfall listeners (`approval/request`, `tools/post-execute`) always call `next()` unless they claim the request.
- Model-visible ⟺ logged: the only model-visible plugin content is the injected deny reason (`[auto-review]` marker), the fallback-rejection text (`[auto-review-fallback]`), the circuit rejection (`[auto-review-circuit]`), and the switch/circuit notice messages; each embeds its id marker and the invariant companion enforces marker ⟺ recorded event.
- Log-only audit: `autoReview/*` events are appended with `{ ignorable: true }` via the `StateAppend`/`VerdictAppend`/`CircuitAppend`/`OverrideAppend` surfaces (rc.6 hosts ignore the options bag — same event, no marker; post-rc.6 hosts stamp the marker so any build loads the log).
- Fail closed: every reviewer failure path resolves through `fallbackPolicy`, default `rejected`.
- The `never` approval policy is enforced inside the core service; this plugin never tries to bypass it.
- No agent-loop changes; the plugin only uses documented seams (approval answerer, subagents, commands, tools/post-execute, invariants).

## Build

`scripts/prepare.mjs` is the single build entry (tsc declarations → `lib/types`, tsdown bundles → `lib/index.js` + `lib/invariant.js` + `lib/client.js`; the client bundle carries the `window.__ModuleLoader__.load` handshake). `typescript` + `tsdown` are regular `dependencies` so the git channel's isolated prepare environment always has them; `zod` is bundled into the node face (`noExternal`), keeping the host half self-contained. The repo's own `pnpm-workspace.yaml` declares `allowBuilds: { esbuild: true }`: pnpm's isolated prepare env for git-hosted packages reads the dependency's shipped workspace file, and without that entry both local installs and git installs fail with `ERR_PNPM_IGNORED_BUILDS` on esbuild's (harmless platform-binary validation) postinstall — verified live against the published repo. The package.json `pnpm` field is NOT usable for this: pnpm 11 ignores it. Git users still need the single `allowBuilds` key for `dsh-auto-review` itself, which the `dsh` CLI prints verbatim.

## Docs

- Five-language READMEs (`README.md`, `README.zh.md`, `README.es.md`, `README.pt.md`, `README.hi.md`) — keep all five in sync; the English file is the source of truth.
- `CHANGELOG.md` documents every behavior change per version (the release notes live in `RELEASE.md` for the initial release).
- When the repo is published on GitHub, set topics `dsh`, `dsh-plugin`, `deepseek-harness`, `deepseek`, `cordis`, `ai-safety`, `approval`, `sandbox`, `subagent`, `llm` (the ecosystem's visibility channel is the `dsh-plugin` topic; see dsh-plugin-guide §9).

## Checks

`pnpm run typecheck && pnpm test && pnpm run build && pnpm run verify:self-contained && pnpm pack`.

CI (`ci.yml`) additionally proves the packed artifact: `pnpm pack --pack-destination out` followed by `node scripts/smoke-package.mjs out` (installs the tarball into a scratch project and loads the node faces through the package exports).

`scripts/check-host-versions.mjs` (run by the CI job `host-compat`) fails when the exact-pinned `@deepseek-ai/dsh-*` peers no longer match the npm `latest` of `@deepseek-ai/dsh` — bump the pins (or document a deliberate stay-behind) before publishing.

## Publishing

Releases flow through the `publish` workflow: push a `v<version>` tag matching `package.json` (`prepublishOnly` re-runs the full gate, then the workflow publishes to npm and cuts a GitHub Release). The `NPM_TOKEN` secret must exist on the repo.

After a version bump, repack the sibling integration tarball for `dsh-permission-rules` (`pnpm --dir ../dsh-auto-review pack --pack-destination ../dsh-permission-rules/vendor`) and update its `file:` devDependency to the new filename, then rerun its test suite.

## Workshop intake

`package.json#dshWorkshop` (`omdsh-workshop-package/v1`) declares the omdsh hub intake facts (author declarations only — verification belongs to the hub). Regenerate the v2 submission against the current HEAD with `node scripts/build-omdsh-submission.mjs <full-sha> <out.json>` (it copies `dshWorkshop` verbatim), validate it with the hub repo's `npm run intake:validate`, then file a `[Submission] dsh-auto-review@<version>` issue on `omdsh-dev/dsh-hub-workshop`. Author-run evidence lives under `docs/omdsh-evidence/`.
