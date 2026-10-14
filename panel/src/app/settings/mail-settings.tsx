'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { GlobalMailSettings } from '@/lib/settings'

export default function GlobalMailSettings({ initial }: { initial: GlobalMailSettings }) {
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
      <fieldset className="global-mail-content">
        <legend>内容与附件</legend>
        <label className="check"><input type="checkbox" checked={settings.allowExternalImages} onChange={(event) => toggle('allowExternalImages', event.target.checked)} />允许用户按需加载邮件中的远程图片</label>
        <p className="hint-text">默认拦截外部图片；开启后，用户仍需在每封邮件中主动选择加载。</p>
        <label className="check"><input type="checkbox" checked={settings.allowExecutableAttachments} onChange={(event) => toggle('allowExecutableAttachments', event.target.checked)} />允许 Webmail 发送和下载可执行附件</label>
        <p className="hint-text">默认禁止；此项控制 Webmail，不会阻止 DMS 接收此类附件。</p>
        <div className="global-attachment-controls">
          <label className="field global-attachment-limit">附件合计上限（MB）<input type="number" min={1} max={102400} step={1} value={finiteAttachmentMb} disabled={unlimited} onChange={(event) => setFiniteAttachmentMb(event.target.value)} /></label>
          <label className="check global-attachment-unlimited"><input type="checkbox" checked={unlimited} onChange={(event) => {
            const checked = event.target.checked
            setUnlimited(checked)
            setSettings((current) => ({ ...current, maxAttachmentMb: checked ? 0 : (Number(finiteAttachmentMb) || 100) }))
          }} />无限额</label>
        </div>
        <p className="hint-text">默认 100 MB；勾选“无限额”会关闭大小上限。DMS 全局邮件上限会额外预留 MIME 编码空间，Webmail 发信与附件下载使用此值。</p>
      </fieldset>
      <div className="form-row"><button className="primary" disabled={busy}>{busy ? '保存并同步中…' : '保存全局邮箱设置'}</button>{message && <div role="status" className={'msg ' + (message.ok ? 'ok' : 'err')}>{message.text}</div>}</div>
    </form>
  </section>
}
