// Messages returned by server APIs to the panel UI (panel settings, backup, certificates, maintenance, migration, tokens and update check plus their helper libraries).
const apiSystem = {
  // Panel settings (settings)
  'settings.mailBooleansBoolean': 'Global mailbox switches must be boolean values',
  'settings.attachmentSizeInvalid': 'Attachment size must be an integer between 0 and {max} MB',
  'settings.vpsIpInvalid': 'Invalid VPS IP format',
  'settings.dnsModeInvalid': 'Invalid DNS mode',
  'settings.dmarcPolicyInvalid': 'dmarcPolicy only supports none/quarantine/reject',
  'settings.cfTokenEmpty': 'CF Token cannot be empty (call DELETE to clear it)',
  'settings.policySyncFailed': 'Mailbox settings were saved, but DMS could not apply them: {error}',
  'settings.cfTokenMissing': 'No CF Token configured',
  'settings.domainMissing': 'Domain is required',
  'settings.tokenDecryptFailed': '*** (decryption failed, enter it again)',

  // Consistent backup and import (system/backup)
  'backup.dbFailed': 'Backup failed: {error}',
  'backup.dmsConfigFailed': 'DMS config backup failed (docker unavailable?): {error}',
  'backup.whatUnsupported': 'what only supports db | dms-config',
  'backup.archiveStructureInvalid': 'Invalid mail config archive directory structure.',
  'backup.archiveLinkRejected': 'The mail config archive contains links or special files, so the import was rejected.',
  'backup.invalidDbFile': 'Select a valid .db file (up to {max}).',
  'backup.dbCheckFailed': 'Database validation failed: the file is not a usable Clover panel database.',
  'backup.dbReadFailed': 'Database validation failed: cannot read the SQLite file: {error}',
  'backup.dbImported': 'Database imported. The panel is restarting.',
  'backup.dbImportFailed': 'Database import failed: {error}',
  'backup.invalidConfigFile': 'Select a mail config .tar.gz archive (up to {max}).',
  'backup.configValidateFailed': 'Mail config archive validation failed: {error}',
  'backup.configImported': 'Mail service configuration imported and the mail service restarted.',
  'backup.configImportFailed': 'Mail config import failed: {error}',
  'backup.badOrigin': 'Invalid request origin.',
  'backup.fileMissing': 'Select a backup file to import.',

  // Panel certificate tasks (system/certificates)
  'certificates.statusReadFailed': 'Cannot read the certificate status: {error}',
  'certificates.caddyManaged': 'Caddy manages the panel certificate; Caddy issues and renews it automatically.',
  'certificates.taskStarted': 'Certificate task started.',
  'certificates.operationFailed': 'Certificate operation failed: {error}',

  // Certificate helper (certificate-status)
  'certificateStatus.helperMissing': 'The certificate helper container does not exist. Recreate certificate-helper through a service update or repair.',
  'certificateStatus.startFailed': 'The certificate helper is stopped and could not be started automatically. Check the clover-certificate-helper container logs.',
  'certificateStatus.notRunning': 'The certificate helper is still not running after starting it. Check the clover-certificate-helper container logs.',
  'certificateStatus.stoppedWhileReading': 'The certificate helper stopped while reading its status. Refresh and try again; if it still fails, check the container logs.',

  // TLS probing (certificate-probe)
  'certificateProbe.timeout': 'Connection timed out',

  // Deliverability: DNSBL lists (dnsbl)
  'deliverability.ipInvalid': 'Invalid IP format',
  'deliverability.unsupportedZone': 'This DNSBL is not in the supported list',
  'deliverability.listedDetail': 'The list returned a valid listing code: {codes}',
  'deliverability.returnedCodes': 'Returned {codes}',
  'deliverability.restrictedByResolver': 'The list blocks public resolver queries or rate limits them, so whether this IP is listed cannot be determined here. Verify on the list website.',
  'deliverability.queryNameInvalid': 'The DNSBL query name is misconfigured, so listing cannot be determined.',
  'deliverability.unknownCode': 'The list returned an unrecognized response code, so listing cannot be determined.',
  'deliverability.spamhausUnverifiable': 'The public resolver returned no verifiable Spamhaus result; this does not prove the IP is clean. Verify on the Spamhaus website.',
  'deliverability.notListedDetail': 'This lookup returned no valid listing record.',

  // Deliverability: domain health (dnsbl)
  'deliverability.mxLabel': 'MX points to the mail host',
  'deliverability.noMx': 'No MX record',
  'deliverability.aRecordLabel': '{host} has an A record',
  'deliverability.noA': 'No A record',
  'deliverability.noSpf': 'No SPF record found',
  'deliverability.spfMultiple': 'Found {count} SPF records; a domain may only publish one. {records}',
  'deliverability.spfFound': 'One SPF record found in DNS: {record} (full SPF syntax and real mail authentication are not verified)',
  'deliverability.spfDuplicateLabel': 'Duplicate SPF record',
  'deliverability.spfSingleLabel': 'Single SPF record check',
  'deliverability.dkimLabel': 'DKIM public key present',
  'deliverability.noDkim': 'No DKIM TXT found',
  'deliverability.dmarcLabel': 'DMARC record present',
  'deliverability.noDmarc': 'No DMARC TXT found',
  'deliverability.checkFailedLabel': 'Check failed',
  'deliverability.dnsUnreachable': 'DNS query network unreachable',
  'deliverability.otherFailures': '{count} more lookups failed',

  // Maintenance tasks (system/maintenance)
  'maintenance.projectDirUnknown': 'Cannot determine the installation directory',
  'maintenance.badOrigin': 'Invalid request origin',
  'maintenance.invalidAction': 'Invalid action',
  'maintenance.updateConfirmRequired': 'Updating requires manual confirmation.',
  'maintenance.jobRunning': 'A maintenance task is already running',
  'maintenance.domainInvalid': 'Enter two different real domains. Test domains can only keep their current values.',
  'maintenance.aRecordMissing': 'The A record of {host} does not point to this server ({ip}) yet. Configure it in DNS and wait for it to take effect.',
  'maintenance.started': 'Maintenance task started.',
  'maintenance.configureStarted': 'Applying the domain configuration. The page reloads automatically when it finishes.',
  'maintenance.startFailed': 'Cannot start the maintenance task',
  'maintenance.ticketExpired': 'The task query ticket has expired. Reopen the panel to view task records.',
  'maintenance.sessionSecretMissing': 'The panel session secret is not configured yet.',

  // Migration package import and export (system/migration)
  'migration.invalidJob': 'Invalid migration job ID.',
  'migration.starting': 'Starting the restore task…',
  'migration.queued': 'Waiting for the restore task…',
  'migration.badOrigin': 'Invalid request origin.',
  'migration.confirmRequired': 'Enter the confirmation word and try again.',
  'migration.passphraseLength': 'The migration passphrase must be 12 to 256 characters.',
  'migration.packageTooLarge': 'The migration package exceeds the 100 GiB limit.',
  'migration.packageEmpty': 'The migration package is empty.',
  'migration.packageIncomplete': 'The migration package is incomplete.',
  'migration.notCloverPackage': 'The file is not an encrypted Clover migration package.',
  'migration.invalidPath': 'The migration package contains invalid paths.',
  'migration.linkRejected': 'The migration package contains links or special files, so the restore was rejected.',
  'migration.missingItem': 'The migration package is missing required content: {item}',
  'migration.manifestInvalid': 'The migration package manifest version or volume list is invalid.',
  'migration.restoreStarted': 'Restore task started.',
  'migration.importFailed': 'Migration package import failed: {error}',
  'migration.prepareFailed': 'Cannot prepare the migration package: {error}',
  'migration.exportFailed': 'Migration export failed ({code})',

  // API tokens (system/tokens)
  'tokens.demoMode': 'Creating tokens is not allowed in DEMO_MODE',
  'tokens.nameRequired': 'Give the token a name (so it can be identified when revoked)',
  'tokens.idMissing': 'id is required',
  'tokens.notFound': 'Token not found',

  // Update check (system/update-check)
  'updateCheck.checkFailed': 'Update check failed.',
  'updateCheck.remoteHttpError': 'The remote service returned HTTP {status}',
  'updateCheck.noRegistryToken': 'The image registry did not return a read credential',
  'updateCheck.noArchImage': 'The published image has no build for {arch}',
  'updateCheck.imageConfigMissing': 'Cannot read the published image version metadata',
  'updateCheck.versionUnknown': 'Cannot determine the numeric version of the published image. Try again later.',
  'updateCheck.available': 'Version {version} is available. You can update now.',
  'updateCheck.sourceBuild': 'Running a local build; you can switch to the latest published version manually.',
  'updateCheck.latest': 'You are on the latest version.',
  'updateCheck.cacheFailed': 'Update check failed. Try again manually.',

  // rspamd aggregate statistics (system/spam-stats)
  'spamStats.abnormalResponse': 'Unexpected rspamd response: {detail}',
  'spamStats.emptyResponse': '(empty response; check the controller port and password)',

  // Reconcile report (reconcile)
  'reconcile.prefixMapApplied': 'prefix-map applied {count} entries',
  'reconcile.prefixMapFailed': 'prefix-map sync failed: {error}',
  'reconcile.aliasAddFailed': 'alias+ {alias} failed: {error}',
  'reconcile.aliasDeleteFailed': 'alias- {alias} failed: {error}',
  'reconcile.mailboxDeleteFailed': 'mailbox- {login} failed: {error}',
  'reconcile.manualRebuild': 'These mailboxes are missing on the DMS side and their passwords cannot be recovered, so they must be rebuilt manually: {logins}',
}

export default apiSystem
