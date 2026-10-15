import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { dnsRecords } from '@/db/schema'
import { DMS_CONFIG_DIR, DmsResult, dkim as dmsDkim, readContainerFile, syncDkimRuntime } from './dms'

/**
 * DMS 生成的 mail.txt 是 **DNS zone 片段**，不是裸值，例如：
 *   mail._domainkey	IN	TXT	( "v=DKIM1; h=sha256; k=rsa; "
 *   	  "p=MIIBIjANBgkqh..." )
 * 这里把引号内的分片拼成可直接下发的 TXT 值（实机核对过的格式）。
 */
export function parseDkimDnsValue(raw: string): string | null {
  const text = raw.trim()
  const chunks = text.match(/"([^"]*)"/g)
  if (chunks && chunks.length > 0) {
    const joined = chunks.map((c) => c.slice(1, -1)).join('')
    if (joined.startsWith('v=DKIM1')) return joined
  }
  const bare = text.split('\n')[0]?.trim() ?? ''
  if (bare.startsWith('v=DKIM1')) return bare
  return null
}

/**
 * DKIM 公钥解析（优先级从高到低）：
 * 1. DMS 容器内 /tmp/docker-mailserver/opendkim/keys/<domain>/mail.txt（zone 格式，需解析）
 * 2. 缺失（新域）→ 触发一次 `setup config dkim` 生成后再读（DMS 16 实机核对过的子命令）
 * 3. 库里已生成的 clover-dkim 记录（DMS 不可达时的离线/演示兜底）
 *
 * 第 3 级兜底是安全关键：缺失 DKIM 会让 push 把 CF 上已有的 DKIM 记录
 * 当成「废弃托管项」删掉。
 */
export async function resolveDkimPublicKey(domainId: number, domainName: string): Promise<string | null> {
  const fromDms = await dmsDkim.publicKey(domainName)
  if (fromDms.ok) {
    const parsed = parseDkimDnsValue(fromDms.stdout)
    if (parsed) {
      await applyDkimRuntimeConfig()
      return parsed
    }
  }

  const legacy = await readContainerFile(`${DMS_CONFIG_DIR}/opendkim/keys/${domainName}/mail.txt`)
  if (legacy.ok) {
    const parsed = parseDkimDnsValue(legacy.stdout)
    if (parsed) {
      await applyDkimRuntimeConfig()
      return parsed
    }
  }

  // DMS 16：DKIM 密钥不是自动生成的，需要显式跑 `setup config dkim`
  const generated = await ensureDkim(domainName)
  if (generated) return generated

  const [stored] = await db
    .select()
    .from(dnsRecords)
    .where(and(eq(dnsRecords.domainId, domainId), eq(dnsRecords.comment, 'clover-dkim')))
    .limit(1)
  if (stored?.content.trim().startsWith('v=DKIM1')) return stored.content.trim()

  return null
}

/** 生成（补齐）DKIM 密钥并重读目标域公钥；DMS 不可达时返回 null 而非抛错 */
export async function ensureDkim(domainName: string): Promise<string | null> {
  // 显式传域名：DMS 默认只为「有邮箱账号的域」生成密钥，
  // 刚导入、还没建邮箱的域必须用 `domain <域>` 才会生成（官方支持）。
  const gen = await dmsDkim.regenerate(domainName)
  if (!(gen as DmsResult).ok) return null
  await applyDkimRuntimeConfig()
  const again = await dmsDkim.publicKey(domainName)
  if (!again.ok) return null
  return parseDkimDnsValue(again.stdout)
}

async function applyDkimRuntimeConfig(): Promise<void> {
  const result = await syncDkimRuntime()
  if (!result.ok) {
    throw new Error(`DKIM 配置已生成，但同步到 OpenDKIM 运行配置失败：${result.error}${result.stderr ? ` (${result.stderr})` : ''}`)
  }
}
