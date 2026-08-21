/** Воронка продаж — названия, порядок и правила перехода. */

export type Stage =
  | 'lead'
  | 'contacted'
  | 'audit'
  | 'quote'
  | 'decision'
  | 'won'
  | 'lost'

/**
 * Тип кампании: привлекаем нового или возвращаем ушедшего.
 * Ступени одни и те же, но называются по-разному — см. STAGE_LABEL_BY_KIND.
 */
export type CampaignKind = 'acquisition' | 'return'

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

/**
 * Возврат ушедшего — другой разговор. Нас уже знают, и вопрос не «кто вы»,
 * а «почему мы от вас ушли». Поэтому и слова другие: не «лид», а «молчит»,
 * не «начали работать», а «вернулся».
 *
 * Отдельный набор ступеней заводить не стали: работа одна и та же — дозвониться,
 * узнать, что закупают, посчитать, дождаться решения. Разное здесь — вход
 * и выход, а их достаточно назвать своими именами.
 */
const RETURN_LABEL: Record<Stage, string> = {
  lead: 'Молчит',
  contacted: 'Вышли на связь',
  audit: 'Узнали, что закупают',
  quote: 'КП отправлено',
  decision: 'Ждём решения',
  won: 'Вернулся',
  lost: 'Не вернётся',
}

const RETURN_HINT: Record<Stage, string> = {
  lead: 'Покупал и перестал. Разговора ещё не было',
  contacted: 'Дозвонились, выяснили, почему ушли',
  audit: 'Получили перечень того, что закупают сейчас и почём',
  quote: 'Собрали предложение по их позициям и отправили',
  decision: 'Решение за клиентом',
  won: 'Снова пошли отгрузки',
  lost: 'Ушёл окончательно — записываем причину',
}

export function stageLabel(stage: Stage, kind: CampaignKind = 'acquisition'): string {
  return kind === 'return' ? RETURN_LABEL[stage] : STAGE_LABEL[stage]
}

export function stageHint(stage: Stage, kind: CampaignKind = 'acquisition'): string {
  return kind === 'return' ? RETURN_HINT[stage] : STAGE_HINT[stage]
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
