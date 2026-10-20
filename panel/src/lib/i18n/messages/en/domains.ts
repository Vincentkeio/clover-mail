const domains = {
  title: 'Domains',
  intro: 'Add mail domains, review ownership verification details, and manage which domains are active. DNS records are managed on the DNS page.',
  countHint: '{count} domains',
  addTitle: 'Add a domain',
  addHint: 'Once added, you can generate, sync, and check MX, SPF, DKIM, and DMARC records on the DNS page.',
  empty: 'No domains yet. Add your first one above.',
  colMailHostname: 'Mail hostname',
  colMailboxes: 'Mailboxes',
  colRules: 'Rules',
  colOwnership: 'Ownership TXT',
  requestFailed: 'Action failed, please try again.',
  confirmDisable: 'Disable {name}? Client sign-in and sending for this domain will pause and new mail will be temporarily rejected; both resume once you re-enable it.',
  toggleFailed: 'Failed to change status.',
  confirmDelete: 'Delete {name}? This will also delete {mailboxes} mailboxes with their mail data and {rules} routing rules. Cloudflare DNS records are not deleted automatically. This action cannot be undone.',
  policySyncFailed: 'The domain was deleted, but the mail service policy could not be synced: {error}',
  deleteFailed: 'Failed to delete.',
  applying: 'Applying…',
  deleting: 'Deleting…',
  disableAria: 'Disable {name}',
  enableAria: 'Enable {name}',
}

export default domains
