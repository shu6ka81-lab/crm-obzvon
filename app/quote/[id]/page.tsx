import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getQuote } from '../actions'
import { CONFIDENCE_OK } from '@/lib/quote'
import { marginPct } from '@/lib/pricing'
import { getClientById } from '@/lib/queries'
import { dateTimeRu, money, num } from '@/lib/format'
import { QuoteLine, type LineView } from './QuoteLines'
import { GRID } from './grid'

export const dynamic = 'force-dynamic'

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const quoteId = Number(id)
  if (!Number.isInteger(quoteId)) notFound()

  const data = await getQuote(quoteId)
  if (!data) notFound()

  const { quote, items, author } = data
  const client = await getClientById(quote.clientId)

  const margin = marginPct(quote.totalSale, quote.totalCost)
  const weak = items.filter((i) => i.confidence < CONFIDENCE_OK || i.isManual).length
  const loss = items.filter((i) => i.unitPrice < i.unitCost).length
  const edited = items.filter((i) => i.priceEdited).length

  // Сравнение с тем, что клиент платит сейчас — считаем только по тем строкам,
  // где цена клиента известна, иначе получится сравнение с пустотой.
  const withClient = items.filter((i) => i.clientPrice != null && i.clientPrice > 0)
  const clientSum = withClient.reduce((s, i) => s + (i.clientPrice ?? 0) * i.qty, 0)
  const ourSum = withClient.reduce((s, i) => s + i.unitPrice * i.qty, 0)
  const saving = clientSum > 0 ? ((clientSum - ourSum) / clientSum) * 100 : null

  const lines: LineView[] = items.map((i) => ({
    id: i.id,
    lineNo: i.lineNo,
    name: i.name,
    rawLine: i.rawLine,
    qty: i.qty,
    unitCost: i.unitCost,
    unitPrice: i.unitPrice,
    suggestedPrice: i.suggestedPrice,
    clientPrice: i.clientPrice,
    marketPrice: i.marketPrice,
    confidence: i.confidence,
    isManual: i.isManual,
    priceEdited: i.priceEdited,
    ruleName: i.ruleName,
  }))

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

        <div className="flex flex-wrap gap-6 text-right">
          <div>
            <div className="text-xs text-slate-500">Сумма</div>
            <div data-total className="text-lg font-semibold tabular-nums">
              {money(quote.totalSale)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Маржа</div>
            <div
              className={`text-lg font-semibold tabular-nums ${margin < 10 ? 'text-red-700' : ''}`}
            >
              {margin.toFixed(0)}%
            </div>
            <div className="text-xs text-slate-400">{money(quote.totalSale - quote.totalCost)}</div>
          </div>
          {saving != null ? (
            <div>
              <div className="text-xs text-slate-500">Против цен клиента</div>
              <div
                className={`text-lg font-semibold tabular-nums ${saving > 0 ? 'text-emerald-700' : 'text-red-700'}`}
              >
                {saving > 0 ? '−' : '+'}
                {Math.abs(saving).toFixed(0)}%
              </div>
              <div className="text-xs text-slate-400">по {num(withClient.length)} позициям</div>
            </div>
          ) : null}
          <div className="self-center">
            <a
              href={`/quote/${quote.id}/pdf`}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Скачать КП
            </a>
          </div>
        </div>
      </div>

      {loss > 0 ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {num(loss)} позиций дешевле закупки — это не низкая маржа, это убыток. Проверьте цену.
        </p>
      ) : null}
      {weak > 0 ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {num(weak)} позиций подобраны неуверенно или вписаны руками — проверьте перед отправкой.
        </p>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className={`${GRID} border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500`}>
          <div>#</div>
          <div>Позиция</div>
          <div className="text-right">Кол-во</div>
          <div className="text-right">Закупка</div>
          <div className="text-right">Наша цена</div>
          <div className="text-right">Маржа</div>
          <div className="text-right">У клиента</div>
          <div className="text-right">Конкурент</div>
          <div className="text-right">Сумма</div>
          <div />
        </div>

        <div className="divide-y divide-slate-100">
          {lines.map((l) => (
            <QuoteLine key={l.id} line={l} />
          ))}
        </div>

        <div className={`${GRID} border-t border-slate-200 bg-slate-50 px-3 py-2 text-sm`}>
          <div />
          <div className="font-medium">Итого</div>
          <div />
          <div className="text-right tabular-nums text-slate-400">{money(quote.totalCost)}</div>
          <div />
          <div className={`text-right tabular-nums ${margin < 10 ? 'text-red-700' : 'text-slate-500'}`}>
            {margin.toFixed(0)}%
          </div>
          <div className="text-right tabular-nums text-slate-400">
            {clientSum > 0 ? money(clientSum) : ''}
          </div>
          <div />
          <div className="text-right text-base font-semibold tabular-nums">
            {money(quote.totalSale)}
          </div>
          <div />
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Цена посчитана от закупки по <Link href="/pricing" className="underline hover:text-slate-700">правилам наценки</Link>.
        Правленая руками цена помечается рамкой и при пересчёте не затирается.
        {edited > 0 ? ` Сейчас правлено вручную: ${num(edited)}.` : ''}
      </p>
    </div>
  )
}
