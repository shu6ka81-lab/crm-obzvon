/**
 * Подбор позиций каталога по строке из списка клиента.
 *
 * Клиент присылает «бумага а4 500 листов» или «Перчатки нитрил. M, 100шт» —
 * нужно найти в 80 тысячах позиций то, что он имеет в виду.
 *
 * Поиск по словам с весом по редкости: слово «бумага» встречается в тысячах
 * позиций и почти ничего не сообщает, а «нитриловые» — в десятках и потому
 * решает. Плюс отдельно ловятся числа с единицами (500 листов, 80 г/м2):
 * именно ими различаются соседние позиции одной линейки.
 */

export interface MatchCandidate {
  id: number
  code: string
  article: string | null
  name: string
  category: string | null
  unitPrice: number
  unitCost: number
  markupPct: number
  qtySold: number
  searchText: string
}

export interface MatchResult {
  item: MatchCandidate
  score: number
  /** 0–100, насколько уверенно совпало. Ниже 45 — показываем как «проверьте». */
  confidence: number
}

const STOP = new Set([
  'и', 'в', 'на', 'для', 'с', 'по', 'от', 'до', 'из', 'шт', 'штук', 'штуки',
  'уп', 'упак', 'упаковка', 'набор', 'к', 'о',
])

/** Единицы, которые встречаются в наименованиях и важны для различения. */
const UNIT_RE = /(\d+[.,]?\d*)\s*(мл|л|г|гр|кг|мм|см|м|шт|л\/с|гм2|г\/м2|листов|лист)?/gi

/**
 * Латиница в кириллицу по звучанию. Нужно, потому что бренды в каталоге
 * записаны латиницей (Greenfield, Tork), а клиенты пишут их кириллицей
 * («Гринфилд», «Торк») — без этого такие строки не находятся вообще.
 * Диграфы идут первыми, иначе «ee» разберётся как две «е».
 */
const TRANSLIT: [string, string][] = [
  ['sch', 'щ'], ['sh', 'ш'], ['ch', 'ч'], ['zh', 'ж'], ['yu', 'ю'], ['ya', 'я'],
  ['yo', 'ё'], ['ts', 'ц'], ['kh', 'х'], ['ee', 'и'], ['ea', 'и'], ['oo', 'у'],
  ['ph', 'ф'], ['ck', 'к'], ['th', 'т'], ['ou', 'у'], ['ie', 'и'], ['ay', 'ей'],
  ['a', 'а'], ['b', 'б'], ['c', 'к'], ['d', 'д'], ['e', 'е'], ['f', 'ф'],
  ['g', 'г'], ['h', 'х'], ['i', 'и'], ['j', 'дж'], ['k', 'к'], ['l', 'л'],
  ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['q', 'к'], ['r', 'р'],
  ['s', 'с'], ['t', 'т'], ['u', 'у'], ['v', 'в'], ['w', 'в'], ['x', 'кс'],
  ['y', 'й'], ['z', 'з'],
]

export function translit(s: string): string {
  let out = ''
  let i = 0
  const low = s.toLowerCase()
  outer: while (i < low.length) {
    for (const [lat, cyr] of TRANSLIT) {
      if (low.startsWith(lat, i)) {
        out += cyr
        i += lat.length
        continue outer
      }
    }
    out += low[i]
    i += 1
  }
  return out
}

const LATIN_RE = /[a-z]/i

/** Расстояние Левенштейна с ранним выходом — дальше порога считать незачем. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (cur[j] < best) best = cur[j]
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\wа-я0-9./%-]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenize(s: string): string[] {
  return normalize(s)
    .split(' ')
    .map((t) => t.replace(/^[-./]+|[-./]+$/g, ''))
    .filter((t) => t.length >= 2 && !STOP.has(t))
}

/** Числа с единицами: «500 листов», «80 г/м2», «1кг». */
export function measures(s: string): string[] {
  const out: string[] = []
  const src = normalize(s)
  let m: RegExpExecArray | null
  UNIT_RE.lastIndex = 0
  while ((m = UNIT_RE.exec(src)) !== null) {
    const value = m[1].replace(',', '.')
    const unit = (m[2] ?? '').replace('гр', 'г').replace('г/м2', 'гм2')
    if (value) out.push(unit ? `${value}${unit}` : value)
  }
  return out
}

/**
 * Индекс по словам. Строится один раз на весь каталог и переиспользуется:
 * перебирать 80 тысяч позиций на каждую строку запроса слишком дорого.
 */
export class CatalogIndex {
  private byToken = new Map<string, number[]>()
  private idf = new Map<string, number>()
  private items: MatchCandidate[] = []
  private itemTokens: string[][] = []
  private itemMeasures: string[][] = []

  /** Кириллическое звучание латинских слов → сами слова: Гринфилд → greenfield. */
  private byTranslit = new Map<string, Set<string>>()
  private vocab: string[] = []

  constructor(items: MatchCandidate[]) {
    this.items = items
    const df = new Map<string, number>()

    items.forEach((item, i) => {
      const toks = tokenize(item.searchText || item.name)
      const uniq = [...new Set(toks)]
      this.itemTokens.push(toks)
      this.itemMeasures.push(measures(item.name))

      for (const t of uniq) {
        let list = this.byToken.get(t)
        if (!list) this.byToken.set(t, (list = []))
        list.push(i)
        df.set(t, (df.get(t) ?? 0) + 1)

        if (LATIN_RE.test(t)) {
          const key = translit(t)
          let set = this.byTranslit.get(key)
          if (!set) this.byTranslit.set(key, (set = new Set()))
          set.add(t)
        }
      }
    })

    const n = items.length || 1
    for (const [t, c] of df) this.idf.set(t, Math.log(1 + n / c))
    this.vocab = [...this.byTranslit.keys()]
  }

  /**
   * Слово запроса → слова каталога. Обычно это само слово, но если его
   * в каталоге нет, ищем латинский бренд по звучанию: «гринфилд» → greenfield.
   * Опечатки и разночтения переводят по расстоянию не больше двух.
   */
  private expand(token: string): string[] {
    if (this.byToken.has(token)) return [token]
    if (token.length < 4 || LATIN_RE.test(token)) return []

    const exact = this.byTranslit.get(token)
    if (exact) return [...exact]

    const max = token.length >= 7 ? 2 : 1
    let best: string[] = []
    let bestDist = max + 1
    for (const cand of this.vocab) {
      const d = editDistance(token, cand, max)
      if (d < bestDist) {
        bestDist = d
        best = [cand]
      } else if (d === bestDist && d <= max) {
        best.push(cand)
      }
    }
    if (bestDist > max) return []
    return best.flatMap((k) => [...(this.byTranslit.get(k) ?? [])])
  }

  get size(): number {
    return this.items.length
  }

  search(query: string, limit = 5): MatchResult[] {
    const qTokens = tokenize(query)
    if (qTokens.length === 0) return []
    const qMeasures = new Set(measures(query))

    // Считаем только по позициям, где встретилось хоть одно слово запроса
    const scores = new Map<number, number>()
    let maxPossible = 0

    for (const q of new Set(qTokens)) {
      // Одно слово запроса может отвечать нескольким в каталоге —
      // берём лучшее из них, иначе бренд перевесит всё остальное
      const variants = this.expand(q)
      if (variants.length === 0) continue

      const weight = Math.max(...variants.map((v) => this.idf.get(v) ?? 0))
      maxPossible += weight

      const touched = new Set<number>()
      for (const v of variants) {
        for (const i of this.byToken.get(v) ?? []) touched.add(i)
      }
      for (const i of touched) scores.set(i, (scores.get(i) ?? 0) + weight)
    }

    if (scores.size === 0) return []

    const scored: MatchResult[] = []
    for (const [i, base] of scores) {
      let score = base

      // Совпавшие числа с единицами — сильный сигнал
      if (qMeasures.size) {
        const hit = this.itemMeasures[i].filter((m) => qMeasures.has(m)).length
        score += hit * (maxPossible * 0.25)
      }

      // Короткое наименование при равном совпадении вернее длинного:
      // «Бумага А4 Снегурочка» лучше, чем «Набор бумаги А4 и маркеров»
      const lenPenalty = 1 / (1 + Math.max(0, this.itemTokens[i].length - qTokens.length) * 0.06)
      score *= lenPenalty

      scored.push({
        item: this.items[i],
        score,
        confidence: maxPossible > 0 ? Math.min(100, Math.round((score / maxPossible) * 100)) : 0,
      })
    }

    scored.sort((a, b) => b.score - a.score || b.item.qtySold - a.item.qtySold)
    return scored.slice(0, limit)
  }
}

/** Строка из списка клиента: наименование и, если есть, количество. */
export interface RequestLine {
  raw: string
  name: string
  qty: number
}

/**
 * Разбор списка, присланного клиентом. Строки бывают вида
 * «Бумага А4 — 10 пачек», «5 шт ручки синие», «Салфетки 100 шт  20».
 */
export function parseRequestLines(input: string): RequestLine[] {
  return input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 2)
    .map((raw) => {
      let name = raw.replace(/^\s*[\d]+[.)]\s*/, '') // нумерация списка
      let qty = 1

      // Количество в конце: «— 10», «- 10 шт», «\t10»
      const tail = name.match(/[\s—–\-,;:|\t]+(\d+(?:[.,]\d+)?)\s*(шт|уп|пач|пачек|коробк\w*)?\s*$/i)
      if (tail) {
        qty = Number(tail[1].replace(',', '.')) || 1
        name = name.slice(0, tail.index).trim()
      }

      return { raw, name: name.replace(/[—–\-:;|]+$/, '').trim() || raw, qty }
    })
}
