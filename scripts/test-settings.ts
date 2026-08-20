/**
 * Реквизиты компании: сохранились и подставились в предложение.
 *
 * Запуск (дев-сервер должен быть поднят): npx tsx scripts/test-settings.ts
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const LOGIN = process.argv[3] ?? 'denis'
const PASSWORD = process.argv[4] ?? 'OfisSluzhba2026!'

const MARK = 'Проверка ' + String(Math.floor(1e6 * 0.4242))

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 1000 } })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', LOGIN)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])

  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })

  const slogan = await page.locator('input[name=slogan]').inputValue()
  const benefits = await page.locator('textarea[name=benefits]').inputValue()
  console.log(`строка под названием: «${slogan}»`)
  console.log(`пунктов «что получаете»: ${benefits.split('\n').filter(Boolean).length}`)
  if (!benefits.trim()) throw new Error('список преимуществ пуст')

  await page.fill('input[name=slogan]', MARK)
  await page.getByRole('button', { name: /сохранить/i }).click()
  await page.locator('text=Сохранено').waitFor({ timeout: 20_000 })

  await page.reload({ waitUntil: 'networkidle' })
  const after = await page.locator('input[name=slogan]').inputValue()
  if (after !== MARK) throw new Error(`не сохранилось: получено «${after}»`)
  console.log('сохранение работает')

  // Самое важное: попало ли в предложение
  await page.goto(`${BASE}/quote/1/pdf`, { waitUntil: 'networkidle' })
  const sheet = await page.locator('.print-sheet').innerText()
  if (!sheet.includes(MARK)) throw new Error('изменение не попало в предложение')
  console.log('подставляется в предложение')

  // Возвращаем как было
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  await page.fill('input[name=slogan]', slogan)
  await page.getByRole('button', { name: /сохранить/i }).click()
  await page.locator('text=Сохранено').waitFor({ timeout: 20_000 })
  console.log('вернул исходное значение')

  await browser.close()
  console.log('\nготово')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
