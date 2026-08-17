/** Общее для КП: константы и типы. Отдельно от серверных действий —
 *  из файла с 'use server' можно экспортировать только асинхронные функции. */

/** Ниже этого порога подбор считаем ненадёжным и просим менеджера проверить. */
export const CONFIDENCE_OK = 60

export interface MatchedOption {
  id: number
  code: string
  name: string
  unitPrice: number
  unitCost: number
  markupPct: number
  confidence: number
}

export interface MatchedLine {
  lineNo: number
  raw: string
  qty: number
  options: MatchedOption[]
}
