/**
 * IndentExt — Tiptap extension shared by both the Quick Capture editor
 * and the Notes Database editor.
 *
 * • Tab / Shift-Tab indent/outdent paragraphs and list items.
 * • Adds an `indent` attribute to paragraph/heading nodes rendered as
 *   inline padding-left so ProseMirror tracks it in the document model.
 * • Tab always returns true (never moves browser focus out of editor).
 */

import { Extension } from "@tiptap/core";

export const IndentExt = Extension.create({
  name: "indentExt",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          indent: {
            default: 0,
            renderHTML: ({ indent }) =>
              (indent as number) > 0
                ? { style: `padding-left:${(indent as number) * 2}em` }
                : {},
            parseHTML: (el) => {
              const pl = (el as HTMLElement).style.paddingLeft;
              return pl ? Math.round(parseFloat(pl) / 2) : 0;
            },
          },
        },
      },
    ];
  },

  addKeyboardShortcuts() {
    const indentBlock = (delta: 1 | -1): boolean => {
      const { state, view } = this.editor;
      const { from, to } = state.selection;
      const tr = state.tr;
      let changed = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name === "paragraph" || node.type.name === "heading") {
          const cur = ((node.attrs.indent as number) ?? 0);
          const next = Math.min(8, Math.max(0, cur + delta));
          if (next !== cur) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
            changed = true;
          }
        }
      });
      if (changed) view.dispatch(tr);
      return true;
    };

    return {
      Tab: () => {
        if (this.editor.isActive("listItem")) {
          this.editor.commands.sinkListItem("listItem");
          return true;
        }
        if (this.editor.isActive("taskItem")) {
          this.editor.commands.sinkListItem("taskItem");
          return true;
        }
        return indentBlock(1);
      },
      "Shift-Tab": () => {
        if (this.editor.isActive("listItem")) {
          this.editor.commands.liftListItem("listItem");
          return true;
        }
        if (this.editor.isActive("taskItem")) {
          this.editor.commands.liftListItem("taskItem");
          return true;
        }
        return indentBlock(-1);
      },
    };
  },
});
