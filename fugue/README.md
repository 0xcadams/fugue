# fugue

Client-generated position keys for local-first lists and collaborative text.

`fugue` creates opaque string positions that you can store anywhere and sort with ordinary string comparison. It is built for sync systems where clients need to create positions locally, insert into the same gaps concurrently, and never rewrite older keys.

- generate positions on the client
- store them as plain strings
- sort them with normal binary/code-point string comparison
- insert anywhere without reindexing existing items
- keep typing, paste, and duplicate bursts contiguous under concurrent edits

## Installation

```bash
npm install fugue
# or
pnpm add fugue
# or
yarn add fugue
# or
bun add fugue
```

## Quick start

```ts
import { Fugue, type FuguePosition } from "fugue";

type Card = {
  id: string;
  title: string;
  position: FuguePosition;
};

const fugue = new Fugue();
let nextId = 1;

const compareByPosition = (a: Card, b: Card) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

function insertCard(cards: Card[], index: number, title: string): Card {
  const left = index === 0 ? null : cards[index - 1]!.position;
  const right = index === cards.length ? null : cards[index]!.position;

  const card: Card = {
    id: String(nextId++),
    title,
    position: fugue.between(left, right),
  };

  cards.splice(index, 0, card);
  return card;
}

const todo: Card[] = [];

insertCard(todo, 0, "Ship multiplayer");
insertCard(todo, 1, "Write docs");
insertCard(todo, 1, "Record demo");

todo.sort(compareByPosition);
```

## Validation

```ts
import { Fugue, isFuguePosition } from "fugue";

const fugue = new Fugue();

if (isFuguePosition(maybePosition)) {
  fugue.after(maybePosition);
}
```

## Learn more

- Full repo README: https://github.com/0xcadams/fugue#readme
- Algorithm notes: https://github.com/0xcadams/fugue/blob/main/algorithm.md
- Benchmarks: https://github.com/0xcadams/fugue/blob/main/benchmarks/README.md
- Benchmark comparisons: https://github.com/0xcadams/fugue/blob/main/comparisons.md

## License

[Unlicense](https://github.com/0xcadams/fugue/blob/main/LICENSE)
