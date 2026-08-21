/**
 * Кнопка «Позвонить роботом» и сборка КП прямо из разговора.
 *
 * Проверяем цепочку целиком, как её проходит человек:
 *   вписал телефон → нажал кнопку → робот забрал заявку → отзвонился →
 *   в карточке появились расшифровка и черновик предложения.
 *
 * Запуск (дев-сервер должен быть поднят): npx tsx scripts/test-bot-request.ts
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const TOKEN = process.argv[3] ?? process.env.BOT_TOKEN ?? 'dev-bot-token-local-only'
const LOGIN = process.argv[4] ?? 'denis'
const PASSWORD = process.argv[5] ?? 'OfisSluzhba2026!'

if (/^https:\/\/\d+\.\d+\.\d+\.\d+/.test(BASE)) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

const PHONE = '+7 812 555-77-99'

/** Разговор, в котором клиент называет, что ему нужно. */
const TRANSCRIPT = [
  'Робот: Здравствуйте! Компания «Офисная Служба».',
  'Клиент: Здравствуйте.',
  'Робот: Вы у нас закупались, потом перестали. Что сейчас нужно в офис?',
  'Клиент: Нам нужна бумага а4 20 пачек, карандаши простые 100 штук и линейка 20см 30 штук',
  'Робот: Понял, посчитаю и пришлю.',
  'Клиент: Давайте.',
].join('\n')

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = text.slice(0, 300)
  }
  return { status: res.status, body: body as Record<string, unknown> }
}

async function main() {
  const auth = { Authorization: `Bearer ${TOKEN}` }

  const browser = await chromium.launch()
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1100 } })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', LOGIN)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])

  // ------------------------------------------------ берём любую компанию
  await page.locator('a[href^="/funnel/"]').first().click()
  await page.waitForURL(/\/funnel\/\d+/, { timeout: 30_000 })
  await page.locator('article').first().locator('a').first().click()
  await page.waitForURL(/\/clients\/.+/, { timeout: 30_000 })
  const clientUrl = page.url()
  const company = (await page.locator('h1').innerText()).trim()
  console.log(`компания: ${company}`)

  // ------------------------------------ без телефона звонить нельзя
  await page.fill('input[name=phone]', '')
  await page.locator('form:has(input[name=phone]) button[type=submit]').click()
  await page.locator('text=Сохранено').first().waitFor({ timeout: 20_000 })
  await page.reload({ waitUntil: 'networkidle' })

  const callBtn = page.getByRole('button', { name: /позвонить роботом/i })
  if (!(await callBtn.isDisabled())) throw new Error('кнопка звонка активна без телефона')
  console.log('без телефона кнопка не нажимается — верно')

  // ------------------------------------------------ вписываем телефон
  await page.fill('input[name=phone]', PHONE)
  await page.locator('form:has(input[name=phone]) button[type=submit]').click()
  await page.locator('text=Сохранено').first().waitFor({ timeout: 20_000 })
  await page.reload({ waitUntil: 'networkidle' })

  // ------------------------------------------------------- жмём кнопку
  await page.getByRole('button', { name: /позвонить роботом/i }).click()
  await page.locator('text=/заявка|очеред/i').first().waitFor({ timeout: 20_000 })
  console.log('заявка поставлена')

  // ------------------------------------------- робот забирает заявку
  const q = await api('/api/bot/queue?limit=5', { headers: auth })
  const requests = q.body.requests as Record<string, unknown>[]
  const mine = requests?.find((r) => String(r.phone).includes('555-77-99'))
  if (!mine) throw new Error('заявка не попала в очередь робота')
  console.log(`робот забрал заявку №${mine.requestId}: ${mine.name} · ${mine.phone}`)

  // Повторный запрос не должен отдать ту же заявку второй раз
  const again = await api('/api/bot/queue?limit=5', { headers: auth })
  const twice = (again.body.requests as Record<string, unknown>[])?.some(
    (r) => r.requestId === mine.requestId,
  )
  if (twice) throw new Error('одна заявка выдана дважды — будет два звонка')
  console.log('повторно та же заявка не выдаётся')

  // ------------------------------------ робот отчитывается о разговоре
  const posted = await api('/api/bot/call', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      clientId: mine.clientId,
      requestId: mine.requestId,
      campaignId: mine.campaignId,
      linkId: mine.linkId,
      category: 'hot',
      summary: 'Назвал, что нужно в офис — считаем',
      transcript: TRANSCRIPT,
      durationSec: 78,
      costRub: 26,
    }),
  })
  if (posted.status !== 200) throw new Error(`не принято: ${JSON.stringify(posted.body)}`)

  const quote = posted.body.quote as { quoteId: number; lines: number; total: number } | null
  if (!quote) throw new Error('КП из разговора не собралось')
  console.log(`собрано КП №${quote.quoteId}: ${quote.lines} позиций на ${quote.total} ₽`)
  if (quote.lines < 3) throw new Error(`ожидали три позиции, собрано ${quote.lines}`)

  // ------------------------------------------------ всё видно в карточке
  await page.goto(clientUrl, { waitUntil: 'networkidle' })
  const text = await page.locator('body').innerText()
  for (const must of ['Коммерческие предложения', 'собрано роботом из разговора']) {
    if (!text.includes(must)) throw new Error(`в карточке нет «${must}»`)
  }
  console.log('в карточке видно предложение с пометкой о происхождении')

  // ---------------------------------------- и позиции подобраны по делу
  await page.goto(`${BASE}/quote/${quote.quoteId}`, { waitUntil: 'networkidle' })
  const rows = await page.locator('form:has(input[name=unitPrice])').count()
  const names = await page
    .locator('form:has(input[name=unitPrice])')
    .evaluateAll((fs) => fs.map((f) => f.querySelector('div.truncate')?.textContent?.trim() ?? ''))
  console.log(`\nв КП строк: ${rows}`)
  names.forEach((n) => console.log(`  ${n}`))

  const joined = names.join(' ').toLowerCase()
  for (const must of ['бумага', 'карандаш', 'линейка']) {
    if (!joined.includes(must)) throw new Error(`в КП нет позиции по слову «${must}»`)
  }
  console.log('\nвсе три позиции подобраны по прайсу')

  await page.screenshot({ path: '../скриншоты/19-кп-из-разговора.png', fullPage: true })
  await browser.close()
  console.log('\nготово')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
