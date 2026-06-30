/**
 * EditorToolbar — Office-inspired formatting toolbar.
 * Groups: Undo/Redo | Font Family/Size | B/I/U/S | Color/Highlight/Clear | Lists | Alignment
 */

import "./EditorToolbar.css";
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Undo2, Redo2,
  Bold, Italic, Underline, Strikethrough,
  Highlighter, Eraser,
  List, ListOrdered, ListChecks,
  AlignLeft, AlignCenter, AlignRight,
} from "lucide-react";
import { ColorPickerPopover, getActiveColor, getActiveHighlight } from "./ColorPickerPopover";

// ─── Zoom constants (kept for Capture's Ctrl+Wheel; no longer shown in toolbar) ──

export const MIN_ZOOM  = 80;
export const MAX_ZOOM  = 160;
export const ZOOM_STEP = 5;

// ─── Font options ─────────────────────────────────────────

const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: "Default",         value: "" },
  { label: "Segoe UI",        value: "Segoe UI, system-ui, sans-serif" },
  { label: "Aptos",           value: "Aptos, Calibri, sans-serif" },
  { label: "Calibri",         value: "Calibri, Arial, sans-serif" },
  { label: "Arial",           value: "Arial, sans-serif" },
  { label: "Times New Roman", value: "'Times New Roman', serif" },
  { label: "Georgia",         value: "Georgia, serif" },
  { label: "Courier New",     value: "'Courier New', monospace" },
];

const FONT_SIZES = ["8","9","10","11","12","14","16","18","20","24","28","36","48","72"];

// ─── Component ───────────────────────────────────────────

export interface EditorToolbarProps {
  editor: Editor;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  className?: string;
}

export function EditorToolbar({ editor, className = "editor-toolbar" }: EditorToolbarProps) {
  const [showColors,    setShowColors]    = useState(false);
  const [showHighlight, setShowHighlight] = useState(false);
  const colorWrapRef     = useRef<HTMLDivElement>(null);
  const highlightWrapRef = useRef<HTMLDivElement>(null);

  // Close popovers on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (colorWrapRef.current     && !colorWrapRef.current.contains(e.target as Node))
        setShowColors(false);
      if (highlightWrapRef.current && !highlightWrapRef.current.contains(e.target as Node))
        setShowHighlight(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // ── Read current selection attributes ──────────────────
  const currentColor     = getActiveColor(editor);
  const currentHighlight = getActiveHighlight(editor);
  const currentFamily    = (editor.getAttributes("textStyle") as { fontFamily?: string }).fontFamily ?? "";
  const rawSize          = (editor.getAttributes("textStyle") as { fontSize?: string }).fontSize ?? "";
  const currentSize      = rawSize.replace("pt", "");

  const ICON = 15;
  const SW   = 2;   // consistent stroke weight across all icons

  return (
    <div className={className} role="toolbar" aria-label="Formatting options">

      {/* ── Undo / Redo ── */}
      <TBtn title="Undo (Ctrl+Z)" disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 size={ICON} strokeWidth={SW} />
      </TBtn>
      <TBtn title="Redo (Ctrl+Y)" disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 size={ICON} strokeWidth={SW} />
      </TBtn>

      <TbrSep />

      {/* ── Font Family ── */}
      <select
        className="tbr-select tbr-select--family"
        value={currentFamily}
        title="Font family"
        onMouseDown={e => e.stopPropagation()}
        onChange={e => {
          if (e.target.value) {
            editor.chain().focus().setFontFamily(e.target.value).run();
          } else {
            editor.chain().focus().unsetFontFamily().run();
          }
        }}
      >
        {FONT_FAMILIES.map(f => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>

      {/* ── Font Size ── */}
      <select
        className="tbr-select tbr-select--size"
        value={currentSize}
        title="Font size"
        onMouseDown={e => e.stopPropagation()}
        onChange={e => {
          if (e.target.value) {
            editor.chain().focus().setFontSize(`${e.target.value}pt`).run();
          } else {
            editor.chain().focus().unsetFontSize().run();
          }
        }}
      >
        <option value=""></option>
        {FONT_SIZES.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <TbrSep />

      {/* ── Character formatting ── */}
      <TBtn title="Bold (Ctrl+B)"      active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={ICON} strokeWidth={SW} />
      </TBtn>
      <TBtn title="Italic (Ctrl+I)"    active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={ICON} strokeWidth={SW} />
      </TBtn>
      <TBtn title="Underline (Ctrl+U)" active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <Underline size={ICON} strokeWidth={SW} />
      </TBtn>
      <TBtn title="Strikethrough"      active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough size={ICON} strokeWidth={SW} />
      </TBtn>

      <TbrSep />

      {/* ── Text color ── */}
      <div className="tbr-pop-wrap" ref={colorWrapRef}>
        <TBtn
          title="Text color"
          active={showColors || !!currentColor}
          onClick={() => { setShowHighlight(false); setShowColors(v => !v); }}
        >
          <FontColorIcon color={currentColor || "#111827"} />
        </TBtn>
        {showColors && (
          <ColorPickerPopover editor={editor} mode="text" onClose={() => setShowColors(false)} />
        )}
      </div>

      {/* ── Highlight color ── */}
      <div className="tbr-pop-wrap" ref={highlightWrapRef}>
        <TBtn
          title="Highlight color"
          active={showHighlight || editor.isActive("highlight")}
          onClick={() => { setShowColors(false); setShowHighlight(v => !v); }}
        >
          <HighlightColorIcon color={currentHighlight || "#fef08a"} size={ICON} strokeWidth={SW} />
        </TBtn>
        {showHighlight && (
          <ColorPickerPopover editor={editor} mode="highlight" onClose={() => setShowHighlight(false)} />
        )}
      </div>

      {/* ── Clear formatting ── */}
      <TBtn title="Clear formatting"
        onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>
        <Eraser size={ICON} strokeWidth={SW} />
      </TBtn>

      <TbrSep />

      {/* ── Lists ── */}
      <TBtn title="Bullet list"   active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={ICON} strokeWidth={SW} />
      </TBtn>
      <TBtn title="Numbered list" active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={ICON} strokeWidth={SW} />
      </TBtn>
      <TBtn title="Checklist"     active={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <ListChecks size={ICON} strokeWidth={SW} />
      </TBtn>

      <TbrSep />

      {/* ── Alignment ── */}
      <TBtn title="Align left"
        active={editor.isActive({ textAlign: "left" })}
        onClick={() => editor.chain().focus().setTextAlign("left").run()}>
        <AlignLeft size={ICON} strokeWidth={SW} />
      </TBtn>
      <TBtn title="Align center"
        active={editor.isActive({ textAlign: "center" })}
        onClick={() => editor.chain().focus().setTextAlign("center").run()}>
        <AlignCenter size={ICON} strokeWidth={SW} />
      </TBtn>
      <TBtn title="Align right"
        active={editor.isActive({ textAlign: "right" })}
        onClick={() => editor.chain().focus().setTextAlign("right").run()}>
        <AlignRight size={ICON} strokeWidth={SW} />
      </TBtn>

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
      onMouseDown={e => { e.preventDefault(); if (!disabled) onClick?.(); }}
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

// ─── Office-style "A" font color icon ────────────────────

export function FontColorIcon({ color }: { color: string }) {
  return (
    <span className="tbr-font-color-icon" aria-hidden>
      <span className="tbr-font-color-a">A</span>
      <span className="tbr-color-icon-bar" style={{ background: color }} />
    </span>
  );
}

// ─── Highlight icon with current color bar ────────────────

export function HighlightColorIcon({
  color, size, strokeWidth,
}: { color: string; size: number; strokeWidth: number }) {
  return (
    <span className="tbr-color-icon" aria-hidden>
      <Highlighter size={size} strokeWidth={strokeWidth} />
      <span className="tbr-color-icon-bar" style={{ background: color }} />
    </span>
  );
}

// ─── Legacy export kept for FloatingToolbar compatibility ─

export function ColorIcon({ color, size }: { color: string; size: number }) {
  return (
    <span className="tbr-color-icon">
      <span style={{ fontSize: size, fontWeight: 700, lineHeight: 1, fontFamily: "sans-serif" }}>A</span>
      <span className="tbr-color-icon-bar" style={{ background: color }} />
    </span>
  );
}
