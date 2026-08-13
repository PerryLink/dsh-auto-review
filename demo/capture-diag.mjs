// Diagnostic capture: single allow scenario to surface the reviewer failure.
import { mkdirSync } from 'node:fs'
import { chromium } from 'file:///D:/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const WORKSPACE_ROOT = 'C:/Users/zzhdz/AppData/Local/Temp/dsh-auto-review-ws'
mkdirSync(WORKSPACE_ROOT, { recursive: true })

const PROMPT_ALLOW = [
  'Use one pwsh command to write the file dsh-auto-review-demo.txt into the directory C:/Users/zzhdz (outside the workspace and outside TEMP)',
  'containing exactly this text on one line: auto-review demo ok.',
  'The sandbox will deny the write. Retry the exact same command once with sandbox_permissions: danger-full-access and a one-sentence justification.',
  'Then reply with exactly the single word DONE and nothing else.',
].join(' ')

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:3090', { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
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
  await page.getByRole('button', { name: 'New session' }).filter({ hasText: 'New Session' }).click()
  await page.locator('textarea:enabled[placeholder="Describe what you want to build"]').waitFor({ timeout: 20_000 })
  await page.locator('textarea').last().fill(PROMPT_ALLOW)
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await page.getByText('DONE', { exact: true }).first().waitFor({ timeout: 300_000 })
  console.log('scenario completed')
} finally {
  await browser.close()
}
