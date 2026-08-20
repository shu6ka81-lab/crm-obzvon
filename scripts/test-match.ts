/**
 * Подбор позиций по строке клиента: проверка на живом прайсе.
 *
 * Проверяем не «что-то нашлось», а что первым идёт нужный товар и что
 * уверенность различает надёжный подбор и сомнительный. Набор случаев собран
 * из настоящих заявок и прошлых ошибок: «карандаши» не находили «карандаш»,
 * а по запросу «бумага а4» первыми шли лотки для бумаг.
 *
 * Запуск: npx tsx scripts/test-match.ts
 */
import { getDb } from '../lib/db'
import { catalogItems } from '../lib/db/schema'
import { CatalogIndex } from '../lib/catalog/match'

/** запрос → что должно быть в наименовании первой строки */
const CASES: [string, string][] = [
  ['Бумага а4', 'бумага'],
  ['бумага для принтера а4 500 листов', 'бумага'],
  ['карандаши простые', 'карандаш'],
  ['Линейка 20см', 'линейка'],
  ['перчатки нитриловые', 'перчатк'],
  ['салфетки влажные', 'салфетк'],
  ['мешки для мусора 120 л', 'мешк'],
  ['туалетная бумага 2 слоя', 'туалетная бумага'],
  ['стаканы одноразовые', 'стакан'],
  ['папка регистратор', 'папка'],
  ['ручка шариковая синяя', 'ручка'],
  ['скрепки 28мм', 'скрепк'],
  ['ножницы канцелярские', 'ножниц'],
  ['клей карандаш', 'клей'],
  ['кофе растворимый', 'кофе'],
]

/** Запросы, которых в прайсе быть не должно: уверенность обязана просесть. */
const NONSENSE = ['экскаватор гусеничный', 'абонемент в бассейн', 'квартальный отчёт']

async function main() {
  const db = await getDb()
  const items = await db
    .select({
      id: catalogItems.id,
      code: catalogItems.code,
      article: catalogItems.article,
      name: catalogItems.name,
      category: catalogItems.category,
      unitPrice: catalogItems.unitPrice,
      unitCost: catalogItems.unitCost,
      markupPct: catalogItems.markupPct,
      qtySold: catalogItems.qtySold,
      searchText: catalogItems.searchText,
    })
    .from(catalogItems)

  const t0 = Date.now()
  const index = new CatalogIndex(items)
  console.log(`индекс: ${index.size} позиций за ${Date.now() - t0} мс\n`)

  let bad = 0
  for (const [query, expect] of CASES) {
    const found = index.search(query, 1)
    const top = found[0]
    const ok = Boolean(top) && top.item.name.toLowerCase().includes(expect.toLowerCase())
    if (!ok) bad++
    console.log(
      `${ok ? '✓' : '✗'} ${String(top?.confidence ?? 0).padStart(3)}%  «${query}»\n` +
        `        → ${top ? top.item.name.slice(0, 66) : 'ничего не найдено'}`,
    )
  }

  console.log('\n--- чего в прайсе нет ---')
  for (const query of NONSENSE) {
    const top = index.search(query, 1)[0]
    const conf = top?.confidence ?? 0
    const ok = conf < 60
    if (!ok) bad++
    console.log(
      `${ok ? '✓' : '✗'} ${String(conf).padStart(3)}%  «${query}» → ` +
        `${top ? top.item.name.slice(0, 54) : 'ничего'}`,
    )
  }

  // Скорость важна: подбор идёт по каждой строке заявки, строк бывает полсотни
  const t1 = Date.now()
  for (let k = 0; k < 50; k++) index.search(CASES[k % CASES.length][0], 5)
  console.log(`\n50 запросов за ${Date.now() - t1} мс`)

  if (bad) {
    console.error(`\nне сошлось: ${bad}`)
    process.exit(1)
  }
  console.log('\nвсё сошлось')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
