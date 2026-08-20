/**
 * Пересборка правил наценки из отгрузок — через страницу, как это делает
 * человек после загрузки новых месяцев прайса.
 *
 * Запуск (дев-сервер должен быть поднят): npx tsx scripts/test-rules-rebuild.ts
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const LOGIN = 'denis'
const PASSWORD = 'OfisSluzhba2026!'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } })
  // Пересборка спрашивает подтверждение — отвечаем «да», как человек
  page.on('dialog', (d) => d.accept())

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', LOGIN)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])

  await page.goto(`${BASE}/pricing`, { waitUntil: 'networkidle' })
  const before = await page.locator('form:has(input[name=markupPct])').count()
  console.log(`правил было: ${before - 1}`)

  await page.getByRole('button', { name: /собрать заново/i }).click()
  await page.locator('text=/Собрано \\d+ правил/').waitFor({ timeout: 120_000 })
  const msg = await page.locator('text=/Собрано \\d+ правил/').innerText()
  console.log(msg)

  await page.reload({ waitUntil: 'networkidle' })
  const after = await page.locator('form:has(input[name=markupPct])').count()
  console.log(`правил стало: ${after - 1}`)
  if (after - 1 < 2) throw new Error('правил почти не осталось — отбор слишком строгий')

  const rows = await page
    .locator('form:has(input[name=markupPct])')
    .evaluateAll((forms) =>
      forms.slice(0, -1).map((f) => {
        const name = (f.querySelector('input[name=name]') as HTMLInputElement)?.value
        const m = (f.querySelector('input[name=markupPct]') as HTMLInputElement)?.value
        return `${name} — ${m}%`
      }),
    )
  console.log('\n' + rows.join('\n'))

  await browser.close()
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
