#!/usr/bin/env python3
"""Clover host certificate worker. Runs in the isolated helper container."""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import time

PROJECT = Path('/clover')
HOST = Path('/host')
ACME_IMAGE = 'certbot/certbot:v5.1.0'
DOCKER = shutil.which('docker') or '/usr/bin/docker'
NGINX_SITE = HOST / 'etc/nginx/conf.d/clover-panel.conf'
RECOVERY = PROJECT / 'deploy/acme/recovery.json'
STATUS = PROJECT / 'deploy/acme/status.json'


def run(args, timeout=40, check=True, input_text=None):
    if args and args[0] == 'docker':
        args = [DOCKER, *args[1:]]
    result = subprocess.run(args, text=True, capture_output=True, timeout=timeout, input=input_text)
    if check and result.returncode:
        raise RuntimeError((result.stderr or result.stdout or '命令执行失败')[-2500:])
    return result


def atomic(path, text, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f'{path.name}.{os.getpid()}.{time.time_ns()}.tmp')
    temp.write_text(text, encoding='utf-8')
    temp.chmod(mode)
    os.replace(temp, path)


def host_run(*args, timeout=40, check=True):
    # The helper already shares the host PID/network namespaces. nsenter --root
    # can be blocked by /proc hidepid/ptrace restrictions, so use the mounted host
    # filesystem to invoke systemd/nginx from their real root instead.
    return run(['chroot', str(HOST), *args], timeout=timeout, check=check)


class Manager:
    def __init__(self):
        self.env = {}
        for line in (PROJECT / '.env').read_text(encoding='utf-8').splitlines():
            if re.match(r'^[A-Z_][A-Z0-9_]*=', line):
                key, value = line.split('=', 1)
                self.env[key] = value.strip()
        self.data = PROJECT / 'deploy/acme'
        self.state = self.load(STATUS, {'mode': 'unconfigured', 'certificates': {}, 'autoRenew': False})

    @staticmethod
    def load(path, fallback):
        try:
            return json.loads(path.read_text(encoding='utf-8'))
        except (FileNotFoundError, json.JSONDecodeError):
            return fallback

    def save(self):
        atomic(STATUS, json.dumps(self.state, ensure_ascii=False, indent=2))

    def log(self, message):
        self.state['message'] = message
        self.state['updatedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
        self.save()
        print(message, flush=True)

    def host_name(self):
        host = self.env.get('PANEL_HOSTNAME', '').lower()
        if len(host) > 253 or not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}', host):
            raise RuntimeError('请先在安装配置中填写有效的面板域名')
        return host

    def mail_host_name(self):
        host = self.env.get('MAIL_HOSTNAME', '').lower()
        if len(host) > 253 or not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}', host):
            raise RuntimeError('请先在面板设置中填写有效的邮件主机名')
        return host

    def shared_nginx_mode(self):
        return self.env.get('CLOVER_SHARED_NGINX') == '1' or (
            self.env.get('CLOVER_CADDY_SCHEME') == 'http' and not self.shared_caddy_mode())

    def shared_caddy_mode(self):
        return self.env.get('CLOVER_SHARED_CADDY') == '1'

    def configure_host_caddy(self):
        if not self.shared_caddy_mode():
            return
        result = run([
            sys.executable, '/app/host-caddy.py', 'configure-env', '--host-root', '/host',
            '--env-file', str(PROJECT / '.env'),
        ], timeout=90, check=False)
        if result.returncode:
            raise RuntimeError((result.stderr or result.stdout or '宿主机 Caddy 配置失败').strip()[-1800:])
        if result.stdout.strip():
            self.log(result.stdout.strip())

    def cert_dir(self, host):
        return self.data / 'live' / host

    def cert_valid_days(self, host):
        cert = self.cert_dir(host) / 'fullchain.pem'
        if not cert.exists():
            return None
        result = run(['openssl', 'x509', '-in', str(cert), '-noout', '-enddate'], check=False)
        if result.returncode:
            return None
        match = re.search(r'notAfter=(.+)', result.stdout)
        if not match:
            return None
        expiry = dt.datetime.strptime(match.group(1), '%b %d %H:%M:%S %Y %Z').replace(tzinfo=dt.timezone.utc)
        return max(0, int((expiry - dt.datetime.now(dt.timezone.utc)).total_seconds() // 86400))

    def certificate_info(self, host, installed=False):
        cert = self.cert_dir(host) / 'fullchain.pem'
        if not cert.is_file():
            return {'host': host, 'installed': False, 'daysRemaining': None}
        result = run(['openssl', 'x509', '-in', str(cert), '-noout', '-startdate', '-enddate',
                      '-issuer', '-subject', '-fingerprint', '-sha256'], check=False)
        if result.returncode:
            return {'host': host, 'installed': False, 'daysRemaining': None}
        fields = {}
        for line in result.stdout.splitlines():
            if '=' in line:
                key, value = line.split('=', 1)
                fields[key.strip()] = value.strip()

        def as_iso(value):
            try:
                return dt.datetime.strptime(value, '%b %d %H:%M:%S %Y %Z').replace(
                    tzinfo=dt.timezone.utc).isoformat()
            except ValueError:
                return None

        fingerprint = hashlib.sha256(cert.read_bytes()).hexdigest()
        valid_from = as_iso(fields.get('notBefore', ''))
        valid_to = as_iso(fields.get('notAfter', ''))
        expiry = dt.datetime.fromisoformat(valid_to) if valid_to else None
        days_remaining = int((expiry - dt.datetime.now(dt.timezone.utc)).total_seconds() // 86400) if expiry else None
        return {
            'host': host,
            'installed': installed and self.state.get('mailFingerprint') == fingerprint,
            'daysRemaining': days_remaining,
            'validFrom': valid_from,
            'validTo': valid_to,
            'issuer': fields.get('issuer', '').removeprefix('issuer='),
            'subject': fields.get('subject', '').removeprefix('subject='),
            'fingerprint': fields.get('sha256 Fingerprint', ''),
        }

    def served_cert_days(self, host):
        port = '443' if self.shared_caddy_mode() else self.env.get('CLOVER_HTTPS_PORT', '443')
        result = run(['openssl', 's_client', '-connect', f'127.0.0.1:{port}', '-servername', host, '-showcerts'], timeout=12, check=False)
        match = re.search(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----', result.stdout + result.stderr, re.S)
        if not match:
            return None
        cert = run(['openssl', 'x509', '-noout', '-enddate', '-checkhost', host],
                   input_text=match.group(0), check=False)
        if cert.returncode:
            return None
        end = re.search(r'notAfter=(.+)', cert.stdout)
        if not end:
            return None
        expiry = dt.datetime.strptime(end.group(1), '%b %d %H:%M:%S %Y %Z').replace(tzinfo=dt.timezone.utc)
        return max(0, int((expiry - dt.datetime.now(dt.timezone.utc)).total_seconds() // 86400))

    def dns_check(self, host):
        try:
            records = {item[4][0] for item in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)}
        except OSError as error:
            raise RuntimeError(f'{host} DNS 查询失败：{error}') from error
        public_ip = self.env.get('CLOVER_VPS_IP', '').strip()
        if public_ip and public_ip not in records:
            raise RuntimeError(f'{host} 当前解析到 {", ".join(sorted(records))}，应解析到本机 {public_ip}，并关闭 Cloudflare 代理后再签发。')

    def listener(self, port):
        hex_port = f'{port:04X}'
        return run(['sh', '-c', f"grep -iE ':{hex_port} ' /proc/net/tcp /proc/net/tcp6"], check=False).stdout

    def wait_listener_clear(self, port, timeout=30):
        deadline = time.monotonic() + timeout
        while self.listener(port):
            if time.monotonic() >= deadline:
                return False
            time.sleep(1)
        return True

    def is_nginx_active(self):
        if host_run('/usr/bin/systemctl', 'is-active', '--quiet', 'nginx.service', check=False).returncode == 0:
            return True
        # aaPanel installs nginx under /www/server and registers a SysV unit.
        # systemd can mark that unit failed while its actual master still serves
        # traffic (for example, when an earlier graceful stop was checked too soon).
        config = self.host_nginx_config()
        if not config:
            return False
        try:
            pid = config['pidfile'].read_text(encoding='ascii').strip()
            if not re.fullmatch(r'\d+', pid):
                return False
        except OSError:
            return False
        if not self.listener(80) or not self.listener(443):
            return False
        # A newly written aaPanel vhost can reference a Clover certificate
        # before ACME has issued it. `nginx -T` then fails against disk even
        # though the already-running master still owns both public listeners.
        try:
            command = (Path('/proc') / pid / 'cmdline').read_bytes().replace(b'\0', b' ').decode('utf-8', 'replace')
        except OSError:
            return False
        return str(config['nginx_bin']) in command and str(config['configfile']) in command

    def nginx_service_action(self, action):
        if self.host_nginx_config():
            unit = f'clover-nginx-{action}-{time.time_ns()}'
            return host_run('/usr/bin/systemd-run', f'--unit={unit}', '--wait', '--collect',
                            '/etc/init.d/nginx', action, timeout=45, check=False)
        return host_run('/usr/bin/systemctl', action, 'nginx.service', timeout=45, check=False)

    @staticmethod
    def host_nginx_config():
        try:
            script = (HOST / 'etc/init.d/nginx').read_text(encoding='utf-8', errors='replace')
        except OSError:
            return None
        values = {}
        for key in ('NAME', 'NGINX_BIN', 'CONFIGFILE', 'PIDFILE'):
            match = re.search(rf'^\s*{key}\s*=\s*["\']?([^\s"\']+)', script, re.M)
            if not match:
                return None
            values[key] = match.group(1)
        name = values['NAME']
        for key in ('NGINX_BIN', 'CONFIGFILE', 'PIDFILE'):
            values[key] = values[key].replace('$NAME', name).replace('${NAME}', name)
        paths = {
            'nginx_bin': Path('/' + values['NGINX_BIN'].lstrip('/')),
            'configfile': Path('/' + values['CONFIGFILE'].lstrip('/')),
            'pidfile': HOST / values['PIDFILE'].lstrip('/'),
        }
        binary_exists = (HOST / str(paths['nginx_bin']).lstrip('/')).is_file()
        config_exists = (HOST / str(paths['configfile']).lstrip('/')).is_file()
        return paths if binary_exists and config_exists else None

    def paused_services(self):
        return self.load(RECOVERY, {'services': []}).get('services', [])

    @staticmethod
    def aapanel_paths():
        data = HOST / 'www/server/panel/data'
        return data / 'daemon_service.pl', data / 'daemon_service_lock.pl', data / 'mod_push_data/manual_flag.pl'

    def pause_aapanel_nginx_watchdog(self, recovery):
        daemon_file, lock_file, manual_file = self.aapanel_paths()
        try:
            services = json.loads(daemon_file.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            return False
        if 'nginx' not in services:
            return False
        lock_file.parent.mkdir(parents=True, exist_ok=True)
        lock_file.touch(exist_ok=True)
        with lock_file.open('r+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                existed = manual_file.exists()
                try:
                    flags = json.loads(manual_file.read_text(encoding='utf-8')) if existed else {}
                except json.JSONDecodeError as error:
                    raise RuntimeError('aaPanel 的 Nginx 守护标记不是有效 JSON；为避免覆盖其设置，已取消自动暂停。') from error
                if not isinstance(flags, dict):
                    raise RuntimeError('aaPanel 的 Nginx 守护标记格式异常；为避免覆盖其设置，已取消自动暂停。')
                recovery['aapanelNginxFlag'] = {
                    'path': str(manual_file.relative_to(HOST)),
                    'existed': existed,
                    'value': flags.get('nginx'),
                }
                atomic(RECOVERY, json.dumps(recovery))
                flags['nginx'] = 1
                manual_file.parent.mkdir(parents=True, exist_ok=True)
                manual_file.write_text(json.dumps(flags), encoding='utf-8')
                self.nginx_service_action('stop')
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)
        return True

    def restore_aapanel_nginx_watchdog(self, recovery):
        saved = recovery.get('aapanelNginxFlag')
        if not saved:
            return
        daemon_file, lock_file, default_manual_file = self.aapanel_paths()
        manual_file = HOST / saved.get('path', str(default_manual_file.relative_to(HOST)))
        lock_file.touch(exist_ok=True)
        with lock_file.open('r+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                try:
                    flags = json.loads(manual_file.read_text(encoding='utf-8')) if manual_file.exists() else {}
                except json.JSONDecodeError as error:
                    raise RuntimeError('aaPanel 的 Nginx 守护标记损坏，无法安全恢复。') from error
                if saved.get('existed'):
                    if saved.get('value') is None:
                        flags.pop('nginx', None)
                    else:
                        flags['nginx'] = saved['value']
                    manual_file.write_text(json.dumps(flags), encoding='utf-8')
                else:
                    flags.pop('nginx', None)
                    if flags:
                        manual_file.write_text(json.dumps(flags), encoding='utf-8')
                    else:
                        manual_file.unlink(missing_ok=True)
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def recover(self):
        recovery = self.load(RECOVERY, {'services': []})
        services = recovery.get('services', [])
        errors = []
        for service in reversed(services):
            if service == 'nginx':
                try:
                    self.restore_aapanel_nginx_watchdog(recovery)
                except Exception as error:
                    errors.append(str(error))
                deadline = time.monotonic() + 30
                restored = self.is_nginx_active() and self.listener(80) and self.listener(443)
                while time.monotonic() < deadline:
                    if restored:
                        break
                    host_run('/usr/bin/systemctl', 'reset-failed', 'nginx.service', check=False)
                    self.nginx_service_action('start')
                    if self.is_nginx_active() and self.listener(80) and self.listener(443):
                        restored = True
                        break
                    time.sleep(2)
                if not restored:
                    errors.append('nginx 未能恢复；请执行 systemctl start nginx')
                else:
                    self.log('nginx 已恢复')
            elif service == 'caddy':
                result = run(['docker', 'start', 'clover-caddy'], check=False)
                if result.returncode:
                    errors.append('Caddy 未能恢复；请执行 docker start clover-caddy')
                else:
                    self.log('Caddy 已恢复')
        atomic(RECOVERY, json.dumps({'services': [] if not errors else services,
                                     'timerUnit': recovery.get('timerUnit'),
                                     'timerServiceUnit': recovery.get('timerServiceUnit')}))
        if errors:
            raise RuntimeError('；'.join(errors))
        timer_unit = recovery.get('timerUnit') or 'clover-nginx-recovery.timer'
        timer_service_unit = recovery.get('timerServiceUnit') or 'clover-nginx-recovery.service'
        host_run('/usr/bin/systemctl', 'stop', timer_unit, check=False)
        host_run('/usr/bin/systemctl', 'stop', timer_service_unit, check=False)
        host_run('/usr/bin/systemctl', 'reset-failed', timer_unit, timer_service_unit, check=False)

    def pause_nginx(self):
        # The helper can see host sockets, but its /proc view may not expose host
        # process names to `ss -p`. Rely on systemd's nginx state when owner data is
        # unavailable; after stopping nginx, verify that port 80 is actually free.
        owners = run(['ss', '-H', '-ltnp', 'sport = :80'], check=False).stdout
        nginx_active = self.is_nginx_active()
        has_owner_info = 'users:(' in owners
        if owners and has_owner_info and 'nginx' not in owners:
            raise RuntimeError('公网 80 被其他程序占用，不会自动停止它。请释放 80 端口后重试。')
        if owners and not nginx_active:
            raise RuntimeError('公网 80 被其他程序占用，不会自动停止它。请释放 80 端口后重试。')
        # When process details are hidden inside the helper, the active systemd unit
        # or a validated host nginx init script identifies the managed listener.
        # Stop it, then verify port 80 became free; if another listener remains,
        # the caller's finally block restores nginx.
        # A transient timer also restores nginx if this worker exits during ACME.
        if owners and nginx_active:
            unit = f'clover-nginx-recovery-{time.time_ns()}'
            timer_unit = unit + '.timer'
            timer_service_unit = unit + '.service'
            atomic(RECOVERY, json.dumps({'services': ['nginx'], 'timerUnit': timer_unit,
                                         'timerServiceUnit': timer_service_unit}))
            host_run('/usr/bin/systemctl', 'stop', 'clover-nginx-recovery.timer', check=False)
            host_run('/usr/bin/systemctl', 'stop', 'clover-nginx-recovery.service', check=False)
            host_run('/usr/bin/systemctl', 'reset-failed', 'clover-nginx-recovery.timer',
                     'clover-nginx-recovery.service', check=False)
            host_run('/usr/bin/systemd-run', f'--unit={unit}', '--on-active=6m',
                     '--timer-property=AccuracySec=1s', '/usr/bin/docker', 'exec',
                     'clover-certificate-helper', 'python3', '/app/certificates.py', 'recover')
            self.log('签发期间临时暂停 nginx；证书流程结束后会自动恢复（现有网站会短暂中断）')
            recovery = self.load(RECOVERY, {'services': ['nginx']})
            if not self.pause_aapanel_nginx_watchdog(recovery):
                self.nginx_service_action('stop')
            if not self.wait_listener_clear(80):
                host_run('/usr/bin/systemctl', 'kill', '--signal=QUIT', 'nginx.service', check=False)
                if not self.wait_listener_clear(80):
                    host_run('/usr/bin/systemctl', 'kill', '--signal=TERM', 'nginx.service', check=False)
                    if not self.wait_listener_clear(80, timeout=15):
                        raise RuntimeError('nginx 停止后 45 秒内 80 端口仍被占用；证书申请已取消。请检查其他监听程序。')
        if self.listener(80):
            raise RuntimeError('nginx 已暂停，但 80 端口仍被占用；未识别或停止其他程序。请先释放公网 80 端口。')

    def pause_caddy(self):
        status = run(['docker', 'inspect', '--format', '{{.State.Status}}', 'clover-caddy'], check=False).stdout.strip()
        if status != 'running':
            if self.listener(80):
                raise RuntimeError('公网 80 被其他程序占用。请释放端口后重试签发邮件证书。')
            return
        unit = f'clover-caddy-recovery-{time.time_ns()}'
        timer_unit = unit + '.timer'
        timer_service_unit = unit + '.service'
        atomic(RECOVERY, json.dumps({'services': ['caddy'], 'timerUnit': timer_unit,
                                     'timerServiceUnit': timer_service_unit}))
        host_run('/usr/bin/systemctl', 'stop', 'clover-nginx-recovery.timer', check=False)
        host_run('/usr/bin/systemctl', 'stop', 'clover-nginx-recovery.service', check=False)
        host_run('/usr/bin/systemctl', 'reset-failed', 'clover-nginx-recovery.timer',
                 'clover-nginx-recovery.service', check=False)
        host_run('/usr/bin/systemd-run', f'--unit={unit}', '--on-active=6m',
                 '--timer-property=AccuracySec=1s', '/usr/bin/docker', 'exec',
                 'clover-certificate-helper', 'python3', '/app/certificates.py', 'recover')
        self.log('签发邮件证书期间临时暂停 Caddy；完成后会自动恢复（面板会短暂中断）')
        run(['docker', 'stop', '--time', '20', 'clover-caddy'], timeout=30)
        if not self.wait_listener_clear(80):
            raise RuntimeError('Caddy 已暂停，但公网 80 仍被占用；请检查其他监听程序。')

    def pause_for_acme(self):
        if self.shared_nginx_mode():
            self.pause_nginx()
        else:
            self.pause_caddy()

    def nginx_config(self, host):
        root_cert = f'{self.env["CLOVER_HOME"]}/deploy/acme/live/{host}/fullchain.pem'
        root_key = f'{self.env["CLOVER_HOME"]}/deploy/acme/live/{host}/privkey.pem'
        port = self.env.get('CLOVER_HTTP_PORT', '18080')
        nginx = self.host_nginx_config()
        if nginx:
            site = self.host_nginx_site_path(nginx)
            nginx_bin = nginx['nginx_bin']
            nginx_config = nginx['configfile']
        else:
            site = NGINX_SITE
            nginx_bin = Path('/usr/sbin/nginx')
            nginx_config = Path('/etc/nginx/nginx.conf')
        previous = site.read_text(encoding='utf-8') if site.exists() else None
        if previous and not previous.startswith('# Managed by Clover'):
            raise RuntimeError(f'{site.relative_to(HOST)} 已存在且不由 Clover 管理，拒绝覆盖。')
        sites = host_run(str(nginx_bin), '-T', '-c', str(nginx_config), check=False)
        for line in (sites.stdout + sites.stderr).splitlines():
            if re.search(r'\bserver_name\s', line) and re.search(rf'(^|\s){re.escape(host)}(\s|;|$)', line) and (previous is None or line.strip() not in previous):
                raise RuntimeError(f'nginx 已有站点配置使用 {host}，请先移除重复 server_name 后再配置。')
        config = f'''# Managed by Clover certificate manager
server {{
    listen 80;
    server_name {host};
    return 301 https://$host$request_uri;
}}
server {{
    listen 443 ssl;
    server_name {host};
    ssl_certificate {root_cert};
    ssl_certificate_key {root_key};
    location / {{
        proxy_pass http://127.0.0.1:{port};
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP $remote_addr;
    }}
}}
'''
        atomic(site, config, 0o644)
        check = host_run(str(nginx_bin), '-t', '-c', str(nginx_config), check=False)
        if check.returncode:
            if previous is None:
                site.unlink(missing_ok=True)
            else:
                atomic(site, previous, 0o644)
            raise RuntimeError('nginx 配置校验失败，已回滚 Clover 配置：' + (check.stderr or check.stdout)[-1200:])
        loaded = host_run(str(nginx_bin), '-T', '-c', str(nginx_config), check=False)
        if loaded.returncode or '# Managed by Clover certificate manager' not in loaded.stdout + loaded.stderr:
            if previous is None:
                site.unlink(missing_ok=True)
            else:
                atomic(site, previous, 0o644)
            raise RuntimeError(f'nginx 没有加载 {site.relative_to(HOST)}；已回滚配置，请确认主配置 include 了该目录。')
        self.nginx_service_action('reload' if self.is_nginx_active() else 'start')

    @staticmethod
    def host_nginx_site_path(config):
        host_config = HOST / str(config['configfile']).lstrip('/')
        try:
            source = host_config.read_text(encoding='utf-8', errors='replace')
        except OSError as error:
            raise RuntimeError(f'无法读取 Nginx 主配置：{config["configfile"]}') from error
        uncommented = re.sub(r'(?m)#.*$', '', source)
        block = re.search(r'(?m)^\s*http\s*\{', uncommented)
        if not block:
            raise RuntimeError('Nginx 主配置中没有 http 配置段，无法安全加入面板反向代理。')
        opening = uncommented.find('{', block.start())
        depth = 1
        closing = opening + 1
        while closing < len(uncommented) and depth:
            if uncommented[closing] == '{':
                depth += 1
            elif uncommented[closing] == '}':
                depth -= 1
            closing += 1
        if depth:
            raise RuntimeError('Nginx http 配置段不完整，无法安全加入面板反向代理。')
        includes = re.findall(r'^\s*include\s+([^;]+);', uncommented[opening + 1:closing - 1], re.M)
        candidates = []
        for include in includes:
            include = include.strip().strip('"\'')
            candidate = Path(include)
            if not candidate.is_absolute():
                candidate = host_config.parent / candidate
            if '*' not in candidate.name or candidate.suffix != '.conf':
                continue
            candidates.append(candidate)
        if candidates:
            candidates.sort(key=lambda path: (
                0 if path.parent.name in {'conf.d', 'vhost', 'sites-enabled'} else 1,
                len(path.parts),
            ))
            return HOST / str(candidates[0].parent / 'clover-panel.conf').lstrip('/')
        raise RuntimeError('Nginx 主配置中没有可用的 *.conf 站点目录，无法安全加入面板反向代理。')

    def issue(self, force=False):
        host = self.host_name()
        self.dns_check(host)
        if not os.path.isfile(DOCKER) or not os.access(DOCKER, os.X_OK):
            raise RuntimeError(f'证书助手内缺少 Docker CLI（检查路径：{DOCKER}）。请重建证书助手镜像：docker compose build --no-cache certificate-helper && docker compose up -d certificate-helper')
        if self.shared_caddy_mode():
            self.configure_host_caddy()
            self.log(f'宿主机 Caddy 正在为 {host} 申请/检查 HTTPS 证书…')
            deadline = time.monotonic() + 120
            days = self.served_cert_days(host)
            while days is None and time.monotonic() < deadline:
                time.sleep(2)
                days = self.served_cert_days(host)
            if days is None:
                raise RuntimeError(f'宿主机 Caddy 尚未返回 {host} 的 TLS 证书。请确认 DNS 指向本机，公网 TCP 80/443 可达且 Cloudflare 代理已关闭。')
            self.state['mode'] = 'host-caddy'
            self.state['provider'] = '宿主机 Caddy'
            self.state.setdefault('certificates', {})
            self.state['certificates']['panel'] = {'host': host, 'daysRemaining': days}
            self.state['autoRenew'] = True
            self.state['error'] = None
            self.log(f'{host} 面板证书由宿主机 Caddy 自动管理，剩余 {days} 天')
            return
        days = self.cert_valid_days(host)
        if days is not None and days > 30 and not force:
            self.log(f'证书有效期还有 {days} 天，无需续签')
            self.configure_panel_tls(host)
            return
        self.log(f'正在为 {host} 申请/续签证书；需要公网 TCP 80 可达，Cloudflare 代理需暂时关闭')
        if run(['docker', 'image', 'inspect', ACME_IMAGE], check=False).returncode:
            run(['docker', 'pull', ACME_IMAGE], timeout=300)
        try:
            self.pause_for_acme()
            self.run_certbot(host)
        finally:
            self.recover()
        self.configure_panel_tls(host)

    def run_certbot(self, host, webroot=False):
        home = self.env['CLOVER_HOME']
        args = ['docker', 'run', '--rm', '--name', 'clover-acme-job', '--network', 'host',
                '-v', f'{home}/deploy/acme:/etc/letsencrypt']
        if webroot:
            (PROJECT / 'deploy/acme/webroot').mkdir(parents=True, exist_ok=True)
            args.extend(['-v', f'{home}/deploy/acme/webroot:/var/www/certbot'])
        args.extend([ACME_IMAGE, 'certonly'])
        if webroot:
            args.extend(['--webroot', '--webroot-path', '/var/www/certbot'])
        else:
            args.extend(['--standalone', '--preferred-challenges', 'http'])
        args.extend(['--non-interactive', '--agree-tos', '--email', self.env['ACME_EMAIL'],
                     '--cert-name', host, '-d', host, '--keep-until-expiring', '--no-random-sleep-on-renew'])
        run(args, timeout=360)

    def install_mail_certificate(self, host):
        cert = self.cert_dir(host) / 'fullchain.pem'
        key = self.cert_dir(host) / 'privkey.pem'
        if not cert.is_file() or not key.is_file():
            raise RuntimeError(f'没有找到 {host} 的证书文件，无法安装到邮件服务。')
        fingerprint = hashlib.sha256(cert.read_bytes()).hexdigest()
        if self.state.get('mailFingerprint') == fingerprint:
            return False
        self.log('正在将邮件证书安装到 docker-mailserver 并重载邮件服务…')
        container_env = run(['docker', 'inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', 'docker-mailserver']).stdout
        settings = dict(line.split('=', 1) for line in container_env.splitlines() if '=' in line)
        if settings.get('SSL_TYPE') != 'manual':
            raise RuntimeError('docker-mailserver 未配置 SSL_TYPE=manual，无法安装邮件证书。请先升级并重启邮件服务后重试。')
        cert_path = settings.get('SSL_CERT_PATH', '/tmp/docker-mailserver/ssl/mail.crt')
        key_path = settings.get('SSL_KEY_PATH', '/tmp/docker-mailserver/ssl/mail.key')
        if not cert_path.startswith('/tmp/docker-mailserver/') or not key_path.startswith('/tmp/docker-mailserver/'):
            raise RuntimeError('邮件证书路径不在 DMS 配置卷中；为避免重启后丢失证书，已取消安装。')
        for path in (cert_path, key_path):
            run(['docker', 'exec', 'docker-mailserver', 'mkdir', '-p', str(Path(path).parent)])
        # Certbot's live/ entries are relative symlinks into archive/. Copying
        # the link itself leaves a dangling /tmp/archive/... path inside DMS.
        # Resolve both source links, and remove any stale destination symlink
        # before docker cp (otherwise Docker follows it into the missing archive).
        for path in (cert_path, key_path):
            run(['docker', 'exec', 'docker-mailserver', 'rm', '-f', path])
        run(['docker', 'cp', str(cert.resolve(strict=True)), f'docker-mailserver:{cert_path}'])
        run(['docker', 'cp', str(key.resolve(strict=True)), f'docker-mailserver:{key_path}'])
        run(['docker', 'exec', 'docker-mailserver', 'chmod', '600', key_path])
        run(['docker', 'restart', '--time', '60', 'docker-mailserver'], timeout=90)
        self.state['mailFingerprint'] = fingerprint
        self.state.setdefault('certificates', {})['mail'] = {'host': host, 'daysRemaining': self.cert_valid_days(host)}
        self.save()
        return True

    def issue_mail(self, force=False):
        host = self.mail_host_name()
        self.dns_check(host)
        if not os.path.isfile(DOCKER) or not os.access(DOCKER, os.X_OK):
            raise RuntimeError(f'证书助手内缺少 Docker CLI（检查路径：{DOCKER}）。请重建证书助手镜像。')
        if self.shared_caddy_mode():
            self.configure_host_caddy()
        days = self.cert_valid_days(host)
        if days is not None and days > 30 and not force:
            self.log(f'{host} 证书有效期还有 {days} 天，无需续签')
            self.install_mail_certificate(host)
            return
        self.log(f'正在为邮件主机 {host} 申请/续签证书；需要公网 TCP 80 可达，Cloudflare 代理需暂时关闭')
        if run(['docker', 'image', 'inspect', ACME_IMAGE], check=False).returncode:
            run(['docker', 'pull', ACME_IMAGE], timeout=300)
        try:
            if self.shared_caddy_mode():
                self.run_certbot(host, webroot=True)
            else:
                self.pause_for_acme()
                self.run_certbot(host)
        finally:
            self.recover()
        self.install_mail_certificate(host)
        self.log(f'邮件证书已安装到 docker-mailserver：{host}')

    def configure_panel_tls(self, host):
        self.nginx_config(host)
        days = self.cert_valid_days(host)
        self.state['mode'] = 'nginx'
        self.state['certificates']['panel'] = {'host': host, 'daysRemaining': days}
        self.state['autoRenew'] = True
        self.state['error'] = None
        self.log(f'{host} 证书已安装；自动续期已启用')

    def status(self):
        mail_host = self.env.get('MAIL_HOSTNAME', '')
        mail_info = self.certificate_info(mail_host, installed=True) if mail_host else None
        if self.shared_caddy_mode():
            host = self.env.get('PANEL_HOSTNAME', '')
            days = self.served_cert_days(host) if host else None
            certificates = {'panel': {'host': host, 'daysRemaining': days}}
            if mail_info:
                certificates['mail'] = mail_info
            self.state.update({'mode': 'host-caddy', 'provider': '宿主机 Caddy', 'autoRenew': True,
                               'certificates': certificates})
            if not self.state.get('running') and not self.state.get('message'):
                self.state['message'] = '面板证书由宿主机 Caddy 自动申请和续期。'
            print(json.dumps(self.state, ensure_ascii=False))
            return
        if not self.shared_nginx_mode():
            host = self.env.get('PANEL_HOSTNAME', '')
            days = self.served_cert_days(host) if host else None
            certificates = {'panel': {'host': host, 'daysRemaining': days}}
            if mail_info:
                certificates['mail'] = mail_info
            self.state.update({'mode': 'caddy', 'provider': 'Caddy', 'autoRenew': True,
                               'certificates': certificates})
            if not self.state.get('running') and not self.state.get('message'):
                self.state['message'] = 'Caddy 自动申请和续期面板证书。'
            print(json.dumps(self.state, ensure_ascii=False))
            return
        host = self.host_name()
        days = self.cert_valid_days(host)
        certificates = {'panel': {'host': host, 'daysRemaining': days}}
        if mail_info:
            certificates['mail'] = mail_info
        self.state['certificates'] = certificates
        self.state['autoRenew'] = self.state.get('mode') == 'nginx'
        print(json.dumps(self.state, ensure_ascii=False))

    def install_timer(self):
        executable = '/usr/bin/docker exec clover-certificate-helper python3 /app/certificates.py renew'
        service = '[Unit]\nDescription=Clover panel certificate renewal\nAfter=docker.service network-online.target\n\n[Service]\nType=oneshot\nExecStart=' + executable + '\nTimeoutStartSec=8min\n'
        timer = '[Unit]\nDescription=Check Clover panel certificate twice daily\n\n[Timer]\nOnCalendar=*-*-* 03,15:00:00\nRandomizedDelaySec=1800\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n'
        atomic(HOST / 'etc/systemd/system/clover-certificates.service', service, 0o644)
        atomic(HOST / 'etc/systemd/system/clover-certificates.timer', timer, 0o644)
        host_run('/usr/bin/systemctl', 'daemon-reload')
        host_run('/usr/bin/systemctl', 'enable', '--now', 'clover-certificates.timer')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['issue', 'issue-mail', 'renew', 'status', 'recover'])
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    manager = Manager()
    manager.data.mkdir(parents=True, exist_ok=True)
    if args.action == 'recover':
        manager.recover()
        return
    if args.action == 'status':
        manager.status()
        return
    with (manager.data / 'job.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('已有证书任务正在执行，请稍后再试') from error
        manager.state['running'] = True
        manager.state['error'] = None
        manager.save()
        manager.log('证书任务开始…')
        try:
            manager.recover()
            if args.action == 'issue':
                manager.issue(force=args.force)
            elif args.action == 'issue-mail':
                manager.issue_mail(force=args.force)
            elif args.action == 'renew':
                if manager.shared_nginx_mode():
                    manager.issue()
                elif manager.shared_caddy_mode():
                    manager.configure_host_caddy()
                if manager.env.get('MAIL_HOSTNAME'):
                    manager.issue_mail()
            manager.install_timer()
        except Exception as error:
            manager.state['error'] = str(error)
            manager.log('证书任务失败：' + str(error))
            raise
        finally:
            manager.state['running'] = False
            manager.save()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('[证书] ' + str(error), file=sys.stderr, flush=True)
        sys.exit(1)
