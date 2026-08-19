'use client'

import { useFormStatus } from 'react-dom'

/**
 * Кнопка загрузки, которая показывает, что работа идёт.
 *
 * Разбор выгрузки занимает полминуты и дольше: в файле девять тысяч строк,
 * и каждая сверяется с базой. Всё это время страница выглядела застывшей —
 * человек решал, что нажатие не сработало, и жал снова. В истории появлялось
 * три одинаковых загрузки подряд.
 *
 * Состоянием формы можно распорядиться только из отдельной части внутри неё —
 * отсюда и вынесенная кнопка.
 */
export function UploadButton() {
  const { pending } = useFormStatus()

  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-40"
      >
        {pending ? 'Загружаю…' : 'Загрузить'}
      </button>
      {pending ? (
        <span className="text-sm text-slate-500">
          Разбираю файл — это занимает до минуты. Не закрывайте страницу.
        </span>
      ) : null}
    </div>
  )
}
