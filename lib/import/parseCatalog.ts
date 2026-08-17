import ExcelJS from 'exceljs'

/**
 * Разбор отчёта 1С «Продажи товаров по номенклатуре».
 *
 * Отчёт — это дерево, выгруженное плоским списком: сначала «Каталог»,
 * потом группы, потом товары. Уровней группировки и отступов в файле нет,
 * зато группы выделены жирным — это единственный надёжный признак.
 * Проверено: 619 жирных строк против 7535 обычных на месячном отчёте.
 *
 * Колонки: B №, C Код, D Артикул, E Наименование,
 *          F Кол, G Продажа, H Покупка, I Прибыль, J Наценка.
 */

export interface CatalogRow {
  code: string
  article: string | null
  name: string
  category: string | null
  qty: number
  saleSum: number
  buySum: number
}

export interface CatalogParseResult {
  period: string | null
  rows: CatalogRow[]
  groups: number
  warnings: string[]
}

const COL = {
  no: 2,
  code: 3,
  article: 4,
  name: 5,
  qty: 6,
  sale: 7,
  buy: 8,
} as const

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
  const n = Number(s.replace(/[\s ]/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export async function parseCatalogReport(
  buffer: ArrayBuffer | Buffer,
): Promise<CatalogParseResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as ArrayBuffer)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('В файле нет листа')

  const warnings: string[] = []
  const rows: CatalogRow[] = []
  let groups = 0
  let category: string | null = null

  const period = (text(ws.getCell(1, COL.no).value) ?? '')
    .replace(/Продажи\s+за период:\s*/i, '')
    .trim() || null

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < 6) return

    const nameCell = row.getCell(COL.name)
    const name = text(nameCell.value)
    const code = text(row.getCell(COL.code).value)
    if (!name || !code) return

    const isGroup = Boolean(nameCell.font?.bold)
    if (isGroup) {
      groups += 1
      // «Каталог» — корень дерева, категорией не считаем
      category = name === 'Каталог' ? null : name
      return
    }

    const qty = num(row.getCell(COL.qty).value)
    const saleSum = num(row.getCell(COL.sale).value)
    const buySum = num(row.getCell(COL.buy).value)

    if (saleSum <= 0) {
      // Возвраты и нулевые строки в прайс-лист не годятся
      return
    }

    rows.push({
      code,
      article: text(row.getCell(COL.article).value),
      name,
      category,
      qty,
      saleSum,
      buySum,
    })
  })

  if (rows.length === 0) {
    throw new Error('Не найдено ни одной товарной строки — формат отчёта отличается')
  }
  if (groups === 0) {
    warnings.push(
      'В файле нет строк, выделенных жирным: категории определить не удалось. ' +
        'Товары загрузятся без категорий.',
    )
  }

  return { period, rows, groups, warnings }
}
