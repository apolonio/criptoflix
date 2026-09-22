CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_user_id` text,
	`login` text NOT NULL,
	`full_name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_auth_user_id_unique` ON `profiles` (`auth_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_login_unique` ON `profiles` (`login`);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_email_unique` ON `profiles` (`email`);--> statement-breakpoint
CREATE INDEX `profiles_status_idx` ON `profiles` (`status`);--> statement-breakpoint
CREATE INDEX `profiles_email_idx` ON `profiles` (`email`);