'use client'

import { useCallback, useEffect, useState } from 'react'

type Probe = {
  host: string; port: number; ok: boolean; installed?: boolean; authorized?: boolean; subject?: string; issuer?: string
  validFrom?: string; validTo?: string; daysLeft?: number; fingerprint?: string; error?: string
}
type CertificateData = { checkedAt: string; panelHost: string; mailHost: string; checks: Probe[]; certificateTask?: { running: boolean; message: string; error: string | null; updatedAt?: string } | null; renewal?: { enabled: boolean; manager: string; challenge: string; ports: number[]; acmeEmail: string | null }; error?: string }

function date(value?: string) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

function state(probe?: Probe) {
  if (!probe) return { label: '未检测', style: 'warn' }
  if (probe.installed === false) return { label: '未安装', style: 'warn' }
  if (!probe.validTo) return { label: probe.error ? '证书不可用' : '未检测', style: 'warn' }
  if ((probe.daysLeft ?? -1) < 0) return { label: '已过期', style: 'err' }
  if (probe.authorized === false) return { label: '证书链异常', style: 'warn' }
  if ((probe.daysLeft ?? 999) <= 14) return { label: '即将到期', style: 'warn' }
  return { label: '有效', style: 'ok' }
}

export function CertificatesSection({ embedded = false }: { embedded?: boolean }) {
  const [data, setData] = useState<CertificateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionTarget, setActionTarget] = useState<'panel' | 'mail' | null>(null)
  const [actionMessage, setActionMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/certificates', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || '证书状态读取失败')
      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  async function issueOrRenew(target: 'panel' | 'mail') {
    setActionTarget(target)
    setActionMessage('')
    setError('')
    try {
      const response = await fetch('/api/certificates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || '证书申请失败')
      setActionMessage(payload.message || '证书状态已更新')
      if (target === 'mail' && payload.running) {
        const deadline = Date.now() + 9 * 60 * 1000
        const queuedAt = Date.parse(payload.queuedAt || new Date().toISOString())
        let taskStarted = false
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 2000))
          let statusResponse: Response
          try {
            statusResponse = await fetch('/api/certificates', { cache: 'no-store' })
          } catch {
            // Automatic certificate provisioning may finish after the first TLS probe.
            continue
          }
          if (!statusResponse.ok) continue
          const statusPayload = await statusResponse.json() as CertificateData
          setData(statusPayload)
          const task = statusPayload.certificateTask
          const startedAt = task?.updatedAt ? Date.parse(task.updatedAt) : 0
          taskStarted ||= Boolean(task?.running) || startedAt >= queuedAt
          if (task?.message && task.running) setActionMessage(task.message)
          if (taskStarted && task && !task.running) {
            if (task.error) throw new Error(task.error)
            setActionMessage(task.message || '邮件证书已签发并安装。')
            return
          }
        }
        throw new Error('邮件证书任务仍在运行或面板入口尚未恢复。请稍后点“重新检测”查看结果。')
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '申请失败，请稍后重试')
    } finally { setActionTarget(null) }
  }

  useEffect(() => { void load() }, [load])

  const panel = data?.checks.find((item) => item.port === 443)
  const mail = data?.checks.find((item) => item.port === 465)

  return <div className="wrap certificate-page" id={embedded ? 'tls' : undefined}>
    <div className="topbar certificate-heading">
      <div>{embedded ? <h2>面板与邮件服务证书</h2> : <h1>证书管理</h1>}<p className="hint">面板和邮件服务各使用一张证书；邮件证书签发给面板设置中的邮件主机名。</p></div>
      <button type="button" onClick={() => void load()} disabled={loading}>{loading ? '检测中…' : '重新检测'}</button>
    </div>

    {error && <div className="banner" role="alert">{error}</div>}
    {data?.error && <div className="banner" role="alert">{data.error}</div>}

    <section className="certificate-list" aria-label="证书状态">
      <CertificateCard title="面板证书" host={data?.panelHost} probe={panel} kind="caddy" loading={loading && !data} actionBusy={actionTarget === 'panel'} onAction={() => void issueOrRenew('panel')} />
      <CertificateCard title="邮件服务证书" host={data?.mailHost} probe={mail} kind="mail" loading={loading && !data} actionBusy={actionTarget === 'mail'} onAction={() => void issueOrRenew('mail')} />
    </section>

    {actionMessage && <p className="certificate-action-message" role="status">{actionMessage}</p>}

      <section className="panel certificate-settings">
      <div className="section-title"><div><h2>签发与自动续期</h2><p className="hint">面板证书由入口 Caddy 或宿主机 Nginx 管理；邮件证书会安装到 DMS 邮件服务。</p></div><span className="tag ok">自动续期已开启</span></div>
      <dl className="certificate-settings-grid">
        <div><dt>签发方式</dt><dd>{data?.renewal?.manager || 'Caddy 自动 HTTPS'}</dd></div>
        <div><dt>验证方式</dt><dd>{data?.renewal?.challenge || 'HTTP-01 / TLS-ALPN-01'}</dd></div>
        <div><dt>公网端口</dt><dd>{data?.renewal?.ports?.join(' / ') || '80 / 443'}</dd></div>
        <div><dt>ACME 联系邮箱</dt><dd>{data?.renewal?.acmeEmail || '沿用安装时配置'}</dd></div>
      </dl>
      <p className="hint certificate-settings-hint">签发失败时请确认域名 A 记录指向本机，且公网 TCP 80 或 443 可达。此处使用标准验证端口，不支持改用非标准端口。</p>
    </section>

      <section className="certificate-note">
      <span className="certificate-note-mark" aria-hidden="true">i</span>
      <div><b>证书状态说明</b><p>“签发 / 检查续期”负责申请、安装和检查证书；邮件证书安装后会重启 DMS 载入新证书。证书助手每天检查邮件证书续期，不使用 DNS-01。邮件证书需要公网 TCP 80 可达；宿主机 Caddy 共享模式通过 webroot 验证，其他共享入口会在签发期间短暂停止后自动恢复。邮件服务端口是否监听请到“环境检查”查看。</p></div>
    </section>

    <p className="certificate-updated">{data?.checkedAt ? `最近检测：${date(data.checkedAt)}` : '尚未取得检测结果'}</p>
  </div>
}


function CertificateCard({ title, host, probe, kind, loading, actionBusy, onAction }: { title: string; host?: string; probe?: Probe; kind: 'caddy' | 'mail'; loading: boolean; actionBusy: boolean; onAction: () => void }) {
  const current = state(probe)
  return <section className="panel certificate-card" id={kind === 'mail' ? 'tls-mail' : 'tls-panel'}>
    <div className="certificate-card-top">
      <div><p className="certificate-label">{kind === 'caddy' ? 'WEB PANEL · ACME' : 'MAIL SERVICES · ACME'}</p><h2>{title}</h2><code className="certificate-host">{host || '尚未配置域名'}</code></div>
      <span className={`tag ${loading ? '' : current.style}`}>{loading ? '检测中' : current.label}</span>
    </div>
    <div className="certificate-card-action"><span className="hint-text">自动续期{host ? '已开启' : '待配置'}</span><button type="button" onClick={onAction} disabled={actionBusy || loading || !host}>{actionBusy ? '正在申请…' : '签发 / 检查续期'}</button></div>
    {probe?.validTo ? <dl className="certificate-details">
      <div><dt>剩余有效期</dt><dd className={probe.daysLeft !== undefined && probe.daysLeft <= 14 ? 'is-expiring' : ''}>{probe.daysLeft} 天</dd></div>
      <div><dt>到期时间</dt><dd>{date(probe.validTo)}</dd></div>
      <div><dt>签发者</dt><dd>{probe.issuer || '未知'}</dd></div>
      <div><dt>证书主体</dt><dd>{probe.subject || host || '未知'}</dd></div>
    </dl> : <div className="certificate-empty">{loading ? '正在读取服务证书…' : probe?.error || (kind === 'mail' && !host ? '请先配置邮件服务域名。' : '暂时无法连接服务读取证书。')}</div>}
    {probe?.error && probe.validTo && <p className="certificate-error">证书链校验提示：{probe.error}</p>}
    {probe?.fingerprint && <details className="certificate-fingerprint"><summary>查看 SHA-256 指纹</summary><code>{probe.fingerprint}</code></details>}
  </section>
}
