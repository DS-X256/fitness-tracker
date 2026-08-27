CREATE TABLE `peptide_insights` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`enc` text NOT NULL,
	`generated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `weekly_digests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`iso_week_start` text NOT NULL,
	`model` text NOT NULL,
	`content` text NOT NULL,
	`generated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_digests_user_week_unique` ON `weekly_digests` (`user_id`,`iso_week_start`);--> statement-breakpoint
CREATE TABLE `workout_coach_insights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`session_id` integer NOT NULL,
	`model` text NOT NULL,
	`content` text NOT NULL,
	`generated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `workout_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workout_coach_insights_user_idx` ON `workout_coach_insights` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workout_coach_insights_session_unique` ON `workout_coach_insights` (`session_id`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `ai_peptide_insights_enabled` integer DEFAULT false NOT NULL;