import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  CLIENT_TYPE_LABEL,
  getClientByKey,
  getClientCampaignLink,
  getClientQuotes,
  getLatestQualification,
  getOpenTasks,
  getTouches,
  OUTCOME_LABEL,
  QUALIFIED_LABEL,
  SEGMENT_LABEL,
} from '@/lib/queries'
import { dateRu, dateTimeRu, daysAgoLabel, money, num } from '@/lib/format'
import { CallForm } from '@/app/call/[campaignId]/CallForm'
import { Contacts } from './Contacts'
import { Dialog } from './Dialog'
import { LiveCall } from './LiveCall'
import { getBotStatus } from '@/lib/botStatus'
import { getLiveCall } from '@/app/actions'
import type { CampaignKind, Stage } from '@/lib/funnel'

export const dynamic = 'force-dynamic'

/** Как робот оценил разговор — его словарь, переведённый на человеческий. */
const BOT_CATEGORY: Record<string, string> = {
  hot: 'согласился на встречу',
  warm: 'интерес есть',
  callback: 'просил перезвонить',
  not_dm: 'не тот человек',
  not_target: 'не наш клиент',
  refused: 'отказ',
  no_answer: 'не взяли',
  invalid: 'номер не тот',
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs text-slate-500">{label}</span>
      <span className="text-right text-sm font-medium text-slate-900">{value}</span>
    </div>
  )
}

export default async function ClientCard({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const client = await getClientByKey(decodeURIComponent(code))
  if (!client) notFound()

  const [touches, qual, tasks, link, clientQuotes] = await Promise.all([
    getTouches(client.id),
    getLatestQualification(client.id),
    getOpenTasks(client.id),
    getClientCampaignLink(client.id),
    getClientQuotes(client.id),
  ])
  const [bot, live] = await Promise.all([
    getBotStatus(client.id),
    getLiveCall(client.id),
  ])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/clients" className="text-xs text-slate-500 hover:text-slate-900">
            ← Клиенты
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{client.name}</h1>
          <p className="text-sm text-slate-500">
            {client.code1c ? `Код в 1С · ${client.code1c}` : `ИНН · ${client.inn ?? '—'}`}
            {link ? (
              <>
                {' · '}
                <Link href={`/call/${link.campaignId}/list`} className="hover:text-slate-900">
                  {link.campaignName}
                </Link>
              </>
            ) : null}
          </p>
        </div>

        {link ? (
          <Link
            href={`/call/${link.campaignId}?client=${client.id}`}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Открыть в обзвоне
          </Link>
        ) : null}
      </div>

      <Contacts
        clientId={client.id}
        phone={client.phone}
        contactPerson={client.contactPerson}
        email={client.email}
        bot={bot}
      />

      <LiveCall clientId={client.id} initial={live} />

      {/*
        Рабочая часть карточки. Раньше сюда можно было только смотреть: список
        показывал «ещё не квалифицирован», а заполнить это можно было лишь из
        очереди обзвона. Человек открывал компанию, которую хотел, и упирался
        в тупик.
      */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Записать разговор</h2>
          <span className="text-xs text-slate-400">
            {link
              ? 'Сохранится в историю и подвинет клиента по воронке'
              : 'Клиент не стоит ни в одной очереди — запишем разговор без движения по воронке'}
          </span>
        </div>
        <CallForm
          campaignId={link?.campaignId ?? null}
          clientId={client.id}
          linkId={link?.linkId ?? null}
          presetBudget={link?.presetBudget ?? null}
          currentStage={(link?.stage ?? 'lead') as Stage}
          kind={(link?.campaignKind ?? 'acquisition') as CampaignKind}
          refreshAfterSave
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">Данные из 1С</h2>
          <div className="divide-y divide-slate-100">
            <Row label="Сегмент" value={SEGMENT_LABEL[client.segment] ?? client.segment} />
            <Row label="Статус" value={client.status1c ?? '—'} />
            <Row label="Купил всего" value={money(client.totalSum)} />
            <Row label="Отгрузок" value={num(client.shipmentsCount)} />
            <Row label="Средний чек" value={money(client.avgCheck)} />
            <Row
              label="Последняя покупка"
              value={
                client.lastOrderDate
                  ? `${dateRu(client.lastOrderDate)} · ${daysAgoLabel(client.lastOrderDate)}`
                  : '—'
              }
            />
            <Row label="Менеджер" value={client.manager1c ?? 'не назначен'} />
            <Row label="Обновлено из 1С" value={dateTimeRu(client.importedAt)} />
          </div>
          {client.comment1c ? (
            <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              <div className="text-xs font-medium">
                Комментарий менеджера · {dateRu(client.comment1cDate)}
              </div>
              <p className="mt-1">{client.comment1c}</p>
            </div>
          ) : null}
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold">Квалификация</h2>
            {qual ? (
              <div className="divide-y divide-slate-100">
                <Row label="Должность" value={qual.contactPosition ?? '—'} />
                <Row label="Человек в офисе" value={num(qual.peopleServed)} />
                <Row label="Бюджет в месяц" value={money(qual.monthlyBudget)} />
                <Row label="Где ещё закупает" value={qual.otherSuppliers ?? '—'} />
                <Row label="Тип клиента" value={CLIENT_TYPE_LABEL[qual.clientType] ?? '—'} />
                <Row
                  label="Квалифицирован"
                  value={qual.isQualified ? (QUALIFIED_LABEL[qual.isQualified] ?? '—') : '—'}
                />
                <Row label="Причина отказа" value={qual.rejectReason ?? '—'} />
                <Row label="Заполнено" value={dateTimeRu(qual.createdAt)} />
              </div>
            ) : (
              <p className="text-xs text-slate-400">Ещё не квалифицирован.</p>
            )}
          </div>

          {tasks.length > 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold">Открытые задачи</h2>
              <ul className="space-y-1.5">
                {tasks.map((t) => (
                  <li key={t.id} className="flex justify-between gap-3 text-sm">
                    <span className="text-slate-900">{t.title}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">
                      {dateRu(t.dueDate)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {clientQuotes.length > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">
            Коммерческие предложения ({clientQuotes.length})
          </h2>
          <ul className="divide-y divide-slate-100">
            {clientQuotes.map((q) => (
              <li key={q.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                <div className="min-w-0">
                  <Link
                    href={`/quote/${q.id}`}
                    className="text-sm font-medium text-slate-900 hover:underline"
                  >
                    КП №{q.id}
                  </Link>
                  <span className="ml-2 text-xs text-slate-400">
                    {num(q.lines)} позиций · {dateTimeRu(q.createdAt)}
                  </span>
                  {q.note?.startsWith('Собрано автоматически') ? (
                    <div className="text-xs text-indigo-700">
                      собрано роботом из разговора — проверьте перед отправкой
                    </div>
                  ) : null}
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {money(q.totalSale)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold">
          История касаний {touches.length > 0 ? `(${touches.length})` : ''}
        </h2>
        {touches.length === 0 ? (
          <p className="text-xs text-slate-400">Мы этому клиенту ещё не звонили.</p>
        ) : (
          <ul className="space-y-3">
            {touches.map((t) => (
              <li
                key={t.id}
                className={`border-l-2 pl-3 ${
                  t.channel === 'bot' ? 'border-indigo-300' : 'border-slate-200'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    {OUTCOME_LABEL[t.outcome] ?? t.outcome}
                    {t.channel === 'bot' ? (
                      <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-normal text-indigo-800">
                        робот{t.botCategory ? ` · ${BOT_CATEGORY[t.botCategory] ?? t.botCategory}` : ''}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-slate-400">{dateTimeRu(t.happenedAt)}</span>
                </div>
                {t.note ? <p className="mt-0.5 text-sm text-slate-600">{t.note}</p> : null}

                {/*
                  Расшифровка — то, ради чего всё затевалось. Собственник про
                  своих клиентов говорил «я фантазирую»: записывать было негде.
                  Свёрнута, потому что разговор длинный, а в ленте нужен обзор.
                */}
                {t.recording ? (
                  <audio
                    controls
                    preload="none"
                    src={`/api/recording/${encodeURIComponent(t.recording)}`}
                    className="mt-1.5 h-8 w-full max-w-md"
                  />
                ) : null}

                {t.transcript ? (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-900">
                      Расшифровка разговора
                    </summary>
                    <div className="mt-1.5 max-h-96 overflow-y-auto rounded-md bg-slate-50 p-3">
                      <Dialog text={t.transcript} />
                    </div>
                  </details>
                ) : null}

                <div className="mt-0.5 text-xs text-slate-400">
                  {t.channel === 'bot' ? 'голосовой робот' : (t.userName ?? 'без автора')}
                  {t.gotQuoteRequest ? ' · договорились о просчёте' : ''}
                  {t.durationSec ? ` · ${Math.round(t.durationSec / 6) / 10} мин` : ''}
                  {t.costRub ? ` · ${t.costRub.toFixed(0)} ₽` : ''}

                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
