/**
 * Полностью очищает базу — как на только что установленном сервере.
 * Нужен для проверки сценария «пустая база → загрузка через сайт».
 *
 * Запуск: npx tsx scripts/wipe.ts
 */
import { getDb } from '../lib/db'
import {
  campaignClients,
  campaigns,
  clients,
  importBatches,
  qualifications,
  tasks,
  touches,
} from '../lib/db/schema'

async function main() {
  const db = await getDb()
  await db.delete(tasks)
  await db.delete(qualifications)
  await db.delete(touches)
  await db.delete(campaignClients)
  await db.delete(campaigns)
  await db.delete(clients)
  await db.delete(importBatches)
  console.log('база очищена: клиентов и кампаний нет')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
