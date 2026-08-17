import ExcelJS from 'exceljs'

/**
 * Парсер списка покупателей конкурента.
 *
 * Источник — раздел 9 декларации по НДС (книга продаж) конкурента,
 * уже приведённый к виду «Приоритет клиентов»: одна строка на покупателя,
 * с оборотом за квартал, числом закупок и баллом приоритета.
 *
 * Колонки:
 *   A № | B Балл | C Почему здесь | D ИНН | E КПП | F Наименование |
 *   G Сумма продаж с НДС | H Доля | I Кол-во продаж | J Апр | K Май | L Июн
 */

export interface CompetitorBuyer {
  inn: string
  kpp: string | null
  name: string
  score: number
  reason: string | null
  quarterSum: number
  purchases: number
  byMonth: number[]
}

export interface CompetitorReport {
  /** Чью книгу продаж разобрали. */
  supplierName: string | null
  supplierInn: string | null
  period: string | null
  buyers: CompetitorBuyer[]
  warnings: string[]
}

function text(v: ExcelJS.CellValue): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number') return String(v)
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>
    if (Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((p) => p.text ?? '').join('').trim() || null
    }
    if (typeof o.text === 'string') return o.text.trim() || null
    if ('result' in o) return text(o.result as ExcelJS.CellValue)
  }
  return null
}

function num(v: ExcelJS.CellValue): number {
  if (typeof v === 'number') return v
  const s = text(v)
  if (!s) return 0
  const cleaned = s.replace(/[\s ]/g, '').replace(',', '.')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

/** ИНН приезжает то числом, то строкой; ведущие нули терять нельзя. */
function inn(v: ExcelJS.CellValue): string | null {
  const s = text(v)
  if (!s) return null
  const digits = s.replace(/\D/g, '')
  if (digits.length === 9) return '0' + digits // потерянный ведущий ноль
  if (digits.length === 11) return '0' + digits
  return digits.length === 10 || digits.length === 12 ? digits : null
}

const COL = {
  no: 1,
  score: 2,
  reason: 3,
  inn: 4,
  kpp: 5,
  name: 6,
  sum: 7,
  share: 8,
  count: 9,
  m1: 10,
  m2: 11,
  m3: 12,
} as const

export async function parseCompetitorReport(
  buffer: ArrayBuffer | Buffer,
): Promise<CompetitorReport> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as ArrayBuffer)

  const sheet =
    wb.worksheets.find((w) => w.name.toLowerCase().includes('приоритет')) ?? wb.worksheets[0]
  if (!sheet) throw new Error('В файле нет листа с покупателями')

  const warnings: string[] = []
  const buyers: CompetitorBuyer[] = []
  const seen = new Set<string>()

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return // шапка
    const n = num(row.getCell(COL.no).value)
    if (!n) return

    const buyerInn = inn(row.getCell(COL.inn).value)
    const name = text(row.getCell(COL.name).value)

    if (!buyerInn || !name) {
      warnings.push(`Строка ${rowNumber}: нет ИНН или наименования, пропущена`)
      return
    }
    if (seen.has(buyerInn)) {
      warnings.push(`Строка ${rowNumber}: ИНН ${buyerInn} повторяется, пропущена`)
      return
    }
    seen.add(buyerInn)

    buyers.push({
      inn: buyerInn,
      kpp: text(row.getCell(COL.kpp).value),
      name,
      score: num(row.getCell(COL.score).value),
      reason: text(row.getCell(COL.reason).value),
      quarterSum: Math.round(num(row.getCell(COL.sum).value)),
      purchases: Math.round(num(row.getCell(COL.count).value)),
      byMonth: [COL.m1, COL.m2, COL.m3].map((c) => Math.round(num(row.getCell(c).value))),
    })
  })

  if (buyers.length === 0) {
    throw new Error('Не найдено ни одного покупателя — формат отличается от ожидаемого')
  }

  // Реквизиты поставщика лежат на служебном листе «Методика и о файле»
  let supplierName: string | null = null
  let supplierInn: string | null = null
  let period: string | null = null

  const meta = wb.worksheets.find((w) => w.name.toLowerCase().includes('методика'))
  if (meta) {
    meta.eachRow({ includeEmpty: false }, (row) => {
      const key = (text(row.getCell(1).value) ?? '').toLowerCase()
      const value = text(row.getCell(2).value)
      if (!value) return
      if (key.includes('налогоплательщик')) {
        supplierName = value.replace(/,\s*ИНН.*$/i, '').trim()
        const m = value.match(/ИНН\s*(\d{10,12})/i)
        if (m) supplierInn = m[1]
      }
      if (key.includes('период')) period = value
    })
  }

  return { supplierName, supplierInn, period, buyers, warnings }
}
