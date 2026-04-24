import type { BoardOperation, BoardState, TextOperation } from "./types.js";

export function cloneBoardState(board: BoardState): BoardState {
  const cloned: BoardState = {};

  for (const [columnId, items] of Object.entries(board) as Array<
    [string, string[]]
  >) {
    cloned[columnId] = [...items];
  }

  return cloned;
}

export function applyTextOperation(text: string[], operation: TextOperation) {
  if (operation.kind === "insert") {
    text.splice(operation.index, 0, ...operation.text);
    return;
  }

  text.splice(operation.index, operation.length);
}

export function applyTextOperations(
  initialText: string,
  operations: readonly TextOperation[],
) {
  const text = [...initialText];

  for (const operation of operations) {
    applyTextOperation(text, operation);
  }

  return text.join("");
}

export function applyBoardOperation(
  board: BoardState,
  operation: BoardOperation,
) {
  switch (operation.kind) {
    case "insert": {
      board[operation.columnId]!.splice(operation.index, 0, ...operation.items);
      return;
    }
    case "delete": {
      board[operation.columnId]!.splice(operation.index, operation.count);
      return;
    }
    case "move": {
      const source = board[operation.fromColumnId]!;
      const moved = source.splice(operation.fromIndex, operation.count);
      const target = board[operation.toColumnId]!;
      let targetIndex = operation.toIndex;

      if (
        operation.fromColumnId === operation.toColumnId &&
        operation.toIndex > operation.fromIndex
      ) {
        targetIndex = Math.max(
          operation.fromIndex,
          operation.toIndex - operation.count,
        );
      }

      target.splice(targetIndex, 0, ...moved);
      return;
    }
  }
}

export function applyBoardOperations(
  initialBoard: BoardState,
  operations: readonly BoardOperation[],
) {
  const board = cloneBoardState(initialBoard);

  for (const operation of operations) {
    applyBoardOperation(board, operation);
  }

  return board;
}
