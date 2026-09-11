CREATE TABLE `analysis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`goal` text NOT NULL,
	`status` text NOT NULL,
	`chapter_map_json` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_analysis_runs_book_created` ON `analysis_runs` (`book_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`original_filename` text NOT NULL,
	`media_type` text NOT NULL,
	`storage_key` text NOT NULL,
	`text_storage_key` text NOT NULL,
	`source_url` text,
	`rights_basis` text NOT NULL,
	`rights_note` text,
	`sha256` text NOT NULL,
	`character_count` integer NOT NULL,
	`chapter_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_books_created_at` ON `books` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_books_sha256` ON `books` (`sha256`);--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`title` text NOT NULL,
	`outline` text NOT NULL,
	`content` text NOT NULL,
	`prompt_snapshot_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `story_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chapters_project_sequence` ON `chapters` (`project_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `evidence_spans` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_run_id` text NOT NULL,
	`chapter_label` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`excerpt` text NOT NULL,
	`score` integer NOT NULL,
	`reasons_json` text NOT NULL,
	FOREIGN KEY (`analysis_run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_evidence_run_score` ON `evidence_spans` (`analysis_run_id`,`score`);--> statement-breakpoint
CREATE TABLE `memory_events` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_item_id` text NOT NULL,
	`action` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`memory_item_id`) REFERENCES `memory_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_memory_events_item_created` ON `memory_events` (`memory_item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `memory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_run_id` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`title` text NOT NULL,
	`content_json` text NOT NULL,
	`confidence` integer NOT NULL,
	`evidence_ids_json` text NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`analysis_run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_memory_status_kind` ON `memory_items` (`status`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_memory_analysis_run` ON `memory_items` (`analysis_run_id`);--> statement-breakpoint
CREATE TABLE `review_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`chapter_id` text NOT NULL,
	`review_type` text NOT NULL,
	`dimension` text NOT NULL,
	`severity` text NOT NULL,
	`start_offset` integer,
	`end_offset` integer,
	`message` text NOT NULL,
	`suggestion` text NOT NULL,
	`memory_candidate_json` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_review_chapter_status` ON `review_findings` (`chapter_id`,`status`);--> statement-breakpoint
CREATE TABLE `story_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`premise` text NOT NULL,
	`story_bible_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
