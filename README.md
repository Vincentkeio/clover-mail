**English** | [简体中文](README.zh-CN.md)

# clover Mail 🍀

Run your own mail service on a server you control, and manage domains, mailboxes and forwarding rules from a web panel.

## Features

- **Visual management**: Manage multiple domains, mailboxes, passwords and forwards in one place, with aliases, prefix matching and catch-all support.
- **Automatic Cloudflare DNS**: Import a domain and generate plus push MX, SPF, DKIM and DMARC records in one click — or export them and configure DNS by hand.
- **Roundcube Webmail**: Pick a mailbox in the panel and open it in a new tab without signing in again; the full native search, flags, folders, composer and address book are available.
- **Mail client compatibility**: IMAP, POP3, SMTP and ManageSieve, so Thunderbird, Foxmail, Apple Mail and similar clients all work.
- **Global mail settings**: Manage protocol toggles, remote image policy and attachment limits together; the default attachment limit is 100 MB and can be set to unlimited.
- **Certificates and operations**: HTTPS and mail TLS certificate management with automatic renewal, plus entry points for environment checks, spam statistics, the mail queue, logs and backups.
- **Updates and restarts**: Update checks use numeric versions such as `1.0.3`, and a new release is announced on the first sign-in of each day; updates run only after you confirm, and sync scripts, configuration and images.
- **Account security and API**: Single-administrator model with two-step verification, passkeys, API tokens and an audit log.
- **English and Chinese interface**: The panel ships both languages, switchable at the bottom of the sidebar and defaulting to English. Your choice is remembered, and the messages returned by the API follow it too.

## Before you install

- A Debian 11–13 or Ubuntu 22.04+ server; the published image supports **amd64** by default.
- Minimum: **1 vCPU, 2 GB RAM**. Recommended: **2 vCPU, 4 GB RAM**.
- A panel domain and a mail domain, with the panel domain's A record pointing at the server's public IP.
- Ports **80, 443 and 25** open to the public; open **465, 587 and 993** as needed for mail clients, and **995** for POP3S.
- Confirmation that your provider allows mail traffic and supports PTR/rDNS records.

The installer can install Docker for you. If the host already runs a supported Caddy or Nginx, Clover can share that web entry point.

## Quick install

The one-line installer is recommended:

```bash
curl -fsSL https://raw.githubusercontent.com/Vincentkeio/clover-mail/main/bootstrap.sh -o /tmp/clover-bootstrap.sh
bash /tmp/clover-bootstrap.sh
```

You can also clone the repository and install:

```bash
git clone https://github.com/Vincentkeio/clover-mail.git clover
cd clover
bash install.sh
```

Answer the prompts for your panel domain. The first install prints a randomly generated administrator name and password in the terminal — save them, then sign in to the panel.

### Docker Compose install

This path suits a Linux server that already has Docker and Compose v2 and can take exclusive use of the required ports such as 80/443. Run it as root on the server:

```bash
git clone https://github.com/Vincentkeio/clover-mail.git clover
cd clover
cp .env.example .env
nano .env
```

Set `PANEL_HOSTNAME`, `MAIL_DOMAIN`, `MAIL_HOSTNAME` and `ACME_EMAIL` to your own domain and address; you can also fill in `CLOVER_VPS_IP`, adjust the time zone and set other parameters. For a first install, leave the secret values at their template defaults or empty — initialization generates them.

Save the file and run one command to install:

```bash
CLOVER_HOME="$PWD" docker compose --profile install run --rm installer
```

Compose initialization generates secrets, prepares mail TLS, starts the services, creates the administrator and installs the `clover` shortcut. The administrator credentials are printed in the terminal; existing data and administrators are preserved. Afterwards you can start the services with `docker compose up -d`. If an existing host Nginx or Caddy must share the ports, use the recommended installer above instead.

## Getting started

1. **Setup**: Connect Cloudflare, pick your mail domain and set the mail hostname, then generate and push the DNS records.
2. **Checks**: Check DNS, ports and TLS certificates; issue a certificate for the mail host and set PTR/rDNS with your server provider.
3. **Mailboxes**: Create mailboxes and passwords; for forwarding, add rules under “Aliases & forwarding”.
4. **Webmail**: Select a mailbox and click “Open Roundcube”, or connect a mail client following the [client setup guide](docs/mail-client-setup.md) (Chinese).

The Cloudflare token needs zone read and DNS edit permission for the target domain. The mail host's A record should be set to **DNS only**.
The first mail certificate may be self-signed, so issue a trusted one before connecting clients. Whether mail is delivered also depends on your server IP's reputation, its PTR record and the recipient's policies.

## Updates and routine management

Type `clover` on the server to open the management menu, or run these directly:

```bash
clover status       # show service status
clover update       # update
clover logs         # show logs
clover backup       # back up the panel database and mail configuration
clover admin list   # list administrators
```

“Backups and account reconciliation” on the settings page lets you download the panel database and the mail configuration separately, and import either file. A database backup contains only panel management data; a mail configuration backup contains the mail service's account configuration, keys and similar files. Neither includes mail bodies, the Roundcube address book or preferences.

Server-side automatic backups are stored in the project directory's `backups/` folder. After a complete backup succeeds, only the latest database and mail-configuration set is retained. A panel update first creates a database rollback snapshot; it removes that duplicate after the complete backup succeeds and keeps the newest rollback snapshot if the backup fails. Legacy update entry points also trigger the refreshed backup retention and cleanup on the first upgrade. Before pulling, Clover records both its container images and current Compose image references. Once services pass health checks, it removes unused recorded images and old previews carrying Clover source labels. Cache removal is limited to its dedicated builder or individually identifiable private Clover records. Shared layers, other-project tags, images with unknown ownership and all data volumes are preserved.

To migrate a whole Clover instance, use the separate “One-click migration” module on the settings page: export an encrypted migration package on the source VPS with a passphrase of at least 12 characters; on the target VPS upload that file, enter the same passphrase and type `RESTORE` to confirm the overwrite. The package covers the mail and Roundcube data volumes, the panel database, the mail configuration and the project deployment configuration. Mail and WebMail pause briefly during export to keep the data consistent; restoring overwrites the target instance's Clover data volumes and configuration and restarts the services, so run it on a new VPS or one you have confirmed may be overwritten.

After migrating, check the target VPS's public IP, the DNS A/AAAA, MX and PTR records, cloud firewall rules and the mail TLS certificate. The package does not include provider-side DNS, network or firewall settings, nor system-level configuration; the migration passphrase is not stored in the package, so keep it somewhere safe separately.

Full migration walkthrough (old VPS → new VPS):

1. On the old VPS, open “One-click migration” on the settings page, set a passphrase and export the `.clover` file. Wait for the browser download to finish, and do not change mailbox accounts or service configuration while it exports.
2. Install the same Clover version on the new VPS following the steps above and sign in once. The target instance needs the corresponding Docker volumes to exist.
3. On the new VPS, choose the file under “One-click migration”, enter the original passphrase and `RESTORE`, then click “Import and restore”. Existing data on the target instance is overwritten.
4. Wait for the restore and service restart. After the database and keys switch over you may need to sign in again with the old VPS panel account; the project directory adapts to the new VPS's `CLOVER_HOME`.
5. Verify mailboxes, aliases and forwards, past mail, and the Roundcube address book and preferences; then move DNS to the new IP and check PTR, ports and certificates.

A full migration package covers:

| Volume or configuration | What is restored |
| --- | --- |
| `panel-data` | Panel database and panel persistent files |
| `mail-data`, `mail-state`, `mail-config` | Mail bodies, mail service persistent state, account and forwarding configuration, keys |
| `roundcube-db`, `roundcube-policy` | Address book, preferences and mailbox access policy |
| `caddy-data`, `caddy-config` | Caddy persistent data and certificate state |
| Project configuration | `.env`, Compose, Caddy configuration, deployment files, scripts and the panel source when available |

If a restore fails, the task log is at `backups/migration-<task id>.log` in the project directory on the server.

Updates preserve configuration and Docker volumes. Back up before updating; the default backup **does not include mail bodies or the Roundcube address book and preferences**, so back up those volumes separately.
If the administrator password is lost, run `clover admin reset <username>` on the server.

## Data and security

- Mail and configuration live in Docker volumes on the server; the Roundcube address book and preferences are stored separately.
- `.env` holds service secrets — keep it safe and never upload it publicly.
- The panel has a single administrator; the password-free Webmail entry lets that administrator open any selected mailbox.
- Back up your mail and panel data regularly.

## License

Clover is licensed under the [GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)](LICENSE); see [NOTICE](NOTICE) for the copyright and project attribution terms. If you modify and distribute Clover, or offer a modified version covered by the AGPL to users over a network, you must provide the corresponding source code and keep the existing notices and attribution. Modified versions must be clearly identified as modified and must not be presented as official releases. The Clover name and marks grant no trademark rights. Third-party components such as Roundcube and docker-mailserver follow their own open-source licenses.
