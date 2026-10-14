'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type PreviewRecord = {
  type: string
  name: string
  content: string
  priority?: number
  cloverTag: string
  purpose: string
}

const STEPS = ['填写域名', 'DNS 记录预览', '确认创建']

export default function NewDomainWizard() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [records, setRecords] = useState<PreviewRecord[] | null>(null)
  const [vpsIp, setVpsIp] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function toPreview(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res = await fetch(`/api/v1/dns/preview?domain=${encodeURIComponent(name)}`)
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? `失败（${res.status}）` })
      return
    }
    setRecords(data.records ?? [])
    setVpsIp(data.vpsIp ?? null)
    setStep(1)
  }

  async function create() {
    setBusy(true)
    setMsg(null)
    const res = await fetch('/api/v1/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? `失败（${res.status}）` })
      return
    }
    // 建域后立刻生成本地 DNS 记录（推送留到域详情页点按钮）
    await fetch(`/api/v1/domains/${data.id}/dns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    router.push(`/domains/${data.id}`)
    router.refresh()
  }

  return (
    <section className="panel">
      <ol className="wizard-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'current' : i < step ? 'done' : ''}>
            <span className="n">{i + 1}</span> {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <form className="form-row" onSubmit={toPreview}>
          <div className="field">
            <label>域名</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="example.com" required />
          </div>
          <button className="primary" disabled={busy}>
            {busy ? '检查中…' : '下一步：看 DNS 记录'}
          </button>
          {msg && <div className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
        </form>
      )}

      {step === 1 && (
        <>
          <table className="grid">
            <thead>
              <tr>
                <th>类型</th>
                <th>名称</th>
                <th>内容</th>
                <th>用途</th>
              </tr>
            </thead>
            <tbody>
              {(records ?? []).map((r) => (
                <tr key={r.cloverTag}>
                  <td>{r.type}</td>
                  <td className="mono">{r.name === '@' ? name : `${r.name}.${name}`}</td>
                  <td className="mono" style={{ wordBreak: 'break-all', maxWidth: 320 }}>
                    {r.content}
                  </td>
                  <td>{r.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 10 }}>
            {vpsIp
              ? `A/SPF 使用设置页的 VPS IP：${vpsIp}。`
              : '尚未设置 VPS IP——现在去「设置」填写，否则 A/SPF 会用占位 IP。'}
            DKIM 公钥在域名建好后由 DMS 自动生成，届时在域详情页重新「生成 DNS 记录」即可补齐。
          </p>
          <div className="form-row">
            <button className="primary" onClick={() => setStep(2)} type="button">
              下一步：确认创建
            </button>
            <button onClick={() => setStep(0)} type="button">
              返回修改
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <p>
            将创建域名 <b className="mono">{name}</b>，并生成{' '}
            <b>{records?.length ?? 0}</b> 条 DNS 记录（入库；推送 Cloudflare 在域详情页操作）。
            域名的账号会同步到 DMS。
          </p>
          <div className="form-row">
            <button className="primary" onClick={create} disabled={busy}>
              {busy ? '创建中…' : '确认创建'}
            </button>
            <button onClick={() => setStep(1)} type="button">
              返回上一步
            </button>
            {msg && <div className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
          </div>
        </>
      )}
    </section>
  )
}
