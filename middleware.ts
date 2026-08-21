import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'

/**
 * Всё закрыто по умолчанию. Открыт только вход и статика.
 * Проверяется подпись куки — без обращения к базе, поэтому работает в middleware.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl

  if (pathname === '/login' || pathname.startsWith('/_next') || pathname === '/favicon.ico') {
    return NextResponse.next()
  }

  /*
   * Ход робота. Он ходит не браузером и куки не носит — у него свой ключ,
   * который проверяется в самом обработчике. Перенаправлять его на форму
   * входа бессмысленно: он получит страницу вместо ответа и промолчит.
   */
  if (pathname.startsWith('/api/bot/')) {
    return NextResponse.next()
  }

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value)
  if (session) return NextResponse.next()

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
