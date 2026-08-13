// UI probe 12: create ws+session via RPC, click the workspace row, dump.
import { mkdirSync } from 'node:fs'
import { chromium } from 'file:///D:/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const WORKSPACE_ROOT = 'C:/Users/zzhdz/AppData/Local/Temp/dsh-auto-review-ws'
mkdirSync(WORKSPACE_ROOT, { recursive: true })

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:3090', { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await page.waitForTimeout(1500)

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
    const workspaceId = created.result?.value?.workspace?.id
    await call('session.create', { workspaceId, cwd: root })
  }, WORKSPACE_ROOT)

  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'New session' }).filter({ hasText: 'New Session' }).click()
  await page.waitForTimeout(2500)
  const text = await page.locator('body').innerText()
  console.log(text.slice(0, 1800))
  const inputs = await page.locator('input, textarea').evaluateAll(nodes => nodes.map(node => ({ tag: node.tagName, ph: node.getAttribute('placeholder'), aria: node.getAttribute('aria-label'), enabled: !node.disabled })))
  console.log(JSON.stringify(inputs, null, 2))
} finally {
  await browser.close()
}
