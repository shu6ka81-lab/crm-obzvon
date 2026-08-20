'use client'

import { useActionState } from 'react'
import { rebuildFromSales, type RuleState } from './actions'

export function RebuildButton({ hasRules }: { hasRules: boolean }) {
  const [state, action, pending] = useActionState<RuleState | null, FormData>(
    async () => rebuildFromSales(),
    null,
  )

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        onClick={(e) => {
          // Пересборка стирает правки руками — спрашиваем, чтобы это не
          // случилось от одного случайного нажатия.
          if (hasRules && !confirm('Правила будут собраны заново из отгрузок. Правки руками пропадут. Продолжить?')) {
            e.preventDefault()
          }
        }}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
      >
        {pending ? 'Считаю…' : 'Собрать заново из отгрузок'}
      </button>
      {state ? (
        <span className={`text-sm ${state.ok ? 'text-emerald-700' : 'text-red-700'}`}>
          {state.message}
        </span>
      ) : (
        <span className="text-xs text-slate-400">
          Пригодится после загрузки новых месяцев прайса
        </span>
      )}
    </form>
  )
}
