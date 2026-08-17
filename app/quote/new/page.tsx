import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { campaignClients, catalogItems } from '@/lib/db/schema'
import { getClientById } from '@/lib/queries'
import { sql } from 'drizzle-orm'
import { QuoteBuilder } from './QuoteBuilder'

export const dynamic = 'force-dynamic'

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; link?: string }>
}) {
  const { client: clientRaw, link: linkRaw } = await searchParams
  const clientId = Number(clientRaw)
  if (!Number.isInteger(clientId) || clientId <= 0) notFound()

  const client = await getClientById(clientId)
  if (!client) notFound()

  const db = await getDb()
  const [{ items }] = await db
    .select({ items: sql<number>`count(*)::int` })
    .from(catalogItems)

  let campaignClientId: number | undefined
  const linkId = Number(linkRaw)
  if (Number.isInteger(linkId) && linkId > 0) {
    const [link] = await db
      .select({ id: campaignClients.id })
      .from(campaignClients)
      .where(eq(campaignClients.id, linkId))
      .limit(1)
    campaignClientId = link?.id
  }

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/clients/${client.code1c ?? client.inn ?? client.id}`} className="text-xs text-slate-500 hover:text-slate-900">
          ← {client.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Аудит цен и КП</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Клиент присылает, что закупает, — мы отвечаем ценами по своему прайсу.
          В прайсе {Number(items).toLocaleString('ru-RU')} позиций, цены — фактические
          из отгрузок, не из справочника.
        </p>
      </div>

      {Number(items) === 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Прайс-лист пуст. Загрузите отчёты «Продажи товаров по номенклатуре» —
          без них подбирать не из чего.
        </div>
      ) : (
        <QuoteBuilder
          clientId={client.id}
          clientName={client.name}
          campaignClientId={campaignClientId}
        />
      )}
    </div>
  )
}
