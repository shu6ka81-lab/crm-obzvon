/**
 * Загружает все месячные отчёты «Продажи товаров по номенклатуре» в прайс-лист
 * и сразу проверяет подбор позиций на живых примерах.
 *
 * Запуск: npx tsx scripts/load-catalog.ts "путь\к\папке"
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { getDb } from '../lib/db'
import { catalogItems } from '../lib/db/schema'
import { importCatalogReport } from '../lib/import/importCatalog'
import { CatalogIndex, parseRequestLines } from '../lib/catalog/match'

const DIR =
  process.argv[2] ??
  String.raw`C:\Users\ден\AppData\Local\Temp\claude\C------\e1542c5d-5a29-47fd-a1aa-ab578ee5cb93\scratchpad\lev\zip\Для Льва`

async function main() {
  const db = await getDb()

  const files = readdirSync(DIR)
    .filter((f) => /Продажи_товаров_Номенклатура.*\.xlsx$/i.test(f))
    .sort()

  console.log(`Файлов найдено: ${files.length}\n`)

  for (const f of files) {
    const res = await importCatalogReport(readFileSync(path.join(DIR, f)))
    console.log(
      `  ${f.padEnd(42)} ${String(res.period ?? '').padEnd(16)} ` +
        `товаров ${String(res.rows).padStart(5)}, групп ${res.groups}`,
    )
    res.warnings.forEach((w) => console.log('    ⚠ ' + w))
  }

  const [{ total, withPrice }] = await db
    .select({
      total: sql<number>`count(*)::int`,
      withPrice: sql<number>`count(*) filter (where ${catalogItems.unitPrice} > 0)::int`,
    })
    .from(catalogItems)
  console.log(`\nВсего позиций в прайс-листе: ${total} (с ценой: ${withPrice})`)

  // ---------------------------------------------------------- проверка подбора
  console.log('\nПроверка подбора на типичных строках из списка клиента:\n')

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
  console.log(`индекс построен по ${index.size} позициям за ${Date.now() - t0} мс\n`)

  const sample = `Бумага А4 500 листов — 20 пачек
Перчатки нитриловые M 100шт
Кофе в зернах 1 кг
Туалетная бумага 2 слоя
Ручка шариковая синяя 50
Салфетки бумажные 100 шт
мешки для мусора 120 л
Чай Гринфилд пакетированный`

  for (const line of parseRequestLines(sample)) {
    const found = index.search(line.name, 3)
    console.log(`«${line.raw}»  (кол-во: ${line.qty})`)
    if (!found.length) {
      console.log('    ничего не найдено')
    }
    for (const f of found) {
      console.log(
        `    ${String(f.confidence).padStart(3)}%  ${f.item.name.slice(0, 58).padEnd(60)}` +
          `${f.item.unitPrice.toFixed(0).padStart(9)} ₽  наценка ${f.item.markupPct.toFixed(0)}%`,
      )
    }
    console.log()
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
