'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
type SettingsShape = { vpsIp: string; dnsMode: 'cloudflare' | 'manual'; dmarcPolicy: 'none' | 'quarantine' | 'reject'; spfStrict: boolean; advancedDns: boolean }

export default function SettingsForm({ initial, advancedContent }: { initial: SettingsShape; advancedContent: React.ReactNode }) {
  const router = useRouter()
  const [dnsMode, setDnsMode] = useState(initial.dnsMode)
  const [dmarc, setDmarc] = useState(initial.dmarcPolicy)
  const [spfStrict, setSpfStrict] = useState(initial.spfStrict)
  const [advanced, setAdvanced] = useState(initial.advancedDns)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null)
    const body: Record<string, unknown> = { dnsMode, dmarcPolicy: dmarc, spfStrict, advancedDns: advanced }
    try {
      const res = await fetch('/api/v1/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setMsg({ ok: false, text: data.error ?? `保存失败（${res.status}）` }); return }
      setMsg({ ok: true, text: '已保存' }); router.refresh()
    } catch (error) { setMsg({ ok: false, text: String(error) }) }
    finally { setBusy(false) }
  }

  return <div className="settings-shell">
        <form className="panel settings-section" onSubmit={save}>
          <h2>手动与服务参数</h2><p className="hint">适用于需要自行维护主机、DNS 策略或 Webmail 的部署。</p>
          <h3 className="settings-subhead" id="dns-mode">DNS 生成参数</h3><div className="form-row"><div className="field"><label htmlFor="dns-mode-select">DNS 管理方式</label><select id="dns-mode-select" value={dnsMode} onChange={(e) => setDnsMode(e.target.value as typeof dnsMode)}><option value="cloudflare">Cloudflare 连接与推送</option><option value="manual">手动设置 DNS</option></select></div><div className="field"><label htmlFor="dmarc-policy">DMARC 策略</label><select id="dmarc-policy" value={dmarc} onChange={(e) => setDmarc(e.target.value as typeof dmarc)}><option value="none">none · 观察期</option><option value="quarantine">quarantine</option><option value="reject">reject</option></select></div></div>
          <div className="form-row"><label className="check"><input type="checkbox" checked={!spfStrict} onChange={(e) => setSpfStrict(!e.target.checked)} />SPF 使用 ~all（软失败）</label><label className="check"><input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />生成 autoconfig、MTA-STS、TLS-RPT 记录</label></div>
          <div className="form-row"><button className="primary" disabled={busy}>{busy ? '保存中…' : '保存高级设置'}</button>{msg && <div role="status" className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}</div>
        </form>
        {advancedContent}
  </div>
}
