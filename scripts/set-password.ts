/**
 * Заводит логин и пароль пользователю.
 * Запуск: npm run user:password -- <логин> <пароль> ["Имя"] [manager|head]
 *
 * Если пользователя с таким логином нет — создаётся новый.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../lib/db'
import { users } from '../lib/db/schema'
import { hashPassword } from '../lib/auth/password'

async function main() {
  const [login, password, name, role] = process.argv.slice(2)

  if (!login || !password) {
    console.error('Использование: npm run user:password -- <логин> <пароль> ["Имя"] [manager|head]')
    process.exit(1)
  }
  if (password.length < 8) {
    console.error('Пароль короче 8 символов — так не надо.')
    process.exit(1)
  }

  const db = await getDb()
  const normalized = login.trim().toLowerCase()
  const hash = await hashPassword(password)

  const [existing] = await db.select().from(users).where(eq(users.login, normalized)).limit(1)

  if (existing) {
    await db.update(users).set({ passwordHash: hash }).where(eq(users.id, existing.id))
    console.log(`Пароль обновлён: ${existing.name} (${normalized})`)
    return
  }

  // Пользователь мог быть создан сидом без логина — привяжем по имени
  const [byName] = name
    ? await db.select().from(users).where(eq(users.name, name)).limit(1)
    : [undefined]

  if (byName) {
    await db
      .update(users)
      .set({ login: normalized, passwordHash: hash })
      .where(eq(users.id, byName.id))
    console.log(`Логин и пароль заданы: ${byName.name} (${normalized})`)
    return
  }

  await db.insert(users).values({
    name: name ?? normalized,
    login: normalized,
    passwordHash: hash,
    role: role === 'head' ? 'head' : 'manager',
  })
  console.log(`Создан пользователь: ${name ?? normalized} (${normalized})`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
