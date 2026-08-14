# Ruling policy template for `reviewerPolicyText`

Paste this block (edited) into the `reviewerPolicyText` config key. The text is
injected into the reviewer prompt as the ruling policy and takes precedence
over the general verdict rules. It is natural-language Markdown — test it
thoroughly before deploying.

```yaml
reviewerPolicyText: |
  ## Security review policy

  ### Always deny
  - Any `rm -rf`, `git push --force`, or destructive filesystem command outside the workspace
  - Any command that transmits secrets or credentials to untrusted endpoints
  - Any modification of files matching **/.git/** or **/.env**

  ### Always allow
  - Read-only commands (`ls`, `cat`, `find`, `grep`) inside the workspace
  - Test commands (`pnpm test`, `vitest run`) inside the workspace
  - Git operations limited to the current worktree (no push, no force)

  ### Require justification
  - Dependency changes (`pnpm add`, `npm install`)
  - Changes to CI configuration files (.github/workflows/*)
  - Modifications to authentication or authorization code

  ### Risk levels
  - low: routine, reversible, workspace-scoped
  - medium: touches configuration or dependencies
  - high: destructive, irreversible, or outside the workspace — prefer deny
```
