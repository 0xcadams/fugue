# Why fugue exists

Collaborative software keeps running into the same awkward problem: ordered things are much harder than they look.

The issue is not just "realtime editing." It is preserving order in lists, trees, layers, rows, comments, blocks, and text-like sequences when users can insert locally, work optimistically, go offline, or edit the same gap at the same time.

That is the gap `fugue` is meant to fill.

## The real problem is ordered intent

Most apps do not just store data; they store things in an order that carries meaning.

- A kanban board means "this card comes before that one."
- A document means "this block or character belongs here."
- A design tool means "this layer sits above that one."
- A table or outline means "this row or node lives between these neighbors."

As soon as more than one user can edit that order, naive approaches start to break down.

Users do not think in terms of isolated inserts. They think in terms of actions:

- typing a word
- pasting a paragraph
- duplicating several cards
- inserting a run of rows
- drag-copying a block of items

Those actions have intent. The inserted items are supposed to stay together as a unit. Good ordering systems should preserve that intent, even under concurrency.

## Why the obvious approaches fall short

### Array indices and integer ranks

Array indices are fine in a single-writer system, but they are unstable under concurrent edits. If two clients both insert at index 5, there is no durable answer to what "index 5" means anymore.


Integer ranks are not much better. They force renumbering or reindexing when a list gets crowded, and reindexing is exactly the kind of rewrite you want to avoid in collaborative systems.

### Plain fractional indexing

Fractional indexing is a major improvement because it lets you insert between neighbors without rewriting older positions.

But plain fractional indexing is usually deterministic: given the same left and right neighbors, every client picks the same midpoint. If two clients insert into the same old gap at the same time, they can generate the same position. In practice that means you need extra machinery like jitter, a tiebreaker, or server-side reassignment.

Even after you address collisions, basic midpoint schemes still treat every insert as an unrelated point in the gap. That works well for many list workloads, yet it misses an important piece of user intent: uninterrupted multi-item inserts should behave like runs, not like independent single inserts.

When two clients insert into the same old gap, you often do not want the result to feel like a shuffle of unrelated points. You want each user's insert episode to remain a contiguous block.

### Full CRDTs

Full CRDT libraries solve a much broader problem: replicated state, merge semantics, delivery order, and richer collaborative data structures.

That is the right choice for some systems, especially replica-first or peer-to-peer ones. But many applications already have a server, a sync pipeline, optimistic updates, and app-specific business rules. Those apps often do not need a whole collaboration stack just to answer one question well:

How do I assign durable positions to ordered items under optimistic and concurrent edits?

## Why a library like fugue is useful

`fugue` is a deliberately smaller primitive.

It gives you client-generated position strings that you can:

- mint locally
- store next to each item
- sort with normal string comparison
- use to insert anywhere without rewriting older positions

That already makes it useful for local-first and collaborative apps. But the more distinctive property is that `fugue` treats one uninterrupted insertion episode as a first-class concept.

Typing, paste, duplicate, and similar actions behave like bursts. Each burst gets its own identity, so concurrent inserts in the same gap stay grouped as blocks instead of collapsing into collisions or interleaving item by item.

That matters because it matches how users actually work.

The value is not just technical correctness. It is preserving the shape of an action.

## Where fugue fits in the design space

`fugue` sits in the middle of a real spectrum:

- simpler than a full CRDT stack
- stronger than plain indices or ad hoc ranks
- more intent-preserving than basic midpoint allocation for bursty inserts

It is best understood as an ordering primitive, not as a full sync system.

`fugue` does not try to own transport, storage, permissions, deletion semantics, undo policy, or conflict resolution for the rest of your data model. It solves the ordering layer, so the rest of your app can stay shaped around your own architecture.

That makes it a good fit for teams that already know how they want to sync data, but still need ordered sequences to behave well.

## What fugue can be used for

Anywhere your product has ordered siblings and that order matters under local or concurrent edits:

- kanban cards and backlog items
- outline nodes and nested documents
- block editor content
- comment threads and ordered annotations
- table rows or columns
- whiteboard objects and diagram nodes
- layers in design or media tools
- scene graphs and timeline-like structures
- collaborative text or text-like spans

The broad category is not just "text." It is ordered things in collaborative apps.

## Why this matters at the product level

If ordering is fragile, the product feels fragile.

Users see it as:

- cards jumping unexpectedly
- duplicated items scattering apart
- pasted content landing in a weird order
- concurrent typing interleaving in unnatural ways
- reorder operations that require server repair or background rewrites

When ordering is stable, the product feels intentional. Users can insert optimistically, collaborate in the same area, and trust that the result still reflects what they meant to do.

That is why ordering deserves to be treated as its own primitive instead of an afterthought.

## When fugue is a good fit

`fugue` is a strong fit when:

- clients need to create ordered positions locally
- optimistic inserts are important
- multiple users may insert into the same gap concurrently
- typing, paste, or duplicate actions should stay grouped
- your app already has, or plans to have, its own sync and storage model

## When fugue is not the right tool

`fugue` is probably not the right abstraction when:

- simple integers or append-only ordering are already enough
- one central authority can safely assign or rewrite order for everyone
- you want a full replicated data model, not just ordering
- you need peer-to-peer or fully decentralized collaboration semantics end to end

## The short version

`fugue` exists because collaborative software needs a better ordering primitive.

Many apps need more than indices, less than a full CRDT, and something that preserves the shape of real user actions under concurrency. `fugue` fills that gap with client-generated sortable positions that can live anywhere, compare as strings, and keep burst-style inserts together.
