'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import NavLogout from '@/app/nav-logout'
import { checkForUpdates, useUpdateStatus } from '@/lib/update-client'

type NavItem = { href: string; label: string; icon: string; status?: string }
const GROUPS: Array<{ title: string; links: NavItem[] }> = [
  { title: '环境配置', links: [
    { href: '/cloudflare', label: 'Cloudflare 连接', icon: 'cloud', status: 'cloudflare' },
    { href: '/domains', label: '域名配置', icon: 'globe', status: 'domains' },
    { href: '/panel-settings', label: '面板与主机', icon: 'sliders' },
    { href: '/environment', label: 'DNS 与 TLS', icon: 'certificate', status: 'setup' },
  ] },
  { title: '检查环境', links: [
    { href: '/environment-check', label: '环境检查', icon: 'check', status: 'overall' },
    { href: '/monitor/deliverability', label: '投递检查', icon: 'pulse' },
  ] },
  { title: '邮箱账户', links: [
    { href: '/mailboxes', label: '邮箱账户', icon: 'mail' },
    { href: '/mail-settings', label: '全局邮箱设置', icon: 'sliders' },
    { href: '/webmail', label: 'Webmail', icon: 'inbox' },
    { href: '/routing', label: '别名与转发', icon: 'route' },
  ] },
  { title: '高级设置', links: [
    { href: '/updates', label: '更新与重启', icon: 'refresh' },
    { href: '/manual-dns', label: '手动 DNS', icon: 'globe' },
    { href: '/settings', label: '高级参数', icon: 'sliders' },
    { href: '/monitor/spam', label: '反垃圾', icon: 'shield' },
    { href: '/monitor/queue', label: '队列与日志', icon: 'pulse' },
    { href: '/api-docs', label: 'API 文档', icon: 'code' },
  ] },
]

function Icon({ name }: { name: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}>
    {name === 'cloud' && <><path d="M7 18h10a4 4 0 0 0 .4-8A5.7 5.7 0 0 0 6.5 9.3 4.4 4.4 0 0 0 7 18Z"/><path d="m9 13 3-3 3 3m-3-3v7"/></>}
    {name === 'globe' && <><circle cx="12" cy="12" r="9"/><path d="M3.5 12h17M12 3c2.3 2.4 3.4 5.4 3.4 9s-1.1 6.6-3.4 9c-2.3-2.4-3.4-5.4-3.4-9S9.7 5.4 12 3Z"/></>}
    {name === 'pulse' && <path d="M3 12h4l2.4-6 4.2 12 2.4-6H21"/>}
    {name === 'refresh' && <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.5-2L20 8M4 16l2.4 3A7 7 0 0 0 18 17"/></>}
    {name === 'shield' && <><path d="M12 3 20 6v5c0 5-3.2 8.2-8 10-4.8-1.8-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-4"/></>}
    {name === 'check' && <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>}
    {name === 'mail' && <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></>}
    {name === 'inbox' && <><path d="M4 5h16l2 11v4H2v-4L4 5Z"/><path d="M2 16h6l1.5 2h5L16 16h6"/></>}
    {name === 'route' && <><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h4a4 4 0 0 1 4 4v6M6 8v11h8"/></>}
    {name === 'sliders' && <><path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></>}
    {name === 'code' && <path d="m8 8-4 4 4 4m8-8 4 4-4 4m-2-10-4 12"/>}
    {name === 'certificate' && <><path d="M7 3.5h7l4 4v7.2a5 5 0 1 1-10 0V3.5Z"/><path d="M14 3.8v4h4M10 11h5m-5 3h3"/><path d="m10.2 18-1 3 2.8-1.5 2.8 1.5-1-3"/></>}
  </svg>
}

function Status({ value }: { value?: boolean }) {
  if (value === undefined) return null
  return <span className={`nav-health ${value ? 'is-ok' : 'is-error'}`} title={value ? '已完成' : '待处理'} aria-label={value ? '已完成' : '待处理'} />
}

function Chevron({ className }: { className?: string }) {
  return <svg className={className} aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m13.5 3-7 7 7 7"/></svg>
}

export function Nav({ username }: { username: string }) {
  const pathname = usePathname()
  const update = useUpdateStatus()
  const hasUpdate = update.result?.status === 'available'
  useEffect(() => { void checkForUpdates() }, [])
  const [collapsed, setCollapsed] = useState(false)
  const [navigationReady, setNavigationReady] = useState(false)
  const [health, setHealth] = useState<Record<string, boolean>>({})
  useEffect(() => {
    try { setCollapsed(localStorage.getItem('clover-nav-collapsed') === 'true') } catch { /* Storage is optional. */ }
    setNavigationReady(true)
  }, [])
  function toggleNavigation() {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem('clover-nav-collapsed', String(next)) } catch { /* Storage is optional. */ }
  }
  useEffect(() => {
    let live = true
    fetch('/api/v1/system/environment', { cache: 'no-store' })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!live || !data?.steps) return
        const next: Record<string, boolean> = Object.fromEntries(data.steps.map((step: { key: string; ok: boolean }) => [step.key, step.ok]))
        next.setup = Boolean(next.dns && next['panel-tls'] && next['mail-tls'])
        next.overall = data.steps.every((step: { ok: boolean }) => step.ok)
        setHealth(next)
      }).catch(() => undefined)
    return () => { live = false }
  }, [pathname])

  const activeFor = (href: string) => href === '/domains'
    ? pathname === href || pathname.startsWith('/domains/')
    : pathname === href || pathname.startsWith(`${href}/`)

  return <>
    <aside id="panel-navigation" className="app-sidebar" data-collapsed={collapsed}>
      <div className="sidebar-brand">
        <Link href="/" className="brand-lockup" aria-label="Clover 首页"><img src="/icon.svg" alt="" className="brand-icon"/><span><b>clover</b><small>三叶草邮局</small></span></Link>
        <button type="button" className="nav-brand-toggle" onClick={toggleNavigation} aria-label={collapsed ? '展开管理导航' : '收起管理导航'} title={collapsed ? '展开管理导航' : '收起管理导航'} aria-controls="panel-navigation-menu" aria-expanded={!collapsed} disabled={!navigationReady}><Chevron/>{collapsed && hasUpdate && <span className="nav-edge-update" role="img" aria-label="有新版本可更新"/>}</button>
      </div>
      <nav id="panel-navigation-menu" aria-label="主导航" className="sidebar-nav" inert={collapsed} aria-hidden={collapsed}>{GROUPS.map((group) => <section key={group.title} className="nav-group" style={{ flexGrow: group.links.length }}>
        <h2 className="nav-heading">{group.title}</h2><div className="nav-items">{group.links.map((item) => {
          const active = activeFor(item.href)
          return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
            className={`nav-link ${active ? 'is-active' : ''}`}>
            <span className="nav-icon"><Icon name={item.icon}/></span><span className="nav-label">{item.label}</span>{item.href === '/updates' && hasUpdate && <span className="nav-update-badge">有更新</span>}<Status value={item.status ? health[item.status] : undefined}/>
          </Link>
        })}</div></section>)}</nav>
      <div className="sidebar-account" inert={collapsed} aria-hidden={collapsed}><span className="account-avatar" aria-hidden="true">{username.slice(0, 1).toUpperCase()}</span><span className="account-details"><span className="account-name" title={username}>{username}</span><span className="account-role">管理员</span></span><NavLogout/></div>
    </aside>
    <header className="mobile-header" data-collapsed={collapsed}>
      <div className="mobile-brand"><Link href="/" aria-label="Clover 首页"><img src="/icon.svg" alt="" className="brand-icon"/></Link><b>clover</b><span className="mobile-user" title={username}>{username}</span><NavLogout/><button type="button" className="mobile-nav-toggle" onClick={toggleNavigation} aria-label={collapsed ? '展开管理导航' : '收起管理导航'} title={collapsed ? '展开管理导航' : '收起管理导航'} aria-controls="panel-mobile-navigation" aria-expanded={!collapsed} disabled={!navigationReady}><Chevron/>{collapsed && hasUpdate && <span className="nav-edge-update" role="img" aria-label="有新版本可更新"/>}</button></div>
      <nav id="panel-mobile-navigation" aria-label="主导航" className="mobile-nav" hidden={collapsed}>{GROUPS.map((group) => {
        const groupActive = group.links.some((item) => activeFor(item.href))
        return <details key={group.title} name="clover-mobile-menu" className={`mobile-nav-group ${groupActive ? 'is-active' : ''}`}><summary>{group.title}{group.title === '高级设置' && hasUpdate && <span className="nav-update-dot" role="img" aria-label="有新版本可更新"/>}<Chevron className="mobile-group-chevron"/></summary>
          <div className="mobile-nav-items">{group.links.map((item) => {
            const active = activeFor(item.href)
            return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={`mobile-nav-link ${active ? 'is-active' : ''}`} onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}>
              <Icon name={item.icon}/>{item.label}{item.href === '/updates' && hasUpdate && <span className="nav-update-badge">有更新</span>}<Status value={item.status ? health[item.status] : undefined}/>
            </Link>
          })}</div></details>
      })}</nav>
    </header>
  </>
}
