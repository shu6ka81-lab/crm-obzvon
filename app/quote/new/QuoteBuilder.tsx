'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { matchRequest, saveQuote } from '../actions'
import { CONFIDENCE_OK, type MatchedLine } from '@/lib/quote'

const FIELD =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200'

interface Row {
  lineNo: number
  raw: string
  qty: number
  chosen: number // индекс в options, -1 = не подобрано
  options: MatchedLine['options']
  manualName: string
  manualPrice: number
}

function money(n: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽'
}

export function QuoteBuilder({
  clientId,
  clientName,
  campaignClientId,
}: {
  clientId: number
  clientName: string
  campaignClientId?: number
}) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function doMatch() {
    setError(null)
    start(async () => {
      const matched = await matchRequest(text)
      setRows(
        matched.map((m) => ({
          lineNo: m.lineNo,
          raw: m.raw,
          qty: m.qty,
          chosen: m.options.length > 0 ? 0 : -1,
          options: m.options,
          manualName: m.raw,
          manualPrice: 0,
        })),
      )
    })
  }

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev && prev.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  }

  const priced = (rows ?? []).map((r) => {
    const opt = r.chosen >= 0 ? r.options[r.chosen] : null
    return {
      row: r,
      name: opt?.name ?? r.manualName,
      unitPrice: opt?.unitPrice ?? r.manualPrice,
      unitCost: opt?.unitCost ?? 0,
      confidence: opt?.confidence ?? 0,
      catalogItemId: opt?.id ?? null,
      sum: (opt?.unitPrice ?? r.manualPrice) * r.qty,
      cost: (opt?.unitCost ?? 0) * r.qty,
    }
  })

  const total = priced.reduce((s, p) => s + p.sum, 0)
  const totalCost = priced.reduce((s, p) => s + p.cost, 0)
  const margin = total > 0 ? ((total - totalCost) / total) * 100 : 0
  const weak = priced.filter((p) => p.catalogItemId && p.confidence < CONFIDENCE_OK).length
  const missing = priced.filter((p) => !p.catalogItemId).length

  function save() {
    setError(null)
    start(async () => {
      const res = await saveQuote({
        clientId,
        campaignClientId,
        rawInput: text,
        items: priced.map((p) => ({
          lineNo: p.row.lineNo,
          rawLine: p.row.raw,
          qty: p.row.qty,
          catalogItemId: p.catalogItemId,
          name: p.name,
          unitPrice: p.unitPrice,
          unitCost: p.unitCost,
          confidence: p.confidence,
          isManual: p.catalogItemId === null,
        })),
      })
      if (!res.ok) setError(res.error)
      else router.push(`/quote/${res.quoteId}`)
    })
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="list">
          Список позиций от клиента
        </label>
        <p className="mb-2 text-xs text-slate-500">
          Вставьте как есть — построчно, из письма или таблицы. Количество в конце строки
          распознаётся само: «Бумага А4 — 20», «Перчатки нитриловые M 100шт».
        </p>
        <textarea
          id="list"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={FIELD + ' font-mono text-[13px]'}
          placeholder={'Бумага А4 500 листов — 20 пачек\nПерчатки нитриловые M 100шт\nКофе в зернах 1 кг'}
        />
        <button
          type="button"
          onClick={doMatch}
          disabled={pending || text.trim().length < 3}
          className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-40"
        >
          {pending ? 'Подбираю…' : 'Подобрать позиции'}
        </button>
      </div>

      {rows && rows.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Позиций" value={String(rows.length)} />
            <Stat label="Сумма КП" value={money(total)} />
            <Stat
              label="Наша маржа"
              value={`${margin.toFixed(0)}%`}
              hint={money(total - totalCost)}
            />
            <Stat
              label="Требуют проверки"
              value={String(weak + missing)}
              hint={missing > 0 ? `${missing} не найдено` : undefined}
              alarm={weak + missing > 0}
            />
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="w-8 px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Запрос клиента</th>
                  <th className="px-3 py-2 font-medium">Что предлагаем</th>
                  <th className="w-20 px-3 py-2 text-right font-medium">Кол-во</th>
                  <th className="w-24 px-3 py-2 text-right font-medium">Цена</th>
                  <th className="w-28 px-3 py-2 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {priced.map((p, i) => {
                  const r = p.row
                  const low = p.catalogItemId && p.confidence < CONFIDENCE_OK
                  return (
                    <tr key={i} className={!p.catalogItemId || low ? 'bg-amber-50/60' : ''}>
                      <td className="px-3 py-2 text-slate-400">{r.lineNo}</td>
                      <td className="px-3 py-2 text-slate-600">{r.raw}</td>
                      <td className="px-3 py-2">
                        {r.options.length > 0 ? (
                          <select
                            value={r.chosen}
                            onChange={(e) => update(i, { chosen: Number(e.target.value) })}
                            className={FIELD}
                          >
                            {r.options.map((o, k) => (
                              <option key={o.id} value={k}>
                                {o.confidence}% · {o.name} · {o.unitPrice} ₽
                              </option>
                            ))}
                            <option value={-1}>— вписать вручную —</option>
                          </select>
                        ) : (
                          <input
                            value={r.manualName}
                            onChange={(e) => update(i, { manualName: e.target.value })}
                            className={FIELD}
                            placeholder="ничего не подобралось — впишите название"
                          />
                        )}
                        {low ? (
                          <p className="mt-1 text-xs text-amber-700">
                            Совпадение слабое — проверьте, то ли это
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={r.qty}
                          onChange={(e) => update(i, { qty: Number(e.target.value) || 0 })}
                          className={FIELD + ' text-right'}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {p.catalogItemId ? (
                          <div className="text-right tabular-nums">{p.unitPrice}</div>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={r.manualPrice}
                            onChange={(e) => update(i, { manualPrice: Number(e.target.value) || 0 })}
                            className={FIELD + ' text-right'}
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {money(p.sum)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-40"
            >
              Сохранить КП для {clientName}
            </button>
            <span className="text-xs text-slate-500">
              Сумма {money(total)}, маржа {margin.toFixed(0)}%
            </span>
          </div>
        </>
      ) : rows ? (
        <p className="text-sm text-slate-500">Ни одной строки не разобрано.</p>
      ) : null}
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  alarm,
}: {
  label: string
  value: string
  hint?: string
  alarm?: boolean
}) {
  return (
    <div className={`rounded-lg border p-3 ${alarm ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-xs text-slate-400">{hint}</div> : null}
    </div>
  )
}
