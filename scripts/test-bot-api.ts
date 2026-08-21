/**
 * Стык с голосовым роботом: очередь на обзвон и приём результата.
 *
 * Робот ходит не браузером, а по ключу. Проверяем три вещи, каждая из которых
 * молча ломается: без ключа не пускают, в очередь не попадают компании без
 * телефона, и результат звонка ложится в историю клиента вместе с расшифровкой.
 *
 * Запуск (дев-сервер должен быть поднят): npx tsx scripts/test-bot-api.ts
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const TOKEN = process.argv[3] ?? process.env.BOT_TOKEN ?? 'dev-bot-token-local-only'
const LOGIN = 'denis'
const PASSWORD = 'OfisSluzhba2026!'

const PHONE = '+7 812 555-33-11'
const TRANSCRIPT = [
  'Робот: Здравствуйте! Меня зовут Денис, компания «Офисная Служба».',
  'Клиент: Да, слушаю.',
  'Робот: Вы у нас закупали канцелярию до марта, потом перестали. Что-то не устроило?',
  'Клиент: Да просто менеджер сменился, и как-то само заглохло.',
  'Робот: Понял. Пришлю предложение по вашим прошлым позициям — посмотрите?',
  'Клиент: Присылайте.',
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
    body = text.slice(0, 200)
  }
  return { status: res.status, body: body as Record<string, unknown> }
}

async function main() {
  // ------------------------------------------------ без ключа не пускают
  const noKey = await api('/api/bot/queue?limit=1')
  console.log(`без ключа: HTTP ${noKey.status} — ${noKey.body.error ?? ''}`)
  if (noKey.status !== 401) throw new Error('очередь отдалась без ключа')

  // Ключ подставляем латиницей: в заголовки HTTP кириллица не влезает —
  // проверка падала не на защите, а на собственных буквах.
  const badKey = await api('/api/bot/queue?limit=1', {
    headers: { Authorization: 'Bearer wrong-key-entirely-different' },
  })
  console.log(`с чужим ключом: HTTP ${badKey.status}`)
  if (badKey.status !== 401) throw new Error('очередь отдалась по чужому ключу')

  const auth = { Authorization: `Bearer ${TOKEN}` }

  // --------------------------------------- пока телефонов нет, очередь пуста
  const empty = await api('/api/bot/queue?limit=5', { headers: auth })
  if (empty.status !== 200) throw new Error(`очередь ответила ${empty.status}`)
  const counts0 = empty.body.counts as { inCampaign: number; withPhone: number }
  console.log(
    `\nочередь: в кампаниях ${counts0.inCampaign}, с телефоном ${counts0.withPhone}, ` +
      `отдано ${(empty.body.leads as unknown[]).length}`,
  )

  // ------------------------------------------- вписываем телефон как человек
  const browser = await chromium.launch()
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1000 } })
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', LOGIN)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])

  await page.locator('a[href^="/funnel/"]').first().click()
  await page.waitForURL(/\/funnel\/\d+/, { timeout: 30_000 })
  const card = page.locator('article').first()
  const company = (await card.locator('a').first().innerText()).trim()
  await card.locator('a').first().click()
  await page.waitForURL(/\/clients\/.+/, { timeout: 30_000 })
  const clientUrl = page.url()

  await page.fill('input[name=phone]', PHONE)
  await page.fill('input[name=contactPerson]', 'Ирина, снабжение')
  await page.locator('form:has(input[name=phone]) button[type=submit]').click()
  await page.locator('text=Сохранено').first().waitFor({ timeout: 20_000 })
  console.log(`\nтелефон вписан: ${company} → ${PHONE}`)

  // ------------------------------------------ теперь компания видна роботу
  const filled = await api('/api/bot/queue?limit=5', { headers: auth })
  const leads = filled.body.leads as Record<string, unknown>[]
  const mine = leads.find((l) => String(l.phone).includes('555-33-11'))
  if (!mine) throw new Error('компания с телефоном не попала в очередь робота')
  console.log(`робот видит: ${mine.name} · ${mine.phone} · «${mine.stageLabel}»`)
  console.log(`контекст для разговора: ${JSON.stringify(mine.history)}`)

  // --------------------------------------------- робот возвращает результат
  const posted = await api('/api/bot/call', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      clientId: mine.clientId,
      campaignId: mine.campaignId,
      linkId: mine.linkId,
      category: 'hot',
      summary: 'Согласился посмотреть предложение по прошлым позициям',
      transcript: TRANSCRIPT,
      recording: '20260821-141500_78125553311_42.wav',
      durationSec: 96,
      costRub: 28,
      gotQuoteRequest: true,
      contactPosition: 'снабжение',
      monthlyBudget: 40000,
      isQualified: 'yes',
    }),
  })
  if (posted.status !== 200) throw new Error(`результат не принят: ${JSON.stringify(posted.body)}`)
  const stage = posted.body.stage as { from: string; to: string }
  console.log(`\nрезультат принят: стадия ${stage.from} → ${stage.to}`)
  if (stage.to === stage.from) throw new Error('стадия не сдвинулась после дозвона')

  // ------------------------------------------ и всё это видно в карточке
  await page.goto(clientUrl, { waitUntil: 'networkidle' })
  const html = await page.locator('body').innerText()
  for (const must of ['робот', 'согласился на встречу', 'Расшифровка разговора']) {
    if (!html.toLowerCase().includes(must.toLowerCase())) {
      throw new Error(`в карточке нет «${must}»`)
    }
  }
  await page.locator('summary:has-text("Расшифровка")').first().click()
  const shown = await page.locator('pre').first().innerText()
  if (!shown.includes('менеджер сменился')) throw new Error('расшифровка не раскрылась')
  console.log('в карточке видно: пометка робота, категория, расшифровка')

  await page.screenshot({ path: '../скриншоты/18-звонок-робота.png', fullPage: true })
  await browser.close()
  console.log('\nготово')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
