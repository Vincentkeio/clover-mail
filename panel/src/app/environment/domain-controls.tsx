'use client'

type Props = {
  selected: boolean
  onManage: () => void
}

export default function DomainControls({ selected, onManage }: Props) {
  return <div className="environment-domain-manage">
    <button type="button" className={`btn-link ${selected ? 'is-selected' : ''}`} onClick={onManage} aria-pressed={selected}>DNS 设置</button>
  </div>
}
