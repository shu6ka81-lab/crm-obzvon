/**
 * Экран обзвона: номер вписывается прямо там, и оттуда же вызывается робот.
 *
 * Форма контактов сначала появилась только в карточке клиента, а работают
 * менеджеры на экране обзвона — там блок «Куда звонить» так и остался
 * только для чтения. Проверка закрывает именно этот разрыв.
 *
 * Запуск (дев-сервер должен быть поднят): npx tsx scripts/test-call-screen-phone.ts
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const LOGIN = process.argv[3] ?? 'denis'
const PASSWORD = process.argv[4] ?? 'OfisSluzhba2026!'

const PHONE = '+7 812 555-11-22'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 1100 } })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name=login]', LOGIN)
  await page.fill('input[name=password]', PASSWORD)
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')])

  // Идём туда же, куда ходит менеджер: кампания → «Звонить»
  await page.locator('a[href^="/call/"]').first().click()
  await page.waitForURL(/\/call\/\d+/, { timeout: 30_000 })
  const company = (await page.locator('h1').innerText()).trim()
  console.log(`экран обзвона: ${company}`)

  const phoneField = page.locator('input[name=phone]')
  if ((await phoneField.count()) === 0) throw new Error('на экране обзвона нет поля телефона')
  console.log('поле телефона на месте')

  // Стираем номер от прошлого прогона: без этого проверка «кнопка
  // заблокирована без телефона» второй раз не имеет смысла
  await phoneField.fill('')
  await page.locator('form:has(input[name=phone]) button[type=submit]').click()
  await page.locator('text=Сохранено').first().waitFor({ timeout: 20_000 })
  await page.reload({ waitUntil: 'networkidle' })

  const callBtn = page.getByRole('button', { name: /позвонить роботом/i })
  if ((await callBtn.count()) === 0) throw new Error('на экране обзвона нет кнопки звонка')
  if (!(await callBtn.isDisabled())) throw new Error('кнопка активна, хотя телефона нет')
  console.log('кнопка звонка на месте и заблокирована без телефона')

  // ------------------------------------------------ вписываем и сохраняем
  await phoneField.fill(PHONE)
  await page.fill('input[name=contactPerson]', 'Пётр, снабжение')
  await page.locator('form:has(input[name=phone]) button[type=submit]').click()
  await page.locator('text=Сохранено').first().waitFor({ timeout: 20_000 })

  await page.reload({ waitUntil: 'networkidle' })
  const saved = await page.locator('input[name=phone]').inputValue()
  if (saved !== PHONE) throw new Error(`телефон не сохранился: «${saved}»`)
  console.log(`телефон сохранён и виден после перезагрузки: ${saved}`)

  // ------------------------------------------------------- заказываем звонок
  const btn = page.getByRole('button', { name: /позвонить роботом/i })
  if (await btn.isDisabled()) throw new Error('кнопка осталась заблокированной с телефоном')
  await btn.click()

  /*
   * Ждём именно ответ сервера, а не надпись на кнопке. Кнопка на время
   * отправки сама пишет «Ставлю в очередь…», и проверка по слову «очередь»
   * проходила бы, даже если заявка никуда не сохранилась.
   */
  const answer = page.locator('text=/Робот позвонит|Заявка уже в очереди|Сначала впишите/i')
  await answer.first().waitFor({ timeout: 20_000 })
  const msg = (await answer.first().innerText()).trim()
  console.log(`ответ на заказ звонка: ${msg}`)
  if (/Сначала впишите/i.test(msg)) throw new Error('сервер не увидел телефон')

  await page.screenshot({ path: '../скриншоты/20-обзвон-телефон.png', fullPage: true })
  await browser.close()
  console.log('\nготово')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
