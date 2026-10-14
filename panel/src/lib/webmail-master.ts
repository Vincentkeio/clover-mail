import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { encryptSecret } from './crypto'
import { getMasterPassword, getMasterUser, getSetting, setSetting } from './settings'
import { syncMailboxPolicies } from './mailbox-policy-sync'

const execFileAsync = promisify(execFile)
const CONFIGURED_KEY = 'webmail_master_configured'
const CONFIG_VERSION_KEY = 'webmail_master_config_version'
const CONFIG_VERSION = '3'
const POLICY_SYNC_VERSION_KEY = 'mailbox_policy_sync_version'
const POLICY_SYNC_VERSION = '1'
const SETUP_STATUS_KEY = 'webmail_master_setup_status'
type SetupStatus = { state: 'idle' | 'configuring' | 'ready' | 'failed'; error?: string }
let setupInFlight: Promise<void> | null = null

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function docker(args: string[], timeout = 30_000): Promise<string> {
  try {
    const { stdout } = await execFileAsync('docker', args, { timeout, maxBuffer: 1024 * 1024 })
    return stdout.trim()
  } catch {
    // Do not surface child-process details: arguments can contain the generated secret.
    throw new Error('邮件服务暂不可用，无法自动配置 Webmail 免密登录。请检查邮件服务状态后重试。')
  }
}

async function configure(): Promise<void> {
  let masterUser = await getMasterUser()
  let masterPassword = await getMasterPassword()
  if (!masterUser) masterUser = `clover-master@${(process.env.MAIL_DOMAIN || 'localhost').trim().toLowerCase()}`
  if (!masterPassword) masterPassword = randomBytes(36).toString('base64url')
  if (/[\r\n:]/.test(masterUser)) throw new Error('Webmail 内部认证配置无效，请联系管理员检查旧版设置。')

  // Store generated credentials encrypted; the admin can explicitly reveal them as a fallback.
  await setSetting('webmail_master_user', masterUser)
  await setSetting('webmail_master_password', encryptSecret(masterPassword), true)

  const passwordHash = await docker([
    'exec', process.env.DMS_CONTAINER || 'docker-mailserver',
    'doveadm', 'pw', '-s', 'SHA512-CRYPT', '-p', masterPassword,
  ])
  if (!/^\{SHA512-CRYPT\}\$6\$[./A-Za-z0-9=$]+$/.test(passwordHash)) {
    throw new Error('邮件服务未能生成 Webmail 免密认证配置，请检查 Dovecot 状态。')
  }

  const container = process.env.DMS_CONTAINER || 'docker-mailserver'
  const versionText = await docker(['exec', container, 'dovecot', '--version'])
  const versionParts = versionText.match(/^(\d+)\.(\d+)/)
  if (!versionParts) throw new Error('无法识别邮件服务的 Dovecot 版本，Webmail 免密配置未应用。')
  const usesDovecot24Syntax = Number(versionParts[1]) > 2 || Number(versionParts[1]) === 2 && Number(versionParts[2]) >= 4
  const passdbConfig = usesDovecot24Syntax
    ? `passdb passwd-file {
  driver = passwd-file
  passwd_file_path = /etc/dovecot/dovecot-master.passwd
  master = yes
  result_success = continue
  mechanisms_filter = plain login
}`
    : `passdb {
  driver = passwd-file
  args = scheme=CRYPT username_format=%u /etc/dovecot/dovecot-master.passwd
  master = yes
  result_success = continue
  mechanisms = plain login
}`
  const configScript = `#!/bin/bash
set -euo pipefail
MASTER_USER=${quoteShell(masterUser)}
MASTER_PASS_HASH=${quoteShell(passwordHash)}
MASTER_UID=9999
DOVECOT_CONF_DIR='/etc/dovecot/conf.d'
MASTER_PASSWD_FILE='/etc/dovecot/dovecot-master.passwd'
printf '%s:%s:%s:%s::/::userdb_mail=maildir:~/Maildir\\n' \\
  "\${MASTER_USER}" "\${MASTER_PASS_HASH}" "\${MASTER_UID}" "\${MASTER_UID}" > "\${MASTER_PASSWD_FILE}"
# Dovecot's unprivileged auth process must be able to read this file.
AUTH_USER="$(doveconf -h default_internal_user)"
AUTH_GROUP="$(id -gn "\${AUTH_USER}")"
chown root:"\${AUTH_GROUP}" "\${MASTER_PASSWD_FILE}"
chmod 640 "\${MASTER_PASSWD_FILE}"
cat > "\${DOVECOT_CONF_DIR}/auth-master.conf.ext" <<'EOF'
${passdbConfig}
EOF
AUTH_CONF="\${DOVECOT_CONF_DIR}/10-auth.conf"
[ -f "\${AUTH_CONF}" ] || { echo 'Dovecot auth config missing' >&2; exit 1; }
if grep -q '^[[:space:]]*auth_master_user_separator[[:space:]]*=' "\${AUTH_CONF}"; then
  sed -i 's|^[[:space:]]*auth_master_user_separator[[:space:]]*=.*|auth_master_user_separator = *|' "\${AUTH_CONF}"
else
  sed -i '1i auth_master_user_separator = *' "\${AUTH_CONF}"
fi
if ! grep -Fq '!include /etc/dovecot/conf.d/auth-master.conf.ext' "\${AUTH_CONF}"; then
  sed -i '1i !include /etc/dovecot/conf.d/auth-master.conf.ext' "\${AUTH_CONF}"
fi
`

  const tempDir = await mkdtemp(join(tmpdir(), 'clover-webmail-master-'))
  const localScript = join(tempDir, 'clover-webmail-master.sh')
  const scriptInContainer = '/tmp/docker-mailserver/clover-webmail-master.sh'
  try {
    await writeFile(localScript, configScript, { mode: 0o600 })
    await docker(['cp', localScript, `${container}:${scriptInContainer}`])
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }

  // Keep the generated Dovecot setup persistent across mail-container recreations,
  // while preserving any existing DMS user-patches.sh customization.
  const hookSetup = `set -eu
hook=/tmp/docker-mailserver/user-patches.sh
patch=${scriptInContainer}
if [ -d "$hook" ]; then echo 'user-patches.sh is a directory' >&2; exit 1; fi
if [ ! -e "$hook" ]; then printf '#!/bin/bash\\nset -e\\n' > "$hook"; chmod 700 "$hook"; fi
if ! grep -Fq "$patch" "$hook"; then printf '\\n# Clover-managed Webmail master authentication\\nbash %s\\n' "$patch" >> "$hook"; fi
chmod 700 "$patch"
bash "$patch"
`
  const encoded = Buffer.from(hookSetup).toString('base64')
  await docker(['exec', container, 'sh', '-c', `printf %s ${quoteShell(encoded)} | base64 -d | sh`], 45_000)
  await docker(['exec', container, 'doveconf', '-n'], 30_000)
  await docker(['exec', container, 'supervisorctl', 'restart', 'dovecot'], 45_000)
  const policySync = await syncMailboxPolicies()
  if (!policySync.ok) throw new Error(`Webmail 邮箱协议策略应用失败：${policySync.error}`)
  await setSetting(POLICY_SYNC_VERSION_KEY, POLICY_SYNC_VERSION)
  await setSetting(CONFIGURED_KEY, 'true')
  await setSetting(CONFIG_VERSION_KEY, CONFIG_VERSION)
}

/** Start first-use Dovecot setup without holding the browser's SSO request open. */
export async function startWebmailMasterSetup(): Promise<SetupStatus> {
  const [configured, version, policyVersion] = await Promise.all([
    getSetting(CONFIGURED_KEY), getSetting(CONFIG_VERSION_KEY), getSetting(POLICY_SYNC_VERSION_KEY),
  ])
  if (configured === 'true' && version === CONFIG_VERSION && policyVersion === POLICY_SYNC_VERSION) return { state: 'ready' }
  if (!setupInFlight) {
    setupInFlight = Promise.resolve()
      .then(async () => {
        await setSetting(SETUP_STATUS_KEY, JSON.stringify({ state: 'configuring' } satisfies SetupStatus))
        if (configured === 'true' && version === CONFIG_VERSION) {
          const policySync = await syncMailboxPolicies()
          if (!policySync.ok) throw new Error(`邮件服务策略应用失败：${policySync.error}`)
          await setSetting(POLICY_SYNC_VERSION_KEY, POLICY_SYNC_VERSION)
        } else {
          await configure()
        }
        await setSetting(SETUP_STATUS_KEY, JSON.stringify({ state: 'ready' } satisfies SetupStatus))
      })
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : 'Webmail 自动配置失败，请检查邮件服务状态后重试。'
        await setSetting(SETUP_STATUS_KEY, JSON.stringify({ state: 'failed', error: message } satisfies SetupStatus))
      })
      .finally(() => { setupInFlight = null })
  }
  return { state: 'configuring' }
}

export async function getWebmailMasterSetupStatus(): Promise<SetupStatus> {
  const [configured, version, policyVersion] = await Promise.all([
    getSetting(CONFIGURED_KEY), getSetting(CONFIG_VERSION_KEY), getSetting(POLICY_SYNC_VERSION_KEY),
  ])
  if (configured === 'true' && version === CONFIG_VERSION && policyVersion === POLICY_SYNC_VERSION) return { state: 'ready' }
  if (setupInFlight) return { state: 'configuring' }
  if (configured === 'true' && version === CONFIG_VERSION) return { state: 'idle' }
  const raw = await getSetting(SETUP_STATUS_KEY)
  if (!raw) return { state: 'idle' }
  try {
    const parsed = JSON.parse(raw) as SetupStatus
    // A panel restart can interrupt first-use setup. Report idle so the browser can retry it.
    return parsed.state === 'configuring' ? { state: 'idle' } : parsed
  } catch {
    return { state: 'idle' }
  }
}

/** Read credentials after configuration has finished. */
export async function ensureWebmailMaster() {
  const [configured, version] = await Promise.all([getSetting(CONFIGURED_KEY), getSetting(CONFIG_VERSION_KEY)])
  if (configured !== 'true' || version !== CONFIG_VERSION) {
    throw new Error('Webmail 免密登录仍在自动配置中，请稍后重试。')
  }
  const [masterUser, masterPassword] = await Promise.all([getMasterUser(), getMasterPassword()])
  if (!masterUser || !masterPassword) {
    await setSetting(CONFIGURED_KEY, 'false')
    throw new Error('Webmail 认证配置不完整，请重新打开邮箱以自动修复。')
  }
  return { masterUser, masterPassword }
}
