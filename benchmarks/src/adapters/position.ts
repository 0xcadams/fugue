import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import {
  generateKeyBetween as generateJitteredKeyBetween,
  generateNKeysBetween as generateJitteredNKeysBetween,
} from "jittered-fractional-indexing";
import {
  List as ListPositionsList,
  Order,
  Text as ListPositionsText,
} from "list-positions";
import { PositionSource } from "position-strings";

import { Fugue, type FuguePosition } from "../../../fugue/src/index.ts";
import {
  combineSeed,
  hashString,
  makeDeterministicRandomBytes,
  makePRNG,
} from "../lib/prng.js";
import { jsonByteLength, summarizePositions } from "../lib/stats.js";
import type {
  BenchmarkAdapter,
  BoardSession,
  BoardState,
  SessionMetrics,
  TextSession,
} from "../lib/types.js";

type StringPositionDriver = {
  createPositions(
    left: string | null,
    right: string | null,
    count: number,
    actor: string,
  ): string[];
  createBefore?(right: string, count: number, actor: string): string[];
  createAfter?(left: string, count: number, actor: string): string[];
};

function chunkTextForSeeding(text: string) {
  if (text.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  const paragraphs = text.split("\n\n");

  for (let index = 0; index < paragraphs.length; index++) {
    const paragraph = paragraphs[index]!;
    const withGap =
      index < paragraphs.length - 1 ? `${paragraph}\n\n` : paragraph;

    for (let offset = 0; offset < withGap.length; offset += 160) {
      chunks.push(withGap.slice(offset, offset + 160));
    }
  }

  return chunks;
}

function seedTextSession(session: TextSession, initialText: string) {
  let index = 0;
  for (const chunk of chunkTextForSeeding(initialText)) {
    session.insert(index, chunk, "seed");
    index += chunk.length;
  }
}

function seedBoardSession(session: BoardSession, initialBoard: BoardState) {
  for (const [columnId, items] of Object.entries(initialBoard) as Array<
    [string, string[]]
  >) {
    for (let offset = 0; offset < items.length; offset += 24) {
      session.insert(
        columnId,
        offset,
        items.slice(offset, offset + 24),
        "seed",
      );
    }
  }
}

class OrderedStringTextSession implements TextSession {
  private readonly positions: string[] = [];
  private readonly chars: string[] = [];

  constructor(
    private readonly driver: StringPositionDriver,
    initialText: string,
  ) {
    seedTextSession(this, initialText);
  }

  insert(index: number, text: string, actor: string) {
    if (text.length === 0) {
      return;
    }

    const left = index === 0 ? null : this.positions[index - 1]!;
    const right =
      index >= this.positions.length ? null : this.positions[index]!;
    const newPositions =
      left === null && right !== null && this.driver.createBefore !== undefined
        ? this.driver.createBefore(right, text.length, actor)
        : left !== null &&
            right === null &&
            this.driver.createAfter !== undefined
          ? this.driver.createAfter(left, text.length, actor)
          : this.driver.createPositions(left, right, text.length, actor);
    this.positions.splice(index, 0, ...newPositions);
    this.chars.splice(index, 0, ...text);
  }

  delete(index: number, length: number) {
    if (length <= 0) {
      return;
    }

    this.positions.splice(index, length);
    this.chars.splice(index, length);
  }

  materialize() {
    return this.chars.join("");
  }

  metrics(): SessionMetrics {
    return {
      positionStats: summarizePositions(this.positions),
    };
  }
}

class OrderedStringBoardSession implements BoardSession {
  private readonly positionsByColumn: Record<string, string[]> = {};
  private readonly itemsByColumn: Record<string, string[]> = {};

  constructor(
    private readonly driver: StringPositionDriver,
    initialBoard: BoardState,
  ) {
    for (const columnId of Object.keys(initialBoard)) {
      this.positionsByColumn[columnId] = [];
      this.itemsByColumn[columnId] = [];
    }

    seedBoardSession(this, initialBoard);
  }

  insert(columnId: string, index: number, items: string[], actor: string) {
    if (items.length === 0) {
      return;
    }

    const columnPositions = this.positionsByColumn[columnId]!;
    const columnItems = this.itemsByColumn[columnId]!;
    const left = index === 0 ? null : columnPositions[index - 1]!;
    const right =
      index >= columnPositions.length ? null : columnPositions[index]!;
    const newPositions =
      left === null && right !== null && this.driver.createBefore !== undefined
        ? this.driver.createBefore(right, items.length, actor)
        : left !== null &&
            right === null &&
            this.driver.createAfter !== undefined
          ? this.driver.createAfter(left, items.length, actor)
          : this.driver.createPositions(left, right, items.length, actor);
    columnPositions.splice(index, 0, ...newPositions);
    columnItems.splice(index, 0, ...items);
  }

  delete(columnId: string, index: number, count: number) {
    if (count <= 0) {
      return;
    }

    this.positionsByColumn[columnId]!.splice(index, count);
    this.itemsByColumn[columnId]!.splice(index, count);
  }

  move(
    fromColumnId: string,
    fromIndex: number,
    toColumnId: string,
    toIndex: number,
    count: number,
    actor: string,
  ) {
    const moved = this.itemsByColumn[fromColumnId]!.splice(fromIndex, count);
    this.positionsByColumn[fromColumnId]!.splice(fromIndex, count);

    let adjustedTargetIndex = toIndex;
    if (fromColumnId === toColumnId && toIndex > fromIndex) {
      adjustedTargetIndex = Math.max(fromIndex, toIndex - count);
    }

    this.insert(toColumnId, adjustedTargetIndex, moved, actor);
  }

  materialize() {
    const out: BoardState = {};

    for (const [columnId, items] of Object.entries(this.itemsByColumn) as Array<
      [string, string[]]
    >) {
      out[columnId] = [...items];
    }

    return out;
  }

  metrics(): SessionMetrics {
    const allPositions = Object.values(this.positionsByColumn).flat();
    return {
      positionStats: summarizePositions(allPositions),
    };
  }
}

function makeFugueDriver(): StringPositionDriver {
  const fugues = new Map<string, Fugue>();

  const getFugue = (actor: string) => {
    let fugue = fugues.get(actor);
    if (fugue !== undefined) {
      return fugue;
    }

    fugue = new Fugue({
      randomBytes: makeDeterministicRandomBytes(combineSeed(0x5101, actor)),
    });
    fugues.set(actor, fugue);
    return fugue;
  };

  return {
    createPositions(left, right, count, actor) {
      const fugue = getFugue(actor);
      const typedLeft = left as FuguePosition | null;
      const typedRight = right as FuguePosition | null;
      if (count === 1) {
        return [fugue.between(typedLeft, typedRight)];
      }

      const burst = fugue.startBurst(typedLeft, typedRight);
      return Array.from({ length: count }, () => burst.next());
    },
    createBefore(right, count, actor) {
      const fugue = getFugue(actor);
      const typedRight = right as FuguePosition;
      if (count === 1) {
        return [fugue.before(typedRight)];
      }

      const burst = fugue.startBurstBefore(typedRight);
      return Array.from({ length: count }, () => burst.next());
    },
    createAfter(left, count, actor) {
      const fugue = getFugue(actor);
      const typedLeft = left as FuguePosition;
      if (count === 1) {
        return [fugue.after(typedLeft)];
      }

      const burst = fugue.startBurstAfter(typedLeft);
      return Array.from({ length: count }, () => burst.next());
    },
  };
}

function makeFractionalDriver(): StringPositionDriver {
  return {
    createPositions(left, right, count) {
      if (count === 1) {
        return [generateKeyBetween(left, right)];
      }

      return generateNKeysBetween(left, right, count);
    },
  };
}

function makeJitteredDriver(): StringPositionDriver {
  const actorPrngs = new Map<string, ReturnType<typeof makePRNG>>();

  const getRandomBit = (actor: string) => {
    let prng = actorPrngs.get(actor);
    if (prng === undefined) {
      prng = makePRNG(combineSeed(0x5201, actor));
      actorPrngs.set(actor, prng);
    }

    return () => prng.nextBoolean();
  };

  return {
    createPositions(left, right, count, actor) {
      const options = { getRandomBit: getRandomBit(actor), jitterBits: 30 };

      if (count === 1) {
        return [generateJitteredKeyBetween(left, right, options)];
      }

      return generateJitteredNKeysBetween(left, right, count, options);
    },
  };
}

function makePositionStringsDriver(): StringPositionDriver {
  const sources = new Map<string, PositionSource>();

  const getSource = (actor: string) => {
    let source = sources.get(actor);
    if (source !== undefined) {
      return source;
    }

    const prng = makePRNG(combineSeed(0x5301, actor));
    source = new PositionSource({
      ID: `${actor[0] ?? "a"}${hashString(actor).toString(36)}${prng.nextInt(36).toString(36)}`,
    });
    sources.set(actor, source);
    return source;
  };

  return {
    createPositions(left, right, count, actor) {
      const source = getSource(actor);
      const positions: string[] = [];
      let currentLeft = left ?? PositionSource.FIRST;
      const resolvedRight = right ?? PositionSource.LAST;

      for (let index = 0; index < count; index++) {
        const position = source.createBetween(currentLeft, resolvedRight);
        positions.push(position);
        currentLeft = position;
      }

      return positions;
    },
  };
}

class ListPositionsTextSession implements TextSession {
  private readonly text = new ListPositionsText();

  constructor(initialText: string) {
    seedTextSession(this, initialText);
  }

  insert(index: number, text: string, _actor: string) {
    if (text.length === 0) {
      return;
    }

    this.text.insertAt(index, text);
  }

  delete(index: number, length: number, _actor: string) {
    if (length <= 0) {
      return;
    }

    this.text.deleteAt(index, length);
  }

  materialize() {
    return Array.from(this.text).join("");
  }

  metrics(): SessionMetrics {
    const positions = Array.from({ length: this.text.length }, (_, index) => {
      return this.text.positionAt(index);
    });

    return {
      positionStats: summarizePositions(positions),
      snapshotBytes: jsonByteLength({
        order: this.text.order.save(),
        text: this.text.save(),
      }),
    };
  }
}

class ListPositionsBoardSession implements BoardSession {
  private readonly order = new Order();
  private readonly columns: Record<string, ListPositionsList<string>> = {};

  constructor(initialBoard: BoardState) {
    for (const columnId of Object.keys(initialBoard)) {
      this.columns[columnId] = new ListPositionsList<string>(this.order);
    }

    seedBoardSession(this, initialBoard);
  }

  insert(columnId: string, index: number, items: string[], _actor: string) {
    if (items.length === 0) {
      return;
    }

    this.columns[columnId]!.insertAt(index, ...items);
  }

  delete(columnId: string, index: number, count: number, _actor: string) {
    if (count <= 0) {
      return;
    }

    this.columns[columnId]!.deleteAt(index, count);
  }

  move(
    fromColumnId: string,
    fromIndex: number,
    toColumnId: string,
    toIndex: number,
    count: number,
    actor: string,
  ) {
    const source = this.columns[fromColumnId]!;
    const moved: string[] = [];

    for (let index = 0; index < count; index++) {
      moved.push(source.getAt(fromIndex + index));
    }

    source.deleteAt(fromIndex, count);

    let adjustedTargetIndex = toIndex;
    if (fromColumnId === toColumnId && toIndex > fromIndex) {
      adjustedTargetIndex = Math.max(fromIndex, toIndex - count);
    }

    this.insert(toColumnId, adjustedTargetIndex, moved, actor);
  }

  materialize() {
    const out: BoardState = {};

    for (const [columnId, list] of Object.entries(this.columns) as Array<
      [string, ListPositionsList<string>]
    >) {
      out[columnId] = Array.from(list);
    }

    return out;
  }

  metrics(): SessionMetrics {
    const positions = Object.values(this.columns).flatMap((list) => {
      return Array.from({ length: list.length }, (_, index) =>
        list.positionAt(index),
      );
    });
    const savedColumns = Object.fromEntries(
      Object.entries(this.columns).map(([columnId, list]) => [
        columnId,
        list.save(),
      ]),
    );

    return {
      positionStats: summarizePositions(positions),
      snapshotBytes: jsonByteLength({
        order: this.order.save(),
        columns: savedColumns,
      }),
    };
  }
}

export function createPositionAdapters(): BenchmarkAdapter[] {
  const fugueDriver = makeFugueDriver();
  const fractionalDriver = makeFractionalDriver();
  const jitteredDriver = makeJitteredDriver();
  const positionStringsDriver = makePositionStringsDriver();

  return [
    {
      name: "fugue",
      family: "position",
      support: { text: true, board: true },
      createTextSession(initialText) {
        return new OrderedStringTextSession(fugueDriver, initialText);
      },
      createBoardSession(initialBoard) {
        return new OrderedStringBoardSession(fugueDriver, initialBoard);
      },
    },
    {
      name: "list-positions",
      family: "position",
      support: { text: true, board: true },
      createTextSession(initialText) {
        return new ListPositionsTextSession(initialText);
      },
      createBoardSession(initialBoard) {
        return new ListPositionsBoardSession(initialBoard);
      },
    },
    {
      name: "position-strings",
      family: "position",
      support: { text: true, board: true },
      createTextSession(initialText) {
        return new OrderedStringTextSession(positionStringsDriver, initialText);
      },
      createBoardSession(initialBoard) {
        return new OrderedStringBoardSession(
          positionStringsDriver,
          initialBoard,
        );
      },
    },
    {
      name: "fractional-indexing",
      family: "position",
      support: { text: true, board: true },
      createTextSession(initialText) {
        return new OrderedStringTextSession(fractionalDriver, initialText);
      },
      createBoardSession(initialBoard) {
        return new OrderedStringBoardSession(fractionalDriver, initialBoard);
      },
    },
    {
      name: "jittered-fractional-indexing",
      family: "position",
      support: { text: true, board: true },
      createTextSession(initialText) {
        return new OrderedStringTextSession(jitteredDriver, initialText);
      },
      createBoardSession(initialBoard) {
        return new OrderedStringBoardSession(jitteredDriver, initialBoard);
      },
    },
  ];
}
