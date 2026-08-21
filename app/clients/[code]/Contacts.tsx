'use client'

import { useActionState } from 'react'
import { saveClientContacts, type ContactsState } from '@/app/actions'

const field =
  'w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-slate-500'

/**
 * Контакты руками. В выгрузках 1С телефонов нет вовсе, а находят их по ходу
 * дела — в 2ГИС, СБИС, на сайте компании. Раньше записать найденный номер
 * было некуда, и он жил в блокноте менеджера.
 */
export function Contacts({
  clientId,
  phone,
  contactPerson,
  email,
}: {
  clientId: number
  phone: string | null
  contactPerson: string | null
  email: string | null
}) {
  const [state, action, pending] = useActionState<ContactsState | null, FormData>(
    saveClientContacts,
    null,
  )

  return (
    <form
      action={action}
      className={`rounded-lg border p-4 ${
        phone ? 'border-slate-200 bg-white' : 'border-red-200 bg-red-50'
      }`}
    >
      <input type="hidden" name="clientId" value={clientId} />

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Куда звонить</h2>
        {!phone ? (
          <span className="text-xs text-red-800">
            Телефона нет — найдите в 2ГИС или СБИС и впишите
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
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
          <input name="email" defaultValue={email ?? ''} placeholder="для КП" className={field} />
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
  )
}
