# clover 三叶草邮局 🍀

自托管 Docker 邮局：一条 compose 命令部署在 Debian/Ubuntu VPS 上，用现代化的 Web 面板管理域名、邮箱、别名与 Catch-all，内置 rspamd 反垃圾，DNS 记录**一键推送 Cloudflare**（PurelyMail / MIAB 都只做到复制粘贴，这是 clover 的核心差异化）。用法对标 PurelyMail，但运行在你自己的 VPS 上。

> **当前版本：v0.1.0-alpha（Alpha）**；M0–M5 功能已完成，仍在持续验收与改进。
> 规划全文见 [docs/plan.md](docs/plan.md)；VPS 真机验收清单见 [docs/m0-checklist.md](docs/m0-checklist.md)。
> 锁定选型：**Next.js 单体面板 · SQLite · MIT · 单管理员 · Clover 内置 WebMail**

## 架构

```
                        Internet
                           |
      IMAP/SMTP 客户端      |   外部 MX 投递
             |             |        ^
             v             |        | 25/465/587
        +---------+        |        |
        |  Caddy  |<-------+--------+   （HTTPS 入口，自动证书）
        +----+----+
             | /（后续 /webmail、/rspamd）
             v
   +--------------------+   docker exec    +----------------------+
   |   clover-panel     | ---------------> |  docker-mailserver  |
   | Next.js + SQLite   |  内部 setup CLI  | postfix/dovecot/     |
   | UI + API + 控制面   |  （账号唯一落地通道）| rspamd/clamav        |
   +--------------------+                  +----------------------+
        |         ^
        |         | 每日对账 cron（POST /api/v1/system/reconcile）
        v         |
   +--------------------+
   |  SQLite（唯一事实源）|
   +--------------------+
```

## 快速开始（VPS）

**要求**：Debian 11–13 / Ubuntu 22.04+（宿主机内核 ≥ 5.10，Debian ≤10 / CentOS 7 不承诺），x86_64 / aarch64，Docker ≥ 24 + compose v2。最低可用配置为 **2 vCPU、2 GB RAM、至少 1 GB Swap**，并关闭 ClamAV；推荐 **2 vCPU、4 GB RAM**，可启用 ClamAV 并留出更充足的运行余量。Swap 只能缓冲短时内存峰值，不能替代 RAM。安装前先为面板域名添加 A 记录指向 VPS 公网 IP，并确保公网 80/443 可达。若 systemd 管理的宿主机 Caddy 已占用 80/443，安装器会保留现有站点，把 Clover Docker Caddy 绑定到本机内部端口，再由宿主机 Caddy 反代并管理面板 HTTPS；邮件证书通过 HTTP-01 webroot 验证。若宿主机由 systemd 或 aaPanel 管理的 nginx 占用端口，安装器仍会使用 Nginx 共享入口。邮件域名、邮件主机名和 rDNS 可在登录面板后配置；邮件收发还需 VPS 商放行 25/465/587 端口。

```bash
# 方式一（推荐）：一条命令，无需 git clone
curl -fsSL https://raw.githubusercontent.com/Vincentkeio/clover-mail/main/bootstrap.sh -o /tmp/clover-bootstrap.sh && bash /tmp/clover-bootstrap.sh

# 方式二：克隆后安装（包含面板源码）
git clone https://github.com/Vincentkeio/clover-mail.git clover && cd clover && bash install.sh

# 方式三：用 Alpha 发布包（只有 compose/脚本，面板从 GHCR 拉镜像）
curl -fL https://github.com/Vincentkeio/clover-mail/releases/download/v0.1.0-alpha/clover.tar.gz -o /tmp/clover-alpha.tar.gz
mkdir -p clover && tar xzf /tmp/clover-alpha.tar.gz -C clover --strip-components=1 && cd clover && bash install.sh
```

**一键安装脚本（v1）**支持三种用法：

```bash
bash install.sh --dry-run            # 只打印将要执行的动作，零改动（可先跑一遍看流程）
bash install.sh --non-interactive    # 参数取自环境变量，适合自动化
```

若安装目录已存在 `.env`，一键脚本会询问安装方式：覆盖部署并保留 `.env`、邮件/账户数据卷、证书和备份；或输入确认词后清除 Clover 数据并全新安装。取消则不会更改旧实例。升级不走安装脚本，使用面板的更新提示，或登录服务器手动运行 `clover update`（也可在安装目录执行 `bash scripts/upgrade.sh`）。

安装完成后会提供 `clover` 快捷命令。运行 `clover` 可打开运维菜单，查看状态、重启、更新、修复重部署、查看服务日志、立即备份或卸载。修复重部署会保留配置和邮件数据；删除数据卷需要单独输入确认语句。

也可直接运行常用子命令：

```bash
clover status
clover restart
clover update
clover logs
clover backup
clover admin create
clover admin list
clover admin reset <用户名>
```

安装器会：校验系统/架构/内核/内存/磁盘 → 检查（必要时安装）Docker → 检查端口占用并识别可共享的宿主机入口 → 探测公网 IP → 只收集面板域名与时区 → 生成随机 `SESSION_SECRET`/`RECONCILE_TOKEN` 写进 `.env`（权限 600）
→ 拉镜像并 `docker compose up -d` → 在容器内轮询 `/api/health` → 打印面板地址和后续配置步骤。登录后连接 Cloudflare，选择邮件域名和邮件主机名，再由面板生成并推送邮件 DNS。
低于 2 GB RAM 的机器会自动关闭 `ENABLE_CLAMAV`。2 GB RAM 主机建议配置至少 1 GB Swap；若持续发生 Swap 换入换出或 OOM，应升级 RAM，而不是继续扩大 Swap。邮件证书签发使用 HTTP-01，公网 80 端口必须可达；改变容器的内部监听端口不能改变 Let’s Encrypt 的公网验证端口。Cloudflare 橙云代理下首次签发前需暂时设为 DNS only。

### 面板证书管理

面板「证书管理」显示面板和邮件主机正在使用的证书。独立安装时面板证书由 Clover Caddy 自动申请及续期；共享宿主机 Caddy 时由宿主机 Caddy 管理面板 HTTPS。邮件证书可在此页手动签发/检查续期，签发后自动安装到 DMS，证书助手每日检查并在续期后重载邮件服务。共享宿主机 Caddy 使用 webroot 响应邮件主机的 HTTP-01 验证，不会暂停现有站点；共享 Nginx 或 Clover Docker Caddy 时，邮件证书签发仍会短暂停入口以释放 80。签发前请确认邮件主机名 A 记录指向本机、Cloudflare 代理关闭，并在 VPS 防火墙或云安全组放行 80。

### 镜像与发布

- 面板镜像由 GitHub Actions 构建并发布到 **GHCR**：**`ghcr.io/vincentkeio/clover-panel:latest`**（另带 `:main` 与 `:sha-xxxxxxx` 可钉版本）
- **公开包，免登录拉取**：`docker pull ghcr.io/vincentkeio/clover-panel:latest` 直接可用
  （已实测：匿名凭据拉取成功 → 用发布镜像重建容器 → 面板全部页面正常）
- 工作流：`.github/workflows/publish-panel.yml`
  - push main / 打 `v*` tag → 自动构建（**默认 `linux/amd64`**）
  - **arm64 按需**：Actions 页 → Run workflow → platforms 选 `linux/amd64,linux/arm64`
    （arm64 走 QEMU 模拟编译 `better-sqlite3` 原生模块，实测既慢又易 OOM，故不放进默认流程）
- 当前 Alpha 安装包：GitHub Release `v0.1.0-alpha` 提供 `clover.tar.gz`；安装包使用 `.env.example` 固定拉取同版本 GHCR 面板镜像。发布包不包含面板源码。维护者可用 `scripts/package-release.sh` 生成版本包并上传到 Release。
  - 用内置 `GITHUB_TOKEN` 发布，**不需要**额外 PAT 的 Packages 权限
- `compose.yaml` 默认拉该镜像（固定 digest 见 GitHub Packages 页）；本地改代码构建：
  `docker compose -f compose.yaml -f compose.build.yaml up -d --build`
- 打发布包（只含 compose/脚本，不含源码）：`./scripts/package-release.sh` → `dist/clover-<日期>.tar.gz`

### 邮件 TLS 证书（587/465 认证发信必需）

**实机验证**：DMS 未配证书时 submission 端口不提供 STARTTLS，客户端会直接报
`STARTTLS extension not supported`，**无法认证发信**。`install.sh` 现在会自动生成自签证书并写
`SSL_TYPE=manual`（客户端需允许自签）。

要替换自签证书，请打开面板「面板设置 → TLS 证书」，在「邮件服务证书」卡片点击「签发 / 检查续期」。签发需要邮件主机名的 A 记录直连本机，公网 TCP 80 可达，Cloudflare 代理暂时关闭；共享宿主机 Caddy 时使用 webroot 验证，其余共享入口会在签发期间短暂停止并自动恢复。

## 实机验收结果（2026-10-12）

一键安装脚本在真机跑通，全链路验证：

| 项目 | 结果 |
|---|---|
| `install.sh` 实装 | ✔ 环境检查 → 检查 rDNS 配置 → 生成 .env → 拉镜像/构建 → 容器内健康检查 |
| 容器栈 | ✔ caddy(80/443) + panel(healthy) + docker-mailserver(healthy) |
| HTTPS 证书 | ✔ **真实 Let's Encrypt 证书**（Caddy 自动 ACME） |
| 面板初始化 | ✔ 安装/覆盖部署自动检查管理员；缺少时生成随机账号密码并在终端显示 → 登录 → 建域 → 建邮箱 → catchall 规则，公网不提供首次建号接口 |
| DNS 生成 | ✔ 归属 TXT/A/MX/SPF/**DKIM（解析 DMS 的 zone 格式公钥）**/DMARC；BIND 导出含 4 条 TXT |
| 对账 | ✔ `{"heal":true}` 零错误，prefix 正则表同步成功 |
| 反垃圾 / 队列 / 日志 | ✔ rspamd controller(11334) 统计、mailq、supervisorctl（含 STOPPED）、mail.log 全可读 |
| 投递体检 | ✔ DNSBL 五家全部查询成功 + 域健康五项 |
| prefix 规则下发 | ✔ 面板写 pcre 表 → `virtual_alias_maps` 生效（`texthash:/etc/postfix/virtual pcre:/tmp/...regex.cf`） |
| WebMail SSO | ✔ 首次打开时自动生成内部认证凭据并配置 DMS |
| **邮件投递** | 出站 ✔ SMTP 587 STARTTLS 认证发信 → **Gmail 接收**（`250 2.0.0 OK … gsmtp`）且 DKIM 已签名；入站需确认 VPS 服务商放行公网 TCP 25 |

> 测试提示：`amavis` 对缺 `Date` / `Message-ID` 头的消息会直接判 `BAD-HEADER-0` 并退信
> ——用脚本（Python smtplib 等）测发信时务必补上这两个头；真实邮件客户端都会自动带。

**实机验收中发现并修复的问题**：
pull 会让构建模式中止、镜像缺 python3/make/g++ 与 curl、DMS 16 无 `setup domain`、
DKIM 需 `setup config dkim` 且 `mail.txt` 是 zone 格式、rspamd 端口应为 11334、
`supervisorctl` 退出码 3 但 stdout 有效、user-patches 空目录挂载坑、
`postfix-main.cf` 合并早于补丁执行、DMS 无证书导致 587 无 STARTTLS。

**首次使用**：系统只允许一个管理员。安装器会检查管理员账户；如没有账户，会生成随机用户名和密码并在安装终端显示，请立即保存。保留数据覆盖部署也会执行相同检查，已有账户不会更改。随后浏览器打开 `https://<面板域名>` 登录。通过 `clover admin create` 创建新管理员会覆盖旧管理员，旧密码、两步验证与 Passkey 不会转移，旧登录会话会失效；快捷命令会要求输入 `REPLACE` 确认。管理员只能通过服务器 CLI 管理；公网 `/setup` 页面与建号 API 已关闭。密码至少 12 位；重置密码后所有浏览器会话会注销。

**手工验收清单**：装好之后想一步步点着验证（每个动作的预期结果、异常排查、已知限制）→ 见 [docs/manual-acceptance.md](docs/manual-acceptance.md)。

**邮箱客户端配置（IMAP / POP3 / SMTP，含各端步骤与排错）** → 见 [docs/mail-client-setup.md](docs/mail-client-setup.md)。

## 认证与安全

| 通道 | 说明 |
|---|---|
| 密码 | argon2id（OWASP 参数） |
| 两步验证 | TOTP（任意认证 App），设置页自助开启/关闭，登录需「密码 + 6 位码」 |
| Passkey | WebAuthn（指纹/面容/安全密钥），可注册多把、可删除，登录页一键登录 |
| API Token | `Authorization: Bearer clover_…`，覆盖全部 `/api/v1` 端点，明文仅创建时展示一次、库里只存 sha256、吊销即刻失效 |
| 面板 session | HMAC 无状态签名 cookie，httpOnly + SameSite=strict，12h |

敏感设置（CF Token / WebMail master 密码）AES-256-GCM 加密存储（密钥由 `SESSION_SECRET` 经 scrypt 派生）。
一切变更写审计日志（API token 调用记为 `api:<名字>`）。端点文档见面板 `/api-docs` 页面。

## 面板能力

- **域名管理**：添加/停用/删除域名，建域即生成 ownership TXT 与主机名约定；删除时级联清理 DMS 账号与 alias
- **邮箱管理**：按域创建/改密/配额/停用/删除，明文密码只在同步 DMS 的瞬间经 CLI 使用、不落库
- **路由规则（对标 PurelyMail 四类）**：`exact` 精确 / `prefix` 前缀 / `nonuser` 非用户 / `catchall` 全捕获，多目标转发、优先级排序；
  exact/nonuser/catchall 走 DMS 字面量 alias，**prefix 自动生成 Postfix pcre 正则表**（clover 独占文件，user-patches 接线，改完即 reload）
- **建域向导**：填域名 → DNS 记录预览 → 确认创建
- **WebMail**：面板内置轻量客户端，面板会话免密进入，服务端连接 IMAP/SMTP
- **监控**：rspamd 统计看板、邮件队列/服务进程/日志、投递体检（DNSBL + 域健康）
- **审计日志**：一切变更（含失败登录、二次验证失败）写 `audit_logs`

## 开放 API（面板即 API）

面板 UI 全部调用下列端点；它们同时就是开放 API（认证见上一节）。完整文档页面：面板内 `/api-docs`。

| 方法 | 端点 | 说明 |
|---|---|---|
| GET | `/api/v1/domains` | 域名列表（含邮箱/规则计数） |
| POST | `/api/v1/domains` | 建域 |
| GET/PATCH/DELETE | `/api/v1/domains/{id}` | 域详情 / 更新 / 删除 |
| GET/POST | `/api/v1/domains/{id}/mailboxes` | 邮箱列表 / 新建 |
| PATCH/DELETE | `/api/v1/mailboxes/{id}` | 改密·配额·停用 / 删除 |
| GET/POST | `/api/v1/domains/{id}/rules` | 规则列表 / 新建 |
| PATCH/DELETE | `/api/v1/rules/{id}` | 规则更新 / 删除 |
| GET/POST | `/api/v1/domains/{id}/dns` | DNS 记录列表 / 生成刷新 |
| POST | `/api/v1/domains/{id}/dns/push` | 推送到 Cloudflare（diff→batch，幂等） |
| POST | `/api/v1/domains/{id}/dns/check` | 公网检测 checklist（写回 dns_status） |
| GET | `/api/v1/domains/{id}/dns/export?format=bind\|text` | 导出 BIND 文件 / 纯文本清单 |
| GET/PATCH/DELETE | `/api/v1/settings` | 面板设置（VPS IP / CF Token 加密存储 / DMARC / SPF） |
| GET | `/api/v1/system/spam-stats` | rspamd 聚合统计（扫描/拒绝/符号 TopN/动作分布） |
| GET | `/api/v1/system/queue?lines=200` | 邮件队列 + 服务进程 + 日志尾部 |
| GET | `/api/v1/system/deliverability` | 投递体检（DNSBL 五家 + 域健康五项） |
| POST | `/api/v1/system/reconcile` | 对账（`{"heal":true}` 才自动修复） |
| GET | `/api/v1/system/backup?what=db\|dms-config` | 下载一致性备份（SQLite 快照 / DMS 配置 tar） |
| GET/POST/DELETE | `/api/v1/system/tokens` | API token 列表 / 创建 / 吊销 |
| GET/PATCH/DELETE | `/api/v1/auth/totp` | 两步验证状态 / 开启（POST 出二维码、PUT 确认）/ 关闭 |
| POST | `/api/v1/auth/webauthn/register/options\|verify` | 注册 Passkey（需登录） |
| GET/DELETE | `/api/v1/auth/webauthn/credentials` | Passkey 列表 / 删除 |
| POST | `/api/auth/webauthn/login/options\|verify` | Passkey 登录（公开） |

## 备份与恢复

```bash
./scripts/backup.sh        # 拉取 SQLite 一致性快照 + DMS 配置 tar 到 ./backups/，自动轮转
                           # 建议 cron：30 3 * * * cd /root/clover && ./scripts/backup.sh
```

- **db 快照**：`VACUUM INTO` 生成（WAL 模式下也一致），脚本用 `PRAGMA integrity_check` 校验
- **DMS 配置**：`docker exec … tar` 打包 `/tmp/docker-mailserver`（账号库、DKIM 私钥、证书、master user 等）
- **恢复步骤**：
  1. `docker compose down`
  2. DB：`docker run --rm -v clover_panel-data:/data -v $PWD/backups:/bk alpine cp /bk/clover-db-<时间>.db /data/clover.db`
     （或面板设置页重新初始化后用 SQLite 文件替换）
  3. DMS 配置：`docker run --rm -v clover_mail-config:/cfg -v $PWD/backups:/bk alpine sh -c 'rm -rf /cfg/* && tar xzf /bk/dms-config-<时间>.tar.gz -C /cfg'`
  4. `docker compose up -d`（DB 迁移会自动跑齐）
- **邮件正文**（`mail-data` 卷）体积大，默认不在脚本内；需要时单独 `docker run --rm -v clover_mail-data:/d -v $PWD/backups:/bk alpine tar czf /bk/mail-data-<时间>.tar.gz -C /d .`

## 升级

```bash
./scripts/upgrade.sh           # 升级前自动备份 → 更新源码 → compose pull → 重建面板 → 重启 → 健康检查
./scripts/upgrade.sh --no-pull # 只更新镜像，不动代码
```

Git 安装会执行 `git pull`；一键安装器创建的非 Git 目录会从 GitHub 下载最新源码。两种方式均保留 `.env`、本地备份、`deploy/acme` 证书和 Docker 数据卷。DB 迁移在面板启动时自动执行（幂等），无需手工跑 SQL。

## DNS 自动化（M2）

建域 → 生成器产出全套记录（归属 TXT / mail A / MX / SPF / DKIM / DMARC，进阶 autoconfig·MTA-STS·TLS-RPT 可选）→
**推送到 Cloudflare**（`dns_records/batch` 端点，CF 内部固定 deletes→patches→puts→posts 顺序；
以 `clover-*` comment 识别托管记录，diff 幂等，重复推送无副作用）→ 检测 checklist 逐项打勾 →
未配 CF Token 时一键导出 BIND 文件（粘到 CF「Import and Export」）或纯文本清单。

### 填一次 Token，全部域名一键配 DNS

面板 **Cloudflare** 页：填入 Token 后点「拉取我的域名」→ **列出你 CF 账号下所有 zone** →
勾选（或「全部导入并推送」）→ 每个域自动完成「建域 → 生成全套记录 → 推送 CF」。
已建好的域可点「把全部域推送到 Cloudflare」统一刷新（改完 DMARC/SPF 策略后用）。

脚本化等价入口：`POST /api/v1/cloudflare/import {"names":"all","push":true}`。

**Token 权限**：Cloudflare 后台 → My Profile → API Tokens → Create Token →
模板 **Edit zone DNS**（或自定义 `Zone → DNS → Edit`）→ Zone Resources 选你的域名；Token 只在创建时显示一次。
填到面板「设置 → Cloudflare Token」（AES-256-GCM 加密存储）。

**前提**：域名的 NS 必须已托管在 Cloudflare（CF 后台能看到该域）。rDNS/PTR 不在此列——它由 VPS 商控制，
只能去机房面板改（任何 DNS 服务商都碰不到反解），这是邮件送达率的关键项。

检测用 DNS-over-HTTPS（curl 走系统代理，跨平台）；DKIM 公钥按「DMS 容器 → 库内已存记录」兜底，
避免 DMS 不在线时误删 CF 上的 DKIM 记录。

## 每日对账

```bash
# VPS 宿主机 crontab（RECONCILE_TOKEN 写在 .env 里）
0 4 * * * curl -s -X POST https://<面板域名>/api/v1/system/reconcile \
  -H "Authorization: Bearer $(grep RECONCILE_TOKEN /root/clover/.env | cut -d= -f2)" \
  -H 'Content-Type: application/json' -d '{"heal":false}'
```

默认 dry-run 只报差异；确认报告无误后把 `heal` 改 `true`（自动补 alias、清理 DMS 侧多余 alias/账号）。DMS 侧缺失但 DB 有的邮箱无法自动重建（密码不可恢复），报告会点名。

## 本地开发（面板）

```bash
cd panel
npm install
npx drizzle-kit generate   # 由 schema 生成 migration（仓库已带则跳过）
npm run dev                # http://localhost:3000
```

常用命令：`npm run typecheck`、`npm run build`、`npm start`。

## 本地演示（可预览版本）

```bash
cd panel
npm run build
ALLOW_SEED=true DEMO_MODE=true SESSION_SECRET=any-16+-chars npm start
# 另开终端灌演示数据（域名/邮箱/规则/DNS/模拟 checklist）：
curl -X POST http://localhost:3000/api/dev/seed
```

打开 `http://localhost:3000` 即是已登录的演示面板。`ALLOW_SEED=true` 才允许种子接口；
`DEMO_MODE=true` 免登录（仅本地，生产环境严禁）。

## 目录结构

```
├── compose.yaml          # Caddy + clover-panel + docker-mailserver 单栈
├── caddy/Caddyfile       # HTTPS 入口（面板 / WebMail / rspamd 三路反代）
├── install.sh            # 全新安装器（--dry-run / --non-interactive）
├── scripts/
│   ├── backup.sh         # 备份（DB 一致性快照 + DMS 配置 tar + 轮转）
│   └── upgrade.sh        # 升级（自动备份 + 拉取 + 重建 + 健康检查）
├── deploy/
│   └── dms-user-patches.master-user.sh   # DMS 侧补丁模板（master user + prefix 正则表接线）
├── .env.example          # 参数模板（install.sh 据此生成 .env）
├── docs/
│   ├── plan.md           # 项目规划 v0.1（需求/调研/架构/数据模型/里程碑）
│   └── m0-checklist.md   # M0 真机验收清单（25 端口/rDNS/DNS/收发/送达率）
└── panel/                # Next.js 面板（SQLite + Drizzle + DMS CLI 封装）
    ├── src/app/          # 页面（概览/域名/向导/WebMail/监控/设置/API 文档）+ /api 控制面
    ├── src/db/           # Drizzle schema（唯一事实源，8 张表）
    ├── src/lib/          # dms / sync / reconcile / cloudflare / dns-generator / dns-check /
    │                     # dkim / prefix-sync / webmail / webauthn / totp / api-token / crypto
    └── src/middleware.ts # 全局登录守卫（/api/health、首启引导、Passkey 登录端点放行）
```

## WebMail

面板「WebMail」页选择已启用邮箱即可免密读写邮件。WebMail API 只接受 Clover 面板登录会话，
通过 Docker 内部网络连接 Dovecot IMAP TLS（993）与 Postfix STARTTLS（587）；主密码和 Dovecot
Master 凭据只留在服务端，不传给浏览器。首次使用会自动生成并加密保存内部认证凭据，写入 DMS 持久化配置，
邮件容器重启后仍会生效。邮件正文按纯文本呈现，不加载远程 HTML 内容。

客户端支持查看最近邮件、搜索当前列表、回复、撰写发送、标记未读、移入垃圾箱和 Junk 文件夹。
如果在 `.env` 开启 DMS 的 `RSPAMD_LEARN=1`，把邮件移入/移出 Junk 会反馈给 Rspamd。该 DMS 选项使用全局学习库，
只应在邮箱使用者可信时启用。先在「环境检查」完成邮件主机、邮件 TLS 和 IMAP 端口检查。

## 建域向导

`/domains/new` 三步：填域名（主机名可改）→ DNS 记录预览（复用生成器，提示 VPS IP 与 DKIM 补推时机）→
确认创建（建域 + 立即生成本地记录，推送 CF 在域详情页操作）。

## 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 骨架 | monorepo、compose 栈、安装器、真机收发验证 | 代码完成，真机验收待 VPS |
| M1 控制面 | 域名/邮箱/别名 CRUD + 四类路由规则 + 对账 | **完成** |
| M2 DNS 自动化 | DNS 生成器、CF 批量推送、检测 checklist、BIND 导出 | **完成**（真机推送待 VPS+Token） |
| M3 反垃圾与监控 | rspamd 统计看板、队列/日志视图、DNSBL 体检 | **完成**（真机数据待 VPS） |
| M4 产品化 | WebMail SSO、建域向导、Dashboard、TOTP、Passkey、prefix 下发 | **完成**（Passkey 仪式需浏览器/HTTPS 实机验证） |
| M5 打磨 | 一键安装器、备份/恢复、升级流程、开放 API token + `/api-docs` | **完成** |

### 真机验收待办（等 VPS + 域名 + CF Token）

1. `bash install.sh` 实跑 + 安装器生成/保留管理员并显示必要凭据 + 登录
2. 建域 → 推 CF（真 token）→ 「投递体检」五项全绿
3. 25 端口收发实测 + rDNS/送达率（`docs/m0-checklist.md` 逐项）
4. WebMail：面板首次自动配置内部认证，实测免密登录及邮件容器重启后的持久性
5. 监控页真数据（rspamd 统计/队列/日志）；Passkey 在 HTTPS 域名下用指纹/面容实测
6. DMS 镜像版本钉死 tag（当前 `latest`）；`/rspamd` 反代 assets 路径按需微调

## 许可证

MIT（底座 docker-mailserver 同为 MIT，无传染风险）。详见 [LICENSE](LICENSE)。
