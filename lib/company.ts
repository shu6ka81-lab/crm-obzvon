import { inArray } from 'drizzle-orm'
import { getDb } from './db'
import { settings } from './db/schema'

/**
 * Реквизиты для коммерческого предложения.
 *
 * Значения по умолчанию — из открытых данных компании. Их видно на первом же
 * КП, поэтому лучше показать заведомо верное и дать поправить, чем оставить
 * пустые поля, которые заполнят в последний момент перед отправкой клиенту.
 */
export interface CompanyProfile {
  name: string
  legalName: string
  inn: string
  kpp: string
  address: string
  phone: string
  email: string
  site: string
  signerName: string
  signerTitle: string
  /** Сколько дней держится цена — строка в подвале предложения. */
  validDays: string
  footer: string
  /**
   * Что получает клиент, по строке на пункт. Обещания клиентам сочинять за
   * компанию нельзя — здесь заготовка, которую правят под себя.
   */
  benefits: string
  slogan: string
}

export const COMPANY_DEFAULTS: CompanyProfile = {
  name: 'Офисная Служба',
  legalName: 'ООО «ТОЧКА РУ»',
  inn: '7801532391',
  kpp: '',
  address: 'Санкт-Петербург',
  phone: '',
  email: '',
  site: '3259404.ru',
  signerName: 'Артемьев А. А.',
  signerTitle: 'Генеральный директор',
  validDays: '14',
  footer: 'Цены указаны с НДС. Доставка по Санкт-Петербургу и области.',
  benefits: [
    'Один поставщик на весь офис — бумага, хозяйственное, кухня',
    'Доставка по Санкт-Петербургу и области',
    'Работаем по счёту и через ЭДО',
    'Персональный менеджер и повторный заказ в один клик',
  ].join('\n'),
  slogan: 'Снабжаем офисы с 1998 года',
}

const KEYS = Object.keys(COMPANY_DEFAULTS) as (keyof CompanyProfile)[]
const PREFIX = 'company.'

export async function getCompanyProfile(): Promise<CompanyProfile> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(settings)
    .where(
      inArray(
        settings.key,
        KEYS.map((k) => PREFIX + k),
      ),
    )

  const found = new Map(rows.map((r) => [r.key.slice(PREFIX.length), r.value]))
  const out = { ...COMPANY_DEFAULTS }
  for (const k of KEYS) {
    const v = found.get(k)
    if (v != null && v !== '') out[k] = v
  }
  return out
}

export async function saveCompanyProfile(values: Partial<CompanyProfile>): Promise<void> {
  const db = await getDb()
  for (const k of KEYS) {
    if (!(k in values)) continue
    const value = String(values[k] ?? '')
    await db
      .insert(settings)
      .values({ key: PREFIX + k, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date() },
      })
  }
}
