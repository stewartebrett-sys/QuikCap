/**
 * FloatingToolbar — appears above any text selection in a Tiptap editor.
 *
 * Design goals
 * ────────────
 * • Reusable: accepts any Tiptap Editor instance.
 * • Never steals focus: every interactive element uses onMouseDown +
 *   e.preventDefault() so the contenteditable keeps focus and the selection
 *   stays intact while the user interacts with the toolbar.
 * • Positioned via the native Selection API (getBoundingClientRect) and
 *   rendered into document.body via a React portal so z-index / stacking
 *   context is never a problem.
 * • Stays in sync with editor state by listening to the browser's native
 *   `selectionchange` event (fires after every ProseMirror DOM update,
 *   including formatting changes that restore the selection).
 */

import "./FloatingToolbar.css";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold, Italic, Underline, Highlighter,
  Palette, Link2, List, ListOrdered,
} from "lucide-react";

// ─── Constants ───────────────────────────────────────────

// Matches the main toolbar palette exactly.
const COLORS = [
  { hex: "#000000", label: "Black"  },
  { hex: "#6b7280", label: "Gray"   },
  { hex: "#dc2626", label: "Red"    },
  { hex: "#ea580c", label: "Orange" },
  { hex: "#16a34a", label: "Green"  },
  { hex: "#2563eb", label: "Blue"   },
  { hex: "#7c3aed", label: "Purple" },
];

const TOOLBAR_H = 40; // approximate rendered height used for above-placement math
const GAP       = 8;  // px gap between selection rect and toolbar
const EDGE      = 12; // min px distance from viewport edge

// ─── Types ───────────────────────────────────────────────

interface ToolbarPos {
  x: number;       // horizontal center of toolbar (translateX(-50%) applied in CSS)
  y: number;       // top edge of toolbar
  flipped: boolean; // true = toolbar is below the selection
}

export interface FloatingToolbarProps {
  editor: Editor | null;
}

// ─── Component ───────────────────────────────────────────

export function FloatingToolbar({ editor }: FloatingToolbarProps) {
  const [show,       setShow]       = useState(false);
  const [pos,        setPos]        = useState<ToolbarPos>({ x: 0, y: 0, flipped: false });
  const [showColors, setShowColors] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const rafRef  = useRef(0);

  // ── Recalculate visibility and position ──────────────────
  // Called on every `selectionchange`. Using RAF debounce so multiple rapid
  // events in a single frame (e.g. during ProseMirror DOM reconciliation)
  // collapse into one calculation.
  const recalc = useCallback(() => {
    if (!editor) { setShow(false); return; }

    const sel = window.getSelection();

    // Hide when nothing is selected or selection is just a cursor
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setShow(false);
      setShowColors(false);
      return;
    }

    const range = sel.getRangeAt(0);

    // Only respond to selections inside this specific editor instance
    if (!editor.view.dom.contains(range.commonAncestorContainer)) {
      setShow(false);
      return;
    }

    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) { setShow(false); return; }

    // Horizontal center, clamped to viewport
    const cx = Math.max(EDGE, Math.min(window.innerWidth - EDGE, rect.left + rect.width / 2));

    // Prefer above the selection; flip below if there's not enough room
    const aboveY = rect.top - TOOLBAR_H - GAP;
    const flip   = aboveY < EDGE;
    const y      = flip ? rect.bottom + GAP : aboveY;

    // Always produce a new object reference so React re-renders even when
    // position hasn't changed (keeps isActive() button states current).
    setPos({ x: cx, y, flipped: flip });
    setShow(true);
  }, [editor]);

  // ── Native selectionchange listener ──────────────────────
  // Fires after every browser selection change, including the automatic
  // selection restore that ProseMirror does after each transaction.
  useEffect(() => {
    const handler = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(recalc);
    };
    document.addEventListener("selectionchange", handler);
    return () => {
      document.removeEventListener("selectionchange", handler);
      cancelAnimationFrame(rafRef.current);
    };
  }, [recalc]);

  // ── Close color picker on outside click ──────────────────
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowColors(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  if (!editor) return null;

  const activeColor = (editor.getAttributes("textStyle") as { color?: string }).color ?? "";

  // Prevent focus steal on every mousedown in the toolbar
  const noSteal = (e: React.MouseEvent) => e.preventDefault();

  const applyLink = () => {
    const prev = (editor.getAttributes("link") as { href?: string }).href ?? "";
    const url  = window.prompt("URL", prev);
    if (url === null) return;
    if (url === "") editor.chain().focus().unsetLink().run();
    else            editor.chain().focus().setLink({ href: url }).run();
  };

  const node = (
    <div
      ref={wrapRef}
      className={[
        "ftbr",
        show        ? "ftbr--visible" : "",
        pos.flipped ? "ftbr--flip"    : "",
      ].filter(Boolean).join(" ")}
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={noSteal}
    >
      {/* ── Text style ── */}
      <FBtn active={editor.isActive("bold")}      title="Bold (Ctrl+B)"      onMD={() => editor.chain().focus().toggleBold().run()}>
        <Bold        size={14} strokeWidth={1.75} />
      </FBtn>
      <FBtn active={editor.isActive("italic")}    title="Italic (Ctrl+I)"    onMD={() => editor.chain().focus().toggleItalic().run()}>
        <Italic      size={14} strokeWidth={1.75} />
      </FBtn>
      <FBtn active={editor.isActive("underline")} title="Underline (Ctrl+U)" onMD={() => editor.chain().focus().toggleUnderline().run()}>
        <Underline   size={14} strokeWidth={1.75} />
      </FBtn>
      <FBtn active={editor.isActive("highlight")} title="Highlight"          onMD={() => editor.chain().focus().toggleHighlight().run()}>
        <Highlighter size={14} strokeWidth={1.75} />
      </FBtn>

      <div className="ftbr-sep" />

      {/* ── Text color ── */}
      <div className="ftbr-color-wrap">
        <FBtn
          active={!!activeColor || showColors}
          title="Text color"
          onMD={() => setShowColors(v => !v)}
        >
          <FColorIcon color={activeColor || "#111827"} />
        </FBtn>

        {showColors && (
          <div className="ftbr-color-pop">
            <div className="ftbr-color-grid">
              {COLORS.map(({ hex, label }) => (
                <button
                  key={hex}
                  className={`ftbr-swatch${activeColor === hex ? " ftbr-swatch--on" : ""}`}
                  style={{ background: hex }}
                  title={label}
                  onMouseDown={e => {
                    e.preventDefault();
                    editor.chain().focus().setColor(hex).run();
                    setShowColors(false);
                  }}
                />
              ))}
            </div>
            <button
              className="ftbr-color-reset"
              onMouseDown={e => {
                e.preventDefault();
                editor.chain().focus().unsetColor().run();
                setShowColors(false);
              }}
            >
              Reset color
            </button>
          </div>
        )}
      </div>

      <div className="ftbr-sep" />

      {/* ── Link ── */}
      <FBtn active={editor.isActive("link")} title="Link (Ctrl+K)" onMD={applyLink}>
        <Link2 size={14} strokeWidth={1.75} />
      </FBtn>

      <div className="ftbr-sep" />

      {/* ── Lists ── */}
      <FBtn active={editor.isActive("bulletList")}  title="Bullet list"   onMD={() => editor.chain().focus().toggleBulletList().run()}>
        <List        size={14} strokeWidth={1.75} />
      </FBtn>
      <FBtn active={editor.isActive("orderedList")} title="Numbered list" onMD={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={14} strokeWidth={1.75} />
      </FBtn>
    </div>
  );

  return createPortal(node, document.body);
}

// ─── FBtn ─────────────────────────────────────────────────
// The action fires on mousedown (not click) and e.preventDefault() is called
// first, which prevents the browser from moving focus away from the editor.
// The existing text selection is therefore preserved through every click.

function FBtn({
  children, active, title, onMD,
}: {
  children: React.ReactNode;
  active?: boolean;
  title?: string;
  onMD?: () => void;
}) {
  return (
    <button
      type="button"
      className={`ftbr-btn${active ? " ftbr-btn--on" : ""}`}
      onMouseDown={e => { e.preventDefault(); onMD?.(); }}
      title={title}
      aria-label={title}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

// ─── FColorIcon ───────────────────────────────────────────
// Palette icon with a colored underline bar — matches the main toolbar.

function FColorIcon({ color }: { color: string }) {
  return (
    <span className="ftbr-color-icon">
      <Palette size={14} strokeWidth={1.75} />
      <span className="ftbr-color-bar" style={{ background: color }} />
    </span>
  );
}
