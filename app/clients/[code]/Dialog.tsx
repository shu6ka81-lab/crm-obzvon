'use client'

/**
 * Разговор репликами, а не сплошным текстом.
 *
 * Расшифровка приходит строками вида «Робот: …» / «Клиент: …». Сплошным
 * блоком её читать невозможно: непонятно, кто что сказал, а именно это и
 * нужно понять за десять секунд — что ответил клиент, а не что сказал робот.
 */
export interface Line {
  who: 'bot' | 'client' | 'other'
  text: string
}

export function parseDialog(raw: string): Line[] {
  const out: Line[] = []
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue

    const m = s.match(/^([^:]{1,24}):\s*(.*)$/)
    if (!m) {
      // Строка без подписи — продолжение предыдущей реплики
      if (out.length) out[out.length - 1].text += ' ' + s
      else out.push({ who: 'other', text: s })
      continue
    }

    const label = m[1].toLowerCase()
    const who: Line['who'] = /робот|бот|менеджер|ассистент|assistant/.test(label)
      ? 'bot'
      : /клиент|собеседник|user|customer/.test(label)
        ? 'client'
        : 'other'
    out.push({ who, text: m[2] || '' })
  }
  return out
}

export function Dialog({ text, max }: { text: string; max?: number }) {
  const lines = parseDialog(text)
  const shown = max ? lines.slice(-max) : lines
  if (shown.length === 0) return null

  return (
    <div className="space-y-1.5">
      {shown.map((l, i) => (
        <div
          key={i}
          className={`flex gap-2 ${l.who === 'client' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm leading-snug ${
              l.who === 'client'
                ? 'bg-emerald-50 text-emerald-950'
                : l.who === 'bot'
                  ? 'bg-slate-100 text-slate-800'
                  : 'bg-amber-50 text-amber-900'
            }`}
          >
            <span className="mr-1.5 text-xs text-slate-400">
              {l.who === 'client' ? 'клиент' : l.who === 'bot' ? 'робот' : '·'}
            </span>
            {l.text}
          </div>
        </div>
      ))}
    </div>
  )
}
