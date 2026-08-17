import { sql } from 'drizzle-orm'
import { getDb } from '../db'
import { catalogItems } from '../db/schema'
import { parseCatalogReport } from './parseCatalog'
import { normalize } from '../catalog/match'

export interface CatalogImportSummary {
  period: string | null
  rows: number
  groups: number
  warnings: string[]
}

/**
 * Загружает месячный отчёт продаж в прайс-лист.
 *
 * Периоды складываются: цена считается по всем загруженным месяцам сразу,
 * поэтому разовая распродажа не перекашивает среднюю.
 */
export async function importCatalogReport(buffer: Buffer): Promise<CatalogImportSummary> {
  const db = await getDb()
  const parsed = await parseCatalogReport(buffer)

  // В одном отчёте позиция может встретиться в нескольких группах — сводим
  const merged = new Map<string, (typeof parsed.rows)[number]>()
  for (const r of parsed.rows) {
    const prev = merged.get(r.code)
    if (!prev) {
      merged.set(r.code, { ...r })
    } else {
      prev.qty += r.qty
      prev.saleSum += r.saleSum
      prev.buySum += r.buySum
      prev.category ??= r.category
    }
  }

  const CHUNK = 500
  const rows = [...merged.values()]

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK).map((r) => ({
      code: r.code,
      article: r.article,
      name: r.name,
      category: r.category,
      qtySold: r.qty,
      saleSum: Math.round(r.saleSum),
      buySum: Math.round(r.buySum),
      monthsSeen: 1,
      unitPrice: r.qty > 0 ? r.saleSum / r.qty : 0,
      unitCost: r.qty > 0 ? r.buySum / r.qty : 0,
      markupPct: r.buySum > 0 ? ((r.saleSum - r.buySum) / r.buySum) * 100 : 0,
      searchText: normalize([r.name, r.article, r.category].filter(Boolean).join(' ')),
    }))

    await db
      .insert(catalogItems)
      .values(slice)
      .onConflictDoUpdate({
        target: catalogItems.code,
        set: {
          name: sql`excluded.name`,
          article: sql`excluded.article`,
          category: sql`coalesce(excluded.category, ${catalogItems.category})`,
          qtySold: sql`${catalogItems.qtySold} + excluded.qty_sold`,
          saleSum: sql`${catalogItems.saleSum} + excluded.sale_sum`,
          buySum: sql`${catalogItems.buySum} + excluded.buy_sum`,
          monthsSeen: sql`${catalogItems.monthsSeen} + 1`,
          searchText: sql`excluded.search_text`,
          updatedAt: sql`now()`,
          // Цены пересчитываем по накопленным суммам, а не подменяем последними
          unitPrice: sql`case when ${catalogItems.qtySold} + excluded.qty_sold > 0
                         then (${catalogItems.saleSum} + excluded.sale_sum)
                              / (${catalogItems.qtySold} + excluded.qty_sold)
                         else 0 end`,
          unitCost: sql`case when ${catalogItems.qtySold} + excluded.qty_sold > 0
                        then (${catalogItems.buySum} + excluded.buy_sum)
                             / (${catalogItems.qtySold} + excluded.qty_sold)
                        else 0 end`,
          markupPct: sql`case when ${catalogItems.buySum} + excluded.buy_sum > 0
                         then ((${catalogItems.saleSum} + excluded.sale_sum)
                               - (${catalogItems.buySum} + excluded.buy_sum)) * 100.0
                              / (${catalogItems.buySum} + excluded.buy_sum)
                         else 0 end`,
        },
      })
  }

  return {
    period: parsed.period,
    rows: rows.length,
    groups: parsed.groups,
    warnings: parsed.warnings,
  }
}
