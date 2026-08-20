/**
 * Пересобирает кампании обзвона по текущим правилам отбора.
 *
 * Нужен, когда правила изменились, а новой выгрузки из 1С ещё не было:
 * обычно кампании пересобираются сами при импорте.
 *
 * Отработанные карточки не трогаются — состояние обзвона сохраняется.
 *
 * Запуск на сервере: docker compose exec app node dist-scripts/rebuild-campaigns.js
 */
import { syncCampaigns } from '../lib/import/buildCampaigns'

async function main() {
  const res = await syncCampaigns('пересборка вручную')
  console.log('Кампании:\n')
  for (const r of res) {
    console.log(`  ${String(r.total).padStart(6)}  ${r.name}${r.added ? `  (+${r.added})` : ''}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
