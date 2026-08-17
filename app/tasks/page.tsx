import Link from 'next/link'
import { getOpenTasks } from '@/lib/queries'
import { completeTask } from '@/app/actions'
import { dateRu } from '@/lib/format'

export const dynamic = 'force-dynamic'

function bucket(due: string): 'overdue' | 'today' | 'later' {
  const today = new Date().toISOString().slice(0, 10)
  if (due < today) return 'overdue'
  if (due === today) return 'today'
  return 'later'
}

export default async function TasksPage() {
  const tasks = await getOpenTasks()

  const groups = {
    overdue: tasks.filter((t) => bucket(t.dueDate) === 'overdue'),
    today: tasks.filter((t) => bucket(t.dueDate) === 'today'),
    later: tasks.filter((t) => bucket(t.dueDate) === 'later'),
  }

  const titles = {
    overdue: 'Просрочены',
    today: 'На сегодня',
    later: 'Дальше',
  } as const

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Задачи</h1>
        <p className="mt-1 text-sm text-slate-500">
          Всё, о чём договорились на звонках. Это то, что раньше жило в голове менеджера.
        </p>
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          Открытых задач нет.
        </div>
      ) : null}

      {(['overdue', 'today', 'later'] as const).map((key) =>
        groups[key].length === 0 ? null : (
          <section key={key}>
            <h2
              className={`mb-2 text-sm font-semibold ${
                key === 'overdue' ? 'text-red-700' : 'text-slate-900'
              }`}
            >
              {titles[key]} · {groups[key].length}
            </h2>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
              {groups[key].map((t) => (
                <li key={t.id} className="flex items-center gap-4 px-4 py-3">
                  <form
                    action={async () => {
                      'use server'
                      await completeTask(t.id)
                    }}
                  >
                    <button
                      type="submit"
                      title="Отметить выполненной"
                      className="h-5 w-5 rounded border border-slate-300 transition hover:border-slate-900 hover:bg-slate-900"
                    />
                  </form>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">{t.title}</div>
                    <Link
                      href={`/clients/${encodeURIComponent(t.clientKey)}`}
                      className="truncate text-xs text-slate-500 hover:text-slate-900"
                    >
                      {t.clientName}
                    </Link>
                  </div>
                  <div className="shrink-0 text-right">
                    <div
                      className={`text-sm tabular-nums ${
                        key === 'overdue' ? 'text-red-700' : 'text-slate-600'
                      }`}
                    >
                      {dateRu(t.dueDate)}
                    </div>
                    <div className="text-xs text-slate-400">{t.assignee ?? '—'}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  )
}
