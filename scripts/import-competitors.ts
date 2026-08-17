/**
 * Загружает списки покупателей конкурентов (книги продаж из деклараций по НДС).
 *
 * Запуск: npx tsx scripts/import-competitors.ts <файл.xlsx> [ещё файлы...]
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runMigrations } from '../lib/db/migrate'
import { importCompetitorReport } from '../lib/import/importCompetitor'

async function main() {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error('Укажите хотя бы один файл')
    process.exit(1)
  }

  await runMigrations()

  for (const file of files) {
    console.log(`\n=== ${path.basename(file)}`)
    const res = await importCompetitorReport(readFileSync(file), path.basename(file))
    console.log(`  поставщик:            ${res.supplier}`)
    console.log(`  период:               ${res.period ?? '—'}`)
    console.log(`  покупателей в файле:  ${res.parsed}`)
    console.log(`  новых компаний:       ${res.created}`)
    console.log(`  уже были в базе:      ${res.updated}`)
    console.log(`  возможно, свои:       ${res.possiblyOwn}  (в конец очереди, с пометкой)`)
    if (res.warnings.length) {
      console.log(`  предупреждений:       ${res.warnings.length}`)
      res.warnings.slice(0, 5).forEach((w) => console.log('    ' + w))
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
