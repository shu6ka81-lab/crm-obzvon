import { sql } from 'drizzle-orm'
import {
  pgTable,
  pgEnum,
  serial,
  integer,
  bigint,
  doublePrecision,
  text,
  varchar,
  timestamp,
  date,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------- справочники

export const userRole = pgEnum('user_role', ['manager', 'head'])

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    /** Логин для входа. Латиницей, без пробелов. */
    login: varchar('login', { length: 64 }),
    passwordHash: text('password_hash'),
    role: userRole('role').notNull().default('manager'),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_login_uq').on(t.login)],
)

// ---------------------------------------------------------------- клиенты

/**
 * Сегмент активности из отчёта 1С «Активность контрагентов».
 * Значения приходят из выгрузки как есть.
 */
export const activitySegment = pgEnum('activity_segment', [
  'active', // Активный
  'd61', // 61 день
  'd91', // 91 день
  'd121', // 121 день
  'inactive', // Не активный
  'new', // Новый — покупок не было
  'unknown',
])

/** Откуда узнали о компании. */
export const clientSource = pgEnum('client_source', [
  'crm_1c', // выгрузка из 1С — действующий или бывший клиент
  'competitor', // книга продаж конкурента — потенциальный клиент
])

export const clients = pgTable(
  'clients',
  {
    id: serial('id').primaryKey(),

    /**
     * Код контрагента в 1С. Для компаний из книг продаж конкурентов его нет —
     * там опознание идёт по ИНН.
     */
    code1c: varchar('code_1c', { length: 64 }),

    source: clientSource('source').notNull().default('crm_1c'),

    name: text('name').notNull(),
    inn: varchar('inn', { length: 12 }),

    /**
     * Контакты. В отчёте «Активность контрагентов» их нет — нужна отдельная
     * выгрузка справочника контрагентов из 1С. Без них звонить не по чему.
     */
    phone: text('phone'),
    email: text('email'),
    contactPerson: text('contact_person'),
    address: text('address'),

    // --- поля из выгрузки 1С, обновляются при каждом импорте
    segment: activitySegment('segment').notNull().default('unknown'),
    status1c: text('status_1c'),
    manager1c: text('manager_1c'),
    totalSum: bigint('total_sum', { mode: 'number' }).notNull().default(0),
    shipmentsCount: integer('shipments_count').notNull().default(0),
    avgCheck: bigint('avg_check', { mode: 'number' }).notNull().default(0),
    lastOrderDate: date('last_order_date'),
    comment1c: text('comment_1c'),
    comment1cDate: date('comment_1c_date'),

    /** Из какого файла пришла последняя версия данных. */
    importedAt: timestamp('imported_at', { withTimezone: true }),
    importBatchId: integer('import_batch_id'),

    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Оба ключа частичные: у клиентов из 1С нет ИНН, у конкурентских — кода.
    uniqueIndex('clients_code_1c_uq').on(t.code1c).where(sql`${t.code1c} is not null`),
    uniqueIndex('clients_inn_uq').on(t.inn).where(sql`${t.inn} is not null`),
    index('clients_segment_idx').on(t.segment),
    index('clients_total_sum_idx').on(t.totalSum),
    index('clients_name_idx').on(t.name),
    index('clients_source_idx').on(t.source),
  ],
)

// ---------------------------------------------------------------- квалификация

export const clientType = pgEnum('client_type', ['legal', 'individual', 'intercity', 'unknown'])
export const qualified = pgEnum('qualified', ['yes', 'no', 'thinking'])

/**
 * Append-only: каждое изменение — новая строка.
 * Актуальная квалификация = запись с максимальным createdAt.
 * Так видно, что про клиента знали год назад.
 */
export const qualifications = pgTable(
  'qualifications',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),

    contactPosition: text('contact_position'),
    peopleServed: integer('people_served'),
    monthlyBudget: bigint('monthly_budget', { mode: 'number' }),
    otherSuppliers: text('other_suppliers'),
    clientType: clientType('client_type').notNull().default('unknown'),

    isQualified: qualified('is_qualified'),
    rejectReason: text('reject_reason'),

    filledBy: integer('filled_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('qualifications_client_idx').on(t.clientId, t.createdAt)],
)

// ---------------------------------------------------------------- кампании

/**
 * Состояние в очереди обзвона — про механику: кого показывать следующим.
 * Не путать со стадией воронки: «не взяли трубку» двигает по очереди,
 * но клиент как был лидом, так и остался.
 */
export const campaignClientState = pgEnum('campaign_client_state', [
  'pending', // не начат
  'in_progress', // в работе
  'done', // отработан
  'postponed', // отложен
])

/**
 * Стадия воронки — про продажу. Порядок важен: он же задаёт вид отчёта.
 */
export const funnelStage = pgEnum('funnel_stage', [
  'lead', // в списке, разговора ещё не было
  'contacted', // знакомство состоялось, вышли на контактное лицо
  'audit', // аудит цен: ждём или получили перечень позиций от клиента
  'quote', // КП собрано и отправлено
  'decision', // решение за клиентом
  'won', // начали работать
  'lost', // отказ
])

export const FUNNEL_ORDER = [
  'lead',
  'contacted',
  'audit',
  'quote',
  'decision',
  'won',
] as const

export const campaigns = pgTable('campaigns', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  sourceFile: text('source_file'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const campaignClients = pgTable(
  'campaign_clients',
  {
    id: serial('id').primaryKey(),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),

    position: integer('position').notNull().default(0),
    state: campaignClientState('state').notNull().default('pending'),

    stage: funnelStage('stage').notNull().default('lead'),
    stageChangedAt: timestamp('stage_changed_at', { withTimezone: true }),
    lostReason: text('lost_reason'),

    /**
     * Для списков из книг продаж конкурентов часть фактов известна до звонка:
     * сколько компания закупает, как часто и у кого. Менеджер это подтверждает,
     * а не выясняет с нуля.
     */
    presetBudget: bigint('preset_budget', { mode: 'number' }),
    presetSupplier: text('preset_supplier'),
    presetPurchases: integer('preset_purchases'),
    presetNote: text('preset_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('campaign_clients_uq').on(t.campaignId, t.clientId),
    index('campaign_clients_queue_idx').on(t.campaignId, t.state, t.position),
  ],
)

/**
 * История движения по воронке. Нужна, чтобы считать конверсию между
 * стадиями и видеть, где сделки застревают, — по текущей стадии этого не видно.
 */
export const stageChanges = pgTable(
  'stage_changes',
  {
    id: serial('id').primaryKey(),
    campaignClientId: integer('campaign_client_id')
      .notNull()
      .references(() => campaignClients.id),
    fromStage: funnelStage('from_stage'),
    toStage: funnelStage('to_stage').notNull(),
    userId: integer('user_id').references(() => users.id),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('stage_changes_link_idx').on(t.campaignClientId, t.createdAt)],
)

// ---------------------------------------------------------------- касания

export const touchChannel = pgEnum('touch_channel', ['call', 'email', 'meeting', 'messenger'])

export const touchOutcome = pgEnum('touch_outcome', [
  'reached', // дозвонился
  'no_answer', // не взяли
  'busy', // занято
  'wrong_number', // номер не тот
  'callback', // просили перезвонить
  'refused', // отказ
])

export const touches = pgTable(
  'touches',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    campaignId: integer('campaign_id').references(() => campaigns.id),
    userId: integer('user_id').references(() => users.id),

    happenedAt: timestamp('happened_at', { withTimezone: true }).notNull().defaultNow(),
    channel: touchChannel('channel').notNull().default('call'),
    outcome: touchOutcome('outcome').notNull(),
    durationSec: integer('duration_sec'),

    /** Договорились о просчёте — главная целевая метрика обзвона. */
    gotQuoteRequest: boolean('got_quote_request').notNull().default(false),

    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('touches_client_idx').on(t.clientId, t.happenedAt),
    index('touches_campaign_idx').on(t.campaignId, t.happenedAt),
  ],
)

// ---------------------------------------------------------------- задачи

export const taskStatus = pgEnum('task_status', ['open', 'done', 'cancelled'])

export const tasks = pgTable(
  'tasks',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    assignedTo: integer('assigned_to').references(() => users.id),
    createdFromTouchId: integer('created_from_touch_id'),

    dueDate: date('due_date').notNull(),
    title: text('title').notNull(),
    status: taskStatus('status').notNull().default('open'),

    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tasks_due_idx').on(t.status, t.dueDate), index('tasks_client_idx').on(t.clientId)],
)

// ---------------------------------------------------------------- каталог

/**
 * Прайс-лист, собранный из отчётов «Продажи товаров по номенклатуре».
 * Цена берётся не из справочника, а из фактических продаж: это то,
 * по чему реально отгружали, вместе с закупкой и наценкой.
 */
export const catalogItems = pgTable(
  'catalog_items',
  {
    id: serial('id').primaryKey(),
    code: varchar('code', { length: 64 }).notNull(),
    article: varchar('article', { length: 64 }),
    name: text('name').notNull(),
    category: text('category'),

    /** Накопленные факты продаж за все загруженные периоды. */
    qtySold: doublePrecision('qty_sold').notNull().default(0),
    saleSum: bigint('sale_sum', { mode: 'number' }).notNull().default(0),
    buySum: bigint('buy_sum', { mode: 'number' }).notNull().default(0),
    monthsSeen: integer('months_seen').notNull().default(0),

    /** Средняя цена отгрузки за единицу. */
    unitPrice: doublePrecision('unit_price').notNull().default(0),
    unitCost: doublePrecision('unit_cost').notNull().default(0),
    markupPct: doublePrecision('markup_pct').notNull().default(0),

    /** Нормализованное наименование — по нему идёт подбор позиций. */
    searchText: text('search_text').notNull().default(''),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('catalog_items_code_uq').on(t.code),
    index('catalog_items_name_idx').on(t.name),
    index('catalog_items_sale_idx').on(t.saleSum),
  ],
)

// ---------------------------------------------------------------- КП

export const quoteStatus = pgEnum('quote_status', ['draft', 'sent', 'won', 'lost'])

/**
 * Коммерческое предложение по списку позиций от клиента.
 * Ключевой артефакт стадии «Аудит цен»: клиент присылает, что закупает,
 * мы отвечаем ценами по своему прайсу.
 */
export const quotes = pgTable(
  'quotes',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    campaignClientId: integer('campaign_client_id').references(() => campaignClients.id),

    status: quoteStatus('status').notNull().default('draft'),
    /** Исходный текст от клиента — чтобы можно было пересобрать подбор. */
    rawInput: text('raw_input'),
    note: text('note'),

    totalSale: bigint('total_sale', { mode: 'number' }).notNull().default(0),
    totalCost: bigint('total_cost', { mode: 'number' }).notNull().default(0),

    createdBy: integer('created_by').references(() => users.id),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('quotes_client_idx').on(t.clientId, t.createdAt)],
)

export const quoteItems = pgTable(
  'quote_items',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => quotes.id),

    lineNo: integer('line_no').notNull(),
    /** Как позиция была записана клиентом — пригодится при разборе спорных. */
    rawLine: text('raw_line').notNull(),
    qty: doublePrecision('qty').notNull().default(1),

    catalogItemId: integer('catalog_item_id').references(() => catalogItems.id),
    name: text('name').notNull(),
    unitPrice: doublePrecision('unit_price').notNull().default(0),
    unitCost: doublePrecision('unit_cost').notNull().default(0),

    /** Насколько уверенно подобралось: ниже порога менеджер проверяет руками. */
    confidence: integer('confidence').notNull().default(0),
    isManual: boolean('is_manual').notNull().default(false),
  },
  (t) => [index('quote_items_quote_idx').on(t.quoteId, t.lineNo)],
)

// ---------------------------------------------------------------- импорт

export const importBatches = pgTable('import_batches', {
  id: serial('id').primaryKey(),
  fileName: text('file_name').notNull(),
  reportDate: date('report_date'),
  rowsTotal: integer('rows_total').notNull().default(0),
  rowsCreated: integer('rows_created').notNull().default(0),
  rowsUpdated: integer('rows_updated').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
