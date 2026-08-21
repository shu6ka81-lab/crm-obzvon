/**
 * Живая лента разговора, диалог репликами и запись в карточке.
 *
 * Три вещи, которые проверяются только целиком:
 *   — пока звонок идёт, реплики видно на экране;
 *   — после звонка разговор лежит в истории диалогом, а не простынёй;
 *   — запись загружена на сервер и играет из карточки.
 *
 * Запуск (дев-сервер должен быть поднят): npx tsx scripts/test-live-and-audio.ts
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const TOKEN = process.argv[3] ?? process.env.BOT_TOKEN ?? 'dev-bot-token-local-only'
const LOGIN = process.argv[4] ?? 'denis'
const PASSWORD = process.argv[5] ?? 'OfisSluzhba2026!'

if (/^https:\/\/\d+\.\d+\.\d+\.\d+/.test(BASE)) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

const PHONE = '+7 812 555-44-33'

/** Реплики приходят по одной — как их отдаёт распознавание. */
const TURNS = [
  'Робот: Здравствуйте! Компания «Офисная Служба», меня зовут Денис.',
  'Клиент: Здравствуйте.',
  'Робот: Вы у нас закупались и перестали. Что сейчас нужно в офис?',
  'Клиент: Нужна бумага а4 30 пачек и туалетная бумага 20 упаковок',
  'Робот: Понял, посчитаю и пришлю.',
]

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

/** Простейший корректный WAV — чтобы проверить путь файла, а не звук. */
function fakeWav(seconds = 1): Buffer {
  const rate = 8000
  const samples = rate * seconds
  const buf = Buffer.alloc(44 + samples * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(3000 * Math.sin((i / rate) * 2 * Math.PI * 440)), 44 + i * 2)
  }
  return buf
}

async function main() {
  const auth = { Authorization: `Bearer ${TOKEN}` }

  const browser = await chromium.launch()
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1100 } })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', LOGIN)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])

  await page.locator('a[href^="/funnel/"]').first().click()
  await page.waitForURL(/\/funnel\/\d+/, { timeout: 30_000 })
  await page.locator('article').first().locator('a').first().click()
  await page.waitForURL(/\/clients\/.+/, { timeout: 30_000 })
  const clientUrl = page.url()
  const company = (await page.locator('h1').innerText()).trim()

  await page.fill('input[name=phone]', PHONE)
  await page.locator('form:has(input[name=phone]) button[type=submit]').click()
  await page.locator('text=Сохранено').first().waitFor({ timeout: 20_000 })
  await page.reload({ waitUntil: 'networkidle' })
  console.log(`клиент: ${company}`)

  const clientId = Number(await page.locator('input[name=clientId]').first().inputValue())

  // ------------------------------------------- лента: реплика за репликой
  for (let i = 1; i <= 2; i++) {
    await api('/api/bot/live', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        clientId,
        transcript: TURNS.slice(0, i).join('\n'),
        status: 'разговор',
      }),
    })
  }

  const liveBox = page.locator('[data-live]')
  await liveBox.locator('text=Идёт разговор').waitFor({ timeout: 20_000 })
  console.log('на экране появилось «Идёт разговор»')
  await liveBox.locator('text=Здравствуйте.').first().waitFor({ timeout: 20_000 })

  // Досылаем остаток — экран должен догнать сам, без перезагрузки
  await api('/api/bot/live', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ clientId, transcript: TURNS.join('\n'), status: 'разговор' }),
  })
  // Ищем внутри самой ленты: те же реплики уже лежат в истории под
  // свёрнутой расшифровкой, и поиск по всей странице находит скрытые
  await liveBox.locator('text=/Нужна бумага а4 30 пачек/').first().waitFor({ timeout: 20_000 })
  console.log('лента дописалась сама, без перезагрузки')
  await page.screenshot({ path: '../скриншоты/22-живой-разговор.png', fullPage: true })

  // --------------------------------------------- звонок закончился
  const posted = await api('/api/bot/call', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      clientId,
      category: 'warm / hangup',
      summary: 'Назвал, что нужно в офис',
      transcript: TURNS.join('\n'),
      durationSec: 64,
      costRub: 27,
    }),
  })
  if (posted.status !== 200) throw new Error(`результат не принят: ${JSON.stringify(posted.body)}`)
  const touchId = Number(posted.body.touchId)
  console.log(`составная категория «warm / hangup» принята, разговор №${touchId}`)

  await api('/api/bot/live', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ clientId, transcript: TURNS.join('\n'), finished: true }),
  })

  // ------------------------------------------------------ загрузка записи
  const wav = fakeWav(1)
  const up = await fetch(`${BASE}/api/bot/recording?touch=${touchId}&name=проверка.wav`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(wav),
  })
  const upBody = (await up.json()) as { ok?: boolean; file?: string; bytes?: number }
  if (!upBody.ok) throw new Error(`запись не загрузилась: ${JSON.stringify(upBody)}`)
  console.log(`запись загружена: ${upBody.file}, ${upBody.bytes} байт`)

  // -------------------------------------------- всё это видно в карточке
  await page.goto(clientUrl, { waitUntil: 'networkidle' })

  if (await page.locator('text=Запись разговора не доехала').count()) {
    throw new Error('система не нашла файл записи, хотя он только что загружен')
  }
  const player = page.locator('audio')
  if ((await player.count()) === 0) throw new Error('в карточке нет проигрывателя записи')
  const src = await player.first().getAttribute('src')
  console.log(`проигрыватель на месте: ${src}`)

  const audio = await page.request.get(`${BASE}${src}`)
  if (!audio.ok()) throw new Error(`запись не отдаётся: HTTP ${audio.status()}`)
  const bytes = (await audio.body()).length
  if (bytes !== wav.length) throw new Error(`отдалось ${bytes} байт вместо ${wav.length}`)
  console.log(`запись отдаётся целиком: ${bytes} байт, ${audio.headers()['content-type']}`)

  // Длину браузер должен узнать САМ, до нажатия на «играть». Пока стояло
  // preload="none", исправная запись показывалась как «0:00 / 0:00», и это
  // выглядело так, будто звук не записался вовсе.
  const seconds = await player.first().evaluate(
    (el: HTMLAudioElement) =>
      new Promise<number>((done) => {
        if (el.readyState >= 1) return done(el.duration)
        el.addEventListener('loadedmetadata', () => done(el.duration), { once: true })
        el.addEventListener('error', () => done(-1), { once: true })
        setTimeout(() => done(el.duration || 0), 15_000)
      }),
  )
  if (!(seconds > 0)) throw new Error(`браузер не узнал длину записи: ${seconds}`)
  console.log(`длина видна сразу: ${seconds.toFixed(1)} с`)

  // Берём именно верхнюю запись — свою. Прошлые прогоны оставили такие же
  const details = page.locator('details:has(summary:has-text("Расшифровка"))').first()
  await details.locator('summary').click()
  const bubbles = await details.innerText()
  if (!bubbles.includes('клиент') || !bubbles.includes('робот')) {
    throw new Error('расшифровка показана без разделения на реплики')
  }
  console.log('расшифровка показана диалогом: видно, кто что сказал')

  await page.screenshot({ path: '../скриншоты/23-запись-и-диалог.png', fullPage: true })
  await browser.close()
  console.log('\nготово')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
