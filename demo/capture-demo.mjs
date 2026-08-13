// Demo capture for dsh-auto-review: real server (port 3090), real API key,
// real model rounds. One storyboard, one run:
//   00 initial UI → 01 typed allow prompt → 02 running (tool card)
//   → 03 settled (file written, DONE, no approval panel)
//   → 04 typed deny prompt → 05 denied (reviewer reason in transcript)
// Workspace + session are created through the app's own unary RPC endpoints
// (this build composes no directory-flow client module; the UI's New Session
// button adopts the created blank session).
import { mkdirSync } from 'node:fs'
import { chromium } from 'file:///D:/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const BASE = 'http://127.0.0.1:3090'
const FRAMES = 'D:/deepseek-harness/Project/Plugins/dsh-auto-review/.playwright-mcp/gif-frames-auto-review'
const WORKSPACE_ROOT = 'C:/Users/zzhdz/AppData/Local/Temp/dsh-auto-review-ws'
const SCRATCH_TARGET = 'C:\\Users\\zzhdz\\AppData\\Local\\Temp\\dsh-auto-review-scratch'

mkdirSync(FRAMES, { recursive: true })
mkdirSync(WORKSPACE_ROOT, { recursive: true })
mkdirSync(SCRATCH_TARGET, { recursive: true })

const PROMPT_ALLOW = [
  'Use one pwsh command to write the file notes.txt into the workspace (the current directory)',
  'containing exactly this text on one line: auto-review demo ok.',
  'This session is read-only, so the sandbox will deny the write. Retry the exact same command once with sandbox_permissions: workspace-write and a one-sentence justification that mentions this explicit user request verbatim.',
  'Then reply with exactly the single word DONE and nothing else.',
].join(' ')

const PROMPT_DENY = [
  `Use one pwsh command to delete the folder ${SCRATCH_TARGET} recursively (Remove-Item -Recurse -Force).`,
  'The sandbox will deny it. Retry the exact same command once with sandbox_permissions: danger-full-access and a one-sentence justification.',
  'Then reply with exactly the single word DONE and nothing else.',
].join(' ')

const shot = async (page, name) => {
  await page.screenshot({ path: `${FRAMES}/${name}.png` })
  console.log(`frame: ${name}`)
}

const setupWorkspace = async (page) => {
  await page.evaluate(async (root) => {
    const call = async (method, payload) => {
      const response = await fetch(`/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }),
      })
      return response.json()
    }
    const created = await call('workspace.create', { path: root })
    const workspaceId = created.result?.value?.workspace?.workspaceId
    if (workspaceId === undefined) throw new Error(`workspace.create failed: ${JSON.stringify(created)}`)
    const session = await call('session.create', { workspaceId })
    if (session.result?.ok !== true) throw new Error(`session.create failed: ${JSON.stringify(session)}`)
  }, WORKSPACE_ROOT)
  // Adopt the created blank session through the product's New Session button.
  await page.getByRole('button', { name: 'New session' }).filter({ hasText: 'New Session' }).click()
  await page.locator('textarea:enabled[placeholder="Describe what you want to build"]').waitFor({ timeout: 20_000 })
  // Switch the session to read-only so the workspace write crosses the boundary
  // and the AI reviewer has a clearly in-scope escalation to grant.
  await page.getByText('Workspace Write', { exact: true }).click()
  await page.getByRole('menuitem', { name: 'Read Only' }).click()
  await page.getByText('Read Only', { exact: true }).first().waitFor({ timeout: 10_000 })
}

const send = async (page, text) => {
  const composer = page.locator('textarea').last()
  await composer.fill(text)
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
}

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await shot(page, '00-initial')
  await setupWorkspace(page)

  await send(page, PROMPT_ALLOW)
  await page.locator('text=/pwsh|bash/').first().waitFor({ timeout: 120_000 }).catch(() => undefined)
  await shot(page, '01-typed-a')
  await page.getByText('DONE', { exact: true }).first().waitFor({ timeout: 300_000 })
  await shot(page, '02-settled-a')

  await send(page, PROMPT_DENY)
  await page.locator('text=/pwsh|bash/').first().waitFor({ timeout: 120_000 }).catch(() => undefined)
  await shot(page, '03-typed-b')
  await page.getByText('[auto-review]', { exact: false }).first().waitFor({ timeout: 300_000 })
  await shot(page, '04-denied-b')
  await page.getByText('DONE', { exact: true }).first().waitFor({ timeout: 120_000 }).catch(() => undefined)
  await shot(page, '05-settled-b')

  console.log('capture complete')
} finally {
  await browser.close()
}
