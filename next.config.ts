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
}

export default nextConfig
