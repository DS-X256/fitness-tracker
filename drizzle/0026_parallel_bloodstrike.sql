CREATE TABLE `body_insights` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`content` text NOT NULL,
	`generated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `nutrition_insights` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`content` text NOT NULL,
	`generated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
