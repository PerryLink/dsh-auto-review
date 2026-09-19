#!/usr/bin/env node
// scripts/check-lockfile-drift.mjs - fail fast when package.json and pnpm-lock.yaml disagree.
//
// Why this exists: the 0.1.6-alpha.2 batch shipped two releases whose `package.json`
// had gained a peer while `pnpm-lock.yaml` had not been regenerated. Nothing in the
// local acceptance chain noticed, so the first thing that failed was the release
// workflow, with `ERR_PNPM_OUTDATED_LOCKFILE` (see the batch report, R22).
//
// `--frozen-lockfile` makes pnpm refuse to rewrite the lockfile and `--lockfile-only`
// keeps it from touching `node_modules`, so this is a read-only probe: exit 0 means the
// two files agree, exit non-zero means someone changed one without the other.
//
// Exit codes: 0 = in sync; 1 = drift (regenerate the lockfile and commit it).

import { spawnSync } from 'node:child_process'
import process from 'node:process'

const result = spawnSync(
  'pnpm',
  ['install', '--frozen-lockfile', '--lockfile-only', '--ignore-scripts'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
)

if (result.status !== 0) {
  console.error('')
  console.error('lockfile drift: package.json and pnpm-lock.yaml disagree.')
  console.error('Fix: `pnpm install --lockfile-only`, then commit the lockfile.')
  process.exit(1)
}

console.log('lockfile ok: package.json and pnpm-lock.yaml agree')
