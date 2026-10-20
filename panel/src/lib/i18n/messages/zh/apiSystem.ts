// 服务端接口返回给面板界面的提示文案（面板设置、备份、证书、维护、迁移、队列与更新检查等系统接口及其工具库）。
const apiSystem = {
  // 面板设置（settings）
  'settings.mailBooleansBoolean': '全局邮箱开关必须为布尔值',
  'settings.attachmentSizeInvalid': '附件大小必须为 0 到 {max} MB 的整数',
  'settings.vpsIpInvalid': 'VPS IP 格式不正确',
  'settings.dnsModeInvalid': 'DNS 模式无效',
  'settings.dmarcPolicyInvalid': 'dmarcPolicy 仅支持 none/quarantine/reject',
  'settings.cfTokenEmpty': 'CF Token 不能为空（如需清除请调 DELETE）',
  'settings.policySyncFailed': '邮箱设置已保存，但 DMS 应用失败：{error}',
  'settings.cfTokenMissing': '未配置 CF Token',
  'settings.domainMissing': '缺少域名',
  'settings.tokenDecryptFailed': '***（解密失败，请重新录入）',

  // 一致性备份与导入（system/backup）
  'backup.dbFailed': '备份失败: {error}',
  'backup.dmsConfigFailed': 'DMS 配置备份失败（docker 不可用？）: {error}',
  'backup.whatUnsupported': 'what 仅支持 db | dms-config',
  'backup.archiveStructureInvalid': '邮件配置归档目录结构无效。',
  'backup.archiveLinkRejected': '邮件配置归档包含链接或特殊文件，已拒绝导入。',
  'backup.invalidDbFile': '请选择有效的 .db 文件（最大 {max}）。',
  'backup.dbCheckFailed': '数据库校验失败，文件不是可用的 Clover 面板数据库。',
  'backup.dbReadFailed': '数据库校验失败，无法读取 SQLite 文件：{error}',
  'backup.dbImported': '数据库已导入，面板正在重启。',
  'backup.dbImportFailed': '数据库导入失败：{error}',
  'backup.invalidConfigFile': '请选择邮件配置 .tar.gz 归档（最大 {max}）。',
  'backup.configValidateFailed': '邮件配置归档校验失败：{error}',
  'backup.configImported': '邮件服务配置已导入，邮件服务已重启。',
  'backup.configImportFailed': '邮件配置导入失败：{error}',
  'backup.badOrigin': '请求来源无效。',
  'backup.fileMissing': '请选择要导入的备份文件。',

  // 面板证书任务（system/certificates）
  'certificates.statusReadFailed': '无法读取证书状态：{error}',
  'certificates.caddyManaged': '当前使用 Caddy 管理面板证书；Caddy 会自动签发和续期。',
  'certificates.taskStarted': '证书任务已启动。',
  'certificates.operationFailed': '证书操作失败：{error}',

  // 证书助手（certificate-status）
  'certificateStatus.helperMissing': '证书助手容器不存在。请通过服务更新或修复重新创建 certificate-helper。',
  'certificateStatus.startFailed': '证书助手已停止，自动启动失败。请查看 clover-certificate-helper 容器日志。',
  'certificateStatus.notRunning': '证书助手启动后仍未运行。请查看 clover-certificate-helper 容器日志。',
  'certificateStatus.stoppedWhileReading': '证书助手在读取状态时停止了，请刷新后重试；若仍失败，请查看容器日志。',

  // TLS 探测（certificate-probe）
  'certificateProbe.timeout': '连接超时',

  // 投递体检：DNSBL 名单（dnsbl）
  'deliverability.ipInvalid': 'IP 格式不正确',
  'deliverability.unsupportedZone': '该 DNSBL 不在支持列表中',
  'deliverability.listedDetail': '名单返回有效命中码：{codes}',
  'deliverability.returnedCodes': '返回 {codes}',
  'deliverability.restrictedByResolver': '名单限制公共解析器查询或请求频率；本次无法判断是否收录，请到名单官网核验。',
  'deliverability.queryNameInvalid': 'DNSBL 查询名称配置错误，不能判断是否收录。',
  'deliverability.unknownCode': '名单返回未识别的响应码，不能判断是否收录。',
  'deliverability.spamhausUnverifiable': '公共解析器未返回可验证的 Spamhaus 结果；不能据此认定未收录，请到 Spamhaus 官网核验。',
  'deliverability.notListedDetail': '本次查询未返回有效命中记录。',

  // 投递体检：域健康（dnsbl）
  'deliverability.mxLabel': 'MX 指向邮件主机',
  'deliverability.noMx': '无 MX 记录',
  'deliverability.aRecordLabel': '{host} 有 A 记录',
  'deliverability.noA': '无 A 记录',
  'deliverability.noSpf': '未找到 SPF 记录',
  'deliverability.spfMultiple': '发现 {count} 条 SPF 记录；同一域名只能发布一条。{records}',
  'deliverability.spfFound': 'DNS 中发现一条 SPF 记录：{record}（未验证完整 SPF 语法或真实邮件认证）',
  'deliverability.spfDuplicateLabel': 'SPF 记录重复',
  'deliverability.spfSingleLabel': 'SPF 单记录检查',
  'deliverability.dkimLabel': 'DKIM 公钥存在',
  'deliverability.noDkim': '未找到 DKIM TXT',
  'deliverability.dmarcLabel': 'DMARC 记录存在',
  'deliverability.noDmarc': '未找到 DMARC TXT',
  'deliverability.checkFailedLabel': '检测失败',
  'deliverability.dnsUnreachable': 'DNS 查询网络不可达',
  'deliverability.otherFailures': '另有 {count} 项查询失败',

  // 维护任务（system/maintenance）
  'maintenance.projectDirUnknown': '无法识别安装目录',
  'maintenance.badOrigin': '请求来源无效',
  'maintenance.invalidAction': '操作无效',
  'maintenance.updateConfirmRequired': '更新需要手动确认。',
  'maintenance.jobRunning': '已有维护任务正在运行',
  'maintenance.domainInvalid': '请输入两个不同的真实域名。测试域名只能保留现有值。',
  'maintenance.aRecordMissing': '{host} 的 A 记录尚未指向本机 {ip}。请先在 DNS 中配置并等待生效。',
  'maintenance.started': '维护任务已启动。',
  'maintenance.configureStarted': '正在应用域名配置，完成后将自动重新加载页面。',
  'maintenance.startFailed': '无法启动维护任务',
  'maintenance.ticketExpired': '任务查询凭据已失效，请重新打开面板查看任务记录。',
  'maintenance.sessionSecretMissing': '面板会话密钥尚未配置。',

  // 迁移包导入导出（system/migration）
  'migration.invalidJob': '迁移任务编号无效。',
  'migration.starting': '正在启动恢复任务…',
  'migration.queued': '等待恢复任务…',
  'migration.badOrigin': '请求来源无效。',
  'migration.confirmRequired': '请输入确认词后重试。',
  'migration.passphraseLength': '迁移口令需为 12 至 256 个字符。',
  'migration.packageTooLarge': '迁移包超过 100 GiB 上限。',
  'migration.packageEmpty': '迁移包内容为空。',
  'migration.packageIncomplete': '迁移包格式不完整。',
  'migration.notCloverPackage': '文件不是 Clover 加密迁移包。',
  'migration.invalidPath': '迁移包包含无效路径。',
  'migration.linkRejected': '迁移包包含链接或特殊文件，已拒绝恢复。',
  'migration.missingItem': '迁移包缺少必要内容：{item}',
  'migration.manifestInvalid': '迁移包清单版本或数据卷清单无效。',
  'migration.restoreStarted': '恢复任务已启动。',
  'migration.importFailed': '迁移包导入失败：{error}',
  'migration.prepareFailed': '无法准备迁移包：{error}',
  'migration.exportFailed': '迁移导出失败（{code}）',

  // API Token（system/tokens）
  'tokens.demoMode': 'DEMO_MODE 下不允许创建 token',
  'tokens.nameRequired': '给 token 起个名字（便于吊销时识别）',
  'tokens.idMissing': '缺少 id',
  'tokens.notFound': 'token 不存在',

  // 更新检查（system/update-check）
  'updateCheck.checkFailed': '检查更新失败。',
  'updateCheck.remoteHttpError': '远程服务返回 HTTP {status}',
  'updateCheck.noRegistryToken': '镜像仓库未返回读取凭据',
  'updateCheck.noArchImage': '发布镜像没有适用于 {arch} 的版本',
  'updateCheck.imageConfigMissing': '无法读取发布镜像版本信息',
  'updateCheck.versionUnknown': '无法确认发布镜像的数字版本号，请稍后重试。',
  'updateCheck.available': '发现新版本 {version}，可以更新。',
  'updateCheck.sourceBuild': '当前使用本地构建；可手动切换到最新发布版本。',
  'updateCheck.latest': '当前已是最新版本。',
  'updateCheck.cacheFailed': '检查更新失败，请手动重试。',

  // rspamd 聚合统计（system/spam-stats）
  'spamStats.abnormalResponse': 'rspamd 返回异常: {detail}',
  'spamStats.emptyResponse': '(空响应，检查 controller 端口/密码)',

  // 对账报告（reconcile）
  'reconcile.prefixMapApplied': 'prefix-map 已下发 {count} 条',
  'reconcile.prefixMapFailed': 'prefix-map 下发失败: {error}',
  'reconcile.aliasAddFailed': 'alias+ {alias} 失败: {error}',
  'reconcile.aliasDeleteFailed': 'alias- {alias} 失败: {error}',
  'reconcile.mailboxDeleteFailed': 'mailbox- {login} 失败: {error}',
  'reconcile.manualRebuild': '以下邮箱 DMS 侧缺失但密码不可恢复，需人工重建: {logins}',
}

export default apiSystem
