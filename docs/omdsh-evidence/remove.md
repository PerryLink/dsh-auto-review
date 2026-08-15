# Remove evidence — dsh-auto-review (author-run, 2026-08-15)

Author-executed evidence for the `dshWorkshop.evidence.remove` path. This is an
**author record**, not Workshop verification.

## What was executed, for real

The temporary profile `ar-selftest` (see `install.md`) was booted **without**
the `--patch` insert row that mounts the plugin — the profile's composition no
longer references `auto-review` at all:

```
$ pnpm dsh --profile ar-selftest --dump-config
(no auto-review / dsh-auto-review rows in the dumped composition)

$ pnpm dsh --profile ar-selftest "say ok"
ok
(exit 0)
```

A real model turn then completed on the same profile with the plugin row
removed: no residual service, command, or listener — boot is clean and the
profile behaves exactly like the base + headless composition.

## What was NOT executed

- The Workshop adapter's own remove step inside its transactional lifecycle
  (with generation tracking and rollback assertions) — that remains the
  maintainer run that can flip the dimension to Verified.
