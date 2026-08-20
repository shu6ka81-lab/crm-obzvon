/**
 * Заводит правила наценки из фактических отгрузок.
 *
 * Обычно это происходит само при загрузке прайс-листа. Команда нужна там, где
 * прайс загрузили раньше, чем появились правила.
 *
 * Запуск на сервере: docker compose exec app node dist-scripts/seed-pricing.js
 *   --force  собрать заново, затерев текущие правила
 */
import { seedDefaultRules } from '../lib/pricingRules'

async function main() {
  const force = process.argv.includes('--force')
  const res = await seedDefaultRules({ force })

  if (res.skipped) {
    console.log('Правила уже заведены. Чтобы собрать заново: --force')
    return
  }

  console.log(`Заведено правил: ${res.created}, общая наценка ${res.base}%\n`)
  for (const c of res.categories) {
    console.log(
      `  ${c.name.slice(0, 44).padEnd(46)} ${String(c.markup).padStart(3)}%   ` +
        `${(c.revenue / 1e6).toFixed(1)} млн`,
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
