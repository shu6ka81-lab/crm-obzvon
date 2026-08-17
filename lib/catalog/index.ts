import { getDb } from '../db'
import { catalogItems } from '../db/schema'
import { CatalogIndex, type MatchCandidate } from './match'

/**
 * Индекс каталога живёт в памяти процесса: строить его на каждый запрос
 * дорого (около полусекунды на 22 тысячи позиций), а меняется он только
 * при загрузке нового отчёта.
 */
const globalForIndex = globalThis as unknown as {
  __catalogIndex?: { built: number; index: CatalogIndex }
}

/** Пересобрать при следующем обращении — вызывается после импорта. */
export function invalidateCatalogIndex() {
  globalForIndex.__catalogIndex = undefined
}

export async function getCatalogIndex(): Promise<CatalogIndex> {
  if (globalForIndex.__catalogIndex) return globalForIndex.__catalogIndex.index

  const db = await getDb()
  const items: MatchCandidate[] = await db
    .select({
      id: catalogItems.id,
      code: catalogItems.code,
      article: catalogItems.article,
      name: catalogItems.name,
      category: catalogItems.category,
      unitPrice: catalogItems.unitPrice,
      unitCost: catalogItems.unitCost,
      markupPct: catalogItems.markupPct,
      qtySold: catalogItems.qtySold,
      searchText: catalogItems.searchText,
    })
    .from(catalogItems)

  const index = new CatalogIndex(items)
  globalForIndex.__catalogIndex = { built: Date.now(), index }
  return index
}
