import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getQuote } from '../../actions'
import { getCompanyProfile } from '@/lib/company'
import { getClientById } from '@/lib/queries'
import { dateRu, money } from '@/lib/format'
import { PrintButton } from './PrintButton'
import { rublesInWords } from './words'

export const dynamic = 'force-dynamic'

/** Фирменный цвет предложения. Держим в одном месте — правится одной строкой. */
const INK = '#12395b'
const ACCENT = '#c8801f'

export default async function QuotePdfPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const quoteId = Number(id)
  if (!Number.isInteger(quoteId)) notFound()

  const data = await getQuote(quoteId)
  if (!data) notFound()

  const { quote, items } = data
  const [client, company] = await Promise.all([getClientById(quote.clientId), getCompanyProfile()])

  const total = items.reduce((s, i) => s + i.unitPrice * i.qty, 0)

  // Выгода считается только по строкам, где клиент назвал свою цену.
  // Сравнивать с пустотой нельзя: получится красивое, но выдуманное число.
  const withClient = items.filter((i) => i.clientPrice != null && i.clientPrice > 0)
  const clientSum = withClient.reduce((s, i) => s + (i.clientPrice ?? 0) * i.qty, 0)
  const ourSum = withClient.reduce((s, i) => s + i.unitPrice * i.qty, 0)
  const saved = clientSum - ourSum
  const savedPct = clientSum > 0 ? (saved / clientSum) * 100 : 0

  const benefits = company.benefits
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  return (
    <div className="mx-auto max-w-[210mm]">
      <div className="no-print mb-4 flex items-center justify-between gap-4">
        <Link href={`/quote/${quote.id}`} className="text-sm text-slate-500 hover:text-slate-900">
          ← Вернуться к расчёту
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            В окне печати выберите «Сохранить как PDF»
          </span>
          <PrintButton />
        </div>
      </div>

      <div className="print-sheet overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
        {/* ------------------------------------------------------- шапка */}
        <div
          className="flex items-start justify-between gap-8 px-10 py-7 text-white"
          style={{ backgroundColor: INK, printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
        >
          <div className="flex items-center gap-4">
            {/* Знак-заглушка: лист бумаги со скрепкой. Заменится логотипом. */}
            <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
              <rect x="8" y="6" width="34" height="44" rx="4" fill="#fff" />
              <rect x="15" y="17" width="20" height="2.6" rx="1.3" fill={INK} opacity="0.5" />
              <rect x="15" y="25" width="20" height="2.6" rx="1.3" fill={INK} opacity="0.35" />
              <rect x="15" y="33" width="12" height="2.6" rx="1.3" fill={INK} opacity="0.35" />
              <path
                d="M40 10v29a8.5 8.5 0 0 1-17 0V17"
                fill="none"
                stroke={ACCENT}
                strokeWidth="3.4"
                strokeLinecap="round"
              />
            </svg>
            <div>
              <div className="text-[26px] font-bold leading-tight tracking-tight">
                {company.name}
              </div>
              {company.slogan ? (
                <div className="text-sm text-white/70">{company.slogan}</div>
              ) : null}
            </div>
          </div>

          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/60">
              Коммерческое предложение
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums">№ {quote.id}</div>
            <div className="text-sm text-white/70">от {dateRu(quote.createdAt)}</div>
          </div>
        </div>

        <div className="px-10 py-7">
          {/* --------------------------------------------------- кому */}
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                Подготовлено для
              </div>
              <div className="mt-0.5 text-lg font-semibold text-slate-900">
                {client?.name ?? '—'}
              </div>
              {client?.inn ? (
                <div className="text-xs text-slate-500">ИНН {client.inn}</div>
              ) : null}
            </div>

            <div className="text-right text-xs text-slate-500">
              <div className="font-medium text-slate-700">{company.legalName}</div>
              {company.inn ? (
                <div>
                  ИНН {company.inn}
                  {company.kpp ? ` · КПП ${company.kpp}` : ''}
                </div>
              ) : null}
              {company.address ? <div>{company.address}</div> : null}
              {[company.phone, company.email, company.site].filter(Boolean).length > 0 ? (
                <div>{[company.phone, company.email, company.site].filter(Boolean).join(' · ')}</div>
              ) : null}
            </div>
          </div>

          {/* --------------------------------------------- выгода клиента */}
          {saved > 0 ? (
            <div
              className="mt-6 flex items-center justify-between gap-6 rounded-lg px-6 py-4"
              style={{
                backgroundColor: '#fdf6ec',
                border: `1px solid ${ACCENT}33`,
                printColorAdjust: 'exact',
                WebkitPrintColorAdjust: 'exact',
              }}
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Вы экономите {money(saved)} на этом заказе
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  По {withClient.length} позициям, где вы назвали текущие цены: сейчас{' '}
                  {money(clientSum)} — у нас {money(ourSum)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold tabular-nums" style={{ color: ACCENT }}>
                  −{savedPct.toFixed(0)}%
                </div>
              </div>
            </div>
          ) : null}

          {/* -------------------------------------------------- таблица */}
          <table className="mt-6 w-full border-collapse text-sm">
            <thead>
              <tr
                className="text-left text-[11px] uppercase tracking-wider text-white"
                style={{
                  backgroundColor: INK,
                  printColorAdjust: 'exact',
                  WebkitPrintColorAdjust: 'exact',
                }}
              >
                <th className="w-8 rounded-l px-3 py-2 font-medium">№</th>
                <th className="px-3 py-2 font-medium">Наименование</th>
                <th className="w-20 px-3 py-2 text-right font-medium">Кол-во</th>
                <th className="w-28 px-3 py-2 text-right font-medium">Цена, ₽</th>
                <th className="w-32 rounded-r px-3 py-2 text-right font-medium">Сумма, ₽</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i, k) => (
                <tr
                  key={i.id}
                  className="align-top"
                  style={{
                    backgroundColor: k % 2 ? '#f8fafc' : '#fff',
                    printColorAdjust: 'exact',
                    WebkitPrintColorAdjust: 'exact',
                  }}
                >
                  <td className="px-3 py-2 text-slate-400">{i.lineNo}</td>
                  <td className="px-3 py-2 text-slate-800">{i.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{i.qty}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{i.unitPrice.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {(i.unitPrice * i.qty).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${INK}` }}>
                <td colSpan={3} className="px-3 py-3 text-xs text-slate-500">
                  Позиций: {items.length}
                </td>
                <td className="px-3 py-3 text-right text-sm font-medium">Итого</td>
                <td
                  className="px-3 py-3 text-right text-lg font-bold tabular-nums"
                  style={{ color: INK }}
                >
                  {money(total)}
                </td>
              </tr>
            </tfoot>
          </table>

          <div className="mt-2 text-xs text-slate-500">
            Сумма прописью: {rublesInWords(total)}
          </div>

          {/* ------------------------------------------------ что получаете */}
          {benefits.length > 0 ? (
            <div className="mt-7 rounded-lg border border-slate-200 px-6 py-4">
              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                Что вы получаете
              </div>
              <ul className="mt-2 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
                {benefits.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-sm text-slate-700">
                    <svg width="14" height="14" viewBox="0 0 16 16" className="mt-1 shrink-0" aria-hidden>
                      <path
                        d="M3 8.5l3.2 3.2L13 5"
                        fill="none"
                        stroke={ACCENT}
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* -------------------------------------------------- условия */}
          <div className="mt-4 space-y-0.5 text-xs text-slate-500">
            {company.validDays ? (
              <div>Предложение действительно {company.validDays} дней с даты составления.</div>
            ) : null}
            {company.footer ? <div>{company.footer}</div> : null}
          </div>

          {/* --------------------------------------------------- подпись */}
          <div className="mt-10 flex items-end justify-between gap-8">
            <div className="text-sm">
              <div className="text-slate-500">{company.signerTitle}</div>
              <div className="mt-8 w-60 border-b border-slate-400" />
              <div className="mt-1 text-xs text-slate-500">{company.signerName}</div>
            </div>
            <div
              className="flex h-24 w-24 items-center justify-center rounded-full text-[10px] text-slate-300"
              style={{ border: '1px dashed #cbd5e1' }}
            >
              М. П.
            </div>
          </div>
        </div>

        {/* --------------------------------------------------- подвал */}
        <div
          className="px-10 py-3 text-center text-[11px] text-white/70"
          style={{ backgroundColor: INK, printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
        >
          {[company.legalName, company.phone, company.email, company.site]
            .filter(Boolean)
            .join('  ·  ')}
        </div>
      </div>

      <p className="no-print mt-4 text-xs text-slate-400">
        Название, строка под ним, список преимуществ и реквизиты берутся из{' '}
        <Link href="/settings" className="underline hover:text-slate-700">
          настроек компании
        </Link>
        . Знак слева — заглушка: пришлёте логотип, поставлю его.
      </p>
    </div>
  )
}
