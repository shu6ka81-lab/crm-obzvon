import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  CLIENT_TYPE_LABEL,
  getClientByKey,
  getClientCampaignLink,
  getLatestQualification,
  getOpenTasks,
  getTouches,
  OUTCOME_LABEL,
  QUALIFIED_LABEL,
  SEGMENT_LABEL,
} from '@/lib/queries'
import { dateRu, dateTimeRu, daysAgoLabel, money, num } from '@/lib/format'
import { CallForm } from '@/app/call/[campaignId]/CallForm'
import type { Stage } from '@/lib/funnel'

export const dynamic = 'force-dynamic'

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

  const [touches, qual, tasks, link] = await Promise.all([
    getTouches(client.id),
    getLatestQualification(client.id),
    getOpenTasks(client.id),
    getClientCampaignLink(client.id),
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

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold">
          История касаний {touches.length > 0 ? `(${touches.length})` : ''}
        </h2>
        {touches.length === 0 ? (
          <p className="text-xs text-slate-400">Мы этому клиенту ещё не звонили.</p>
        ) : (
          <ul className="space-y-3">
            {touches.map((t) => (
              <li key={t.id} className="border-l-2 border-slate-200 pl-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    {OUTCOME_LABEL[t.outcome] ?? t.outcome}
                  </span>
                  <span className="text-xs text-slate-400">{dateTimeRu(t.happenedAt)}</span>
                </div>
                {t.note ? <p className="mt-0.5 text-sm text-slate-600">{t.note}</p> : null}
                <div className="mt-0.5 text-xs text-slate-400">
                  {t.userName ?? 'без автора'}
                  {t.gotQuoteRequest ? ' · договорились о просчёте' : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
