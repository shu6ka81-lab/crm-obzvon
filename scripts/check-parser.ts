/**
 * Проверка парсера на настоящей выгрузке из 1С.
 * Запуск: npx tsx scripts/check-parser.ts "путь\к\файлу.xlsx"
 */
import { readFileSync } from 'node:fs'
import { parseActivityReport } from '../lib/import/parse1c'

const file =
  process.argv[2] ?? String.raw`C:\Users\ден\Downloads\Kontragenty_Aktivnost_26.xlsx`

async function main() {
  const buf = readFileSync(file)
  const t0 = Date.now()
  const { reportDate, clients, warnings } = await parseActivityReport(buf)

  console.log(`файл:        ${file}`)
  console.log(`дата отчёта: ${reportDate}`)
  console.log(`клиентов:    ${clients.length}`)
  console.log(`время:       ${Date.now() - t0} мс`)

  const bySegment = new Map<string, { n: number; sum: number }>()
  for (const c of clients) {
    const acc = bySegment.get(c.segment) ?? { n: 0, sum: 0 }
    acc.n += 1
    acc.sum += c.totalSum
    bySegment.set(c.segment, acc)
  }
  console.log('\nпо сегментам:')
  for (const [seg, v] of [...bySegment].sort((a, b) => b[1].sum - a[1].sum)) {
    console.log(`  ${seg.padEnd(10)} ${String(v.n).padStart(6)}  ${v.sum.toLocaleString('ru-RU')} ₽`)
  }

  const once = clients.filter((c) => c.shipmentsCount === 1)
  const big = once.filter((c) => c.totalSum >= 50_000)
  console.log(`\nразовых покупателей: ${once.length}`)
  console.log(`из них с чеком >= 50 000: ${big.length}`)
  console.log(`сумма топ-175: ${big.slice(0, 175).reduce((s, c) => s + c.totalSum, 0).toLocaleString('ru-RU')} ₽`)

  console.log('\nтоп-5 разовых:')
  for (const c of [...big].sort((a, b) => b.totalSum - a.totalSum).slice(0, 5)) {
    console.log(
      `  ${c.name.slice(0, 40).padEnd(42)} ${c.totalSum.toLocaleString('ru-RU').padStart(12)} ₽  ${c.lastOrderDate ?? '—'}`,
    )
  }

  console.log('\nполнота полей:')
  const filled = (f: (c: (typeof clients)[number]) => unknown) =>
    clients.filter((c) => {
      const v = f(c)
      return v !== null && v !== undefined && v !== '' && v !== 0
    }).length
  console.log(`  менеджер:          ${filled((c) => c.manager1c)}`)
  console.log(`  дата отгрузки:     ${filled((c) => c.lastOrderDate)}`)
  console.log(`  комментарий:       ${filled((c) => c.comment1c)}`)
  console.log(`  дата комментария:  ${filled((c) => c.comment1cDate)}`)
  console.log(`  сумма:             ${filled((c) => c.totalSum)}`)

  if (warnings.length) {
    console.log(`\nпредупреждений: ${warnings.length}`)
    warnings.slice(0, 10).forEach((w) => console.log('  ' + w))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
