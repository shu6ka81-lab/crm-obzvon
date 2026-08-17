import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCampaign, getStageFunnel } from '@/lib/queries'
import { FUNNEL_ORDER, STAGE_HINT, STAGE_LABEL, type Stage } from '@/lib/funnel'
import { money, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function FunnelPage({
  params,
}: {
  params: Promise<{ campaignId: string }>
}) {
  const { campaignId: raw } = await params
  const campaignId = Number(raw)
  if (!Number.isInteger(campaignId)) notFound()

  const campaign = await getCampaign(campaignId)
  if (!campaign) notFound()

  const rows = await getStageFunnel(campaignId)
  const byStage = new Map(rows.map((r) => [r.stage as Stage, r]))
  const top = byStage.get('lead')?.reached ?? 0
  const lost = byStage.get('lost')

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/call/${campaignId}`} className="text-xs text-slate-500 hover:text-slate-900">
          ← К обзвону
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Воронка · {campaign.name}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          «Дошли» — сколько компаний находятся на этой стадии или прошли её дальше.
          Конверсия считается от предыдущей ступени.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Стадия</th>
              <th className="px-4 py-2 text-right font-medium">Дошли</th>
              <th className="px-4 py-2 text-right font-medium">Из предыдущей</th>
              <th className="px-4 py-2 text-right font-medium">От начала</th>
              <th className="px-4 py-2 text-right font-medium">Сейчас здесь</th>
              <th className="px-4 py-2 text-right font-medium">Деньги на стадии</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {FUNNEL_ORDER.map((stage, i) => {
              const r = byStage.get(stage)
              const reached = r?.reached ?? 0
              const prev = i === 0 ? null : (byStage.get(FUNNEL_ORDER[i - 1])?.reached ?? 0)
              const width = top > 0 ? Math.max((reached / top) * 100, reached > 0 ? 2 : 0) : 0
              return (
                <tr key={stage}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{STAGE_LABEL[stage]}</div>
                    <div className="text-xs text-slate-400">{STAGE_HINT[stage]}</div>
                    <div className="mt-1.5 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-slate-800" style={{ width: `${width}%` }} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-base font-semibold tabular-nums">
                    {num(reached)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                    {prev === null ? '—' : prev > 0 ? `${Math.round((reached / prev) * 100)}%` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                    {top > 0 ? `${Math.round((reached / top) * 100)}%` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                    {num(r?.count ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                    {money(r?.money ?? 0)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {lost && lost.count > 0 ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-red-900">Отказы</h2>
            <span className="text-lg font-semibold tabular-nums text-red-900">
              {num(lost.count)}
            </span>
          </div>
          <p className="mt-1 text-xs text-red-800">
            Вышли из воронки. Деньги, которые они тратят на офисные товары:{' '}
            {money(lost.money)} за квартал.
          </p>
        </div>
      ) : null}
    </div>
  )
}
