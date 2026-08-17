import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { campaignClients, campaigns, clients } from '../db/schema'
import { parseCompetitorReport } from './parseCompetitor'

export interface CompetitorImportSummary {
  supplier: string
  period: string | null
  parsed: number
  created: number
  updated: number
  /** Совпали по названию с клиентами из 1С — звонить им нельзя вслепую. */
  possiblyOwn: number
  warnings: string[]
}

/**
 * Только однозначные организационно-правовые формы.
 * «УК», «ТК», «НИЦ», «СПБ» и подобное сюда не входят: они часто часть
 * названия, и отсечение давало бы ложные совпадения — а ложное совпадение
 * уводит хорошего лида в конец очереди.
 */
const LEGAL_FORMS = new Set([
  'ООО', 'ОАО', 'ЗАО', 'АО', 'ПАО', 'НАО', 'ИП',
  'ФГБУ', 'ФГУП', 'ФГБОУ', 'ГБУ', 'МБУ', 'АНО', 'НКО',
])

/**
 * Приводит название к сравнимому виду, чтобы поймать своих же клиентов,
 * записанных в 1С без ИНН и в произвольном написании.
 *
 * Важно: `\b` в JavaScript не работает с кириллицей — граница слова считается
 * только по латинице. Поэтому режем не регуляркой по границам, а разбором на слова.
 */
export function normalizeName(s: string): string {
  const words = s
    .toUpperCase()
    .replace(/Ё/g, 'Е')
    .split(/[^А-ЯA-Z0-9]+/)
    .filter(Boolean)
    .filter((w) => !LEGAL_FORMS.has(w))
  return words.join('')
}

export async function importCompetitorReport(
  buffer: Buffer,
  fileName: string,
): Promise<CompetitorImportSummary> {
  const db = await getDb()
  const report = await parseCompetitorReport(buffer)
  const supplier = report.supplierName ?? fileName

  // --- собираем названия своих клиентов из 1С для сверки
  const own = await db
    .select({ name: clients.name })
    .from(clients)
    .where(eq(clients.source, 'crm_1c'))
  const ownIndex = new Map<string, string>()
  for (const o of own) {
    const key = normalizeName(o.name)
    if (key.length >= 5) ownIndex.set(key, o.name)
  }

  // --- какие ИНН уже есть в базе
  const inns = report.buyers.map((b) => b.inn)
  const existing = new Map<string, number>()
  const CHUNK = 500
  for (let i = 0; i < inns.length; i += CHUNK) {
    const slice = inns.slice(i, i + CHUNK)
    const rows = await db
      .select({ id: clients.id, inn: clients.inn })
      .from(clients)
      .where(and(isNotNull(clients.inn), inArray(clients.inn, slice)))
    rows.forEach((r) => r.inn && existing.set(r.inn, r.id))
  }

  let created = 0
  let updated = 0
  let possiblyOwn = 0

  const prepared = report.buyers.map((b) => {
    const ownMatch = ownIndex.get(normalizeName(b.name))
    if (ownMatch) possiblyOwn += 1
    return { buyer: b, ownMatch: ownMatch ?? null }
  })

  // --- сохраняем компании
  for (let i = 0; i < prepared.length; i += CHUNK) {
    const slice = prepared.slice(i, i + CHUNK).map(({ buyer }) => ({
      inn: buyer.inn,
      name: buyer.name,
      source: 'competitor' as const,
      segment: 'unknown' as const,
      importedAt: new Date(),
    }))
    await db
      .insert(clients)
      .values(slice)
      .onConflictDoUpdate({
        target: clients.inn,
        // Индекс частичный — условие обязано совпасть, иначе Postgres его не найдёт
        targetWhere: isNotNull(clients.inn),
        set: { name: sql`excluded.name`, importedAt: sql`excluded.imported_at` },
      })
  }
  created = prepared.filter((p) => !existing.has(p.buyer.inn)).length
  updated = prepared.length - created

  // --- перечитываем идентификаторы
  const idByInn = new Map<string, number>()
  for (let i = 0; i < inns.length; i += CHUNK) {
    const slice = inns.slice(i, i + CHUNK)
    const rows = await db
      .select({ id: clients.id, inn: clients.inn })
      .from(clients)
      .where(and(isNotNull(clients.inn), inArray(clients.inn, slice)))
    rows.forEach((r) => r.inn && idByInn.set(r.inn, r.id))
  }

  // --- кампания
  const campName = `Покупатели ${supplier}`
  let [camp] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.name, campName))
    .limit(1)

  if (!camp) {
    ;[camp] = await db
      .insert(campaigns)
      .values({
        name: campName,
        description:
          `Компании, закупающие у «${supplier}»` +
          (report.period ? ` за ${report.period}` : '') +
          '. Источник — книга продаж из декларации по НДС. Отсортированы по баллу приоритета.',
        sourceFile: fileName,
      })
      .returning({ id: campaigns.id })
  }

  // Сначала те, кого точно можно звонить; возможные «свои» — в конец очереди.
  const ordered = [...prepared].sort((a, b) => {
    if (!!a.ownMatch !== !!b.ownMatch) return a.ownMatch ? 1 : -1
    return b.buyer.score - a.buyer.score
  })

  for (let i = 0; i < ordered.length; i += CHUNK) {
    const rows = ordered
      .slice(i, i + CHUNK)
      .map(({ buyer, ownMatch }, k) => {
        const clientId = idByInn.get(buyer.inn)
        if (!clientId) return null
        const note = [
          buyer.reason?.trim(),
          `Балл приоритета ${buyer.score}`,
          ownMatch ? `⚠ Возможно, уже ваш клиент: «${ownMatch}» — проверить до звонка` : null,
        ]
          .filter(Boolean)
          .join('. ')
        return {
          campaignId: camp.id,
          clientId,
          position: i + k,
          presetBudget: buyer.quarterSum,
          presetSupplier: supplier,
          presetPurchases: buyer.purchases,
          presetNote: note,
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    if (rows.length) {
      // Повторная загрузка обновляет факты о закупках и пометки, а не молчит
      await db
        .insert(campaignClients)
        .values(rows)
        .onConflictDoUpdate({
          target: [campaignClients.campaignId, campaignClients.clientId],
          set: {
            presetBudget: sql`excluded.preset_budget`,
            presetSupplier: sql`excluded.preset_supplier`,
            presetPurchases: sql`excluded.preset_purchases`,
            presetNote: sql`excluded.preset_note`,
          },
        })
    }
  }

  return {
    supplier,
    period: report.period,
    parsed: report.buyers.length,
    created,
    updated,
    possiblyOwn,
    warnings: report.warnings,
  }
}
