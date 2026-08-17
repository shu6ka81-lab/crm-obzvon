/**
 * Сессия в подписанной куке. Без БД, чтобы проверка работала в middleware.
 * Подпись — HMAC-SHA256 через Web Crypto: доступен и в Node, и в edge-рантайме.
 */

const ENC = new TextEncoder()

export const SESSION_COOKIE = 'os_session'
const MAX_AGE_SEC = 60 * 60 * 24 * 30 // 30 дней

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) {
    throw new Error(
      'SESSION_SECRET не задан или короче 32 символов. Сгенерируйте: openssl rand -base64 48',
    )
  }
  return s
}

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    ENC.encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (const b of arr) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface Session {
  userId: number
  exp: number // unix seconds
}

export async function signSession(userId: number): Promise<string> {
  const payload: Session = { userId, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC }
  const body = b64url(ENC.encode(JSON.stringify(payload)))
  const sig = b64url(await crypto.subtle.sign('HMAC', await key(), ENC.encode(body)))
  return `${body}.${sig}`
}

export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null

  const expected = b64url(await crypto.subtle.sign('HMAC', await key(), ENC.encode(body)))
  // Длины одинаковые, сравнение по всей строке — без раннего выхода.
  if (expected.length !== sig.length) return null
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  if (diff !== 0) return null

  try {
    const json = atob(body.replace(/-/g, '+').replace(/_/g, '/'))
    const parsed = JSON.parse(json) as Session
    if (typeof parsed.userId !== 'number' || typeof parsed.exp !== 'number') return null
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null
    return parsed
  } catch {
    return null
  }
}

export const COOKIE_OPTIONS = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: MAX_AGE_SEC,
  secure: process.env.NODE_ENV === 'production',
}
