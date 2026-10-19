# Contributing to dsh-auto-review

Thanks for helping. This project is maintained as a normal member of the PerryLink DSH plugin family.

## Before you open an issue

- Read the README, `PRIVACY.md` (where present), and `TROUBLESHOOTING.md` (where present).
- Include the package version, DSH host version, OS/Node version, the exact tool call, and a minimal redacted input.
- Never paste credentials, tokens, personal data, or sealed evidence bytes.

## Pull requests

- Keep the change focused; explain the user-visible effect and the failure mode it fixes.
- Add or update tests. Run `pnpm run typecheck`, `pnpm test`, and `pnpm run build` before pushing.
- Update the changelog and the five READMEs when behavior or configuration changes.
- Do not include generated credentials, private data, or unrelated formatting churn.
- CI must be green; a maintainer reviews before merge.

## License

By contributing, you agree that your contribution is licensed under the project's
LICENSE (Apache-2.0 for the family, or the upstream license stated in the
repository). See `LICENSE` for the authoritative text.
