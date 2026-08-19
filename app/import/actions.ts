'use server'

import { revalidatePath } from 'next/cache'
import { importCatalogReport } from '@/lib/import/importCatalog'
import { importCompetitorReport } from '@/lib/import/importCompetitor'
import { num } from '@/lib/format'

export interface UploadState {
  ok: boolean
  /** Итог одной строкой — то, что человек читает первым. */
  headline: string
  /** По файлу на строку: что именно разобралось. */
  lines: string[]
  warnings: string[]
}

function pickFiles(formData: FormData): File[] {
  return formData
    .getAll('files')
    .filter((f): f is File => f instanceof File && f.size > 0)
}

/**
 * Прайс-лист собирается из месячных отчётов «Продажи товаров по номенклатуре».
 * Файлов обычно несколько — берём все сразу: периоды складываются, и цена
 * считается по всем загруженным месяцам, чтобы разовая распродажа не
 * перекашивала среднюю.
 */
export async function uploadCatalog(
  _prev: UploadState | null,
  formData: FormData,
): Promise<UploadState> {
  const files = pickFiles(formData)
  if (files.length === 0) {
    return { ok: false, headline: 'Файлы не выбраны', lines: [], warnings: [] }
  }

  const lines: string[] = []
  const warnings: string[] = []
  let rows = 0

  for (const file of files) {
    try {
      const res = await importCatalogReport(Buffer.from(await file.arrayBuffer()))
      rows += res.rows
      lines.push(
        `${file.name} — период ${res.period ?? 'не определён'}, ` +
          `позиций ${num(res.rows)}, групп ${num(res.groups)}`,
      )
      warnings.push(...res.warnings.map((w) => `${file.name}: ${w}`))
    } catch (e) {
      warnings.push(`${file.name}: не разобрался — ${(e as Error).message}`)
    }
  }

  revalidatePath('/import')
  return {
    ok: lines.length > 0,
    headline:
      lines.length > 0
        ? `Загружено отчётов: ${lines.length}, позиций всего ${num(rows)}`
        : 'Ни один файл не разобрался',
    lines,
    warnings,
  }
}

/**
 * Списки покупателей конкурентов из книг продаж. Своих же клиентов среди них
 * помечаем отдельно: звонить им как новым нельзя — попадём к тому, кто у нас
 * уже покупает, и разговор выйдет неловким.
 */
export async function uploadCompetitors(
  _prev: UploadState | null,
  formData: FormData,
): Promise<UploadState> {
  const files = pickFiles(formData)
  if (files.length === 0) {
    return { ok: false, headline: 'Файлы не выбраны', lines: [], warnings: [] }
  }

  const lines: string[] = []
  const warnings: string[] = []
  let created = 0
  let own = 0

  for (const file of files) {
    try {
      const res = await importCompetitorReport(Buffer.from(await file.arrayBuffer()), file.name)
      created += res.created
      own += res.possiblyOwn
      lines.push(
        `${res.supplier} — разобрано ${num(res.parsed)}, ` +
          `новых ${num(res.created)}, обновлено ${num(res.updated)}, ` +
          `совпало с нашими ${num(res.possiblyOwn)}`,
      )
      warnings.push(...res.warnings.map((w) => `${file.name}: ${w}`))
    } catch (e) {
      warnings.push(`${file.name}: не разобрался — ${(e as Error).message}`)
    }
  }

  revalidatePath('/import')
  revalidatePath('/')
  return {
    ok: lines.length > 0,
    headline:
      lines.length > 0
        ? `Загружено списков: ${lines.length}, новых компаний ${num(created)}, ` +
          `совпало с нашими клиентами ${num(own)}`
        : 'Ни один файл не разобрался',
    lines,
    warnings,
  }
}
