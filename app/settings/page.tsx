import { getCompanyProfile } from '@/lib/company'
import { CompanyForm } from './CompanyForm'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const company = await getCompanyProfile()

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Реквизиты компании</h1>
        <p className="mt-1 text-sm text-slate-500">
          Подставляются в коммерческое предложение — в шапку, подвал и строку подписи. Заполнены
          по открытым данным; проверьте перед первой отправкой клиенту.
        </p>
      </div>

      <CompanyForm company={company} />
    </div>
  )
}
