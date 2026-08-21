/**
 * Состояние робота на экране и судьба заявки.
 *
 * Человек нажал «Позвонить» и ничего не произошло — система обязана сказать
 * почему. Проверяем два разрыва, из-за которых звонок не шёл:
 *   1. заявку забирал любой просмотр очереди, в том числе проверка связи;
 *   2. про незапущенного робота на экране не было ни слова.
 *
 * Запуск (дев-сервер должен быть поднят): npx tsx scripts/test-bot-online.ts
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const TOKEN = process.argv[3] ?? process.env.BOT_TOKEN ?? 'dev-bot-token-local-only'
const LOGIN = process.argv[4] ?? 'denis'
const PASSWORD = process.argv[5] ?? 'OfisSluzhba2026!'

if (/^https:\/\/\d+\.\d+\.\d+\.\d+/.test(BASE)) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

const PHONE = '+7 912 363-90-85'

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  try {
    return { status: res.status, body: JSON.parse(text) as Record<string, unknown> }
  } catch {
    return { status: res.status, body: {} as Record<string, unknown> }
  }
}

async function main() {
  const auth = { Authorization: `Bearer ${TOKEN}` }

  const browser = await chromium.launch()
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 1100 } })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', LOGIN)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])

  await page.locator('a[href^="/call/"]').first().click()
  await page.waitForURL(/\/call\/\d+/, { timeout: 30_000 })
  const company = (await page.locator('h1').innerText()).trim()

  await page.fill('input[name=phone]', PHONE)
  await page.locator('form:has(input[name=phone]) button[type=submit]').click()
  await page.locator('text=Сохранено').first().waitFor({ timeout: 20_000 })
  await page.reload({ waitUntil: 'networkidle' })
  console.log(`клиент: ${company}, телефон ${PHONE}`)

  // Снимаем заявку от прошлого прогона — иначе новая просто не создастся,
  // и проверка будет искать в очереди то, чего там нет
  const cancelBtn = page.getByRole('button', { name: /отменить звонок/i })
  if (await cancelBtn.count()) {
    await cancelBtn.click()
    await page.locator('text=Звонок отменён').waitFor({ timeout: 20_000 })
    await page.reload({ waitUntil: 'networkidle' })
    console.log('прошлая заявка снята')
  }

  await page.getByRole('button', { name: /позвонить роботом/i }).click()
  await page
    .locator('text=/Робот позвонит|Заявка уже в очереди/i')
    .first()
    .waitFor({ timeout: 20_000 })
  console.log('заявка оставлена')

  // ------------------------------- просмотр очереди не должен красть заявку
  const peek = await api('/api/bot/queue?limit=5', { headers: auth })
  const peeked = (peek.body.requests as Record<string, unknown>[]) ?? []
  const mine = peeked.find((r) => String(r.phone).includes('363-90-85'))
  if (!mine) throw new Error('заявки нет в очереди')

  const peekAgain = await api('/api/bot/queue?limit=5', { headers: auth })
  const stillThere = (peekAgain.body.requests as Record<string, unknown>[])?.some(
    (r) => r.requestId === mine.requestId,
  )
  if (!stillThere) throw new Error('просмотр очереди забрал заявку себе')
  console.log('просмотр очереди заявку не забирает — верно')

  // --------------------------------- а вот с claim=1 забирает, и один раз
  const claimed = await api('/api/bot/queue?limit=5&claim=1', { headers: auth })
  const gotIt = (claimed.body.requests as Record<string, unknown>[])?.some(
    (r) => r.requestId === mine.requestId,
  )
  if (!gotIt) throw new Error('с claim=1 заявка не выдалась')

  const claimTwice = await api('/api/bot/queue?limit=5&claim=1', { headers: auth })
  const again = (claimTwice.body.requests as Record<string, unknown>[])?.some(
    (r) => r.requestId === mine.requestId,
  )
  if (again) throw new Error('заявка выдана дважды — будет два звонка')
  console.log('с claim=1 заявка выдаётся ровно один раз')

  // ------------------------------------- на экране видно, что робот на связи
  await page.reload({ waitUntil: 'networkidle' })
  const online = await page.locator('text=/Робот на связи/i').count()
  if (online === 0) throw new Error('на экране не видно, что робот на связи')
  const line = (await page.locator('text=/Робот на связи/i').first().innerText()).trim()
  console.log(`на экране: ${line}`)

  await page.screenshot({ path: '../скриншоты/21-робот-на-связи.png', fullPage: true })

  /*
   * И обратный случай: робот замолчал. Именно это сообщение человек видит,
   * когда нажал кнопку и ничего не произошло, — ради него всё и делалось.
   * Ждём чуть дольше порога «на связи».
   */
  console.log('\nжду 35 с, чтобы робот считался замолчавшим…')
  await page.waitForTimeout(35_000)
  await page.reload({ waitUntil: 'networkidle' })
  const offline = await page.locator('text=/Робот не запущен/i').count()
  if (offline === 0) throw new Error('про незапущенного робота на экране ни слова')
  const offlineLine = (await page.locator('text=/Робот не запущен/i').first().innerText()).trim()
  console.log(`на экране: ${offlineLine.replace(/\s+/g, ' ').slice(0, 160)}`)

  await browser.close()
  console.log('\nготово')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
