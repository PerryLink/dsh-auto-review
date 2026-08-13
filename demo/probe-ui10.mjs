// UI probe 10: click the Choose workspace BUTTON and dump everything.
import { chromium } from 'file:///D:/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
  const page = await context.newPage()
  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 160)) })
  await page.goto('http://127.0.0.1:3090', { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Choose workspace' }).click()
  await page.waitForTimeout(2000)
  const text = await page.locator('body').innerText()
  console.log(text.slice(0, 2000))
  console.log('=== inputs ===')
  const inputs = await page.locator('input, textarea').evaluateAll(nodes => nodes.map(node => ({ tag: node.tagName, ph: node.getAttribute('placeholder'), aria: node.getAttribute('aria-label'), val: String(node.value ?? '') })))
  console.log(JSON.stringify(inputs, null, 2))
  console.log('=== buttons ===')
  const buttons = await page.locator('button').evaluateAll(nodes => nodes.map(node => ({ aria: node.getAttribute('aria-label'), text: (node.innerText ?? '').slice(0, 30) })).filter(entry => entry.aria || entry.text))
  console.log(JSON.stringify(buttons, null, 1))
  console.log('console errors:', JSON.stringify(errors))
} finally {
  await browser.close()
}
