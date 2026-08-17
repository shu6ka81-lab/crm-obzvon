import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getQuote } from '../actions'
import { CONFIDENCE_OK } from '@/lib/quote'
import { getClientById } from '@/lib/queries'
import { dateTimeRu, money, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const quoteId = Number(id)
  if (!Number.isInteger(quoteId)) notFound()

  const data = await getQuote(quoteId)
  if (!data) notFound()

  const { quote, items, author } = data
  const client = await getClientById(quote.clientId)
  const margin =
    quote.totalSale > 0 ? ((quote.totalSale - quote.totalCost) / quote.totalSale) * 100 : 0
  const weak = items.filter((i) => i.confidence < CONFIDENCE_OK || i.isManual).length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={`/clients/${client?.code1c ?? client?.inn ?? quote.clientId}`}
            className="text-xs text-slate-500 hover:text-slate-900"
          >
            ← {client?.name ?? 'Клиент'}
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            КП №{quote.id} · {client?.name}
          </h1>
          <p className="text-sm text-slate-500">
            {dateTimeRu(quote.createdAt)}
            {author ? ` · ${author}` : ''}
          </p>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <div className="text-xs text-slate-500">Сумма</div>
            <div className="text-lg font-semibold tabular-nums">{money(quote.totalSale)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Маржа</div>
            <div className="text-lg font-semibold tabular-nums">{margin.toFixed(0)}%</div>
            <div className="text-xs text-slate-400">{money(quote.totalSale - quote.totalCost)}</div>
          </div>
        </div>
      </div>

      {weak > 0 ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {num(weak)} позиций подобраны неуверенно или вписаны руками — проверьте перед отправкой.
        </p>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="w-8 px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Позиция</th>
              <th className="px-3 py-2 font-medium">Запрос клиента</th>
              <th className="w-20 px-3 py-2 text-right font-medium">Кол-во</th>
              <th className="w-24 px-3 py-2 text-right font-medium">Цена</th>
              <th className="w-28 px-3 py-2 text-right font-medium">Сумма</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((it) => (
              <tr key={it.id} className={it.isManual || it.confidence < CONFIDENCE_OK ? 'bg-amber-50/60' : ''}>
                <td className="px-3 py-2 text-slate-400">{it.lineNo}</td>
                <td className="px-3 py-2 font-medium text-slate-900">
                  {it.name}
                  {it.isManual ? (
                    <span className="ml-2 text-xs font-normal text-amber-700">вручную</span>
                  ) : it.confidence < CONFIDENCE_OK ? (
                    <span className="ml-2 text-xs font-normal text-amber-700">
                      совпадение {it.confidence}%
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{it.rawLine}</td>
                <td className="px-3 py-2 text-right tabular-nums">{it.qty}</td>
                <td className="px-3 py-2 text-right tabular-nums">{it.unitPrice}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {money(it.unitPrice * it.qty)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50">
            <tr>
              <td colSpan={5} className="px-3 py-2 text-right text-sm font-medium">
                Итого
              </td>
              <td className="px-3 py-2 text-right text-base font-semibold tabular-nums">
                {money(quote.totalSale)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
