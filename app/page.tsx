import Link from 'next/link'
import { listCampaigns, getFunnel } from '@/lib/queries'
import { money, num } from '@/lib/format'
import { CampaignClients } from './CampaignClients'

export const dynamic = 'force-dynamic'

function Bar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full bg-slate-800" style={{ width: `${pct}%` }} />
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</div>
      {hint ? <div className="text-xs text-slate-400">{hint}</div> : null}
    </div>
  )
}

export default async function Home() {
  const campaigns = await listCampaigns()
  const funnels = await Promise.all(campaigns.map((c) => getFunnel(c.id)))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Кампании обзвона</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Списки собраны из выгрузок 1С и книг продаж конкурентов. Очередь отсортирована по
          деньгам: своя база — по сумме покупок, база конкурента — по баллу приоритета.
        </p>
      </div>

      <div className="grid gap-4">
        {campaigns.map((c, i) => {
          const f = funnels[i]
          const total = Number(c.total)
          const done = Number(c.done)
          return (
            <div
              key={c.id}
              className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-slate-900">{c.name}</h2>
                  {c.description ? (
                    <p className="mt-1 max-w-2xl text-sm text-slate-500">{c.description}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={`/funnel/${c.id}`}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Воронка
                  </Link>
                  <Link
                    href={`/call/${c.id}`}
                    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
                  >
                    Звонить
                  </Link>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-6 sm:grid-cols-6">
                <Stat label="В списке" value={num(total)} />
                {Number(c.sumPreset) > 0 ? (
                  <Stat
                    label="Закупают за квартал"
                    value={money(Number(c.sumPreset))}
                    hint="у конкурента"
                  />
                ) : (
                  <Stat label="Купили у нас" value={money(Number(c.sumOwn))} />
                )}
                <Stat label="Набрано" value={num(f.called)} />
                <Stat label="Дозвонились" value={num(f.reached)} />
                <Stat label="Квалифицированы" value={num(f.qualified)} />
                <Stat
                  label="Заявок на просчёт"
                  value={num(f.quoteRequests)}
                  hint={
                    f.reached > 0
                      ? `${Math.round((f.quoteRequests / f.reached) * 100)}% от дозвонов`
                      : undefined
                  }
                />
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Bar value={done} total={total} />
                <span className="shrink-0 text-xs tabular-nums text-slate-500">
                  {num(done)} / {num(total)} отработано
                </span>
              </div>

              <CampaignClients campaignId={c.id} total={total} />
            </div>
          )
        })}
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm text-slate-500">
            Кампаний пока нет. Загрузите выгрузку из 1С на странице «Импорт».
          </p>
        </div>
      ) : null}
    </div>
  )
}
