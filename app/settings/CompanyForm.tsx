'use client'

import { useActionState } from 'react'
import { saveCompany, type SettingsState } from './actions'
import type { CompanyProfile } from '@/lib/company'

const FIELDS: {
  key: keyof CompanyProfile
  label: string
  hint?: string
  wide?: boolean
  rows?: number
}[] = [
  { key: 'name', label: 'Название для шапки', hint: 'Как компанию знают клиенты' },
  { key: 'slogan', label: 'Строка под названием', hint: 'Короткая, в одну строку' },
  { key: 'legalName', label: 'Организация', hint: 'Как в документах' },
  { key: 'inn', label: 'ИНН' },
  { key: 'kpp', label: 'КПП' },
  { key: 'address', label: 'Адрес', wide: true },
  { key: 'phone', label: 'Телефон' },
  { key: 'email', label: 'Почта' },
  { key: 'site', label: 'Сайт' },
  { key: 'validDays', label: 'Срок действия, дней', hint: 'Строка в подвале предложения' },
  { key: 'signerTitle', label: 'Должность подписывающего' },
  { key: 'signerName', label: 'Фамилия и инициалы' },
  { key: 'footer', label: 'Текст подвала', wide: true },
  {
    key: 'benefits',
    label: 'Что получает клиент',
    hint: 'По строке на пункт — они печатаются в предложении списком',
    wide: true,
    rows: 5,
  },
]

const field =
  'w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-slate-500'

export function CompanyForm({ company }: { company: CompanyProfile }) {
  const [state, action, pending] = useActionState<SettingsState | null, FormData>(
    saveCompany,
    null,
  )

  return (
    <form action={action} className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className={f.wide ? 'sm:col-span-2' : undefined}>
            <span className="mb-1 block text-xs text-slate-500">{f.label}</span>
            {f.rows ? (
              <textarea
                name={f.key}
                defaultValue={company[f.key]}
                rows={f.rows}
                className={`${field} resize-y`}
              />
            ) : (
              <input name={f.key} defaultValue={company[f.key]} className={field} />
            )}
            {f.hint ? <span className="mt-1 block text-xs text-slate-400">{f.hint}</span> : null}
          </label>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
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
