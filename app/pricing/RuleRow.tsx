'use client'

import { useActionState } from 'react'
import { deleteRule, saveRule, type RuleState } from './actions'
import { GRID } from './grid'

export interface RuleView {
  id: number
  name: string
  categoryPattern: string | null
  minCost: number | null
  maxCost: number | null
  markupPct: number
  priority: number
  isActive: boolean
  note: string | null
  /** Сколько позиций прайса попадает под это правило. */
  covers: number
}

const field =
  'rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-slate-500'

export function RuleRow({ rule, categories }: { rule: RuleView; categories: string[] }) {
  const [state, action, pending] = useActionState<RuleState | null, FormData>(saveRule, null)
  const [delState, delAction, delPending] = useActionState<RuleState | null, FormData>(
    deleteRule,
    null,
  )

  return (
    <div className={rule.isActive ? '' : 'opacity-50'}>
      <form action={action} className={`${GRID} px-4 py-1.5`}>
        <input type="hidden" name="id" value={rule.id} />

        <input name="name" defaultValue={rule.name} className={field} />

        <select name="categoryPattern" defaultValue={rule.categoryPattern ?? ''} className={field}>
          <option value="">— любая —</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <div className="text-right text-sm tabular-nums text-slate-400">
          {rule.covers > 0 ? rule.covers : '—'}
        </div>

        <input
          name="minCost"
          type="number"
          step="0.01"
          defaultValue={rule.minCost ?? ''}
          placeholder="от"
          className={`${field} text-right tabular-nums`}
        />
        <input
          name="maxCost"
          type="number"
          step="0.01"
          defaultValue={rule.maxCost ?? ''}
          placeholder="до"
          className={`${field} text-right tabular-nums`}
        />
        <input
          name="markupPct"
          type="number"
          step="1"
          defaultValue={rule.markupPct}
          className={`${field} text-right font-semibold tabular-nums`}
        />
        <input
          name="priority"
          type="number"
          step="1"
          defaultValue={rule.priority}
          className={`${field} text-right tabular-nums`}
        />

        <label className="flex items-center justify-center">
          <input type="checkbox" name="isActive" value="true" defaultChecked={rule.isActive} />
        </label>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {pending ? '…' : 'Сохранить'}
          </button>
          {state ? (
            <span className={`text-xs ${state.ok ? 'text-emerald-700' : 'text-red-700'}`}>
              {state.message}
            </span>
          ) : null}
        </div>
      </form>

      <div className="flex items-center gap-3 px-4 pb-1.5 text-xs text-slate-400">
        {rule.note ? <span>{rule.note}</span> : null}
        <form action={delAction} className="contents">
          <input type="hidden" name="id" value={rule.id} />
          <button
            type="submit"
            disabled={delPending}
            className="hover:text-red-700 disabled:opacity-40"
          >
            {delPending ? '…' : 'удалить'}
          </button>
        </form>
        {delState && !delState.ok ? (
          <span className="text-red-700">{delState.message}</span>
        ) : null}
      </div>
    </div>
  )
}
