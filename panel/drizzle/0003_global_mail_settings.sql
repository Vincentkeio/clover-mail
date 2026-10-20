INSERT INTO `settings` (`key`, `value`, `sensitive`, `updated_at`)
SELECT 'protocol_imap', CASE WHEN COUNT(*) = 0 OR MIN(`allow_imap`) = 1 THEN 'true' ELSE 'false' END, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `mailboxes`
HAVING NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'protocol_imap');--> statement-breakpoint
INSERT INTO `settings` (`key`, `value`, `sensitive`, `updated_at`)
SELECT 'protocol_pop3', CASE WHEN COUNT(*) = 0 OR MIN(`allow_pop3`) = 1 THEN 'true' ELSE 'false' END, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `mailboxes`
HAVING NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'protocol_pop3');--> statement-breakpoint
INSERT INTO `settings` (`key`, `value`, `sensitive`, `updated_at`)
SELECT 'protocol_sieve', CASE WHEN COUNT(*) = 0 OR MIN(`allow_sieve`) = 1 THEN 'true' ELSE 'false' END, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `mailboxes`
HAVING NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'protocol_sieve');--> statement-breakpoint
INSERT INTO `settings` (`key`, `value`, `sensitive`, `updated_at`)
SELECT 'protocol_smtp', CASE WHEN COUNT(*) = 0 OR MIN(`allow_smtp`) = 1 THEN 'true' ELSE 'false' END, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `mailboxes`
HAVING NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'protocol_smtp');--> statement-breakpoint
INSERT INTO `settings` (`key`, `value`, `sensitive`, `updated_at`)
SELECT 'allow_external_images', CASE WHEN COUNT(*) > 0 AND MIN(`allow_external_images`) = 1 THEN 'true' ELSE 'false' END, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `mailboxes`
HAVING NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'allow_external_images');--> statement-breakpoint
INSERT INTO `settings` (`key`, `value`, `sensitive`, `updated_at`)
SELECT 'allow_executable_attachments', CASE WHEN COUNT(*) > 0 AND MIN(`allow_executable_attachments`) = 1 THEN 'true' ELSE 'false' END, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `mailboxes`
HAVING NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'allow_executable_attachments');--> statement-breakpoint
INSERT INTO `settings` (`key`, `value`, `sensitive`, `updated_at`)
SELECT 'max_attachment_mb', CASE WHEN COUNT(*) = 0 THEN '100' WHEN MIN(`max_attachment_mb`) = 0 THEN '0' ELSE CAST(MAX(`max_attachment_mb`) AS TEXT) END, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `mailboxes`
HAVING NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'max_attachment_mb');--> statement-breakpoint
ALTER TABLE `mailboxes` DROP COLUMN `allow_imap`;--> statement-breakpoint
ALTER TABLE `mailboxes` DROP COLUMN `allow_pop3`;--> statement-breakpoint
ALTER TABLE `mailboxes` DROP COLUMN `allow_sieve`;--> statement-breakpoint
ALTER TABLE `mailboxes` DROP COLUMN `allow_smtp`;--> statement-breakpoint
ALTER TABLE `mailboxes` DROP COLUMN `allow_external_images`;--> statement-breakpoint
ALTER TABLE `mailboxes` DROP COLUMN `allow_executable_attachments`;--> statement-breakpoint
ALTER TABLE `mailboxes` DROP COLUMN `max_attachment_mb`;
