CREATE TABLE `auth_challenges` (
	`key` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`purpose` text NOT NULL,
	`challenge` text NOT NULL,
	`credential_version` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `admins` ADD `totp_last_used_step` integer;