'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveTouch, type TouchState } from '@/app/actions'
import { ALL_STAGES, stageHint, stageLabel, type CampaignKind, type Stage } from '@/lib/funnel'

const FIELD =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200'
const LABEL = 'block text-xs font-medium text-slate-600 mb-1'

function OutcomeButton({
  value,
  children,
  pending,
  tone = 'neutral',
}: {
  value: string
  children: React.ReactNode
  pending: boolean
  tone?: 'primary' | 'neutral' | 'danger'
}) {
  const tones = {
    primary: 'bg-slate-900 text-white hover:bg-slate-700',
    neutral: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
    danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50',
  }
  return (
    <button
      type="submit"
      name="outcome"
      value={value}
      disabled={pending}
      className={`rounded-md px-4 py-2 text-sm font-medium transition disabled:opacity-40 ${tones[tone]}`}
    >
      {children}
    </button>
  )
}

export function CallForm({
  campaignId,
  clientId,
  linkId,
  presetBudget,
  currentStage,
  kind = 'acquisition',
  refreshAfterSave = false,
}: {
  /** Может отсутствовать: с карточки клиента звонят и вне очередей. */
  campaignId?: number | null
  clientId: number
  linkId?: number | null
  presetBudget: number | null
  currentStage: Stage
  /** Возврат ушедшего клиента называет ступени своими словами. */
  kind?: CampaignKind
  /**
   * На экране обзвона после сохранения открывается следующий в очереди, и
   * обновлять страницу незачем. На карточке клиента человек остаётся на месте
   * и ждёт увидеть свою запись в истории — без обновления она не появится.
   */
  refreshAfterSave?: boolean
}) {
  const [showQual, setShowQual] = useState(true)
  const [gotQuote, setGotQuote] = useState(false)
  const [stage, setStage] = useState<Stage>(currentStage)
  const [stageTouched, setStageTouched] = useState(false)
  const [state, formAction, pending] = useActionState<TouchState, FormData>(saveTouch, null)
  const router = useRouter()

  useEffect(() => {
    if (refreshAfterSave && state?.ok) router.refresh()
  }, [refreshAfterSave, state?.ok, state?.savedAt, router])

  // Если стадию не трогали руками, её выберет сервер по итогу звонка:
  // на клиенте это делать нельзя — состояние не успеет попасть в форму.

  return (
    <form action={formAction} className="space-y-5">
      {campaignId ? <input type="hidden" name="campaignId" value={campaignId} /> : null}
      <input type="hidden" name="clientId" value={clientId} />
      {linkId ? <input type="hidden" name="linkId" value={linkId} /> : null}
      <input type="hidden" name="currentStage" value={currentStage} />
      <input type="hidden" name="stageTouched" value={stageTouched ? '1' : ''} />

      {/* --- квалификация --- */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setShowQual((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold text-slate-900">Чек-лист квалификации</span>
          <span className="text-xs text-slate-400">{showQual ? 'свернуть' : 'развернуть'}</span>
        </button>

        {showQual ? (
          <div className="grid gap-4 border-t border-slate-100 p-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="contactPosition">
                Должность контакта
              </label>
              <input
                id="contactPosition"
                name="contactPosition"
                className={FIELD}
                placeholder="офис-менеджер, снабженец, директор…"
              />
            </div>

            <div>
              <label className={LABEL} htmlFor="peopleServed">
                Сколько человек в офисе обслуживает
              </label>
              <input
                id="peopleServed"
                name="peopleServed"
                inputMode="numeric"
                className={FIELD}
                placeholder="например 50"
              />
            </div>

            <div>
              <label className={LABEL} htmlFor="monthlyBudget">
                Бюджет закупок в месяц, ₽
              </label>
              <input
                id="monthlyBudget"
                name="monthlyBudget"
                inputMode="numeric"
                defaultValue={presetBudget ?? ''}
                className={FIELD}
                placeholder="например 40 000"
              />
              {presetBudget ? (
                <p className="mt-1 text-xs text-amber-700">
                  Подставлено из списка КУДиР — уточните у клиента
                </p>
              ) : null}
            </div>

            <div>
              <label className={LABEL} htmlFor="otherSuppliers">
                Где ещё закупает
              </label>
              <input
                id="otherSuppliers"
                name="otherSuppliers"
                className={FIELD}
                placeholder="Комус, местный поставщик…"
              />
            </div>

            <div>
              <label className={LABEL} htmlFor="clientType">
                Тип клиента
              </label>
              <select id="clientType" name="clientType" className={FIELD} defaultValue="unknown">
                <option value="unknown">не определён</option>
                <option value="legal">юрлицо</option>
                <option value="individual">физлицо</option>
                <option value="intercity">межгород</option>
              </select>
            </div>

            <div>
              <label className={LABEL} htmlFor="isQualified">
                Квалифицирован
              </label>
              <select id="isQualified" name="isQualified" className={FIELD} defaultValue="">
                <option value="">не указано</option>
                <option value="yes">да, наш клиент</option>
                <option value="thinking">думает</option>
                <option value="no">нет, не интересен</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className={LABEL} htmlFor="rejectReason">
                Причина отказа или почему не интересен
              </label>
              <input
                id="rejectReason"
                name="rejectReason"
                className={FIELD}
                placeholder="в офисе два человека / есть контракт до конца года…"
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* --- итог звонка --- */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className={LABEL} htmlFor="note">
          Что сказали
        </label>
        <textarea
          id="note"
          name="note"
          rows={3}
          className={FIELD}
          placeholder="Коротко: о чём договорились, что важно помнить к следующему звонку"
        />

        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="gotQuoteRequest"
            value="true"
            checked={gotQuote}
            onChange={(e) => {
              setGotQuote(e.target.checked)
              if (!stageTouched && e.target.checked) setStage('audit')
            }}
            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
          />
          Договорились о просчёте — получаем перечень позиций
        </label>

        <div className="mt-4">
          <label className={LABEL} htmlFor="stage">
            Стадия после звонка
          </label>
          <select
            id="stage"
            name="stage"
            value={stage}
            onChange={(e) => {
              setStage(e.target.value as Stage)
              setStageTouched(true)
            }}
            className={FIELD}
          >
            {ALL_STAGES.map((s) => (
              <option key={s} value={s}>
                {stageLabel(s, kind)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">{stageHint(stage, kind)}</p>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="nextStepDate">
              Следующий шаг — когда
            </label>
            <input id="nextStepDate" name="nextStepDate" type="date" className={FIELD} />
          </div>
          <div>
            <label className={LABEL} htmlFor="nextStepTitle">
              Следующий шаг — что сделать
            </label>
            <input
              id="nextStepTitle"
              name="nextStepTitle"
              className={FIELD}
              placeholder="Перезвонить, отправить КП…"
            />
          </div>
        </div>
      </div>

      {/* --- кнопки --- */}
      <div className="flex flex-wrap items-center gap-2">
        <OutcomeButton value="reached" tone="primary" pending={pending}>
          {refreshAfterSave ? 'Дозвонился — сохранить' : 'Дозвонился — сохранить и следующий'}
        </OutcomeButton>
        <OutcomeButton value="no_answer" pending={pending}>
          Не взяли
        </OutcomeButton>
        <OutcomeButton value="busy" pending={pending}>
          Занято
        </OutcomeButton>
        <OutcomeButton value="callback" pending={pending}>
          Просили перезвонить
        </OutcomeButton>
        <OutcomeButton value="wrong_number" pending={pending}>
          Номер не тот
        </OutcomeButton>
        <OutcomeButton value="refused" tone="danger" pending={pending}>
          Отказ
        </OutcomeButton>
      </div>

      {state && !state.ok && state.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Не сохранилось: {state.error}
        </p>
      ) : null}

      {/* Подсказка про очередь уместна только там, где очередь есть. */}
      <p className="text-xs text-slate-400">
        {linkId
          ? '«Не взяли» и «Занято» отправляют клиента в конец очереди — вернёмся к нему позже. «Дозвонился», «Отказ» и «Номер не тот» закрывают карточку в этой кампании.'
          : 'Разговор запишется в историю клиента. В очередях обзвона он не состоит, поэтому никуда не переместится.'}
      </p>
    </form>
  )
}
