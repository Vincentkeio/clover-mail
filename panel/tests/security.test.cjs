const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { DatabaseSync } = require('node:sqlite')
const localRequire = createRequire(path.resolve(__dirname, '../package.json'))
const ts = localRequire('typescript')

function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relative)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) return mocks[name]
    return localRequire(name)
  }, mod, mod.exports)
  return mod.exports
}

test('password reset revokes a signed session without changing the data-encryption key', () => {
  process.env.SESSION_SECRET = 'a-secure-test-key-with-at-least-32-characters'
  process.env.NODE_ENV = 'production'
  const session = load('src/lib/session.ts')
  const crypto = load('src/lib/crypto.ts')
  const encrypted = crypto.encryptSecret('test-cloudflare-credential')
  const token = session.createSessionToken(1, 'old-argon2-hash')
  assert.equal(session.verifySessionToken(token, 'old-argon2-hash'), 1)
  assert.equal(session.verifySessionToken(token, 'new-argon2-hash'), null)
  assert.equal(crypto.decryptSecret(encrypted), 'test-cloudflare-credential')
  const decoded = Buffer.from(token, 'base64url').toString()
  const tampered = Buffer.from(decoded.replace('1.', '2.')).toString('base64url')
  assert.equal(session.verifySessionToken(tampered), null)
  assert.equal(session.verifySessionToken(token + '.extra'), null)
  process.env.SESSION_SECRET = 'change-me-to-random-32+'
  assert.throws(() => session.createSessionToken(1, 'hash'))
  assert.throws(() => crypto.encryptSecret('secret'))
})

test('login limits survive module reload and bound username spraying', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(fs.readFileSync(path.resolve(__dirname, '../drizzle/0004_wise_karma.sql'), 'utf8'))
  const sqlite = { prepare: (...args) => db.prepare(...args), transaction: (fn) => () => {
    db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); db.exec('COMMIT'); return result } catch (error) { db.exec('ROLLBACK'); throw error }
  } }
  const mocks = { '@/db': { sqlite } }
  const a = load('src/lib/login-rate-limit.ts', mocks)
  for (let i = 0; i < 10; i++) assert.equal(a.reserveLoginAttempt('admin', 1000), 0)
  const b = load('src/lib/login-rate-limit.ts', mocks)
  assert.equal(b.reserveLoginAttempt('ADMIN', 1000), 900)
  b.clearLoginAttempts('admin')
  assert.equal(b.reserveLoginAttempt('admin', 1000), 0)
  for (let i = 0; i < 109; i++) assert.equal(b.reserveLoginAttempt('spray-' + i, 1000), 0)
  assert.equal(b.reserveLoginAttempt('another-user', 1000), 900)
  assert.equal(b.reserveLoginAttempt('admin', 901001), 0)
  db.close()
})

test('DMS command failures redact mailbox passwords from every result field', async () => {
  const secret = 'test-secret-that-must-not-appear'
  const dms = load('src/lib/dms.ts', {
    './config': { config: { dmsContainer: 'test-mail' } },
    'node:util': { promisify: () => async () => { throw Object.assign(new Error('Command failed: docker setup email add test ' + secret), { stderr: 'rejected ' + secret, code: 1 }) } },
  })
  for (const action of [dms.emails.add, dms.emails.update]) {
    const result = await action('audit@example.test', secret)
    assert.equal(result.ok, false)
    assert.equal(JSON.stringify(result).includes(secret), false)
    assert.match(result.stderr, /REDACTED/)
  }
})

test('diagnostics and nested audit details redact secrets while preserving operational flags', () => {
  process.env.SESSION_SECRET = 'test-runtime-secret-value-with-32-chars'
  const redact = load('src/lib/redact.ts')
  const github = 'ghp_' + 'a'.repeat(30)
  const api = 'clover_' + 'b'.repeat(32)
  const text = redact.redactSensitiveText(`Bearer opaque-token password="mailbox-secret" smtp://user:mail-password@mail.test ${github} ${api} ${process.env.SESSION_SECRET}`)
  for (const secret of ['opaque-token', 'mailbox-secret', 'mail-password', github, api, process.env.SESSION_SECRET]) assert.equal(text.includes(secret), false)
  const detail = redact.redactAuditDetail({ cfApiToken: true, count: 2, nested: [{ password: 'secret', token: 'sensitive-token', healthy: true }], error: 'Authorization: Bearer sensitive-header' })
  assert.equal(detail.cfApiToken, true)
  assert.equal(detail.count, 2)
  assert.equal(detail.nested[0].healthy, true)
  assert.equal(JSON.stringify(detail).includes('sensitive-token'), false)
  assert.equal(JSON.stringify(detail).includes('sensitive-header'), false)
  const begin = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ')
  const end = ['-----END', 'PRIVATE KEY-----'].join(' ')
  const pem = `${begin}\nprivate-material\n${end}`
  assert.equal(redact.redactSensitiveText(pem).includes('private-material'), false)
  assert.equal(redact.redactSensitiveText(pem.split('-----END')[0]).includes('private-material'), false)
  assert.equal(redact.redactSensitiveText('C: AUTH PLAIN dGVzdC1jcmVkZW50aWFs').includes('dGVzdC1jcmVkZW50aWFs'), false)
})

test('Cloudflare upstream error messages cannot echo the configured API token', async () => {
  const token = 'an-api-token-used-only-by-this-test'
  const redaction = load('src/lib/redact.ts')
  const originalFetch = global.fetch
  global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ success: false, errors: [{ code: 1, message: 'Rejected value: ' + token }] }) })
  try {
    const cf = load('src/lib/cloudflare.ts', {
      '@/lib/i18n/config': { DEFAULT_LOCALE: 'en' },
      '@/lib/i18n/translate': { createTranslator: () => (_key, vars) => vars?.message || '' },
      './redact': redaction,
    })
    const result = await cf.verifyToken(token, 'example.test')
    assert.equal(result.ok, false)
    assert.equal(result.error.includes(token), false)
  } finally { global.fetch = originalFetch }
})

test('mailbox changes and deletes report failure and keep the management record when DMS fails', async () => {
  let mutations = 0
  const box = { id: 1, login: 'audit@example.test', active: true }
  const chain = { from: () => chain, where: () => chain, limit: async () => [box] }
  const db = { select: () => chain, update: () => { mutations++; throw Error('unexpected update') }, delete: () => { mutations++; throw Error('unexpected delete') } }
  const failed = async () => ({ ok: false, results: [{ ok: false, error: 'unavailable' }] })
  const route = load('src/app/api/v1/mailboxes/[id]/route.ts', {
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
    'drizzle-orm': { eq: () => null }, '@/db': { db }, '@/db/schema': { mailboxes: {} },
    '@/lib/auth': { getCurrentAdmin: async () => ({ id: 1, username: 'admin' }), unauthorized: () => Response.json({}, { status: 401 }) },
    '@/lib/audit': { audit: async () => {} },
    '@/lib/validators': { updateMailboxSchema: () => ({ safeParse: () => ({ success: true, data: { password: 'test-new-password' } }) }) },
    '@/lib/sync': { syncMailboxPassword: failed, syncMailboxDelete: failed, syncMailboxQuota: failed },
    '@/lib/mailbox-policy-sync': { syncMailboxPolicies: async () => ({ ok: true }) },
    '@/lib/i18n/server': { getTranslator: async () => (key) => key },
  })
  const context = { params: Promise.resolve({ id: '1' }) }
  const request = new Request('https://panel.example.test/api/v1/mailboxes/1', { method: 'PATCH', body: '{}' })
  assert.equal((await route.PATCH(request, context)).status, 502)
  assert.equal((await route.DELETE(request, context)).status, 502)
  assert.equal(mutations, 0)
})

test('SMTP disable policy reaches submission overrides and preserves existing restrictions', async () => {
  const calls = []
  const chain = { from: () => chain, innerJoin: () => chain, then: (resolve) => resolve([{ login: 'audit@example.test', active: false, domainActive: true }]) }
  const fakeExec = async (file, args) => {
    calls.push(args)
    const command = args.slice(2)
    if (command[0] === 'cat') return { stdout: '' }
    if (command[0] === 'dovecot') return { stdout: '2.4.0' }
    if (command[0] === 'postconf' && command[1] === '-h') {
      if (command[2] === 'message_size_limit') return { stdout: String(Math.ceil((100 * 1.4 + 10) * 1024 * 1024)) }
      return { stdout: 'reject_authenticated_sender_login_mismatch, permit_sasl_authenticated' }
    }
    return { stdout: '' }
  }
  const policy = load('src/lib/mailbox-policy-sync.ts', {
    'node:util': { promisify: () => fakeExec }, '@/db': { db: { select: () => chain } },
    '@/db/schema': { domains: {}, mailboxes: {} }, 'drizzle-orm': { eq: () => null },
    './config': { config: { dmsContainer: 'test-mail' } },
    './i18n/translate': { createTranslator: () => (key) => key },
    './settings': { getGlobalMailSettings: async () => ({ maxAttachmentMb: 100, allowImap: true, allowSmtp: false }) },
    './roundcube-policy': { syncRoundcubePolicy: async () => {} },
    './srs-sync': { syncSrsDomains: async () => ({ ok: true }) },
  })
  assert.equal((await policy.syncMailboxPolicies()).ok, true)
  const value = calls.find((args) => args.some((arg) => String(arg).startsWith('mua_sender_restrictions=')))
  assert.ok(value, 'submission policy must be updated')
  assert.match(value.at(-1), /check_sasl_access texthash:/)
  assert.match(value.at(-1), /reject_authenticated_sender_login_mismatch/)
})
