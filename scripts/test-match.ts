/**
 * Подбор позиций по строке клиента: проверка на живом прайсе.
 *
 * Проверяем не «что-то нашлось», а что первым идёт нужный товар и что
 * уверенность различает надёжный подбор и сомнительный. Набор случаев собран
 * из настоящих заявок и прошлых ошибок: «карандаши» не находили «карандаш»,
 * а по запросу «бумага а4» первыми шли лотки для бумаг.
 *
 * Прайс берётся из базы, а если она занята — из выгрузки JSON:
 *
 *   npx tsx scripts/test-match.ts
 *   npx tsx scripts/test-match.ts прайс.json
 */
import { readFileSync } from 'node:fs'
import { getDb } from '../lib/db'
import { catalogItems } from '../lib/db/schema'
import { CatalogIndex, parseRequestLines } from '../lib/catalog/match'

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
  // Живой звонок 21 августа: клиент попросил доску, получил губку для неё.
  // Две причины сразу — «магнитно-маркерная» не разбиралась на части,
  // а главным словом запроса считалось прилагательное «маркерную».
  ['маркерную доску', 'доска магнитно-маркерная'],
  ['доска магнитно-маркерная', 'доска магнитно-маркерная'],
  ['влажные салфетки', 'салфетк'],
  ['простые карандаши', 'карандаш прост'],
  ['туалетная бумага', 'туалетная'],
]

/** Заявка целиком — как её надиктовали роботу по телефону. */
const CALL = `бумага А4 100 пачек
карандаши простые 100 штук
ручки гелевые 100 штук
маркерную доску`

/** Запросы, которых в прайсе быть не должно: уверенность обязана просесть. */
const NONSENSE = ['экскаватор гусеничный', 'абонемент в бассейн', 'квартальный отчёт']

async function loadItems(): Promise<any[]> {
  // Выгрузка нужна, когда база занята одним процессом: в разработке её
  // держит сам сайт, и подключиться вторым нельзя.
  const dump = process.argv[2]
  if (dump) return JSON.parse(readFileSync(dump, 'utf8'))

  const db = await getDb()
  return db
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
}

async function main() {
  const items = await loadItems()

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

  console.log('\n--- заявка с живого звонка ---')
  for (const line of parseRequestLines(CALL)) {
    const top = index.search(line.name, 1)[0]
    // Ниже 60% строка уходит в КП с пометкой «проверьте». По надиктованной
    // заявке так быть не должно — иначе менеджер перепроверяет всё подряд.
    const ok = Boolean(top) && top.confidence >= 60
    if (!ok) bad++
    console.log(
      `${ok ? '✓' : '✗'} ${String(top?.confidence ?? 0).padStart(3)}%  ` +
        `«${line.raw}» ×${line.qty}\n        → ` +
        `${top ? top.item.name.slice(0, 62) : 'ничего'}`,
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
