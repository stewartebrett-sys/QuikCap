/**
 * EditorToolbar — the full formatting toolbar shared by both
 * Quick Capture and the Notes Database editor.
 *
 * Previously lived as `CaptureToolbar` inside Capture.tsx.
 * Extracted so both windows use identical toolbar code.
 */

import "./EditorToolbar.css";
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Undo2, Redo2,
  Bold, Italic, Underline, Strikethrough,
  Palette, Highlighter, Eraser,
  List, ListOrdered, ListChecks,
  AlignLeft, AlignCenter, AlignRight,
  Table, Link2, Image, Minus,
} from "lucide-react";
import { ColorPickerPopover, getActiveColor } from "./ColorPickerPopover";

// ─── Zoom constants ───────────────────────────────────────

export const MIN_ZOOM  = 80;
export const MAX_ZOOM  = 160;
export const ZOOM_STEP = 5;

// ─── Component ───────────────────────────────────────────

export interface EditorToolbarProps {
  editor: Editor;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  /** CSS class for the toolbar container. Defaults to "editor-toolbar". */
  className?: string;
}

export function EditorToolbar({ editor, zoom, onZoomChange, className = "editor-toolbar" }: EditorToolbarProps) {
  const [showColors, setShowColors] = useState(false);
  const colorWrapRef = useRef<HTMLDivElement>(null);
  const currentColor = getActiveColor(editor);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (colorWrapRef.current && !colorWrapRef.current.contains(e.target as Node))
        setShowColors(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const applyLink = () => {
    const prev = (editor.getAttributes("link") as { href?: string }).href ?? "";
    const url = window.prompt("URL", prev);
    if (url === null) return;
    if (url === "") editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href: url }).run();
  };

  const applyImage = () => {
    const url = window.prompt("Image URL");
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };

  const ICON = 16;

  return (
    <div className={className} role="toolbar" aria-label="Formatting options">

      {/* Undo / Redo */}
      <TBtn title="Undo (Ctrl+Z)" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 size={ICON} />
      </TBtn>
      <TBtn title="Redo (Ctrl+Y)" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 size={ICON} />
      </TBtn>

      <TbrSep />

      {/* Font size A− / % / A+ */}
      <div className="tbr-zoom-ctrl">
        <button
          className="tbr-zoom-btn tbr-zoom-btn--sm"
          title="Decrease font size"
          onMouseDown={(e) => { e.preventDefault(); onZoomChange(Math.max(MIN_ZOOM, zoom - ZOOM_STEP)); }}
        >A−</button>
        <span className="tbr-zoom-pct">{zoom}%</span>
        <button
          className="tbr-zoom-btn tbr-zoom-btn--lg"
          title="Increase font size"
          onMouseDown={(e) => { e.preventDefault(); onZoomChange(Math.min(MAX_ZOOM, zoom + ZOOM_STEP)); }}
        >A+</button>
      </div>

      <TbrSep />

      {/* Bold / Italic / Underline / Strikethrough */}
      <TBtn title="Bold (Ctrl+B)"      active={editor.isActive("bold")}      onClick={() => editor.chain().focus().toggleBold().run()}>      <Bold         size={ICON} /></TBtn>
      <TBtn title="Italic (Ctrl+I)"    active={editor.isActive("italic")}    onClick={() => editor.chain().focus().toggleItalic().run()}>    <Italic       size={ICON} /></TBtn>
      <TBtn title="Underline (Ctrl+U)" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline    size={ICON} /></TBtn>
      <TBtn title="Strikethrough"      active={editor.isActive("strike")}    onClick={() => editor.chain().focus().toggleStrike().run()}>    <Strikethrough size={ICON} /></TBtn>

      <TbrSep />

      {/* Font Color / Highlight / Clear Formatting */}
      <div className="tbr-pop-wrap" ref={colorWrapRef}>
        <TBtn title="Text color" active={showColors || !!currentColor} onClick={() => setShowColors((v) => !v)}>
          <ColorIcon color={currentColor || "#111827"} size={ICON} />
        </TBtn>
        {showColors && (
          <ColorPickerPopover editor={editor} onClose={() => setShowColors(false)} />
        )}
      </div>
      <TBtn title="Highlight"       active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}><Highlighter size={ICON} /></TBtn>
      <TBtn title="Clear formatting"                                        onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}><Eraser size={ICON} /></TBtn>

      <TbrSep />

      {/* Lists */}
      <TBtn title="Bullet list"   active={editor.isActive("bulletList")}  onClick={() => editor.chain().focus().toggleBulletList().run()}>  <List        size={ICON} /></TBtn>
      <TBtn title="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={ICON} /></TBtn>
      <TBtn title="Checklist"     active={editor.isActive("taskList")}    onClick={() => editor.chain().focus().toggleTaskList().run()}>    <ListChecks  size={ICON} /></TBtn>

      <TbrSep />

      {/* Alignment */}
      <TBtn title="Align left"   active={editor.isActive({ textAlign: "left" })}   onClick={() => editor.chain().focus().setTextAlign("left").run()}>  <AlignLeft   size={ICON} /></TBtn>
      <TBtn title="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter size={ICON} /></TBtn>
      <TBtn title="Align right"  active={editor.isActive({ textAlign: "right" })}  onClick={() => editor.chain().focus().setTextAlign("right").run()}> <AlignRight  size={ICON} /></TBtn>

      <TbrSep />

      {/* Insert */}
      <TBtn title="Insert table"    onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table size={ICON} /></TBtn>
      <TBtn title="Link (Ctrl+K)"  active={editor.isActive("link")} onClick={applyLink}><Link2 size={ICON} /></TBtn>
      <TBtn title="Insert image"   onClick={applyImage}><Image size={ICON} /></TBtn>
      <TBtn title="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={ICON} /></TBtn>
    </div>
  );
}

// ─── Toolbar primitives ───────────────────────────────────

export function TBtn({
  children, active, onClick, title, disabled,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`tbr-btn${active ? " tbr-btn--active" : ""}${disabled ? " tbr-btn--dim" : ""}`}
      onMouseDown={(e) => { e.preventDefault(); if (!disabled) onClick?.(); }}
      title={title}
      aria-pressed={active}
      aria-label={title}
    >
      {children}
    </button>
  );
}

export function TbrSep() {
  return <div className="tbr-sep" aria-hidden />;
}

export function ColorIcon({ color, size }: { color: string; size: number }) {
  return (
    <span className="tbr-color-icon">
      <Palette size={size} />
      <span className="tbr-color-icon-bar" style={{ background: color }} />
    </span>
  );
}
