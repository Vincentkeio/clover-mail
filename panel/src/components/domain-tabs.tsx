'use client';

import { useState } from 'react';

const TABS = [
  { id: 'dns', label: 'DNS 配置', description: '生成、同步与检查' },
  { id: 'mailboxes', label: '邮箱', description: '此域账户' },
  { id: 'rules', label: '邮件转发', description: '别名与路由规则' },
] as const;

export function DomainTabs({ mailboxes, rules, dns, initialTab = 'dns' }: { mailboxes: React.ReactNode; rules: React.ReactNode; dns: React.ReactNode; initialTab?: 'mailboxes' | 'dns' | 'rules' }) {
  const [active, setActive] = useState<(typeof TABS)[number]['id']>(initialTab);
  const panels = { mailboxes, dns, rules };
  function onTabKey(event: React.KeyboardEvent<HTMLButtonElement>, id: (typeof TABS)[number]['id']) {
    const index = TABS.findIndex((tab) => tab.id === id);
    const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length
      : event.key === 'ArrowLeft' ? (index - 1 + TABS.length) % TABS.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setActive(TABS[next].id);
    document.getElementById(`domain-tab-${TABS[next].id}`)?.focus();
  }
  return <div className="domain-tabs">
    <div role="tablist" aria-label="域名管理" className="domain-tabs-list">
      {TABS.map((tab) => <button key={tab.id} id={`domain-tab-${tab.id}`} type="button" role="tab" aria-selected={active === tab.id} aria-controls="domain-tab-panel" tabIndex={active === tab.id ? 0 : -1} onClick={() => setActive(tab.id)} onKeyDown={(event) => onTabKey(event, tab.id)} className={`domain-tab ${active === tab.id ? 'is-active' : ''}`}><span>{tab.label}</span><small>{tab.description}</small></button>)}
    </div>
    <section id="domain-tab-panel" role="tabpanel" aria-labelledby={`domain-tab-${active}`} className="domain-tab-panel">{panels[active]}</section>
  </div>;
}
