#!/usr/bin/env python3
"""Safely reuse a systemd-managed host Caddy for Clover's public entrypoint."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

BEGIN = "# BEGIN CLOVER MANAGED IMPORT"
END = "# END CLOVER MANAGED IMPORT"
SERVICE = "caddy.service"
SNIPPET_HEADER = "# Managed by Clover host Caddy integration\n"


def command(args, timeout=30, check=True):
    result = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
    if check and result.returncode:
        detail = (result.stderr or result.stdout or "command failed").strip()
        raise RuntimeError(detail[-1800:])
    return result


def systemd_config():
    if command(["systemctl", "is-active", "--quiet", SERVICE], check=False).returncode:
        return None
    result = command(["systemctl", "show", "--property=MainPID", "--value", SERVICE], check=False)
    if result.returncode or not result.stdout.strip().isdigit():
        return None
    pid = result.stdout.strip()
    try:
        argv = [item.decode() for item in Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0") if item]
    except OSError:
        return None
    if not argv or "caddy" not in Path(argv[0]).name.lower() or "run" not in argv[1:3]:
        return None
    config = None
    adapter = None
    for index, value in enumerate(argv):
        if value == "--config" and index + 1 < len(argv):
            config = argv[index + 1]
        elif value.startswith("--config="):
            config = value.split("=", 1)[1]
        elif value == "--adapter" and index + 1 < len(argv):
            adapter = argv[index + 1]
        elif value.startswith("--adapter="):
            adapter = value.split("=", 1)[1]
    if not config or not Path(config).is_absolute() or (adapter and adapter != "caddyfile"):
        return None
    if not Path(config).is_file():
        return None

    saw_caddy = False
    for port in (80, 443):
        listeners = command(["ss", "-H", "-ltnp", f"sport = :{port}"], check=False).stdout.splitlines()
        for line in listeners:
            fields = line.split()
            if 'users:(("caddy",' not in line or len(fields) < 6:
                return None
            if fields[3] not in {f"*:{port}", f"0.0.0.0:{port}"}:
                return None
            saw_caddy = True
    if not saw_caddy:
        return None
    binary = argv[0] if Path(argv[0]).is_file() else shutil.which("caddy")
    if not binary or not Path(binary).is_file():
        return None
    return config, binary


def caddy_string(value):
    return json.dumps(str(value), ensure_ascii=False)


def replace_block(source, begin, end, block):
    start = source.find(begin)
    finish = source.find(end)
    if (start < 0) != (finish < 0) or (start >= 0 and finish < start):
        raise RuntimeError("Caddy 配置中的 Clover 标记不完整；为避免覆盖手动配置，已停止修改。")
    if start >= 0:
        finish += len(end)
        return source[:start] + block + source[finish:]
    return source.rstrip() + "\n\n" + block + "\n"


def atomic_write(path, data, mode=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    old_stat = path.stat() if path.exists() else None
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, mode if mode is not None else (old_stat.st_mode & 0o777 if old_stat else 0o644))
        if old_stat:
            os.chown(temporary, old_stat.st_uid, old_stat.st_gid)
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def restore(snapshots):
    for path, saved in snapshots.items():
        if saved is None:
            path.unlink(missing_ok=True)
        else:
            data, mode, uid, gid = saved
            atomic_write(path, data, mode)
            os.chown(path, uid, gid)


def snapshot(path):
    if not path.exists():
        return None
    info = path.stat()
    return path.read_bytes(), info.st_mode & 0o777, info.st_uid, info.st_gid


def adapted_hosts(binary, config, host_root):
    args = [binary, "adapt", "--config", str(config), "--adapter", "caddyfile", "--pretty"]
    if host_root != Path("/"):
        args = ["chroot", str(host_root), *args]
    result = command(args)
    document = json.loads(result.stdout)
    hosts = set()

    def walk(value):
        if isinstance(value, dict):
            matcher = value.get("match")
            if isinstance(matcher, list):
                for item in matcher:
                    if isinstance(item, dict) and isinstance(item.get("host"), list):
                        hosts.update(str(host).lower() for host in item["host"])
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(document)
    return hosts


def validate_host(host):
    if not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}", host):
        raise RuntimeError(f"无效的 Caddy 域名：{host}")


def configure(args):
    panel_host = args.panel_host.lower().rstrip(".")
    mail_host = args.mail_host.lower().rstrip(".")
    validate_host(panel_host)
    validate_host(mail_host)
    if not re.fullmatch(r"\d{1,5}", args.backend_port) or int(args.backend_port) not in range(1, 65536):
        raise RuntimeError("内部 Caddy 端口无效。")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", args.acme_email):
        raise RuntimeError("ACME 邮箱格式无效。")
    if not str(Path(args.project_home)).startswith("/"):
        raise RuntimeError("CLOVER_HOME 必须是宿主机绝对路径。")

    host_root = Path(args.host_root).resolve()
    config = Path(args.config)
    if not config.is_absolute():
        raise RuntimeError("Caddy 配置路径必须是绝对路径。")
    host_config = host_root / str(config).lstrip("/")
    if not host_config.is_file():
        raise RuntimeError(f"找不到宿主机 Caddy 配置：{config}")
    binary = args.binary
    if not binary.startswith("/"):
        raise RuntimeError("Caddy 可执行文件路径必须是绝对路径。")
    host_binary = host_root / binary.lstrip("/")
    if not host_binary.is_file():
        raise RuntimeError(f"找不到宿主机 Caddy 可执行文件：{binary}")

    snippets_dir = config.parent / "clover.d"
    import_glob = str(snippets_dir / "*.caddy")
    import_line = f"import {caddy_string(import_glob)}"
    source = host_config.read_text(encoding="utf-8")
    import_block = f"{BEGIN}\n{import_line}\n{END}"
    if import_glob in source and BEGIN not in source:
        updated_source = source
    else:
        updated_source = replace_block(source, BEGIN, END, import_block)

    panel_file = host_root / str((snippets_dir / "clover-panel.caddy")).lstrip("/")
    mail_file = host_root / str((snippets_dir / "clover-mail-acme.caddy")).lstrip("/")
    panel_snippet = (
        f"{SNIPPET_HEADER}{panel_host} {{\n"
        f"    tls {args.acme_email}\n"
        f"    reverse_proxy 127.0.0.1:{args.backend_port}\n"
        f"}}\n"
    ).encode()
    webroot = Path(args.project_home) / "deploy" / "acme" / "webroot"
    mail_snippet = (
        f"{SNIPPET_HEADER}http://{mail_host} {{\n"
        "    handle /.well-known/acme-challenge/* {\n"
        f"        root * {caddy_string(str(webroot))}\n"
        "        file_server\n"
        "    }\n"
        '    respond "Not Found" 404\n'
        "}\n"
    ).encode()

    for path in (panel_file, mail_file):
        if path.exists() and not path.read_text(encoding="utf-8", errors="replace").startswith(SNIPPET_HEADER):
            raise RuntimeError(f"{path} 已存在且不由 Clover 管理；为避免覆盖现有配置，已停止修改。")

    if (host_config.read_text(encoding="utf-8") == updated_source
            and panel_file.is_file() and panel_file.read_bytes() == panel_snippet
            and mail_file.is_file() and mail_file.read_bytes() == mail_snippet):
        print("宿主机 Caddy 已有 Clover 路由配置，无需重载。")
        return

    # Do not silently combine Clover routes with an unrelated site using the same host.
    existing_hosts = adapted_hosts(binary, config, host_root)
    owned_source = "\n".join(
        path.read_text(encoding="utf-8", errors="replace")
        for path in (panel_file, mail_file) if path.is_file()
    )
    owned_hosts = set(re.findall(r"(?m)^\s*(?:http://)?([a-z0-9.-]+)\s*\{", owned_source))
    for hostname in {panel_host, mail_host}:
        if hostname in existing_hosts and hostname not in owned_hosts:
            raise RuntimeError(f"宿主机 Caddy 已有站点使用 {hostname}；没有覆盖它，请换面板/邮件主机名或先整理现有路由。")

    snapshots = {host_config: snapshot(host_config), panel_file: snapshot(panel_file), mail_file: snapshot(mail_file)}
    if BEGIN not in source:
        backup = host_config.with_name(f"{host_config.name}.clover-backup-{time.strftime('%Y%m%d%H%M%S')}-{time.time_ns()}")
        shutil.copy2(host_config, backup)
    try:
        atomic_write(host_config, updated_source.encode("utf-8"))
        atomic_write(panel_file, panel_snippet)
        atomic_write(mail_file, mail_snippet)
        validate = [binary, "validate", "--config", str(config)]
        reload = ["systemctl", "reload", SERVICE]
        if host_root != Path("/"):
            validate = ["chroot", str(host_root), *validate]
            reload = ["chroot", str(host_root), "/usr/bin/systemctl", "reload", SERVICE]
        command(validate, timeout=45)
        command(reload, timeout=45)
    except Exception:
        restore(snapshots)
        try:
            command(reload, timeout=45, check=False)
        except Exception:
            pass
        raise
    print(f"宿主机 Caddy 已重载：{panel_host} → 127.0.0.1:{args.backend_port}；邮件 HTTP-01 使用 webroot。")


def configure_environment(host_root, env_file):
    values = {}
    for line in Path(env_file).read_text(encoding="utf-8").splitlines():
        if re.match(r"^[A-Z_][A-Z0-9_]*=", line):
            key, value = line.split("=", 1)
            values[key] = value.strip()
    required = {
        "config": "CLOVER_HOST_CADDY_CONFIG",
        "binary": "CLOVER_HOST_CADDY_BIN",
        "project_home": "CLOVER_HOME",
        "panel_host": "PANEL_HOSTNAME",
        "mail_host": "MAIL_HOSTNAME",
        "acme_email": "ACME_EMAIL",
    }
    missing = [key for key, name in required.items() if not values.get(name)]
    if missing:
        raise RuntimeError(".env 缺少宿主机 Caddy 配置项：" + ", ".join(required[key] for key in missing))
    args = argparse.Namespace(
        host_root=host_root,
        config=values["CLOVER_HOST_CADDY_CONFIG"],
        binary=values["CLOVER_HOST_CADDY_BIN"],
        project_home=values["CLOVER_HOME"],
        panel_host=values["PANEL_HOSTNAME"],
        mail_host=values["MAIL_HOSTNAME"],
        backend_port=values.get("CLOVER_HTTP_PORT", "18080"),
        acme_email=values["ACME_EMAIL"],
    )
    configure(args)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="action", required=True)
    subparsers.add_parser("detect", help="识别占用 80/443 的 systemd Caddy")
    env_parser = subparsers.add_parser("configure-env", help="根据当前目录的 .env 安装或更新宿主机 Caddy 路由")
    env_parser.add_argument("--host-root", default="/", help="宿主机根目录；证书助手中使用 /host")
    env_parser.add_argument("--env-file", default=".env", help="Clover .env 文件路径")
    apply_parser = subparsers.add_parser("configure", help="安装或更新 Clover 的宿主机 Caddy 路由")
    apply_parser.add_argument("--host-root", default="/", help="宿主机根目录；证书助手中使用 /host")
    apply_parser.add_argument("--config", required=True, help="正在运行的 Caddyfile")
    apply_parser.add_argument("--binary", required=True, help="正在运行的 Caddy 可执行文件")
    apply_parser.add_argument("--project-home", required=True, help="Clover 宿主机安装目录")
    apply_parser.add_argument("--panel-host", required=True)
    apply_parser.add_argument("--mail-host", required=True)
    apply_parser.add_argument("--backend-port", required=True)
    apply_parser.add_argument("--acme-email", required=True)
    args = parser.parse_args()
    if args.action == "detect":
        result = systemd_config()
        if not result:
            return 1
        print("|".join(result))
        return 0
    if args.action == "configure-env":
        configure_environment(args.host_root, args.env_file)
    else:
        configure(args)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"[host-caddy] {error}", file=sys.stderr)
        sys.exit(1)
