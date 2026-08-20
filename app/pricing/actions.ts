'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db'
import { pricingRules } from '@/lib/db/schema'
import { seedDefaultRules } from '@/lib/pricingRules'

export interface RuleState {
  ok: boolean
  message: string
}

/**
 * Пустые поля формы приходят пустой строкой, а числовые и необязательные её
 * не принимают — и форма молча не сохраняется. Уже наступали на это.
 */
function entries(formData: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [k, v] of formData.entries()) {
    if (typeof v === 'string') out[k] = v.trim() === '' ? undefined : v
  }
  return out
}

const RuleSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  name: z.string().min(1, 'Без названия правило не найти'),
  categoryPattern: z.string().optional(),
  minCost: z.coerce.number().min(0).optional(),
  maxCost: z.coerce.number().min(0).optional(),
  markupPct: z.coerce.number().min(-100).max(1000),
  priority: z.coerce.number().int().min(0).max(100000),
  isActive: z.coerce.boolean().optional(),
})

export async function saveRule(_prev: RuleState | null, formData: FormData): Promise<RuleState> {
  const parsed = RuleSchema.safeParse(entries(formData))
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Некорректные данные' }
  }
  const d = parsed.data
  const db = await getDb()

  if (d.minCost != null && d.maxCost != null && d.maxCost <= d.minCost) {
    return { ok: false, message: 'Верхняя граница закупки должна быть больше нижней' }
  }

  const values = {
    name: d.name,
    categoryPattern: d.categoryPattern ?? null,
    minCost: d.minCost ?? null,
    maxCost: d.maxCost ?? null,
    markupPct: d.markupPct,
    priority: d.priority,
    isActive: d.isActive ?? false,
    updatedAt: new Date(),
  }

  if (d.id) {
    await db.update(pricingRules).set(values).where(eq(pricingRules.id, d.id))
  } else {
    await db.insert(pricingRules).values(values)
  }

  revalidatePath('/pricing')
  return { ok: true, message: d.id ? 'Правило изменено' : 'Правило добавлено' }
}

export async function deleteRule(_prev: RuleState | null, formData: FormData): Promise<RuleState> {
  const id = Number(formData.get('id'))
  if (!Number.isInteger(id) || id <= 0) return { ok: false, message: 'Правило не найдено' }

  const db = await getDb()
  await db.delete(pricingRules).where(eq(pricingRules.id, id))
  revalidatePath('/pricing')
  return { ok: true, message: 'Правило удалено' }
}

/** Собрать правила заново из фактических продаж, затерев текущие. */
export async function rebuildFromSales(): Promise<RuleState> {
  const res = await seedDefaultRules({ force: true })
  revalidatePath('/pricing')
  return {
    ok: true,
    message:
      `Собрано ${res.created} правил из отгрузок. ` +
      `Общая наценка ${res.base}%, отдельных категорий ${res.categories.length}.`,
  }
}
