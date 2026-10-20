# M0 真机验收清单（VPS）

> 目标：在真实 VPS 上验证 clover 骨架的生死线指标——**25 端口通、rDNS 正确、SPF/DKIM/DMARC 全 PASS、能进 Gmail 收件箱**。
> 前置：install.sh 已跑通，`docker compose ps` 三个容器均为 running（DMS 启动约需 1–2 分钟）。

## 0. 端口与出站

```bash
ss -lntp | grep -E ':(25|465|587|143|993)\b'   # 五个端口都应在 LISTEN
timeout 5 bash -c '(exec 3<>/dev/tcp/smtp.gmail.com/25)' && echo "出站25 通" || echo "出站25 不通（开工单）"
```

## 1. DNS 记录（Cloudflare / 域名商，M2 前手工）

| 类型 | 名称 | 值 |
|---|---|---|
| MX | `@` | `mail.<域名>` 优先级 10 |
| A | `mail` | VPS 公网 IP |
| TXT | `@` | `v=spf1 a mx ip4:<VPS_IP> -all`（初期可 `~all`） |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@<域名>` |
| TXT | `mail._domainkey` | 见下方 DKIM 命令 |

```bash
# 建域后 DMS 会自动生成 DKIM 密钥，取公钥配 TXT：
docker exec docker-mailserver cat /tmp/docker-mailserver/opendkim/keys/<域名>/mail.txt
```

## 2. rDNS（PTR）

```bash
dig -x <VPS_IP> +short    # 期望输出 mail.<域名>
```
不一致时去 VPS 商后台把 PTR 设为 `mail.<域名>`（送达率关键项，Gmail 硬性看这个）。

## 3. 建第一个域与账号

```bash
docker exec docker-mailserver setup domain add <域名>
docker exec docker-mailserver setup email add boss@<域名> '强密码'
docker exec docker-mailserver setup email list
docker exec docker-mailserver setup alias add postmaster@<域名> boss@<域名>   # 可选
```

## 4. 收发验证

```bash
# 入站（外部 → 本域）：在另一台机器执行
swaks --to boss@<域名> --server mail.<域名>
# 或直接从 Gmail 发一封到 boss@<域名>

# 出站（本域 → 外部，走 submission 587 + TLS + 认证）：
swaks --to <你的gmail> --server mail.<域名> --from boss@<域名> \
      --auth-user boss@<域名> --auth-password '强密码' --tls

# 客户端登录：IMAP 993 / SMTP 587，用户名 = 完整邮箱地址
```

## 5. 送达率体检

- Gmail 收信 → 「显示原始信息」：SPF / DKIM / DMARC 三项均 PASS
- [mail-tester.com](https://www.mail-tester.com) 打分：**目标 ≥ 9/10**
- [MXToolbox](https://mxtoolbox.com/SuperTool.aspx) 查 IP 是否在黑名单（Spamhaus ZEN/PBL 等；注意区分查询受限与真正命中）

## 6. 服务状态速查

```bash
docker exec docker-mailserver supervisorctl status      # postfix/dovecot/rspamd/clamav 全 RUNNING
docker exec docker-mailserver setup email list         # 账号清单
docker compose logs --tail=50 panel                    # 面板日志
# 邮件实时日志（容器内）：
docker exec docker-mailserver tail -f /var/log/mail/mail.log
```

## 通过标准

- [ ] 25 出入站通，465/587/993 通
- [ ] `dig -x VPS_IP` 命中 `mail.<域名>`
- [ ] SPF + DKIM + DMARC 全 PASS
- [ ] Gmail 收信进收件箱（不是垃圾箱）
- [ ] mail-tester ≥ 9/10
- [ ] IP 不在主流黑名单

> 全部打勾 → M0 完成，进入 M1 控制面（DB 为唯一事实源的 CRUD + DMS 同步 + 每日对账）。
