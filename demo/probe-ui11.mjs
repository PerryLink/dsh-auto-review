// UI probe 11: create workspace + session via the app's own RPC, then dump UI.
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

  const result = await page.evaluate(async (root) => {
    const call = async (method, payload) => {
      const rpcId = crypto.randomUUID()
      const response = await fetch(`/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
      })
      return response.json()
    }
    const created = await call('workspace.create', { path: root })
    console.log('workspace.create ->', JSON.stringify(created))
    const workspaceId = created.result?.value?.workspace?.id
    const session = await call('session.create', { workspaceId, cwd: root })
    console.log('session.create ->', JSON.stringify(session))
    return { created, session }
  }, WORKSPACE_ROOT)
  console.log('rpc result:', JSON.stringify(result, null, 2))
  await page.waitForTimeout(2500)
  const text = await page.locator('body').innerText()
  console.log(text.slice(0, 1500))
  const inputs = await page.locator('input, textarea').evaluateAll(nodes => nodes.map(node => ({ tag: node.tagName, ph: node.getAttribute('placeholder'), aria: node.getAttribute('aria-label'), enabled: !node.disabled })))
  console.log(JSON.stringify(inputs, null, 2))
} finally {
  await browser.close()
}
