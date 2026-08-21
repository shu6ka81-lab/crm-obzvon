import { getDb } from './db'
import { quoteItems, quotes } from './db/schema'
import { getCatalogIndex } from './catalog'
import { parseRequestLines } from './catalog/match'
import { getPricingRules } from './pricingRules'
import { priceFor, roundPrice } from './pricing'

/**
 * Черновик КП прямо из разговора.
 *
 * Клиент по телефону называет, что ему нужно, — и к моменту, когда менеджер
 * положил трубку, предложение уже собрано и посчитано. Раньше между этими
 * двумя событиями лежал час ручной работы, и часть заявок в этот час умирала.
 *
 * Собирается именно черновик: подбор по названиям на слух ошибается, и
 * отправлять такое клиенту без проверки нельзя. Задача — снять рутину,
 * а не подменить менеджера.
 */

/**
 * Разговорные зачины перед названием товара.
 *
 * Живая речь начинается не с товара: «нам нужна бумага», «давайте ещё
 * карандаши». Подбор считает главным первое слово фразы — и по «нам нужна
 * бумага а4» первой шла «Папка на 4-х кольцах А4», потому что от «бумаги»
 * в голове алгоритма ничего не осталось.
 */
const LEAD_IN =
  /^(?:а|и|ещё|еще|также|нам|мне|нужн[аоы]?|надо|требуетс[яь]|хотел[аи]?\s+бы|хотим|давайте|пришлите|посчитайте|закажите|заказыва[а-яё]+|возьм[а-яё]+|берём|берем|это)\s+/i

function stripLeadIn(s: string): string {
  let out = s.trim()
  // Зачины идут цепочкой: «а нам ещё нужно…»
  for (let i = 0; i < 5; i++) {
    const next = out.replace(LEAD_IN, '').trim()
    if (next === out) break
    out = next
  }
  return out
}

/** Строки, похожие на «что нам нужно», из речи клиента. */
export function itemsFromTranscript(transcript: string): string[] {
  const out: string[] = []

  for (const raw of transcript.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    // Берём только реплики клиента: то, что предлагал робот, заказом не является
    const m = line.match(/^(клиент|собеседник|customer|user)\s*[:—-]\s*(.+)$/i)
    if (!m) continue

    // Внутри реплики перечисление обычно идёт через запятую или «и»
    for (const part of m[2].split(/[;,]|(?:\s+и\s+)/)) {
      const piece = stripLeadIn(part)
      if (piece.length < 4) continue
      // Без числа это не позиция заказа, а разговор
      if (!/\d/.test(piece)) continue
      out.push(piece)
    }
  }

  return out
}

export interface DraftQuote {
  quoteId: number
  lines: number
  weak: number
  total: number
}

export async function buildQuoteFromCall(input: {
  clientId: number
  campaignClientId?: number | null
  /** Что клиент назвал — построчно. Если пусто, попробуем достать из разговора. */
  items?: string[]
  transcript?: string | null
  note?: string | null
}): Promise<DraftQuote | null> {
  const raw = (input.items?.length ? input.items : itemsFromTranscript(input.transcript ?? ''))
    .map((s) => s.trim())
    .filter(Boolean)

  if (raw.length === 0) return null

  const [index, rules] = await Promise.all([getCatalogIndex(), getPricingRules()])
  const parsed = parseRequestLines(raw.join('\n'))
  if (parsed.length === 0) return null

  const rows = parsed.map((line, i) => {
    const found = index.search(line.name, 1)[0]
    if (!found) {
      return {
        lineNo: i + 1,
        rawLine: line.raw,
        qty: line.qty,
        catalogItemId: null,
        name: line.raw,
        unitPrice: 0,
        unitCost: 0,
        suggestedPrice: 0,
        ruleId: null as number | null,
        confidence: 0,
        isManual: true,
      }
    }
    const p = priceFor(rules, found.item)
    return {
      lineNo: i + 1,
      rawLine: line.raw,
      qty: line.qty,
      catalogItemId: found.item.id,
      name: found.item.name,
      unitPrice: p.price,
      unitCost: roundPrice(found.item.unitCost),
      suggestedPrice: p.price,
      ruleId: p.rule?.id ?? null,
      confidence: found.confidence,
      isManual: false,
    }
  })

  const db = await getDb()
  const totalSale = rows.reduce((s, r) => s + r.unitPrice * r.qty, 0)
  const totalCost = rows.reduce((s, r) => s + r.unitCost * r.qty, 0)

  const [quote] = await db
    .insert(quotes)
    .values({
      clientId: input.clientId,
      campaignClientId: input.campaignClientId ?? null,
      rawInput: raw.join('\n'),
      note:
        'Собрано автоматически из разговора' +
        (input.note ? ` · ${input.note}` : '') +
        '. Проверьте позиции и цены перед отправкой.',
      totalSale: Math.round(totalSale),
      totalCost: Math.round(totalCost),
    })
    .returning({ id: quotes.id })

  await db.insert(quoteItems).values(rows.map((r) => ({ ...r, quoteId: quote.id })))

  return {
    quoteId: quote.id,
    lines: rows.length,
    weak: rows.filter((r) => r.isManual || r.confidence < 60).length,
    total: Math.round(totalSale),
  }
}
