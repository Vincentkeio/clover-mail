'use client'

import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n/client'

type Service = { name: string; status: string; detail?: string }
type QueueEntry = { queueId: string; size: string; arrivalTime: string; sender: string; recipients: string[] }
type LogLine = { time: string; host: string; service: string; message: string }

type QueueData = {
  reachable: boolean
  queue: { empty: boolean; entries: QueueEntry[]; error?: string }
  services: { reachable: boolean; services: Service[] }
  logs: { reachable: boolean; lines: LogLine[]; error?: string }
  error?: string
}

export default function QueueMonitorPage() {
  const { t } = useI18n()
  const [data, setData] = useState<QueueData | null>(null)
  const [tab, setTab] = useState<'queue' | 'logs'>('queue')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/system/queue?lines=200')
      if (res.ok) setData(await res.json())
    } catch {
      /* 保持上一次数据 */
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 5_000)
    return () => clearInterval(timer)
  }, [load])

  const services = data?.services?.services ?? []
  const downServices = services.filter((s) => s.status !== 'RUNNING')

  return (
    <main className="wrap">
      <div className="topbar">
        <span className="logo">🍀</span>
        <h1>{t('monitor.queueTitle')}</h1>
        <span className="tag">{t('monitor.autoRefresh5s')}</span>
      </div>

      {!data?.reachable && (
        <div className="banner">
          {t('monitor.dmsUnreachableQueue', { error: data?.error ?? t('monitor.dockerUnavailable') })}
        </div>
      )}

      <section className="panel">
        <div className="section-title">
          <h2>{t('monitor.servicesTitle')}</h2>
          <span className="count">
            {services.filter((s) => s.status === 'RUNNING').length}/{services.length || '—'} RUNNING
          </span>
        </div>
        {services.length > 0 ? (
          <table className="grid">
            <thead>
              <tr>
                <th>{t('monitor.colProcess')}</th>
                <th>{t('common.status')}</th>
                <th>{t('monitor.colDetail')}</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.name}>
                  <td className="mono">{s.name}</td>
                  <td>
                    <span className={'tag ' + (s.status === 'RUNNING' ? 'ok' : 'err')}>{s.status}</span>
                  </td>
                  <td className="hint-text">{s.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">{t('monitor.noServices')}</p>
        )}
        {downServices.length > 0 && (
          <p className="msg err">{t('monitor.downServices', { count: downServices.length, names: downServices.map((s) => s.name).join(', ') })}</p>
        )}
      </section>

      <div className="form-row" style={{ marginTop: 16 }}>
        <button className={tab === 'queue' ? 'primary' : ''} onClick={() => setTab('queue')} type="button">
          {t('monitor.queueTab', { count: data?.queue?.entries?.length ?? 0 })}
        </button>
        <button className={tab === 'logs' ? 'primary' : ''} onClick={() => setTab('logs')} type="button">
          {t('monitor.logsTab', { count: data?.logs?.lines?.length ?? 0 })}
        </button>
      </div>

      {tab === 'queue' ? (
        <section className="panel">
          {data?.queue?.empty ? (
            <p className="empty">{t('monitor.queueEmpty')}</p>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>{t('monitor.colQueueId')}</th>
                  <th>{t('monitor.colSize')}</th>
                  <th>{t('monitor.colArrivalTime')}</th>
                  <th>{t('monitor.colSender')}</th>
                  <th>{t('monitor.colRecipients')}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.queue?.entries ?? []).map((e) => (
                  <tr key={e.queueId}>
                    <td className="mono">{e.queueId}</td>
                    <td>{e.size}</td>
                    <td>{e.arrivalTime}</td>
                    <td className="mono">{e.sender}</td>
                    <td className="mono">{e.recipients.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : (
        <section className="panel">
          {(data?.logs?.lines?.length ?? 0) > 0 ? (
            <pre className="services">
              {(data?.logs?.lines ?? [])
                .slice()
                .reverse()
                .map((l, i) => (
                  <div key={i}>
                    <span className="hint-text">{[l.time, l.host].filter(Boolean).join(' ')}</span>{' '}
                    <b>{l.service}</b> {l.message}
                  </div>
                ))}
            </pre>
          ) : (
            <p className="empty">{t('monitor.noLogs')}</p>
          )}
        </section>
      )}
    </main>
  )
}
