import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  CLIENT_TYPE_LABEL,
  getCampaign,
  getCampaignClient,
  getFunnel,
  getLatestQualification,
  getNextInCampaign,
  getTouches,
  OUTCOME_LABEL,
  QUALIFIED_LABEL,
  SEGMENT_LABEL,
} from '@/lib/queries'
import { dateRu, dateTimeRu, daysAgoLabel, money, num } from '@/lib/format'
import { skipClient } from '@/app/actions'
import { CallForm } from './CallForm'

export const dynamic = 'force-dynamic'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs text-slate-500">{label}</span>
      <span className="text-right text-sm font-medium text-slate-900">{value}</span>
    </div>
  )
}

export default async function CallPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>
  searchParams: Promise<{ client?: string }>
}) {
  const { campaignId: raw } = await params
  const { client: pickedRaw } = await searchParams
  const campaignId = Number(raw)
  if (!Number.isInteger(campaignId)) notFound()

  const campaign = await getCampaign(campaignId)
  if (!campaign) notFound()

  // Либо выбранный вручную из списка, либо следующий по очереди.
  const picked = Number(pickedRaw)
  const [next, funnel] = await Promise.all([
    Number.isInteger(picked) && picked > 0
      ? getCampaignClient(campaignId, picked)
      : getNextInCampaign(campaignId),
    getFunnel(campaignId),
  ])

  if (!next) {
    const wasPicked = Number.isInteger(picked) && picked > 0
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
        <h1 className="text-lg font-semibold">{campaign.name}</h1>
        <p className="mt-2 text-sm text-slate-500">
          {wasPicked
            ? 'Этого клиента нет в списке кампании — возможно, ссылка устарела.'
            : 'Очередь пуста — все карточки этой кампании отработаны.'}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link
            href={`/call/${campaignId}`}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            К очереди
          </Link>
          <Link
            href={`/call/${campaignId}/list`}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Весь список
          </Link>
        </div>
      </div>
    )
  }

  const c = next.client
  const [touches, qual] = await Promise.all([
    getTouches(c.id),
    getLatestQualification(c.id),
  ])

  const left = funnel.inList - funnel.called

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-xs text-slate-500 hover:text-slate-900">
              ← {campaign.name}
            </Link>
            <Link
              href={`/call/${campaignId}/list`}
              className="text-xs font-medium text-slate-700 underline-offset-2 hover:underline"
            >
              весь список ({funnel.inList})
            </Link>
            <Link
              href={`/funnel/${campaignId}`}
              className="text-xs font-medium text-slate-700 underline-offset-2 hover:underline"
            >
              воронка
            </Link>
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{c.name}</h1>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <div className="text-xs text-slate-500">Осталось</div>
            <div className="text-lg font-semibold tabular-nums">{num(left)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Дозвонов</div>
            <div className="text-lg font-semibold tabular-nums">{num(funnel.reached)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Просчётов</div>
            <div className="text-lg font-semibold tabular-nums">{num(funnel.quoteRequests)}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        {/* ---------------- карточка клиента ---------------- */}
        <div className="space-y-4">
          <div
            className={`rounded-lg border p-4 ${
              c.phone ? 'border-slate-200 bg-white' : 'border-red-200 bg-red-50'
            }`}
          >
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Куда звонить</h2>
            {c.phone ? (
              <div className="divide-y divide-slate-100">
                <Row label="Телефон" value={<span className="text-base">{c.phone}</span>} />
                <Row label="Контактное лицо" value={c.contactPerson ?? '—'} />
                <Row label="Почта" value={c.email ?? '—'} />
                <Row label="Адрес" value={c.address ?? '—'} />
              </div>
            ) : (
              <p className="text-sm text-red-900">
                {c.source === 'competitor' ? (
                  <>
                    Телефона нет. В книге продаж контактов не бывает — их нужно найти
                    по ИНН <span className="font-semibold">{c.inn}</span> через СБИС,
                    Контур.Фокус или 2ГИС.
                  </>
                ) : (
                  <>
                    Телефона нет. В отчёте «Активность контрагентов» контактов не бывает —
                    нужна отдельная выгрузка справочника контрагентов из 1С с телефоном,
                    контактным лицом и почтой.
                  </>
                )}
              </p>
            )}
          </div>

          {c.source === 'competitor' ? (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
              <h2 className="mb-2 text-sm font-semibold text-indigo-950">
                Закупает у конкурента
              </h2>
              <div className="divide-y divide-indigo-100">
                <Row label="Поставщик" value={next.presetSupplier ?? '—'} />
                <Row label="Закупок за квартал" value={num(next.presetPurchases)} />
                <Row label="Сумма за квартал" value={money(next.presetBudget)} />
                <Row label="ИНН" value={c.inn ?? '—'} />
              </div>
              {next.presetNote ? (
                <p
                  className={`mt-3 rounded-md p-2 text-xs ${
                    next.presetNote.includes('⚠')
                      ? 'bg-red-100 text-red-900'
                      : 'bg-white/70 text-indigo-900'
                  }`}
                >
                  {next.presetNote}
                </p>
              ) : null}
              <p className="mt-3 text-xs text-indigo-900">
                Это не холодный звонок: компания уже закупает офисные товары и тратит на них
                деньги. Разговор о том, всё ли её устраивает у текущего поставщика.
              </p>
            </div>
          ) : null}

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">
              {c.source === 'competitor' ? 'История в нашей 1С' : 'Что известно из 1С'}
            </h2>
            <div className="divide-y divide-slate-100">
              <Row label="Код в 1С" value={c.code1c} />
              <Row label="Сегмент" value={SEGMENT_LABEL[c.segment] ?? c.segment} />
              <Row label="Статус" value={c.status1c ?? '—'} />
              <Row label="Купил всего" value={money(c.totalSum)} />
              <Row label="Отгрузок" value={num(c.shipmentsCount)} />
              <Row label="Средний чек" value={money(c.avgCheck)} />
              <Row
                label="Последняя покупка"
                value={
                  c.lastOrderDate ? (
                    <span>
                      {dateRu(c.lastOrderDate)}
                      <span className="ml-2 font-normal text-slate-400">
                        {daysAgoLabel(c.lastOrderDate)}
                      </span>
                    </span>
                  ) : (
                    '—'
                  )
                }
              />
              <Row label="Менеджер в 1С" value={c.manager1c ?? 'не назначен'} />
            </div>

            {c.comment1c ? (
              <div className="mt-3 rounded-md bg-amber-50 p-3">
                <div className="text-xs font-medium text-amber-900">
                  Комментарий менеджера · {dateRu(c.comment1cDate)}
                </div>
                <p className="mt-1 text-sm text-amber-900">{c.comment1c}</p>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-400">
                Комментариев в 1С нет — про клиента ничего не записано.
              </p>
            )}
          </div>

          {qual ? (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                Квалификация · {dateRu(qual.createdAt)}
              </h2>
              <div className="divide-y divide-slate-100">
                <Row label="Должность" value={qual.contactPosition ?? '—'} />
                <Row label="Человек в офисе" value={num(qual.peopleServed)} />
                <Row label="Бюджет в месяц" value={money(qual.monthlyBudget)} />
                <Row label="Где ещё закупает" value={qual.otherSuppliers ?? '—'} />
                <Row
                  label="Квалифицирован"
                  value={qual.isQualified ? (QUALIFIED_LABEL[qual.isQualified] ?? '—') : '—'}
                />
                <Row label="Тип клиента" value={CLIENT_TYPE_LABEL[qual.clientType] ?? '—'} />
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">
              История касаний {touches.length > 0 ? `(${touches.length})` : ''}
            </h2>
            {touches.length === 0 ? (
              <p className="text-xs text-slate-400">Мы этому клиенту ещё не звонили.</p>
            ) : (
              <ul className="space-y-3">
                {touches.map((t) => (
                  <li key={t.id} className="border-l-2 border-slate-200 pl-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-slate-900">
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

        {/* ---------------- форма ---------------- */}
        <div className="space-y-3">
          <CallForm
            campaignId={campaignId}
            clientId={c.id}
            linkId={next.linkId}
            presetBudget={next.presetBudget}
            currentStage={next.stage}
          />

          <Link
            href={`/quote/new?client=${c.id}&link=${next.linkId}`}
            className="inline-block rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
          >
            Аудит цен: собрать КП по списку клиента
          </Link>

          <form
            action={async () => {
              'use server'
              await skipClient(campaignId, next.linkId)
            }}
          >
            <button
              type="submit"
              className="text-xs text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
            >
              Пропустить и перейти к следующему
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
