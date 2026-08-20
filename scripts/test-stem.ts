/**
 * Основы слов: формы одного слова должны сходиться, разные слова — нет.
 * Запуск: npx tsx scripts/test-stem.ts
 */
import { stem, stems } from '../lib/catalog/stem'

/** Слова считаем сходящимися, если совпала хоть одна допустимая основа. */
function agree(a: string, b: string): boolean {
  const sa = new Set(stems(a))
  return stems(b).some((s) => sa.has(s))
}

/** Формы, которые обязаны дать одну основу. */
const SAME: string[][] = [
  ['карандаш', 'карандаши', 'карандашей', 'карандашами'],
  ['бумага', 'бумаги', 'бумагу', 'бумагой'],
  ['линейка', 'линейки', 'линейку'],
  ['простой', 'простые', 'простая', 'простых'],
  ['перчатки', 'перчаток', 'перчатками'],
  ['салфетка', 'салфетки', 'салфеток'],
  ['стакан', 'стаканы', 'стаканов'],
  ['полотенце', 'полотенца', 'полотенцем'],
]

/** Разные товары, которые нельзя схлопывать в одну основу. */
const DIFFERENT: [string, string][] = [
  ['бумага', 'бумажник'],
  ['мыло', 'мыльница'],
  ['ручка', 'ручной'],
  ['папка', 'папирос'],
  ['вода', 'водка'],
  ['кофе', 'кофта'],
]

let bad = 0

console.log('--- формы одного слова ---')
for (const forms of SAME) {
  const ok = forms.every((f) => agree(f, forms[0]))
  if (!ok) bad++
  console.log(`${ok ? '✓' : '✗'} ${forms.join(', ')} → ${forms.map((f) => stems(f).join('|')).join('  ')}`)
}

console.log('\n--- разные слова ---')
for (const [a, b] of DIFFERENT) {
  const ok = !agree(a, b)
  if (!ok) bad++
  console.log(`${ok ? '✓' : '✗'} ${a} → ${stems(a).join('|')}   ${b} → ${stems(b).join('|')}`)
}

console.log('\n--- короткие не трогаем ---')
for (const w of ['сок', 'мел', 'нож', 'чай', 'лак']) {
  const ok = stem(w) === w
  if (!ok) bad++
  console.log(`${ok ? '✓' : '✗'} ${w} → ${stem(w)}`)
}

if (bad) {
  console.error(`\nне сошлось: ${bad}`)
  process.exit(1)
}
console.log('\nвсё сошлось')
