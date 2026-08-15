## Checklist

- [ ] CI gates pass locally — `pnpm run typecheck && pnpm test && pnpm run build && pnpm run verify:self-contained && pnpm pack` (CI re-runs them, plus the packed-artifact smoke install)
- [ ] Tests added or updated for the behavior change (or a note in the description why none are needed)
- [ ] CHANGELOG.md updated under the upcoming version
- [ ] Multi-language READMEs kept in sync — `README.md` is the source of truth; `README.zh.md` / `README.es.md` / `README.pt.md` / `README.hi.md` follow
- [ ] Related issue linked (e.g. `Fixes #123`)
- [ ] No secrets, tokens, credentials, or personal data in the diff

## Notes for reviewers

<!-- Anything a reviewer should know: scope, migration notes, deliberate stay-behinds. -->
