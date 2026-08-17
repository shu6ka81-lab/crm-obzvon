import ExcelJS from 'exceljs'

/**
 * Парсер отчёта 1С «Активность контрагентов».
 *
 * Структура файла (проверено на выгрузке от 04.08.26):
 *   строка 1      — заголовок «Активность контрагентов на ДД.ММ.ГГ»
 *   строка 2      — описание фильтра
 *   строки 3–10   — сводка по сегментам
 *   дальше        — секции: строка с названием сегмента в колонке B (C и D пустые),
 *                   затем шапка таблицы (B = '№'), затем строки данных
 *
 * Колонки данных:
 *   B № | C Код | D Контрагент | G Статус | H Сумма всего | I Кол. отгр. |
 *   J Сумма средняя | K Посл. отгрузка | L Комментарий | M Дата комм. | N Менеджер
 */

export type Segment = 'active' | 'd61' | 'd91' | 'd121' | 'inactive' | 'new' | 'unknown'

const SEGMENT_BY_TITLE: Record<string, Segment> = {
  'Активный': 'active',
  '61 день': 'd61',
  '91 день': 'd91',
  '121 день': 'd121',
  'Не активный': 'inactive',
  'Новый': 'new',
}

const SECTION_TITLES = new Set(Object.keys(SEGMENT_BY_TITLE))

export interface ParsedClient {
  code1c: string
  name: string
  segment: Segment
  status1c: string | null
  manager1c: string | null
  totalSum: number
  shipmentsCount: number
  avgCheck: number
  lastOrderDate: string | null // ISO yyyy-mm-dd
  comment1c: string | null
  comment1cDate: string | null
}

export interface ParseResult {
  reportDate: string | null
  clients: ParsedClient[]
  warnings: string[]
}

/** Значение ячейки в виде строки. ExcelJS отдаёт объекты для формул и rich text. */
function cellText(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>
    if ('richText' in v && Array.isArray(v.richText)) {
      return (
        v.richText
          .map((p: { text?: string }) => p.text ?? '')
          .join('')
          .trim() || null
      )
    }
    if ('text' in v && typeof v.text === 'string') return v.text.trim() || null
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue)
    if ('hyperlink' in v && typeof v.hyperlink === 'string') return v.hyperlink
  }
  return null
}

/**
 * 1С отдаёт числа то числом, то строкой с неразрывными пробелами
 * («1 234,56»), а пустые ячейки — одиночным пробелом.
 */
function toNumber(value: ExcelJS.CellValue): number {
  if (typeof value === 'number') return value
  const raw = cellText(value)
  if (!raw) return 0
  const cleaned = raw.replace(/[\s  ]/g, '').replace(',', '.')
  if (!cleaned || cleaned === '-') return 0
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

/** Даты приходят и объектом Date, и строкой ДД.ММ.ГГ(ГГ). */
function toIsoDate(value: ExcelJS.CellValue): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const raw = cellText(value)
  if (!raw) return null
  const m = raw.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  let year = Number(m[3])
  if (year < 100) year += 2000
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return d.toISOString().slice(0, 10)
}

const COL = {
  num: 2,
  code: 3,
  name: 4,
  status: 7,
  total: 8,
  shipments: 9,
  avg: 10,
  lastShipment: 11,
  comment: 12,
  commentDate: 13,
  manager: 14,
} as const

export async function parseActivityReport(
  buffer: ArrayBuffer | Buffer,
): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as ArrayBuffer)

  const ws = wb.worksheets[0]
  if (!ws) throw new Error('В файле нет ни одного листа')

  const warnings: string[] = []
  const clients: ParsedClient[] = []
  const seen = new Set<string>()

  // Дата отчёта из заголовка: «Активность контрагентов на 04.08.26»
  let reportDate: string | null = null
  const title = cellText(ws.getRow(1).getCell(COL.num).value)
  if (title) reportDate = toIsoDate(title)

  let segment: Segment = 'unknown'

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < 3) return

    const first = cellText(row.getCell(COL.num).value)
    const codeCell = cellText(row.getCell(COL.code).value)
    const nameCell = cellText(row.getCell(COL.name).value)

    // Заголовок секции: название сегмента в B, C и D пустые
    if (first && SECTION_TITLES.has(first) && !codeCell && !nameCell) {
      segment = SEGMENT_BY_TITLE[first]
      return
    }

    // Шапка таблицы
    if (first === '№') return

    // Строка данных: в B порядковый номер
    const rowNo = Number(first)
    if (!first || !Number.isInteger(rowNo)) return

    if (!codeCell || !nameCell) {
      warnings.push(`Строка ${rowNumber}: пустой код или наименование, пропущена`)
      return
    }

    if (seen.has(codeCell)) {
      warnings.push(`Строка ${rowNumber}: код ${codeCell} встречается повторно, пропущена`)
      return
    }
    seen.add(codeCell)

    if (segment === 'unknown') {
      warnings.push(`Строка ${rowNumber}: сегмент не определён (код ${codeCell})`)
    }

    clients.push({
      code1c: codeCell,
      name: nameCell,
      segment,
      status1c: cellText(row.getCell(COL.status).value),
      manager1c: cellText(row.getCell(COL.manager).value),
      totalSum: Math.round(toNumber(row.getCell(COL.total).value)),
      shipmentsCount: Math.round(toNumber(row.getCell(COL.shipments).value)),
      avgCheck: Math.round(toNumber(row.getCell(COL.avg).value)),
      lastOrderDate: toIsoDate(row.getCell(COL.lastShipment).value),
      comment1c: cellText(row.getCell(COL.comment).value),
      comment1cDate: toIsoDate(row.getCell(COL.commentDate).value),
    })
  })

  if (clients.length === 0) {
    throw new Error(
      'Не найдено ни одной строки с клиентами. Похоже, формат отчёта отличается от ожидаемого.',
    )
  }

  return { reportDate, clients, warnings }
}
