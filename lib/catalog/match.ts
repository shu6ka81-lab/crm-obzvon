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

import { stem, stems } from './stem'

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
const CYR_RE = /^[а-яё]+$/i

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
  /** Поиск идёт по основам слов: «карандаши» из запроса и «карандаш» в прайсе
   *  должны попадать в одну ячейку, иначе слово просто выпадает из поиска. */
  private byStem = new Map<string, number[]>()
  private idf = new Map<string, number>()
  private items: MatchCandidate[] = []
  private itemStems: Set<string>[] = []
  private itemTokens: string[][] = []
  private itemMeasures: string[][] = []

  /** Кириллическое звучание латинских слов → сами слова: Гринфилд → greenfield. */
  private byTranslit = new Map<string, Set<string>>()
  private translitVocab: string[] = []
  /** Основы кириллических слов — по ним ищем опечатки. */
  private stemVocab: string[] = []
  /** Вес слова, которого в прайсе нет: реже него не встречается ничто. */
  private maxIdf = 0

  constructor(items: MatchCandidate[]) {
    this.items = items
    const df = new Map<string, number>()

    items.forEach((item, i) => {
      const toks = tokenize(item.searchText || item.name)
      this.itemTokens.push(toks)
      this.itemMeasures.push(measures(item.name))

      const st = new Set<string>()
      for (const t of toks) for (const s of stems(t)) st.add(s)
      this.itemStems.push(st)

      for (const s of st) {
        let list = this.byStem.get(s)
        if (!list) this.byStem.set(s, (list = []))
        list.push(i)
        df.set(s, (df.get(s) ?? 0) + 1)
      }

      for (const t of new Set(toks)) {
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
    this.maxIdf = Math.log(1 + n)
    this.translitVocab = [...this.byTranslit.keys()]
    this.stemVocab = [...this.byStem.keys()].filter((s) => s.length >= 5 && CYR_RE.test(s))
  }

  /**
   * Слово запроса → слова каталога. Обычно это само слово, но если его
   * в каталоге нет, ищем латинский бренд по звучанию: «гринфилд» → greenfield.
   * Опечатки и разночтения переводят по расстоянию не больше двух.
   */
  private expand(token: string): string[] {
    // Прямое попадание по основе — обычный случай
    const direct = stems(token).filter((s) => this.byStem.has(s))
    if (direct.length) return direct

    if (token.length < 4) return []

    // Латинский бренд, записанный кириллицей: «гринфилд» → greenfield
    if (!LATIN_RE.test(token)) {
      const exact = this.byTranslit.get(token)
      if (exact) return [...exact].flatMap((t) => stems(t)).filter((s) => this.byStem.has(s))
    }

    // Опечатка. Ищем ближайшую основу, но только если запас расстояния мал:
    // на длинных словах две правки уже уводят в другой товар.
    const base = stem(token)
    const max = base.length >= 8 ? 2 : 1
    const vocab = LATIN_RE.test(token) ? [] : [...this.stemVocab, ...this.translitVocab]

    let best: string[] = []
    let bestDist = max + 1
    for (const cand of vocab) {
      if (Math.abs(cand.length - base.length) > max) continue
      const d = editDistance(base, cand, max)
      if (d < bestDist) {
        bestDist = d
        best = [cand]
      } else if (d === bestDist && d <= max) {
        best.push(cand)
      }
    }
    if (bestDist > max) return []

    return best.flatMap((k) =>
      this.byStem.has(k)
        ? [k]
        : [...(this.byTranslit.get(k) ?? [])].flatMap((t) => stems(t)).filter((s) => this.byStem.has(s)),
    )
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
    const qStems = new Set<string>()
    let maxPossible = 0

    for (const q of new Set(qTokens)) {
      for (const s of stems(q)) qStems.add(s)
      // Одно слово запроса может отвечать нескольким в каталоге —
      // берём лучшее из них, иначе бренд перевесит всё остальное
      const variants = this.expand(q)

      /*
       * Слово, которого в прайсе нет вовсе, раньше просто выбрасывалось —
       * и не попадало в знаменатель. Из-за этого «абонемент в бассейн»
       * получал 70%: «абонемент» исчезал, «бассейн» совпадал целиком, и
       * чистящее средство для бассейна выглядело надёжной находкой.
       *
       * Теперь такое слово остаётся в знаменателе с весом самого редкого:
       * отсутствующее в каталоге из 22 тысяч позиций встречается реже всего.
       * Совпадение честно проседает, и строка помечается «проверьте».
       */
      if (variants.length === 0) {
        maxPossible += this.maxIdf
        continue
      }

      const weight = Math.max(...variants.map((v) => this.idf.get(v) ?? 0))
      maxPossible += weight

      const touched = new Set<number>()
      for (const v of variants) {
        for (const i of this.byStem.get(v) ?? []) touched.add(i)
      }
      for (const i of touched) scores.set(i, (scores.get(i) ?? 0) + weight)
    }

    if (scores.size === 0) return []

    // Основа первого слова запроса — это то, что клиент просит по сути.
    // «Бумага а4»: важна бумага, а «а4» лишь уточнение.
    const qHead = new Set(stems(qTokens[0]))

    const scored: MatchResult[] = []
    for (const [i, base] of scores) {
      let score = base

      // Совпавшие числа с единицами — сильный сигнал
      if (qMeasures.size) {
        const hit = this.itemMeasures[i].filter((m) => qMeasures.has(m)).length
        score += hit * (maxPossible * 0.25)
      }

      /*
       * Главное слово наименования стоит первым: «Бумага Илим…», «Ватман А4…»,
       * «Лотки для бумаг… А4». Без учёта этого по запросу «бумага а4» первыми
       * шли лотки: слово «бумаг» в них есть, товар совсем другой.
       */
      const head = this.itemTokens[i][0]
      let headFactor = 0.7
      if (head) {
        const headStems = stems(head)
        if (headStems.some((s) => qHead.has(s))) headFactor = 1
        else if (headStems.some((s) => qStems.has(s))) headFactor = 0.85
      }
      score *= 0.7 + headFactor

      // Короткое наименование при равном совпадении вернее длинного:
      // «Бумага А4 Снегурочка» лучше, чем «Набор бумаги А4 и маркеров».
      // Штраф мягкий и ограничен: подробное название — не признак ошибки.
      const extra = Math.max(0, this.itemTokens[i].length - qTokens.length)
      const lenPenalty = Math.max(0.75, 1 / (1 + extra * 0.04))
      score *= lenPenalty

      /*
       * Уверенность и оценка считаются по-разному, и это намеренно.
       *
       * Оценка ранжирует: в неё входят надбавки за главное слово и за
       * совпавшие размеры. Уверенность отвечает на другой вопрос — «насколько
       * это вообще похоже на то, что просили», и складывается из доли
       * совпавшего запроса и согласия по главному слову.
       *
       * Пока они были одним числом, надбавки задирали уверенность до потолка:
       * все варианты показывали 100%, и предупреждение «проверьте» не срабатывало
       * никогда — менеджер терял единственную подсказку, где подбор ненадёжен.
       */
      const coverage = maxPossible > 0 ? base / maxPossible : 0
      scored.push({
        item: this.items[i],
        score,
        confidence: Math.min(100, Math.round(coverage * headFactor * 100)),
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

      /*
       * Количество в конце: «— 10», «- 10 шт», «100 штук», «20 пачек».
       *
       * Единицы перечислены полностью, а не через `\w*`: в JavaScript `\w`
       * это только латиница, и «штук» после «шт» не подхватывалось —
       * количество молча превращалось в единицу, а хвост уезжал в название.
       */
      const tail = name.match(
        /[\s—–\-,;:|\t]+(\d+(?:[.,]\d+)?)\s*(шт\.?|штук[аи]?|уп\.?|упак\.?|упаковк[аи]|упаковок|пач\.?|пачк[аи]|пачек|коробк[аи]|коробок|рулон[аов]*|компл\.?|комплект[аов]*)?\s*$/i,
      )
      if (tail) {
        qty = Number(tail[1].replace(',', '.')) || 1
        name = name.slice(0, tail.index).trim()
      }

      return { raw, name: name.replace(/[—–\-:;|]+$/, '').trim() || raw, qty }
    })
}
