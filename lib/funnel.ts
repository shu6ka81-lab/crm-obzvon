/** Воронка продаж — названия, порядок и правила перехода. */

export type Stage =
  | 'lead'
  | 'contacted'
  | 'audit'
  | 'quote'
  | 'decision'
  | 'won'
  | 'lost'

export const STAGE_LABEL: Record<Stage, string> = {
  lead: 'Лид',
  contacted: 'Знакомство',
  audit: 'Аудит цен',
  quote: 'КП отправлено',
  decision: 'Ждём решения',
  won: 'Начали работать',
  lost: 'Отказ',
}

export const STAGE_HINT: Record<Stage, string> = {
  lead: 'В списке, разговора ещё не было',
  contacted: 'Дозвонились, вышли на того, кто закупает',
  audit: 'Ключевой этап: получаем перечень позиций, которые клиент закупает',
  quote: 'Собрали КП по их позициям и отправили',
  decision: 'Решение за клиентом',
  won: 'Пошли отгрузки',
  lost: 'Не наш клиент или отказался',
}

/** Порядок для отчёта. «Отказ» вне линии — это выход, а не ступень. */
export const FUNNEL_ORDER: Stage[] = [
  'lead',
  'contacted',
  'audit',
  'quote',
  'decision',
  'won',
]

export const ALL_STAGES: Stage[] = [...FUNNEL_ORDER, 'lost']

export function stageIndex(s: Stage): number {
  const i = FUNNEL_ORDER.indexOf(s)
  return i === -1 ? -1 : i
}

/**
 * Что предложить после звонка. Подсказка, а не автоматика: решает человек,
 * поэтому в форме это выбор с предзаполненным значением.
 */
export function suggestStage(
  current: Stage,
  outcome: string,
  gotQuoteRequest: boolean,
): Stage {
  if (outcome === 'refused') return 'lost'
  if (outcome === 'wrong_number') return current
  // Не дозвонились — стадия не меняется, двигается только очередь
  if (outcome !== 'reached') return current

  if (gotQuoteRequest) return 'audit'
  return stageIndex(current) < stageIndex('contacted') ? 'contacted' : current
}
