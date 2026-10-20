'use client'

import { useI18n } from '@/lib/i18n/client'

type Props = {
  selected: boolean
  onManage: () => void
}

export default function DomainControls({ selected, onManage }: Props) {
  const { t } = useI18n()
  return <div className="environment-domain-manage">
    <button type="button" className={`btn-link ${selected ? 'is-selected' : ''}`} onClick={onManage} aria-pressed={selected}>{t('environment.titleDns')}</button>
  </div>
}
