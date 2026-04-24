import type { Lane } from "./kanban";

import { relations } from "drizzle-orm";
import { index, pgTable, text } from "drizzle-orm/pg-core";

export const boards = pgTable("boards", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
});

export const cards = pgTable(
  "cards",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    lane: text("lane").$type<Lane>().notNull(),
    position: text("position").notNull(),
    title: text("title").notNull(),
  },
  (table) => [
    index("cards_board_lane_position_idx").on(
      table.boardId,
      table.lane,
      table.position,
      table.id,
    ),
  ],
);

export const boardsRelations = relations(boards, ({ many }) => ({
  cards: many(cards),
}));

export const cardsRelations = relations(cards, ({ one }) => ({
  board: one(boards, {
    fields: [cards.boardId],
    references: [boards.id],
  }),
}));
