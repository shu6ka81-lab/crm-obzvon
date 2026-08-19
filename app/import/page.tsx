import { desc } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { importBatches } from '@/lib/db/schema'
import { importActivityReport } from '@/lib/import/importClients'
import { syncCampaigns } from '@/lib/import/buildCampaigns'
import { dateRu, dateTimeRu, num } from '@/lib/format'
import { UploadButton } from './UploadButton'
import { UploadForm } from './UploadForm'
import { uploadCatalog, uploadCompetitors } from './actions'

export const dynamic = 'force-dynamic'

async function upload(formData: FormData) {
  'use server'
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return
  const buf = Buffer.from(await file.arrayBuffer())
  await importActivityReport(buf, file.name)
  // Списки на обзвон собираются сразу — чтобы после загрузки
  // не требовалось запускать скрипты на сервере.
  await syncCampaigns(file.name)
  revalidatePath('/')
  revalidatePath('/import')
}

export default async function ImportPage() {
  const db = await getDb()
  const batches = await db
    .select()
    .from(importBatches)
    .orderBy(desc(importBatches.createdAt))
    .limit(20)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Импорт из 1С</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Загружается отчёт «Активность контрагентов» — тот же файл, который уже умеет
          выгружать 1С. Ничего дополнительно настраивать не нужно. Повторная загрузка
          обновит данные и не затрёт квалификацию, касания и задачи.
        </p>
      </div>

      <form
        action={upload}
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="file">
          Файл выгрузки (.xlsx)
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            id="file"
            name="file"
            type="file"
            accept=".xlsx"
            required
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
          />
          <UploadButton />
        </div>
      </form>

      <UploadForm
        action={uploadCatalog}
        title="Прайс-лист"
        hint="Отчёты «Продажи товаров по номенклатуре», по одному на месяц — можно выбрать сразу несколько. Цены берутся фактические, из отгрузок, а не из справочника. Периоды складываются: чем больше месяцев загружено, тем меньше разовая распродажа перекашивает среднюю цену. Без прайс-листа не работает подбор позиций и сборка КП."
        multiple
      />

      <UploadForm
        action={uploadCompetitors}
        title="Покупатели конкурентов"
        hint="Списки покупателей из книг продаж — те, кто закупается у других поставщиков. Компании, совпавшие с нашими клиентами из 1С, помечаются отдельно: звонить им как новым нельзя."
        multiple
      />

      <div>
        <h2 className="mb-2 text-sm font-semibold">История загрузок</h2>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Файл</th>
                <th className="px-4 py-2 font-medium">Дата отчёта</th>
                <th className="px-4 py-2 text-right font-medium">Строк</th>
                <th className="px-4 py-2 text-right font-medium">Создано</th>
                <th className="px-4 py-2 text-right font-medium">Обновлено</th>
                <th className="px-4 py-2 font-medium">Загружено</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2 font-medium text-slate-900">{b.fileName}</td>
                  <td className="px-4 py-2 text-slate-600">{dateRu(b.reportDate)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{num(b.rowsTotal)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{num(b.rowsCreated)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{num(b.rowsUpdated)}</td>
                  <td className="px-4 py-2 text-slate-600">{dateTimeRu(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {batches.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              Загрузок пока не было.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
