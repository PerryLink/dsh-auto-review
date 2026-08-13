// UI probe 5: two-step flow — add button, then the popover menu entry.
import { chromium } from 'file:///D:/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto('http://127.0.0.1:3090', { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await page.waitForTimeout(1500)

  const dump = async (label) => {
    const snapshot = await page.evaluate(() => {
      const seen = new Set()
      const out = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const value = walker.currentNode.nodeValue?.trim()
        if (value && !seen.has(value)) {
          seen.add(value)
          out.push(value.slice(0, 80))
        }
      }
      const inputs = Array.from(document.querySelectorAll('input, textarea')).map(node => ({
        tag: node.tagName, ph: node.getAttribute('placeholder'), val: String(node.value ?? '').slice(0, 50),
      }))
      const buttons = Array.from(document.querySelectorAll('button')).map(node => ({
        aria: node.getAttribute('aria-label'), text: (node.innerText ?? '').slice(0, 30),
      })).filter(entry => entry.aria || entry.text)
      return { texts: out, inputs, buttons }
    })
    console.log(`--- ${label} ---`)
    console.log(JSON.stringify(snapshot, null, 1))
  }

  await page.getByRole('button', { name: '添加工作区' }).click()
  await page.waitForTimeout(800)
  const menuEntry = page.locator('[role="menuitem"], [role="option"]').filter({ hasText: '添加工作区' })
  console.log('menu entries:', await menuEntry.count())
  if (await menuEntry.count() > 0) {
    await menuEntry.first().click()
    await page.waitForTimeout(1500)
    await dump('after menu entry click')
  } else {
    await dump('no menu entry found')
  }
} finally {
  await browser.close()
}
