// Builds the omdsh-workshop-submission/v2 JSON for dsh-auto-review.
// packageManifest is read VERBATIM from the repo's package.json so the
// submission can never drift from the pinned manifest.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const repo = 'D:/deepseek-harness/Project/Plugins/dsh-auto-review'
const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'))
const ref = process.argv[2] ?? process.env.PINNED_REF
const updatedAt = new Date().toISOString()

// Hub intake rule (scripts/intake-lib.mjs): for hot-reload/immediate activations
// restartRequired MUST be false; for restart-* activations it MUST be true. A
// single derivation from the repo's own dshWorkshop declaration satisfies both:
// restartRequired === /^restart-/.test(activation). Invalid activation values
// fail loudly here instead of being rejected by the hub preflight.
const VALID_ACTIVATIONS = new Set(['immediate', 'hot-reload', 'restart-plugin', 'restart-profile', 'restart-host'])
const activation = pkg.dshWorkshop?.lifecycle?.activation ?? ''
if (!VALID_ACTIVATIONS.has(activation)) {
  throw new Error(`dshWorkshop.lifecycle.activation "${activation}" is not a supported omdsh value (${[...VALID_ACTIVATIONS].join('|')})`)
}
const restartRequired = /^restart-/.test(activation)

const submission = {
  schema: 'omdsh-workshop-submission/v2',
  operation: 'create-project',
  project: {
    id: 'dsh-auto-review',
    displayName: 'dsh-auto-review',
    summary: 'Second-model AI auto-review on the DeepSeek Harness approval answerer chain: read-only reviewer subagent, structured allow/deny verdicts, fail-closed, fully auditable.',
    kind: 'extension',
    category: 'safety',
    tags: ['auto-review', 'approval', 'ai-safety', 'second-model', 'fail-closed'],
    repository: 'https://github.com/PerryLink/dsh-auto-review',
    path: null,
    author: { name: 'PerryLink', url: 'https://github.com/PerryLink' },
    license: 'Apache-2.0',
    media: null,
  },
  release: {
    version: pkg.version,
    ref,
    updatedAt,
    channel: 'stable',
    compatibility: pkg.dshWorkshop?.compatibility?.dshVersions?.[0] ?? '',
    changelog: '0.4.1 adds the omdsh-workshop-package/v1 dshWorkshop intake manifest plus author-run install/remove evidence; runtime behavior is unchanged from 0.4.0.',
    capabilities: { requiresFabric: false, deepHook: false, restartRequired },
    profileBundle: { packageName: 'dsh-auto-review', spec: pkg.version },
    updateFrom: null,
  },
  management: {
    method: 'profile-bundle',
    protocol: 'harness-profile',
    label: 'dsh-auto-review',
    instructions: 'dsh plugin --profile <name> add dsh-auto-review   # npm channel; or pnpm pack and add the tarball; or git source with the pinned commit',
    source: null,
  },
  declarations: {
    permissions: 'Session-log append (log-only autoReview/* audit events), approval-request answering on the official answerer chain, one read-only reviewer subagent per AI review, /auto-review command registration, tools/post-execute observation. No writes outside the session/profile; no network beyond the reviewer subagent inheriting the session LLM route.',
    testing: '135 vitest tests green (node + jsdom); CI green on Node 22/24 (typecheck/test/build/self-contained/pack/smoke-install); real headless profile boot with the plugin row mounted completed a real model turn (exit 0); removal boot without the row also completed a real turn (exit 0); author evidence files under docs/omdsh-evidence/.',
    trustedPublisherRequested: false,
    installScriptsMustRemainDisabled: true,
  },
  packageManifest: pkg.dshWorkshop,
}

const out = process.argv[3] ?? path.join(repo, '..', 'ar-submission.json')
writeFileSync(out, `${JSON.stringify(submission, null, 2)}\n`, 'utf8')
console.log(`submission written to ${out}`)
console.log(`packageManifest matches package.json#dshWorkshop: ${JSON.stringify(submission.packageManifest) === JSON.stringify(pkg.dshWorkshop)}`)
