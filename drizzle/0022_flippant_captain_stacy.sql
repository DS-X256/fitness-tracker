CREATE TABLE `peptide_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`peptide_id` integer,
	`date` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`byte_size` integer NOT NULL,
	`caption` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`peptide_id`) REFERENCES `peptides`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `peptide_photos_user_date_idx` ON `peptide_photos` (`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `peptide_photos_peptide_idx` ON `peptide_photos` (`peptide_id`);