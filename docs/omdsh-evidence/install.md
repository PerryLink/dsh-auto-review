# Install evidence — dsh-auto-review (author-run, 2026-08-15)

Author-executed evidence for the `dshWorkshop.evidence.install` path. This is an
**author record**, not Workshop verification: the Workshop's own adapter run on
the current baseline (`@deepseek-ai/dsh@0.1.0-rc.6`) is the only thing that can
flip the intake dimension to Verified.

## What was executed, for real

1. **Published artifact installs from the registry** — `dsh-auto-review@0.4.0`
   is published on npm (`latest`). The packed tarball was installed into a
   scratch project and its node faces were loaded through the package exports:

   ```
   $ node scripts/smoke-package.mjs out
   added 54 packages in 4s
   smoke-package: node faces load, exports resolve, artifact contents verified
   ```

2. **Real headless profile boot with the plugin mounted** — a clean temporary
   profile (`ar-selftest`: `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless`
   bundles, `dsh-auto-review@0.4.0` installed as a profile dependency) was booted
   with the plugin row injected via `--patch` (Windows has no process
   substitution, so a temporary patch file was used):

   ```yaml
   # ar-selftest-patch.yml
   - insert:
       - id: auto-review
         name: dsh-auto-review
   ```

   ```
   $ pnpm dsh --profile ar-selftest --patch ar-selftest-patch.yml "hi"
   Hi! I'm your coding agent, ready to help with the DeepSeek Harness repo
   (working directory `D:\deepseek-harness`). What would you like to work on?
   (exit 0)
   ```

   A real model turn completed with the plugin mounted — no PENDING row, no
   boot error. `--dump-config` shows the resolved patch row
   (`- id: auto-review / name: dsh-auto-review`).

3. **Repository gates are green on GitHub Actions** (push to `main`,
   2026-08-15): typecheck, 135 vitest tests (node + jsdom projects),
   tsdown build, `verify:self-contained`, `pnpm pack`, and the packed-artifact
   smoke install — on Node 22 and Node 24.

## What was NOT executed

- The Workshop's own transactional lifecycle on the current public baseline
  (install → ready → functional → update → disable → remove → recovery) — that
  requires the maintainer adapter run and is the reason this dimension stays
  Declared until review.
