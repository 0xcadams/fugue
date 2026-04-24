import {
  defineMutatorWithType,
  defineMutatorsWithType,
  defineQueriesWithType,
  defineQueryWithType,
} from "@rocicorp/zero";
import { z } from "zod";

import { demoUserID, laneOrder } from "./kanban";
import { type Schema, zql } from "./zero-schema.gen";

export type ZeroContext = {
  userID: string;
};

export function getZeroContext(): ZeroContext {
  return { userID: demoUserID };
}

const defineQuery = defineQueryWithType<Schema, ZeroContext>();
const defineQueries = defineQueriesWithType<Schema>();
const defineMutator = defineMutatorWithType<Schema, ZeroContext>();
const defineMutators = defineMutatorsWithType<Schema>();

const boardArgs = z.object({
  boardId: z.string(),
});

const laneSchema = z.enum(laneOrder);

const createCardArgs = z.object({
  id: z.string(),
  boardId: z.string(),
  lane: laneSchema,
  position: z.string(),
  title: z.string().trim().min(1),
});

const moveCardArgs = z.object({
  id: z.string(),
  lane: laneSchema,
  position: z.string(),
});

const removeCardArgs = z.object({
  id: z.string(),
});

export const queries = defineQueries({
  boards: {
    byId: defineQuery(boardArgs, ({ args }) =>
      zql.boards.where("id", args.boardId).one(),
    ),
  },
  cards: {
    byBoard: defineQuery(boardArgs, ({ args }) =>
      zql.cards
        .where("boardId", args.boardId)
        .orderBy("position", "asc")
        .orderBy("id", "asc"),
    ),
  },
});

export const mutators = defineMutators({
  cards: {
    create: defineMutator(createCardArgs, async ({ tx, args }) => {
      await tx.mutate.cards.insert({
        id: args.id,
        boardId: args.boardId,
        lane: args.lane,
        position: args.position,
        title: args.title,
      });
    }),
    move: defineMutator(moveCardArgs, async ({ tx, args }) => {
      await tx.mutate.cards.update({
        id: args.id,
        lane: args.lane,
        position: args.position,
      });
    }),
    remove: defineMutator(removeCardArgs, async ({ tx, args }) => {
      await tx.mutate.cards.delete({
        id: args.id,
      });
    }),
  },
});
