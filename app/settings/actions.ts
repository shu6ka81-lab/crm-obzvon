'use server'

import { revalidatePath } from 'next/cache'
import { COMPANY_DEFAULTS, saveCompanyProfile, type CompanyProfile } from '@/lib/company'

export interface SettingsState {
  ok: boolean
  message: string
}

export async function saveCompany(
  _prev: SettingsState | null,
  formData: FormData,
): Promise<SettingsState> {
  const values: Partial<CompanyProfile> = {}
  for (const key of Object.keys(COMPANY_DEFAULTS) as (keyof CompanyProfile)[]) {
    const v = formData.get(key)
    if (typeof v === 'string') values[key] = v.trim()
  }

  if (!values.legalName) {
    return { ok: false, message: 'Без наименования организации предложение не отправишь' }
  }

  await saveCompanyProfile(values)
  revalidatePath('/settings')
  return { ok: true, message: 'Сохранено' }
}
