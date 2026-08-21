'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getLiveCall, type LiveCallView } from '@/app/actions'
import { Dialog } from './Dialog'

/**
 * Разговор, который идёт прямо сейчас.
 *
 * Смысл не в зрелище: слышно, что робот несёт не то, — и можно вмешаться
 * до конца звонка, а не читать расшифровку через час. Плюс сразу видно, что
 * звонок вообще пошёл, а не просто «заявка принята».
 */
export function LiveCall({ clientId, initial }: { clientId: number; initial: LiveCallView | null }) {
  const [live, setLive] = useState<LiveCallView | null>(initial)
  const router = useRouter()
  const box = useRef<HTMLDivElement>(null)
  const wasLive = useRef(Boolean(initial && !initial.finished))

  useEffect(() => {
    let alive = true

    const tick = async () => {
      const next = await getLiveCall(clientId)
      if (!alive) return
      setLive(next)

      /*
       * Разговор закончился — обновляем страницу: запись, расшифровка и
       * собранное КП уже легли в историю, и человек должен увидеть их
       * сразу, а не гадать, куда делся звонок.
       */
      if (wasLive.current && (!next || next.finished)) {
        wasLive.current = false
        router.refresh()
      }
      if (next && !next.finished) wasLive.current = true
    }

    const id = setInterval(tick, 2000)
    void tick()
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [clientId, router])

  // Прокручиваем к последней реплике: смотрят конец разговора, а не начало
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [live?.transcript])

  if (!live) return null

  return (
    <div data-live className="rounded-lg border border-emerald-300 bg-emerald-50/40 p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
          <span className={live.finished ? '' : 'animate-pulse'}>●</span>
          {live.finished ? 'Разговор закончен' : 'Идёт разговор'}
        </h2>
        <span className="text-xs text-emerald-800">{live.status}</span>
      </div>

      {live.transcript ? (
        <div ref={box} className="max-h-80 overflow-y-auto pr-1">
          <Dialog text={live.transcript} />
        </div>
      ) : (
        <p className="text-sm text-emerald-900">Набираем номер…</p>
      )}
    </div>
  )
}
