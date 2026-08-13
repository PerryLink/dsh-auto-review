// UI probe 7: inspect the popover node structure around the 添加工作区 text.
import { chromium } from 'file:///D:/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto('http://127.0.0.1:3090', { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: '添加工作区' }).click()
  await page.waitForTimeout(800)
  const info = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const value = walker.currentNode.nodeValue?.trim()
      if (value === '添加工作区') {
        let node = walker.currentNode.parentElement
        const chain = []
        while (node && chain.length < 6) {
          chain.push({
            tag: node.tagName,
            role: node.getAttribute('role'),
            aria: node.getAttribute('aria-label'),
            cls: (node.className?.toString() ?? '').slice(0, 60),
            html: node.outerHTML.slice(0, 220),
          })
          node = node.parentElement
        }
        return chain
      }
    }
    return null
  })
  console.log(JSON.stringify(info, null, 2))
} finally {
  await browser.close()
}
