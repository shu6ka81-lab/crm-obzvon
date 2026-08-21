/**
 * Работа с любой компанией, а не только с очередной по очереди.
 *
 * Проверяем два пути, о которых просил заказчик:
 *   1. на странице кампаний список компаний раскрывается прямо там;
 *   2. открыв компанию из списка, её можно квалифицировать и записать разговор.
 *
 * Раньше карточка только показывала «ещё не квалифицирован»: заполнить это
 * можно было исключительно из очереди обзвона, и человек упирался в тупик.
 *
 * Запуск (дев-сервер должен быть поднят): npx tsx scripts/test-client-card.ts
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const LOGIN = process.argv[3] ?? 'denis'
const PASSWORD = process.argv[4] ?? 'OfisSluzhba2026!'

/**
 * Текст записи уникален для каждого запуска. С постоянным текстом проверка
 * находила запись от прошлого раза и проходила, даже если сохранение
 * отвалилось, — то есть умела говорить «да» и не умела «нет».
 */
const NOTE = `Проверка карточки ${Date.now()}: договорились созвониться после праздников`

/** Число в скобках после «История касаний» — сколько записей сейчас. */
function historyCount(text: string): number {
  return Number(text.match(/\((\d+)\)/)?.[1] ?? 0)
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1100 } })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', LOGIN)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])

  // ------------------------------------------- список раскрывается на главной
  const toggle = page.getByRole('button', { name: /показать компании/i }).first()
  await toggle.waitFor({ timeout: 30_000 })
  console.log(`кнопка на главной: «${(await toggle.innerText()).replace(/\s+/g, ' ').trim()}»`)
  await toggle.click()

  const table = page.locator('table').first()
  await table.waitFor({ timeout: 30_000 })
  const shown = await table.locator('tbody tr').count()
  console.log(`раскрылось строк: ${shown}`)
  if (shown === 0) throw new Error('список раскрылся пустым')

  const firstName = (await table.locator('tbody tr').first().locator('a').first().innerText()).trim()
  console.log(`первая компания: ${firstName}`)

  // «Показать ещё» должно догружать, а не перерисовывать то же самое
  const more = page.getByRole('button', { name: /показать ещё/i }).first()
  if (await more.count()) {
    await more.click()
    await page.waitForFunction(
      (was) => (document.querySelectorAll('table tbody tr').length ?? 0) > was,
      shown,
      { timeout: 30_000 },
    )
    console.log(`после «показать ещё»: ${await table.locator('tbody tr').count()} строк`)
  }

  // --------------------------------------------- карточка компании из списка
  await table.locator('tbody tr').first().locator('a').first().click()
  await page.waitForURL(/\/clients\/.+/, { timeout: 30_000 })
  console.log(`открылась карточка: ${page.url()}`)

  const form = page.locator('form:has(textarea)').first()
  await form.waitFor({ timeout: 30_000 })
  console.log('форма записи разговора на месте')

  // ------------------------------------------------- заполняем и сохраняем
  const before = await page.locator('text=/История касаний/').innerText()
  await page.fill('textarea[name=note]', NOTE)

  const budget = page.locator('input[name=monthlyBudget]')
  if (await budget.count()) await budget.fill('45000')
  const people = page.locator('input[name=peopleServed]')
  if (await people.count()) await people.fill('30')
  const qualified = page.locator('select[name=isQualified]')
  if (await qualified.count()) await qualified.selectOption('yes')

  await page.locator('button[name=outcome][value=reached]').first().click()

  // Ждём, пока запись появится в истории — это и есть доказательство,
  // что действие дошло до базы, а не тихо отвалилось на проверке данных
  await page.locator(`text=${NOTE}`).waitFor({ timeout: 40_000 })
  console.log('запись появилась в истории')

  const after = await page.locator('text=/История касаний/').innerText()
  const was = historyCount(before)
  const now = historyCount(after)
  console.log(`записей в истории: было ${was}, стало ${now}`)
  if (now !== was + 1) throw new Error(`история не выросла на одну запись: ${was} → ${now}`)

  await page.reload({ waitUntil: 'networkidle' })
  if ((await page.locator(`text=${NOTE}`).count()) === 0) {
    throw new Error('после перезагрузки записи нет — не сохранилась')
  }
  if ((await page.locator('text=Ещё не квалифицирован').count()) > 0) {
    throw new Error('квалификация не записалась')
  }
  console.log('после перезагрузки запись на месте, клиент квалифицирован')

  await page.screenshot({ path: '../скриншоты/14-карточка-клиента.png', fullPage: true })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /показать компании/i }).first().click()
  await page.locator('table').first().waitFor({ timeout: 30_000 })
  await page.screenshot({ path: '../скриншоты/15-кампании-список.png', fullPage: true })

  await browser.close()
  console.log('\nготово')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
