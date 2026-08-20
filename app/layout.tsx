import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'
import { logout } from './actions'
import './globals.css'

export const metadata: Metadata = {
  title: 'Обзвон — Офисная Служба',
  description: 'Рабочий инструмент обзвона клиентской базы',
}

const NAV = [
  { href: '/', label: 'Кампании' },
  { href: '/tasks', label: 'Задачи' },
  { href: '/clients', label: 'Клиенты' },
  { href: '/pricing', label: 'Наценка' },
  { href: '/import', label: 'Импорт' },
]

async function currentUser() {
  try {
    const jar = await cookies()
    const session = await verifySession(jar.get(SESSION_COOKIE)?.value)
    if (!session) return null
    const db = await getDb()
    const [u] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1)
    return u ?? null
  } catch {
    return null
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser()

  return (
    <html lang="ru">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
            <Link href="/" className="text-[15px] font-semibold tracking-tight text-slate-900">
              Обзвон<span className="text-slate-400"> · Офисная Служба</span>
            </Link>

            {user ? (
              <>
                <nav className="flex gap-1">
                  {NAV.map((n) => (
                    <Link
                      key={n.href}
                      href={n.href}
                      className="rounded-md px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                    >
                      {n.label}
                    </Link>
                  ))}
                </nav>
                <div className="ml-auto flex items-center gap-3">
                  <span className="text-sm text-slate-500">{user.name}</span>
                  <form action={logout}>
                    <button
                      type="submit"
                      className="text-sm text-slate-400 transition hover:text-slate-900"
                    >
                      Выйти
                    </button>
                  </form>
                </div>
              </>
            ) : null}
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
      </body>
    </html>
  )
}
