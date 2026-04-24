"use client";

import { type DragEvent, useMemo, useState } from "react";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Fugue, type FuguePosition } from "fugue";

import { demoBoardID, laneOrder, laneTitles, type Lane } from "../lib/kanban";
import { mutators, queries } from "../lib/zero";
import type { Card } from "../lib/zero-schema.gen";

const fugue = new Fugue();

type Drafts = { [Key in Lane]: string };
type CardsByLane = { [Key in Lane]: Card[] };
type DropTarget = {
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

function CardTile({
  card,
  isDragging,
  onDelete,
  onDragEnd,
  onDragStart,
}: {
  card: Card;
  isDragging: boolean;
  onDelete: (card: Card) => void;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLElement>, card: Card) => void;
}) {
  return (
    <article
      className={`cursor-grab rounded border bg-white p-3 active:cursor-grabbing ${
        isDragging ? "opacity-50" : ""
      }`}
      draggable
      onDragEnd={onDragEnd}
      onDragStart={(event) => {
        onDragStart(event, card);
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 break-words text-sm text-slate-900">
          {card.title}
        </p>
        <button
          className="shrink-0 text-sm text-rose-600 hover:text-rose-700"
          onClick={() => {
            onDelete(card);
          }}
          type="button"
        >
          Delete
        </button>
      </div>
    </article>
  );
}

function DropZone({
  active,
  dragging,
  onDragOver,
  onDrop,
}: {
  active: boolean;
  dragging: boolean;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={`h-3 rounded ${
        active ? "bg-slate-300" : dragging ? "bg-slate-100" : "bg-transparent"
      }`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    />
  );
}

export function KanbanBoard() {
  const zero = useZero();
  const [board] = useQuery(queries.boards.byId({ boardId: demoBoardID }));
  const [cards] = useQuery(queries.cards.byBoard({ boardId: demoBoardID }));
  const [drafts, setDrafts] = useState<Drafts>(createDrafts);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const cardsByLane = useMemo(() => groupCardsByLane(cards ?? []), [cards]);

  function updateDraft(lane: Lane, title: string) {
    setDrafts((current) => ({
      ...current,
      [lane]: title,
    }));
  }

  function createCard(lane: Lane) {
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
    const laneCards = cardsByLane[lane];
    const boundedIndex = Math.max(0, Math.min(index, laneCards.length));
    let targetIndex = boundedIndex;

    if (lane === card.lane) {
      const currentIndex = laneCards.findIndex(
        (candidate) => candidate.id === card.id,
      );

      if (currentIndex === -1) {
        return;
      }

      if (currentIndex < targetIndex) {
        targetIndex -= 1;
      }

      if (currentIndex === targetIndex) {
        return;
      }
    }

    zero.mutate(
      mutators.cards.move({
        id: card.id,
        lane,
        position: insertAt(laneCards, targetIndex, card.id),
      }),
    );
  }

  function removeCard(card: Card) {
    zero.mutate(
      mutators.cards.remove({
        id: card.id,
      }),
    );
  }

  function handleCardDragStart(event: DragEvent<HTMLElement>, card: Card) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.id);
    setDraggedCardId(card.id);
  }

  function handleCardDragEnd() {
    setDraggedCardId(null);
    setDropTarget(null);
  }

  function handleDropZoneDragOver(
    event: DragEvent<HTMLDivElement>,
    lane: Lane,
    index: number,
  ) {
    if (!draggedCardId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (dropTarget?.lane !== lane || dropTarget.index !== index) {
      setDropTarget({ lane, index });
    }
  }

  function handleDropZoneDrop(
    event: DragEvent<HTMLDivElement>,
    lane: Lane,
    index: number,
  ) {
    event.preventDefault();

    const cardId = draggedCardId ?? event.dataTransfer.getData("text/plain");
    const draggedCard = cards?.find((candidate) => candidate.id === cardId);

    setDraggedCardId(null);
    setDropTarget(null);

    if (!draggedCard) {
      return;
    }

    moveCard(draggedCard, lane, index);
  }

  function isDropTarget(lane: Lane, index: number) {
    return dropTarget?.lane === lane && dropTarget.index === index;
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">
          {board?.title ?? "Demo board"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Drag cards to reorder them or move them between columns.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {laneOrder.map((lane) => {
          const laneCards = cardsByLane[lane];
          const laneHasDropTarget = dropTarget?.lane === lane;

          return (
            <section
              className={`rounded border bg-slate-50 p-4 ${
                laneHasDropTarget ? "border-slate-400" : "border-slate-300"
              }`}
              key={lane}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium text-slate-900">
                  {laneTitles[lane]}
                </h2>
                <span className="text-sm text-slate-500">
                  {laneCards.length}
                </span>
              </div>

              <form
                className="mb-3 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  createCard(lane);
                }}
              >
                <input
                  className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
                  onChange={(event) => {
                    updateDraft(lane, event.target.value);
                  }}
                  placeholder="Add a card"
                  value={drafts[lane]}
                />
                <button
                  className="rounded bg-slate-900 px-3 py-2 text-sm text-white"
                  type="submit"
                >
                  Add
                </button>
              </form>

              {laneCards.length === 0 ? (
                <div
                  className={`rounded border border-dashed p-6 text-center text-sm ${
                    isDropTarget(lane, 0)
                      ? "border-slate-400 bg-slate-100 text-slate-700"
                      : "border-slate-300 text-slate-500"
                  }`}
                  onDragOver={(event) => {
                    handleDropZoneDragOver(event, lane, 0);
                  }}
                  onDrop={(event) => {
                    handleDropZoneDrop(event, lane, 0);
                  }}
                >
                  Empty
                </div>
              ) : (
                <div>
                  {laneCards.map((card, index) => (
                    <div key={card.id}>
                      <DropZone
                        active={isDropTarget(lane, index)}
                        dragging={draggedCardId !== null}
                        onDragOver={(event) => {
                          handleDropZoneDragOver(event, lane, index);
                        }}
                        onDrop={(event) => {
                          handleDropZoneDrop(event, lane, index);
                        }}
                      />

                      <CardTile
                        card={card}
                        isDragging={draggedCardId === card.id}
                        onDelete={removeCard}
                        onDragEnd={handleCardDragEnd}
                        onDragStart={handleCardDragStart}
                      />
                    </div>
                  ))}

                  <DropZone
                    active={isDropTarget(lane, laneCards.length)}
                    dragging={draggedCardId !== null}
                    onDragOver={(event) => {
                      handleDropZoneDragOver(event, lane, laneCards.length);
                    }}
                    onDrop={(event) => {
                      handleDropZoneDrop(event, lane, laneCards.length);
                    }}
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
