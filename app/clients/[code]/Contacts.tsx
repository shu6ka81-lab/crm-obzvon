'use client'

import { useActionState } from 'react'
import {
  cancelBotCall,
  requestBotCall,
  saveClientContacts,
  type CallRequestState,
  type ContactsState,
} from '@/app/actions'

const field =
  'w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-slate-500'

/**
 * Контакты и вызов робота.
 *
 * Телефонов в выгрузках 1С нет вовсе, а находят их по ходу дела — в 2ГИС,
 * СБИС, на сайте компании. Раньше записать найденный номер было некуда,
 * и он жил в блокноте менеджера.
 */
export function Contacts({
  clientId,
  phone,
  contactPerson,
  email,
  hint,
  compact = false,
  bot,
}: {
  clientId: number
  phone: string | null
  contactPerson: string | null
  email: string | null
  /** Откуда брать номер, если его нет: у своих и у чужих компаний по-разному. */
  hint?: React.ReactNode
  /** На экране обзвона места мало — поля идут столбиком. */
  compact?: boolean
  /** На связи ли робот и что с заявкой по этому клиенту. */
  bot?: {
    online: boolean
    secondsAgo: number | null
    request: { state: string } | null
  }
}) {
  const [state, action, pending] = useActionState<ContactsState | null, FormData>(
    saveClientContacts,
    null,
  )
  const [call, callAction, calling] = useActionState<CallRequestState | null, FormData>(
    requestBotCall,
    null,
  )
  const [cancel, cancelAction, cancelling] = useActionState<CallRequestState | null, FormData>(
    cancelBotCall,
    null,
  )

  return (
    <div
      className={`rounded-lg border p-4 ${
        phone ? 'border-slate-200 bg-white' : 'border-red-200 bg-red-50'
      }`}
    >
      <form action={action}>
        <input type="hidden" name="clientId" value={clientId} />

        <h2 className="mb-2 text-sm font-semibold text-slate-900">Куда звонить</h2>

        {!phone ? (
          <p className="mb-3 text-sm text-red-900">
            {hint ?? 'Телефона нет — найдите в 2ГИС или СБИС и впишите сюда.'}
          </p>
        ) : null}

        <div className={compact ? 'grid gap-3' : 'grid gap-3 sm:grid-cols-3'}>
          <label>
            <span className="mb-1 block text-xs text-slate-500">Телефон</span>
            <input
              name="phone"
              defaultValue={phone ?? ''}
              placeholder="+7 812 000-00-00"
              className={field}
            />
          </label>
          <label>
            <span className="mb-1 block text-xs text-slate-500">Контактное лицо</span>
            <input
              name="contactPerson"
              defaultValue={contactPerson ?? ''}
              placeholder="кто закупает"
              className={field}
            />
          </label>
          <label>
            <span className="mb-1 block text-xs text-slate-500">Почта</span>
            <input
              name="email"
              defaultValue={email ?? ''}
              placeholder="для КП"
              className={field}
            />
          </label>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {pending ? 'Сохраняю…' : 'Сохранить'}
          </button>
          {state ? (
            <span className={`text-sm ${state.ok ? 'text-emerald-700' : 'text-red-700'}`}>
              {state.message}
            </span>
          ) : null}
        </div>
      </form>

      {/*
        Вызов робота — отдельной формой: нажатие «позвонить» не должно тянуть
        за собой сохранение полей, а сохранение — заказывать звонок.
      */}
      <form
        action={callAction}
        className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3"
      >
        <input type="hidden" name="clientId" value={clientId} />
        <button
          type="submit"
          disabled={calling || !phone}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:opacity-40"
          title={phone ? undefined : 'Сначала впишите телефон'}
        >
          {calling ? 'Ставлю в очередь…' : 'Позвонить роботом'}
        </button>

        {call ? (
          <span className={`text-sm ${call.ok ? 'text-emerald-800' : 'text-red-700'}`}>
            {call.message}
          </span>
        ) : null}
        {cancel ? <span className="text-sm text-slate-600">{cancel.message}</span> : null}
      </form>

      {/* Заказали по ошибке — должно быть чем отменить */}
      {bot?.request ? (
        <form action={cancelAction} className="mt-2">
          <input type="hidden" name="clientId" value={clientId} />
          <button
            type="submit"
            disabled={cancelling}
            className="text-xs text-slate-500 underline-offset-2 hover:text-red-700 hover:underline disabled:opacity-40"
          >
            {cancelling ? 'Отменяю…' : 'Отменить звонок'}
          </button>
        </form>
      ) : null}

      {/*
        Состояние робота. Без него нажатие кнопки уходит в тишину: человек
        не может отличить «робот не запущен» от «уже звонит». Молчание в ответ
        на нажатие — худшее, что интерфейс может сделать.
      */}
      {bot ? (
        <div className="mt-2 text-xs">
          {bot.online ? (
            <span className="text-emerald-700">
              ● Робот на связи
              {bot.request
                ? bot.request.state === 'calling'
                  ? ' — звонит этому клиенту'
                  : ' — заявка в очереди, наберёт через несколько секунд'
                : ' и ждёт заявок'}
            </span>
          ) : (
            <span className="text-amber-800">
              ● Робот не запущен
              {bot.secondsAgo != null
                ? `, последний раз выходил на связь ${Math.round(bot.secondsAgo / 60)} мин назад`
                : ' и ни разу не выходил на связь'}
              . Запустите на своей машине:{' '}
              <code className="rounded bg-slate-100 px-1">python scripts\crm_bridge.py --watch</code>
              {bot.request ? ' — заявка сохранена и уйдёт в работу, как только он поднимется.' : ''}
            </span>
          )}
        </div>
      ) : null}

      <p className="mt-2 max-w-xl text-xs text-slate-500">
        Робот наберёт номер, проведёт разговор и вернёт сюда расшифровку. Если клиент
        назовёт, что нужно закупить, — соберёт черновик КП.
      </p>
    </div>
  )
}
