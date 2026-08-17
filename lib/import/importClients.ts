import { eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { clients, importBatches, campaigns, campaignClients } from '../db/schema'
import { parseActivityReport, type ParsedClient } from './parse1c'

export interface ImportSummary {
  batchId: number
  reportDate: string | null
  total: number
  created: number
  updated: number
  warnings: string[]
}

/**
 * Загружает выгрузку «Активность контрагентов» в базу.
 *
 * Правило: данные из 1С обновляются полностью, всё, что заполнили мы
 * (квалификация, касания, задачи), живёт в отдельных таблицах и не затирается.
 */
export async function importActivityReport(
  buffer: Buffer,
  fileName: string,
): Promise<ImportSummary> {
  const db = await getDb()
  const { reportDate, clients: parsed, warnings } = await parseActivityReport(buffer)

  const [batch] = await db
    .insert(importBatches)
    .values({ fileName, reportDate, rowsTotal: parsed.length })
    .returning({ id: importBatches.id })

  const codes = parsed.map((c) => c.code1c)
  const existing = new Set<string>()
  const CHUNK = 1000

  for (let i = 0; i < codes.length; i += CHUNK) {
    const rows = await db
      .select({ code1c: clients.code1c })
      .from(clients)
      .where(inArray(clients.code1c, codes.slice(i, i + CHUNK)))
    rows.forEach((r) => r.code1c && existing.add(r.code1c))
  }

  const now = new Date()
  const toRow = (c: ParsedClient) => ({
    code1c: c.code1c,
    name: c.name,
    segment: c.segment,
    status1c: c.status1c,
    manager1c: c.manager1c,
    totalSum: c.totalSum,
    shipmentsCount: c.shipmentsCount,
    avgCheck: c.avgCheck,
    lastOrderDate: c.lastOrderDate,
    comment1c: c.comment1c,
    comment1cDate: c.comment1cDate,
    importedAt: now,
    importBatchId: batch.id,
  })

  for (let i = 0; i < parsed.length; i += CHUNK) {
    const slice = parsed.slice(i, i + CHUNK).map(toRow)
    await db
      .insert(clients)
      .values(slice)
      .onConflictDoUpdate({
        target: clients.code1c,
        // Индекс частичный — условие обязано совпасть с тем, что в схеме
        targetWhere: isNotNull(clients.code1c),
        set: {
          name: sql`excluded.name`,
          segment: sql`excluded.segment`,
          status1c: sql`excluded.status_1c`,
          manager1c: sql`excluded.manager_1c`,
          totalSum: sql`excluded.total_sum`,
          shipmentsCount: sql`excluded.shipments_count`,
          avgCheck: sql`excluded.avg_check`,
          lastOrderDate: sql`excluded.last_order_date`,
          comment1c: sql`excluded.comment_1c`,
          comment1cDate: sql`excluded.comment_1c_date`,
          importedAt: sql`excluded.imported_at`,
          importBatchId: sql`excluded.import_batch_id`,
        },
      })
  }

  const created = parsed.length - existing.size
  const updated = existing.size

  await db
    .update(importBatches)
    .set({ rowsCreated: created, rowsUpdated: updated })
    .where(eq(importBatches.id, batch.id))

  return {
    batchId: batch.id,
    reportDate,
    total: parsed.length,
    created,
    updated,
    warnings,
  }
}

/**
 * Собирает кампанию обзвона из списка клиентов.
 * Порядок очереди задаётся порядком clientIds — обычно по убыванию суммы покупок.
 */
export async function buildCampaignFromIds(opts: {
  name: string
  description?: string
  sourceFile?: string
  clientIds: number[]
}) {
  const db = await getDb()
  const [camp] = await db
    .insert(campaigns)
    .values({
      name: opts.name,
      description: opts.description,
      sourceFile: opts.sourceFile,
    })
    .returning({ id: campaigns.id })

  const CHUNK = 1000
  for (let i = 0; i < opts.clientIds.length; i += CHUNK) {
    const rows = opts.clientIds.slice(i, i + CHUNK).map((clientId, k) => ({
      campaignId: camp.id,
      clientId,
      position: i + k,
    }))
    await db.insert(campaignClients).values(rows).onConflictDoNothing()
  }

  return { campaignId: camp.id, count: opts.clientIds.length }
}
