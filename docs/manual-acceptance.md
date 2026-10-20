# clover 手工验收清单

> 面向：面板管理员。目的：**亲手**走一遍全流程，验证每一步是否符合预期。
> 测试实例：`https://<面板域名>`　账号 `<管理员用户名>`（初始密码由安装器生成并在终端显示）
>
> 读法：每项都有「点什么 → 预期看到什么」。不符预期就按「异常时」那一行排查。

---

## A. 填完 CF Token 之后的下一步（DNS 一键配置）

### A1. 打开 Cloudflare 页
- **点**：左侧导航 → **Cloudflare**
- **预期**：自动列出 Cloudflare Token 有权访问的域名，每行显示「CF 状态 = active」和「面板 = 已导入 / 未导入」
- **异常时**：若提示未配置 Token / 列表为空 → 设置页确认 Token 已保存；Token 权限需 `Zone → DNS → Edit`，Zone Resources 需覆盖目标域

### A2. 单域导入并推送（先拿空域练手）
- **点**：选择一个由你管理、未用于现有邮件服务的测试域 → **「导入并推送所选（1）」**
- **预期**：结果明细显示该测试域的 6 条记录成功创建
- 对照 Cloudflare 后台 → 该域 DNS → 应有 **6 条带 `clover-` 备注**的记录：归属 TXT、`mail` A、`@` MX(10 mail.域)、`@` SPF、`mail._domainkey` DKIM、`_dmarc` DMARC

### A3. 验证幂等（重复点不会产生重复记录）
- **点**：再点一次「导入并推送所选」（仍勾同一个域）
- **预期**：明细变成 **「已是最新，无需改动」**（新增 0 / 更新 0 / 清理 0）
- 这是关键安全属性：**重复推送无副作用**

### A4. 验证「只碰自己的记录」
- **点**：在 Cloudflare 后台给该域**手工加一条** TXT（如 `test=hello`）→ 回面板重新推送
- **预期**：你手工加的那条**仍在**（我们只删自己 `clover-*` 备注的记录）

### A5. 检测六项
- **点**：进该域详情页 → **「检测」**
- **预期**：归属 TXT / MX / A / SPF / DKIM / DMARC **六项全 ✔**
- **异常时**：刚推送完可能因 DNS 缓存显示 ✘，等 1–2 分钟再点一次；仍 ✘ 看该域 NS 是否在 Cloudflare

### A6. 「全部推送」（改完策略统一刷新用）
- **点**：设置页改 **DMARC 策略**（none → quarantine → reject）、或打开进阶记录（autoconfig / MTA-STS / TLS-RPT）→ 保存 → 回 Cloudflare 页点 **「把全部域推送到 Cloudflare」**
- **预期**：所有已导入域走一遍 diff，改动项被 patch（明细里显示「更新 N」）

> ⚠️ **首次操作不要直接点「全部导入并推送」**：先确认每个目标域都由你管理，且 MX 切换不会中断现有邮件服务。迁移已有邮箱时应单独规划（先降 TTL → 并行验证 → 再切 MX）。

---

## B. 其他手工流程（建议按顺序走一遍）

| # | 流程 | 点什么 | 预期 |
|---|---|---|---|
| B1 | 建域向导 | 域名页 → **新建域名** → 填域名 → 看 DNS 预览 → 确认 | 建域成功 + 本地生成记录；预览里的 IP 是你设置的 VPS IP |
| B2 | 建邮箱 | 域详情 → 邮箱区 → 填 `test@域` + 密码(≥10位) | `dmsSynced: true`；该账号可用 IMAP/SMTP 登录 |
| B3 | 四类规则 | 域详情 → 规则区 → 分别建 exact / prefix / nonuser / catchall | exact/nonuser/catchall → `dmsSynced: true`；**prefix → `prefixSynced: true`**（写入 DMS 的 pcre 表） |
| B4 | 网页邮箱 | 左侧 **WebMail** → 选邮箱 | 免密进入全屏 Roundcube，能打开邮件列表和正文 |
| B5 | 发信 | 用刚建的邮箱从 Roundcube 发给自己 | 收件箱收到，且邮件头有 `DKIM-Signature` |
| B6 | 监控 | 左侧 **监控** 三页 | spam 统计有数（rspamd 11334）、队列/服务/日志可读、体检显示当前 DNSBL 结果；受限/失败不算命中或未命中 |
| B7 | 两步验证 | 设置 → TOTP → 扫码 → 填 6 位码 | 开启后登录需「密码 + 验证码」；关闭需当前码 |
| B8 | Passkey | 设置 → Passkey → 添加 | 走系统指纹/面容；登录页出现「用 Passkey 登录」 |
| B9 | 开放 API | 设置 → 生成 token → 用 curl 调 `/api/v1/domains` | 返回 JSON；吊销后立即 401 |
| B10 | 备份 | 设置页或 `GET /api/v1/system/backup?what=db` | 下载 SQLite 一致性快照（可用 sqlite3 打开校验） |
| B11 | 对账 | `POST /api/v1/system/reconcile {"heal":true}` | `dmsReachable: true`、`errors: []` |
| B12 | **全局邮箱设置** | 邮箱账户 → 全局邮箱设置 → 分别关闭/开启 IMAP、POP3、ManageSieve、SMTP | 设置对所有邮箱和客户端生效；关闭 IMAP 后 Webmail 也无法连接 |
| B13 | 邮箱客户端 | 域详情 → 邮箱区 → 展开「客户端配置指引」 | 表格按实际部署生成（含该域的 mail 主机名、993/995/587/465）；POP3 未开时不显示 POP3 行 |

---

## C. 已知限制（不是 bug，需外部条件）

| 现象 | 原因 | 谁解决 |
|---|---|---|
| **外网发不进来** | VPS 服务商或网络防火墙未放行公网 TCP 25 | 检查防火墙并联系服务商放行入站 25 |
| Gmail 可能判垃圾 | **PTR 反解**未指向 `mail.<域名>` | 在 VPS 服务商处设置 PTR |
| 脚本发信被自己拦（`BAD-HEADER-0` 退信） | amavis 要求规范头；Python `EmailMessage` 默认不带 `Date`/`Message-ID` | 脚本里补这两个头；真实客户端不受影响 |
| ClamAV 未运行 | 安装器会在内存小于 2 GB 时自动关闭 `ENABLE_CLAMAV` | 增加内存后可手动开启 |

---

## D. 出问题时的自助排查

```bash
# 容器状态 / 面板健康
docker compose ps
docker exec clover-panel node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)"

# 面板日志（同步/推送报错都在这里）
docker logs --tail 100 clover-panel

# 邮件队列与投递日志
docker exec docker-mailserver mailq
docker exec docker-mailserver sh -c "tail -50 /var/log/mail/mail.log"

# DMS 侧账号/别名落地情况
docker exec docker-mailserver setup email list
docker exec docker-mailserver setup alias list

# 别名表是否含 prefix 正则表（应为 texthash:... pcre:/tmp/docker-mailserver/postfix-virtual-regex.cf）
docker exec docker-mailserver postconf -h virtual_alias_maps

# 审计日志（每次变更都有记录）
# 面板 → 设置页底部，或 sqlite3 data/clover.db "select * from audit_logs order by id desc limit 20"
```
