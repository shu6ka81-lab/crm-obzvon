/**
 * Сумма прописью. В документах она обязательна: цифру можно дописать,
 * слово — нет, поэтому прописью считается сумма, а не проверяется.
 *
 * Тысячи женского рода: «две тысячи», а не «два тысячи».
 */
const ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
const TEENS = [
  'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
  'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать',
]
const TENS = [
  '', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят',
  'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто',
]
const HUNDREDS = [
  '', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот',
  'шестьсот', 'семьсот', 'восемьсот', 'девятьсот',
]

function group(n: number, female: boolean): string[] {
  const w: string[] = []
  if (n >= 100) w.push(HUNDREDS[Math.floor(n / 100)])
  const r = n % 100
  if (r >= 10 && r < 20) {
    w.push(TEENS[r - 10])
  } else {
    if (r >= 20) w.push(TENS[Math.floor(r / 10)])
    const u = r % 10
    if (u) w.push(female ? ONES_F[u] : ONES_M[u])
  }
  return w
}

export function plural(n: number, forms: [string, string, string]): string {
  const r10 = n % 10
  const r100 = n % 100
  if (r10 === 1 && r100 !== 11) return forms[0]
  if (r10 >= 2 && r10 <= 4 && (r100 < 12 || r100 > 14)) return forms[1]
  return forms[2]
}

export function rublesInWords(total: number): string {
  const rub = Math.floor(total)
  const kop = Math.round((total - rub) * 100)

  const words: string[] = []
  const mil = Math.floor(rub / 1_000_000)
  const thou = Math.floor((rub % 1_000_000) / 1000)
  const rest = rub % 1000

  if (mil) words.push(...group(mil, false), plural(mil, ['миллион', 'миллиона', 'миллионов']))
  if (thou) words.push(...group(thou, true), plural(thou, ['тысяча', 'тысячи', 'тысяч']))
  if (rest || (!mil && !thou)) words.push(...group(rest, false))

  const s = words.filter(Boolean).join(' ')
  const head = s ? s[0].toUpperCase() + s.slice(1) : 'Ноль'
  return `${head} ${plural(rub, ['рубль', 'рубля', 'рублей'])} ${String(kop).padStart(2, '0')} коп.`
}
