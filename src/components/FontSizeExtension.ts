/**
 * FontSizeExtension — adds per-character font size via the TextStyle mark.
 * Stores values as CSS strings (e.g. "11pt"). Requires TextStyle to be loaded.
 */

import { Extension } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize:   (size: string) => ReturnType;
      unsetFontSize: ()             => ReturnType;
    };
  }
}

export const FontSizeExtension = Extension.create({
  name: "fontSize",

  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => (el as HTMLElement).style.fontSize || null,
            renderHTML: ({ fontSize }) =>
              fontSize ? { style: `font-size: ${fontSize}` } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});
