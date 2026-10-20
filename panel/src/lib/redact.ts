const SENSITIVE_KEY = /password|passwd|secret|token|authorization|cookie|private.?key|passphrase|credential/i
const SECRET_ENV_KEYS = ['SESSION_SECRET', 'CLOVER_CF_API_TOKEN', 'CF_API_TOKEN', 'ROUNDCUBE_SSO_SECRET', 'RECONCILE_TOKEN']

/** Redact diagnostic text, without altering the actual stored credentials. */
export function redactSensitiveText(input: string, extraSecrets: string[] = []): string {
  let text = input
  const secrets = [...SECRET_ENV_KEYS.map((key) => process.env[key] || ''), ...extraSecrets]
    .filter(Boolean).sort((a, b) => b.length - a.length)
  for (const secret of secrets) text = text.split(secret).join('[REDACTED]')
  return text
    .replace(/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED]')
    .replace(/(?<![\w-])clover_[A-Za-z0-9_-]{32}(?![\w-])/g, '[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [REDACTED]')
    .replace(/\bAUTH\s+(PLAIN|LOGIN)\s+[A-Za-z0-9+/=]+/gi, 'AUTH $1 [REDACTED]')
    .replace(/((?:[\w-]*(?:password|passwd|secret|token|api[_-]?key|authorization|passphrase|cookie)[\w-]*)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, '$1[REDACTED]')
}

/** Audit records accept arbitrary detail objects; secret-looking fields are never persisted. */
export function redactAuditDetail(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactSensitiveText(value)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (value instanceof Error) return redactSensitiveText(value.message)
  if (Array.isArray(value)) return value.map((entry) => redactAuditDetail(entry, seen))
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    SENSITIVE_KEY.test(key) && entry !== null && typeof entry !== 'boolean' && typeof entry !== 'number'
      ? '[REDACTED]' : redactAuditDetail(entry, seen),
  ]))
}
