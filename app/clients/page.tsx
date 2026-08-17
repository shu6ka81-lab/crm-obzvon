import Link from 'next/link'
import { desc, ilike, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { clients } from '@/lib/db/schema'
import { clientKey, SEGMENT_LABEL } from '@/lib/queries'
import { dateRu, money, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const query = (q ?? '').trim()
  const db = await getDb()

  const where = query
    ? or(ilike(clients.name, `%${query}%`), ilike(clients.code1c, `%${query}%`))
    : undefined

  const rows = await db
    .select()
    .from(clients)
    .where(where)
    .orderBy(desc(clients.totalSum))
    .limit(100)

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(clients)
    .where(where)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Клиенты</h1>
          <p className="mt-1 text-sm text-slate-500">
            {query
              ? `Найдено ${num(Number(total))}, показаны первые 100`
              : `Всего ${num(Number(total))} карточек из 1С, показаны 100 крупнейших`}
          </p>
        </div>
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="Название или код в 1С"
            className="w-72 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          />
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Найти
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Клиент</th>
              <th className="px-4 py-2 font-medium">Сегмент</th>
              <th className="px-4 py-2 text-right font-medium">Купил всего</th>
              <th className="px-4 py-2 text-right font-medium">Отгрузок</th>
              <th className="px-4 py-2 font-medium">Последняя покупка</th>
              <th className="px-4 py-2 font-medium">Менеджер</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link
                    href={`/clients/${encodeURIComponent(clientKey(c))}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {c.name}
                  </Link>
                  <div className="text-xs text-slate-400">
                    {c.source === 'competitor' ? `ИНН ${c.inn}` : c.code1c}
                  </div>
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {SEGMENT_LABEL[c.segment] ?? c.segment}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{money(c.totalSum)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{num(c.shipmentsCount)}</td>
                <td className="px-4 py-2 text-slate-600">{dateRu(c.lastOrderDate)}</td>
                <td className="px-4 py-2 text-slate-600">{c.manager1c ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">Ничего не найдено.</p>
        ) : null}
      </div>
    </div>
  )
}
