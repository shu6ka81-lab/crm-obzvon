import type { Config } from 'drizzle-kit'

export default {
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  // Для генерации SQL подключение не нужно; migrate по DATABASE_URL в проде.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/crm',
  },
  verbose: true,
  strict: true,
} satisfies Config
