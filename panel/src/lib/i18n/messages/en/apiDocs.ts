const apiDocs = {
  title: 'API docs',
  tagline: 'The panel is the API',
  authTitle: 'Authentication',
  authLead: 'All',
  authBody: 'endpoints support two kinds of authentication: the panel sign-in session cookie, or an open API token —',
  authBodyAfterToken: ' (generate one under "Settings → Open API Token"). A token is equivalent to admin credentials, so keep it as safe as a password; revocation takes effect immediately.',
  errorFormatLead: 'Responses are always JSON; errors use the format',
  errorFormatSample: '{ "error": "description" }',
  errorFormatBody: '; common status codes: 400 bad request · 401 unauthenticated · 404 not found · 409 conflict (duplicate) · 422 semantically invalid · 502 upstream (DMS/CF) failure. Every change is written to the audit log (the actor is recorded as',
  auditActor: 'api:<token name>',
  errorFormatEnd: ').',
  colMethod: 'Method',
  colPath: 'Path',
  colDescription: 'Description',
  goGenerateToken: '← Generate an API token',

  groupDomains: 'Domains',
  groupMailboxes: 'Mailboxes',
  groupRules: 'Routing rules (four types)',
  groupDns: 'DNS (Cloudflare)',
  groupMonitor: 'Monitoring & system',
  groupCloudflare: 'Cloudflare connection (add a Token once, manage DNS in bulk)',
  groupSettings: 'Settings',

  domainsList: 'Domain list (with mailbox/rule counts)',
  domainsCreate: 'Create a domain; body: {"name":"example.com","quotaPolicyMb"?:number}. The mail hostname is always read from the install configuration.',
  domainsDetail: 'Domain details (with mailboxes and rules)',
  domainsUpdate: 'Update the domain quota and enabled state; the mail hostname is managed by the install configuration.',
  domainsDelete: 'Delete a domain; cascades to DMS accounts and aliases',

  mailboxesList: 'Mailboxes of a domain',
  mailboxesCreate: 'Create a mailbox; body: {"login":"a@example.com","password":"≥10 chars","quotaMb"?:number}',
  mailboxesUpdate: 'Change password / quota / disable',
  mailboxesDelete: 'Delete a mailbox (DMS is cleaned up as well)',

  rulesList: 'Rule list',
  rulesCreate: 'matchType: exact|prefix|nonuser|catchall; targets comma-separated or an array; lower priority wins',
  rulesUpdate: 'Update targets / priority / active',
  rulesDelete: 'Delete a rule (the DMS alias and prefix regex table are synced)',

  dnsList: 'Record list + generated preview + last check result',
  dnsGenerate: 'Generate / refresh DNS records (stored in the database)',
  dnsPush: 'Push to Cloudflare (diff → batch, idempotent)',
  dnsCheck: 'Check the checklist over public DoH',
  dnsExport: 'Export BIND / TXT (both can be imported into DNS)',
  dnsPreview: 'Record preview before a domain is created',

  spamStats: 'rspamd statistics (top symbols / action distribution)',
  queueStatus: 'Queue + service processes + log tail',
  deliverability: 'DNSBL blocklists + domain health check',
  reconcile: 'Reconcile; only body {"heal":true} repairs automatically',
  backup: 'Download a consistent backup (SQLite snapshot / DMS config tar)',
  tokensList: 'API token list',
  tokensCreate: 'Create a token (the plaintext is returned only once)',
  tokensRevoke: 'Revoke a token',

  cfZones: 'List every domain (zone) visible to the Token, marking whether it is already imported into the panel',
  cfImport: 'Bulk import: body {"names":["a.com"] | "all", "push":true} → create domains + generate records + push',
  cfPushAll: 'Regenerate and push every domain already created in the panel (idempotent)',

  settingsGet: 'Read panel settings (sensitive values masked)',
  settingsUpdate: 'Update panel parameters and global mailbox policies (protocol, remote content and attachment limits)',
  settingsCheck: 'CF token connectivity self-check (body {"domain":"example.com"})',
  settingsDelete: 'Clear the CF Token',
  health: 'Health check (no authentication required)',

  sampleDomainsCreate: `curl -X POST https://panel.example.com/api/v1/domains \\
  -H "Authorization: Bearer clover_xxx" -H 'Content-Type: application/json' \\
  -d '{"name":"example.com"}'`,
  sampleRulesCreate: `curl -X POST https://panel.example.com/api/v1/domains/1/rules \\
  -H "Authorization: Bearer clover_xxx" -H 'Content-Type: application/json' \\
  -d '{"matchType":"catchall","targets":"me@gmail.com"}'`,
  sampleDnsPush: `curl -X POST https://panel.example.com/api/v1/domains/1/dns/push \\
  -H "Authorization: Bearer clover_xxx"`,
  sampleReconcile: `curl -X POST https://panel.example.com/api/v1/system/reconcile \\
  -H "Authorization: Bearer clover_xxx" -H 'Content-Type: application/json' -d '{"heal":false}'`,
  sampleCfImport: `# Import every domain in the CF account and set up its DNS in one go
curl -X POST https://panel.example.com/api/v1/cloudflare/import \\
  -H "Authorization: Bearer clover_xxx" -H 'Content-Type: application/json' \\
  -d '{"names":"all","push":true}'`,
}

export default apiDocs
