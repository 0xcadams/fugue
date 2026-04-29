"use client";

import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import {
  DragDropProvider,
  DragOverlay,
  KeyboardSensor,
  useDragOperation,
  useDroppable,
} from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { useConnectionState, useQuery, useZero } from "@rocicorp/zero/react";
import { Fugue, type FuguePosition } from "fugue";
import { useMemo, useState, type ReactNode } from "react";

import { useOfflineMode } from "../../app/providers";
import { demoBoardID, laneOrder, laneTitles, type Lane } from "../lib/kanban";
import { mutators, queries } from "../lib/zero";
import type { Card } from "../lib/zero-schema.gen";

const fugue = new Fugue();

const dragSensors = [
  PointerSensor.configure({
    activationConstraints(event) {
      switch (event.pointerType) {
        case "mouse":
          return [new PointerActivationConstraints.Distance({ value: 4 })];
        case "touch":
          return [
            new PointerActivationConstraints.Delay({
              value: 180,
              tolerance: 10,
            }),
          ];
        default:
          return [
            new PointerActivationConstraints.Delay({
              value: 140,
              tolerance: 8,
            }),
            new PointerActivationConstraints.Distance({ value: 4 }),
          ];
      }
    },
  }),
  KeyboardSensor,
];

type Drafts = { [Key in Lane]: string };
type CardsByLane = { [Key in Lane]: Card[] };
type DropDestination = {
  lane: Lane;
  index: number;
};
type CardDragData = {
  kind: "card";
  cardId: string;
  lane: Lane;
  title: string;
};
type PositionDropData = {
  kind: "position";
  lane: Lane;
  index: number;
};

function createDrafts(): Drafts {
  return {
    todo: "",
    doing: "",
    done: "",
  };
}

function compareCards(left: Card, right: Card) {
  if (left.position < right.position) {
    return -1;
  }

  if (left.position > right.position) {
    return 1;
  }

  return left.id.localeCompare(right.id);
}

function groupCardsByLane(cards: readonly Card[]): CardsByLane {
  const grouped: CardsByLane = {
    todo: [],
    doing: [],
    done: [],
  };

  for (const card of cards) {
    grouped[card.lane].push(card);
  }

  for (const lane of laneOrder) {
    grouped[lane].sort(compareCards);
  }

  return grouped;
}

function insertAt(
  cards: readonly Card[],
  index: number,
  movingCardId?: string,
) {
  const siblings = movingCardId
    ? cards.filter((card) => card.id !== movingCardId)
    : [...cards];
  const left =
    index === 0
      ? null
      : ((siblings[index - 1]?.position ?? null) as FuguePosition | null);
  const right =
    index >= siblings.length
      ? null
      : ((siblings[index]?.position ?? null) as FuguePosition | null);

  return fugue.between(left, right);
}

function getConnectionBadge(
  state: ReturnType<typeof useConnectionState>,
  isOffline: boolean,
) {
  if (isOffline) {
    return {
      label: "Offline mode",
      className: "border-rose-200 bg-rose-50 text-rose-700",
    };
  }

  if (state.name === "connected") {
    return {
      label: "Connected",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  if (state.name === "connecting") {
    return {
      label: "Connecting...",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  if (state.name === "needs-auth") {
    return {
      label: "Session expired",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  if (state.name === "error") {
    return {
      label: "Error",
      className: "border-rose-200 bg-rose-50 text-rose-700",
    };
  }

  return {
    label: "Offline",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  };
}

function isReadOnlyConnectionState(
  state: ReturnType<typeof useConnectionState>,
) {
  return (
    state.name === "closed" ||
    state.name === "disconnected" ||
    state.name === "error" ||
    state.name === "needs-auth"
  );
}

function isLane(value: unknown): value is Lane {
  return typeof value === "string" && laneOrder.includes(value as Lane);
}

function isCardDragData(value: unknown): value is CardDragData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CardDragData>;
  return (
    candidate.kind === "card" &&
    typeof candidate.cardId === "string" &&
    typeof candidate.title === "string" &&
    isLane(candidate.lane)
  );
}

function isPositionDropData(value: unknown): value is PositionDropData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PositionDropData>;
  return (
    candidate.kind === "position" &&
    isLane(candidate.lane) &&
    typeof candidate.index === "number"
  );
}

function getLaneFromDropData(value: unknown): Lane | null {
  if (isCardDragData(value) || isPositionDropData(value)) {
    return value.lane;
  }

  return null;
}

function resolveDropZoneIndex(
  card: Card,
  cardsByLane: CardsByLane,
  target: PositionDropData,
) {
  if (card.lane !== target.lane) {
    return target.index;
  }

  const currentIndex = cardsByLane[target.lane].findIndex(
    (candidate) => candidate.id === card.id,
  );

  if (currentIndex === -1) {
    return target.index;
  }

  return target.index > currentIndex ? target.index - 1 : target.index;
}

function resolveDestination(
  card: Card,
  cardsByLane: CardsByLane,
  source: { group?: unknown; index?: number },
  targetData: unknown,
): DropDestination | null {
  if (isPositionDropData(targetData)) {
    return {
      lane: targetData.lane,
      index: resolveDropZoneIndex(card, cardsByLane, targetData),
    };
  }

  if (isLane(source.group) && typeof source.index === "number") {
    return {
      lane: source.group,
      index: source.index,
    };
  }

  return null;
}

function DragHandle({
  disabled = false,
  handleRef,
  title,
}: {
  disabled?: boolean;
  handleRef: (element: Element | null) => void;
  title: string;
}) {
  return (
    <button
      aria-label={
        disabled ? `${title} cannot be moved right now` : `Drag ${title}`
      }
      className={`shrink-0 rounded border px-2 py-1 font-mono text-xs tracking-[-0.2em] touch-none transition ${
        disabled
          ? "cursor-not-allowed border-gray-200 text-gray-300"
          : "cursor-grab border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 active:cursor-grabbing"
      }`}
      disabled={disabled}
      ref={handleRef}
      type="button"
    >
      <span aria-hidden="true">:::</span>
    </button>
  );
}

function CardSurface({
  dragHandle,
  isDropTarget,
  onDelete,
  overlay = false,
  sourceHidden = false,
  sourceRef,
  title,
}: {
  dragHandle: ReactNode;
  isDropTarget: boolean;
  onDelete?: () => void;
  overlay?: boolean;
  sourceHidden?: boolean;
  sourceRef?: (element: Element | null) => void;
  title: string;
}) {
  return (
    <article
      className={`rounded border bg-white p-3 shadow-sm transition ${
        sourceHidden
          ? "pointer-events-none border-transparent opacity-0 shadow-none"
          : isDropTarget
            ? "border-gray-500 shadow-md"
            : "border-gray-200"
      }`}
      ref={sourceRef}
    >
      <div className="flex items-start gap-3">
        {dragHandle}
        <p className="min-w-0 flex-1 break-words pt-1 text-sm text-black">
          {title}
        </p>
        {overlay || !onDelete ? null : (
          <button
            className="shrink-0 cursor-pointer text-sm text-rose-600 hover:text-rose-700"
            onClick={() => {
              onDelete();
            }}
            type="button"
          >
            Delete
          </button>
        )}
      </div>
    </article>
  );
}

function SortableCard({
  card,
  index,
  onDelete,
}: {
  card: Card;
  index: number;
  onDelete: (card: Card) => void;
}) {
  const { handleRef, isDragSource, isDropTarget, sourceRef, targetRef } =
    useSortable<CardDragData>({
      id: card.id,
      index,
      group: card.lane,
      type: "card",
      accept: "card",
      transition: {
        duration: 180,
        easing: "ease-out",
        idle: true,
      },
      data: {
        kind: "card",
        cardId: card.id,
        lane: card.lane,
        title: card.title,
      },
    });

  return (
    <div ref={targetRef}>
      <CardSurface
        dragHandle={<DragHandle handleRef={handleRef} title={card.title} />}
        isDropTarget={isDropTarget}
        onDelete={() => {
          onDelete(card);
        }}
        sourceHidden={isDragSource}
        sourceRef={sourceRef}
        title={card.title}
      />
    </div>
  );
}

function StaticCard({ card }: { card: Card }) {
  return (
    <CardSurface
      dragHandle={
        <DragHandle disabled handleRef={() => {}} title={card.title} />
      }
      isDropTarget={false}
      title={card.title}
    />
  );
}

function PositionDropZone({
  lane,
  index,
  dragging,
  empty,
  terminal,
}: {
  lane: Lane;
  index: number;
  dragging: boolean;
  empty?: boolean;
  terminal?: boolean;
}) {
  const { ref, isDropTarget } = useDroppable<PositionDropData>({
    id: `${lane}:${index}`,
    data: {
      kind: "position",
      lane,
      index,
    },
  });

  if (empty) {
    return (
      <div
        className={`rounded border border-dashed p-6 text-center text-sm transition ${
          isDropTarget
            ? "border-gray-500 bg-gray-100 text-gray-700"
            : dragging
              ? "border-gray-300 text-gray-500"
              : "border-gray-300 text-gray-500"
        }`}
        ref={ref}
      >
        {dragging ? "Drop a card here" : "Empty"}
      </div>
    );
  }

  return (
    <div
      className={`rounded transition ${
        isDropTarget
          ? "h-4 bg-gray-400"
          : terminal
            ? dragging
              ? "h-5 bg-gray-100"
              : "h-5 bg-transparent"
            : dragging
              ? "h-3 bg-gray-100"
              : "h-3 bg-transparent"
      }`}
      ref={ref}
    />
  );
}

function LaneColumn({
  draft,
  lane,
  laneCards,
  onCreateCard,
  onDeleteCard,
  onDraftChange,
  readOnly,
}: {
  draft: string;
  lane: Lane;
  laneCards: readonly Card[];
  onCreateCard: (lane: Lane) => void;
  onDeleteCard: (card: Card) => void;
  onDraftChange: (lane: Lane, title: string) => void;
  readOnly: boolean;
}) {
  const { source, target } = useDragOperation();
  const dragging = !readOnly && source !== null;
  const targetLane = getLaneFromDropData(target?.data);
  const active =
    !readOnly &&
    (targetLane === lane ||
      (targetLane === null &&
        source !== null &&
        source !== undefined &&
        isSortable(source) &&
        isLane(source.group) &&
        source.group === lane));

  return (
    <section
      className={`rounded border bg-gray-50 p-4 transition ${
        active ? "border-gray-500 shadow-sm" : "border-gray-300"
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-black">{laneTitles[lane]}</h2>
        <span className="text-sm text-gray-500">{laneCards.length}</span>
      </div>

      <form
        className="mb-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();

          if (readOnly) {
            return;
          }

          onCreateCard(lane);
        }}
      >
        <input
          className={`min-w-0 flex-1 rounded border px-3 py-2 text-sm ${
            readOnly
              ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-500"
              : "border-gray-300 bg-white text-black"
          }`}
          disabled={readOnly}
          onChange={(event) => {
            onDraftChange(lane, event.target.value);
          }}
          placeholder={
            readOnly ? "Changes are disabled" : `Task in ${laneTitles[lane]}`
          }
          value={draft}
        />
        <button
          className={`rounded px-3 py-2 text-sm text-white transition ${
            readOnly
              ? "cursor-not-allowed bg-gray-300"
              : "cursor-pointer bg-gray-900 hover:bg-black"
          }`}
          disabled={readOnly}
          type="submit"
        >
          Add
        </button>
      </form>

      {laneCards.length === 0 ? (
        <PositionDropZone dragging={dragging} empty index={0} lane={lane} />
      ) : readOnly ? (
        <div className="min-h-28 space-y-3">
          {laneCards.map((card) => (
            <StaticCard card={card} key={card.id} />
          ))}
        </div>
      ) : (
        <div className="min-h-28">
          <PositionDropZone dragging={dragging} index={0} lane={lane} />
          {laneCards.map((card, index) => (
            <div key={card.id}>
              <SortableCard card={card} index={index} onDelete={onDeleteCard} />
              <PositionDropZone
                dragging={dragging}
                index={index + 1}
                lane={lane}
                terminal={index === laneCards.length - 1}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function KanbanBoard() {
  const zero = useZero();
  const connectionState = useConnectionState();
  const { isOffline, toggleOffline } = useOfflineMode();
  const [cards] = useQuery(queries.cards.byBoard({ boardId: demoBoardID }));
  const [drafts, setDrafts] = useState<Drafts>(createDrafts);

  const allCards = cards ?? [];
  const cardsByLane = useMemo(() => groupCardsByLane(allCards), [allCards]);
  const cardsById = useMemo(
    () => new Map(allCards.map((card) => [card.id, card])),
    [allCards],
  );
  const isReadOnly = !isOffline && isReadOnlyConnectionState(connectionState);
  const connectionBadge = getConnectionBadge(connectionState, isOffline);
  const readOnlyMessage = isOffline
    ? "Offline mode is on. Changes stay local until you go online."
    : isReadOnly
      ? "Changes are disabled until Zero reconnects."
      : null;

  function updateDraft(lane: Lane, title: string) {
    setDrafts((current) => ({
      ...current,
      [lane]: title,
    }));
  }

  function createCard(lane: Lane) {
    if (isReadOnly) {
      return;
    }

    const title = drafts[lane].trim();

    if (!title) {
      return;
    }

    zero.mutate(
      mutators.cards.create({
        id: crypto.randomUUID(),
        boardId: demoBoardID,
        lane,
        position: insertAt(cardsByLane[lane], cardsByLane[lane].length),
        title,
      }),
    );

    updateDraft(lane, "");
  }

  function moveCard(card: Card, lane: Lane, index: number) {
    if (isReadOnly) {
      return;
    }

    const laneCards = cardsByLane[lane];
    const currentIndex = cardsByLane[card.lane].findIndex(
      (candidate) => candidate.id === card.id,
    );

    if (currentIndex === -1) {
      return;
    }

    const maxIndex =
      lane === card.lane ? Math.max(laneCards.length - 1, 0) : laneCards.length;
    const boundedIndex = Math.max(0, Math.min(index, maxIndex));

    if (lane === card.lane && currentIndex === boundedIndex) {
      return;
    }

    zero.mutate(
      mutators.cards.move({
        id: card.id,
        lane,
        position: insertAt(laneCards, boundedIndex, card.id),
      }),
    );
  }

  function removeCard(card: Card) {
    if (isReadOnly) {
      return;
    }

    zero.mutate(
      mutators.cards.remove({
        id: card.id,
      }),
    );
  }

  return (
    <DragDropProvider
      onDragEnd={(event) => {
        const { source, target } = event.operation;

        if (isReadOnly || event.canceled || !isSortable(source)) {
          return;
        }

        const card = cardsById.get(String(source.id));

        if (!card) {
          return;
        }

        const destination = resolveDestination(
          card,
          cardsByLane,
          source,
          target?.data,
        );

        if (!destination) {
          return;
        }

        requestAnimationFrame(() => {
          moveCard(card, destination.lane, destination.index);
        });
      }}
      sensors={dragSensors}
    >
      <main className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-black">
              {"Fugue Kanban Demo"}
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              Drag cards with the handle to reorder them or move them between
              columns.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 md:items-end">
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <span
                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${connectionBadge.className}`}
              >
                {connectionBadge.label}
              </span>
              <button
                aria-pressed={isOffline}
                className={`rounded border px-3 py-1.5 text-sm transition ${
                  isOffline
                    ? "cursor-pointer border-gray-900 bg-gray-900 text-white hover:bg-black"
                    : "cursor-pointer border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:text-black"
                }`}
                onClick={toggleOffline}
                type="button"
              >
                {isOffline ? "Go online" : "Go offline"}
              </button>
            </div>
            {readOnlyMessage ? (
              <p className="text-xs text-gray-500">{readOnlyMessage}</p>
            ) : null}
            <p className="mt-1 text-sm text-gray-600">
              Built with{" "}
              <a
                className="text-black underline"
                href="https://github.com/0xcadams/fugue"
              >
                Fugue
              </a>{" "}
              &{" "}
              <a
                className="text-black underline"
                href="https://zero.rocicorp.dev"
              >
                Zero
              </a>
              .
            </p>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          {laneOrder.map((lane) => (
            <LaneColumn
              draft={drafts[lane]}
              key={lane}
              lane={lane}
              laneCards={cardsByLane[lane]}
              onCreateCard={createCard}
              onDeleteCard={removeCard}
              onDraftChange={updateDraft}
              readOnly={isReadOnly}
            />
          ))}
        </div>
      </main>

      <DragOverlay dropAnimation={null}>
        {(source) => {
          if (!source || !isCardDragData(source.data)) {
            return null;
          }

          return (
            <div className="w-[min(24rem,calc(100vw-2rem))]">
              <CardSurface
                dragHandle={
                  <DragHandle
                    disabled
                    handleRef={() => {}}
                    title={source.data.title}
                  />
                }
                isDropTarget={false}
                overlay
                title={source.data.title}
              />
            </div>
          );
        }}
      </DragOverlay>
    </DragDropProvider>
  );
}
