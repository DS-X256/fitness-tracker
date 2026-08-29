CREATE TABLE `assistant_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`thread_id` integer NOT NULL,
	`role` text NOT NULL,
	`enc` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `assistant_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_messages_thread_idx` ON `assistant_messages` (`thread_id`);--> statement-breakpoint
CREATE INDEX `assistant_messages_user_idx` ON `assistant_messages` (`user_id`);--> statement-breakpoint
CREATE TABLE `assistant_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`title` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_threads_user_idx` ON `assistant_threads` (`user_id`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `ai_assistant_enabled` integer DEFAULT false NOT NULL;