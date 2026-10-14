# 邮箱客户端配置指南（IMAP / POP3 / SMTP）

> 适用于 clover 三叶草邮局实例。示例使用 `example.com`，请替换成你自己的域名。
> 面板地址：`https://<面板域名>`（例如 `https://panel.example.com`）

---

## 一、服务器参数（照抄）

| 用途 | 服务器 | 端口 | 加密方式 | 用户名 | 密码 |
|---|---|---|---|---|---|
| **收信 IMAP**（推荐） | `mail.<你的域名>` 或服务器 IP | **993** | **SSL/TLS** | 完整邮箱地址 | 建邮箱时设的 |
| 收信 IMAP（备选） | 同上 | 143 | STARTTLS | 同上 | 同上 |
| **收信 POP3** | 同上 | **995** | **SSL/TLS** | 同上 | 同上 |
| 收信 POP3（备选） | 同上 | 110 | STARTTLS | 同上 | 同上 |
| **发信 SMTP**（推荐） | 同上 | **587** | **STARTTLS** | 同上 | 同上 |
| 发信 SMTP（备选） | 同上 | 465 | SSL/TLS | 同上 | 同上 |

**三条铁律**：
1. **用户名必须写完整邮箱地址**（`boss@example.com`），不是只写 `boss`
2. **加密必须开**，个人邮箱别用明文端口（143/110 不带加密时密码是明文的）
3. **发信必须勾选「需要认证」**，否则会被当开放中继

> 端口 25 **不要**用做客户端发信端口——那是服务器之间投递用的，客户端用 587。

**WebMail（不想装客户端就用这个）**：浏览器打开 `https://<面板域名>/webmail`
（面板左侧「WebMail」页选邮箱可**免密直达**；直接打开这个网址则用邮箱地址+密码登录）

---

## 二、各客户端具体步骤

### Thunderbird（Windows / macOS / Linux）
1. 账户设置 → 新建账户 → **电子邮件**
2. 填姓名 / 邮箱地址 / 密码 → 点「**手动配置**」（别让向导自己猜）
3. 按上表填：
   - 收件：**IMAP**，`mail.<域名>`，`993`，**SSL/TLS**
   - 发件：`mail.<域名>`，`587`，**STARTTLS**，认证方式「普通密码」
   - 用户名两处都填完整邮箱地址
4. 点「重新测试」→ 两边都显示成功后「完成」
5. 若提示证书不受信任：勾选「**永久信任此证书**」→ 确认（自签证书，见第四节）

### iPhone / iPad（iOS「邮件」App）
设置 → 邮件 → 账户 → 添加账户 → **其他** → 添加邮件账户
- 收件服务器：**IMAP**，主机名 `mail.<域名>`，用户名 = 完整邮箱，密码
- 发件服务器：主机名 `mail.<域名>`，用户名/密码同上
- 保存后进「账户 → 高级」确认：收件用 **993 + SSL**，发件用 **587 + STARTTLS**（iOS 有时会自动选错端口，务必核对）
- 弹证书警告 → 「详细信息 → 信任」（自签证书）

### Android（系统「电子邮件」/ Gmail App 的「其他」）
手动设置 → **IMAP**：
- 收件：`mail.<域名>` / `993` / SSL/TLS
- 发件：`mail.<域名>` / `587` / STARTTLS / 需要登录
- 用户名 = 完整邮箱地址

### Outlook（Windows / Mac / 移动端）
文件 → 添加账户 → 手动设置 → **POP 或 IMAP**
- 若坚持用 POP3：收件 `995` SSL，发件 `587` STARTTLS，**勾选「在服务器上保留邮件副本」**（否则手机拉走就没了）
- 建议改用 IMAP（多设备同步）

### Apple Mail（macOS）
系统设置 → 互联网账户 → 添加其他账户 → 邮件 → 填账号密码 → 手动填上面参数

---

## 三、POP3 还是 IMAP？

| | IMAP（推荐） | POP3 |
|---|---|---|
| 多设备同步 | ✅ 服务器保存，各端看到同一份 | ❌ 默认下载到本地并删除服务器副本 |
| 已读/文件夹/标记 | ✅ 同步 | ❌ 只有收件箱概念 |
| 服务器占用 | 配额内一直占 | 拉走即释放（省空间） |

**结论**：手机+电脑都用 → 用 IMAP。只有一台设备且想省服务器空间 → 用 POP3（务必勾「保留副本」免得误删）。

POP3 和 ManageSieve 监听器由 `.env` 中的 `ENABLE_POP3=1`、`ENABLE_MANAGESIEVE=1` 启动（示例配置默认启用）。IMAP、POP3、ManageSieve 和 SMTP 的账号访问开关集中在「邮箱账户 → 全局邮箱设置」中，默认全部启用；关闭 IMAP 会同时关闭Roundcube。

---

## 四、证书这件事（首次连接必看）

全新安装默认使用**自签证书**（安装器自动生成，CN = `mail.<主域>`）。所以：

- 客户端首次连接会报「证书不受信任 / 无法验证服务器身份」
- Thunderbird：勾「永久信任」；iOS：进「详细信息 → 信任」；Android：选「继续/接受」
- **不影响加密**（连接仍是 TLS 加密的），只影响证书链验证

**想彻底消除警告**：登录面板，打开「面板设置 → TLS 证书」，在「邮件服务证书」卡片点击「签发 / 检查续期」。邮件主机名的 A 记录需指向本机，公网 TCP 80 可达，Cloudflare 代理需暂时关闭。签发成功后证书会安装到 DMS，并由证书助手自动续期；续期时邮件服务会短暂重启。

---

## 五、限制与已知问题

| 项 | 值 / 状态 |
|---|---|
| DMS 单封邮件大小上限 | 按「全局邮箱设置」中的附件总量自动设置，并预留 MIME 编码空间；默认附件上限 100 MB 时，DMS 总邮件上限约 **150 MiB**。 |
| 邮箱配额 | 面板建邮箱时填的「配额 MB」；不填 = 不限 |
| 附件总量限制 | 全局设置同时应用于 Webmail；DMS 的 Postfix 上限是完整 MIME 邮件的全局值，客户端（如 Foxmail）也受此值限制。勾选“无限额”可关闭上限；API 中填 0 表示无限额。 |
| 远程图片 | 默认不自动显示，使用 Roundcube 原生图片拦截/按需加载功能；全局邮箱设置可调整自动显示默认值。 |
| **外网来信** | 若 VPS 服务商或防火墙未放行公网 TCP 25，则无法接收外部来信 |
| 发信被 Gmail 判垃圾 | 检查 **PTR 反解**是否指向 `mail.<域名>`，并确认 SPF / DKIM / DMARC 已配置 |
| 自动配置（autoconfig） | ❌ 暂未生效：DNS 里 `autoconfig.<域名>` 有 CNAME，但服务器**未托管自动配置 XML**，客户端自动发现会失败 → 按本文手动填参数 |
| CalDAV / CardDAV（日历通讯录） | ❌ 未部署（DMS 不含），如需可另装 |

---

## 六、连不上时怎么排查

**在服务器上（或本机有 openssl 的话）逐条测**：

```bash
# 1) IMAPS 995 是否通 + 证书信息
openssl s_client -connect mail.<域名>:993 -servername mail.<域名> </dev/null | openssl x509 -noout -subject -dates

# 2) 587 STARTTLS 是否可用（看到 "250-STARTTLS" 即正常）
openssl s_client -starttls smtp -connect mail.<域名>:587 -crlf </dev/null | head -20

# 3) POP3S 995
openssl s_client -connect mail.<域名>:995 </dev/null | head -5

# 4) 端口是否被机房拦（从另一台机器测）
for p in 993 995 587 465 143 110 25; do timeout 5 bash -c "exec 3<>/dev/tcp/<服务器IP>/$p" 2>/dev/null && echo "$p 通" || echo "$p 不通"; done
```

**常见错误对照**：

| 现象 | 原因 | 处理 |
|---|---|---|
| `Authentication failed` / `LOGIN failed` | 用户名没写完整地址；或密码错 | 用户名必须是 `xxx@域名` 完整形式 |
| 能收不能发 | 发信端口/加密错，或没勾「需要认证」 | 用 587 + STARTTLS + 认证 |
| `STARTTLS not supported` | 服务器没配 TLS 证书 | 确认 `.env` 里有 `SSL_TYPE=manual` 且证书路径存在；`docker compose up -d mail` |
| 一直卡在「正在连接」 | 端口被机房封 | 上面第 4 条命令确认；被拦需工单放行 |
| 提示证书错误 | 自签证书 | 见第四节；或按第四节换真证书 |
| 发出去的信进垃圾箱 | PTR 未匹配 / SPF/DKIM 未配 | 面板 → Cloudflare 页推送 DNS；机房面板改 PTR |

**服务器侧看日志**：
```bash
docker exec docker-mailserver sh -c "tail -50 /var/log/mail/mail.log"     # 投递/认证日志
docker exec docker-mailserver doveadm auth test boss@<域名> '密码'         # 直接验证账号密码
docker exec docker-mailserver setup email list                            # 账号清单
```

> 用脚本发信务必带上 `Date` 和 `Message-ID` 头，否则会被内容过滤器判 `BAD-HEADER-0` 退信
> （真实客户端都会自动带，不受影响）。
