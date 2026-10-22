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

const i18nMocks = {
  '@/lib/i18n/config': { DEFAULT_LOCALE: 'en' },
  '@/lib/i18n/translate': { createTranslator: () => (key) => key },
  './i18n/config': { DEFAULT_LOCALE: 'en' },
  './i18n/translate': { createTranslator: () => (key) => key },
}
const jsonResponseMock = { NextResponse: { json: (value, init) => Response.json(value, init) } }

function securityDatabase() {
  const db = new DatabaseSync(':memory:')
  for (const name of fs.readdirSync(path.resolve(__dirname, '../drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.resolve(__dirname, '../drizzle', name), 'utf8'))
  }
  return db
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

test('Passkey challenges are single use across workers and bound to purpose, account and password', async () => {
  const sqlite = securityDatabase()
  let cookie
  const session = load('src/lib/session.ts')
  const mocks = { ...i18nMocks, '@/db': { sqlite }, './session': session,
    'next/headers': { cookies: async () => ({ get: () => cookie ? { value: cookie } : undefined, set: (_name, value) => { cookie = value }, delete: () => { cookie = undefined } }) } }
  const a = load('src/lib/webauthn.ts', mocks)
  const b = load('src/lib/webauthn.ts', mocks)
  await a.saveChallenge('admin.with.dots', 'challenge-1', 'login', 'password-hash')
  const captured = cookie
  const results = await Promise.all([a.consumeChallenge('admin.with.dots', 'login', 'password-hash'), b.consumeChallenge('admin.with.dots', 'login', 'password-hash')])
  assert.equal(results.filter(Boolean).length, 1)
  cookie = captured
  assert.equal(await b.consumeChallenge('admin.with.dots', 'login', 'password-hash'), null)
  for (const [username, purpose, password] of [['other', 'login', 'password-hash'], ['admin', 'register', 'password-hash'], ['admin', 'login', 'new-password']]) {
    await a.saveChallenge('admin', 'challenge-2', 'login', 'password-hash')
    assert.equal(await b.consumeChallenge(username, purpose, password), null)
  }
  await a.saveChallenge('admin', 'challenge-3', 'login', 'password-hash')
  sqlite.prepare('UPDATE auth_challenges SET expires_at = ?').run(Date.now() - 1)
  assert.equal(await a.consumeChallenge('admin', 'login', 'password-hash'), null)
  sqlite.close()
})

test('TOTP codes cannot be reused for login or disabling verification, including after module reload', () => {
  const sqlite = securityDatabase()
  const totp = load('src/lib/totp.ts', i18nMocks)
  const secret = totp.newTotpSecret()
  sqlite.prepare('INSERT INTO admins (id, username, totp_secret, created_at) VALUES (1, ?, ?, ?)').run('admin', secret, new Date().toISOString())
  const mocks = { '@/db': { sqlite }, './totp': totp }
  const a = load('src/lib/admin-totp.ts', mocks)
  const b = load('src/lib/admin-totp.ts', mocks)
  const admin = { id: 1, username: 'admin', totpSecret: secret }
  const code = totp.currentTotp('admin', secret)
  assert.equal(a.consumeAdminTotp(admin, 'abcdef'), false)
  assert.equal(a.consumeAdminTotp(admin, code), true)
  assert.equal(b.consumeAdminTotp(admin, code), false)
  assert.equal(b.consumeAdminTotp(admin, code, true), false)
  assert.equal(sqlite.prepare('SELECT totp_secret FROM admins').get().totp_secret, secret)
  const { TOTP, Secret } = localRequire('otpauth')
  const nextCode = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30, algorithm: 'SHA1' }).generate({ timestamp: Date.now() + 30_000 })
  assert.equal(b.consumeAdminTotp(admin, nextCode, true), true)
  assert.equal(sqlite.prepare('SELECT totp_secret FROM admins').get().totp_secret, null)
  assert.equal(b.consumeAdminTotp(admin, nextCode), false)
  sqlite.close()
})

test('an existing TOTP secret cannot be replaced by submitting a code for an attacker secret', async () => {
  let writes = 0
  const chain = { from: () => chain, where: () => chain, limit: async () => [{ id: 1, username: 'admin', totpSecret: 'EXISTINGSECRET' }] }
  const route = load('src/app/api/v1/auth/totp/route.ts', {
    'next/server': jsonResponseMock, 'drizzle-orm': { eq: () => null }, '@/db/schema': { admins: {} },
    '@/db': { db: { select: () => chain }, sqlite: { prepare: () => { writes++; throw Error('must not write') } } },
    '@/lib/auth': { getCurrentAdmin: async () => ({ id: 1, username: 'admin' }), unauthorized: () => Response.json({}, { status: 401 }) },
    '@/lib/totp': { totpStep: () => 123 }, '@/lib/admin-totp': {}, '@/lib/login-rate-limit': {},
    '@/lib/audit': {}, '@/lib/i18n/server': { getTranslator: async () => (key) => key },
  })
  const result = await route.PUT(new Request('https://panel.test/api/v1/auth/totp', { method: 'PUT', body: JSON.stringify({ secret: 'A'.repeat(32), code: '123456' }) }))
  assert.equal(result.status, 409)
  assert.equal(writes, 0)
})

test('TOTP setup uses a conditional write so concurrent setup cannot replace an enabled secret', async () => {
  const sqlite = securityDatabase()
  sqlite.prepare('INSERT INTO admins (id, username, created_at) VALUES (1, ?, ?)').run('admin', new Date().toISOString())
  const chain = { from: () => chain, where: () => chain, limit: async () => [{ id: 1, username: 'admin', totpSecret: null }] }
  const route = load('src/app/api/v1/auth/totp/route.ts', {
    'next/server': jsonResponseMock, 'drizzle-orm': { eq: () => null }, '@/db/schema': { admins: {} }, '@/db': { db: { select: () => chain }, sqlite },
    '@/lib/auth': { getCurrentAdmin: async () => ({ id: 1, username: 'admin' }) }, '@/lib/totp': { totpStep: () => 123 },
    '@/lib/admin-totp': {}, '@/lib/login-rate-limit': {}, '@/lib/audit': { audit: async () => {} }, '@/lib/i18n/server': { getTranslator: async () => (key) => key },
  })
  const request = (secret) => new Request('https://panel.test/api/v1/auth/totp', { method: 'PUT', body: JSON.stringify({ secret, code: '123456' }) })
  assert.equal((await route.PUT(request('A'.repeat(32)))).status, 200)
  assert.equal((await route.PUT(request('B'.repeat(32)))).status, 409)
  assert.equal(sqlite.prepare('SELECT totp_secret, totp_last_used_step FROM admins').get().totp_secret, 'A'.repeat(32))
  sqlite.close()
})

test('production ignores demo and seed flags', () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, DEMO_MODE: process.env.DEMO_MODE, ALLOW_SEED: process.env.ALLOW_SEED }
  try {
    process.env.NODE_ENV = 'production'; process.env.DEMO_MODE = 'true'; process.env.ALLOW_SEED = 'true'
    const mode = load('src/lib/runtime-mode.ts')
    assert.equal(mode.isDemoMode(), false)
    assert.equal(mode.isSeedEnabled(), false)
    process.env.NODE_ENV = 'development'
    assert.equal(mode.isDemoMode(), true)
    assert.equal(mode.isSeedEnabled(), true)
  } finally { for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value } }
})

test('cookie authentication rejects sibling-site CSRF, scheme changes and malformed origins', () => {
  const previous = process.env.PANEL_URL
  delete process.env.PANEL_URL
  try {
    const { hasTrustedOrigin } = load('src/lib/request-origin.ts')
    const check = (origin, extra = {}) => hasTrustedOrigin(new Headers({ host: 'panel.example.test', 'x-forwarded-proto': 'https', ...(origin ? { origin } : {}), ...extra }))
    assert.equal(check('https://panel.example.test'), true)
    for (const origin of ['https://evil.example.test', 'http://panel.example.test', 'null', 'not-a-url', 'https://panel.example.test/path']) assert.equal(check(origin), false)
    assert.equal(check(undefined, { 'sec-fetch-site': 'cross-site' }), false)
    assert.equal(check(undefined), true)
    assert.equal(check('https://panel.example.test', { host: 'panel:3000', 'x-forwarded-host': 'panel.example.test' }), true)
  } finally { if (previous === undefined) delete process.env.PANEL_URL; else process.env.PANEL_URL = previous }
})

test('forwarding targets normalize consistently and reject invalid addresses and configuration injection', () => {
  const validators = load('src/lib/validators.ts', i18nMocks)
  for (const targets of ['one@example.test, TWO@example.test', ['one@example.test', ' TWO@example.test ']]) {
    assert.deepEqual(validators.createRuleSchema.parse({ matchType: 'catchall', targets }).targets, ['one@example.test', 'two@example.test'])
    assert.deepEqual(validators.updateRuleSchema().parse({ targets }).targets, ['one@example.test', 'two@example.test'])
  }
  for (const targets of ['', [], 'not-an-email', 'ok@example.test,not-an-email', 'a@example.test\n/^.*$/ evil@example.test', Array(101).fill('a@example.test')]) {
    assert.equal(validators.createRuleSchema.safeParse({ matchType: 'catchall', targets }).success, false)
    assert.equal(validators.updateRuleSchema().safeParse({ targets }).success, false)
  }
  assert.equal(validators.updateRuleSchema().safeParse({}).success, false)
  assert.equal(validators.updateDomainSchema.safeParse({ mailHostname: 'host\nInjected: value' }).success, false)
  assert.equal(validators.settingsPatchSchema.safeParse({ vpsIp: '999.1.2.3' }).success, false)
  assert.equal(validators.settingsPatchSchema.safeParse({ allowSmtp: 'false' }).success, false)
  assert.equal(validators.settingsPatchSchema.safeParse({ vpsIp: '192.0.2.1', cfApiToken: 123 }).success, false)
})

test('routing map escapes slash delimiters without changing merged routing behavior', () => {
  const policy = load('src/lib/prefix-sync.ts', {
    '@/db': {}, '@/db/schema': {}, './config': {}, './i18n/translate': i18nMocks['./i18n/translate'], './validators': {},
  })
  const output = policy.buildPrefixMapContent([
    { matchType: 'prefix', matchValue: 'sales/vip', domain: 'example.test', targets: ['one@example.test'], priority: 1 },
    { matchType: 'catchall', matchValue: null, domain: 'example.test', targets: ['two@example.test'], priority: 2 },
  ])
  assert.ok(output.includes('/^sales\\/vip[^@]*@example\\.test$/  one@example.test,two@example.test'))
})

test('multipart upload limits apply before parsing, including absent and forged Content-Length', async () => {
  const { readLimitedFormData } = load('src/lib/upload.ts')
  const make = async (headers = {}) => {
    const form = new FormData(); form.set('file', new File(['a'.repeat(2048)], 'test.db'))
    const encoded = new Request('https://panel.test/upload', { method: 'POST', body: form })
    const request = new Request(encoded.url, { method: 'POST', body: await encoded.arrayBuffer(), headers: encoded.headers })
    for (const [key, value] of Object.entries(headers)) request.headers.set(key, value)
    return request
  }
  assert.equal((await readLimitedFormData(await make(), 1024)).tooLarge, true)
  assert.equal((await readLimitedFormData(await make({ 'content-length': '1' }), 1024)).tooLarge, true)
  assert.equal((await readLimitedFormData(await make({ 'content-length': '99999999' }), 1024)).tooLarge, true)
  const allowed = await readLimitedFormData(await make(), 8192)
  assert.equal(allowed.tooLarge, false)
  assert.equal(allowed.form.get('file').size, 2048)
})

test('failed mailbox creation removes the unusable management record and reports failure', async () => {
  let deleted = false
  const chain = { from: () => chain, where: () => chain, limit: async () => [{ id: 1, name: 'example.test', active: true }] }
  const db = { select: () => chain, insert: () => ({ values: () => ({ returning: async () => [{ id: 2, login: 'new@example.test' }] }) }), delete: () => ({ where: async () => { deleted = true } }) }
  const validators = load('src/lib/validators.ts', i18nMocks)
  const route = load('src/app/api/v1/domains/[id]/mailboxes/route.ts', {
    'next/server': jsonResponseMock, 'drizzle-orm': { eq: () => null }, '@/db': { db }, '@/db/schema': { domains: {}, mailboxes: {} },
    '@/lib/auth': { getCurrentAdmin: async () => ({ id: 1, username: 'admin' }) }, '@/lib/audit': { audit: async () => {} },
    '@/lib/validators': validators, '@/lib/sync': { syncMailboxCreate: async () => ({ ok: false, results: [{ ok: false }] }) },
    '@/lib/mail-listeners': { ensureMailListeners: () => { throw Error('must not continue') } }, '@/lib/mailbox-policy-sync': {},
    '@/lib/i18n/server': { getTranslator: async () => (key) => key },
  })
  const result = await route.POST(new Request('https://panel.test/api/v1/domains/1/mailboxes', { method: 'POST', body: JSON.stringify({ login: 'new@example.test', password: 'test-password' }) }), { params: Promise.resolve({ id: '1' }) })
  assert.equal(result.status, 502)
  assert.equal(deleted, true)
})

test('Cloudflare clear disables environment fallback; saving a replacement re-enables it; invalid patches write nothing', async () => {
  const values = new Map()
  const validators = load('src/lib/validators.ts', i18nMocks)
  const route = load('src/app/api/v1/settings/route.ts', {
    'next/server': jsonResponseMock, '@/lib/auth': { getCurrentAdmin: async () => ({ id: 1, username: 'admin' }) }, '@/lib/audit': { audit: async () => {} },
    '@/lib/settings': { setSetting: async (key, value) => values.set(key, value), getPanelSettings: async () => ({}) },
    '@/lib/validators': validators, '@/lib/cloudflare': {}, '@/lib/mailbox-policy-sync': {}, '@/lib/i18n/server': { getTranslator: async () => (key) => key },
    '@/lib/crypto': { encryptSecret: (value) => 'encrypted:' + value },
  })
  assert.equal((await route.DELETE()).status, 200)
  assert.equal(values.get('cf_api_token_disabled'), 'true')
  values.clear()
  const result = await route.PATCH(new Request('https://panel.test/api/v1/settings', { method: 'PATCH', body: JSON.stringify({ vpsIp: '192.0.2.1', cfApiToken: 123 }) }))
  assert.equal(result.status, 400)
  assert.equal(values.size, 0)
  const saved = await route.PATCH(new Request('https://panel.test/api/v1/settings', { method: 'PATCH', body: JSON.stringify({ cfApiToken: 'new-test-token' }) }))
  assert.equal(saved.status, 200)
  assert.equal(values.get('cf_api_token'), 'encrypted:new-test-token')
  assert.equal(values.get('cf_api_token_disabled'), 'false')
})
