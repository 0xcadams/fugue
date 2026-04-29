# Kanban Example

A very small kanban app built with Next.js, Tailwind, Drizzle, `drizzle-zero`, Rocicorp Zero, and `fugue`.

`drizzle-zero` generates `src/lib/zero-schema.gen.ts` from the Drizzle schema in `src/lib/schema.ts`, and the UI uses `fugue` positions for card ordering.

## What it shows

- client-generated `fugue` positions for ordered cards
- dnd-kit drag-and-drop between lanes with touch support
- optimistic reads and writes with Zero
- Drizzle as the schema and migration source of truth
- a tiny Next.js app router setup with Tailwind

## Run it locally

1. Copy the env file:

   ```bash
   cp examples/kanban/.env.example examples/kanban/.env.local
   ```

2. Start Postgres with logical replication enabled. One quick local option is:

   ```bash
   docker run -d --name fugue-kanban-postgres \
     -e POSTGRES_PASSWORD=password \
     -e POSTGRES_DB=fugue_kanban \
     -p 5432:5432 \
     postgres:16-alpine \
     postgres -c wal_level=logical
   ```

3. Install workspace dependencies from the repo root. This also builds the local `fugue` package for the example:

   ```bash
   bun install
   ```

4. Apply the schema and seed the demo board:

   ```bash
   cd examples/kanban
   bun run db:migrate
   ```

5. In one terminal, start the Next app:

   ```bash
   cd examples/kanban
   bun run dev:web
   ```

6. In a second terminal, start Zero cache:

   ```bash
   cd examples/kanban
   bun run dev:zero
   ```

7. Open `http://127.0.0.1:3000`.

## Useful scripts

- `bun run zero:generate` regenerates `src/lib/zero-schema.gen.ts`
- `bun run db:generate` writes a new Drizzle migration
- `bun run db:migrate` applies committed migrations
