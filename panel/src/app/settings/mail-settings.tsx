'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { GlobalMailSettings } from '@/lib/settings'

export default function GlobalMailSettings({ initial, mailHost }: { initial: GlobalMailSettings; mailHost: string }) {
  const router = useRouter()
  const [settings, setSettings] = useState(initial)
  const [unlimited, setUnlimited] = useState(initial.maxAttachmentMb === 0)
  const [finiteAttachmentMb, setFiniteAttachmentMb] = useState(String(initial.maxAttachmentMb || 100))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const parsedAttachmentMb = Number(finiteAttachmentMb)
    if (!unlimited && (!/^\d+$/.test(finiteAttachmentMb) || !Number.isInteger(parsedAttachmentMb) || parsedAttachmentMb < 1 || parsedAttachmentMb > 102400)) {
      setMessage({ ok: false, text: '附件大小请输入 1 到 102400 MB 的整数，或勾选“无限额”。' })
      return
    }
    setBusy(true); setMessage(null)
    try {
      const response = await fetch('/api/v1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, maxAttachmentMb: unlimited ? 0 : parsedAttachmentMb }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '全局邮箱设置保存失败。')
      setSettings(data.mail)
      setUnlimited(data.mail.maxAttachmentMb === 0)
      if (data.mail.maxAttachmentMb > 0) setFiniteAttachmentMb(String(data.mail.maxAttachmentMb))
      setMessage({ ok: true, text: '全局邮箱设置已保存并同步。' })
      router.refresh()
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : '全局邮箱设置保存失败。' })
      const current = await fetch('/api/v1/settings', { cache: 'no-store' }).then((response) => response.json()).catch(() => null)
      if (current?.mail) {
        setSettings(current.mail)
        setUnlimited(current.mail.maxAttachmentMb === 0)
        if (current.mail.maxAttachmentMb > 0) setFiniteAttachmentMb(String(current.mail.maxAttachmentMb))
      }
      router.refresh()
    } finally { setBusy(false) }
  }

  function toggle(key: keyof GlobalMailSettings, checked: boolean) {
    setSettings((current) => ({ ...current, [key]: checked }))
  }

  return <section className="panel settings-section" id="mail-policy">
    <form onSubmit={save}>
      <fieldset className="global-mail-protocols">
        <legend>可用协议</legend>
        <div className="form-row">
          <label className="check"><input type="checkbox" checked={settings.allowImap} onChange={(event) => toggle('allowImap', event.target.checked)} />IMAP 收信与 Webmail</label>
          <label className="check"><input type="checkbox" checked={settings.allowPop3} onChange={(event) => toggle('allowPop3', event.target.checked)} />POP3 收信</label>
          <label className="check"><input type="checkbox" checked={settings.allowSieve} onChange={(event) => toggle('allowSieve', event.target.checked)} />ManageSieve 规则</label>
          <label className="check"><input type="checkbox" checked={settings.allowSmtp} onChange={(event) => toggle('allowSmtp', event.target.checked)} />SMTP 发信</label>
        </div>
        <p className="hint-text">SMTP 开关只控制账号认证发信；邮件服务器之间的收信投递不受影响。POP3 和 ManageSieve 还需在 DMS 环境中启用对应服务。</p>
      </fieldset>
      <fieldset className="mail-client-config">
        <legend>邮件客户端配置</legend>
        <p className="hint-text">在 Foxmail、Thunderbird、Apple Mail 等客户端添加邮箱时，选择“手动配置”。推荐使用 IMAP，多台设备可同步邮件；也可选择 POP3 下载邮件。</p>
        {mailHost ? <p className="mail-client-host">收件服务器和发件服务器均填写：<code>{mailHost}</code></p> : <p className="mail-client-host">尚未配置邮件主机名，请先在“环境配置 → DNS 与 TLS”中设置。</p>}
        <div className="table-scroll" tabIndex={0} role="region" aria-label="邮件客户端服务器端口和加密方式">
          <table className="grid">
            <thead><tr><th scope="col">用途</th><th scope="col">协议</th><th scope="col">端口</th><th scope="col">加密方式</th></tr></thead>
            <tbody>
              <tr><th scope="row">收件（推荐）</th><td>IMAP</td><td>993</td><td>SSL/TLS</td></tr>
              <tr><th scope="row">收件</th><td>POP3</td><td>995</td><td>SSL/TLS</td></tr>
              <tr><th scope="row">发件</th><td>SMTP</td><td>465</td><td>SSL/TLS</td></tr>
              <tr><th scope="row">发件（备用）</th><td>SMTP</td><td>587</td><td>STARTTLS</td></tr>
            </tbody>
          </table>
        </div>
        <ul className="mail-client-steps">
          <li><strong>用户名：</strong>收件、发件均填写完整邮箱地址，例如 user@example.com。</li>
          <li><strong>密码：</strong>填写创建邮箱时设置的邮箱密码，不是面板管理员密码。</li>
          <li><strong>发件认证：</strong>开启“SMTP 服务器需要身份验证”，使用与收件相同的用户名和密码。</li>
        </ul>
        <p className="hint-text">收件选择 IMAP 或 POP3 其中一种，发件始终使用 SMTP。请先启用并保存对应协议，确保邮件证书已安装、对应端口已放行。</p>
      </fieldset>
      <fieldset className="global-mail-content">
        <legend>内容与附件</legend>
        <label className="check"><input type="checkbox" checked={settings.allowExternalImages} onChange={(event) => toggle('allowExternalImages', event.target.checked)} />默认显示邮件中的远程图片</label>
        <p className="hint-text">默认关闭，使用 Roundcube 原生的图片拦截和按需加载功能。</p>
        <div className="global-attachment-controls">
          <label className="field global-attachment-limit">附件合计上限（MB）<input type="number" min={1} max={102400} step={1} value={finiteAttachmentMb} disabled={unlimited} onChange={(event) => setFiniteAttachmentMb(event.target.value)} /></label>
          <label className="check global-attachment-unlimited"><input type="checkbox" checked={unlimited} onChange={(event) => {
            const checked = event.target.checked
            setUnlimited(checked)
            setSettings((current) => ({ ...current, maxAttachmentMb: checked ? 0 : (Number(finiteAttachmentMb) || 100) }))
          }} />无限额</label>
        </div>
        <p className="hint-text">默认 100 MB；勾选“无限额”会关闭大小上限。DMS 与 Roundcube 使用统一限制，并为完整 MIME 邮件预留编码空间。</p>
      </fieldset>
      <div className="form-row"><button className="primary" disabled={busy}>{busy ? '保存并同步中…' : '保存全局邮箱设置'}</button>{message && <div role="status" className={'msg ' + (message.ok ? 'ok' : 'err')}>{message.text}</div>}</div>
    </form>
  </section>
}
