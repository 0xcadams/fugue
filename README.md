# fugue

[Fractional indexing](https://www.figma.com/blog/realtime-editing-of-ordered-sequences/) without conflicts - based on [Fugue](https://arxiv.org/abs/2305.00583). 998 bytes (minified and brotlied) and no dependencies.

Heavily based on [position-strings](https://github.com/mweidner037/position-strings), with added support for keys that were previously created by other libraries (e.g. [`fractional-indexing`](https://github.com/rocicorp/fractional-indexing)).

## Motivation

Traditional fractional indexing libraries typically use **deterministic algorithms**. This works well in single-user scenarios, but it causes conflicts in distributed systems when multiple users insert items at the same position simultaneously.

> For example, if two users try to insert between keys `a0` and `a2`, a deterministic algorithm would generate the same new position (e.g., `a1`) for both users, causing a conflict.

Fugue uses unique client IDs under the hood, ensuring that simultaneous insertions from different clients create distinct, non-interleaving keys. This enables truly conflict-free collaborative editing without requiring any coordination between clients.

## Installation

```bash
npm install fugue
# or
yarn add fugue
# or
pnpm add fugue
```

## Usage

First, create an instance of `Fugue`. You need to pass in a `clientID`, which is a unique identifier for the client.

The `clientID` should be a string that is "unique enough for the application". This means that it should be unique _given how many users will be simultaneously creating positions._ In practice, this can be quite small (e.g. `nanoid(6)`).

### Client

On the client size, create a Fugue instance with a unique client ID:

```ts
import { Fugue } from 'fugue';

// created once in the runtime (this would be a short, unique ID for the client)
// this should be chosen as having enough entropy to be unique across all clients
// it is a good idea to reuse client IDs when possible
export const fugue = new Fugue('client1');
```

Generate positions between two points using `between`. Pass `null` for start/end to generate positions at the beginning/end:

```ts
import { fugue } from "./fugue";

const first = fugue.first(); // "client1.B" - equivalent to `between(null, null)`

// Insert after first
const second = fugue.after(first); // "client1.D" - equivalent to `between(first, null)`

// Insert after second
const third = fugue.after(second); // "client1.F" - equivalent to `between(second, null)`

// Insert before first
const zeroth = fugue.before(first); // "client1.A0B" - equivalent to `between(null, first)`

// Insert between second and third (midpoint)
const secondAndHalf = fugue.between(second, third); // "client1.D0B"
```

The biggest benefit of using `fugue` over other fractional indexing libraries is that multiple independent clients
can create keys simultaneously and they will not overlap:

```ts
import { Fugue } from 'fugue'

// first client
const fugue1 = new Fugue('client1');
// second client
const fugue2 = new Fugue('client2');

// create some initial starting first and last 
const first = fugue1.first(); // "client1.B"
const last = fugue1.after(initialFirst); // "client1.D"

// simulating these happening in parallel (e.g. across multiple independent clients)
const middle1 = fugue1.between(first, last); // "client1.B0B"
const middle2 = fugue2.between(first, last); // "client1.B,client2.B"

// these eventually grow to e.g.: client0.B0A0B0aH0B,client1.D,client2.B,client3.L,client4.B,client5.D,client6.B,client7.B,client10.B,client23.B,client35.B,client36.B
```

### Server

When implementing Fugue on a server, you can create a single Fugue instance with a static client ID (e.g. `"server"`) and share it across your server runtime. This approach works well when:

1. You need to generate position keys from server-side logic.
2. Your server operations are coordinated (e.g. through database transactions).

> Note: if you are using a sync engine with "server authority" like Zero, you can instead lean on the property that **Fugue is deterministic for a given client ID**.
> This means that in your client-side code, you can optimistically generate a position with the given client ID.
> Then, on the server, you create a Fugue instance with the same client ID, and generate a position again.
> If your client is up-to-date, this will be the same position. If it's not, the server will overwrite the position with the correct value for the client ID.

```ts
import { Fugue } from 'fugue';

// Create once and export for use throughout the server
export const fugue = new Fugue('server');

async function insertItemBetween(listId, beforeItemId, afterItemId, itemData) {
  // Always use transactions to coordinate between servers
  return await db.transaction(async (tx) => {
    // If beforeItemId and afterItemId are provided, get their positions
    let beforePosition = null;
    let afterPosition = null;
    
    // get the position for the before item
    const beforeItem = beforeItemId
      ? await tx
          .select({ position: items.position })
          .from(items)
          .where(and(eq(items.id, beforeItemId), eq(items.listId, listId)))
          .get()
      : null;
    
    if (beforeItem) beforePosition = beforeItem.position;
    
    // get the position for the after item
    const afterItem = afterItemId
      ? await tx
          .select({ position: items.position })
          .from(items)
          .where(and(eq(items.id, afterItemId), eq(items.listId, listId)))
          .get()
      : null;
    
    if (afterItem) afterPosition = afterItem.position;
    
    // Generate a position between the two
    const position = fugue.between(beforePosition, afterPosition);
    
    // Insert the new item with the generated position
    await tx.insert(items).values({
      listId,
      position,
      ...itemData,
    });
  });
}
```

## Features

- Generates unique, ordered keys for inserting items between other items.
  - Keys are [global, immutable, grow logarithmically, and non-interleaving](algorithm.md).
- Compatible with positions from other fractional indexing libraries.
- Written in TypeScript with zero dependencies.

## License

[Unlicense](LICENSE)

## Attributions

Thanks to [pgte](https://github.com/pgte) for the NPM package name and [Matthew Weidner](https://github.com/mweidner037) for Fugue and `position-strings`.
