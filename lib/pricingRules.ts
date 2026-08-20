import { asc, desc, eq, sql } from 'drizzle-orm'
import { getDb } from './db'
import { catalogItems, pricingRules } from './db/schema'
import type { PricingRule } from './pricing'

/** Активные правила в том порядке, в каком их проверяет расчёт. */
export async function getPricingRules(): Promise<PricingRule[]> {
  const db = await getDb()
  return db
    .select({
      id: pricingRules.id,
      name: pricingRules.name,
      categoryPattern: pricingRules.categoryPattern,
      minCost: pricingRules.minCost,
      maxCost: pricingRules.maxCost,
      markupPct: pricingRules.markupPct,
      priority: pricingRules.priority,
      isActive: pricingRules.isActive,
    })
    .from(pricingRules)
    .where(eq(pricingRules.isActive, true))
    .orderBy(asc(pricingRules.priority), asc(pricingRules.id))
}

export interface SeedResult {
  created: number
  base: number
  categories: { name: string; markup: number; revenue: number }[]
  skipped: boolean
}

/**
 * Заводит начальный набор правил из их же продаж.
 *
 * Выдумывать наценки за компанию нельзя — они складывались годами и отражают
 * рынок. Но нигде не записаны: по словам коллеги, «маржинальность у них вообще
 * нигде не прописывается, это всё в голове у Алексея». Поэтому достаём из
 * фактических отгрузок и показываем как правила, которые можно поправить.
 *
 * Отдельное правило заводится там, где категория заметно отличается от средней
 * и при этом весома по деньгам. Всё остальное покрывает общее правило.
 */
export async function seedDefaultRules(opts?: {
  /** Доля от всех продаж, ниже которой категория не заслуживает своего правила. */
  minShare?: number
  minDeviation?: number
  /** Доля, выше которой правило заводим всегда — там ошибка дороже. */
  alwaysAboveShare?: number
  force?: boolean
}): Promise<SeedResult> {
  const db = await getDb()
  // Пороги — доли от оборота, а не рубли. С рублёвыми порогами набор правил
  // зависел от того, сколько месяцев прайса успели загрузить: за семь месяцев
  // категория проходила отбор, за три — уже нет.
  const minShare = opts?.minShare ?? 0.01
  const minDeviation = opts?.minDeviation ?? 5
  const alwaysAboveShare = opts?.alwaysAboveShare ?? 0.04

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pricingRules)
  if (n > 0 && !opts?.force) {
    return { created: 0, base: 0, categories: [], skipped: true }
  }

  const [tot] = await db
    .select({
      sale: sql<number>`coalesce(sum(${catalogItems.saleSum}), 0)::bigint`,
      buy: sql<number>`coalesce(sum(${catalogItems.buySum}), 0)::bigint`,
    })
    .from(catalogItems)

  const base =
    Number(tot.buy) > 0
      ? Math.round(((Number(tot.sale) - Number(tot.buy)) / Number(tot.buy)) * 100)
      : 40

  const totalSale = Number(tot.sale)
  const minRevenue = totalSale * minShare
  const alwaysAbove = totalSale * alwaysAboveShare

  const cats = await db
    .select({
      category: catalogItems.category,
      sale: sql<number>`sum(${catalogItems.saleSum})::bigint`,
      markup: sql<number>`case when sum(${catalogItems.buySum}) > 0
        then round(((sum(${catalogItems.saleSum}) - sum(${catalogItems.buySum}))
                    / sum(${catalogItems.buySum})::numeric) * 100)
        else null end`,
    })
    .from(catalogItems)
    .groupBy(catalogItems.category)
    .having(sql`sum(${catalogItems.saleSum}) >= ${minRevenue}`)
    .orderBy(desc(sql`sum(${catalogItems.saleSum})`))

  const picked = cats.filter(
    (c) =>
      c.category &&
      c.markup != null &&
      (Number(c.sale) >= alwaysAbove || Math.abs(Number(c.markup) - base) >= minDeviation),
  )

  const rows = picked.map((c, i) => ({
    name: String(c.category),
    categoryPattern: String(c.category),
    markupPct: Number(c.markup),
    priority: 10 + i,
    note: `Выведено из отгрузок: ${(Number(c.sale) / 1e6).toFixed(1)} млн продаж при наценке ${c.markup}%`,
  }))

  rows.push({
    name: 'Общее правило',
    categoryPattern: null as unknown as string,
    markupPct: base,
    priority: 1000,
    note: `Средняя наценка по всем продажам — ${base}%`,
  })

  if (opts?.force) await db.delete(pricingRules)
  await db.insert(pricingRules).values(rows)

  return {
    created: rows.length,
    base,
    categories: picked.map((c) => ({
      name: String(c.category),
      markup: Number(c.markup),
      revenue: Number(c.sale),
    })),
    skipped: false,
  }
}
