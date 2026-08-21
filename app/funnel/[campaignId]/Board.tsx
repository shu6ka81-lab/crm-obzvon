'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { moveStage } from '@/app/actions'
import { ALL_STAGES, stageHint, stageLabel, type CampaignKind, type Stage } from '@/lib/funnel'
import type { BoardCard, BoardColumn } from '@/lib/queries'
import { daysAgoLabel, money, num } from '@/lib/format'

/** Цвет колонки. «Отказ» и «Начали работать» — выходы, их видно сразу. */
const COLUMN_TONE: Record<Stage, string> = {
  lead: 'border-slate-200',
  contacted: 'border-slate-200',
  audit: 'border-blue-200',
  quote: 'border-indigo-200',
  decision: 'border-amber-200',
  won: 'border-emerald-300',
  lost: 'border-red-200',
}

export function Board({
  campaignId,
  kind,
  columns,
  perColumn,
}: {
  campaignId: number
  kind: CampaignKind
  columns: BoardColumn[]
  perColumn: number
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<BoardCard | null>(null)
  const [over, setOver] = useState<Stage | null>(null)

  /** Локальная копия — чтобы карточка переехала сразу, не дожидаясь сервера. */
  const [state, setState] = useState<BoardColumn[]>(columns)
  const [serverColumns, setServerColumns] = useState(columns)
  if (serverColumns !== columns) {
    setServerColumns(columns)
    setState(columns)
  }

  const byStage = new Map(state.map((c) => [c.stage as Stage, c]))

  function move(card: BoardCard, to: Stage) {
    if (card.stage === to) return
    setError(null)

    const before = state
    setState((cols) =>
      cols.map((c) => {
        if (c.stage === card.stage) {
          return { ...c, total: c.total - 1, cards: c.cards.filter((x) => x.linkId !== card.linkId) }
        }
        if (c.stage === to) {
          return { ...c, total: c.total + 1, cards: [{ ...card, stage: to }, ...c.cards] }
        }
        return c
      }),
    )

    start(async () => {
      const res = await moveStage({ linkId: card.linkId, campaignId, stage: to })
      if (!res.ok) {
        // Возвращаем как было: показывать переезд, которого не случилось, нельзя
        setState(before)
        setError(res.error ?? 'Не удалось перенести')
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3 overflow-x-auto pb-3">
        {ALL_STAGES.map((stage) => {
          const col = byStage.get(stage)
          const total = col?.total ?? 0
          const cards = col?.cards ?? []
          const hidden = total - cards.length

          return (
            <div
              key={stage}
              data-stage={stage}
              onDragOver={(e) => {
                e.preventDefault()
                if (over !== stage) setOver(stage)
              }}
              onDragLeave={() => setOver((s) => (s === stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault()
                setOver(null)
                if (dragging) move(dragging, stage)
                setDragging(null)
              }}
              /*
               * Высота колонки ограничена, прокрутка — внутри неё. Без этого
               * колонка на сорок карточек растягивала страницу на пять тысяч
               * пикселей: соседние стадии уезжали за экран, и смысл доски —
               * видеть всё сразу — пропадал.
               */
              className={`flex max-h-[calc(100vh-15rem)] w-72 shrink-0 flex-col rounded-lg border-t-4 bg-slate-50 ${
                COLUMN_TONE[stage]
              } ${over === stage ? 'ring-2 ring-slate-400' : ''}`}
            >
              <div className="shrink-0 px-3 pb-2 pt-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{stageLabel(stage, kind)}</h3>
                  <span className="text-sm font-semibold tabular-nums text-slate-500">
                    {num(total)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs leading-tight text-slate-400">{stageHint(stage, kind)}</p>
                {col && col.money > 0 ? (
                  <p className="mt-1 text-xs tabular-nums text-slate-500">{money(col.money)}</p>
                ) : null}
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {cards.map((card) => (
                  <article
                    key={card.linkId}
                    draggable
                    onDragStart={() => setDragging(card)}
                    onDragEnd={() => {
                      setDragging(null)
                      setOver(null)
                    }}
                    className={`cursor-grab rounded-md border border-slate-200 bg-white p-2.5 shadow-sm transition active:cursor-grabbing ${
                      dragging?.linkId === card.linkId ? 'opacity-40' : 'hover:border-slate-300'
                    }`}
                  >
                    <Link
                      href={`/clients/${encodeURIComponent(card.key)}`}
                      className="block text-sm font-medium leading-snug text-slate-900 hover:underline"
                    >
                      {card.name}
                    </Link>

                    <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
                      <span className="tabular-nums">{money(card.totalSum)}</span>
                      {card.touchCount > 0 ? <span>· касаний {card.touchCount}</span> : null}
                    </div>

                    {card.stageChangedAt ? (
                      <div className="mt-0.5 text-xs text-slate-400">
                        на стадии {daysAgoLabel(card.stageChangedAt)}
                      </div>
                    ) : null}

                    {/*
                      Список стадий рядом с перетаскиванием — не дублирование:
                      мышью тащить удобно не всем и невозможно с телефона.
                    */}
                    <select
                      value={stage}
                      disabled={pending}
                      onChange={(e) => move(card, e.target.value as Stage)}
                      className="mt-2 w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600 outline-none focus:border-slate-500 disabled:opacity-50"
                    >
                      {ALL_STAGES.map((s) => (
                        <option key={s} value={s}>
                          {stageLabel(s, kind)}
                        </option>
                      ))}
                    </select>
                  </article>
                ))}

                {cards.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-slate-400">пусто</p>
                ) : null}

                {hidden > 0 ? (
                  <Link
                    href={`/call/${campaignId}/list`}
                    className="block rounded-md border border-dashed border-slate-300 px-2 py-2 text-center text-xs text-slate-500 hover:bg-white"
                  >
                    ещё {num(hidden)} — открыть списком
                  </Link>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-slate-400">
        Карточку можно перетащить мышью в другую колонку или выбрать стадию списком на самой
        карточке. Показаны первые {perColumn} по сумме покупок в каждой колонке — остальные
        открываются списком.
      </p>
    </div>
  )
}
