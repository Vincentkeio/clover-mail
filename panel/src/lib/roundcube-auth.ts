import 'server-only'
import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { encryptSecret, decryptSecret } from './crypto'
import { getSetting, setSetting } from './settings'
import { syncMailboxPolicies } from './mailbox-policy-sync'

const execAsync = promisify(execFile)
let inFlight: Promise<void> | null = null
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
async function docker(args: string[]) {
  try { return (await execAsync('docker', args, { timeout: 60_000, maxBuffer: 1024 * 1024 })).stdout.trim() }
  catch { throw new Error('Roundcube 免密认证配置失败，请检查邮件服务状态。') }
}

async function configure() {
  const container = process.env.DMS_CONTAINER || 'docker-mailserver'
  const user = 'clover-roundcube@localhost'
  const stored = await getSetting('roundcube_master_password')
  const password = stored ? decryptSecret(stored) : randomBytes(36).toString('base64url')
  await setSetting('roundcube_master_password', encryptSecret(password), true)
  const hash = await docker(['exec', container, 'doveadm', 'pw', '-s', 'SHA512-CRYPT', '-p', password])
  if (!/^\{SHA512-CRYPT\}\$6\$[./A-Za-z0-9=$]+$/.test(hash)) throw new Error('邮件服务未生成有效的认证配置。')
  const version = await docker(['exec', container, 'dovecot', '--version'])
  const modern = /^2\.(?:[4-9]|[1-9]\d)\./.test(version)
  const passdb = [
    modern ? 'passdb clover-roundcube-master {' : 'passdb {',
    '  driver = passwd-file',
    modern ? '  passwd_file_path = /etc/dovecot/clover-roundcube-master.passwd' : '  args = scheme=CRYPT username_format=%u /etc/dovecot/clover-roundcube-master.passwd',
    '  master = yes', '  result_success = continue',
    modern ? '  mechanisms_filter = plain login' : '  mechanisms = plain login', '}',
  ].join('\n')
  const script = [
    '#!/bin/bash', 'set -euo pipefail',
    'printf "%s:%s\\n" ' + quote(user) + ' ' + quote(hash) + ' > /etc/dovecot/clover-roundcube-master.passwd',
    'AUTH_USER="$(doveconf -h default_internal_user)"',
    'chown root:"$(id -gn "$AUTH_USER")" /etc/dovecot/clover-roundcube-master.passwd',
    'chmod 640 /etc/dovecot/clover-roundcube-master.passwd',
    "cat > /etc/dovecot/conf.d/auth-clover-roundcube.conf.ext <<'AUTHCONF'", passdb, 'AUTHCONF',
    'AUTH_CONF=/etc/dovecot/conf.d/10-auth.conf',
    'test -f "$AUTH_CONF"',
    'if grep -q "^[[:space:]]*auth_master_user_separator[[:space:]]*=" "$AUTH_CONF"; then',
    "  sed -i 's|^[[:space:]]*auth_master_user_separator[[:space:]]*=.*|auth_master_user_separator = *|' \"$AUTH_CONF\"",
    'else', "  sed -i '1i auth_master_user_separator = *' \"$AUTH_CONF\"", 'fi',
    // Remove only the generated predecessor's include, preserving other custom patches.
    'if [ -f /tmp/docker-mailserver/clover-webmail-master.sh ]; then',
    "  sed -i '\\|!include /etc/dovecot/conf.d/auth-master.conf.ext|d' \"$AUTH_CONF\"",
    '  rm -f /etc/dovecot/conf.d/auth-master.conf.ext /etc/dovecot/dovecot-master.passwd /tmp/docker-mailserver/clover-webmail-master.sh',
    'fi',
    'if ! grep -Fq "!include /etc/dovecot/conf.d/auth-clover-roundcube.conf.ext" "$AUTH_CONF"; then',
    "  sed -i '1i !include /etc/dovecot/conf.d/auth-clover-roundcube.conf.ext' \"$AUTH_CONF\"", 'fi',
    'doveconf -n >/dev/null',
  ].join('\n') + '\n'
  const temp = await mkdtemp(join(tmpdir(), 'clover-roundcube-auth-'))
  try {
    const path = join(temp, 'clover-roundcube-auth.sh')
    await writeFile(path, script, { mode: 0o600 })
    await docker(['cp', path, container + ':/tmp/docker-mailserver/clover-roundcube-auth.sh'])
    const hook = [
      'set -eu', 'hook=/tmp/docker-mailserver/user-patches.sh',
      'if [ -d "$hook" ]; then exit 1; fi',
      'if [ ! -f "$hook" ]; then printf "#!/bin/bash\\nset -e\\n" > "$hook"; fi',
      "sed -i '\\|bash /tmp/docker-mailserver/clover-webmail-master.sh|d' \"$hook\"",
      "sed -i '/# Clover-managed Webmail master authentication/d' \"$hook\"",
      'if ! grep -Fq "bash /tmp/docker-mailserver/clover-roundcube-auth.sh" "$hook"; then',
      '  printf "\\n# Clover Roundcube SSO authentication\\nbash /tmp/docker-mailserver/clover-roundcube-auth.sh\\n" >> "$hook"', 'fi',
      'chmod 700 "$hook" /tmp/docker-mailserver/clover-roundcube-auth.sh',
      'bash /tmp/docker-mailserver/clover-roundcube-auth.sh',
    ].join('\n')
    await docker(['exec', container, 'sh', '-c', hook])
    const sync = await syncMailboxPolicies()
    if (!sync.ok) throw new Error('邮箱协议同步失败：' + sync.error)
    await docker(['exec', container, 'supervisorctl', 'restart', 'dovecot'])
    await setSetting('roundcube_auth_version', '1')
  } finally { await rm(temp, { recursive: true, force: true }) }
}

export async function ensureRoundcubeAuth() {
  if (await getSetting('roundcube_auth_version') === '1' && await getSetting('roundcube_master_password')) return
  if (!inFlight) inFlight = configure().finally(() => { inFlight = null })
  await inFlight
}
export async function getRoundcubeCredentials() {
  await ensureRoundcubeAuth()
  const encrypted = await getSetting('roundcube_master_password')
  if (!encrypted) throw new Error('Roundcube 认证配置尚未就绪。')
  return { masterUser: 'clover-roundcube@localhost', masterPassword: decryptSecret(encrypted) }
}
