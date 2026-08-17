import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCampaign, listCampaignClients, OUTCOME_LABEL } from '@/lib/queries'
import { dateRu, daysAgoLabel, money, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

const STATE_LABEL: Record<string, string> = {
  pending: 'в очереди',
  in_progress: 'в работе',
  done: 'отработан',
  postponed: 'отложен',
}

const STATE_CLASS: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-600',
  in_progress: 'bg-blue-100 text-blue-700',
  done: 'bg-emerald-100 text-emerald-700',
  postponed: 'bg-amber-100 text-amber-700',
}

export default async function CampaignList({
  params,
}: {
  params: Promise<{ campaignId: string }>
}) {
  const { campaignId: raw } = await params
  const campaignId = Number(raw)
  if (!Number.isInteger(campaignId)) notFound()

  const campaign = await getCampaign(campaignId)
  if (!campaign) notFound()

  const rows = await listCampaignClients(campaignId)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/call/${campaignId}`} className="text-xs text-slate-500 hover:text-slate-900">
            ← К обзвону
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{campaign.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {num(rows.length)} в списке. Порядок — по сумме покупки. Можно позвонить любому,
            не дожидаясь очереди.
          </p>
        </div>
        <Link
          href={`/call/${campaignId}`}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Звонить по очереди
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="w-10 px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Клиент</th>
              <th className="px-3 py-2 text-right font-medium">Купил</th>
              <th className="px-3 py-2 font-medium">Последняя покупка</th>
              <th className="px-3 py-2 font-medium">Менеджер в 1С</th>
              <th className="px-3 py-2 font-medium">Состояние</th>
              <th className="w-24 px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={r.clientId} className="hover:bg-slate-50">
                <td className="px-3 py-2 tabular-nums text-slate-400">{i + 1}</td>
                <td className="px-3 py-2">
                  <Link
                    href={`/clients/${encodeURIComponent(r.key)}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {r.name}
                  </Link>
                  <div className="text-xs text-slate-400">
                    {r.source === 'competitor' ? `ИНН ${r.inn}` : r.code1c}
                    {r.touchCount > 0
                      ? ` · касаний ${r.touchCount}${
                          r.lastOutcome ? `, последнее: ${OUTCOME_LABEL[r.lastOutcome] ?? ''}` : ''
                        }`
                      : ''}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.totalSum)}</td>
                <td className="px-3 py-2 text-slate-600">
                  {dateRu(r.lastOrderDate)}
                  <span className="ml-1 text-xs text-slate-400">
                    {r.lastOrderDate ? daysAgoLabel(r.lastOrderDate) : ''}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600">{r.manager1c ?? '—'}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      STATE_CLASS[r.state] ?? 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {STATE_LABEL[r.state] ?? r.state}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    href={`/call/${campaignId}?client=${r.clientId}`}
                    className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Позвонить
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
