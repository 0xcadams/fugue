import * as Automerge from "@automerge/automerge";
import { LoroDoc } from "loro-crdt";
import * as Y from "yjs";

import { jsonByteLength } from "../lib/stats.js";
import type {
  BenchmarkAdapter,
  SessionMetrics,
  TextSession,
} from "../lib/types.js";

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

class YjsTextSession implements TextSession {
  private readonly doc = new Y.Doc();
  private readonly text = this.doc.getText("text");

  constructor(initialText: string) {
    seedTextSession(this, initialText);
  }

  insert(index: number, text: string, _actor: string) {
    if (text.length === 0) {
      return;
    }

    this.text.insert(index, text);
  }

  delete(index: number, length: number, _actor: string) {
    if (length <= 0) {
      return;
    }

    this.text.delete(index, length);
  }

  materialize() {
    return this.text.toString();
  }

  metrics(): SessionMetrics {
    return {
      snapshotBytes: Y.encodeStateAsUpdate(this.doc).byteLength,
    };
  }
}

class LoroTextSession implements TextSession {
  private readonly doc = new LoroDoc();
  private readonly text = this.doc.getText("text");

  constructor(initialText: string) {
    seedTextSession(this, initialText);
  }

  insert(index: number, text: string, _actor: string) {
    if (text.length === 0) {
      return;
    }

    this.text.insert(index, text);
  }

  delete(index: number, length: number, _actor: string) {
    if (length <= 0) {
      return;
    }

    this.text.delete(index, length);
  }

  materialize() {
    return this.text.toString();
  }

  metrics(): SessionMetrics {
    return {
      snapshotBytes: this.doc.export({ mode: "snapshot" }).byteLength,
    };
  }
}

type AutomergeTextDoc = {
  text: string;
};

class AutomergeTextSession implements TextSession {
  private doc = Automerge.from<AutomergeTextDoc>({ text: "" });

  constructor(initialText: string) {
    seedTextSession(this, initialText);
  }

  insert(index: number, text: string, _actor: string) {
    if (text.length === 0) {
      return;
    }

    this.doc = Automerge.change(this.doc, (doc) => {
      Automerge.splice(doc, ["text"], index, 0, text);
    });
  }

  delete(index: number, length: number, _actor: string) {
    if (length <= 0) {
      return;
    }

    this.doc = Automerge.change(this.doc, (doc) => {
      Automerge.splice(doc, ["text"], index, length, "");
    });
  }

  materialize() {
    return this.doc.text;
  }

  metrics(): SessionMetrics {
    return {
      snapshotBytes: Automerge.save(this.doc).byteLength,
      notes: [`textChars=${jsonByteLength(this.doc.text)}`],
    };
  }
}

export function createCrdtAdapters(): BenchmarkAdapter[] {
  return [
    {
      name: "yjs",
      family: "crdt",
      support: { text: true, board: false },
      createTextSession(initialText) {
        return new YjsTextSession(initialText);
      },
    },
    {
      name: "automerge",
      family: "crdt",
      support: { text: true, board: false },
      createTextSession(initialText) {
        return new AutomergeTextSession(initialText);
      },
    },
    {
      name: "loro",
      family: "crdt",
      support: { text: true, board: false },
      createTextSession(initialText) {
        return new LoroTextSession(initialText);
      },
    },
  ];
}
