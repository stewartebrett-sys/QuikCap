/**
 * SearchHighlightExtension
 *
 * Adds transient (non-persistent) decorations to the ProseMirror view
 * to highlight every occurrence of the current search query.
 *
 * Decorations are purely visual — they do NOT modify the document model
 * and are lost on unmount. No marks are added; no undo history is affected.
 *
 * Usage:
 *   1. Include SearchHighlightExtension in the Tiptap extensions array.
 *   2. Dispatch a transaction with setMeta(searchHighlightKey, { query })
 *      whenever the search query changes (including "" to clear).
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PmNode } from "@tiptap/pm/model";

interface PluginState {
  query: string;
  decorations: DecorationSet;
}

export const searchHighlightKey = new PluginKey<PluginState>("searchHighlight");

function buildDecorations(doc: PmNode, query: string): DecorationSet {
  if (!query.trim()) return DecorationSet.empty;

  const lq = query.toLowerCase();
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    const lower = text.toLowerCase();
    let offset = 0;

    while (offset < lower.length) {
      const idx = lower.indexOf(lq, offset);
      if (idx === -1) break;
      decorations.push(
        Decoration.inline(pos + idx, pos + idx + query.length, {
          class: "search-highlight",
        })
      );
      offset = idx + 1;
    }
  });

  return DecorationSet.create(doc, decorations);
}

export const SearchHighlightExtension = Extension.create({
  name: "searchHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key: searchHighlightKey,

        state: {
          init: () => ({ query: "", decorations: DecorationSet.empty }),

          apply(tr, prev, _, newState) {
            const meta = tr.getMeta(searchHighlightKey) as { query: string } | undefined;
            if (meta !== undefined) {
              return {
                query: meta.query,
                decorations: buildDecorations(newState.doc, meta.query),
              };
            }
            if (tr.docChanged) {
              // Re-run when the document changes while a query is active
              if (prev.query) {
                return {
                  query: prev.query,
                  decorations: buildDecorations(newState.doc, prev.query),
                };
              }
              return { query: "", decorations: DecorationSet.empty };
            }
            return prev;
          },
        },

        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
