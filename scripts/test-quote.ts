/**
 * Сквозная проверка КП: вставили список от клиента → подобрались позиции →
 * сохранили → открылось готовое предложение с суммой и маржой.
 *
 * Запуск (дев-сервер поднят): npx tsx scripts/test-quote.ts [clientId]
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
const CLIENT = process.argv[2] ?? '9303'

const LIST = `Бумага А4 500 листов — 20 пачек
Перчатки нитриловые M 100шт
Кофе в зернах 1 кг — 5
Туалетная бумага 2 слоя 12
Мешки для мусора 120 л — 30
Чай Гринфилд пакетированный 10
Какая-то несуществующая ерунда 3`

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1100 } })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', 'denis')
  await page.fill('input[name=password]', 'OfisSluzhba2026!')
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])

  // Клиента берём из очереди обзвона — так же, как это делает менеджер
  await page.goto(`${BASE}/call/67`, { waitUntil: 'networkidle' })
  const link = page.locator('a[href*="/quote/new"]')
  if (await link.count()) {
    await link.first().click()
    await page.waitForLoadState('networkidle')
  } else {
    await page.goto(`${BASE}/quote/new?client=${CLIENT}`, { waitUntil: 'networkidle' })
  }
  console.log('открыт экран:', page.url())

  await page.fill('#list', LIST)

  const t0 = Date.now()
  await page.click('button:has-text("Подобрать позиции")')
  await page.waitForSelector('table tbody tr', { timeout: 60_000 })
  console.log(`подбор занял ${Date.now() - t0} мс\n`)

  const stats = await page.locator('.grid > div').allInnerTexts()
  console.log('сводка:', stats.map((s) => s.replace(/\n/g, ' ')).join('  |  '))

  console.log('\nчто подобралось:')
  const rows = await page.locator('table tbody tr').all()
  for (const r of rows) {
    const cells = await r.locator('td').allInnerTexts()
    const chosen = (await r.locator('select option:checked').count())
      ? await r.locator('select option:checked').first().innerText()
      : cells[2]
    console.log(`  ${cells[1].slice(0, 34).padEnd(36)} → ${chosen.slice(0, 66)}`)
  }

  await page.click('button:has-text("Сохранить КП")')
  await page.waitForURL(/\/quote\/\d+$/, { timeout: 30_000 })
  console.log(`\nсохранено: ${page.url()}`)

  const head = await page.locator('h1').innerText()
  const totals = await page.locator('tfoot').innerText()
  console.log(head)
  console.log(totals.replace(/\s+/g, ' '))

  await page.screenshot({ path: String.raw`C:\офис\скриншоты\09-кп.png`, fullPage: true })
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
