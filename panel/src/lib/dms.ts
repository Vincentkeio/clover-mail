import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from './config'

const execFileAsync = promisify(execFile)

/** DMS 容器内配置目录（账号文件 / DKIM 密钥都在这里） */
export const DMS_CONFIG_DIR = '/tmp/docker-mailserver'

export type DmsResult =
  | { ok: true; stdout: string }
  | { ok: false; error: string; stderr: string; code?: number }

/**
 * docker exec 通用执行器。面板镜像内已装 docker.io CLI，
 * 目标 = config.dmsContainer（默认 docker-mailserver）。
 */
async function dockerExec(args: string[], timeoutMs = 30_000): Promise<DmsResult> {
  try {
    const { stdout } = await execFileAsync('docker', args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    })
    return { ok: true, stdout: stdout.trim() }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; code?: number }
    return {
      ok: false,
      error: e.message,
      stderr: typeof e.stderr === 'string' ? e.stderr : '',
      code: typeof e.code === 'number' ? e.code : undefined,
    }
  }
}

/**
 * 在 DMS 容器里执行内部 `setup` 命令——账号/域名/别名的**唯一落地通道**。
 * 官方 CLI 内部负责写配置、生成 hash、reload postfix/dovecot，
 * 因此面板绝不裸写 DMS 配置文件（见 docs/plan.md 4.2/6.2）。
 *
 * 注意：M1 落控制面前，需在真机上对下列子命令逐条核对（版本差异风险）。
 */
export function setup(args: string[], timeoutMs = 30_000): Promise<DmsResult> {
  return dockerExec(['exec', config.dmsContainer, 'setup', ...args], timeoutMs)
}

/** 读 DMS 容器内文件（DKIM 公钥、账号对账文件等） */
export function readContainerFile(absPath: string): Promise<DmsResult> {
  return dockerExec(['exec', config.dmsContainer, 'cat', absPath], 15_000)
}

let dkimRuntimeSync: Promise<DmsResult> | null = null

/**
 * DMS `setup config dkim` writes durable files under /tmp/docker-mailserver,
 * while OpenDKIM reads its startup copy under /etc/opendkim. Keep the runtime
 * copy current without restarting the whole mail server. Concurrent panel
 * requests share one sync/reload operation.
 */
export function syncDkimRuntime(): Promise<DmsResult> {
  if (!dkimRuntimeSync) {
    const script = `
set -eu
src=/tmp/docker-mailserver/opendkim
dst=/etc/opendkim
[ -s "$src/SigningTable" ] && [ -s "$src/KeyTable" ] && [ -d "$src/keys" ] || exit 0

changed=0
for name in SigningTable KeyTable TrustedHosts; do
  if [ -f "$src/$name" ] && { [ ! -f "$dst/$name" ] || ! cmp -s "$src/$name" "$dst/$name"; }; then
    changed=1
  fi
done
for source_file in $(find "$src/keys" -type f); do
  relative_path=\${source_file#"$src/"}
  if [ ! -f "$dst/$relative_path" ] || ! cmp -s "$source_file" "$dst/$relative_path"; then
    changed=1
    break
  fi
done
status=$(supervisorctl status opendkim 2>/dev/null || true)
if ! printf '%s' "$status" | grep -Eq '^opendkim[[:space:]]+RUNNING[[:space:]]'; then changed=1; fi
[ "$changed" -eq 1 ] || { echo unchanged; exit 0; }

# Match DMS's own startup setup: copy durable config, set key ownership and
# permissions, then restart only the DKIM signer.
cp -a "$src/." "$dst/"
chown -R opendkim:opendkim "$dst"
chmod -R 0700 "$dst/keys"
if printf '%s' "$status" | grep -Eq '^opendkim[[:space:]]+RUNNING[[:space:]]'; then
  supervisorctl restart opendkim
else
  supervisorctl start opendkim
fi
`
    dkimRuntimeSync = dockerExec(['exec', config.dmsContainer, 'sh', '-ec', script], 20_000)
      .finally(() => { dkimRuntimeSync = null })
  }
  return dkimRuntimeSync
}

/** 服务状态探活：supervisord 管理的各进程 RUNNING/STOPPED 一览 */
export async function supervisorStatus(): Promise<DmsResult> {
  try {
    const { stdout } = await execFileAsync('docker', ['exec', config.dmsContainer, 'supervisorctl', 'status'], {
      timeout: 8_000,
      maxBuffer: 10 * 1024 * 1024,
    })
    return { ok: true, stdout: stdout.trim() }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }
    const stdout = typeof e.stdout === 'string' ? e.stdout.trim() : ''
    const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : ''
    // supervisorctl 对 STOPPED 进程返回 exit code 3，但仍会输出完整状态；
    // 只要有状态表，就代表 Docker exec 与 supervisord 可正常读取。
    if (e.code === 3 && stdout) return { ok: true, stdout }
    return {
      ok: false,
      error: [e.message, stderr, stdout].filter(Boolean).join(': '),
      stderr,
      code: typeof e.code === 'number' ? e.code : undefined,
    }
  }
}

/**
 * 域操作。
 * ⚠️ 实机核对：DMS 16 的 `setup` 只有 email | alias | quota | dovecot-master | config | relay | debug，
 * **已无 `domain` 子命令**——域由首个邮箱账号隐式建立。因此这两个操作在面板侧是 no-op
 * （返回成功，避免把「DMS 不支持」误报成同步失败）。
 * 删域的实际清理走「删除该域全部邮箱 + 别名」路径（见 domains/[id] DELETE 路由）。
 */
export const domains = {
  add: async (name: string): Promise<DmsResult> => ({
    ok: true,
    stdout: `domain ${name}: DMS 由首个账号隐式建立（no-op）`,
  }),
  del: async (name: string): Promise<DmsResult> => ({
    ok: true,
    stdout: `domain ${name}: 随该域账号/别名清理而消失（no-op）`,
  }),
  list: () => setup(['email', 'list']),
}

export const emails = {
  add: (login: string, password: string) => setup(['email', 'add', login, password]),
  update: (login: string, password: string) => setup(['email', 'update', login, password]),
  del: (login: string) => setup(['email', 'del', '-y', login]),
  list: () => setup(['email', 'list']),
}

export const aliases = {
  /** destination 为逗号分隔的多目标（DMS CLI 原生格式） */
  add: (alias: string, destinations: string[]) =>
    setup(['alias', 'add', alias, destinations.join(',')]),
  del: (alias: string, destination: string) => setup(['alias', 'del', alias, destination]),
  list: () => setup(['alias', 'list']),
}

export const quota = {
  /** value 形如 "1G" / "500M"；DMS 侧即文件系统配额 */
  set: (login: string, value: string) => setup(['quota', 'set', login, value]),
  del: (login: string) => setup(['quota', 'del', login]),
}

export const dkim = {
  /**
   * 生成/补齐 DKIM 密钥（DMS 16 的正确子命令是 `setup config dkim`；
   * 实机验证：会在 /tmp/docker-mailserver/opendkim/keys/<域>/ 落 mail.private/mail.txt）。
   * 注意 DMS 会报 "both Rspamd and OpenDKIM enabled" 警告——当前配置由 OpenDKIM 管密钥，属预期。
   */
  /**
   * 生成/补齐 DKIM 密钥（`setup config dkim`）。
   *
   * ⚠️ 一定要显式传 domain：DMS 默认的域来源是「DMS 的 FQDN + 有邮箱账号的域」
   * （ACCOUNT_PROVISIONER=FILE），所以**刚导入、还没有邮箱的域拿不到密钥**。
   * 官方帮助明确支持 `setup config dkim domain <域>`「只为指定域生成」，不依赖账号存在。
   */
  regenerate: (domain?: string) =>
    setup(domain ? ['config', 'dkim', 'domain', domain] : ['config', 'dkim'], 60_000),
  /** 读某域名 DKIM 公钥 TXT 记录值（配 DNS 用，路径已在 DMS 16 实机确认） */
  publicKey: (domain: string) =>
    readContainerFile(`${DMS_CONFIG_DIR}/opendkim/keys/${domain}/mail.txt`),
}
