/**
 * Создаёт первого пользователя, если в базе никого нет,
 * и печатает сгенерированный пароль. Повторный запуск ничего не меняет.
 *
 * Запускается автоматически при установке на сервер.
 */
import { randomBytes } from 'node:crypto'
import { getDb } from '../lib/db'
import { users } from '../lib/db/schema'
import { hashPassword } from '../lib/auth/password'

function generatePassword(): string {
  // Без похожих друг на друга символов — пароль придётся набирать руками
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(16)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

async function main() {
  const db = await getDb()
  const existing = await db.select({ id: users.id }).from(users).limit(1)

  if (existing.length > 0) {
    console.log('Пользователи уже есть — ничего не меняю.')
    return
  }

  const login = 'admin'
  const password = generatePassword()

  await db.insert(users).values({
    name: 'Администратор',
    login,
    passwordHash: await hashPassword(password),
    role: 'head',
  })

  console.log('')
  console.log('  ┌────────────────────────────────────────────┐')
  console.log('  │  СОХРАНИТЕ ЭТИ ДАННЫЕ — БОЛЬШЕ НЕ ПОКАЖУ  │')
  console.log('  └────────────────────────────────────────────┘')
  console.log('')
  console.log(`     Логин:  ${login}`)
  console.log(`     Пароль: ${password}`)
  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
