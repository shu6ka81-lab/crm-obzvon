'use client'

import { useActionState } from 'react'
import { editQuoteItem, type LineState } from '../actions'
import { CONFIDENCE_OK } from '@/lib/quote'
import { money } from '@/lib/format'
import { GRID } from './grid'

export interface LineView {
  id: number
  lineNo: number
  name: string
  rawLine: string
  qty: number
  unitCost: number
  unitPrice: number
  suggestedPrice: number | null
  clientPrice: number | null
  marketPrice: number | null
  confidence: number
  isManual: boolean
  priceEdited: boolean
  ruleName: string | null
}

const field =
  'w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-right text-sm tabular-nums outline-none focus:border-slate-500'

function pct(sale: number, cost: number): number {
  return sale > 0 ? ((sale - cost) / sale) * 100 : 0
}

export function QuoteLine({ line }: { line: LineView }) {
  const [state, action, pending] = useActionState<LineState | null, FormData>(editQuoteItem, null)

  const margin = pct(line.unitPrice, line.unitCost)
  /** Ниже закупки продавать нельзя — это не «низкая маржа», это убыток. */
  const loss = line.unitPrice < line.unitCost
  const weak = line.isManual || line.confidence < CONFIDENCE_OK

  // Насколько мы дешевле того, что клиент платит сейчас
  const vsClient =
    line.clientPrice && line.clientPrice > 0
      ? ((line.clientPrice - line.unitPrice) / line.clientPrice) * 100
      : null

  return (
    <form action={action} className={`${GRID} px-3 py-1.5 ${loss ? 'bg-red-50' : weak ? 'bg-amber-50/60' : ''}`}>
      <input type="hidden" name="itemId" value={line.id} />

      <div className="text-xs text-slate-400">{line.lineNo}</div>

      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-slate-900" title={line.name}>
          {line.name}
        </div>
        <div className="truncate text-xs text-slate-400" title={line.rawLine}>
          {line.rawLine}
          {line.isManual ? ' · вручную' : line.confidence < CONFIDENCE_OK ? ` · совпадение ${line.confidence}%` : ''}
        </div>
      </div>

      <input name="qty" type="number" step="any" min="0" defaultValue={line.qty} className={field} />

      <div className="text-right text-sm tabular-nums text-slate-400">
        {line.unitCost > 0 ? line.unitCost.toFixed(2) : '—'}
      </div>

      <input
        name="unitPrice"
        type="number"
        step="0.01"
        min="0"
        defaultValue={line.unitPrice}
        className={`${field} font-semibold ${line.priceEdited ? 'border-slate-400' : ''}`}
        title={
          line.suggestedPrice != null
            ? `По правилу${line.ruleName ? ` «${line.ruleName}»` : ''}: ${line.suggestedPrice.toFixed(2)} ₽`
            : undefined
        }
      />

      <div
        className={`text-right text-sm tabular-nums ${loss ? 'font-semibold text-red-700' : margin < 15 ? 'text-amber-700' : 'text-slate-500'}`}
      >
        {line.unitCost > 0 ? `${margin.toFixed(0)}%` : '—'}
      </div>

      <input
        name="clientPrice"
        type="number"
        step="0.01"
        min="0"
        defaultValue={line.clientPrice ?? ''}
        placeholder="—"
        className={field}
        title="Почём клиент берёт сейчас — со слов в разговоре"
      />

      <input
        name="marketPrice"
        type="number"
        step="0.01"
        min="0"
        defaultValue={line.marketPrice ?? ''}
        placeholder="—"
        className={field}
        title="Цена у конкурента"
      />

      <div className="text-right text-sm font-medium tabular-nums">
        {money(line.unitPrice * line.qty)}
        {vsClient != null ? (
          <div
            className={`text-xs font-normal ${vsClient > 0 ? 'text-emerald-700' : 'text-red-700'}`}
          >
            {vsClient > 0 ? 'дешевле' : 'дороже'} на {Math.abs(vsClient).toFixed(0)}%
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
        >
          {pending ? '…' : 'ОК'}
        </button>
        {state ? (
          <span className={`text-xs ${state.ok ? 'text-emerald-700' : 'text-red-700'}`}>
            {state.ok ? '✓' : state.message}
          </span>
        ) : null}
      </div>
    </form>
  )
}
