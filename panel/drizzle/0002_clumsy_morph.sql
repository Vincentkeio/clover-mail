ALTER TABLE `mailboxes` ADD `allow_imap` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `allow_pop3` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `allow_sieve` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `allow_smtp` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `allow_external_images` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `allow_executable_attachments` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `max_attachment_mb` integer DEFAULT 100 NOT NULL;
--> statement-breakpoint
DELETE FROM `settings` WHERE `key` IN ('protocol_imap', 'protocol_pop3', 'protocol_sieve');
