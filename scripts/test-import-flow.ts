/**
 * Проверка пути «загрузил файл через сайт → кампании собрались сами».
 * Именно так это будет происходить на сервере, где скриптов не запускают.
 *
 * Запуск (дев-сервер должен быть поднят): npx tsx scripts/test-import-flow.ts
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const FILE =
  process.argv[3] ?? String.raw`C:\Users\ден\Downloads\Kontragenty_Aktivnost_26.xlsx`
const LOGIN = 'denis'
const PASSWORD = 'OfisSluzhba2026!'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', LOGIN)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])
  console.log('вход выполнен')

  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' })
  const before = await page.locator('tbody tr').count()
  console.log(`загрузок в истории до: ${before}`)

  await page.setInputFiles('input[type=file]', FILE)
  console.log('файл выбран, загружаю…')

  const t0 = Date.now()
  // Именно кнопка формы загрузки: в шапке есть форма выхода, её кнопка идёт раньше
  await page.click('form:has(input[type=file]) button[type=submit]')
  // Ждём, пока в истории появится новая строка — это и есть признак,
  // что серверное действие отработало до конца.
  await page
    .locator('tbody tr')
    .nth(before)
    .waitFor({ state: 'attached', timeout: 300_000 })
  console.log(`загрузка заняла ${((Date.now() - t0) / 1000).toFixed(1)} с`)

  const after = await page.locator('tbody tr').count()
  console.log(`загрузок в истории после: ${after}`)
  if (after <= before) throw new Error('новая загрузка не появилась в истории')

  const firstRow = await page.locator('tbody tr').first().innerText()
  console.log('последняя загрузка: ' + firstRow.replace(/\s+/g, ' ').trim())

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const text = await page.locator('main').innerText()
  const camps = text
    .split('\n')
    .filter((l) => l.includes('разовые') || l.includes('Уходящие'))
  console.log('\nкампании на главной:')
  camps.forEach((c) => console.log('  ' + c))

  const counts = await page.locator('main .text-lg').allInnerTexts()
  console.log('\nчисла на карточках:', counts.slice(0, 12).join(' | '))

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
