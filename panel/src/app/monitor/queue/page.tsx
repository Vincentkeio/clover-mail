'use client'

import { useCallback, useEffect, useState } from 'react'

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
    const t = setInterval(() => void load(), 5_000)
    return () => clearInterval(t)
  }, [load])

  const services = data?.services?.services ?? []
  const downServices = services.filter((s) => s.status !== 'RUNNING')

  return (
    <main className="wrap">
      <div className="topbar">
        <span className="logo">🍀</span>
        <h1>队列与日志</h1>
        <span className="tag">5s 自动刷新</span>
      </div>

      {!data?.reachable && (
        <div className="banner">
          未连接到 DMS（队列/日志都要 docker exec 读容器）。部署到 VPS 后显示真实数据：
          {data?.error ?? 'docker 不可用'}
        </div>
      )}

      <section className="panel">
        <div className="section-title">
          <h2>服务进程</h2>
          <span className="count">
            {services.filter((s) => s.status === 'RUNNING').length}/{services.length || '—'} RUNNING
          </span>
        </div>
        {services.length > 0 ? (
          <table className="grid">
            <thead>
              <tr>
                <th>进程</th>
                <th>状态</th>
                <th>详情</th>
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
          <p className="empty">未获取到进程列表。</p>
        )}
        {downServices.length > 0 && (
          <p className="msg err">有 {downServices.length} 个进程未运行：{downServices.map((s) => s.name).join(', ')}</p>
        )}
      </section>

      <div className="form-row" style={{ marginTop: 16 }}>
        <button className={tab === 'queue' ? 'primary' : ''} onClick={() => setTab('queue')} type="button">
          邮件队列（{data?.queue?.entries?.length ?? 0}）
        </button>
        <button className={tab === 'logs' ? 'primary' : ''} onClick={() => setTab('logs')} type="button">
          实时日志（尾部 {data?.logs?.lines?.length ?? 0} 行）
        </button>
      </div>

      {tab === 'queue' ? (
        <section className="panel">
          {data?.queue?.empty ? (
            <p className="empty">队列为空——没有待投递邮件。</p>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>队列 ID</th>
                  <th>大小</th>
                  <th>入队时间</th>
                  <th>发件人</th>
                  <th>收件人</th>
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
            <p className="empty">暂无日志。</p>
          )}
        </section>
      )}
    </main>
  )
}
