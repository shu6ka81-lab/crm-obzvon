/** Накатывает миграции на текущую базу. Запуск: npm run db:migrate */
import { runMigrations } from '../lib/db/migrate'

runMigrations()
  .then(() => {
    console.log('Миграции применены.')
    process.exit(0)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
