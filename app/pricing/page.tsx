import { asc, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { catalogItems, pricingRules } from '@/lib/db/schema'
import { num } from '@/lib/format'
import { RuleRow, type RuleView } from './RuleRow'
import { GRID } from './grid'
import { NewRule } from './NewRule'
import { RebuildButton } from './RebuildButton'

export const dynamic = 'force-dynamic'

export default async function PricingPage() {
  const db = await getDb()

  const rules = await db
    .select()
    .from(pricingRules)
    .orderBy(asc(pricingRules.priority), asc(pricingRules.id))

  const cats = await db
    .select({
      category: catalogItems.category,
      n: sql<number>`count(*)::int`,
      sale: sql<number>`sum(${catalogItems.saleSum})::bigint`,
    })
    .from(catalogItems)
    .groupBy(catalogItems.category)
    .orderBy(sql`sum(${catalogItems.saleSum}) desc`)

  const byCat = new Map(cats.map((c) => [c.category ?? '', c.n]))
  const categories = cats.map((c) => c.category).filter((c): c is string => Boolean(c))

  const [{ total, withCost }] = await db
    .select({
      total: sql<number>`count(*)::int`,
      withCost: sql<number>`count(*) filter (where ${catalogItems.unitCost} > 0)::int`,
    })
    .from(catalogItems)

  const general = rules.find((r) => !r.categoryPattern && r.isActive)
  const covered = rules
    .filter((r) => r.categoryPattern && r.isActive)
    .reduce((s, r) => s + (byCat.get(r.categoryPattern!) ?? 0), 0)

  const view: RuleView[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    categoryPattern: r.categoryPattern,
    minCost: r.minCost,
    maxCost: r.maxCost,
    markupPct: r.markupPct,
    priority: r.priority,
    isActive: r.isActive,
    note: r.note,
    covers: r.categoryPattern ? (byCat.get(r.categoryPattern) ?? 0) : 0,
  }))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Наценка</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Цена в коммерческом предложении считается от закупки по этим правилам, а не берётся
          средней из прошлых отгрузок: средняя тянет за собой все разовые скидки и распродажи.
          Правила проверяются сверху вниз, срабатывает первое подходящее — поэтому общее правило
          должно стоять последним.
        </p>
      </div>

      {rules.length === 0 ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Правил пока нет — цена берётся из истории отгрузок. Правила заводятся сами при первой
          загрузке прайс-листа.
        </p>
      ) : (
        <div className="flex flex-wrap gap-6 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
          <div>
            <div className="text-xs text-slate-500">Позиций в прайсе</div>
            <div className="text-lg font-semibold tabular-nums">{num(total)}</div>
            <div className="text-xs text-slate-400">с известной закупкой {num(withCost)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Своё правило</div>
            <div className="text-lg font-semibold tabular-nums">{num(covered)}</div>
            <div className="text-xs text-slate-400">позиций</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Общее правило</div>
            <div className="text-lg font-semibold tabular-nums">
              {general ? `${general.markupPct.toFixed(0)}%` : 'нет'}
            </div>
            <div className="text-xs text-slate-400">
              {general ? `${num(total - covered)} позиций` : 'цена возьмётся из истории'}
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className={`${GRID} border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500`}>
          <div>Правило</div>
          <div>Категория</div>
          <div className="text-right">позиций</div>
          <div className="text-right">закупка от</div>
          <div className="text-right">до</div>
          <div className="text-right">наценка %</div>
          <div className="text-right">порядок</div>
          <div className="text-center">вкл</div>
          <div />
        </div>

        <div className="divide-y divide-slate-100">
          {view.map((r) => (
            <RuleRow key={r.id} rule={r} categories={categories} />
          ))}
        </div>

        <NewRule categories={categories} baseMarkup={Math.round(general?.markupPct ?? 40)} />
      </div>

      <RebuildButton hasRules={rules.length > 0} />

      <p className="text-xs text-slate-400">
        Правила выведены из фактических отгрузок компании: у каждой крупной категории своя наценка,
        остальное покрывает общее правило. Менять их можно как угодно — расчёт подхватит сразу,
        уже сохранённые предложения не изменятся.
      </p>
    </div>
  )
}
