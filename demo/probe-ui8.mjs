// UI probe 8: explicit en-US locale page — dump initial state.
import { chromium } from 'file:///D:/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:3090', { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await page.waitForTimeout(1500)
  const text = await page.locator('body').innerText()
  console.log(text.slice(0, 1200))
  console.log('=== inputs ===')
  const inputs = await page.locator('input, textarea').evaluateAll(nodes => nodes.map(node => ({ tag: node.tagName, ph: node.getAttribute('placeholder'), aria: node.getAttribute('aria-label') })))
  console.log(JSON.stringify(inputs, null, 2))
} finally {
  await browser.close()
}
