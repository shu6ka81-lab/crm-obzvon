import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Записи разговоров лежат файлами рядом с системой, а не в базе.
 *
 * Минута разговора — около мегабайта. Складывать их в Postgres значит раздуть
 * базу и её резервные копии в разы ради данных, которые слушают раз в жизни.
 * В контейнере каталог примонтирован томом, поэтому переживает пересборку.
 */
export const RECORDINGS_DIR = process.env.RECORDINGS_DIR ?? path.join(process.cwd(), 'data', 'recordings')

/**
 * Имя файла приходит снаружи — пускать его в путь как есть нельзя.
 *
 * Кириллица разрешена явно. Через `\w` она не проходит: в JavaScript это
 * только латиница, и «проверка.wav» превращалась в «_.wav» — а значит два
 * разных разговора получали одно имя и затирали друг друга.
 */
export function safeName(name: string): string {
  const base = path
    .basename(name)
    .replace(/[^0-9A-Za-zА-Яа-яЁё._ -]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return base.slice(0, 120) || 'запись.wav'
}

/**
 * Кладёт запись под именем, которое заведомо ни с чем не столкнётся.
 * Полагаться на имя от робота нельзя: у него свои правила, и совпадение
 * означало бы тихую потерю чужого разговора.
 */
export async function saveRecording(name: string, data: Buffer, id?: number): Promise<string> {
  await mkdir(RECORDINGS_DIR, { recursive: true })

  const clean = safeName(name)
  const ext = path.extname(clean) || '.wav'
  const stem = path.basename(clean, ext).slice(0, 60) || 'запись'
  const unique = id && id > 0 ? String(id) : `${Date.now().toString(36)}`

  const file = `${unique}-${stem}${ext}`
  await writeFile(path.join(RECORDINGS_DIR, file), data)
  return file
}

export async function readRecording(name: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(RECORDINGS_DIR, safeName(name)))
  } catch {
    return null
  }
}

/**
 * Какие из этих записей действительно лежат на диске.
 *
 * В базе имя файла появляется в момент, когда робот отчитался о звонке, —
 * а сам файл приезжает следующим запросом и может не приехать вовсе.
 * Тогда в карточке висел проигрыватель, который ничего не играет: человек
 * жмёт на него и решает, что запись сломана. Лучше не показывать вовсе.
 */
export async function presentRecordings(names: (string | null)[]): Promise<Set<string>> {
  const wanted = [...new Set(names.filter((n): n is string => Boolean(n)))]
  const found = await Promise.all(
    wanted.map(async (n) => {
      try {
        await access(path.join(RECORDINGS_DIR, safeName(n)))
        return n
      } catch {
        return null
      }
    }),
  )
  return new Set(found.filter((n): n is string => n !== null))
}
