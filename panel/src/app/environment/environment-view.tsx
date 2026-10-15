'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { CertificatesSection } from '../certificates/certificates-section'

type Step = { key: string; label: string; ok: boolean; detail: string; href: string; action: string; repair?: boolean }
type Domain = { id: number; name: string; active: boolean; checkedAt: string | null; items: Array<{ label: string; ok: boolean }> }
type Environment = { checkedAt: string; steps: Step[]; domains: Domain[]; panelHost: string; mailHost: string; dnsMode: string }

export default function EnvironmentView({ mode }: { mode: 'setup' | 'check' }) {
  const [data, setData] = useState<Environment | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [checkingDomain, setCheckingDomain] = useState<number | null>(null)
  const [dnsDomainsExpanded, setDnsDomainsExpanded] = useState(false)
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
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : '读取失败') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

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
    <div className="topbar environment-heading"><div><p className="eyebrow">{setup ? 'SETUP / 03' : 'SYSTEM / CHECK'}</p><h1>{setup ? '环境配置' : '环境检查'}</h1>
      <p className="hint">{setup ? '完成域名 DNS 检查和服务 TLS 证书设置后即可开始使用邮箱。' : '逐项检查配置与服务。红色项目会指明问题和设置入口。'}</p></div>
      <button type="button" onClick={() => void recheck()} disabled={checking || loading}>{checking ? '检查中…' : '重新检查环境'}</button></div>
    {error && <div className="banner" role="alert">{error}</div>}
    {notice && <div className="msg ok" role="status">{notice}</div>}
    {loading && !data ? <p className="hint">正在读取配置与证书状态…</p> : <>
      <section className={`environment-summary ${allGood ? 'is-ok' : 'is-error'}`}>
        <span className="environment-summary-symbol" aria-hidden="true">{allGood ? '✓' : '!'}</span>
        <div><strong>{allGood ? (setup ? '环境配置已完成' : '环境检查全部通过') : `${steps?.filter((step) => !step.ok).length ?? 0} 项需要处理`}</strong><p>{allGood ? (setup ? '域名、DNS、TLS 和邮件服务器 rDNS 已就绪，可以开始创建邮箱账户。' : '域名、DNS、证书、邮件服务器 rDNS、邮件端口监听与 SMTP 25 出站均正常。') : '按下方提示依次完成配置，再重新检查。'}</p></div>
        {allGood && <Link className="primary environment-next" href="/mailboxes">创建邮箱 →</Link>}
      </section>
      <div className="environment-steps">{steps?.map((step, index) => {
        const failedDnsDomains = step.key === 'dns' ? (data?.domains ?? []).filter((domain) => !domain.items.length || domain.items.some((item) => !item.ok)) : []
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
                <Link className="btn-link" href={`/domains/${domain.id}?tab=dns`}>查看详情 →</Link>
              </div>
            })}
          </div>}
        </Fragment>
      })}</div>
      <section className="panel environment-dns-tls" id="dns-tls">
        <div className="section-title environment-dns-tls-heading"><div><h2>DNS 与 TLS 证书</h2><p className="hint">在上方管理面板证书和统一邮件服务证书；下方检查各域名 DNS。所有域名的 MX 共用邮件主机名 {data?.mailHost || '（尚未配置）'}。</p></div>{data?.domains.length ? <span className="count">{data.domains.length} 个域名</span> : null}</div>
        <div className="environment-tls"><CertificatesSection embedded /></div>
        <section className="environment-domains"><div className="section-title environment-domain-heading"><div><h3>各域名 DNS 状态</h3><p className="hint">每个域名使用独立的 MX、SPF、DKIM 与 DMARC 记录；MX 都指向上方的统一邮件主机。</p></div></div>
          {data?.domains.length === 0 && <p className="empty">尚未添加邮件域名。添加域名后，可在这里检查 DNS 状态。</p>}
          {data?.domains.map((domain) => <div className="environment-domain" key={domain.id}>
              <div className="environment-domain-name"><b className="mono">{domain.name}</b><p className="hint">{domain.checkedAt ? `DNS 检查：${new Date(domain.checkedAt).toLocaleString('zh-CN')}` : 'DNS 尚未检查'}</p></div>
              <div className="environment-domain-checks" aria-label={`${domain.name} DNS 检查状态`}>{domain.items.length ? domain.items.map((item) => <span className={`tag ${item.ok ? 'ok' : 'err'}`} key={item.label}>{item.label}</span>) : <span className="tag warn">DNS 待检查</span>}</div>
              <div className="environment-domain-actions"><button type="button" onClick={() => void recheckDomain(domain.id)} disabled={checkingDomain !== null || checking}>{checkingDomain === domain.id ? '检查中…' : '检查 DNS'}</button><Link className="btn-link" href={`/domains/${domain.id}?tab=dns`}>DNS 记录 →</Link></div>
            </div>)}
        </section>
      </section>
      <p className="certificate-updated">{data?.checkedAt ? `证书与服务状态读取：${new Date(data.checkedAt).toLocaleString('zh-CN')}` : ''}</p>
    </>}
  </main>
}
