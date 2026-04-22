export type Scale = "smoke" | "full";

export type TextOperation =
  | {
      kind: "insert";
      actor: string;
      index: number;
      text: string;
    }
  | {
      kind: "delete";
      actor: string;
      index: number;
      length: number;
    };

export type BoardState = Record<string, string[]>;

export type BoardOperation =
  | {
      kind: "insert";
      actor: string;
      columnId: string;
      index: number;
      items: string[];
    }
  | {
      kind: "delete";
      actor: string;
      columnId: string;
      index: number;
      count: number;
    }
  | {
      kind: "move";
      actor: string;
      fromColumnId: string;
      fromIndex: number;
      toColumnId: string;
      toIndex: number;
      count: number;
    };

export type PositionStats = {
  count: number;
  totalBytes: number;
  avgBytes: number;
  p95Bytes: number;
  maxBytes: number;
};

export type SessionMetrics = {
  positionStats?: PositionStats;
  snapshotBytes?: number;
  notes?: string[];
};

export interface TextSession {
  insert(index: number, text: string, actor: string): void;
  delete(index: number, length: number, actor: string): void;
  materialize(): string;
  metrics(): SessionMetrics;
}

export interface BoardSession {
  insert(columnId: string, index: number, items: string[], actor: string): void;
  delete(columnId: string, index: number, count: number, actor: string): void;
  move(
    fromColumnId: string,
    fromIndex: number,
    toColumnId: string,
    toIndex: number,
    count: number,
    actor: string,
  ): void;
  materialize(): BoardState;
  metrics(): SessionMetrics;
}

export type AdapterFamily = "position" | "crdt";

export type AdapterSupport = {
  text: boolean;
  board: boolean;
};

export interface BenchmarkAdapter {
  name: string;
  family: AdapterFamily;
  support: AdapterSupport;
  createTextSession?(initialText: string): TextSession;
  createBoardSession?(initialBoard: BoardState): BoardSession;
}

export type TextWorkload = {
  name: string;
  kind: "text";
  description: string;
  initialText: string;
  operations: TextOperation[];
  expectedText: string;
  meta?: Record<string, unknown>;
};

export type BoardWorkload = {
  name: string;
  kind: "board";
  description: string;
  initialBoard: BoardState;
  operations: BoardOperation[];
  expectedBoard: BoardState;
  meta?: Record<string, unknown>;
};

export type Workload = TextWorkload | BoardWorkload;

export type BenchmarkResult = {
  adapter: string;
  family: AdapterFamily;
  workload: string;
  kind: Workload["kind"];
  operationCount: number;
  applyMs: number;
  materializeMs: number;
  opsPerSec: number;
  finalHash: string;
  success: boolean;
  finalSize: number;
  metrics: SessionMetrics;
  error?: string;
};
