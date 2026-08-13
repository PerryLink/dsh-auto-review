// UI probe 13: dump the permission-preset chip interaction.
import { chromium } from 'file:///D:/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:3090', { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await page.waitForTimeout(1500)
  const chip = page.getByText('Workspace Write', { exact: true })
  console.log('chip count:', await chip.count())
  if (await chip.count() > 0) {
    await chip.first().click()
    await page.waitForTimeout(1200)
    const text = await page.locator('body').innerText()
    console.log(text.slice(0, 2200))
    const items = await page.locator('[role="menuitem"], [role="option"], [role="radio"]').evaluateAll(nodes => nodes.map(node => ({ role: node.getAttribute('role'), text: (node.innerText ?? '').slice(0, 40) })))
    console.log('menu items:', JSON.stringify(items))
  }
} finally {
  await browser.close()
}
