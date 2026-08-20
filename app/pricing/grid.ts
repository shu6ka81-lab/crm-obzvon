/**
 * Ширины колонок таблицы правил — в отдельном обычном модуле.
 * Из файла с 'use client' на сервере такая константа приходит пустой,
 * и шапка таблицы теряет разметку. Подробнее — в app/quote/[id]/grid.ts.
 */
export const GRID = 'grid grid-cols-[1fr_1fr_4rem_5rem_5rem_5rem_4rem_3rem_auto] items-center gap-2'
