/**
 * EditorToolbar — Office-inspired formatting toolbar with split buttons.
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
  ChevronDown,
} from "lucide-react";
import { ColorPickerPopover, getActiveColor, getActiveHighlight } from "./ColorPickerPopover";

// ─── Zoom constants (kept for Ctrl+Wheel in both windows; not rendered) ──

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

// ─── State types ──────────────────────────────────────────

type OpenMenu = "color" | "highlight" | "bullets" | "numbered" | "checklist" | "align" | null;
type Align    = "left" | "center" | "right";

// ─── Component ───────────────────────────────────────────

export interface EditorToolbarProps {
  editor: Editor;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  className?: string;
}

export function EditorToolbar({ editor, className = "editor-toolbar" }: EditorToolbarProps) {
  const [openMenu,      setOpenMenu]      = useState<OpenMenu>(null);
  const [lastColor,     setLastColor]     = useState("#dc2626");
  const [lastHighlight, setLastHighlight] = useState("#fef08a");
  const [lastAlign,     setLastAlign]     = useState<Align>("left");
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node))
        setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const toggle = (id: OpenMenu) => setOpenMenu(prev => prev === id ? null : id);

  const currentColor     = getActiveColor(editor);
  const currentHighlight = getActiveHighlight(editor);
  const currentFamily    = (editor.getAttributes("textStyle") as { fontFamily?: string }).fontFamily ?? "";
  const rawSize          = (editor.getAttributes("textStyle") as { fontSize?: string }).fontSize ?? "";
  const currentSize      = rawSize.replace("pt", "");

  const ICON = 20;
  const SW   = 2;

  const AlignIcon = lastAlign === "center" ? AlignCenter
                  : lastAlign === "right"  ? AlignRight
                  : AlignLeft;

  return (
    <div className={className} role="toolbar" aria-label="Formatting options" ref={toolbarRef}>

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
          if (e.target.value) editor.chain().focus().setFontFamily(e.target.value).run();
          else editor.chain().focus().unsetFontFamily().run();
        }}
      >
        {FONT_FAMILIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>

      {/* ── Font Size ── */}
      <select
        className="tbr-select tbr-select--size"
        value={currentSize}
        title="Font size"
        onMouseDown={e => e.stopPropagation()}
        onChange={e => {
          if (e.target.value) editor.chain().focus().setFontSize(`${e.target.value}pt`).run();
          else editor.chain().focus().unsetFontSize().run();
        }}
      >
        <option value=""></option>
        {FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      <TbrSep />

      {/* ── Character formatting ── */}
      <TBtn title="Bold (Ctrl+B)" active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={ICON} strokeWidth={SW} />
      </TBtn>
      <TBtn title="Italic (Ctrl+I)" active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={ICON} strokeWidth={SW} />
      </TBtn>
      <TBtn title="Underline (Ctrl+U)" active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <Underline size={ICON} strokeWidth={SW} />
      </TBtn>
      <TBtn title="Strikethrough" active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough size={ICON} strokeWidth={SW} />
      </TBtn>

      <TbrSep />

      {/* ── Text Color (split) ── */}
      <SplitBtn
        icon={<FontColorIcon color={currentColor || lastColor} />}
        title="Text color"
        active={!!currentColor}
        open={openMenu === "color"}
        onAction={() => editor.chain().focus().setColor(lastColor).run()}
        onDropdown={() => toggle("color")}
      >
        {openMenu === "color" && (
          <ColorPickerPopover
            editor={editor}
            mode="text"
            onClose={() => setOpenMenu(null)}
            onSelect={c => setLastColor(c)}
          />
        )}
      </SplitBtn>

      {/* ── Highlight Color (split) ── */}
      <SplitBtn
        icon={<HighlightColorIcon color={currentHighlight || lastHighlight} size={ICON} strokeWidth={SW} />}
        title="Highlight"
        active={editor.isActive("highlight")}
        open={openMenu === "highlight"}
        onAction={() => editor.chain().focus().setHighlight({ color: lastHighlight }).run()}
        onDropdown={() => toggle("highlight")}
      >
        {openMenu === "highlight" && (
          <ColorPickerPopover
            editor={editor}
            mode="highlight"
            onClose={() => setOpenMenu(null)}
            onSelect={c => setLastHighlight(c)}
          />
        )}
      </SplitBtn>

      {/* ── Clear Formatting ── */}
      <TBtn title="Clear formatting"
        onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>
        <Eraser size={ICON} strokeWidth={SW} />
      </TBtn>

      <TbrSep />

      {/* ── Bullet List (split) ── */}
      <SplitBtn
        icon={<List size={ICON} strokeWidth={SW} />}
        title="Bullet list"
        active={editor.isActive("bulletList")}
        open={openMenu === "bullets"}
        onAction={() => editor.chain().focus().toggleBulletList().run()}
        onDropdown={() => toggle("bullets")}
      >
        {openMenu === "bullets" && (
          <div className="tbr-dropdown">
            <button className={`tbr-dropdown-item${editor.isActive("bulletList") ? " tbr-dropdown-item--active" : ""}`}
              onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBulletList().run(); setOpenMenu(null); }}>
              <List size={15} strokeWidth={2} /> Bullet list
            </button>
          </div>
        )}
      </SplitBtn>

      {/* ── Numbered List (split) ── */}
      <SplitBtn
        icon={<ListOrdered size={ICON} strokeWidth={SW} />}
        title="Numbered list"
        active={editor.isActive("orderedList")}
        open={openMenu === "numbered"}
        onAction={() => editor.chain().focus().toggleOrderedList().run()}
        onDropdown={() => toggle("numbered")}
      >
        {openMenu === "numbered" && (
          <div className="tbr-dropdown">
            <button className={`tbr-dropdown-item${editor.isActive("orderedList") ? " tbr-dropdown-item--active" : ""}`}
              onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run(); setOpenMenu(null); }}>
              <ListOrdered size={15} strokeWidth={2} /> Numbered list
            </button>
          </div>
        )}
      </SplitBtn>

      {/* ── Checklist (split) ── */}
      <SplitBtn
        icon={<ListChecks size={ICON} strokeWidth={SW} />}
        title="Checklist"
        active={editor.isActive("taskList")}
        open={openMenu === "checklist"}
        onAction={() => editor.chain().focus().toggleTaskList().run()}
        onDropdown={() => toggle("checklist")}
      >
        {openMenu === "checklist" && (
          <div className="tbr-dropdown">
            <button className={`tbr-dropdown-item${editor.isActive("taskList") ? " tbr-dropdown-item--active" : ""}`}
              onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleTaskList().run(); setOpenMenu(null); }}>
              <ListChecks size={15} strokeWidth={2} /> Checklist
            </button>
          </div>
        )}
      </SplitBtn>

      <TbrSep />

      {/* ── Alignment (split) ── */}
      <SplitBtn
        icon={<AlignIcon size={ICON} strokeWidth={SW} />}
        title={`Align ${lastAlign}`}
        active={editor.isActive({ textAlign: lastAlign })}
        open={openMenu === "align"}
        onAction={() => editor.chain().focus().setTextAlign(lastAlign).run()}
        onDropdown={() => toggle("align")}
      >
        {openMenu === "align" && (
          <div className="tbr-dropdown">
            {([ ["left", AlignLeft, "Align left"], ["center", AlignCenter, "Align center"], ["right", AlignRight, "Align right"] ] as const).map(
              ([align, Icon, label]) => (
                <button
                  key={align}
                  className={`tbr-dropdown-item${editor.isActive({ textAlign: align }) ? " tbr-dropdown-item--active" : ""}`}
                  onMouseDown={e => {
                    e.preventDefault();
                    editor.chain().focus().setTextAlign(align).run();
                    setLastAlign(align);
                    setOpenMenu(null);
                  }}
                >
                  <Icon size={15} strokeWidth={2} /> {label}
                </button>
              )
            )}
          </div>
        )}
      </SplitBtn>

    </div>
  );
}

// ─── Simple toolbar button ─────────────────────────────────

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

// ─── Split button (icon side + arrow side) ────────────────

function SplitBtn({
  icon, title, active, disabled, open, onAction, onDropdown, children,
}: {
  icon: React.ReactNode;
  title: string;
  active?: boolean;
  disabled?: boolean;
  open: boolean;
  onAction: () => void;
  onDropdown: () => void;
  children?: React.ReactNode;
}) {
  const [side, setSide] = useState<"icon" | "arrow" | null>(null);

  return (
    <div className={[
      "tbr-split",
      active  ? "tbr-split--active" : "",
      disabled ? "tbr-split--dim"   : "",
    ].filter(Boolean).join(" ")}>

      {/* Icon / action side */}
      <button
        type="button"
        className={`tbr-split-icon${side === "icon" ? " tbr-split-icon--hov" : ""}`}
        onMouseEnter={() => setSide("icon")}
        onMouseLeave={() => setSide(null)}
        onMouseDown={e => { e.preventDefault(); if (!disabled) onAction(); }}
        title={title}
        aria-label={title}
        aria-pressed={active}
      >
        {icon}
      </button>

      {/* Separator — only appears on hover */}
      <span className={`tbr-split-sep${side ? " tbr-split-sep--vis" : ""}`} aria-hidden />

      {/* Dropdown arrow */}
      <button
        type="button"
        className={`tbr-split-arrow${side === "arrow" ? " tbr-split-arrow--hov" : ""}`}
        onMouseEnter={() => setSide("arrow")}
        onMouseLeave={() => setSide(null)}
        onMouseDown={e => { e.preventDefault(); if (!disabled) onDropdown(); }}
        title={`${title} options`}
        aria-label={`${title} options`}
        aria-expanded={open}
      >
        <ChevronDown size={8} strokeWidth={2.5} />
      </button>

      {/* Dropdown content */}
      {children}
    </div>
  );
}

// ─── Separator ────────────────────────────────────────────

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

// ─── Legacy ColorIcon kept for FloatingToolbar ────────────

export function ColorIcon({ color, size }: { color: string; size: number }) {
  return (
    <span className="tbr-color-icon">
      <span style={{ fontSize: size, fontWeight: 700, lineHeight: 1, fontFamily: "sans-serif" }}>A</span>
      <span className="tbr-color-icon-bar" style={{ background: color }} />
    </span>
  );
}
