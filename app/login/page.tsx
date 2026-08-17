import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { verifyPassword } from '@/lib/auth/password'
import { COOKIE_OPTIONS, SESSION_COOKIE, signSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

async function login(formData: FormData) {
  'use server'

  const loginRaw = String(formData.get('login') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const next = String(formData.get('next') ?? '') || '/'

  if (!loginRaw || !password) redirect('/login?error=1')

  const db = await getDb()
  const [user] = await db.select().from(users).where(eq(users.login, loginRaw)).limit(1)

  const ok = user && user.isActive && (await verifyPassword(password, user.passwordHash))
  if (!ok) redirect(`/login?error=1${next !== '/' ? `&next=${encodeURIComponent(next)}` : ''}`)

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))

  const jar = await cookies()
  jar.set(SESSION_COOKIE, await signSession(user.id), COOKIE_OPTIONS)
  jar.set('userId', String(user.id), { ...COOKIE_OPTIONS, httpOnly: true })

  redirect(next.startsWith('/') ? next : '/')
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const { error, next } = await searchParams

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="text-lg font-semibold tracking-tight">Вход</h1>
      <p className="mt-1 text-sm text-slate-500">Обзвон · Офисная Служба</p>

      <form action={login} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next ?? ''} />
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="login">
            Логин
          </label>
          <input
            id="login"
            name="login"
            autoComplete="username"
            autoFocus
            required
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="password">
            Пароль
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          />
        </div>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Неверный логин или пароль.
          </p>
        ) : null}

        <button
          type="submit"
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Войти
        </button>
      </form>
    </div>
  )
}
