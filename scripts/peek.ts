/**
 * Показать текст любой страницы с авторизацией — для быстрой проверки.
 * Запуск: npx tsx scripts/peek.ts /call/67
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
const PATHS = process.argv.slice(2).length ? process.argv.slice(2) : ['/']

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', 'denis')
  await page.fill('input[name=password]', 'OfisSluzhba2026!')
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])

  for (const p of PATHS) {
    await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 120_000 })
    const text = await page.locator('main').innerText()
    console.log('='.repeat(88))
    console.log('СТРАНИЦА ' + p)
    console.log('='.repeat(88))
    console.log(text)
  }

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
