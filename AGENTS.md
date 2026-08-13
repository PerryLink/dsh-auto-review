# AGENTS.md

Standalone DeepSeek Harness plugin repository (`dsh-auto-review`). Development follows the dsh-plugin-guide skill and the official plugin contract; this file records repo-local decisions.

## Layout

- `src/index.ts` — function-plugin contract (`name`/`inject`/`Config`/`apply`; NO default export — the Loader unwraps `exports.default ?? exports`).
- `src/config.ts` — Schemastery schema + explicit `resolveConfig` (no hidden `?? default` in `run()` paths).
- `src/runtime.ts` — `approval/request` answerer, `tools/post-execute` deny-reason injection, `/auto-review` command.
- `src/review.ts` — reviewer subagent orchestration, prompt, sanitization, verdict parsing.
- `src/events.ts` — `autoReview/state` + `autoReview/verdict` SessionEventMap members (declaration merging) and pure folds.
- `src/invariant.ts` — invariant companion, exported as `dsh-auto-review/invariant`. Shipped commented-out in the bundle patch: it needs the `invariants` service, which spine compositions (headless/ACP) provide but the plain web profile does not.
- `test/` — vitest; real `Context` + real `Session`/`ApprovalService`/`InvariantRegistry` from the `0.1.0-rc.6` peers, scripted subagent/commands/tools mocks.
- `fixtures/` — replayable session logs (invariant specs) + config examples.

## Hard rules applied here

- Waterfall listeners (`approval/request`, `tools/post-execute`) always call `next()` unless they claim the request.
- Model-visible ⟺ logged: the only model-visible plugin content is the injected deny reason; it embeds the verdict `reviewId` marker and the invariant companion enforces marker ⟺ verdict.
- Fail closed: every reviewer failure path resolves through `fallbackPolicy`, default `rejected`.
- The `never` approval policy is enforced inside the core service; this plugin never tries to bypass it.
- No agent-loop changes; the plugin only uses documented seams (approval answerer, subagents, commands, tools/post-execute, invariants).

## Build

`scripts/prepare.mjs` is the single build entry (tsc declarations → `lib/types`, tsdown bundles → `lib/index.js` + `lib/invariant.js`). `typescript` + `tsdown` are regular `dependencies` so the git channel's isolated prepare environment always has them. `package.json` declares `pnpm.neverBuiltDependencies: [esbuild]`: the isolated install of git-hosted packages includes devDependencies (vitest → vite → esbuild), and without that declaration pnpm fails the whole prepare on esbuild's ignored build script (`ERR_PNPM_IGNORED_BUILDS`) — verified live against the published repo. Git users still need the one `allowBuilds` key for `dsh-auto-review` itself, which the `dsh` CLI prints verbatim.

## Docs

- Five-language READMEs (`README.md`, `README.zh.md`, `README.es.md`, `README.pt.md`, `README.hi.md`) — keep all five in sync; the English file is the source of truth.
- When the repo is published on GitHub, set topics `dsh`, `dsh-plugin`, `deepseek-harness`, `deepseek`, `cordis`, `ai-safety`, `approval`, `sandbox`, `subagent`, `llm` (the ecosystem's visibility channel is the `dsh-plugin` topic; see dsh-plugin-guide §9).

## Checks

`pnpm run typecheck && pnpm test && pnpm run build && pnpm run verify:self-contained && pnpm pack`.
