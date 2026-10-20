import 'server-only'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { db } from '@/db'
import { domains } from '@/db/schema'
import { config } from './config'

const execAsync = promisify(execFile)
const configDir = '/tmp/docker-mailserver'
const scriptPath = `${configDir}/clover-srs.sh`
const domainPath = `${configDir}/clover-srs-domains`

// DMS 16 uses postsrsd 1.x. Its domain exclusions are read at process start.
// Keep this hook in DMS's persistent config volume so a mail-container recreate
// applies the same exclusions before or after postsrsd starts.
const script = `#!/bin/sh
set -eu
config=/etc/default/postsrsd
[ -f "$config" ] || exit 0
managed="$(cat ${domainPath} 2>/dev/null || true)"
custom="\${SRS_EXCLUDE_DOMAINS:-}"
if [ -n "$custom" ] && [ -n "$managed" ]; then
  excluded="$custom,$managed"
else
  excluded="$custom$managed"
fi
current="$(sed -n 's/^SRS_EXCLUDE_DOMAINS=//p' "$config" | tail -n 1)"
[ "$current" = "$excluded" ] && exit 0
sed -i '/^SRS_EXCLUDE_DOMAINS=/d' "$config"
if [ -n "$excluded" ]; then
  printf 'SRS_EXCLUDE_DOMAINS=%s\\n' "$excluded" >> "$config"
fi
if supervisorctl status postsrsd 2>/dev/null | grep -q 'RUNNING'; then
  supervisorctl restart postsrsd
fi
`

async function docker(args: string[]) {
  return execAsync('docker', args, { timeout: 30_000, maxBuffer: 1024 * 1024 })
}

async function applySrsDomains() {
  const rows = await db.select({ name: domains.name }).from(domains)
  const names = [...new Set(rows.map((row) => row.name.toLowerCase()))].sort()
  const temporary = await mkdtemp(join(tmpdir(), 'clover-srs-'))
  try {
    const localScript = join(temporary, 'clover-srs.sh')
    const localDomains = join(temporary, 'clover-srs-domains')
    await writeFile(localScript, script, { mode: 0o600 })
    await writeFile(localDomains, names.join(','), { mode: 0o600 })
    await docker(['cp', localScript, `${config.dmsContainer}:${scriptPath}`])
    await docker(['cp', localDomains, `${config.dmsContainer}:${domainPath}`])
    const hook = [
      'set -eu',
      `hook=${configDir}/user-patches.sh`,
      'if [ -d "$hook" ]; then exit 1; fi',
      'if [ ! -f "$hook" ]; then printf "#!/bin/bash\\nset -e\\n" > "$hook"; fi',
      `if ! grep -Fq 'sh ${scriptPath}' "$hook"; then printf '\\n# Clover SRS local domains\\nsh ${scriptPath}\\n' >> "$hook"; fi`,
      `chmod 700 "$hook" ${scriptPath}`,
      `sh ${scriptPath}`,
    ].join('\n')
    await docker(['exec', config.dmsContainer, 'sh', '-ec', hook])
    return { ok: true as const, domains: names }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

let pending: Promise<unknown> = Promise.resolve()
export function syncSrsDomains() {
  const next = pending.catch(() => undefined).then(applySrsDomains)
  pending = next
  return next
}
