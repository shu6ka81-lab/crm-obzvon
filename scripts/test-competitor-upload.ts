/**
 * Проверка пути «загрузил книгу продаж конкурента через сайт → компании
 * появились, свои же клиенты помечены».
 *
 * Запуск (дев-сервер должен быть поднят):
 *   npx tsx scripts/test-competitor-upload.ts
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const DIR =
  process.argv[3] ??
  String.raw`C:\Users\ден\AppData\Local\Temp\claude\C------\e1542c5d-5a29-47fd-a1aa-ab578ee5cb93\scratchpad\lev\zip\Для Льва`
const LOGIN = 'denis'
const PASSWORD = 'OfisSluzhba2026!'

async function main() {
  // Книги продаж лежат под безликими числовыми именами — берём всё, кроме
  // отчётов по номенклатуре, они грузятся в прайс-лист другой формой.
  const files = readdirSync(DIR)
    .filter((f) => /\.xlsx$/i.test(f) && !/Продажи_товаров_Номенклатура/i.test(f))
    .sort()
    .map((f) => path.join(DIR, f))

  if (files.length === 0) throw new Error(`в ${DIR} нет списков покупателей`)
  console.log(`файлов найдено: ${files.length}`)

  const browser = await chromium.launch()
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', LOGIN)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])

  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' })

  const form = page.locator('form').filter({ hasText: 'Покупатели конкурентов' })
  await form.locator('input[type=file]').setInputFiles(files)
  console.log('файлы выбраны, загружаю…')

  const t0 = Date.now()
  await form.locator('button[type=submit]').click()
  await form.locator('button:has-text("Загружаю")').waitFor({ timeout: 10_000 })

  const result = form.locator('text=/Загружено списков|Ни один файл/')
  await result.waitFor({ timeout: 600_000 })
  console.log(`загрузка заняла ${((Date.now() - t0) / 1000).toFixed(1)} с`)
  console.log('итог: ' + (await result.innerText()))

  const warnings = await form.locator('li:has-text("⚠")').allInnerTexts()
  warnings.slice(0, 10).forEach((w) => console.log('  ' + w))

  if ((await form.locator('text=Ни один файл').count()) > 0) {
    throw new Error('ни один список не разобрался')
  }

  await browser.close()
  console.log('\nготово')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
