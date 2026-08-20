'use client'

import { useActionState } from 'react'
import { saveRule, type RuleState } from './actions'
import { GRID } from './RuleRow'

const field =
  'rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-slate-500'

export function NewRule({ categories, baseMarkup }: { categories: string[]; baseMarkup: number }) {
  const [state, action, pending] = useActionState<RuleState | null, FormData>(saveRule, null)

  return (
    <form action={action} className={`${GRID} border-t border-slate-200 bg-slate-50 px-4 py-2`}>
      <input name="name" placeholder="Название правила" className={field} required />

      <select name="categoryPattern" defaultValue="" className={field}>
        <option value="">— любая —</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <div />

      <input
        name="minCost"
        type="number"
        step="0.01"
        placeholder="от"
        className={`${field} text-right tabular-nums`}
      />
      <input
        name="maxCost"
        type="number"
        step="0.01"
        placeholder="до"
        className={`${field} text-right tabular-nums`}
      />
      <input
        name="markupPct"
        type="number"
        step="1"
        defaultValue={baseMarkup}
        className={`${field} text-right font-semibold tabular-nums`}
        required
      />
      <input
        name="priority"
        type="number"
        step="1"
        defaultValue={50}
        className={`${field} text-right tabular-nums`}
        required
      />

      <label className="flex items-center justify-center">
        <input type="checkbox" name="isActive" value="true" defaultChecked />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
        >
          {pending ? '…' : 'Добавить'}
        </button>
        {state ? (
          <span className={`text-xs ${state.ok ? 'text-emerald-700' : 'text-red-700'}`}>
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  )
}
