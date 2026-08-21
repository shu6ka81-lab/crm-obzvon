import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCampaign, getStageBoard, getStageFunnel } from '@/lib/queries'
import { FUNNEL_ORDER, STAGE_HINT, STAGE_LABEL, type Stage } from '@/lib/funnel'
import { money, num } from '@/lib/format'
import { Board } from './Board'

export const dynamic = 'force-dynamic'

/** Сколько карточек показывать в колонке. Остальные — списком. */
const PER_COLUMN = 40

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

  const [rows, columns] = await Promise.all([
    getStageFunnel(campaignId),
    getStageBoard(campaignId, PER_COLUMN),
  ])
  const byStage = new Map(rows.map((r) => [r.stage as Stage, r]))
  const top = byStage.get('lead')?.reached ?? 0
  const lost = byStage.get('lost')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/call/${campaignId}`} className="text-xs text-slate-500 hover:text-slate-900">
            ← К обзвону
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Воронка · {campaign.name}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Кто на какой стадии. Карточку можно перетащить в соседнюю колонку — переход
            запишется в историю клиента.
          </p>
        </div>
        <Link
          href={`/call/${campaignId}/list`}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Весь список
        </Link>
      </div>

      <Board campaignId={campaignId} columns={columns} perColumn={PER_COLUMN} />

      <div>
        <h2 className="text-sm font-semibold text-slate-900">Конверсия по ступеням</h2>
        <p className="mt-0.5 max-w-3xl text-sm text-slate-500">
          «Дошли» — сколько компаний находятся на этой стадии или прошли её дальше. Конверсия
          считается от предыдущей ступени.
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
