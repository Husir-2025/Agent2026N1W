CREATE TABLE `continuity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`continuity_item_id` text NOT NULL,
	`chapter_id` text,
	`sequence` integer NOT NULL,
	`action` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`continuity_item_id`) REFERENCES `continuity_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_continuity_events_item_sequence` ON `continuity_events` (`continuity_item_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_continuity_events_chapter` ON `continuity_events` (`chapter_id`);--> statement-breakpoint
CREATE TABLE `continuity_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`current_state` text NOT NULL,
	`change_rule` text,
	`status` text DEFAULT 'active' NOT NULL,
	`importance` text DEFAULT 'major' NOT NULL,
	`introduced_sequence` integer DEFAULT 0 NOT NULL,
	`target_sequence` integer,
	`resolved_sequence` integer,
	`last_touched_sequence` integer DEFAULT 0 NOT NULL,
	`mention_count` integer DEFAULT 0 NOT NULL,
	`keywords_json` text DEFAULT '[]' NOT NULL,
	`evolution_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `story_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_continuity_project_status_kind` ON `continuity_items` (`project_id`,`status`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_continuity_project_target` ON `continuity_items` (`project_id`,`target_sequence`);