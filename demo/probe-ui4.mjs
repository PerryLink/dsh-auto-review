// UI probe 4: dump exact text after each candidate gesture.
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
      return out
    })
    console.log(`--- ${label} ---`)
    console.log(snapshot.join(' | '))
  }

  await dump('initial')
  await page.getByRole('button', { name: '添加工作区' }).click()
  await page.waitForTimeout(1200)
  await dump('after add-button click')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await page.getByRole('textbox', { name: '选择工作区' }).click()
  await page.waitForTimeout(1200)
  await dump('after trigger textarea click')
} finally {
  await browser.close()
}
