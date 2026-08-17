/**
 * Стирает результаты обзвона (касания, квалификацию, задачи) и возвращает
 * очереди кампаний в исходное состояние. Клиентов и кампании не трогает.
 *
 * Нужно, чтобы убрать тестовые записи перед реальным обзвоном.
 * Запуск: npm run db:reset-activity
 */
import { getDb } from '../lib/db'
import { campaignClients, qualifications, tasks, touches } from '../lib/db/schema'

async function main() {
  const db = await getDb()

  await db.delete(tasks)
  await db.delete(qualifications)
  await db.delete(touches)
  await db.update(campaignClients).set({ state: 'pending' })

  console.log('Касания, квалификация и задачи удалены. Очереди кампаний сброшены.')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
