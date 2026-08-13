// UI probe: dump the initial page state of the demo instance.
import { chromium } from 'file:///D:/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto('http://127.0.0.1:3090', { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await page.waitForTimeout(2000)
  const text = await page.locator('body').innerText()
  console.log(text.slice(0, 3000))
  console.log('=== textboxes ===')
  const boxes = await page.locator('textarea, input[type="text"], [role="textbox"]').evaluateAll(nodes =>
    nodes.map(node => ({ tag: node.tagName, placeholder: node.getAttribute('placeholder'), aria: node.getAttribute('aria-label'), name: node.getAttribute('name'), value: (node.value ?? '').slice(0, 40) })))
  console.log(JSON.stringify(boxes, null, 2))
  console.log('=== buttons ===')
  const buttons = await page.locator('button').evaluateAll(nodes => nodes.map(node => ({ text: (node.innerText ?? '').slice(0, 40), aria: node.getAttribute('aria-label') })))
  console.log(JSON.stringify(buttons, null, 2))
} finally {
  await browser.close()
}
