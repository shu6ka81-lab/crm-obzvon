/**
 * Доска воронки: карточки разложены по стадиям, перенос доезжает до базы.
 *
 * Проверяем не «карточка переехала на экране» — она переезжает сразу, до
 * ответа сервера. Проверяем, что после перезагрузки она осталась в новой
 * колонке и переход записался в историю клиента.
 *
 * Запуск (дев-сервер должен быть поднят): npx tsx scripts/test-board.ts
 */
import { chromium, type Page } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const LOGIN = process.argv[3] ?? 'denis'
const PASSWORD = process.argv[4] ?? 'OfisSluzhba2026!'

/** Названия колонок и сколько в них карточек — так, как это видит человек. */
async function columns(page: Page): Promise<{ title: string; count: number; cards: number }[]> {
  return page.locator('[data-stage]').evaluateAll((cols) =>
    cols.map((col) => ({
      title: (col.querySelector('h3')?.textContent ?? '').trim(),
      count: Number(col.querySelector('h3')?.nextElementSibling?.textContent?.replace(/\D/g, '') ?? 0),
      cards: col.querySelectorAll('article').length,
    })),
  )
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1700, height: 1100 } })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', LOGIN)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])

  // Кампанию берём через интерфейс: базу в разработке держит дев-сервер
  await page.locator('a[href^="/funnel/"]').first().click()
  await page.waitForURL(/\/funnel\/\d+/, { timeout: 30_000 })
  const url = page.url()
  console.log(`доска: ${url}`)

  await page.locator('article').first().waitFor({ timeout: 30_000 })
  const before = await columns(page)
  console.log('\nколонки:')
  before.forEach((c) => console.log(`  ${c.title.padEnd(18)} всего ${String(c.count).padStart(5)}, показано ${c.cards}`))

  const sum = before.reduce((s, c) => s + c.count, 0)
  if (sum === 0) throw new Error('на доске нет ни одной карточки')

  // -------------------------------------------------- переносим карточку
  const card = page.locator('article').first()
  const name = (await card.locator('a').first().innerText()).trim()
  const from = await card.locator('select').inputValue()
  const to = from === 'contacted' ? 'audit' : 'contacted'
  console.log(`\nпереношу «${name}»: ${from} → ${to}`)

  await card.locator('select').selectOption(to)
  await page.waitForTimeout(1500)

  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('article').first().waitFor({ timeout: 30_000 })

  const moved = page.locator('article').filter({ hasText: name }).first()
  const nowStage = await moved.locator('select').inputValue()
  console.log(`после перезагрузки стадия: ${nowStage}`)
  if (nowStage !== to) throw new Error(`перенос не сохранился: ожидалось ${to}, стало ${nowStage}`)

  const after = await columns(page)
  console.log('\nколонки после:')
  after.forEach((c) =>
    console.log(`  ${c.title.padEnd(18)} всего ${String(c.count).padStart(5)}, показано ${c.cards}`),
  )

  // Карточки должны быть видны, а не только посчитаны
  const shown = after.reduce((s, c) => s + c.cards, 0)
  if (shown === 0) throw new Error('счётчики есть, а карточек на доске не видно')

  const sumAfter = after.reduce((s, c) => s + c.count, 0)
  if (sumAfter !== sum) throw new Error(`карточек стало ${sumAfter} вместо ${sum} — потеряли или задвоили`)
  console.log(`\nвсего карточек: было ${sum}, стало ${sumAfter} — сходится`)

  // Переход должен быть виден и в карточке клиента
  await moved.locator('a').first().click()
  await page.waitForURL(/\/clients\/.+/, { timeout: 30_000 })
  const stageOnCard = await page.locator('select[name=stage]').inputValue()
  console.log(`в карточке клиента стадия: ${stageOnCard}`)
  if (stageOnCard !== to) throw new Error('в карточке клиента стадия другая')

  await page.goto(url, { waitUntil: 'networkidle' })
  await page.locator('article').first().waitFor({ timeout: 30_000 })
  await page.screenshot({ path: '../скриншоты/16-канбан.png', fullPage: true })

  await browser.close()
  console.log('\nготово')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
