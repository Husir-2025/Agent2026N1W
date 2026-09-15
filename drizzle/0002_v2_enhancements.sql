CREATE TABLE `ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT '情节点' NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`priority` integer DEFAULT 3 NOT NULL,
	`person_tag` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`placement` text,
	`status` text DEFAULT 'active' NOT NULL,
	`used_in_sequence` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chapter_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`key_facts_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `story_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	UNIQUE(`chapter_id`)
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `volumes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`volume_no` integer NOT NULL,
	`title` text NOT NULL,
	`strategy` text NOT NULL,
	`pacing` text,
	`start_sequence` integer NOT NULL,
	`end_sequence` integer NOT NULL,
	`climax_sequence` integer,
	`chapter_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `story_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ideas_status_priority` ON `ideas` (`status`,`priority`);
--> statement-breakpoint
CREATE INDEX `idx_chapter_summaries_project_sequence` ON `chapter_summaries` (`project_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `idx_volumes_project_no` ON `volumes` (`project_id`,`volume_no`);
