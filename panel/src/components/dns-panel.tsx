'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/types';

/**
 * 域名 DNS 面板（M2）
 *
 * 功能：记录预览（逐条可禁用=不推送）、重新检测（checklist 打勾）、
 * 推送到 Cloudflare/DNSPod、导出 BIND zone、推送结果明细。
 */

export type DnsPanelRecord = {
  id: number;
  type: string;
  name: string;
  content: string;
  ttl: number;
  priority: number | null;
  status: string;
  comment: string | null;
  cfRecordId: string | null;
};

type Spec = {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  priority?: number | null;
  proxied: boolean;
  comment: string;
  group: string;
  label: string;
};

type DnsData = {
  desired: Spec[];
  dbRecords: DnsPanelRecord[];
  remote: { provider: string; error?: string } | { provider: string; records: unknown[] } | null;
  diff: { create: number; update: number; unchanged: number; deleteOnly: number } | null;
  dkimKeyPresent: boolean;
  dnsStatus: Record<string, boolean>;
  credentials: { cloudflare: boolean; dnspod: boolean };
  defaultProvider: string;
  vpsIp: string;
};

type PushResult = {
  pushed: { created: number; updated: number; deleted: number };
  errors: string[];
  bindZone?: string;
};

const CHECKLIST: Array<{ key: string; label: MessageKey }> = [
  { key: 'ownership', label: 'dns.checklist.ownership' },
  { key: 'mx', label: 'dns.checklist.mx' },
  { key: 'spf', label: 'dns.checklist.spf' },
  { key: 'dkim', label: 'dns.checklist.dkim' },
  { key: 'dmarc', label: 'dns.checklist.dmarc' },
];

const PROVIDER_LABELS: Record<string, string> = {
  cloudflare: 'Cloudflare',
  dnspod: 'DNSPod',
  manual: 'manual',
};

type Props = {
  domainId: number;
  domainName: string;
  vpsIp: string;
  mailHostname: string;
  ownershipToken: string;
  dkimKeyPresent: boolean;
  initialRecords: DnsPanelRecord[];
  cfConfigured: boolean;
};

export function DnsPanel({
  domainId,
  domainName,
  vpsIp,
  mailHostname,
  ownershipToken,
  dkimKeyPresent,
  initialRecords,
  cfConfigured,
}: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const [data, setData] = useState<DnsData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState<PushResult | null>(null);
  const [checklist, setChecklist] = useState<Record<string, boolean> | null>(null);
  const [bindZone, setBindZone] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function load() {
    setLoadError('');
    try {
      const res = await fetch(`/api/domains/${domainId}/dns`);
      const d = (await res.json().catch(() => null)) as DnsData | null;
      if (!res.ok || !d) {
        setLoadError(t('dns.loadFailed'));
        return;
      }
      setData(d);
      setChecklist(d.dnsStatus);
    } catch (err) {
      setLoadError(String(err));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainId]);

  function toggle(specId: string) {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(specId)) next.delete(specId);
      else next.add(specId);
      return next;
    });
  }

  async function push(provider: string) {
    setBusy(provider);
    setMsg('');
    setResult(null);
    setBindZone('');
    try {
      const res = await fetch(`/api/domains/${domainId}/dns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, disabled: [...disabled] }),
      });
      const d = (await res.json().catch(() => ({}))) as PushResult & { error?: string };
      if (!res.ok) {
        setMsg(d.error || t('dns.pushFailed', { status: res.status }));
        return;
      }
      setResult(d);
      if (d.bindZone) setBindZone(d.bindZone);
      setMsg(provider === 'manual' ? t('dns.bindZoneReady') : t('dns.pushDone'));
      await load();
      router.refresh();
    } catch (err) {
      setMsg(String(err));
    } finally {
      setBusy('');
    }
  }

  async function verify() {
    setBusy('verify');
    setMsg('');
    try {
      const res = await fetch(`/api/domains/${domainId}/dns/verify`, { method: 'POST' });
      const d = (await res.json().catch(() => ({}))) as { dnsStatus?: Record<string, boolean>; error?: string };
      if (!res.ok || !d.dnsStatus) {
        setMsg(d.error || t('dns.checkFailed', { status: res.status }));
        return;
      }
      setChecklist(d.dnsStatus);
      setMsg(t('dns.checkDone'));
      router.refresh();
    } catch (err) {
      setMsg(String(err));
    } finally {
      setBusy('');
    }
  }

  const creds = data?.credentials ?? { cloudflare: cfConfigured, dnspod: false };
  const dbRecords = data?.dbRecords ?? initialRecords;

  function statusOf(spec: Spec): DnsPanelRecord | undefined {
    return dbRecords.find((r) => r.type === spec.type && r.name === spec.name && r.comment === spec.comment);
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {loadError}
        <button onClick={load} className="ml-3 text-xs underline">
          {t('common.retry')}
        </button>
      </div>
    );
  }

  const desired = data?.desired ?? null;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-emerald-200 bg-white">
        <div className="flex flex-col gap-5 bg-emerald-50/70 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div className="max-w-xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-800">
              <span className="h-2 w-2 rounded-full bg-emerald-600" />{t('dns.cloudflareRecommended')}
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">{t('dns.autoConfigTitle')}</h2>
            <p className="mt-1.5 text-sm leading-6 text-slate-600">{t('dns.autoConfigDesc')}</p>
            {!vpsIp && <p className="mt-2 text-xs text-amber-800">{t('dns.vpsIpMissing')}</p>}
            {msg && <p role="status" className="mt-3 text-sm font-medium text-emerald-800">{msg}</p>}
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            {creds.cloudflare ? (
              <button type="button" onClick={() => push('cloudflare')} disabled={!!busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-emerald-700 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60">
                {busy === 'cloudflare' ? t('dns.syncing') : t('dns.pushToCloudflare')}
                {busy !== 'cloudflare' && <span aria-hidden="true">→</span>}
              </button>
            ) : (
              <a href="/settings" className="inline-flex min-h-12 items-center justify-center rounded-md bg-emerald-700 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2">{t('dns.connectCloudflare')}</a>
            )}
            <span className="text-xs text-slate-500">{creds.cloudflare ? t('dns.idempotentHint') : t('dns.addTokenHint')}</span>
          </div>
        </div>
        <div className="border-t border-emerald-100 px-5 py-4 sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">{t('dns.checkTitle')}</h3>
              <p className="mt-0.5 text-xs text-slate-500">{t('dns.checkDesc')}</p>
            </div>
            <button type="button" onClick={verify} disabled={busy === 'verify'} className="min-h-10 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50">
              {busy === 'verify' ? t('dns.checking') : t('dns.recheck')}
            </button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {CHECKLIST.map((c) => {
              const ok = checklist?.[c.key] === true;
              return <div key={c.key} className={`flex min-h-10 items-center gap-2 rounded-md border px-3 text-xs font-medium ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                <span aria-hidden="true" className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${ok ? 'bg-emerald-700 text-white' : 'border border-slate-400 text-slate-500'}`}>{ok ? '✓' : '·'}</span>{t(c.label)}
              </div>;
            })}
          </div>
          {!dkimKeyPresent && <p className="mt-3 text-xs text-slate-500">{t('dns.dkimKeyHint')}</p>}
        </div>
      </section>

      {data?.remote && 'error' in data.remote && data.remote.error && <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('dns.remoteError', { provider: PROVIDER_LABELS[data.remote.provider] ?? data.remote.provider, error: data.remote.error })}</div>}
      {data?.diff && <p className="text-xs text-slate-500">{t('dns.diffSummary', { create: data.diff.create, update: data.diff.update, unchanged: data.diff.unchanged, deleteOnly: data.diff.deleteOnly })}</p>}
      {result && <div role="status" className="space-y-1 rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700"><p>{t('dns.pushResult', { created: result.pushed.created, updated: result.pushed.updated, deleted: result.pushed.deleted })}</p>{result.errors.length > 0 && <div className="text-red-700"><p className="font-medium">{t('dns.errorCount', { count: result.errors.length })}</p><ul className="mt-1 list-inside list-disc">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}</div>}

      <div className="border-t border-slate-200 pt-4">
        <button type="button" aria-expanded={showAdvanced} aria-controls="dns-advanced" onClick={() => setShowAdvanced((value) => !value)} className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
          <span aria-hidden="true" className="text-xs">{showAdvanced ? '▾' : '▸'}</span>{showAdvanced ? t('dns.advancedHide') : t('dns.advancedShow')}<span className="text-xs font-normal text-slate-500">{t('dns.advancedSummary')}</span>
        </button>
      </div>

      {showAdvanced && <div id="dns-advanced" className="space-y-5">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-900">{t('dns.otherProviders')}</h3>
          <p className="mt-1 text-sm text-slate-500">{t('dns.otherProvidersDesc')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => push('dnspod')} disabled={!!busy || !creds.dnspod} title={creds.dnspod ? '' : t('dns.dnspodHint')} className="min-h-10 rounded-md border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">{busy === 'dnspod' ? t('dns.pushing') : t('dns.pushToDnspod')}</button>
            <button type="button" onClick={() => push('manual')} disabled={!!busy} className="min-h-10 rounded-md border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">{busy === 'manual' ? t('dns.generating') : t('dns.generateManual')}</button>
          </div>
        </section>
        {bindZone && <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-800">{t('dns.bindZoneTitle')}</h3><button type="button" onClick={() => navigator.clipboard?.writeText(bindZone).catch(() => {})} className="min-h-9 rounded border border-slate-200 px-3 text-xs text-slate-600 hover:bg-slate-50">{t('common.copy')}</button></div>
          <pre className="max-h-72 overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-700">{bindZone}</pre>
        </section>}

      {/* 手动记录控制 */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">{t('dns.recordsTitle')}</h2>
          <p className="mt-1 text-xs text-slate-500">{t('dns.recordsHint', { domain: domainName, target: vpsIp || t('dns.vpsIpNotConfigured') })}</p>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500">
              <th className="px-5 py-3 font-medium">{t('dns.colSync')}</th>
              <th className="px-5 py-3 font-medium">{t('dns.colType')}</th>
              <th className="px-5 py-3 font-medium">{t('common.name')}</th>
              <th className="px-5 py-3 font-medium">{t('dns.colValue')}</th>
              <th className="px-5 py-3 font-medium">{t('dns.colComment')}</th>
              <th className="px-5 py-3 font-medium">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {!desired ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-gray-400">
                  {t('common.loading')}
                </td>
              </tr>
            ) : desired.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-gray-400">
                  {t('dns.noRecords')}
                </td>
              </tr>
            ) : (
              desired.map((r) => {
                const row = statusOf(r);
                return (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-5 py-2.5">
                      <input
                        type="checkbox"
                        checked={!disabled.has(r.id)}
                        onChange={() => toggle(r.id)}
                        title={t('dns.uncheckTitle')}
                        className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                      />
                      <span className="sr-only">{t('dns.syncRecordAria', { type: r.type, name: r.name })}</span>
                    </td>
                    <td className="px-5 py-2.5 font-medium text-gray-900">{r.type}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-gray-700">{r.name}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-gray-600 break-all">
                      {r.type === 'MX' && r.priority != null ? `${r.content} (${r.priority})` : r.content}
                    </td>
                    <td className="px-5 py-2.5 text-gray-400">{r.label}</td>
                    <td className="px-5 py-2.5">
                      {disabled.has(r.id) ? (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{t('dns.statusDisabled')}</span>
                      ) : row?.status === 'pushed' ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">{t('dns.statusPushed')}</span>
                      ) : row?.status === 'error' ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">{t('dns.statusFailed')}</span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{t('dns.statusPending')}</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
        {t('dns.nameFormatNote', { hostname: mailHostname })}<span className="font-mono text-slate-800">{ownershipToken}</span>
      </div>
      </div>}
    </div>
  );
}
