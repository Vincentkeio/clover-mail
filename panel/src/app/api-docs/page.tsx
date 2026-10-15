import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

type Endpoint = { method: string; path: string; desc: string; sample?: string }

const GROUPS: Array<{ title: string; note?: string; endpoints: Endpoint[] }> = [
  {
    title: '域名',
    endpoints: [
      { method: 'GET', path: '/api/v1/domains', desc: '域名列表（含邮箱/规则计数）' },
      {
        method: 'POST',
        path: '/api/v1/domains',
        desc: '建域；body: {"name":"example.com","quotaPolicyMb"?:number}。邮件主机名统一从安装配置读取。',
        sample: `curl -X POST https://面板域名/api/v1/domains \\
  -H "Authorization: Bearer clover_xxx" -H 'Content-Type: application/json' \\
  -d '{"name":"example.com"}'`,
      },
      { method: 'GET', path: '/api/v1/domains/{id}', desc: '域详情（含邮箱与规则）' },
      { method: 'PATCH', path: '/api/v1/domains/{id}', desc: '更新域配额与启用状态；邮件主机名由安装配置统一管理。' },
      { method: 'DELETE', path: '/api/v1/domains/{id}', desc: '删域；级联清理 DMS 账号与 alias' },
    ],
  },
  {
    title: '邮箱',
    endpoints: [
      { method: 'GET', path: '/api/v1/domains/{id}/mailboxes', desc: '某域的邮箱列表' },
      {
        method: 'POST',
        path: '/api/v1/domains/{id}/mailboxes',
        desc: '建邮箱；body: {"login":"a@example.com","password":"≥10位","quotaMb"?:number}',
      },
      { method: 'PATCH', path: '/api/v1/mailboxes/{id}', desc: '改密 / 配额 / 停用' },
      { method: 'DELETE', path: '/api/v1/mailboxes/{id}', desc: '删邮箱（DMS 同步清理）' },
    ],
  },
  {
    title: '路由规则（四类）',
    endpoints: [
      { method: 'GET', path: '/api/v1/domains/{id}/rules', desc: '规则列表' },
      {
        method: 'POST',
        path: '/api/v1/domains/{id}/rules',
        desc: 'matchType: exact|prefix|nonuser|catchall；targets 逗号分隔或数组；priority 越小越优先',
        sample: `curl -X POST https://面板域名/api/v1/domains/1/rules \\
  -H "Authorization: Bearer clover_xxx" -H 'Content-Type: application/json' \\
  -d '{"matchType":"catchall","targets":"me@gmail.com"}'`,
      },
      { method: 'PATCH', path: '/api/v1/rules/{id}', desc: '更新 targets / priority / active' },
      { method: 'DELETE', path: '/api/v1/rules/{id}', desc: '删规则（DMS alias 与 prefix 正则表同步）' },
    ],
  },
  {
    title: 'DNS（Cloudflare）',
    endpoints: [
      { method: 'GET', path: '/api/v1/domains/{id}/dns', desc: '记录列表 + 生成预览 + 上次检测结果' },
      { method: 'POST', path: '/api/v1/domains/{id}/dns', desc: '生成 / 刷新 DNS 记录（入库）' },
      {
        method: 'POST',
        path: '/api/v1/domains/{id}/dns/push',
        desc: '推送到 Cloudflare（diff → batch，幂等）',
        sample: `curl -X POST https://面板域名/api/v1/domains/1/dns/push \\
  -H "Authorization: Bearer clover_xxx"`,
      },
      { method: 'POST', path: '/api/v1/domains/{id}/dns/check', desc: '公网 DoH 检测 checklist' },
      { method: 'GET', path: '/api/v1/domains/{id}/dns/export?format=bind|text', desc: '导出 BIND / TXT（均可导入 DNS）' },
      { method: 'GET', path: '/api/v1/dns/preview?domain=example.com', desc: '建域前的记录预览' },
    ],
  },
  {
    title: '监控与系统',
    endpoints: [
      { method: 'GET', path: '/api/v1/system/spam-stats', desc: 'rspamd 统计（符号 TopN / 动作分布）' },
      { method: 'GET', path: '/api/v1/system/queue?lines=200', desc: '队列 + 服务进程 + 日志尾部' },
      { method: 'GET', path: '/api/v1/system/deliverability', desc: 'DNSBL 黑名单 + 域健康体检' },
      {
        method: 'POST',
        path: '/api/v1/system/reconcile',
        desc: '对账；body {"heal":true} 才自动修复',
        sample: `curl -X POST https://面板域名/api/v1/system/reconcile \\
  -H "Authorization: Bearer clover_xxx" -H 'Content-Type: application/json' -d '{"heal":false}'`,
      },
      { method: 'GET', path: '/api/v1/system/backup?what=db|dms-config', desc: '下载一致性备份（SQLite 快照 / DMS 配置 tar）' },
      { method: 'GET', path: '/api/v1/system/tokens', desc: 'API token 列表' },
      { method: 'POST', path: '/api/v1/system/tokens', desc: '创建 token（明文仅返回一次）' },
      { method: 'DELETE', path: '/api/v1/system/tokens?id=1', desc: '吊销 token' },
    ],
  },
  {
    title: 'Cloudflare 连接（填一次 Token，批量管理 DNS）',
    endpoints: [
      { method: 'GET', path: '/api/v1/cloudflare/zones', desc: '列出 Token 可见的全部域名（zone），标注是否已导入面板' },
      {
        method: 'POST',
        path: '/api/v1/cloudflare/import',
        desc: '批量导入：body {"names":["a.com"] | "all", "push":true} → 建域 + 生成记录 + 推送',
        sample: `# 把 CF 账号下所有域名一次性导入并配好 DNS
curl -X POST https://面板域名/api/v1/cloudflare/import \\
  -H "Authorization: Bearer clover_xxx" -H 'Content-Type: application/json' \\
  -d '{"names":"all","push":true}'`,
      },
      { method: 'POST', path: '/api/v1/cloudflare/push-all', desc: '把面板内所有已建域重新生成并推送（幂等）' },
    ],
  },
  {
    title: '设置',
    endpoints: [
      { method: 'GET', path: '/api/v1/settings', desc: '读取面板设置（敏感值脱敏）' },
      { method: 'PATCH', path: '/api/v1/settings', desc: '更新面板参数与全局邮箱策略（协议、远程内容和附件限制）' },
      { method: 'POST', path: '/api/v1/settings', desc: 'CF token 连通性自检（body {"domain":"example.com"}）' },
      { method: 'DELETE', path: '/api/v1/settings', desc: '清除 CF Token' },
      { method: 'GET', path: '/api/health', desc: '健康检查（无需认证）' },
    ],
  },
]

export default async function ApiDocsPage() {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/login')

  return (
    <main className="wrap">
      <div className="topbar">
        <span className="logo">🍀</span>
        <h1>API 文档</h1>
        <span className="tag">面板即 API</span>
      </div>

      <section className="panel">
        <h2>认证</h2>
        <p className="hint">
          所有 <span className="mono">/api/v1/*</span> 端点支持两种认证：面板登录 session cookie，
          或开放 API token ——
          <span className="mono"> Authorization: Bearer clover_…</span>（在「设置 → 开放 API Token」生成）。
          Token 等同于管理员凭证，请像密码一样保管；吊销即刻生效。
        </p>
        <p className="hint">
          响应均为 JSON；错误格式 <span className="mono">{'{ "error": "描述" }'}</span>；
          常用状态码：400 参数错误 · 401 未认证 · 404 不存在 · 409 冲突（重复）· 422 语义不合法 · 502 上游（DMS/CF）失败。
          一切变更都会写审计日志（actor 记为 <span className="mono">api:&lt;token 名&gt;</span>）。
        </p>
      </section>

      {GROUPS.map((g) => (
        <section className="panel" key={g.title}>
          <h2>{g.title}</h2>
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 70 }}>方法</th>
                <th>路径</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {g.endpoints.map((e) => (
                <tr key={e.method + e.path}>
                  <td>
                    <span
                      className={
                        'tag ' +
                        (e.method === 'GET' ? 'ok' : e.method === 'DELETE' ? 'err' : 'warn')
                      }
                    >
                      {e.method}
                    </span>
                  </td>
                  <td className="mono">{e.path}</td>
                  <td className="hint-text">{e.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {g.endpoints.some((e) => e.sample) && (
            <pre className="services">
              {g.endpoints
                .filter((e) => e.sample)
                .map((e) => `# ${e.desc}\n${e.sample}`)
                .join('\n\n')}
            </pre>
          )}
        </section>
      ))}

      <p className="hint">
        <Link href="/settings">← 去生成 API token</Link>
      </p>
    </main>
  )
}
