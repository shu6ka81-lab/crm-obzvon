'use client'

import { useActionState } from 'react'
import type { UploadState } from './actions'

type Action = (prev: UploadState | null, formData: FormData) => Promise<UploadState>

/**
 * Форма загрузки, которая говорит, что происходит и чем кончилось.
 *
 * Раньше загрузка молчала всё время разбора — а он идёт до минуты. Человек
 * решал, что нажатие не сработало, и жал снова: в истории появлялись три
 * одинаковые загрузки подряд.
 */
export function UploadForm({
  action,
  title,
  hint,
  multiple = false,
}: {
  action: Action
  title: string
  hint: string
  multiple?: boolean
}) {
  const [state, formAction, pending] = useActionState<UploadState | null, FormData>(action, null)

  return (
    <form action={formAction} className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 mb-3 max-w-2xl text-sm text-slate-500">{hint}</p>

      <div className="flex flex-wrap items-center gap-3">
        <input
          name="files"
          type="file"
          accept=".xlsx"
          multiple={multiple}
          required
          disabled={pending}
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700 disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-40"
        >
          {pending ? 'Загружаю…' : 'Загрузить'}
        </button>
        {pending ? (
          <span className="text-sm text-slate-500">
            Разбираю — это занимает до минуты. Не закрывайте страницу.
          </span>
        ) : null}
      </div>

      {state && !pending ? (
        <div
          className={`mt-4 rounded-md border px-4 py-3 text-sm ${
            state.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <p className="font-medium">{state.headline}</p>
          {state.lines.length > 0 ? (
            <ul className="mt-2 space-y-1 text-slate-700">
              {state.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
          {state.warnings.length > 0 ? (
            <ul className="mt-2 space-y-1 text-amber-900">
              {state.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}
