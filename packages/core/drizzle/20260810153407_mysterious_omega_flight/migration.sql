CREATE TABLE `alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`listing_id` text NOT NULL CONSTRAINT `alerts_listing_id_unique` UNIQUE,
	`payload_json` text NOT NULL,
	`dry_run` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_alerts_listing_id_listings_id_fk` FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`)
);
--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY,
	`source` text NOT NULL,
	`source_listing_id` text NOT NULL,
	`title` text NOT NULL,
	`price_cents` integer NOT NULL,
	`category` text,
	`image_path` text NOT NULL,
	`source_url` text NOT NULL,
	`posted_at` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `listings_source_source_listing_id_unique` UNIQUE(`source`,`source_listing_id`),
	CONSTRAINT "listings_source_check" CHECK("source" IN ('thriftly','secondlook','reloop'))
);
--> statement-breakpoint
CREATE TABLE `scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`listing_id` text NOT NULL,
	`image_path` text NOT NULL,
	`score` real NOT NULL,
	`raw_response` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_scores_listing_id_listings_id_fk` FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`),
	CONSTRAINT "scores_score_check" CHECK("score" >= 0 AND "score" <= 100)
);
--> statement-breakpoint
CREATE INDEX `idx_alerts_listing_id` ON `alerts` (`listing_id`);--> statement-breakpoint
CREATE INDEX `idx_listings_source` ON `listings` (`source`);--> statement-breakpoint
CREATE INDEX `idx_scores_listing_id` ON `scores` (`listing_id`);