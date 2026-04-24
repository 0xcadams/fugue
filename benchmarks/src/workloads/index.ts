import {
  applyBoardOperation,
  applyTextOperation,
  cloneBoardState,
} from "../lib/model.js";
import { combineSeed, makePRNG, randomSignedOffset } from "../lib/prng.js";
import type {
  BoardOperation,
  BoardState,
  Scale,
  TextOperation,
  TextWorkload,
  BoardWorkload,
} from "../lib/types.js";

type ActorState = {
  cursor: number;
};

const DOCUMENT_PHRASES = [
  "Local-first systems keep latency low and intent clear.",
  "Collaborative editors spend most of their time near recent cursors.",
  "Ordered collections show up in notes, outlines, kanban boards, and rich text.",
  "Real workloads alternate between short typing streaks and larger paste bursts.",
  "Users often revisit a hot paragraph to refine a sentence several times in a row.",
  "Benchmarks should look like product behavior instead of midpoint torture tests.",
  "Stable ordering is useful for comments, selections, cards, checklist items, and rows.",
  "Text traces become more realistic when punctuation, spaces, and line breaks appear naturally.",
];

const INSERT_WORDS = [
  "editor",
  "cursor",
  "local",
  "merge",
  "intent",
  "range",
  "board",
  "sync",
  "draft",
  "trace",
  "burst",
  "block",
  "card",
  "index",
  "order",
  "delta",
  "text",
  "position",
  "compare",
  "state",
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function buildInitialDocument(paragraphCount: number) {
  const paragraphs: string[] = [];

  for (let index = 0; index < paragraphCount; index++) {
    const heading = `Section ${index + 1}`;
    const body = [
      DOCUMENT_PHRASES[index % DOCUMENT_PHRASES.length]!,
      DOCUMENT_PHRASES[(index + 2) % DOCUMENT_PHRASES.length]!,
      DOCUMENT_PHRASES[(index + 5) % DOCUMENT_PHRASES.length]!,
    ].join(" ");
    paragraphs.push(`${heading}\n${body}`);
  }

  return paragraphs.join("\n\n");
}

function makeTypingChunk(prng: ReturnType<typeof makePRNG>) {
  const mode = prng.nextFloat();

  if (mode < 0.18) {
    return " ";
  }

  if (mode < 0.24) {
    return "\n";
  }

  if (mode < 0.32) {
    return `${prng.pick([".", ",", ";", ":", "?", "!"])} `;
  }

  const word = prng.pick(INSERT_WORDS);
  if (mode < 0.62) {
    return word.slice(
      0,
      1 + prng.nextInt(Math.max(1, Math.min(word.length, 5))),
    );
  }

  return `${word} `;
}

function makePasteChunk(prng: ReturnType<typeof makePRNG>) {
  const wordCount = 5 + prng.nextInt(10);
  const words: string[] = [];

  for (let index = 0; index < wordCount; index++) {
    words.push(prng.pick(INSERT_WORDS));
  }

  const suffix = prng.nextFloat() < 0.5 ? ". " : "\n";
  return `${words.join(" ")}${suffix}`;
}

function localIndex(
  base: number,
  docLength: number,
  prng: ReturnType<typeof makePRNG>,
  spread: number,
) {
  return clamp(base + randomSignedOffset(prng, spread), 0, docLength);
}

function generateDocumentSession(scale: Scale): TextWorkload {
  const prng = makePRNG(combineSeed(0x2001, scale));
  const targetOps = scale === "full" ? 16_000 : 5_000;
  const initialText = buildInitialDocument(scale === "full" ? 16 : 10);
  const operations: TextOperation[] = [];
  const document = [...initialText];
  const actors: Record<string, ActorState> = {
    alice: { cursor: Math.floor(document.length * 0.2) },
    bob: { cursor: Math.floor(document.length * 0.52) },
    carol: { cursor: Math.floor(document.length * 0.78) },
  };
  const actorNames = Object.keys(actors);

  while (operations.length < targetOps) {
    const actor = prng.pick(actorNames)!;
    const state = actors[actor]!;
    const chance = prng.nextFloat();

    if (chance < 0.12) {
      state.cursor = prng.nextInt(document.length + 1);
      continue;
    }

    if (document.length === 0 || chance < 0.76) {
      const index = localIndex(state.cursor, document.length, prng, 18);
      const text =
        prng.nextFloat() < 0.84 ? makeTypingChunk(prng) : makePasteChunk(prng);
      const operation: TextOperation = { kind: "insert", actor, index, text };
      operations.push(operation);
      applyTextOperation(document, operation);
      state.cursor = index + text.length;
      continue;
    }

    const index = localIndex(state.cursor, document.length - 1, prng, 12);
    const length = 1 + prng.nextInt(Math.min(10, document.length - index));
    const operation: TextOperation = { kind: "delete", actor, index, length };
    operations.push(operation);
    applyTextOperation(document, operation);
    state.cursor = index;
  }

  return {
    name: "document_session",
    kind: "text",
    description:
      "Three collaborators edit a multi-section document with mostly local typing, occasional paste bursts, deletes, and cursor jumps.",
    initialText,
    operations,
    expectedText: document.join(""),
    meta: {
      actors: actorNames.length,
      scale,
    },
  };
}

function generateParagraphHotspot(scale: Scale): TextWorkload {
  const prng = makePRNG(combineSeed(0x3001, scale));
  const targetOps = scale === "full" ? 10_000 : 2_800;
  const initialText = buildInitialDocument(scale === "full" ? 8 : 6);
  const operations: TextOperation[] = [];
  const document = [...initialText];
  const actors: Record<string, ActorState> = {
    alice: { cursor: Math.floor(document.length * 0.48) },
    bob: { cursor: Math.floor(document.length * 0.51) },
    carol: { cursor: Math.floor(document.length * 0.54) },
    dave: { cursor: Math.floor(document.length * 0.57) },
  };
  const actorNames = Object.keys(actors);

  while (operations.length < targetOps) {
    const actor = prng.pick(actorNames)!;
    const state = actors[actor]!;
    const center = Math.floor(document.length * 0.55);
    const hotspotStart = Math.max(0, center - 600);
    const hotspotEnd = Math.min(document.length, center + 600);

    if (prng.nextFloat() < 0.18) {
      state.cursor =
        hotspotStart + prng.nextInt(Math.max(1, hotspotEnd - hotspotStart + 1));
    }

    const choice = prng.nextFloat();

    if (document.length === 0 || choice < 0.68) {
      const index = clamp(
        state.cursor + randomSignedOffset(prng, 40),
        hotspotStart,
        hotspotEnd,
      );
      const text =
        prng.nextFloat() < 0.88 ? makeTypingChunk(prng) : makePasteChunk(prng);
      const operation: TextOperation = { kind: "insert", actor, index, text };
      operations.push(operation);
      applyTextOperation(document, operation);
      state.cursor = index + text.length;
      continue;
    }

    const deleteIndex = clamp(
      state.cursor + randomSignedOffset(prng, 24),
      hotspotStart,
      Math.max(hotspotStart, Math.min(document.length - 1, hotspotEnd - 1)),
    );
    const length = 1 + prng.nextInt(Math.min(8, document.length - deleteIndex));
    const operation: TextOperation = {
      kind: "delete",
      actor,
      index: deleteIndex,
      length,
    };
    operations.push(operation);
    applyTextOperation(document, operation);
    state.cursor = deleteIndex;
  }

  return {
    name: "paragraph_hotspot",
    kind: "text",
    description:
      "Four collaborators repeatedly edit the same paragraph-sized hotspot with short typing bursts, deletes, and occasional paste operations.",
    initialText,
    operations,
    expectedText: document.join(""),
    meta: {
      actors: actorNames.length,
      scale,
    },
  };
}

function buildInitialBoard(scale: Scale) {
  const columnNames = ["backlog", "todo", "doing", "review", "blocked", "done"];
  const board: BoardState = {};
  const cardsPerColumn = scale === "full" ? 140 : 70;
  let cardId = 1;

  for (const columnName of columnNames) {
    board[columnName] = [];
    for (let index = 0; index < cardsPerColumn; index++) {
      board[columnName]!.push(
        `${columnName}-card-${String(cardId).padStart(4, "0")}`,
      );
      cardId++;
    }
  }

  return board;
}

function nextCardIds(
  count: number,
  counter: { value: number },
  prefix: string,
) {
  const ids: string[] = [];

  for (let index = 0; index < count; index++) {
    ids.push(`${prefix}-${String(counter.value).padStart(5, "0")}`);
    counter.value++;
  }

  return ids;
}

function nonEmptyColumns(board: BoardState) {
  return Object.entries(board)
    .filter(([, items]) => items.length > 0)
    .map(([columnId]) => columnId);
}

function generateKanbanSession(scale: Scale): BoardWorkload {
  const prng = makePRNG(combineSeed(0x4001, scale));
  const targetOps = scale === "full" ? 15_000 : 5_000;
  const initialBoard = buildInitialBoard(scale);
  const operations: BoardOperation[] = [];
  const board = cloneBoardState(initialBoard);
  const actorNames = ["alice", "bob", "carol", "dave"];
  const cardCounter = { value: 10_000 };
  const columnIds = Object.keys(board);

  while (operations.length < targetOps) {
    const actor = prng.pick(actorNames)!;
    const choice = prng.nextFloat();

    if (choice < 0.34) {
      const columnId = prng.pick(columnIds)!;
      const items = nextCardIds(1, cardCounter, `${columnId}-new`);
      const operation: BoardOperation = {
        kind: "insert",
        actor,
        columnId,
        index: board[columnId]!.length,
        items,
      };
      operations.push(operation);
      applyBoardOperation(board, operation);
      continue;
    }

    if (choice < 0.46) {
      const columnId = prng.pick(columnIds)!;
      const items = nextCardIds(1, cardCounter, `${columnId}-top`);
      const operation: BoardOperation = {
        kind: "insert",
        actor,
        columnId,
        index: 0,
        items,
      };
      operations.push(operation);
      applyBoardOperation(board, operation);
      continue;
    }

    if (choice < 0.62) {
      const columnId = prng.pick(columnIds)!;
      const index =
        prng.nextFloat() < 0.45
          ? prng.nextInt(board[columnId]!.length + 1)
          : board[columnId]!.length;
      const items = nextCardIds(1, cardCounter, `${columnId}-mid`);
      const operation: BoardOperation = {
        kind: "insert",
        actor,
        columnId,
        index,
        items,
      };
      operations.push(operation);
      applyBoardOperation(board, operation);
      continue;
    }

    if (choice < 0.8) {
      const sourceColumns = nonEmptyColumns(board);
      if (sourceColumns.length === 0) {
        continue;
      }

      const fromColumnId = prng.pick(sourceColumns)!;
      const toColumnId = prng.pick(columnIds)!;
      const fromIndex = prng.nextInt(board[fromColumnId]!.length);
      const targetLength = board[toColumnId]!.length;
      const toIndex =
        prng.nextFloat() < 0.4
          ? 0
          : prng.nextFloat() < 0.8
            ? targetLength
            : prng.nextInt(targetLength + 1);
      const operation: BoardOperation = {
        kind: "move",
        actor,
        fromColumnId,
        fromIndex,
        toColumnId,
        toIndex,
        count: 1,
      };
      operations.push(operation);
      applyBoardOperation(board, operation);
      continue;
    }

    if (choice < 0.9) {
      const columnId = prng.pick(columnIds)!;
      const count = 2 + prng.nextInt(5);
      const index =
        prng.nextFloat() < 0.5
          ? board[columnId]!.length
          : prng.nextInt(board[columnId]!.length + 1);
      const items = nextCardIds(count, cardCounter, `${columnId}-dup`);
      const operation: BoardOperation = {
        kind: "insert",
        actor,
        columnId,
        index,
        items,
      };
      operations.push(operation);
      applyBoardOperation(board, operation);
      continue;
    }

    const sourceColumns = nonEmptyColumns(board);
    if (sourceColumns.length === 0) {
      continue;
    }

    const columnId = prng.pick(sourceColumns)!;
    const index = prng.nextInt(board[columnId]!.length);
    const count =
      1 + prng.nextInt(Math.min(2, board[columnId]!.length - index));
    const operation: BoardOperation = {
      kind: "delete",
      actor,
      columnId,
      index,
      count,
    };
    operations.push(operation);
    applyBoardOperation(board, operation);
  }

  return {
    name: "kanban_session",
    kind: "board",
    description:
      "A multi-column board with appends, prepends, middle inserts, moves, duplicates, and deletes across realistic card lists.",
    initialBoard,
    operations,
    expectedBoard: board,
    meta: {
      actors: actorNames.length,
      columns: columnIds.length,
      scale,
    },
  };
}

export function createSyntheticTextWorkloads(scale: Scale) {
  return [generateParagraphHotspot(scale), generateDocumentSession(scale)];
}

export function createBoardWorkload(scale: Scale) {
  return generateKanbanSession(scale);
}
