import { KanbanBoard } from "../src/components/kanban-board";

import { Providers } from "./providers";

export default function Page() {
  return (
    <Providers>
      <KanbanBoard />
    </Providers>
  );
}
