import HelpTip from '@/components/help-tip'
import { getMailHostname } from '@/lib/settings'

/**
 * 邮箱「客户端配置指引」——直接放在加邮箱的表单上方，回答三个问题：
 * 支持哪些协议、收发信服务器怎么填、有哪些坑。
 *
 * 参数按**实际部署**生成：所有邮箱域共用邮件主机名；POP3 行仅在网关开了
 * ENABLE_POP3 时出现（避免给出连不上的参数）。
 */
export default function MailSetupGuide({
  domainName,
  mailHostname,
}: {
  domainName: string
  mailHostname: string | null
}) {
  const host = getMailHostname(mailHostname || `mail.${domainName}`)
  const pop3Enabled = process.env.ENABLE_POP3 !== '0'

  return (
    <details className="setup-guide">
      <summary>
        客户端配置指引（IMAP / POP3 / SMTP）
        <span className="hint-text" style={{ marginLeft: 8 }}>
          建好邮箱后按这里的参数在任意邮件客户端收发
        </span>
      </summary>

      <div className="setup-body">
        <table className="proto">
          <thead>
            <tr>
              <th>用途</th>
              <th>服务器</th>
              <th>端口</th>
              <th>加密方式</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                收信 <b>IMAP</b>（推荐）
              </td>
              <td className="mono">{host}</td>
              <td className="mono">993</td>
              <td>SSL/TLS</td>
            </tr>
            {pop3Enabled && (
              <tr>
                <td>收信 POP3</td>
                <td className="mono">{host}</td>
                <td className="mono">995</td>
                <td>SSL/TLS</td>
              </tr>
            )}
            <tr>
              <td>
                发信 <b>SMTP</b>（推荐）
              </td>
              <td className="mono">{host}</td>
              <td className="mono">587</td>
              <td>STARTTLS</td>
            </tr>
            <tr>
              <td>发信 SMTP（备选）</td>
              <td className="mono">{host}</td>
              <td className="mono">465</td>
              <td>SSL/TLS</td>
            </tr>
            {pop3Enabled && (
              <tr>
                <td>收信 IMAP（备选）</td>
                <td className="mono">{host}</td>
                <td className="mono">143</td>
                <td>STARTTLS</td>
              </tr>
            )}
            <tr>
              <td>
                网页收发
                <HelpTip label="网页邮箱说明">
                  面板左侧「WebMail」页选邮箱可免密收发邮件，授权由当前 Clover 面板登录会话提供。
                </HelpTip>
              </td>
              <td className="mono">本面板 /webmail</td>
              <td>—</td>
              <td>HTTPS</td>
            </tr>
          </tbody>
        </table>

        <div className="setup-notes">
          <p>
            <b>用户名</b>：填**完整邮箱地址**（如 <span className="mono">boss@{domainName}</span>），不是只写
            <span className="mono"> boss</span>；
            <b>密码</b>：建邮箱时设的那个。
          </p>
          <p>
            <b>IMAP 与 POP3 的区别</b>：IMAP 在服务器保留邮件、多设备同步（推荐）；
            POP3 默认下载后从服务器删除（用 POP3 务必勾「在服务器保留副本」）。
          </p>
          <p>
            <b>三点注意</b>：① 加密方式必须开启（别用明文端口）；② 发信必须勾选「需要认证」；
            ③ 首次连接会提示**证书不受信任**（当前为自签证书），选择「信任/继续」即可，连接本身仍是 TLS 加密的。
          </p>
          <p className="hint-text">
            DMS 邮件总大小上限按全局邮箱设置同步；默认附件上限 100 MB 时，邮件总上限约 150 MiB（已预留 MIME 编码空间）。协议和内容策略见「高级参数 → 全局邮箱设置」。收不到外部来信时先确认机房的入站 25 端口已放行。
          </p>
        </div>
      </div>
    </details>
  )
}
