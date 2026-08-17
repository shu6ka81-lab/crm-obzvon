/**
 * Снимки экранов для дневника и соцсетей.
 *
 * Запуск (дев-сервер должен быть поднят):
 *   npm run shots
 *   npm run shots -- http://localhost:3000 denis 'пароль'
 *
 * Кладёт файлы в ..\скриншоты\
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const LOGIN = process.argv[3] ?? 'denis'
const PASSWORD = process.argv[4] ?? 'OfisSluzhba2026!'
const OUT = path.resolve(process.cwd(), '..', 'скриншоты')

const SHOTS: { file: string; url: string; title: string; full?: boolean }[] = [
  { file: '01-вход', url: '/login', title: 'Экран входа' },
  { file: '02-кампании', url: '/', title: 'Кампании обзвона и воронка' },
  { file: '03-обзвон', url: '/call/1', title: 'Экран обзвона', full: true },
  { file: '04-список', url: '/call/1/list', title: 'Список кампании' },
  { file: '05-клиенты', url: '/clients', title: 'База клиентов' },
  { file: '06-карточка', url: '/clients/137301', title: 'Карточка клиента', full: true },
  { file: '07-задачи', url: '/tasks', title: 'Задачи' },
  { file: '08-импорт', url: '/import', title: 'Импорт из 1С' },
]

async function main() {
  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // ретина — чтобы текст был чётким в соцсетях
    locale: 'ru-RU',
  })
  const page = await ctx.newPage()

  // Экран входа снимаем до авторизации
  const loginShot = SHOTS[0]
  await page.goto(BASE + loginShot.url, { waitUntil: 'networkidle' })
  await page.screenshot({ path: path.join(OUT, `${loginShot.file}.png`) })
  console.log(`✓ ${loginShot.file}.png — ${loginShot.title}`)

  // Логинимся
  await page.fill('input[name=login]', LOGIN)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL(BASE + '/'), page.click('button[type=submit]')])

  for (const shot of SHOTS.slice(1)) {
    try {
      await page.goto(BASE + shot.url, { waitUntil: 'networkidle', timeout: 60_000 })
      await page.waitForTimeout(400)
      await page.screenshot({
        path: path.join(OUT, `${shot.file}.png`),
        fullPage: shot.full ?? false,
      })
      console.log(`✓ ${shot.file}.png — ${shot.title}`)
    } catch (e) {
      console.warn(`✗ ${shot.file}: ${(e as Error).message.split('\n')[0]}`)
    }
  }

  await browser.close()
  console.log(`\nГотово. Файлы в ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
