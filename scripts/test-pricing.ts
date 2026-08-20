/**
 * Проверка расчёта цены от закупки и правил наценки.
 *
 * Запуск: npx tsx scripts/test-pricing.ts
 */
import { sql } from 'drizzle-orm'
import { getDb } from '../lib/db'
import { catalogItems } from '../lib/db/schema'
import { getPricingRules, seedDefaultRules } from '../lib/pricingRules'
import { marginPct, priceFor } from '../lib/pricing'
import { runMigrations } from '../lib/db/migrate'

async function main() {
  await runMigrations()
  const db = await getDb()

  const seeded = await seedDefaultRules({ force: true })
  console.log(`Заведено правил: ${seeded.created}, общая наценка ${seeded.base}%\n`)
  for (const c of seeded.categories) {
    console.log(
      `  ${c.name.slice(0, 42).padEnd(44)} ${String(c.markup).padStart(3)}%   ` +
        `${(c.revenue / 1e6).toFixed(1)} млн`,
    )
  }

  const rules = await getPricingRules()
  console.log(`\nПравил активно: ${rules.length}\n`)

  // Берём самые ходовые позиции и сравниваем: что было и что стало
  const items = await db
    .select({
      name: catalogItems.name,
      category: catalogItems.category,
      unitCost: catalogItems.unitCost,
      unitPrice: catalogItems.unitPrice,
    })
    .from(catalogItems)
    .where(sql`${catalogItems.unitCost} > 0 and ${catalogItems.saleSum} > 0`)
    .orderBy(sql`${catalogItems.saleSum} desc`)
    .limit(12)

  console.log(
    'Позиция'.padEnd(46) + 'закупка'.padStart(9) + 'было'.padStart(10) + 'стало'.padStart(10) + '  наценка  правило',
  )
  for (const it of items) {
    const r = priceFor(rules, it)
    console.log(
      it.name.slice(0, 44).padEnd(46) +
        it.unitCost.toFixed(2).padStart(9) +
        it.unitPrice.toFixed(2).padStart(10) +
        r.price.toFixed(2).padStart(10) +
        `${r.markupPct.toFixed(0)}%`.padStart(9) +
        '  ' +
        (r.rule?.name ?? (r.fallback ? 'из истории' : '—')),
    )
  }

  // Проверки на выдуманных данных — чтобы поведение было определённым
  const fake = [
    { id: 1, name: 'Бумага', categoryPattern: 'Бумага для принтера', minCost: null, maxCost: null, markupPct: 21, priority: 10, isActive: true },
    { id: 2, name: 'Общее', categoryPattern: null, minCost: null, maxCost: null, markupPct: 43, priority: 1000, isActive: true },
  ]
  const paper = priceFor(fake, { category: 'Бумага для принтера', unitCost: 100 })
  const other = priceFor(fake, { category: 'Ручки шариковые', unitCost: 100 })
  const noCost = priceFor(fake, { category: 'Ручки', unitCost: 0, unitPrice: 55.5 })

  // Ровно тот случай, на котором расчёт ошибался: «Полотенца» входит подстрокой
  // в «Бумажные полотенца», и чужое правило перебивало своё.
  const towels = [
    { id: 3, name: 'Полотенца', categoryPattern: 'Полотенца', minCost: null, maxCost: null, markupPct: 34, priority: 10, isActive: true },
    { id: 4, name: 'Бумажные полотенца', categoryPattern: 'Бумажные полотенца', minCost: null, maxCost: null, markupPct: 48, priority: 11, isActive: true },
    { id: 5, name: 'Общее', categoryPattern: null, minCost: null, maxCost: null, markupPct: 43, priority: 1000, isActive: true },
  ]
  const paperTowel = priceFor(towels, { category: 'Бумажные полотенца', unitCost: 100 })

  console.log('\nПроверки:')
  const checks: [string, boolean, string][] = [
    ['бумага считается по своему правилу', paper.price === 121 && paper.rule?.id === 1, `${paper.price}`],
    ['остальное — по общему', other.price === 143 && other.rule?.id === 2, `${other.price}`],
    ['без закупки берётся цена из истории', noCost.price === 55.5 && noCost.fallback, `${noCost.price}`],
    ['маржа считается от продажи', Math.round(marginPct(143, 100)) === 30, `${marginPct(143, 100).toFixed(1)}`],
    [
      'похожая категория не перебивает свою',
      paperTowel.price === 148 && paperTowel.rule?.id === 4,
      `${paperTowel.price} по правилу ${paperTowel.rule?.name}`,
    ],
  ]
  let bad = 0
  for (const [what, ok, got] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${what}${ok ? '' : ` — получено ${got}`}`)
    if (!ok) bad++
  }
  if (bad) throw new Error(`не сошлось проверок: ${bad}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
