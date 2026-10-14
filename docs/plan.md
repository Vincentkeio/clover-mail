# clover 三叶草邮局 — 项目规划 v0.1

> 状态：规划定稿待评审 · 2026-10-11 · 作者：小宝（调研结论由 6 个并行调研组合成）

---

## 1. 项目一句话

一个开源自托管邮局：**一条 compose 命令**部署在 Debian/Ubuntu VPS 上，用 **PurelyMail 式的现代 Web 面板**管理无限域名、无限别名与 Catch-all，内置反垃圾（rspamd），DNS 记录可**一键推送 Cloudflare**，支持在面板里收发信、看日志与队列。

## 2. 需求定义

### 2.1 原始需求（boss）

- Debian/Ubuntu 上可用的 Docker 应用，VPS 部署邮局
- 通过垃圾邮件检测（发信能进收件箱，来信不泛滥）
- 主面板：方便地添加新域名、管理邮件和收发信件
- 一键导出 DNS 记录，导入 Cloudflare
- 参考 Mail-in-a-Box，但要好用的可视化界面（MIAB 实测面板简陋、不支持 Docker、无队列日志视图、作者明确拒绝定制化——不走它的老路）

### 2.2 追加需求（boss 2026-10-11）

- **用法对标 PurelyMail，但运行在自己 VPS 上**

### 2.3 PurelyMail 对标特性（调研结论，clover 逐项映射）

| # | PurelyMail 特性 | clover 对应设计 | 优先级 |
|---|---|---|---|
| 1 | 一口价、永不按 user/domain 收费 | 自托管无计费；面板首页展示资源用量（域名/邮箱/别名/存储/日发件量），无硬限制 | P0 |
| 2 | 无限别名 = 四类路由规则（精确/前缀/非用户地址/Catch-all）+ 多目标外部转发 + 优先于真实用户 + sieve 兜底 | 独立 `routing_rules` 模型，面板可视化编辑，映射到 DMS alias 机制 | P0 |
| 3 | 建域即全套 DNS + checklist 自动检测（ownership TXT / MX / SPF / DKIM / DMARC） | 建域向导自动生成 10 条记录 + dig 探测自动打勾 | P0 |
| 4 | ——（PurelyMail 自己只做到复制粘贴） | **真·一键推送 Cloudflare（CF API batch，幂等同步）+ 一键导出 BIND 文件**，核心差异化卖点 | P0 |
| 5 | 密码派生密钥的 at-rest 加密，服务商不可读；日志/备份保留 1 个月 | MVP 降级：VPS 层 LUKS 卷加密指南 + 明示保留策略；后续可做 per-mailbox 加密（PGP 或应用层） | P2 |
| 6 | 开箱反垃圾：SpamAssassin + IP 黑名单 SMTP 层拒收 + 自学习贝叶斯 + greylisting | rspamd + redis + ClamAV（DMS 全家桶），rspamd 自学习、神经网络+、面板显示评分/隔离 | P0 |
| 7 | 官方 REST API（域名/路由/用户 CRUD），生态自己长（社区已有 CF 自动化脚本、SDK、MCP） | clover 面板本身就是开放 API `/api/v1`，开放文档 + token 体系 | P1 |

附注（纠偏调研）：PurelyMail 宣传的「passkey 免密登录」经查证**不存在**，其现状是「密码 + TOTP/FIDO2 双因素」。clover 面板可以弯道超车：第一因素即支持 WebAuthn Passkey。

## 3. 开源生态调研结论（摘要）

调研方式：6 个并行 agent 深挖官方文档 / GitHub / 社区，覆盖 10 个项目。

| 项目 | 语言 | 许可证 | Docker | 自带 UI | 管理 API | 反垃圾 | 社区 | 一句话结论 |
|---|---|---|---|---|---|---|---|---|
| **docker-mailserver (DMS)** | Postfix 栈 | **MIT** | ✅ 单镜像/多拆分，无 DIND | ❌ 纯 CLI | ❌ 无 | rspamd+ClamAV+redis | 19.2k★ 极活跃 | **功能全家桶、社区最大、无 UI——正是机会** |
| mailcow-dockerized | PHP | GPLv3 | ✅ 原生，~20 容器 | ⚠️ PHP+Twig 老化 | ✅ REST 全对象 | rspamd+ClamAV | 13k★ | 功能天花板，UI 体验差，6GB 内存起步，重 |
| Stalwart | Rust | **AGPL** | ✅ | ✅ 现代面板 | ✅ HTTP API | 自研过滤器 | 8k★ 很活跃 | 功能最全单体，但 AGPL 传染 + Rust 改造门槛高 |
| Mailu | Python | MIT | ✅ compose | ✅ 简洁 | ✅ REST | rspamd | 数千★ 活跃 | 轻量标杆，但无队列/日志视图，功能偏薄 |
| Poste.io | ? | 专有（PRO 收费） | ✅ 单容器 | ✅ 成熟 | ✅ PRO | rspamd+ClamAV | 10M+ pulls | 体验标杆但闭源，个人以上收费，**不可基于它** |
| Maddy | Go | MIT | ✅ | ❌ | ❌ 无 | 内置检查/milter | 3k★ | IMAP 存储仍是 beta，收件侧不成熟 |
| WildDuck | Node | EUPL | ✅ | ❌ | ✅ 完整 REST | 需外拼 | 4k★ | 无 SMTP，要拼 Haraka+ZoneMTA，小规模过设计 |
| Mail-in-a-Box | Shell | CC0 | ❌ 仅裸机 | ⚠️ 简陋 | 内部 API | SpamAssassin | — | UI 简陋、不 Docker、无队列日志——用户点名排除 |
| Modoboa | Python/Django | ISC | ⚠️ 仅开发用 compose | ✅ 最深 | 弱 | Amavis | 活跃 | 面板深度标杆（被拦邮件可视/放行），但无生产镜像 |
| iRedMail | Shell | GPL-2.0 | ⚠️ 官方 Docker 仅 BETA | ✅ | 弱 | Amavis+SA | 活跃 | Docker 自标"勿上生产" |

**周边可复用组件**（直接抄作业）：
- 反垃圾：rspamd（有 WebUI + HTTP API `/scan` `/symbols` `/stats`，可嵌面板）+ redis + ClamAV，参考 DMS 组合
- WebMail：官方 Roundcube 客户端；面板一次性票据免密进入
- 证书：acme.sh `dns_cf` 插件 + CF Token，通配符 `*.domain` 是事实标准
- DNS 自动化：Cloudflare API v4（zone 查询、records CRUD、**批量 batch 写**），已有先例 `d-horner/mailcow-CloudFlare-DNS` 可参考；MIAB/PurelyMail 都只做到"复制粘贴"，**自动推送是空白点**
- 投递体检：MXToolbox REST API（黑名单/SPF/DKIM/DMARC 一键检查），可脚本化

## 4. 技术路线决策

### 4.1 结论：docker-mailserver 底座 + 自研 clover 面板

**先排除两条死路**：
1. **从头写 MTA/反垃圾 = 自杀**。Postfix/Dovecot/rspamd/ClamAV 是邮件行业几十年沉淀，没有任何理由重写；要重写的只是"管理和体验层"。
2. **基于 Poste.io / Modoboa / MIAB 改造 = 走进死胡同**。闭源收费 / 无生产镜像 / 不 Docker。

**三条可行路线对比**：

| 路线 | 内容 | 优点 | 缺点 | 判定 |
|---|---|---|---|---|
| **A. DMS 底座 + 自研面板** | DMS 跑邮件全家桶；clover 自研 Next.js 面板（DB 是唯一事实源，经 docker CLI 同步 DMS） | MIT 无传染；19.2k★ 坑最少；无历史 UI 包袱；Docker 原生轻量；可完全照 PurelyMail 设计交互 | 账号层需自建同步 sidecar；无现成 API 可调（要 exec CLI） | ✅ **推荐** |
| B. Mailcow 外挂 SPA | 保留 mailcow 后端，外层 React/Vue 调其 REST API | API 现成、功能最全 | 20 容器 6GB 起步；PHP 内部逻辑要改仍重；GPLv3；UI 数据模型要迁就它的设计 | 备选 |
| C. Stalwart 换皮 | 自带面板和 API，只做现代化皮 + CF 推送 | 最省事 all-in-one | AGPL 传染（改造必须开源或买企业许可）；Rust 栈改造门槛；未发 1.0 | 不推荐 |

### 4.2 DMS 的坑与对策

| DMS 的短板 | clover 对策 |
|---|---|
| 无数据库、无 API，只有 CLI + 配置文件 | SQLite 控制库为唯一事实源 → 面板所有变更通过 `docker exec docker-mailserver setup ...` 官方 CLI 落地（官方路径最稳，自带校验和 reload），同步结果回查校验 |
| 无 UI，第三方 UI 均不成熟 | 自研，无历史包袱，直接对标 PurelyMail |
| 无 DNS 一键导出 | DNS 生成器 + CF 批量推送（见 6.3/6.4） |
| 无 WebMail | 官方 Roundcube 客户端，由 Clover 面板一次性票据授权 |
| 无队列/日志视图 | 读 DMS 容器日志（supervisord）+ dovecot 队列命令，面板聚合展示 |
| DKIM 只到目录，无展示 | 读取 DMS dkim 目录公钥，自动填入 DNS 生成器 |

## 5. 目标架构

### 5.1 组件图

```
                          Internet
                             |
    [ 邮件客户端 IMAP/SMTP ]  |  [ 外部收件方 MX ]
              |              |          ^
              v              |          | 25/465/587 投递
        +-----------+        |          |
        |  Caddy    |<-------+----------+
        | HTTPS 入口 |  (邮件流量不过 Caddy，直连 DMS)
        | 自动证书   |
        +-----------+
          |       |       |
    /panel | /webmail | /rspamd
          v       v       v
   +----------------+  +----------+  +-----------+
   |  clover-panel  |  | mail protocols|  | rspamd-ui |
   | Next.js 单体   |  | (iframe) |  | (iframe)  |
   | UI+API+控制面   |  +----------+  +-----------+
   | SQLite         |
   +----------------+
       |          |
       v          v
 [ docker.sock ]  [ Cloudflare API ]
       |              (DNS 一键推送)
       v
 +---------------------------+
 |     docker-mailserver     |
 | postfix / dovecot /       |
 | rspamd+redis / clamav     |
 +---------------------------+
```

### 5.2 关键数据流

1. **建域**：面板填域名 → 生成 ownership TXT/CF Zone 授权 → 检测归属 → 生成 MX/SPF/DKIM/DMARC 等全量记录 → 一键推 CF（或导出）→ dig 自动检测逐项打勾
2. **建邮箱/别名**：面板 CRUD → clover DB 落库 → exec DMS CLI（`setup email add` / `setup alias add` / `setup domain add`）→ 回查校验 → 记录审计日志
3. **来信**：外部 MX → 25 端口 → rspamd（评分/黑名单/自学习）→ 达标 → Dovecot 投递 mailbox
4. **面板收发信视图**：DMS 容器日志解析（队列/拒绝/投递）+ IMAP master user 读 mailbox 预览/搜索 + rspamd API 拉取评分统计
5. **发信体检**：MXToolbox API 一键跑黑名单/SPF/DKIM 检查，面板展示

### 5.3 部署形态

- 一个 compose 栈，一条 `curl | bash` 安装器（申请面板域名、CF Token、时区等少量参数）
- 统一入口 Caddy（自动 HTTPS，反代 `/`、`/webmail`、`/rspamd`）；邮件端口由 DMS 直接暴露
- 面板地址：`panel.<首个域名>`（或 `mail.<域名>`，安装时选）
- 升级：compose pull + 面板自带迁移脚本（DB migration + DMS 版本兼容检查）

## 6. 核心模块设计

### 6.1 控制面数据模型（SQLite + Drizzle）

```
admins(id, username, password_hash, webauthn_credentials[json], totp_secret, created_at)
domains(id, name, ownership_token, cf_zone_id, dns_status[json], mail_hostname,
        quota_policy_mb, active, created_at)
mailboxes(id, domain_id, login, password_hash, quota_mb, active, created_at)
routing_rules(id, domain_id, match_type, match_value, targets[json], priority, active)
  -- match_type: exact(精确地址) | prefix(前缀如 sales@) | nonuser(非用户地址) | catchall
dns_records(id, domain_id, type, name, content, ttl, cf_record_id, pushed_at, status)
settings(key, value_encrypted)  -- VPS IP、CF Token、面板 URL、主机名等
audit_logs(id, actor, action, target, detail, created_at)
```

### 6.2 DMS 账号同步（最关键的工程点）

- 所有账号/域名/别名变更 → 调 DMS 官方 `setup` CLI（`setup email add/domain add/alias add` 等），CLI 内部负责写配置、生成 hash、reload postfix/dovecot——**不裸写配置文件**，规避格式兼容风险
- 同步采用「面板 DB 为准 + 每日对账任务」双保险：cron 比对 DMS 实际账号与 DB，差异告警
- DMS 大版本升级前跑 compat 检查（CLI 行为变更），升级流程写入文档

### 6.3 DNS 记录生成器

建域向导自动产出（默认值均可编辑、可预览）：

| 记录 | 值 |
|---|---|
| TXT `@` | `clover-verification=<token>`（域名归属） |
| A `mail.<dom>` | VPS IP |
| MX `@` | `mail.<dom>` 优先级 10 |
| TXT `@` | `v=spf1 a mx ip4:<IP> -all`（可调 ~all） |
| TXT `mail._domainkey` | DMS 生成的 DKIM 公钥 |
| TXT `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:postmaster@<dom>; fo=1` |
| （进阶）| autoconfig/autodiscover CNAME、MTA-STS、TLS-RPT |

导出格式：CF API 推送（主）+ BIND zone 文件 / 纯文本清单（兜底）。

### 6.4 Cloudflare 一键推送

**API 选型（官方文档已核对）**

认证统一走 **API Token**：`Authorization: Bearer <token>`，最小权限模板 **Zone → DNS → Edit**（仅授权目标 zone）。面板设置页录入、加密存储。不用 Global API Key。

| 步骤 | API | 说明 |
|---|---|---|
| 1. 定位 zone | `GET /zones?name=<domain>` | 按域名精确查 zone_id（域名须已在 CF 账号下） |
| 2. 读现有记录 | `GET /zones/{zone_id}/dns_records?type=&name=` | 分页拉全，用于幂等 diff |
| 3. 批量写入（主路径） | `POST /zones/{zone_id}/dns_records/batch` | body：`{deletes:[{id}], patches:[{id,...}], posts:[{...}], puts:[{...}]}` |
| 4. BIND 导入（备选） | `POST /zones/{zone_id}/dns_records/import` | multipart `file` 字段传 BIND zone 文本，返回 `recs_added` / `total_records_parsed` |

**batch 行为要点（务必遵守）**：
- 执行顺序固定 **deletes → patches → puts → posts**，不是数组书写顺序
- 单请求单 DB 事务，按操作组分包返回；4XX 时 `errors[].source.pointer` 指出出错位置（如 `/body/posts/0`）
- 单批保守按 ≤1000 条分批（M2 实测验证上限）
- 记录字段：`type / name / content / ttl / priority / proxied / comment / settings / tags`
- MX/SRV/CNAME/NS 等 content 若指向域名必须是 **FQDN（尾点）**，否则 BIND/import 场景解析歧义
- **DKIM 长 TXT**：CF API 接受完整公钥单条 content（自动分片存储）；仅 BIND 文件导出时需手动按 255 字符分片
- `proxied` 仅对可代理记录生效，邮件相关记录一律 `false`

**clover 推送策略**：
1. 建域后展示「记录预览表」（逐条可编辑/禁用）→ 与 CF 现有记录 diff → 生成 posts（新增）/ patches（更新）/ deletes（移除 clover 托管且废弃的）
2. 点「一键推送」→ 调用 batch → 按分组展示结果与失败明细
3. 推送后启动 dig 探测任务，MX/SPF/DKIM/DMARC 逐项自动打勾（checklist）
4. 兜底：无 CF Token 的用户可**下载 BIND zone 文件**（粘到 CF 面板 Import and Export 手动导入，即 `/dns_records/import` 的手工版）或纯文本清单
5. 之后所有变更（换 IP、加域名、轮换 DKIM）都走同一条 diff+推送管道，幂等可重复执行

```bash
# 1) 查 zone_id
curl -s "https://api.cloudflare.com/client/v4/zones?name=example.com" \
  -H "Authorization: Bearer $CF_TOKEN" | jq -r '.result[0].id'

# 2) 批量写入全部邮局记录（一次请求）
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/batch" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "posts": [
      {"type":"A","name":"mail.example.com","content":"203.0.113.10","ttl":1,"proxied":false,"comment":"clover"},
      {"type":"MX","name":"example.com","content":"mail.example.com.","priority":10,"ttl":1,"comment":"clover"},
      {"type":"TXT","name":"example.com","content":"v=spf1 a mx ip4:203.0.113.10 -all","ttl":1,"comment":"clover-spf"},
      {"type":"TXT","name":"mail._domainkey.example.com","content":"v=DKIM1; k=rsa; p=MIIBIjANBgkq...","ttl":1,"comment":"clover-dkim"},
      {"type":"TXT","name":"_dmarc.example.com","content":"v=DMARC1; p=quarantine; rua=mailto:postmaster@example.com; fo=1","ttl":1,"comment":"clover-dmarc"}
    ]
  }'
```

### 6.5 反垃圾面板化

- rspamd WebUI iframe 反代（`/rspamd`）
- 面板「反垃圾」页：通过 rspamd HTTP API 拉取评分分布、符号命中 TopN、每域统计
- 隔离区：入箱隔离的邮件列表 + 一键放行/删除（调 rspamd actions + dovecot sieve）
- ClamAV 病毒扫描报告
- MXToolbox API 一键体检：IP 黑名单 / SPF / DKIM / DMARC / MX

### 6.6 WebMail 与单点登录

- Webmail 由官方 Roundcube 镜像提供，保留原生邮件功能
- 登录打通：面板用户点「打开邮箱」→ 一次性票据经服务器兑换，通过 Dovecot master user 自动登录（不暴露密码）

### 6.7 面板认证

- 管理员账号 + 密码（argon2）+ TOTP + WebAuthn Passkey（**弯道超车 PurelyMail：第一因素即可 Passkey**）
- Session：httpOnly cookie + CSRF 防护
- 开放 API token（6.1 `audit_logs` 记录一切）

### 6.8 开放 API

`/api/v1/{domains,mailboxes,routing_rules,dns,…}` REST + token 鉴权，文档站同仓库，留给社区做 CLI/SDK/MCP（学 PurelyMail 的生态放大器打法）。

## 7. 部署要求（写进安装器和文档）

| 项 | 要求 |
|---|---|
| 系统 | Debian 11–13 / Ubuntu 22.04+，x86_64/aarch64 |
| 资源 | 最低 2 核、2GB RAM + 1GB Swap（ClamAV 自动关闭）；推荐 2 核 4GB RAM，可启用 ClamAV |
| Docker | Docker Engine ≥ 24 + compose v2 |
| 网络 | **公网 25/465/587 端口放行**（部分 VPS 商默认封锁，需工单开通，安装器检测并提示） |
| rDNS | 引导设置 VPS IP 的 PTR 记录指向 mail.<域名>（送达率关键） |
| IP 质量 | 建议干净 IP（非阿里/腾讯等云共享段），新 IP 有 warmup 常识引导 |
| 位置 | 建议海外 VPS：内地 VPS 对自建邮局对外服务有端口与合规限制 |
| 备份 | 数据卷 + SQLite 每日备份脚本（litestream 可选），说明恢复流程 |

## 8. 里程碑（单人全职估算）

| 阶段 | 内容 | 估时 |
|---|---|---|
| **M0 骨架** | monorepo、compose 栈、安装器 v0、手工 CLI 配 1 域 1 邮箱跑通收发（验证 25 端口/rDNS/送达） | 1 周 |
| **M1 控制面** | DB schema、DMS 同步 CLI 封装、面板域名/邮箱/别名 CRUD、路由规则四类匹配 | 2 周 |
| **M2 DNS 自动化** | DNS 生成器、CF Token 管理、batch 一键推送、dig 检测 checklist、BIND 导出 | 1 周 |
| **M3 反垃圾与监控** | rspamd 反代与统计页、隔离区放行、队列/日志视图、MXToolbox 体检 | 1 周 |
| **M4 产品化** | Roundcube Webmail、Passkey/TOTP、建域向导、Dashboard 用量总览 | 1.5 周 |
| **M5 打磨** | 备份/恢复、升级流程、开放 API + 文档、Logo/命名/许可 | 1.5 周 |
| 合计 | | **~8 周**（多人并行可压到 3–4 周） |

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 25 端口被 VPS 商封锁 | 安装器检测 + 工单指引文档；备选 SMTPS/587  submission |
| 新 IP 无信誉被大厂拒收 | warmup 指引（每天少量发信递增）、rDNS、MXToolbox 体检、黑名单移除指引 |
| DMS 无 DB 导致账号同步故障 | 只用官方 CLI、每日对账告警 |
| DMS 升级破坏兼容 | 锁版本 + 升级前 compat 检查流程 |
| 面板单点故障 | compose restart 策略、SQLite 每日备份、一键恢复文档 |
| 许可证传染 | DMS/MIT 无传染；面板自身避免引入 AGPL 依赖 |
| 邮件 at-rest 加密 | MVP 卷加密指引；P2 做 per-mailbox 加密 |
| 合规 | 建议海外 VPS；文档明示各地政策差异，用户自担 |

## 10. 待 boss 确认的开放问题

1. 面板技术栈：**Next.js 单体**（推荐，一个容器搞定）/ Go 后端 + Nuxt 前后端分离
2. 数据库：**SQLite**（推荐单机轻量）/ PostgreSQL
3. 许可证：MIT（推荐）/ Apache-2.0
4. MVP 账号模型：单管理员（推荐，PM 是自助注册但自托管先单管理员）/ 直接做多用户注册
5. WebMail：官方 Roundcube 原生客户端
6. 是否有现成 VPS + 域名可以尽早开始 M0 验证（25 端口 + 送达率是项目生死线，越早真机验证越好）
7. Logo/命名规范（三叶草 🍀 意向已明确）

---

*附：调研过程与原始报告结论已并入第 3 节；如需看某项目细节可展开追查。*
