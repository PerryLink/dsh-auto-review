// UI probe 9: en-US + click the workspace trigger, dump result.
import { chromium } from 'file:///D:/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:3090', { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await page.waitForTimeout(1500)
  await page.getByRole('textbox', { name: 'Choose workspace' }).click()
  await page.waitForTimeout(1500)
  const text = await page.locator('body').innerText()
  console.log(text.slice(0, 1500))
  console.log('=== inputs/buttons ===')
  const inputs = await page.locator('input, textarea').evaluateAll(nodes => nodes.map(node => ({ tag: node.tagName, ph: node.getAttribute('placeholder'), aria: node.getAttribute('aria-label'), val: String(node.value ?? '') })))
  const buttons = await page.locator('button').evaluateAll(nodes => nodes.map(node => ({ aria: node.getAttribute('aria-label'), text: (node.innerText ?? '').slice(0, 30) })).filter(entry => entry.aria || entry.text))
  console.log(JSON.stringify({ inputs, buttons }, null, 2))
} finally {
  await browser.close()
}
