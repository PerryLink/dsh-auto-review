// UI probe 2: click the add-workspace button and dump the resulting UI.
import { chromium } from 'file:///D:/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto('http://127.0.0.1:3090', { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await page.getByRole('button', { name: '添加工作区' }).click()
  await page.waitForTimeout(1500)
  const dialogs = await page.locator('[role="dialog"]').count()
  console.log('dialogs:', dialogs)
  const text = await page.locator('body').innerText()
  console.log(text.slice(0, 2500))
  console.log('=== dialog buttons ===')
  const buttons = await page.locator('[role="dialog"] button').evaluateAll(nodes => nodes.map(node => ({ text: (node.innerText ?? '').slice(0, 30), aria: node.getAttribute('aria-label') })))
  console.log(JSON.stringify(buttons, null, 2))
  console.log('=== dialog inputs ===')
  const inputs = await page.locator('[role="dialog"] input').evaluateAll(nodes => nodes.map(node => ({ placeholder: node.getAttribute('placeholder'), aria: node.getAttribute('aria-label'), type: node.getAttribute('type') })))
  console.log(JSON.stringify(inputs, null, 2))
} finally {
  await browser.close()
}
