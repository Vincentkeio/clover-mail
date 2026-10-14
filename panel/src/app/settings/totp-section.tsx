'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type SetupData = { secret: string; uri: string; qr: string; issuer: string; username: string }

export default function TotpSection({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const [setup, setSetup] = useState<SetupData | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function startSetup() {
    setBusy(true)
    setMsg(null)
    const res = await fetch('/api/v1/auth/totp', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? `失败（${res.status}）` })
      return
    }
    setSetup(data)
  }

  async function confirmEnable() {
    if (!setup) return
    setBusy(true)
    setMsg(null)
    const res = await fetch('/api/v1/auth/totp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: setup.secret, code }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? `失败（${res.status}）` })
      return
    }
    setSetup(null)
    setCode('')
    setMsg({ ok: true, text: '两步验证已开启，下次登录需要验证码' })
    router.refresh()
  }

  async function disable() {
    setBusy(true)
    setMsg(null)
    const res = await fetch('/api/v1/auth/totp', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    setCode('')
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? `失败（${res.status}）` })
      return
    }
    setMsg({ ok: true, text: '两步验证已关闭' })
    router.refresh()
  }

  return (
    <section className="panel">
      <div className="section-title">
        <h2>两步验证（TOTP）</h2>
        <span className={'tag ' + (enabled ? 'ok' : '')}>{enabled ? '已开启' : '未开启'}</span>
      </div>
      <p className="hint">
        用任意 TOTP 应用（Google Authenticator / 1Password / Aegis 等）扫码。开启后登录需「密码 + 6 位验证码」。
      </p>

      {msg && <div className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}

      {!enabled && !setup && (
        <div className="form-row">
          <button className="primary" onClick={startSetup} disabled={busy} type="button">
            {busy ? '生成中…' : '开启两步验证'}
          </button>
        </div>
      )}

      {!enabled && setup && (
        <>
          <div className="totp-setup">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="TOTP 二维码" width={200} height={200} />
            <div>
              <p className="hint">
                扫不进？手动添加：账号 <b>{setup.username}</b>，密钥
              </p>
              <p className="mono" style={{ wordBreak: 'break-all' }}>
                {setup.secret}
              </p>
              <div className="form-row">
                <div className="field">
                  <label>输入应用显示的 6 位码</label>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                    inputMode="numeric"
                    maxLength={6}
                  />
                </div>
                <button className="primary" onClick={confirmEnable} disabled={busy || code.length !== 6} type="button">
                  {busy ? '校验中…' : '确认开启'}
                </button>
                <button onClick={() => { setSetup(null); setCode(''); setMsg(null) }} type="button">
                  取消
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {enabled && (
        <div className="form-row">
          <div className="field">
            <label>关闭需验证当前码</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              inputMode="numeric"
              maxLength={6}
            />
          </div>
          <button className="danger" onClick={disable} disabled={busy || code.length !== 6} type="button">
            {busy ? '处理中…' : '关闭两步验证'}
          </button>
        </div>
      )}
    </section>
  )
}
