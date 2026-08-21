'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { previewCampaignClients, type CampaignPreviewRow } from './actions'
import { dateRu, money, num } from '@/lib/format'

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

const STEP = 25

/**
 * Раскрывающийся список компаний кампании.
 *
 * Раньше со страницы кампаний можно было только нажать «Звонить» и попасть
 * в очередь. Посмотреть, кто вообще в списке, и открыть нужную компанию было
 * негде — а начинают обычно именно с этого.
 *
 * Список грузится по требованию: пять очередей целиком — пять тысяч строк,
 * которые почти всегда не нужны.
 */
export function CampaignClients({
  campaignId,
  total,
}: {
  campaignId: number
  total: number
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<CampaignPreviewRow[] | null>(null)
  const [pending, start] = useTransition()

  function load(limit: number) {
    start(async () => setRows(await previewCampaignClients(campaignId, limit)))
  }

  function toggle() {
    if (!open && rows === null) load(STEP)
    setOpen((v) => !v)
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1.5 text-sm font-medium text-slate-600 transition hover:text-slate-900"
      >
        <span
          className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          ▸
        </span>
        {open ? 'Скрыть список' : `Показать компании (${num(total)})`}
        {pending && rows === null ? (
          <span className="text-xs font-normal text-slate-400">загружаю…</span>
        ) : null}
      </button>

      {open && rows ? (
        <div className="mt-3 overflow-hidden rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="w-8 px-3 py-1.5 font-medium">#</th>
                <th className="px-3 py-1.5 font-medium">Компания</th>
                <th className="px-3 py-1.5 text-right font-medium">Купила</th>
                <th className="px-3 py-1.5 font-medium">Последняя покупка</th>
                <th className="px-3 py-1.5 font-medium">Состояние</th>
                <th className="w-24 px-3 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={r.clientId} className="hover:bg-slate-50">
                  <td className="px-3 py-1.5 tabular-nums text-slate-400">{i + 1}</td>
                  <td className="px-3 py-1.5">
                    <Link
                      href={`/clients/${encodeURIComponent(r.key)}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.touchCount > 0 ? (
                      <span className="ml-2 text-xs text-slate-400">
                        касаний {r.touchCount}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(r.totalSum)}</td>
                  <td className="px-3 py-1.5 text-slate-600">{dateRu(r.lastOrderDate)}</td>
                  <td className="px-3 py-1.5">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        STATE_CLASS[r.state] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {STATE_LABEL[r.state] ?? r.state}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Link
                      href={`/call/${campaignId}?client=${r.clientId}`}
                      className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Позвонить
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-3 py-2">
            <span className="text-xs text-slate-500">
              Показано {num(rows.length)} из {num(total)}
            </span>
            <div className="flex items-center gap-3">
              {rows.length < total && rows.length < 200 ? (
                <button
                  type="button"
                  onClick={() => load(Math.min(rows.length + STEP * 3, 200))}
                  disabled={pending}
                  className="text-xs font-medium text-slate-600 hover:text-slate-900 disabled:opacity-40"
                >
                  {pending ? 'загружаю…' : 'Показать ещё'}
                </button>
              ) : null}
              <Link
                href={`/call/${campaignId}/list`}
                className="text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Весь список →
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
