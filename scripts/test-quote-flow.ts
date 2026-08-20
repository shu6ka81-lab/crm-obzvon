/**
 * Полный путь коммерческого предложения: подбор по списку клиента → цена
 * по правилам наценки → правка строки → выгрузка на печать.
 *
 * Проверяем не «страница открылась», а что числа меняются и сходятся:
 * серверные действия ломаются молча, и это здесь уже случалось.
 *
 * Запуск (дев-сервер должен быть поднят): npx tsx scripts/test-quote-flow.ts
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const LOGIN = process.argv[3] ?? 'denis'
const PASSWORD = process.argv[4] ?? 'OfisSluzhba2026!'

const REQUEST = `Бумага А4 500 листов — 20 пачек
Бумажные полотенца 2 слоя 10
Кофе в зернах 1 кг 3
Мешки для мусора 120 л 5`

function num(s: string): number {
  return Number(s.replace(/[^\d,.-]/g, '').replace(/\s/g, '').replace(',', '.'))
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1700, height: 1100 } })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', LOGIN)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])

  // Клиента ищем через интерфейс, а не запросом к базе: в разработке база —
  // это PGlite, и её держит дев-сервер. Второй процесс её просто не откроет.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const campaign = page.locator('a[href^="/call/"]').first()
  await campaign.waitFor({ timeout: 30_000 })
  await campaign.click()
  await page.waitForURL(/\/call\/\d+/, { timeout: 30_000 })

  const toQuote = page.locator('a[href^="/quote/new?client="]').first()
  await toQuote.waitFor({ timeout: 30_000 })
  const href = await toQuote.getAttribute('href')
  console.log(`сборка КП: ${href}`)

  // ------------------------------------------------------------ подбор
  await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' })
  await page.fill('textarea', REQUEST)
  await page.getByRole('button', { name: /подобрать/i }).click()
  const saveBtn = page.getByRole('button', { name: /сохранить кп/i })
  await saveBtn.waitFor({ timeout: 120_000 })
  console.log('позиции подобраны')

  // ------------------------------------------------------------ сохранение
  await saveBtn.click()
  await page.waitForURL(/\/quote\/\d+$/, { timeout: 60_000 })
  const quoteUrl = page.url()
  console.log(`КП сохранено: ${quoteUrl}`)

  // ------------------------------------------------- цена посчитана правилом
  const rows = page.locator('form:has(input[name=unitPrice])')
  const n = await rows.count()
  if (n === 0) throw new Error('в КП нет строк')
  console.log(`строк в КП: ${n}`)

  const first = rows.first()
  const price0 = num(await first.locator('input[name=unitPrice]').inputValue())
  const totalBefore = num(await page.locator('[data-total]').innerText())
  console.log(`первая строка: цена ${price0}`)
  if (!(price0 > 0)) throw new Error('цена нулевая — правила не применились')

  // ------------------------------------------------------- правка строки
  const qty = num(await first.locator('input[name=qty]').inputValue())
  const newPrice = Math.round((price0 + 10) * 100) / 100
  await first.locator('input[name=unitPrice]').fill(String(newPrice))
  await first.locator('input[name=clientPrice]').fill(String(Math.round(price0 * 1.2 * 100) / 100))
  await first.locator('button[type=submit]').click()
  await first.locator('text=✓').waitFor({ timeout: 20_000 })
  console.log('строка сохранена')

  await page.reload({ waitUntil: 'networkidle' })
  const price1 = num(
    await page.locator('form:has(input[name=unitPrice])').first().locator('input[name=unitPrice]').inputValue(),
  )
  if (Math.abs(price1 - newPrice) > 0.01) {
    throw new Error(`цена не сохранилась: ожидалось ${newPrice}, получено ${price1}`)
  }
  console.log(`после перезагрузки цена ${price1} — сохранилась`)

  // -------------------------------------------- итог пересчитался на разницу
  const totalAfter = num(await page.locator('[data-total]').innerText())
  const expected = totalBefore + (newPrice - price0) * qty
  if (Math.abs(totalAfter - expected) > Math.max(2, expected * 0.001)) {
    throw new Error(`итог не сошёлся: было ${totalBefore}, ждали ${expected}, стало ${totalAfter}`)
  }
  console.log(`итог пересчитан: ${totalBefore} → ${totalAfter}`)

  // ------------------------------------------------- сравнение с ценой клиента
  const vs = await page.locator('text=Против цен клиента').count()
  if (vs === 0) throw new Error('нет сравнения с ценой клиента, хотя она заполнена')
  console.log('сравнение с ценой клиента показывается')

  // ------------------------------------------------------------ печатный вид
  await page.goto(`${quoteUrl}/pdf`, { waitUntil: 'networkidle' })
  const sheet = await page.locator('.print-sheet').innerText()
  // Сравниваем без учёта регистра: часть заголовков набирается прописными
  // через оформление, и точное сравнение ловит не текст, а стиль.
  const lower = sheet.toLowerCase()
  const must = [
    'коммерческое предложение',
    'подготовлено для',
    'сумма прописью',
    'что вы получаете',
    'вы экономите',
    'м. п.',
  ]
  for (const m of must) {
    if (!lower.includes(m)) throw new Error(`в печатном виде нет «${m}»`)
  }
  const words = sheet.split('Сумма прописью:')[1]?.split('\n')[0]?.trim()
  console.log(`печатный вид собран, сумма прописью: ${words}`)

  await page.screenshot({ path: '../скриншоты/11-кп-печать.png', fullPage: true })
  await page.goto(quoteUrl, { waitUntil: 'networkidle' })
  await page.screenshot({ path: '../скриншоты/12-кп-расчёт.png', fullPage: true })
  await page.goto(`${BASE}/pricing`, { waitUntil: 'networkidle' })
  await page.screenshot({ path: '../скриншоты/13-наценка.png', fullPage: true })

  await browser.close()
  console.log('\nготово')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
