/**
 * Проверка воронки: проходим несколько звонков с разными итогами
 * и смотрим, что стадии проставились и отчёт сошёлся.
 *
 * Запуск (дев-сервер поднят): npx tsx scripts/test-funnel.ts
 */
import { chromium, type Page } from 'playwright'

const BASE = 'http://localhost:3000'
const CAMPAIGN = Number(process.argv[2] ?? 67)

async function call(
  page: Page,
  opts: { outcome: string; quote?: boolean; stage?: string; note: string },
) {
  await page.goto(`${BASE}/call/${CAMPAIGN}`, { waitUntil: 'networkidle' })
  const who = await page.locator('h1').innerText()

  await page.fill('textarea[name=note]', opts.note)
  if (opts.quote) await page.check('input[name=gotQuoteRequest]')
  if (opts.stage) await page.selectOption('select[name=stage]', opts.stage)

  await page.click(`button[name=outcome][value=${opts.outcome}]`)
  await page.waitForLoadState('networkidle')

  // Форма показывает ошибку сохранения — молча её пропускать нельзя,
  // именно так однажды и потерялись все звонки разом.
  const err = page.locator('text=Не сохранилось')
  if (await err.count()) {
    throw new Error('звонок не сохранился: ' + (await err.first().innerText()))
  }
  return who
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', 'denis')
  await page.fill('input[name=password]', 'OfisSluzhba2026!')
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])

  const script = [
    { outcome: 'reached', note: 'Вышли на снабженца, обсудили', expect: 'Знакомство' },
    { outcome: 'reached', quote: true, note: 'Пришлют список позиций', expect: 'Аудит цен' },
    { outcome: 'refused', note: 'Есть контракт до конца года', expect: 'Отказ' },
    { outcome: 'no_answer', note: 'Не берут трубку', expect: 'Лид (не меняется)' },
    {
      outcome: 'reached',
      stage: 'quote',
      note: 'Собрали и отправили КП',
      expect: 'КП отправлено (выбрано руками)',
    },
  ]

  for (const s of script) {
    const who = await call(page, s)
    console.log(`  ${who.slice(0, 38).padEnd(40)} → ${s.expect}`)
  }

  await page.goto(`${BASE}/funnel/${CAMPAIGN}`, { waitUntil: 'networkidle' })
  console.log('\n' + (await page.locator('main').innerText()))

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
