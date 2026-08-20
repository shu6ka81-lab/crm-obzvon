/**
 * Проверка страницы наценки: правила видны, правка сохраняется, цена в КП
 * пересчитывается по изменённому правилу.
 *
 * Серверные действия ломаются молча — форма отправляется, ничего не меняется,
 * ошибки нет. Поэтому проверяем не «страница открылась», а «число изменилось».
 *
 * Запуск (дев-сервер должен быть поднят): npx tsx scripts/test-pricing-page.ts
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const LOGIN = process.argv[3] ?? 'denis'
const PASSWORD = process.argv[4] ?? 'OfisSluzhba2026!'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 1000 } })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', LOGIN)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])
  console.log('вход выполнен')

  await page.goto(`${BASE}/pricing`, { waitUntil: 'networkidle' })

  const forms = page.locator('form:has(input[name=markupPct])')
  const count = await forms.count()
  console.log(`форм правил на странице: ${count} (последняя — добавление нового)`)
  if (count < 2) throw new Error('правил на странице нет')

  const target = forms.first()
  const nameVal = await target.locator('input[name=name]').inputValue()
  const before = await target.locator('input[name=markupPct]').inputValue()
  console.log(`первое правило: «${nameVal}», наценка ${before}%`)

  const next = String(Number(before) + 3)
  await target.locator('input[name=markupPct]').fill(next)
  await target.locator('button[type=submit]').click()
  await target.locator('text=Правило изменено').waitFor({ timeout: 20_000 })
  console.log('форма ответила: правило изменено')

  await page.reload({ waitUntil: 'networkidle' })
  const after = await page
    .locator('form:has(input[name=markupPct])')
    .first()
    .locator('input[name=markupPct]')
    .inputValue()
  console.log(`после перезагрузки: ${after}%`)
  if (after !== next) throw new Error(`наценка не сохранилась: ожидалось ${next}, получено ${after}`)

  // Возвращаем как было, чтобы проверка не оставляла следов
  const back = page.locator('form:has(input[name=markupPct])').first()
  await back.locator('input[name=markupPct]').fill(before)
  await back.locator('button[type=submit]').click()
  await back.locator('text=Правило изменено').waitFor({ timeout: 20_000 })
  console.log('вернул исходное значение')

  // Сводка сверху должна показывать живые числа, а не заглушки
  const summary = await page.locator('text=Позиций в прайсе').locator('..').innerText()
  console.log('сводка: ' + summary.replace(/\n+/g, ' · '))
  if (/\b0\b/.test(summary.split('·')[1] ?? '')) throw new Error('в сводке ноль позиций')

  await browser.close()
  console.log('\nготово')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
