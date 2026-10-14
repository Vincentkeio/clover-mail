'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Mailbox = { login: string; active: boolean }
type Folder = { path: string; name: string; specialUse?: string; messages: number; unseen: number }
type MessageRow = { uid: number; messageId: string; date: string | null; from: string; to: string; subject: string; unread: boolean; starred: boolean; labels: string[] }
type SendAttempt = { id: number; status: 'accepted' | 'failed'; messageId: string; to: string; subject: string; error: string; createdAt: string }
type Message = { uid: number; from: string; to: string; subject: string; date: string | null; text: string; html: string; messageId: string; inReplyTo: string; references: string; starred: boolean; labels: string[]; allowRemoteImages: boolean; remoteImageCount: number; trackerCount: number; authenticationResults: string; remoteContentLoaded: boolean; attachments: Array<{ index: number; filename: string; contentType: string; size: number }> }

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const folderUrl = (login: string) => `/api/v1/webmail/folders?login=${encodeURIComponent(login)}`
const messagesUrl = (login: string, folder: string, query = '') => `/api/v1/webmail/messages?login=${encodeURIComponent(login)}&folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(query)}`
const detailUrl = (login: string, folder: string, uid: number, remote = false) => `/api/v1/webmail/messages/${uid}?login=${encodeURIComponent(login)}&folder=${encodeURIComponent(folder)}${remote ? '&remote=1' : ''}`
const standardLabels = ['个人', '工作', '重要', '稍后处理']

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`)
  return data as T
}

function dateLabel(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function fileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function textToHtml(value: string) {
  return value.split('\n').map((line) => `<p>${line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') || '<br>'}</p>`).join('')
}

function RichTextEditor({ initialHtml, onChange }: { initialHtml: string; onChange: (html: string, text: string) => void }) {
  const editor = useRef<HTMLDivElement>(null)
  const initialValue = useRef(initialHtml)

  function format(command: string, value?: string) {
    editor.current?.focus()
    document.execCommand(command, false, value)
    if (editor.current) onChange(editor.current.innerHTML, editor.current.innerText)
  }

  function addLink() {
    const url = window.prompt('输入链接地址（https:// 或 mailto:）')?.trim()
    if (!url) return
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return
    format('createLink', url)
  }

  const tools: Array<{ label: string; title: string; command?: string; action?: () => void; value?: string }> = [
    { label: '↶', title: '撤销', command: 'undo' },
    { label: '↷', title: '重做', command: 'redo' },
    { label: 'B', title: '加粗', command: 'bold' },
    { label: 'I', title: '斜体', command: 'italic' },
    { label: 'U', title: '下划线', command: 'underline' },
    { label: '• 列表', title: '项目符号列表', command: 'insertUnorderedList' },
    { label: '1. 列表', title: '编号列表', command: 'insertOrderedList' },
    { label: '引用', title: '引用段落', command: 'formatBlock', value: 'blockquote' },
    { label: '左对齐', title: '左对齐', command: 'justifyLeft' },
    { label: '居中', title: '居中', command: 'justifyCenter' },
    { label: '链接', title: '插入链接', action: addLink },
    { label: '移除链接', title: '移除链接', command: 'unlink' },
    { label: '分隔线', title: '插入分隔线', command: 'insertHorizontalRule' },
    { label: '清除格式', title: '清除格式', command: 'removeFormat' },
  ]

  return <div className="webmail-rich-editor">
    <div className="webmail-editor-tools" role="toolbar" aria-label="正文格式">
      {tools.map((tool) => <button key={tool.title} type="button" title={tool.title} aria-label={tool.title}
        className={tool.command === 'bold' ? 'is-bold' : tool.command === 'italic' ? 'is-italic' : tool.command === 'underline' ? 'is-underline' : ''}
        onMouseDown={(event) => event.preventDefault()} onClick={() => tool.action ? tool.action() : tool.command && format(tool.command, tool.value)}>{tool.label}</button>)}
    </div>
    <div ref={editor} className="webmail-editor-content" contentEditable suppressContentEditableWarning
      role="textbox" aria-label="邮件正文" aria-multiline="true" data-placeholder="写下邮件内容…"
      dangerouslySetInnerHTML={{ __html: initialValue.current }}
      onInput={(event) => onChange(event.currentTarget.innerHTML, event.currentTarget.innerText)} />
  </div>
}

export default function Webmail({ mailboxes, maxAttachmentMb }: { mailboxes: Mailbox[]; maxAttachmentMb: number }) {
  const [login, setLogin] = useState(mailboxes[0]?.login || '')
  const [folders, setFolders] = useState<Folder[]>([])
  const [folder, setFolder] = useState('INBOX')
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [sendAttempts, setSendAttempts] = useState<SendAttempt[]>([])
  const [selected, setSelected] = useState<Message | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [error, setError] = useState('')
  const [compose, setCompose] = useState(false)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState({ to: '', cc: '', subject: '', text: '', html: '', inReplyTo: '', references: '' })
  const [files, setFiles] = useState<File[]>([])
  const [composeError, setComposeError] = useState('')
  const [notice, setNotice] = useState('')
  const maxAttachmentBytes = maxAttachmentMb === 0 ? Number.POSITIVE_INFINITY : maxAttachmentMb * 1024 * 1024
  const messagesRequest = useRef(0)

  const loadMessages = useCallback(async (mailbox: string, folderPath: string, search = '') => {
    const requestId = ++messagesRequest.current
    setLoadingMessages(true)
    setError('')
    try {
      const data = await readJson<{ messages: MessageRow[]; sendAttempts?: SendAttempt[] }>(await fetch(messagesUrl(mailbox, folderPath, search), { cache: 'no-store' }))
      if (requestId === messagesRequest.current) {
        setMessages(data.messages)
        setSendAttempts(data.sendAttempts || [])
        setSelected((current) => current && data.messages.some((message) => message.uid === current.uid) ? current : null)
      }
    } catch (caught) {
      if (requestId === messagesRequest.current) setError(caught instanceof Error ? caught.message : '读取邮件失败。')
    } finally {
      if (requestId === messagesRequest.current) setLoadingMessages(false)
    }
  }, [])

  const loadFolders = useCallback(async (mailbox: string) => {
    const data = await readJson<{ folders: Folder[] }>(await fetch(folderUrl(mailbox), { cache: 'no-store' }))
    setFolders(data.folders)
    return data.folders
  }, [])

  const openMailbox = useCallback(async (mailbox: string) => {
    if (!mailbox) return
    setBusy(true)
    setError('')
    setFolders([])
    setMessages([])
    setSendAttempts([])
    setSelected(null)
    setFolder('INBOX')
    setNotice('正在通过 Clover 面板会话安全连接邮件服务…')
    try {
      let status = await readJson<{ state: string; error?: string }>(await fetch('/api/v1/webmail/setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: mailbox }),
      }))
      if (status.state !== 'ready') {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          await wait(1000)
          status = await readJson<{ state: string; error?: string }>(await fetch('/api/v1/webmail/setup', { cache: 'no-store' }))
          if (status.state === 'ready') break
          if (status.state === 'failed') throw new Error(status.error || 'Webmail 安全连接初始化失败。')
          if (status.state === 'idle') {
            status = await readJson<{ state: string; error?: string }>(await fetch('/api/v1/webmail/setup', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: mailbox }),
            }))
          }
        }
      }
      if (status.state !== 'ready') throw new Error(status.error || '邮件服务连接初始化超时，请检查环境检查中的 IMAP 状态。')
      const nextFolders = await loadFolders(mailbox)
      const inbox = nextFolders.find((item) => item.path.toUpperCase() === 'INBOX')?.path || nextFolders[0]?.path || 'INBOX'
      setFolder(inbox)
      setNotice('')
      await loadMessages(mailbox, inbox)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '邮件服务连接失败。')
      setNotice('')
    } finally { setBusy(false) }
  }, [loadFolders, loadMessages])

  useEffect(() => { if (login) void openMailbox(login) }, [login, openMailbox])

  async function refreshMailbox() {
    await Promise.all([
      loadMessages(login, folder),
      loadFolders(login).catch((caught) => setError(caught instanceof Error ? caught.message : '读取文件夹数量失败。')),
    ])
  }

  const visibleMessages = messages

  async function selectMessage(row: MessageRow, remote = false) {
    setError('')
    setSelected(null)
    try {
      const data = await readJson<{ message: Message }>(await fetch(detailUrl(login, folder, row.uid, remote), { cache: 'no-store' }))
      setSelected(data.message)
      setMessages((current) => current.map((message) => message.uid === row.uid ? { ...message, unread: false } : message))
      if (row.unread) await loadFolders(login).catch(() => undefined)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '打开邮件失败。') }
  }

  async function changeFlag(uid: number, patch: { starred?: boolean; label?: string; labelEnabled?: boolean }) {
    try {
      await readJson(await fetch(detailUrl(login, folder, uid), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, folder, ...patch }) }))
      await loadMessages(login, folder, query)
      if (selected?.uid === uid) await selectMessage({ uid, messageId: selected.messageId, date: selected.date, from: selected.from, to: selected.to, subject: selected.subject, unread: false, starred: selected.starred, labels: selected.labels })
    } catch (caught) { setError(caught instanceof Error ? caught.message : '更新邮件标记失败。') }
  }

  async function updateMessage(action: 'unread' | 'trash' | 'junk' | 'ham') {
    if (!selected) return
    setError('')
    const endpoint = action === 'junk' || action === 'ham' ? '/api/v1/webmail/messages/action' : detailUrl(login, folder, selected.uid)
    const payload = action === 'unread'
      ? { login, folder, unread: true }
      : action === 'trash'
        ? { login, folder, trash: true }
        : { login, folder, uid: selected.uid, action }
    try {
      await readJson(await fetch(endpoint, { method: action === 'junk' || action === 'ham' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }))
      setSelected(null)
        await loadFolders(login).catch(() => undefined)
      await loadMessages(login, folder)
      setNotice(action === 'junk' ? '邮件已移入垃圾邮件。若 DMS 启用了 RSPAMD_LEARN，移动操作也会反馈给 Rspamd。' : action === 'ham' ? '邮件已移回收件箱。' : action === 'trash' ? '邮件已移入垃圾箱。' : '邮件已标为未读。')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '邮件操作失败。') }
  }

  function reply() {
    if (!selected) return
    const sender = selected.from.match(/<([^>]+)>/)?.[1] || selected.from
    const subject = selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`
    const text = `\n\n—— 原邮件 ——\n${selected.text}`
    setDraft({ to: sender, cc: '', subject, text, html: textToHtml(text), inReplyTo: selected.messageId, references: [selected.references, selected.messageId].filter(Boolean).join(' ') })
    setFiles([])
    setComposeError('')
    setCompose(true)
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList?.length) return
    const next = [...files, ...Array.from(fileList)]
    if (next.length > 10) { setComposeError('最多可附加 10 个文件。'); return }
    if (next.reduce((total, file) => total + file.size, 0) > maxAttachmentBytes) {
      setComposeError(maxAttachmentMb === 0 ? '附件超出浏览器可处理范围。' : `附件合计不能超过全局 ${maxAttachmentMb} MB。`)
      return
    }
    setComposeError('')
    setFiles(next)
  }

  async function send() {
    setSending(true)
    setError('')
    setComposeError('')
    try {
      const form = new FormData()
      for (const [key, value] of Object.entries({ login, ...draft })) form.append(key, value)
      for (const file of files) form.append('attachments', file, file.name)
      const result = await readJson<{ saved: boolean }>(await fetch('/api/v1/webmail/send', {
        method: 'POST', body: form,
      }))
      await Promise.all([loadFolders(login).catch(() => undefined), loadMessages(login, folder)])
      setCompose(false)
      setDraft({ to: '', cc: '', subject: '', text: '', html: '', inReplyTo: '', references: '' })
      setFiles([])
      setNotice(result.saved ? '邮件服务器已接受发送，邮件已保存到已发送文件夹。' : '邮件服务器已接受发送，但未能保存到已发送文件夹。')
    } catch (caught) {
      setComposeError(caught instanceof Error ? caught.message : '邮件发送失败。')
      await loadMessages(login, folder)
    }
    finally { setSending(false) }
  }

  const junkFolder = folders.find((item) => item.specialUse?.toLowerCase() === '\\junk' || /^(junk|spam)$/i.test(item.name))
  const inJunk = folder === junkFolder?.path || /^(junk|spam)$/i.test(folder.split(/[/.]/).filter(Boolean).at(-1) || '')
  const currentFolder = folders.find((item) => item.path === folder)
  const displayedMessageCount = query ? visibleMessages.length : currentFolder?.messages ?? messages.length
  const currentFolderUnread = currentFolder?.unseen ?? 0
  const isSentFolder = currentFolder?.specialUse?.toLowerCase() === '\\sent' || /^(sent|sent mail|sent items|已发送)$/i.test(currentFolder?.name || '')
  const displayedSendAttempts = isSentFolder ? sendAttempts.slice(0, 8) : []
  const attemptByMessageId = new Map(sendAttempts.filter((attempt) => attempt.status === 'accepted' && attempt.messageId)
    .map((attempt) => [attempt.messageId.replace(/^<|>$/g, '').toLowerCase(), attempt]))

  if (mailboxes.length === 0) {
    return <section className="panel"><div className="section-title"><h1>WebMail</h1><span className="tag">Clover 内置</span></div><p className="empty">没有已启用的邮箱。先到域名管理中创建邮箱。</p></section>
  }

  return <>
    <div className="topbar webmail-heading">
      <div><h1>WebMail</h1><p className="hint">从 Clover 面板直接免密进入。邮件通过 IMAP/SMTP 在服务器端读取和发送，不会向浏览器提供邮箱密码。</p></div>
      <span className="tag">Clover 内置</span>
    </div>

    <section className="panel webmail-app" aria-label="Webmail 邮件">
      <header className="webmail-toolbar">
        <div className="field webmail-account"><label htmlFor="webmail-account">邮箱账户</label><select id="webmail-account" value={login} onChange={(event) => setLogin(event.target.value)} disabled={busy}>
          {mailboxes.map((box) => <option key={box.login} value={box.login}>{box.login}</option>)}
        </select></div>
        <div className="webmail-toolbar-actions">
          <button type="button" onClick={() => { setDraft({ to: '', cc: '', subject: '', text: '', html: '', inReplyTo: '', references: '' }); setFiles([]); setComposeError(''); setCompose(true) }}>写邮件</button>
          <button type="button" onClick={() => void refreshMailbox()} disabled={loadingMessages}>刷新</button>
        </div>
      </header>
      {notice && <div role="status" className="msg ok webmail-notice">{notice}<button type="button" className="webmail-dismiss" onClick={() => setNotice('')} aria-label="关闭提示">×</button></div>}
      {error && <div role="alert" className="msg err webmail-error">{error}</div>}
      {busy && <div role="status" className="webmail-loading">{notice || '正在连接邮件服务…'}</div>}
      {!busy && <div className="webmail-layout">
        <nav className="webmail-folders" aria-label="邮件文件夹">
          {folders.map((item) => <button type="button" key={item.path} className={folder === item.path ? 'is-current' : ''} onClick={() => { setFolder(item.path); setMessages([]); setSelected(null); void loadMessages(login, item.path) }}>
            <span>{item.name}</span><span className="webmail-folder-counts" aria-label={`${item.messages} 封邮件，${item.unseen} 封未读`}>
              <small className="webmail-folder-total" title={`${item.messages} 封邮件`}>{item.messages}</small>
              {item.unseen > 0 && <small className="webmail-folder-unread" title={`${item.unseen} 封未读`}>{item.unseen} 未读</small>}
            </span>
          </button>)}
        </nav>
        <section className="webmail-list" aria-label="邮件列表">
          <div className="webmail-list-heading"><h2>{currentFolder?.name || folder}</h2><span className="count">{displayedMessageCount} 封{currentFolderUnread > 0 ? ` · ${currentFolderUnread} 未读` : ''}</span></div>
          <form className="webmail-search" onSubmit={(event) => { event.preventDefault(); void loadMessages(login, folder, query) }}><span className="sr-only">搜索邮件</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索发件人、主题或正文；支持 from:、is:starred、label:工作" /><button type="submit" disabled={loadingMessages}>搜索</button></form>
          {isSentFolder && displayedSendAttempts.length > 0 && <section className="webmail-send-history" aria-label="最近发送状态">
            <h3>最近发送状态</h3>
            <ul>{displayedSendAttempts.map((attempt) => <li key={attempt.id}>
              <div className="webmail-send-history-heading"><span className={`webmail-send-status ${attempt.status}`}>{attempt.status === 'accepted' ? '发送成功' : '发送失败'}</span><time>{dateLabel(attempt.createdAt)}</time></div>
              <b>{attempt.subject || '(无主题)'}</b><span className="webmail-send-recipient">收件人：{attempt.to || '未知'}</span>
              {attempt.status === 'accepted' ? <small>邮件服务器已接受发送；最终投递情况以退信或收件方为准。</small> : <small className="webmail-send-error">{attempt.error || '邮件服务器未接受发送。'}</small>}
            </li>)}</ul>
          </section>}
          {loadingMessages ? <p className="empty">正在读取邮件…</p> : visibleMessages.length === 0 ? <p className="empty">{query ? '没有匹配的邮件。' : '这个文件夹还没有邮件。'}</p> : <ul className="webmail-message-list">
            {visibleMessages.map((item) => {
              const attempt = attemptByMessageId.get(item.messageId.replace(/^<|>$/g, '').toLowerCase())
              return <li key={item.uid}><button type="button" className={`webmail-message-row ${item.unread ? 'is-unread' : ''} ${selected?.uid === item.uid ? 'is-selected' : ''}`} onClick={() => void selectMessage(item)}>
                <span className="webmail-message-from">{item.unread && <i aria-label="未读" />}{item.from}</span><time>{dateLabel(item.date)}</time><b>{item.subject}</b>
                {item.labels.length > 0 && <span className="webmail-row-labels">{item.labels.map((label) => <small key={label}>{label}</small>)}</span>}
                {isSentFolder && <small className="webmail-row-send-status">{attempt ? '发送成功 · 服务器已接受' : '已提交到已发送'}</small>}
              </button><button type="button" className={`webmail-star ${item.starred ? 'is-starred' : ''}`} aria-label={item.starred ? '取消星标' : '添加星标'} title={item.starred ? '取消星标' : '添加星标'} onClick={() => void changeFlag(item.uid, { starred: !item.starred })}>★</button></li>
            })}
          </ul>}
        </section>
        <article className="webmail-reading" aria-label="邮件内容">
          {!selected ? <div className="webmail-reading-empty">选择一封邮件查看内容</div> : <>
            <div className="webmail-reading-header"><div><h2>{selected.subject}</h2><p><b>发件人</b> {selected.from}</p><p><b>收件人</b> {selected.to || login}</p><time>{dateLabel(selected.date)}</time>
              <div className="webmail-label-actions" aria-label="邮件标签">{standardLabels.map((label) => <button type="button" key={label} className={selected.labels.includes(label) ? 'is-active' : ''} onClick={() => void changeFlag(selected.uid, { label, labelEnabled: !selected.labels.includes(label) })}>{label}</button>)}</div></div>
              <div className="webmail-message-actions"><button type="button" className={selected.starred ? 'is-starred' : ''} onClick={() => void changeFlag(selected.uid, { starred: !selected.starred })}>{selected.starred ? '★ 已星标' : '☆ 星标'}</button><button type="button" onClick={reply}>回复</button><button type="button" onClick={() => void updateMessage('unread')}>标为未读</button><button type="button" onClick={() => void updateMessage(inJunk ? 'ham' : 'junk')}>{inJunk ? '移出垃圾邮件' : '标记垃圾邮件'}</button><button type="button" className="webmail-danger" onClick={() => void updateMessage('trash')}>移入垃圾箱</button></div>
            </div>
            <div className="webmail-authentication"><b>邮件头中的发件人认证信息</b><span>{selected.authenticationResults || '邮件未提供 Authentication-Results，暂无法显示 SPF / DKIM / DMARC 结果。'}</span><small>这里展示原邮件头内容供参考；邮件头可能由发件方提供，不能单独作为可信验证结论。</small></div>
            {selected.remoteImageCount > 0 && <div className="webmail-remote-warning"><span>已拦截 {selected.remoteImageCount} 张远程图片{selected.trackerCount ? `，其中 ${selected.trackerCount} 张疑似追踪像素` : ''}。</span>{selected.allowRemoteImages ? <button type="button" onClick={() => void selectMessage({ uid: selected.uid, messageId: selected.messageId, date: selected.date, from: selected.from, to: selected.to, subject: selected.subject, unread: false, starred: selected.starred, labels: selected.labels }, true)} disabled={selected.remoteContentLoaded}>加载远程内容</button> : <small>邮箱管理中尚未允许加载远程图片。</small>}</div>}
            {selected.attachments.length > 0 && <ul className="webmail-attachments" aria-label="邮件附件">{selected.attachments.map((attachment) => <li key={attachment.index}><a href={`/api/v1/webmail/messages/${selected.uid}/attachments/${attachment.index}?login=${encodeURIComponent(login)}&folder=${encodeURIComponent(folder)}`}>↓ {attachment.filename} <small>{Math.ceil(attachment.size / 1024)} KB</small></a></li>)}</ul>}
            {selected.html ? <iframe title="邮件 HTML 正文" className="webmail-message-frame" sandbox="" referrerPolicy="no-referrer" srcDoc={selected.html} /> : <pre className="webmail-message-body">{selected.text || '（邮件正文为空）'}</pre>}
          </>}
        </article>
      </div>}
      <p className="webmail-security-note">搜索支持发件人、收件人、主题、正文、<code>label:工作</code>，以及 <code>is:unread</code>、<code>is:starred</code>、<code>after:2026-01-01</code> 等条件。HTML 邮件在隔离框架中显示，远程图片默认拦截。</p>
      <p className="webmail-spam-note">“标记垃圾邮件”会将邮件移入 {junkFolder?.name || 'Junk'}。如果 DMS 设置了 <code>RSPAMD_LEARN=1</code>，移入/移出 Junk 会把反馈传给 Rspamd；此选项使用全局学习库，只适合邮箱用户可信的环境。</p>
    </section>

    {compose && <div className="webmail-compose-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCompose(false) }}>
      <section className="webmail-compose" role="dialog" aria-modal="true" aria-labelledby="webmail-compose-title">
        <div className="section-title"><h2 id="webmail-compose-title">写邮件</h2><button type="button" onClick={() => setCompose(false)} aria-label="关闭写邮件">×</button></div>
        <div className="field"><label>发件人</label><input value={login} readOnly /></div>
        <div className="field"><label htmlFor="compose-to">收件人</label><input id="compose-to" type="text" inputMode="email" autoComplete="email" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} placeholder="一个或多个邮箱地址" required /></div>
        <div className="field"><label htmlFor="compose-cc">抄送</label><input id="compose-cc" value={draft.cc} onChange={(event) => setDraft({ ...draft, cc: event.target.value })} placeholder="选填，多个地址用逗号分隔" /></div>
        <div className="field"><label htmlFor="compose-subject">主题</label><input id="compose-subject" value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} maxLength={998} /></div>
        <div className="field"><label>正文</label><RichTextEditor initialHtml={draft.html} onChange={(html, text) => setDraft((current) => ({ ...current, html, text }))} /></div>
        <div className="field"><span className="webmail-compose-label">附件</span><label className="webmail-attach-button">添加附件<input type="file" multiple onChange={(event) => { addFiles(event.currentTarget.files); event.currentTarget.value = '' }} /></label><span className="webmail-attach-limit">附件合计：{maxAttachmentMb === 0 ? '无限制' : `最多 ${maxAttachmentMb} MB`}，最多 10 个文件</span>
          {files.length > 0 && <ul className="webmail-draft-files">{files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}><span>{file.name} <small>{fileSize(file.size)}</small></span><button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`移除附件 ${file.name}`}>移除</button></li>)}</ul>}
        </div>
        {composeError && <div className="msg err webmail-compose-error" role="alert">{composeError}</div>}
        <div className="webmail-compose-actions"><button type="button" onClick={() => setCompose(false)}>取消</button><button type="button" className="primary" onClick={() => void send()} disabled={sending || !draft.to.trim() || !draft.text.trim()}>{sending ? '发送中…' : '发送'}</button></div>
      </section>
    </div>}
  </>
}
