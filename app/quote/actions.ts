'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db'
import { pricingRules, quoteItems, quotes, users } from '@/lib/db/schema'
import { getCatalogIndex } from '@/lib/catalog'
import { parseRequestLines } from '@/lib/catalog/match'
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'
import { getPricingRules } from '@/lib/pricingRules'
import { priceFor, roundPrice } from '@/lib/pricing'
import type { MatchedLine } from '@/lib/quote'



async function currentUserId(): Promise<number | null> {
  const jar = await cookies()
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value)
  return session?.userId ?? null
}

/**
 * Подбор без сохранения — чтобы менеджер сначала посмотрел, что нашлось.
 *
 * Цена считается от закупки по правилам наценки, а не берётся средней из
 * прошлых отгрузок: средняя тянет за собой все разовые скидки и распродажи.
 * Историческую цену возвращаем рядом — по расхождению видно, где раньше
 * продавали не так, как собирались.
 */
export async function matchRequest(text: string): Promise<MatchedLine[]> {
  const [index, rules] = await Promise.all([getCatalogIndex(), getPricingRules()])

  return parseRequestLines(text).map((line, i) => ({
    lineNo: i + 1,
    raw: line.raw,
    qty: line.qty,
    options: index.search(line.name, 5).map((m) => {
      const p = priceFor(rules, m.item)
      return {
        id: m.item.id,
        code: m.item.code,
        name: m.item.name,
        unitPrice: p.price,
        unitCost: roundPrice(m.item.unitCost),
        markupPct: Math.round(p.fallback ? m.item.markupPct : p.markupPct),
        confidence: m.confidence,
        category: m.item.category,
        ruleId: p.rule?.id ?? null,
        ruleName: p.rule?.name ?? null,
        historicPrice: roundPrice(m.item.unitPrice),
      }
    }),
  }))
}

const SaveSchema = z.object({
  clientId: z.coerce.number().int().positive(),
  campaignClientId: z.coerce.number().int().positive().optional(),
  rawInput: z.string().max(50_000).optional(),
  note: z.string().max(2000).optional(),
  items: z
    .array(
      z.object({
        lineNo: z.number().int(),
        rawLine: z.string(),
        qty: z.number().positive(),
        catalogItemId: z.number().int().positive().nullable(),
        name: z.string().min(1),
        unitPrice: z.number().min(0),
        unitCost: z.number().min(0),
        suggestedPrice: z.number().min(0).nullable().optional(),
        ruleId: z.number().int().positive().nullable().optional(),
        clientPrice: z.number().min(0).nullable().optional(),
        marketPrice: z.number().min(0).nullable().optional(),
        priceEdited: z.boolean().optional(),
        confidence: z.number().int().min(0).max(100),
        isManual: z.boolean(),
      }),
    )
    .min(1),
})

export async function saveQuote(input: unknown) {
  const parsed = SaveSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }
  }
  const d = parsed.data
  const db = await getDb()
  const userId = await currentUserId()

  const totalSale = d.items.reduce((s, it) => s + it.unitPrice * it.qty, 0)
  const totalCost = d.items.reduce((s, it) => s + it.unitCost * it.qty, 0)

  const [quote] = await db
    .insert(quotes)
    .values({
      clientId: d.clientId,
      campaignClientId: d.campaignClientId,
      rawInput: d.rawInput,
      note: d.note,
      totalSale: Math.round(totalSale),
      totalCost: Math.round(totalCost),
      createdBy: userId,
    })
    .returning({ id: quotes.id })

  await db.insert(quoteItems).values(
    d.items.map((it) => ({
      quoteId: quote.id,
      lineNo: it.lineNo,
      rawLine: it.rawLine,
      qty: it.qty,
      catalogItemId: it.catalogItemId,
      name: it.name,
      unitPrice: it.unitPrice,
      unitCost: it.unitCost,
      suggestedPrice: it.suggestedPrice ?? it.unitPrice,
      ruleId: it.ruleId ?? null,
      clientPrice: it.clientPrice ?? null,
      marketPrice: it.marketPrice ?? null,
      priceEdited: it.priceEdited ?? false,
      confidence: it.confidence,
      isManual: it.isManual,
    })),
  )

  revalidatePath('/')
  return { ok: true as const, quoteId: quote.id }
}

export interface LineState {
  ok: boolean
  message: string
}

/**
 * Тот же приём, что и в остальных формах: пустое поле приходит пустой строкой,
 * а необязательное число её не принимает — и правка молча пропадает.
 * Пустая строка здесь значит «очистить», поэтому превращаем её в null.
 */
export async function editQuoteItem(
  _prev: LineState | null,
  formData: FormData,
): Promise<LineState> {
  const raw: Record<string, unknown> = {}
  for (const [k, v] of formData.entries()) {
    if (typeof v !== 'string') continue
    if (k === 'clientPrice' || k === 'marketPrice') raw[k] = v.trim() === '' ? null : v
    else if (v.trim() !== '') raw[k] = v
  }

  const res = await updateQuoteItem(raw)
  return res.ok
    ? { ok: true, message: 'Сохранено' }
    : { ok: false, message: res.error ?? 'Не сохранилось' }
}

const EditItemSchema = z.object({
  itemId: z.coerce.number().int().positive(),
  qty: z.coerce.number().positive().optional(),
  unitPrice: z.coerce.number().min(0).optional(),
  clientPrice: z.coerce.number().min(0).nullable().optional(),
  marketPrice: z.coerce.number().min(0).nullable().optional(),
})

/**
 * Правка строки в уже сохранённом КП.
 *
 * Правило наценки даёт отправную цену, но последнее слово за менеджером:
 * он знает про объём, историю и то, что клиент назвал по телефону. Поэтому
 * правленую цену помечаем — чтобы пересчёт по правилам её не затирал.
 */
export async function updateQuoteItem(input: unknown) {
  const parsed = EditItemSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }
  }
  const d = parsed.data
  const db = await getDb()

  const [item] = await db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.id, d.itemId))
    .limit(1)
  if (!item) return { ok: false as const, error: 'Строка не найдена' }

  const priceChanged = d.unitPrice != null && d.unitPrice !== item.unitPrice

  await db
    .update(quoteItems)
    .set({
      qty: d.qty ?? item.qty,
      unitPrice: d.unitPrice ?? item.unitPrice,
      clientPrice: d.clientPrice === undefined ? item.clientPrice : d.clientPrice,
      marketPrice: d.marketPrice === undefined ? item.marketPrice : d.marketPrice,
      priceEdited: item.priceEdited || priceChanged,
    })
    .where(eq(quoteItems.id, d.itemId))

  await recalcQuote(item.quoteId)
  revalidatePath(`/quote/${item.quoteId}`)
  return { ok: true as const }
}

/** Итоги КП всегда считаются из строк — хранить их отдельно и не сверять нельзя. */
async function recalcQuote(quoteId: number) {
  const db = await getDb()
  const rows = await db
    .select({ qty: quoteItems.qty, price: quoteItems.unitPrice, cost: quoteItems.unitCost })
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId))

  const totalSale = rows.reduce((s, r) => s + r.price * r.qty, 0)
  const totalCost = rows.reduce((s, r) => s + r.cost * r.qty, 0)

  await db
    .update(quotes)
    .set({ totalSale: Math.round(totalSale), totalCost: Math.round(totalCost) })
    .where(eq(quotes.id, quoteId))
}

export async function getQuote(quoteId: number) {
  const db = await getDb()
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1)
  if (!quote) return null

  const rows = await db
    .select({ item: quoteItems, ruleName: pricingRules.name })
    .from(quoteItems)
    .leftJoin(pricingRules, eq(pricingRules.id, quoteItems.ruleId))
    .where(eq(quoteItems.quoteId, quoteId))
    .orderBy(asc(quoteItems.lineNo))
  const items = rows.map((r) => ({ ...r.item, ruleName: r.ruleName }))

  const [author] = quote.createdBy
    ? await db.select({ name: users.name }).from(users).where(eq(users.id, quote.createdBy))
    : [undefined]

  return { quote, items, author: author?.name ?? null }
}
