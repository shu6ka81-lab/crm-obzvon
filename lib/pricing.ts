/**
 * Расчёт цены в КП от закупки и правил наценки.
 *
 * Раньше цена бралась средней из прошлых отгрузок. Это удобно, но неверно:
 * средняя тянет за собой все разовые скидки, распродажи и ошибки прошлых лет,
 * и чем дольше живёт товар, тем сильнее она отстаёт от реальности.
 *
 * Правила проверяются по возрастанию priority, срабатывает первое подходящее.
 * Правило без условий — общее, оно и должно стоять последним.
 */

export interface PricingRule {
  id: number
  name: string
  categoryPattern: string | null
  minCost: number | null
  maxCost: number | null
  markupPct: number
  priority: number
  isActive: boolean
}

export interface PricedItem {
  category?: string | null
  unitCost: number
  /** Цена из истории отгрузок — запасной вариант, если закупка неизвестна. */
  unitPrice?: number
}

export interface PriceResult {
  price: number
  markupPct: number
  rule: PricingRule | null
  /** Правило не нашлось или нет закупки — цена взята из истории отгрузок. */
  fallback: boolean
}

/** До копеек. Округлять до рублей нельзя: на мелочи это заметная доля цены. */
export function roundPrice(x: number): number {
  return Math.round(x * 100) / 100
}

function matches(rule: PricingRule, item: PricedItem): boolean {
  if (!rule.isActive) return false

  if (rule.categoryPattern) {
    // Совпадение категории точное, а не по вхождению. Вхождение выглядит
    // удобнее, но молча путает категории: «Полотенца» входит в «Бумажные
    // полотенца», и самая крупная категория компании — 82 млн продаж —
    // считалась по чужому правилу, теряя 14 пунктов наценки.
    const cat = (item.category ?? '').trim().toLowerCase()
    if (cat !== rule.categoryPattern.trim().toLowerCase()) return false
  }
  if (rule.minCost != null && item.unitCost < rule.minCost) return false
  if (rule.maxCost != null && item.unitCost >= rule.maxCost) return false

  return true
}

/**
 * Считает цену продажи. Правила должны прийти уже отсортированными по priority —
 * сортировать здесь значило бы делать это на каждую строку заявки.
 */
export function priceFor(rules: PricingRule[], item: PricedItem): PriceResult {
  if (!(item.unitCost > 0)) {
    return {
      price: roundPrice(item.unitPrice ?? 0),
      markupPct: 0,
      rule: null,
      fallback: true,
    }
  }

  const rule = rules.find((r) => matches(r, item))
  if (!rule) {
    return {
      price: roundPrice(item.unitPrice ?? 0),
      markupPct: 0,
      rule: null,
      fallback: true,
    }
  }

  return {
    price: roundPrice(item.unitCost * (1 + rule.markupPct / 100)),
    markupPct: rule.markupPct,
    rule,
    fallback: false,
  }
}

/** Маржа в процентах от цены продажи — так её считают в отчётности. */
export function marginPct(sale: number, cost: number): number {
  return sale > 0 ? ((sale - cost) / sale) * 100 : 0
}
