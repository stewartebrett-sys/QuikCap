/**
 * ColorPickerPopover — shared text color picker used by both the main
 * formatting toolbar and the floating selection toolbar.
 *
 * Renders as `position: absolute` so the CALLER is responsible for wrapping
 * it in a `position: relative` container. Both toolbars already do this
 * (.tbr-pop-wrap and .ftbr-color-wrap).
 *
 * Every interactive element calls e.preventDefault() on mousedown to keep
 * focus in the contenteditable and preserve any existing text selection.
 */

import "./ColorPickerPopover.css";
import type { Editor } from "@tiptap/react";

// ─── Canonical palette ─────────────────────────────────────
// Single source of truth used across the whole app.

export const PRESET_COLORS = [
  { hex: "#000000", label: "Black"  },
  { hex: "#6b7280", label: "Gray"   },
  { hex: "#dc2626", label: "Red"    },
  { hex: "#ea580c", label: "Orange" },
  { hex: "#16a34a", label: "Green"  },
  { hex: "#2563eb", label: "Blue"   },
  { hex: "#7c3aed", label: "Purple" },
];

// ─── Helper ────────────────────────────────────────────────

/**
 * Returns the text color active at the current cursor/selection, or ""
 * when no color mark is present (or the selection spans multiple colors).
 */
export function getActiveColor(editor: Editor): string {
  return (editor.getAttributes("textStyle") as { color?: string }).color ?? "";
}

// ─── Component ─────────────────────────────────────────────

export interface ColorPickerPopoverProps {
  editor: Editor;
  onClose: () => void;
}

export function ColorPickerPopover({ editor, onClose }: ColorPickerPopoverProps) {
  const activeColor = getActiveColor(editor);

  return (
    <div className="color-pop">
      <div className="color-pop-grid">
        {PRESET_COLORS.map(({ hex, label }) => (
          <button
            key={hex}
            className={`color-swatch${activeColor === hex ? " color-swatch--on" : ""}`}
            style={{ background: hex }}
            title={label}
            onMouseDown={e => {
              e.preventDefault();               // preserve selection / focus
              editor.chain().focus().setColor(hex).run();
              onClose();
            }}
          />
        ))}
      </div>

      <button
        className="color-pop-reset"
        onMouseDown={e => {
          e.preventDefault();
          editor.chain().focus().unsetColor().run();
          onClose();
        }}
      >
        Reset color
      </button>
    </div>
  );
}
