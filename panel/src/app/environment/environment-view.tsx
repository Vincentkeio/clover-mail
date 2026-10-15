'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useState } from 'react'
import DnsPanel from './domain-dns-panel'

type Step = { key: string; label: string; ok: boolean; detail: string; href: string; action: string; repair?: boolean }
type Domain = { id: number; name: string; active: boolean; checkedAt: string | null; items: Array<{ label: string; ok: boolean }>; mailHostname: string; ownershipToken: string; mailboxCount: number; ruleCount: number }
type Environment = { checkedAt: string; steps: Step[]; domains: Domain[]; panelHost: string; mailHost: string; dnsMode: string }

export default function EnvironmentView({ mode, manageDomains = false, initialDomainId }: { mode: 'setup' | 'check'; manageDomains?: boolean; initialDomainId?: number }) {
  const [data, setData] = useState<Environment | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [checkingDomain, setCheckingDomain] = useState<number | null>(null)
  const [dnsDomainsExpanded, setDnsDomainsExpanded] = useState(false)
  const [selectedDomainId, setSelectedDomainId] = useState<number | null>(initialDomainId ?? null)
  const [dnsTab, setDnsTab] = useState<'automatic' | 'advanced' | 'manual'>('automatic')
  const [repairing, setRepairing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/system/environment', { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || '环境状态读取失败')
      setData(body)
      setSelectedDomainId((current) => current && body.domains.some((domain: Domain) => domain.id === current)
        ? current
        : initialDomainId && body.domains.some((domain: Domain) => domain.id === initialDomainId)
          ? initialDomainId
          : body.domains[0]?.id ?? null)
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : '读取失败') }
    finally { setLoading(false) }
  }, [initialDomainId])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (initialDomainId) setSelectedDomainId(initialDomainId) }, [initialDomainId])

  async function recheck() {
    setChecking(true)
    setError('')
    try {
      const res = await fetch('/api/v1/system/environment', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'DNS 检查失败')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : '检查失败') }
    finally { setChecking(false) }
  }

  async function recheckDomain(id: number) {
    setCheckingDomain(id)
    setError('')
    try {
      const res = await fetch(`/api/v1/domains/${id}/dns/check`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'DNS 检查失败')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : '检查失败') }
    finally { setCheckingDomain(null) }
  }

  function selectDomain(id: number) { setSelectedDomainId(id) }

  async function repairMailService() {
    setRepairing(true)
    setError('')
    setNotice('')
    try {
      const res = await fetch('/api/v1/system/environment/mail-service/repair', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || '邮件服务修复失败')
      setNotice(body.message || '邮件服务已修复。')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : '邮件服务修复失败') }
    finally { setRepairing(false) }
  }

  const setup = mode === 'setup'
  const steps = setup ? data?.steps.filter((step) => ['cloudflare', 'domains', 'dns', 'panel-tls', 'mail-tls', 'mail-rdns'].includes(step.key)) : data?.steps
  const allGood = Boolean(steps?.length && steps.every((step) => step.ok))
  return <main className="wrap environment-page">
    <div className="topbar environment-heading"><div><p className="eyebrow">{manageDomains ? 'SYSTEM / DNS' : setup ? 'SETUP / 03' : 'SYSTEM / CHECK'}</p><h1>{manageDomains ? 'DNS 设置' : setup ? '环境配置' : '环境检查'}</h1>
      <p className="hint">{manageDomains ? '查看各域名的 DNS 状态并同步记录。' : setup ? '完成域名 DNS 检查和服务 TLS 证书设置后即可开始使用邮箱。' : '逐项检查配置与服务。红色项目会指明问题和设置入口。'}</p></div>
      {!manageDomains && <button type="button" onClick={() => void recheck()} disabled={checking || loading}>{checking ? '检查中…' : '重新检查环境'}</button>}</div>
    {error && <div className="banner" role="alert">{error}</div>}
    {notice && <div className="msg ok" role="status">{notice}</div>}
    {loading && !data ? <p className="hint">正在读取配置与证书状态…</p> : <>
      {!manageDomains && <section className={`environment-summary ${allGood ? 'is-ok' : 'is-error'}`}>
        <span className="environment-summary-symbol" aria-hidden="true">{allGood ? '✓' : '!'}</span>
        <div><strong>{allGood ? (setup ? '环境配置已完成' : '环境检查全部通过') : `${steps?.filter((step) => !step.ok).length ?? 0} 项需要处理`}</strong><p>{allGood ? (setup ? '域名、DNS、TLS 和邮件服务器 rDNS 已就绪，可以开始创建邮箱账户。' : '域名、DNS、证书、邮件服务器 rDNS、邮件端口监听与 SMTP 25 出站均正常。') : '按下方提示依次完成配置，再重新检查。'}</p></div>
        {allGood && <Link className="primary environment-next" href="/mailboxes">创建邮箱 →</Link>}
      </section>}
      {!manageDomains && <div className="environment-steps">{steps?.map((step, index) => {
        const failedDnsDomains = step.key === 'dns' ? (data?.domains ?? []).filter((domain) => domain.active && (!domain.items.length || domain.items.some((item) => !item.ok))) : []
        const detailId = 'environment-dns-domain-details'
        return <Fragment key={step.key}>
          <section className="environment-step">
            <div className="environment-step-index">{String(index + 1).padStart(2, '0')}</div><div className="environment-step-body"><div className="environment-step-title"><h2>{step.label}</h2><span className={`tag ${step.ok ? 'ok' : 'err'}`}>{step.ok ? '正常' : '待处理'}</span></div>
              <p>{step.detail}</p></div><div className="environment-step-actions">{failedDnsDomains.length > 0 && <button type="button" className="environment-dns-toggle" aria-expanded={dnsDomainsExpanded} aria-controls={detailId} onClick={() => setDnsDomainsExpanded((expanded) => !expanded)}>{dnsDomainsExpanded ? '收起域名' : '查看域名'} <span aria-hidden="true">{dnsDomainsExpanded ? '⌃' : '⌄'}</span></button>}{step.repair && <button type="button" className="primary" disabled={repairing} onClick={() => void repairMailService()}>{repairing ? '正在修复…' : '修复邮件服务'}</button>}<Link className="btn-link" href={step.href}>{step.action} →</Link></div>
          </section>
          {failedDnsDomains.length > 0 && <div className="environment-dns-details" id={detailId} hidden={!dnsDomainsExpanded}>
            <div className="environment-dns-details-heading">未通过 DNS 检查的域名</div>
            {failedDnsDomains.map((domain) => {
              const failedItems = domain.items.filter((item) => !item.ok)
              return <div className="environment-dns-domain" key={domain.id}>
                <div><b className="mono">{domain.name}</b><p>{failedItems.length ? `未通过：${failedItems.map((item) => item.label).join('、')}` : '尚未完成 DNS 检查'}</p></div>
                <Link className="btn-link" href={`/environment?domain=${domain.id}#domain-dns`}>管理 DNS →</Link>
              </div>
            })}
          </div>}
        </Fragment>
      })}</div>}
      {manageDomains ? <div className="dns-management-layout" id="domain-manager">
        <nav className="dns-tabs" role="tablist" aria-label="DNS 管理选项">
          {[['automatic', '自动配置 DNS'], ['advanced', '高级选项'], ['manual', '手动配置参考']].map(([key, label]) => <button key={key} type="button" role="tab" id={`dns-tab-${key}`} aria-selected={dnsTab === key} aria-controls={`dns-panel-${key}`} className={dnsTab === key ? 'is-active' : ''} style={dnsTab === key ? { background: '#087b59', borderColor: '#087b59', color: '#fff' } : undefined} onClick={() => setDnsTab(key as 'automatic' | 'advanced' | 'manual')}>{label}</button>)}
        </nav>
        <section className="dns-tab-panel" role="tabpanel" id={`dns-panel-${dnsTab}`} aria-labelledby={`dns-tab-${dnsTab}`}>
          {dnsTab === 'automatic' && <div className="dns-auto-domain-list" aria-label="邮件域名 DNS 配置">
            {data?.domains.map((domain) => {
              const passed = domain.items.filter((item) => item.ok).length
              const total = domain.items.length
              return <article className="dns-auto-domain-card" key={domain.id}>
                <header className="dns-auto-domain-header">
                  <div><div className="dns-auto-domain-title"><h2 className="mono">{domain.name}</h2><span className={`dns-domain-state ${domain.active ? 'is-active' : ''}`}>{domain.active ? '启用' : '停用'}</span></div>
                    <p>{domain.mailboxCount} 个邮箱 · {domain.ruleCount} 条规则 · MX {domain.mailHostname || data?.mailHost || '尚未配置'}</p></div>
                  <div className="dns-auto-domain-checked">{domain.checkedAt ? `检测于 ${new Date(domain.checkedAt).toLocaleString('zh-CN')}` : '尚未检测'}</div>
                </header>
                <section className="dns-auto-domain-status" aria-label={`${domain.name} DNS 检查结果`}>
                  <div className="dns-auto-domain-status-heading"><h3>DNS 检查</h3><span>{total ? `${passed}/${total} 项匹配` : '待检测'}</span></div>
                  <div className="dns-domain-row-records">{domain.items.length ? domain.items.map((item) => <span className={`dns-record-chip ${item.ok ? 'is-ok' : 'is-missing'}`} key={item.label}><span aria-hidden="true">{item.ok ? '✓' : '!'}</span>{item.label}</span>) : <span className="dns-record-chip is-pending">等待首次检查</span>}</div>
                </section>
                <div className="dns-auto-domain-footer">
                  <button type="button" onClick={() => void recheckDomain(domain.id)} disabled={checkingDomain !== null || checking}>{checkingDomain === domain.id ? '检查中…' : '重新检测 DNS'}</button>
                  <DnsPanel domainId={domain.id} domainName={domain.name} view="automatic" onSynced={() => void load()} />
                </div>
              </article>
            })}
            {data?.domains.length === 0 && <p className="dns-domain-empty">还没有添加邮件域名。<Link href="/domains">前往域名配置 →</Link></p>}
            <p className="dns-domain-overview-footnote">所有域名共用邮件主机 <span className="mono">{data?.mailHost || '尚未配置'}</span>。域名增删与启用状态在<Link href="/domains">域名配置</Link>中管理。</p>
          </div>}
          {dnsTab === 'advanced' && (() => {
            const domain = data?.domains.find((item) => item.id === selectedDomainId) ?? data?.domains[0]
            return domain ? <div className="dns-advanced-tab"><div className="dns-tab-heading"><div><p className="dns-section-kicker">DNS / 工具</p><h2>高级选项</h2><p>查看记录预览、手动导出配置文件并核对 DNS 检测结果。</p></div><label className="dns-domain-select">域名<select value={domain.id} onChange={(event) => selectDomain(Number(event.target.value))}>{data?.domains.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div><DnsPanel domainId={domain.id} domainName={domain.name} view="advanced" /></div> : <p className="empty">添加域名后可使用高级选项。</p>
          })()}
          {dnsTab === 'manual' && (() => {
            const domain = data?.domains.find((item) => item.id === selectedDomainId) ?? data?.domains[0]
            return domain ? <div className="dns-manual-tab"><div className="dns-tab-heading"><div><p className="dns-section-kicker">DNS / 文档</p><h2>手动配置参考</h2><p>在 DNS 服务商处逐条添加下列记录。记录值根据该域名的邮件服务器设置生成。</p></div><label className="dns-domain-select">域名<select value={domain.id} onChange={(event) => selectDomain(Number(event.target.value))}>{data?.domains.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div><DnsPanel domainId={domain.id} domainName={domain.name} view="manual" /></div> : <p className="empty">添加域名后可查看手动配置参考。</p>
          })()}
        </section>
      </div> : <section className="panel environment-dns-tls" id="dns-tls">
        <div className="section-title environment-dns-tls-heading"><div><h2>邮件域名 DNS</h2><p className="hint">查看各域名的 DNS 检查结果。所有域名的 MX 共用邮件主机名 {data?.mailHost || '（尚未配置）'}。</p></div>{data?.domains.length ? <span className="count">{data.domains.length} 个域名</span> : null}</div>
        <section className="environment-domains"><div className="section-title environment-domain-heading"><div><h3>已配置域名</h3><p className="hint">域名增删与启用状态在<Link href="/domains">域名配置</Link>中管理。</p></div></div>
          {data?.domains.length === 0 && <p className="empty">尚未添加邮件域名。请先到<Link href="/domains">域名配置</Link>添加域名。</p>}
          {data?.domains.map((domain) => <div className="environment-domain" key={domain.id}>
            <div className="environment-domain-name"><div className="environment-domain-title"><b className="mono">{domain.name}</b><span className={`tag ${domain.active ? 'ok' : 'warn'}`}>{domain.active ? '启用' : '已停用'}</span></div><p className="hint">{domain.checkedAt ? `DNS 检查：${new Date(domain.checkedAt).toLocaleString('zh-CN')}` : 'DNS 尚未检查'}</p></div>
            <div className="environment-domain-checks" aria-label={`${domain.name} DNS 检查状态`}>{domain.items.length ? domain.items.map((item) => <span className={`tag ${item.ok ? 'ok' : 'err'}`} key={item.label}>{item.label}</span>) : <span className="tag warn">DNS 待检查</span>}</div>
            <div className="environment-domain-actions"><span className="count">{domain.mailboxCount} 邮箱 · {domain.ruleCount} 条规则</span><button type="button" onClick={() => void recheckDomain(domain.id)} disabled={checkingDomain !== null || checking}>{checkingDomain === domain.id ? '检查中…' : '检查 DNS'}</button></div>
          </div>)}
        </section>
      </section>}
    </>}
  </main>
}
