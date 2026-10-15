# clover 三叶草邮局 🍀

在自己的服务器上搭建邮件服务，通过 Web 面板管理域名、邮箱和转发规则。

## 功能特色

- **可视化管理**：集中管理多个域名、邮箱账户、密码和邮件转发，支持别名、前缀匹配与 Catch-all。
- **Cloudflare DNS 自动配置**：导入域名，一键生成并推送 MX、SPF、DKIM、DMARC 等邮件记录，也可导出后手动配置。
- **Roundcube Webmail**：从面板选择邮箱，在新标签页免密进入；使用原生搜索、星标、文件夹、编辑器和通讯录。
- **兼容邮件客户端**：支持 IMAP、POP3、SMTP 和 ManageSieve，可使用 Thunderbird、Foxmail、Apple Mail 等客户端。
- **全局邮箱设置**：统一管理协议开关、远程图片策略及附件上限；附件默认 100 MB，可设置为无限额。
- **证书与运维**：支持 HTTPS、邮件 TLS 证书管理和自动续期，提供环境检查、反垃圾统计、邮件队列、日志及备份入口。
- **账户安全与 API**：单管理员管理，支持两步验证、Passkey、API Token 和审计日志。

## 安装准备

- Debian 11–13 或 Ubuntu 22.04+ 服务器；默认发布镜像支持 **amd64**。
- 最低配置：**2 vCPU、2 GB 内存**；推荐配置：**2 vCPU、4 GB 内存**。
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

更新会保留配置和 Docker 数据卷。更新前请做好备份；默认备份**不包含邮件正文和 Roundcube 通讯录、偏好数据**，这些内容需另行备份对应数据卷。
管理员密码遗失时，在服务器运行 `clover admin reset <用户名>`。

## 数据与安全

- 邮件与配置保存在服务器的 Docker 数据卷中；Roundcube 的通讯录和偏好独立保存。
- `.env` 含服务密钥，请妥善保管，不要公开上传。
- 面板仅有一个管理员；免密 Webmail 入口允许管理员进入所选邮箱。
- Alpha 版本仍在持续完善，重要邮件请保留独立备份。

## 许可证

Clover 采用 [MIT License](LICENSE)。Roundcube、docker-mailserver 等组件遵循各自的开源许可证。
