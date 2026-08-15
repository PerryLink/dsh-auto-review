// Builds the omdsh-workshop-submission/v2 JSON for dsh-auto-review.
// packageManifest is read VERBATIM from the repo's package.json so the
// submission can never drift from the pinned manifest.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const repo = 'D:/deepseek-harness/Project/Plugins/dsh-auto-review'
const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'))
const ref = process.argv[2] ?? process.env.PINNED_REF
const updatedAt = new Date().toISOString()

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
    compatibility: '0.1.0-rc.6',
    changelog: '0.4.1 adds the omdsh-workshop-package/v1 dshWorkshop intake manifest plus author-run install/remove evidence; runtime behavior is unchanged from 0.4.0.',
    capabilities: { requiresFabric: false, deepHook: false, restartRequired: true },
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
