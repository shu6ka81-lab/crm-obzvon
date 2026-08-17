import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /** Самодостаточная сборка для контейнера — без node_modules целиком. */
  output: 'standalone',

  /**
   * PGlite тащит с собой Emscripten-сборку Postgres и работает с файловой
   * системой напрямую. Бандлер её ломает — пакет должен грузиться как есть.
   * ExcelJS по той же причине: внутри потоковая работа с zip.
   */
  serverExternalPackages: ['@electric-sql/pglite', 'exceljs'],

  experimental: {
    serverActions: {
      /**
       * Выгрузки из 1С крупные: отчёт по контрагентам — 1,3 МБ,
       * справочник и продажи за два года будут в разы больше.
       * Значение по умолчанию (1 МБ) режет загрузку молча, без ошибки.
       */
      bodySizeLimit: '64mb',
    },
  },
}

export default nextConfig
