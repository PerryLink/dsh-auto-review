// UI probe 3: detailed post-click DOM inspection + console errors.
import { chromium } from 'file:///D:/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 200)) })
  page.on('pageerror', err => errors.push(String(err).slice(0, 300)))
  await page.goto('http://127.0.0.1:3090', { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await page.waitForTimeout(1500)
  const before = await page.evaluate(() => document.body.innerHTML.length)
  await page.getByRole('button', { name: '添加工作区' }).click()
  await page.waitForTimeout(2500)
  const after = await page.evaluate(() => document.body.innerHTML.length)
  console.log('html length before/after:', before, after)
  const text = await page.locator('body').innerText()
  console.log(text.slice(0, 2000))
  const matches = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('input, button, [role="dialog"], [role="textbox"]'))
    return nodes.map(node => ({
      tag: node.tagName,
      role: node.getAttribute('role'),
      aria: node.getAttribute('aria-label'),
      text: (node.innerText ?? '').slice(0, 40),
      placeholder: node.getAttribute('placeholder'),
      value: node.value !== undefined ? String(node.value).slice(0, 60) : undefined,
    })).filter(entry => entry.role || entry.aria || entry.placeholder || entry.value)
  })
  console.log(JSON.stringify(matches, null, 2))
  console.log('console errors:', JSON.stringify(errors, null, 2))
} finally {
  await browser.close()
}
