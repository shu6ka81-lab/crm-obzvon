'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db'
import { quoteItems, quotes, users } from '@/lib/db/schema'
import { getCatalogIndex } from '@/lib/catalog'
import { parseRequestLines } from '@/lib/catalog/match'
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'
import type { MatchedLine } from '@/lib/quote'



async function currentUserId(): Promise<number | null> {
  const jar = await cookies()
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value)
  return session?.userId ?? null
}

/** Подбор без сохранения — чтобы менеджер сначала посмотрел, что нашлось. */
export async function matchRequest(text: string): Promise<MatchedLine[]> {
  const index = await getCatalogIndex()
  return parseRequestLines(text).map((line, i) => ({
    lineNo: i + 1,
    raw: line.raw,
    qty: line.qty,
    options: index.search(line.name, 5).map((m) => ({
      id: m.item.id,
      code: m.item.code,
      name: m.item.name,
      unitPrice: Math.round(m.item.unitPrice * 100) / 100,
      unitCost: Math.round(m.item.unitCost * 100) / 100,
      markupPct: Math.round(m.item.markupPct),
      confidence: m.confidence,
    })),
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
      confidence: it.confidence,
      isManual: it.isManual,
    })),
  )

  revalidatePath('/')
  return { ok: true as const, quoteId: quote.id }
}

export async function getQuote(quoteId: number) {
  const db = await getDb()
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1)
  if (!quote) return null

  const items = await db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId))
    .orderBy(asc(quoteItems.lineNo))

  const [author] = quote.createdBy
    ? await db.select({ name: users.name }).from(users).where(eq(users.id, quote.createdBy))
    : [undefined]

  return { quote, items, author: author?.name ?? null }
}
