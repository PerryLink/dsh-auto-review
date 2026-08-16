#!/usr/bin/env node
// dsh-eval: the dsh-auto-review evaluation CLI. Thin launcher over the
// bundled eval-cli face; the build produces lib/eval-cli.js.
import { main } from '../lib/eval-cli.js'

process.exitCode = await main()
