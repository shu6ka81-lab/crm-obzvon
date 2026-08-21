/**
 * Две воронки: привлечение и возврат.
 *
 * Работа разная, и называть её одинаково нельзя: «Лид» на компании, которая
 * принесла миллион и перестала покупать, читается как издевательство. Стадии
 * при этом одни и те же — разговор, перечень позиций, предложение, решение.
 *
 * Проверяем, что кампании размечены по типу и что доска говорит теми словами,
 * которые к ней относятся.
 *
 * Запуск (дев-сервер должен быть поднят): npx tsx scripts/test-two-funnels.ts
 */
import { chromium, type Page } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const LOGIN = process.argv[3] ?? 'denis'
const PASSWORD = process.argv[4] ?? 'OfisSluzhba2026!'

/** Слова, по которым воронку видно с первого взгляда. */
const RETURN_WORDS = ['Молчит', 'Вернулся', 'Не вернётся']
const ACQUISITION_WORDS = ['Лид', 'Начали работать', 'Отказ']

async function columnTitles(page: Page): Promise<string[]> {
  return page
    .locator('[data-stage] h3')
    .evaluateAll((hs) => hs.map((h) => (h.textContent ?? '').trim()))
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1700, height: 1100 } })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', LOGIN)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])

  // ------------------------------------------- как размечены кампании
  const cards = await page.locator('h2').evaluateAll((hs) =>
    hs.map((h) => {
      const badge = h.nextElementSibling?.textContent?.trim() ?? ''
      const block = h.closest('div')?.parentElement?.parentElement as HTMLElement | null
      const href = block?.querySelector('a[href^="/funnel/"]')?.getAttribute('href') ?? ''
      return { name: (h.textContent ?? '').trim(), kind: badge, href }
    }),
  )

  console.log('кампании:')
  cards.forEach((c) => console.log(`  ${c.kind.padEnd(13)} ${c.name}`))

  const ret = cards.filter((c) => c.kind === 'возврат')
  const acq = cards.filter((c) => c.kind === 'привлечение')
  if (ret.length === 0) throw new Error('нет ни одной кампании на возврат')
  if (acq.length === 0) throw new Error('нет ни одной кампании на привлечение')
  console.log(`\nна возврат: ${ret.length}, на привлечение: ${acq.length}`)

  // ------------------------------------------- слова на досках разные
  await page.goto(`${BASE}${ret[0].href}`, { waitUntil: 'networkidle' })
  const retTitles = await columnTitles(page)
  console.log(`\nвозврат «${ret[0].name}»:\n  ${retTitles.join(' → ')}`)
  for (const w of RETURN_WORDS) {
    if (!retTitles.includes(w)) throw new Error(`в воронке возврата нет колонки «${w}»`)
  }
  await page.screenshot({ path: '../скриншоты/17-воронка-возврат.png', fullPage: true })

  await page.goto(`${BASE}${acq[0].href}`, { waitUntil: 'networkidle' })
  const acqTitles = await columnTitles(page)
  console.log(`\nпривлечение «${acq[0].name}»:\n  ${acqTitles.join(' → ')}`)
  for (const w of ACQUISITION_WORDS) {
    if (!acqTitles.includes(w)) throw new Error(`в воронке привлечения нет колонки «${w}»`)
  }

  if (retTitles.join() === acqTitles.join()) {
    throw new Error('обе доски подписаны одинаково — тип кампании ни на что не влияет')
  }
  console.log('\nдоски подписаны по-разному — тип кампании учитывается')

  await browser.close()
  console.log('\nготово')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
