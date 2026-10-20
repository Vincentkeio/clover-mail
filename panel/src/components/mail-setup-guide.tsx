import HelpTip from '@/components/help-tip'
import { getI18n } from '@/lib/i18n/server'
import { getMailHostname } from '@/lib/settings'

/**
 * 邮箱「客户端配置指引」——直接放在加邮箱的表单上方，回答三个问题：
 * 支持哪些协议、收发信服务器怎么填、有哪些坑。
 *
 * 参数按**实际部署**生成：所有邮箱域共用邮件主机名；POP3 行仅在网关开了
 * ENABLE_POP3 时出现（避免给出连不上的参数）。
 */
export default async function MailSetupGuide({
  domainName,
  mailHostname,
}: {
  domainName: string
  mailHostname: string | null
}) {
  const { t } = await getI18n()
  const host = getMailHostname(mailHostname || `mail.${domainName}`)
  const pop3Enabled = process.env.ENABLE_POP3 !== '0'

  return (
    <details className="setup-guide">
      <summary>
        {t('mailGuide.title')}
        <span className="hint-text" style={{ marginLeft: 8 }}>
          {t('mailGuide.hint')}
        </span>
      </summary>

      <div className="setup-body">
        <table className="proto">
          <thead>
            <tr>
              <th>{t('mailGuide.colPurpose')}</th>
              <th>{t('mailGuide.colServer')}</th>
              <th>{t('mailGuide.colPort')}</th>
              <th>{t('mailGuide.colEncryption')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {t('mailGuide.receive')} <b>IMAP</b>{t('mailGuide.recommended')}
              </td>
              <td className="mono">{host}</td>
              <td className="mono">993</td>
              <td>SSL/TLS</td>
            </tr>
            {pop3Enabled && (
              <tr>
                <td>{t('mailGuide.receive')} POP3</td>
                <td className="mono">{host}</td>
                <td className="mono">995</td>
                <td>SSL/TLS</td>
              </tr>
            )}
            <tr>
              <td>
                {t('mailGuide.send')} <b>SMTP</b>{t('mailGuide.recommended')}
              </td>
              <td className="mono">{host}</td>
              <td className="mono">587</td>
              <td>STARTTLS</td>
            </tr>
            <tr>
              <td>{t('mailGuide.send')} SMTP{t('mailGuide.alternate')}</td>
              <td className="mono">{host}</td>
              <td className="mono">465</td>
              <td>SSL/TLS</td>
            </tr>
            {pop3Enabled && (
              <tr>
                <td>{t('mailGuide.receive')} IMAP{t('mailGuide.alternate')}</td>
                <td className="mono">{host}</td>
                <td className="mono">143</td>
                <td>STARTTLS</td>
              </tr>
            )}
            <tr>
              <td>
                {t('mailGuide.webmail')}
                <HelpTip label={t('mailGuide.webmailTipLabel')}>
                  {t('mailGuide.webmailTip')}
                </HelpTip>
              </td>
              <td className="mono">Roundcube /webmail/</td>
              <td>—</td>
              <td>HTTPS</td>
            </tr>
          </tbody>
        </table>

        <div className="setup-notes">
          <p>
            <b>{t('mailGuide.noteUsername')}</b>{t('mailGuide.noteUsernameBody')}
            <span className="mono">boss@{domainName}</span>{t('mailGuide.noteUsernameMiddle')}
            <span className="mono"> boss</span>{t('mailGuide.noteUsernameEnd')}
            <b>{t('mailGuide.notePassword')}</b>{t('mailGuide.notePasswordBody')}
          </p>
          <p>
            <b>{t('mailGuide.noteDiffTitle')}</b>{t('mailGuide.noteDiffBody')}
          </p>
          <p>
            <b>{t('mailGuide.noteTipsTitle')}</b>{t('mailGuide.noteTipsBody')}
          </p>
          <p className="hint-text">
            {t('mailGuide.noteLimits')}
          </p>
        </div>
      </div>
    </details>
  )
}
