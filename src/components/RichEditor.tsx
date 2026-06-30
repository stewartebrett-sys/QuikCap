/**
 * RichEditor — full-featured Tiptap editor shared by the Notes Database.
 *
 * Uses the exact same extensions, toolbar (EditorToolbar), floating
 * selection toolbar (FloatingToolbar), and keyboard shortcuts as the
 * Quick Capture window so both editing experiences are identical.
 */

import "./RichEditor.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import ExtUnderline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { Table as ExtTable } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import ExtImage from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";

import { IndentExt } from "./IndentExtension";
import { EditorToolbar, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from "./EditorToolbar";
import { FloatingToolbar } from "./FloatingToolbar";

// ─── Public API (forwarded ref) ───────────────────────────

export interface RichEditorHandle {
  getHTML:    () => string;
  getText:    () => string;
  setContent: (html: string) => void;
  clear:      () => void;
  focus:      () => void;
}

// ─── Props ────────────────────────────────────────────────

interface Props {
  onChange?:     (html: string) => void;
  onEscape?:     () => void;
  onCtrlEnter?:  (html: string) => void;
  disabled?:     boolean;
  placeholder?:  string;
}

// ─── Component ───────────────────────────────────────────

const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  { onChange, onEscape, onCtrlEnter, disabled = false, placeholder = "Start writing…" },
  ref,
) {
  const [zoom, setZoom] = useState(100);

  // Stable ref so the handleKeyDown closure always calls the current editor
  const editorRef   = useRef<ReturnType<typeof useEditor>>(null);
  const editorAreaRef = useRef<HTMLDivElement>(null);
  // Stable callbacks wrapped in refs so we never capture stale closures
  const onEscapeRef     = useRef(onEscape);
  const onCtrlEnterRef  = useRef(onCtrlEnter);
  useEffect(() => { onEscapeRef.current    = onEscape;    }, [onEscape]);
  useEffect(() => { onCtrlEnterRef.current = onCtrlEnter; }, [onCtrlEnter]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      ExtUnderline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight,
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      ExtTable.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      ExtImage.configure({ inline: false }),
      Placeholder.configure({ placeholder }),
      IndentExt,
    ],
    editable: !disabled,
    autofocus: false,
    editorProps: {
      attributes: { class: "cap-prose re-prose-overrides", spellcheck: "false" },
      handleKeyDown(_, event) {
        const e = editorRef.current;

        // Escape
        if (event.key === "Escape") {
          onEscapeRef.current?.();
          return true;
        }

        // Ctrl+Enter → finish / custom action
        if (event.key === "Enter" && event.ctrlKey) {
          onCtrlEnterRef.current?.(e?.getHTML() ?? "");
          return true;
        }

        // Backspace at the start of an indented block → outdent (before ProseMirror baseKeymap)
        if (event.key === "Backspace" && e) {
          const { state } = e;
          const { $from, empty } = state.selection;
          if (empty && $from.parentOffset === 0) {
            const parent = $from.parent;
            if (parent.type.name === "paragraph" || parent.type.name === "heading") {
              const indent = ((parent.attrs.indent as number) ?? 0);
              if (indent > 0) {
                event.preventDefault();
                const nodePos = $from.before($from.depth);
                e.view.dispatch(
                  state.tr.setNodeMarkup(nodePos, undefined, { ...parent.attrs, indent: indent - 1 })
                );
                return true;
              }
            }
          }
        }

        // Undo: Ctrl+Z / Cmd+Z
        if (event.key === "z" && !event.shiftKey && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          e?.chain().focus().undo().run();
          return true;
        }

        // Redo: Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y
        if (
          (event.key === "z" && event.shiftKey && (event.ctrlKey || event.metaKey)) ||
          (event.key === "y" && event.ctrlKey && !event.shiftKey)
        ) {
          event.preventDefault();
          e?.chain().focus().redo().run();
          return true;
        }

        // Ctrl+K → link dialog
        if (event.key === "k" && event.ctrlKey && !event.shiftKey) {
          event.preventDefault();
          if (!e) return true;
          const prev = (e.getAttributes("link") as { href?: string }).href ?? "";
          const url = window.prompt("URL", prev);
          if (url !== null) {
            if (url === "") e.chain().focus().unsetLink().run();
            else e.chain().focus().setLink({ href: url }).run();
          }
          return true;
        }

        // Ctrl+Shift+V → paste plain text
        if (event.key === "v" && event.ctrlKey && event.shiftKey) {
          event.preventDefault();
          navigator.clipboard.readText()
            .then((text) => e?.commands.insertContent(text))
            .catch(() => {});
          return true;
        }

        return false;
      },
    },
    onUpdate({ editor: e }) {
      onChange?.(e.getHTML());
    },
  });

  // Keep the stable ref current
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Keep editable in sync with the disabled prop
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  // Ctrl+Wheel → zoom editor text (not entire UI)
  useEffect(() => {
    const el = editorAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((prev) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Forwarded handle ──────────────────────────────────────
  useImperativeHandle(ref, () => ({
    getHTML:    () => editor?.getHTML() ?? "",
    getText:    () => editor?.getText() ?? "",
    setContent: (html) => { editor?.commands.setContent(html); },
    clear:      () => { editor?.commands.clearContent(true); },
    focus:      () => { editor?.commands.focus("end"); },
  }));

  if (!editor) return null;

  return (
    <div className={`re-wrap${disabled ? " re-wrap--disabled" : ""}`}>
      {!disabled && (
        <EditorToolbar editor={editor} zoom={zoom} onZoomChange={setZoom} />
      )}
      <div
        ref={editorAreaRef}
        className="re-editor-area"
        style={{ "--editor-zoom": String(zoom / 100) } as React.CSSProperties}
      >
        <EditorContent editor={editor} className="re-editor-mount" />
      </div>
      <FloatingToolbar editor={editor} />
    </div>
  );
});

export default RichEditor;
