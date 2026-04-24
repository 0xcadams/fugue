CREATE TABLE "boards" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"lane" text NOT NULL,
	"position" text NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_board_lane_position_idx" ON "cards" USING btree ("board_id","lane","position","id");
--> statement-breakpoint
INSERT INTO "boards" ("id", "title") VALUES ('board-demo', 'Launch Week');
--> statement-breakpoint
INSERT INTO "cards" ("id", "board_id", "lane", "position", "title") VALUES
	('todo-1', 'board-demo', 'todo', 'Uzzzzzzzzzz!gf0xSDw!Uzzzzz', 'Polish pricing page'),
	('todo-2', 'board-demo', 'todo', 'Uzzzzzzzzzz!gf0xSDw!V00H31', 'Add retry to invites'),
	('todo-3', 'board-demo', 'todo', 'Uzzzzzzzzzz!gf0xSDw!V00Y63', 'Write launch notes'),
	('doing-1', 'board-demo', 'doing', 'Uzzzzzzzzzz!rR9thha!Uzzzzz', 'Record Zero demo'),
	('doing-2', 'board-demo', 'doing', 'Uzzzzzzzzzz!rR9thha!V00H31', 'Refine card move flow'),
	('done-1', 'board-demo', 'done', 'Uzzzzzzzzzz!4q5MEld!Uzzzzz', 'Wire Drizzle schema'),
	('done-2', 'board-demo', 'done', 'Uzzzzzzzzzz!4q5MEld!V00H31', 'Generate Zero schema');
