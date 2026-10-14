'use client'

import { useCallback, useEffect, useState } from 'react'

type Zone = { id: string; name: string; status: string; account: string | null; imported: boolean }
type ItemResult = {
  name: string
  created?: boolean
  generated?: number
  push?: { domain: string; ok: boolean; posted?: number; patched?: number; deleted?: number; changes?: { added: string[]; updated: string[]; deleted: string[] }; check?: { passed: number; total: number }; noop?: boolean; error?: string }
}
type PushOutcome = { domain: string; ok: boolean; posted?: number; patched?: number; deleted?: number; changes?: { added: string[]; updated: string[]; deleted: string[] }; check?: { passed: number; total: number }; noop?: boolean; error?: string }

export default function CloudflarePanel({ tokenSet: initialTokenSet, tokenMasked: initialTokenMasked }: { tokenSet: boolean; tokenMasked: string | null }) {
  const [tokenSet, setTokenSet] = useState(initialTokenSet)
  const [tokenMasked, setTokenMasked] = useState(initialTokenMasked)
  const [token, setToken] = useState('')
  const [zones, setZones] = useState<Zone[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [results, setResults] = useState<ItemResult[] | PushOutcome[] | null>(null)
  const [resultKind, setResultKind] = useState<'import' | 'pushall' | null>(null)

  async function saveToken(e: React.FormEvent) {
    e.preventDefault()
    if (!token.trim()) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/v1/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cfApiToken: token.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `保存失败（${res.status}）`)
      setToken('')
      setTokenSet(true)
      setTokenMasked(data.cfTokenMasked ?? '已保存')
      setMsg({ ok: true, text: 'Cloudflare Token 已加密保存，正在读取账号域名…' })
      await loadZones()
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : String(error) })
    } finally { setBusy(false) }
  }

  async function clearToken() {
    if (!window.confirm('清除已保存的 Cloudflare Token？')) return
    setBusy(true)
    try {
      const res = await fetch('/api/v1/settings', { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `清除失败（${res.status}）`)
      setTokenSet(false); setTokenMasked(null); setZones(null); setMsg({ ok: true, text: 'Cloudflare Token 已清除' })
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : String(error) })
    } finally { setBusy(false) }
  }

  const loadZones = useCallback(async () => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/v1/cloudflare/zones')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setZones([])
        setMsg({ ok: false, text: data.error ?? `拉取失败（${res.status}）` })
        return
      }
      setZones(data.zones ?? [])
      setMsg({
        ok: true,
        text: `Cloudflare 账号下共 ${data.zones?.length ?? 0} 个域名，其中 ${data.zones?.filter((z: Zone) => z.imported).length ?? 0} 个已在面板里`,
      })
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (initialTokenSet) void loadZones()
  }, [initialTokenSet, loadZones])

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function runImport(names: string[] | 'all') {
    setBusy(true)
    setMsg(null)
    setResults(null)
    try {
      const res = await fetch('/api/v1/cloudflare/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names, push: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? `失败（${res.status}）` })
        return
      }
      setResults(data.results ?? [])
      setResultKind('import')
      setMsg({
        ok: data.ok === data.total,
        text: `共 ${data.total} 个域：成功 ${data.ok}，失败 ${data.total - data.ok}（下方为明细）`,
      })
      await loadZones()
    } finally {
      setBusy(false)
    }
  }

  async function runPushAll() {
    setBusy(true)
    setMsg(null)
    setResults(null)
    try {
      const res = await fetch('/api/v1/cloudflare/push-all', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? `失败（${res.status}）` })
        return
      }
      setResults(data.results ?? [])
      setResultKind('pushall')
      setMsg({
        ok: data.ok === data.total,
        text: `${data.total} 个域：成功 ${data.ok}；新增 ${data.posted}，更新 ${data.patched}，清理 ${data.deleted}`,
      })
    } finally {
      setBusy(false)
    }
  }

  const connectionPanel = <section className="panel cf-connection-panel">
    <div className="section-title"><div><h2>账号连接</h2><p className="hint">使用最小权限 API Token 安全连接你的 Cloudflare 账号。</p></div><span className={'tag ' + (tokenSet ? 'ok' : '')}>{tokenSet ? `已连接 · ${tokenMasked ?? ''}` : '尚未连接'}</span></div>
    <section className="cf-token-guide" aria-labelledby="cf-token-guide-title">
      <div className="cf-token-guide-heading"><h3 id="cf-token-guide-title">获取 Cloudflare API Token</h3><a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">打开 Cloudflare Token 页面 ↗</a></div>
      <ol>
        <li>登录 Cloudflare，打开个人资料菜单并点「Profile」；进入个人资料页后，在左侧点「API Tokens」。</li>
        <li>在「User API Tokens」页面，点击右上角「+ Create Token」。</li>
        <li>在「Create API Token」页面的「Custom token」区域，点击「Get started」（卡片标题为「Create Custom Token」）。</li>
        <li>把「Permissions」第一行设为「Zone」→「Zone」→「Read」；如果已经这样显示，保持不动。</li>
        <li>点击「Permissions」下方的「Add more」新增第二行，选择「Zone」→「DNS」→「Edit」。</li>
        <li>在下方「Zone Resources」选择域名范围：只管理部分域名时，把「Include」右侧的「All zones」改为「Specific zone」并选中这些域名；要管理全部域名时，保持「All zones」。如果有多余的「Exclude」行，点行末的「×」删除。</li>
        <li>点击「Continue to summary」，检查权限和域名范围后点「Create Token」，并复制生成的 Token。</li>
      </ol>
      <p>把 Token 粘贴到下方输入框并连接。不要使用 Global API Key；Token 创建后可在 Cloudflare 随时撤销。</p>
    </section>
    <form onSubmit={saveToken}>
      <div className="form-row cf-token-row"><div className="field"><label htmlFor="cf-api-token">Cloudflare API Token</label><input id="cf-api-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={tokenSet ? '输入新 Token 以替换现有连接' : '粘贴 API Token'} /></div>{tokenSet && <button type="button" className="danger" onClick={clearToken} disabled={busy}>断开连接</button>}<button className="primary" type="submit" disabled={busy || !token.trim()}>{busy ? '处理中…' : tokenSet ? '更新 Token' : '连接 Cloudflare'}</button></div>
    </form>
    <p className="hint">Token 使用 AES-256-GCM 加密保存；留空不会覆盖当前凭据。</p>
    {msg && <div role="status" className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
  </section>

  if (!tokenSet) return <>{connectionPanel}<section className="panel"><h2>连接后可管理 Cloudflare 域名</h2><p className="hint">连接成功后，此处会列出账号中的域名，可导入到面板并生成、同步 MX、SPF、DKIM、DMARC 等邮件 DNS 记录。</p></section></>

  const pending = (zones ?? []).filter((z) => !z.imported)
  const allPendingSelected = pending.length > 0 && pending.every((z) => selected.has(z.name))

  return (
    <>
      {connectionPanel}
      <section className="panel">
        <div className="section-title">
          <h2>你的 Cloudflare 域名</h2>
          <span className="count">{(zones ?? []).length} 个</span>
        </div>
        <p className="hint">
          勾选域名 → 「导入并推送」会依次完成：面板建域 → 生成全套记录（MX/A/SPF/DKIM/DMARC/归属 TXT）→
          推送到 Cloudflare（幂等，重复点不会产生重复记录）。
        </p>

        {msg && <div className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}

        <div className="form-row" style={{ marginBottom: 12 }}>
          <button className="primary" onClick={() => runImport('all')} disabled={busy || pending.length === 0} type="button">
            {busy ? '处理中…' : `全部导入并推送（${pending.length} 个未导入）`}
          </button>
          <button
            onClick={() => runImport([...selected])}
            disabled={busy || selected.size === 0}
            type="button"
          >
            导入并推送所选（{selected.size}）
          </button>
          <button onClick={loadZones} disabled={busy} type="button">
            刷新列表
          </button>
        </div>

        {zones === null ? (
          <p className="empty">拉取中…</p>
        ) : zones.length === 0 ? (
          <p className="empty">账号下没有可见的域名（检查 Token 权限：Zone → DNS → Edit，或该域不在此账号）</p>
        ) : (
          <div className="table-scroll"><table className="grid">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={allPendingSelected}
                    onChange={(e) => {
                      const next = new Set(selected)
                      for (const z of pending) {
                        if (e.target.checked) next.add(z.name)
                        else next.delete(z.name)
                      }
                      setSelected(next)
                    }}
                    title="全选未导入的域"
                  />
                </th>
                <th>域名</th>
                <th>CF 状态</th>
                <th>面板</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(z.name)}
                      onChange={() => toggle(z.name)}
                    />
                  </td>
                  <td className="mono">{z.name}</td>
                  <td>
                    <span className={'tag ' + (z.status === 'active' ? 'ok' : '')}>{z.status}</span>
                  </td>
                  <td>
                    {z.imported ? (
                      <span className="tag ok">已导入</span>
                    ) : (
                      <span className="hint-text">未导入</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      <section className="panel">
          <h2>批量同步已建域名</h2>
        <p className="hint">
          面板里已建的所有域（含逐个手工建的）重新生成并推送一次；适合改了设置（DMARC/SPF/进阶记录）后统一刷新。
        </p>
        <div className="form-row">
          <button className="primary" onClick={runPushAll} disabled={busy} type="button">
            {busy ? '推送中…' : '把全部域推送到 Cloudflare'}
          </button>
        </div>
      </section>

      {results && (
        <section className="panel">
          <h2>结果明细</h2>
          <table className="grid">
            <thead>
              <tr>
                <th>域名</th>
                {resultKind === 'import' && <th>建域</th>}
                {resultKind === 'import' && <th>生成</th>}
                <th>推送</th>
                <th>明细</th>
              </tr>
            </thead>
            <tbody>
              {(results as Array<ItemResult & PushOutcome>).map((r) => {
                const p = r.push ?? r
                const ok = p?.ok !== false
                const domainName = r.name ?? p?.domain ?? '—'
                return (
                  <tr key={`${resultKind}-${domainName}`}>
                    <td className="mono">{domainName}</td>
                    {resultKind === 'import' && <td>{r.created ? '新建' : '已存在'}</td>}
                    {resultKind === 'import' && <td>{r.generated ?? '—'}</td>}
                    <td>
                      <span className={'tag ' + (ok ? 'ok' : 'err')}>{ok ? '成功' : '失败'}</span>
                    </td>
                    <td className="hint-text">
                      {ok ? <>
                        <div>{p?.noop ? '记录已是最新' : `新增 ${p?.posted ?? 0} / 更新 ${p?.patched ?? 0} / 清理 ${p?.deleted ?? 0}`}</div>
                        {p?.changes?.updated.map((item) => <div key={`updated-${item}`}>更新：{item}</div>)}
                        {p?.changes?.added.map((item) => <div key={`added-${item}`}>新增：{item}</div>)}
                        {p?.changes?.deleted.map((item) => <div key={`deleted-${item}`}>清理：{item}</div>)}
                        {p?.check && <div>公网 DNS 检查：{p.check.passed}/{p.check.total} 项通过{p.check.passed < p.check.total ? '；解析器可能仍缓存旧记录，稍后重检即可，无需再次推送' : ''}</div>}
                      </> : p?.error}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}
