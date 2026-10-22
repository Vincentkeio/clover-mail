[English](README.md) | **简体中文**

# clover 三叶草邮局 🍀

在自己的服务器上搭建邮件服务，通过 Web 面板管理域名、邮箱和转发规则。

## 功能特色

- **可视化管理**：集中管理多个域名、邮箱账户、密码和邮件转发，支持别名、前缀匹配与 Catch-all。
- **Cloudflare DNS 自动配置**：导入域名，一键生成并推送 MX、SPF、DKIM、DMARC 等邮件记录，也可导出后手动配置。
- **Roundcube Webmail**：从面板选择邮箱，在新标签页免密进入；使用原生搜索、星标、文件夹、编辑器和通讯录。
- **兼容邮件客户端**：支持 IMAP、POP3、SMTP 和 ManageSieve，可使用 Thunderbird、Foxmail、Apple Mail 等客户端。
- **全局邮箱设置**：统一管理协议开关、远程图片策略及附件上限；附件默认 100 MB，可设置为无限额。
- **证书与运维**：支持 HTTPS、邮件 TLS 证书管理和自动续期，提供环境检查、反垃圾统计、邮件队列、日志及备份入口。
- **更新与重启**：按 `1.0.3` 这样的数字版本检查更新，每日首次登录提示新版本；手动确认后更新，支持同步脚本、配置和镜像。
- **账户安全与 API**：单管理员管理，支持两步验证、Passkey、API Token 和审计日志。
- **中英文界面**：面板内置中英文两套文案，可在侧栏导航底部随时切换，默认英文；语言偏好会记住，接口返回的提示信息同步跟随。

## 安装准备

- Debian 11–13 或 Ubuntu 22.04+ 服务器；默认发布镜像支持 **amd64**。
- 最低配置：**1 vCPU、2 GB 内存**；推荐配置：**2 vCPU、4 GB 内存**。
- 准备一个面板域名和邮件域名，将面板域名的 A 记录指向服务器公网 IP。
- 公网开放 **80、443、25**；邮件客户端按需开放 **465、587、993**，POP3S 使用 **995**。
- 确认服务器提供商允许邮件收发，并支持设置 PTR/rDNS。

安装器可安装 Docker；已有受支持的宿主机 Caddy 或 Nginx 时，可共享 Web 入口。

## 快速安装

推荐使用一键安装：

```bash
curl -fsSL https://raw.githubusercontent.com/Vincentkeio/clover-mail/main/bootstrap.sh -o /tmp/clover-bootstrap.sh
bash /tmp/clover-bootstrap.sh
```

也可克隆仓库后安装：

```bash
git clone https://github.com/Vincentkeio/clover-mail.git clover
cd clover
bash install.sh
```

按提示填写面板域名。首次安装会在终端显示随机生成的管理员账号和密码，请保存后登录面板。

### Docker Compose 安装

适合已安装 Docker 和 Compose v2、可独占 80/443 等所需端口的 Linux 服务器。以 root 在服务器操作：

```bash
git clone https://github.com/Vincentkeio/clover-mail.git clover
cd clover
cp .env.example .env
nano .env
```

将 `PANEL_HOSTNAME`、`MAIL_DOMAIN`、`MAIL_HOSTNAME` 和 `ACME_EMAIL` 改为自己的域名和邮箱；可同时填写 `CLOVER_VPS_IP`、调整时区及其他参数。首次安装的密钥项保留模板值或留空即可，初始化会自动生成。

保存后运行一条命令完成安装：

```bash
CLOVER_HOME="$PWD" docker compose --profile install run --rm installer
```

Compose 初始化会生成密钥、准备邮件 TLS、启动服务、创建管理员并安装 `clover` 快捷命令。管理员凭据显示在终端；已有数据和管理员会保留。后续可直接用 `docker compose up -d` 启动服务。已有宿主机 Nginx/Caddy 需共享端口时，请使用上方推荐的安装器。

## 开始使用

1. **环境配置**：连接 Cloudflare，选择邮件域名并设置邮件主机名，生成和推送 DNS 记录。
2. **检查环境**：检查 DNS、端口及 TLS 证书；为邮件主机申请证书，并在服务器提供商处设置 PTR/rDNS。
3. **邮箱账户**：创建邮箱及密码；需要转发时，在“别名与转发”中添加规则。
4. **Webmail**：选择邮箱并点击“进入 Roundcube”，或按[客户端配置指南](docs/mail-client-setup.md)连接邮件客户端。

Cloudflare Token 需要目标域名的区域读取及 DNS 编辑权限。邮件主机的 A 记录应设为 **DNS only**。
首次邮件证书可能为自签证书，请在连接客户端前申请可信证书。邮件能否送达还取决于服务器 IP 信誉、PTR 和收件方策略。

## 更新与日常管理

在服务器输入 `clover` 打开管理菜单，或直接运行：

```bash
clover status       # 查看服务状态
clover update       # 更新
clover logs         # 查看日志
clover backup       # 备份面板数据库与邮件配置
clover admin list   # 查看管理员
```

设置页的“备份与账号对账”提供数据库和邮件配置的单独下载，也可导入这两类文件。数据库备份仅包含面板管理数据；邮件配置备份包含邮件服务账号配置、密钥等文件。单独备份不包含邮件正文、Roundcube 通讯录或偏好数据。

服务器端自动备份保存在项目目录的 `backups/`，每次完整备份成功后只保留最近一组数据库与邮件配置文件。面板更新会先保存数据库回滚快照；完整备份成功后删除重复快照，备份失败时保留最新回滚快照。更新通过健康检查后只清理 Clover 专用 Buildx 构建缓存，以及此前记录为本 Compose 项目使用、且不再被任何容器引用的旧镜像。共享 Docker 缓存、无法确认归属的镜像和邮件等数据卷都会保留。

如需迁移整台 Clover 实例，请使用设置页单独的“一键迁移”模块：在源 VPS 导出加密迁移包，输入至少 12 个字符的迁移口令；在目标 VPS 上传该文件并输入相同口令，键入 `RESTORE` 确认覆盖。迁移包包括邮件与 Roundcube 数据卷、面板数据库、邮件配置和项目部署配置。导出期间邮件与 WebMail 会短暂停止以保证数据一致；恢复会覆盖目标实例的 Clover 数据卷和配置并重启服务，因此应在新 VPS 或已确认可覆盖的目标机执行。

迁移完成后，请检查目标 VPS 的公网 IP、DNS 的 A/AAAA、MX、PTR、云防火墙规则和邮件 TLS 证书。迁移包不包含 VPS 提供商侧的 DNS、网络/防火墙设置及系统级配置；迁移口令不会保存在迁移文件中，应通过安全方式另行保存。

完整迁移示例（旧 VPS → 新 VPS）：

1. 在旧 VPS 的设置页打开“一键迁移”，设置迁移口令并导出 `.clover` 文件。等待浏览器下载完成，导出期间请勿修改邮箱账号或服务配置。
2. 按上方安装步骤，在新 VPS 安装相同版本的 Clover 并完成首次登录。目标实例需要已创建相应的 Docker 数据卷。
3. 在新 VPS 的“一键迁移”中选择文件，输入原迁移口令及 `RESTORE`，点击“导入并恢复”。目标实例原有数据会被覆盖。
4. 等待恢复及服务重启。数据库和密钥切换后，可能需要使用旧 VPS 的面板账号重新登录；项目目录会适配新 VPS 的 `CLOVER_HOME`。
5. 核对邮箱、别名与转发、历史邮件、Roundcube 通讯录及偏好，再将域名解析切换到新 IP，并检查 PTR、端口和证书。

完整迁移包覆盖以下内容：

| 数据卷或配置 | 恢复内容 |
| --- | --- |
| `panel-data` | 面板数据库及面板持久文件 |
| `mail-data`、`mail-state`、`mail-config` | 邮件正文、邮件服务持久状态、账号与转发配置、密钥 |
| `roundcube-db`、`roundcube-policy` | 通讯录、偏好和邮箱访问策略 |
| `caddy-data`、`caddy-config` | Caddy 持久数据和证书状态 |
| 项目配置 | `.env`、Compose、Caddy 配置、部署文件、脚本及可用的面板源码 |

恢复失败时，可在服务器项目目录的 `backups/migration-<任务编号>.log` 查看对应任务日志。

更新会保留配置和 Docker 数据卷。更新前请做好备份；默认备份**不包含邮件正文和 Roundcube 通讯录、偏好数据**，这些内容需另行备份对应数据卷。
管理员密码遗失时，在服务器运行 `clover admin reset <用户名>`。

## 数据与安全

- 邮件与配置保存在服务器的 Docker 数据卷中；Roundcube 的通讯录和偏好独立保存。
- `.env` 含服务密钥，请妥善保管，不要公开上传。
- 面板仅有一个管理员；免密 Webmail 入口允许管理员进入所选邮箱。
- 建议定期备份邮件和面板数据。

## 许可证

Clover 采用 [GNU Affero General Public License v3.0 或更高版本（AGPL-3.0-or-later）](LICENSE)，版权与项目来源声明见 [NOTICE](NOTICE)。修改并分发 Clover，或通过网络向用户提供受 AGPL 覆盖的修改版时，须依照 AGPL 提供对应源代码并保留原有声明及来源署名。修改版须明确标注为修改版，不得冒充官方版本。Clover 名称和标识不授予商标使用权。Roundcube、docker-mailserver 等第三方组件遵循各自的开源许可证。
