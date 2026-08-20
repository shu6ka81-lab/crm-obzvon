/**
 * Проверка пути «загрузил отчёты продаж через сайт → прайс-лист наполнился».
 *
 * Раньше прайс-лист заливался скриптом с файлами, лежащими на сервере. На
 * рабочем сервере так делать неоткуда: файлы у человека на компьютере.
 * Поэтому загрузка переехала на страницу — и этот путь надо проверять целиком,
 * включая то, что форма отвечает, а не молчит.
 *
 * Запуск (дев-сервер должен быть поднят):
 *   npx tsx scripts/test-catalog-upload.ts
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
  const files = readdirSync(DIR)
    .filter((f) => /Продажи_товаров_Номенклатура.*\.xlsx$/i.test(f))
    .sort()
    .map((f) => path.join(DIR, f))

  if (files.length === 0) throw new Error(`в ${DIR} нет отчётов продаж`)
  console.log(`отчётов найдено: ${files.length}`)

  const browser = await chromium.launch()
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', LOGIN)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])
  console.log('вход выполнен')

  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' })

  // Форма прайс-листа — та, что подписана заголовком «Прайс-лист»
  const form = page.locator('form').filter({ hasText: 'Прайс-лист' })
  await form.locator('input[type=file]').setInputFiles(files)
  console.log('файлы выбраны, загружаю…')

  const t0 = Date.now()
  await form.locator('button[type=submit]').click()

  // Пока идёт разбор, кнопка должна сообщать об этом — иначе человек решит,
  // что нажатие не сработало, и нажмёт ещё раз. Именно так и случилось.
  await form.locator('button:has-text("Загружаю")').waitFor({ timeout: 10_000 })
  console.log('кнопка показывает, что работа идёт — хорошо')

  const result = form.locator('text=/Загружено отчётов/')
  await result.waitFor({ timeout: 600_000 })
  console.log(`загрузка заняла ${((Date.now() - t0) / 1000).toFixed(1)} с`)
  console.log('итог: ' + (await result.innerText()))

  // Страница аудита цен должна перестать жаловаться на пустой прайс
  await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' })
  const anyClient = page.locator('tbody tr a').first()
  await anyClient.waitFor({ timeout: 30_000 })
  const href = await anyClient.getAttribute('href')
  await page.goto(`${BASE}${href}/quote`, { waitUntil: 'networkidle' })
  const empty = await page.locator('text=Прайс-лист пуст').count()
  if (empty > 0) throw new Error('прайс-лист остался пустым — загрузка не сработала')
  console.log('страница подбора позиций больше не жалуется на пустой прайс')

  await browser.close()
  console.log('\nготово')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
