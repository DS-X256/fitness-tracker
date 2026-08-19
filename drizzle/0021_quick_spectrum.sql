CREATE TABLE `workout_group_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`session_id` integer,
	`status` text DEFAULT 'invited' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `workout_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `workout_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "workout_group_members_status_valid" CHECK("workout_group_members"."status" in ('invited', 'joined'))
);
--> statement-breakpoint
CREATE INDEX `workout_group_members_user_idx` ON `workout_group_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `workout_group_members_session_idx` ON `workout_group_members` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workout_group_members_group_user_unique` ON `workout_group_members` (`group_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `workout_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
